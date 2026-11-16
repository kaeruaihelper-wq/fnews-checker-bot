import { db } from 'sdk';
import { and, asc, eq, isNull, lt, or } from 'sdk/db';
import { channels, seenNews, settings } from '../schema.js';
import {
  DEFAULT_CHANNEL_ID,
  DEFAULT_CHANNEL_TITLE,
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_LOOKBACK_HOURS,
  DEFAULT_MAX_POSTS,
  DEFAULT_OWNER_ID,
  LOCK_MS,
} from './config.js';

let defaultsPromise = null;

export async function getSettings() {
  let row = await db.select().from(settings).where(eq(settings.id, 1)).get();

  if (!row) {
    await db
      .insert(settings)
      .values({
        id: 1,
        ownerId: DEFAULT_OWNER_ID,
        enabled: true,
        intervalMinutes: DEFAULT_INTERVAL_MINUTES,
        maxItems: DEFAULT_MAX_POSTS,
        lookbackHours: DEFAULT_LOOKBACK_HOURS,
      })
      .onConflictDoNothing({ target: settings.id })
      .run();
    row = await db.select().from(settings).where(eq(settings.id, 1)).get();
  }

  if (!row) throw new Error('Could not initialize FNEWS settings');
  return row;
}

export async function updateSettings(patch) {
  await db.update(settings).set(patch).where(eq(settings.id, 1)).run();
  return getSettings();
}

export async function getChannels({ enabledOnly = false } = {}) {
  const rows = await db.select().from(channels).orderBy(asc(channels.chatId)).all();
  if (!enabledOnly) return rows;
  return rows.filter((row) => row.enabled !== false);
}

export async function upsertChannel({ chatId, title, username, addedBy, enabled = true }) {
  const patch = { title: title || null, username: username || null, enabled, lastError: null };
  if (addedBy != null) patch.addedBy = addedBy;

  await db
    .insert(channels)
    .values({
      chatId,
      title: title || null,
      username: username || null,
      enabled,
      addedBy: addedBy ?? null,
    })
    .onConflictDoUpdate({ target: channels.chatId, set: patch })
    .run();
}

export async function setChannelEnabled(chatId, enabled) {
  await db.update(channels).set({ enabled }).where(eq(channels.chatId, chatId)).run();
}

export async function markChannelResult(chatId, { lastPostAt, lastMessageId, lastError, enabled }) {
  const patch = {};
  if (lastPostAt !== undefined) patch.lastPostAt = lastPostAt;
  if (lastMessageId !== undefined) patch.lastMessageId = lastMessageId;
  if (lastError !== undefined) patch.lastError = lastError;
  if (enabled !== undefined) patch.enabled = enabled;
  if (!Object.keys(patch).length) return;
  await db.update(channels).set(patch).where(eq(channels.chatId, chatId)).run();
}

export async function countSeen() {
  return db.$count(seenNews);
}

export async function pruneSeen(days) {
  // Raw query params are not mode-converted, so compare in unix seconds.
  const cutoff = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  const result = await db.delete(seenNews).where(lt(seenNews.publishedAt, cutoff)).run();
  return result.rowsAffected || 0;
}

export async function getOwnerId() {
  const row = await getSettings();
  return row?.ownerId ?? DEFAULT_OWNER_ID;
}

export async function isOwner(userId) {
  if (userId == null) return false;
  const ownerId = await getOwnerId();
  return String(userId) === String(ownerId);
}

async function doEnsureDefaults() {
  const row = await getSettings();
  if (row.ownerId == null) {
    await updateSettings({ ownerId: DEFAULT_OWNER_ID });
  }

  // Seed the channel the bot was connected to during setup. Once a row exists
  // (even a disabled one), the user's channel choices are respected.
  const channelCount = await db.$count(channels);
  if (channelCount === 0) {
    await upsertChannel({
      chatId: DEFAULT_CHANNEL_ID,
      title: DEFAULT_CHANNEL_TITLE,
      enabled: true,
    });
  }
}

export function ensureDefaults() {
  if (!defaultsPromise) {
    defaultsPromise = doEnsureDefaults().catch((err) => {
      defaultsPromise = null;
      throw err;
    });
  }
  return defaultsPromise;
}

// Acquires a short-lived run lock. Returns true when this invocation owns it.
export async function acquireLock() {
  await ensureDefaults();
  const now = Date.now();

  const result = await db
    .update(settings)
    .set({ lockAt: now })
    .where(
      and(
        eq(settings.id, 1),
        or(isNull(settings.lockAt), lt(settings.lockAt, now - LOCK_MS)),
      ),
    )
    .run();

  return (result.rowsAffected || 0) > 0;
}

export async function releaseLock() {
  await db.update(settings).set({ lockAt: null }).where(eq(settings.id, 1)).run();
}
