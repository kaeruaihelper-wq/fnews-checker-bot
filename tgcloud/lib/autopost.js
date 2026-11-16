import { api, db } from 'sdk';
import { gte } from 'sdk/db';
import { seenNews } from '../schema.js';
import {
  DAY_OFFSET_MINUTES,
  DEFAULT_MAX_POSTS,
  MAX_MAX_POSTS,
  MAX_POST_AGE_HOURS,
  SEEN_RETENTION_DAYS,
} from './config.js';
import { buildCaption, errorMessage } from './format.js';
import {
  acquireLock,
  ensureDefaults,
  getChannels,
  getSettings,
  markChannelResult,
  pruneSeen,
  releaseLock,
  updateSettings,
} from './store.js';
import { translateToRussian } from './translate.js';
import { fetchLatestNews, fetchStorySummary } from './yahoo.js';

function isThrottled(settingsRow, now) {
  if (!settingsRow.lastRunAt) return false;
  const last = new Date(settingsRow.lastRunAt).getTime();
  if (!Number.isFinite(last)) return false;

  const intervalMs = (settingsRow.intervalMinutes || 5) * 60 * 1000;
  // One minute of slack, so a scheduler that fires exactly on the interval
  // is not rejected by a few seconds of clock skew.
  return now - last < Math.max(0, intervalMs - 60_000);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_OFFSET_MS = DAY_OFFSET_MINUTES * 60 * 1000;

// Calendar day number in the channel's timezone (Moscow, UTC+3).
function dayNumber(timestamp) {
  return Math.floor((timestamp + DAY_OFFSET_MS) / DAY_MS);
}

function isSameDay(timestamp, now) {
  return dayNumber(timestamp) === dayNumber(now);
}

// A story is posted only when it is both fresh (within MAX_POST_AGE_HOURS)
// and from the current calendar day.
function isRecent(story, now) {
  return (
    isSameDay(story.publishedAt, now) &&
    now - story.publishedAt <= MAX_POST_AGE_HOURS * 60 * 60 * 1000
  );
}

function clampMaxPosts(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_POSTS;
  return Math.min(MAX_MAX_POSTS, Math.max(1, Math.round(n)));
}

async function addSummaries(stories) {
  await Promise.all(
    stories.map(async (story) => {
      if (!story.summary) story.summary = await fetchStorySummary(story);
    }),
  );
  return stories;
}

// Russian versions used for display only; the original English text stays in
// the story object for deduplication and the seen_news table.
async function addTranslations(stories) {
  for (const story of stories) {
    const [titleRu, summaryRu] = await Promise.all([
      translateToRussian(story.title),
      story.summary ? translateToRussian(story.summary) : Promise.resolve(''),
    ]);
    if (titleRu) story.titleRu = titleRu;
    if (summaryRu) story.summaryRu = summaryRu;
  }
  return stories;
}

async function getFreshStories(settingsRow) {
  const candidates = await fetchLatestNews({
    lookbackHours: settingsRow.lookbackHours || 48,
  });

  // A story that was seen up to 14 days ago must not be posted again. Older
  // rows can be pruned; their stories are outside the lookback window anyway.
  // Query params are bound as raw SQLite values, so timestamp columns compare
  // against unix seconds, not Date objects.
  const since = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60;
  const seenRows = await db
    .select({ id: seenNews.id })
    .from(seenNews)
    .where(gte(seenNews.publishedAt, since))
    .all();
  const seen = new Set(seenRows.map((row) => row.id));

  return candidates.filter((story) => !seen.has(story.id));
}

async function markSeen(stories) {
  const rows = stories.map((story) => ({
    id: story.id,
    title: story.title.slice(0, 500),
    link: story.link.slice(0, 1200),
    publisher: story.publisher,
    publishedAt: new Date(story.publishedAt),
    tickers: story.tickers.length ? story.tickers : story.indexes,
    sourceQuery: story.sourceQuery || null,
  }));

  // SQLite's variable limit is 999; 50 rows × 8 columns stays far below it.
  for (let i = 0; i < rows.length; i += 50) {
    await db
      .insert(seenNews)
      .values(rows.slice(i, i + 50))
      .onConflictDoNothing({ target: seenNews.id })
      .run();
  }
}

/**
 * One news cycle: fetch Yahoo Finance, filter unseen stories, send each story
 * as its own photo post to every enabled channel, then mark the delivered
 * stories as seen.
 *
 * Only stories published within MAX_POST_AGE_HOURS are considered, so a quiet
 * period never turns into a dump of old news. If there is nothing fresh, no
 * message is sent.
 */
export async function runNewsCycle({ force = false, source = 'manual' } = {}) {
  await ensureDefaults();

  const current = await getSettings();
  const now = Date.now();

  if (!force && current.enabled === false) {
    return { skipped: true, reason: 'paused', totalFresh: 0, posted: 0, channels: 0 };
  }

  if (!force && isThrottled(current, now)) {
    return { skipped: true, reason: 'interval', totalFresh: 0, posted: 0, channels: 0 };
  }

  if (!(await acquireLock())) {
    return { skipped: true, reason: 'locked', totalFresh: 0, posted: 0, channels: 0 };
  }

  try {
    await updateSettings({ lastRunAt: new Date(now) });
    const settingsRow = await getSettings();

    let fresh;
    try {
      fresh = await getFreshStories(settingsRow);
    } catch (error) {
      await updateSettings({
        lastError: errorMessage(error),
        lastResult: {
          at: new Date().toISOString(),
          source,
          error: errorMessage(error),
        },
      });
      throw error;
    }

    const recent = fresh.filter((story) => isRecent(story, now));
    const maxPosts = clampMaxPosts(settingsRow.maxItems);
    const selected = recent.slice(0, maxPosts);
    const deferred = Math.max(0, recent.length - selected.length);
    const stale = fresh.length - recent.length;
    const channels = await getChannels({ enabledOnly: true });

    if (!selected.length) {
      await updateSettings({
        lastError: null,
        lastResult: {
          at: new Date().toISOString(),
          source,
          fresh: 0,
          posted: 0,
          deferred: 0,
          stale,
          channels: channels.length,
        },
      });
      return {
        posted: 0,
        totalFresh: 0,
        deferred: 0,
        stale,
        channels: channels.length,
        items: [],
      };
    }

    if (!channels.length) {
      await updateSettings({
        lastError: 'No enabled channels',
        lastResult: {
          at: new Date().toISOString(),
          source,
          fresh: recent.length,
          posted: 0,
          deferred,
          stale,
          channels: 0,
        },
      });
      return {
        posted: 0,
        noChannels: true,
        totalFresh: recent.length,
        deferred,
        stale,
        channels: 0,
        items: [],
      };
    }

    await addSummaries(selected);
    await addTranslations(selected);

    const postedItems = [];
    const channelsPosted = new Set();
    const disabledChannels = new Set();
    const errors = [];

    for (const story of selected) {
      const caption = buildCaption(story);
      let delivered = false;

      for (const channel of channels) {
        if (disabledChannels.has(channel.chatId)) continue;

        try {
          // Stories with a Yahoo thumbnail are photo posts; the rest are plain
          // text posts, with no placeholder image.
          const message = story.image
            ? await api.sendPhoto({
                chat_id: channel.chatId,
                photo: story.image,
                caption,
                parse_mode: 'HTML',
              })
            : await api.sendMessage({
                chat_id: channel.chatId,
                text: caption,
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true },
              });
          delivered = true;
          channelsPosted.add(channel.chatId);
          await markChannelResult(channel.chatId, {
            lastPostAt: new Date(),
            lastMessageId: message.message_id,
            lastError: null,
          });
        } catch (error) {
          const messageText = errorMessage(error);
          errors.push(`${channel.chatId}: ${messageText}`);

          // 403 usually means the bot was removed or lost the right to post.
          if (error?.code === 403) disabledChannels.add(channel.chatId);

          await markChannelResult(channel.chatId, {
            lastError: messageText,
            enabled: error?.code === 403 ? false : undefined,
          }).catch(() => {});
        }
      }

      if (delivered) postedItems.push(story);
    }

    const errorText = errors.length ? errors.join('; ').slice(0, 500) : null;
    const result = {
      at: new Date().toISOString(),
      source,
      fresh: recent.length,
      posted: postedItems.length,
      deferred,
      stale,
      channels: channelsPosted.size,
      errors: errors.slice(0, 3),
    };

    if (postedItems.length) {
      await markSeen(postedItems);
      await updateSettings({
        lastPostAt: new Date(),
        lastError: errorText,
        lastResult: result,
      });
    } else {
      await updateSettings({ lastError: errorText, lastResult: result });
    }

    try {
      await pruneSeen(SEEN_RETENTION_DAYS);
    } catch (error) {
      console.warn('Could not prune old news rows:', error?.message || String(error));
    }

    console.log(
      `News cycle (${source}): ${recent.length} fresh, ${postedItems.length} posts to ` +
      `${channelsPosted.size}/${channels.length} channel(s), ${deferred} deferred, ` +
      `${stale} stale, ${errors.length} error(s)`,
    );

    return {
      posted: postedItems.length,
      totalFresh: recent.length,
      deferred,
      stale,
      channels: channelsPosted.size,
      errors,
      items: postedItems,
    };
  } catch (error) {
    await updateSettings({ lastError: errorMessage(error) }).catch(() => {});
    throw error;
  } finally {
    await releaseLock().catch(() => {});
  }
}

export async function previewNews({ limit = 5 } = {}) {
  await ensureDefaults();
  const settingsRow = await getSettings();
  const fresh = await getFreshStories(settingsRow);
  const now = Date.now();
  const recent = fresh.filter((story) => isRecent(story, now));
  const items = recent.slice(0, clampMaxPosts(limit));

  await addSummaries(items);
  await addTranslations(items);

  return { totalFresh: recent.length, items };
}
