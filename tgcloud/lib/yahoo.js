import { fetch } from 'sdk';
import {
  GENERAL_QUERIES,
  MAX_CANDIDATES,
  NEWS_PER_QUERY,
  PERSONAL_FINANCE_PATTERN,
  TRENDING_LIMIT,
  TRENDING_NEWS_PER_QUERY,
  TRENDING_QUERIES,
  YAHOO_UA,
} from './config.js';
import {
  cleanIndexes,
  cleanTickers,
  extractCashtags,
  isEquityTicker,
} from './tickers.js';

const SEARCH_URL = 'https://query1.finance.yahoo.com/v1/finance/search';
const TRENDING_URL = 'https://query2.finance.yahoo.com/v1/finance/trending/US';

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  bull: '•',
};

function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1].toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code)) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function hash32(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeTitle(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isYahooLink(link) {
  return /^https?:\/\/([a-z0-9-]+\.)*(yahoo\.com|finance\.yahoo\.com)\//i.test(link);
}

// Yahoo returns a thumbnail with several resolutions; prefer the "original"
// (or largest) one, which is what the channel post shows.
function pickImage(raw) {
  const resolutions = raw?.thumbnail?.resolutions;
  if (!Array.isArray(resolutions)) return '';

  let best = '';
  let bestScore = -1;

  for (const resolution of resolutions) {
    if (!resolution || typeof resolution.url !== 'string') continue;
    const url = decodeEntities(resolution.url).trim();
    if (!/^https?:\/\//i.test(url)) continue;

    const width = Number(resolution.width);
    const score = (resolution.tag === 'original' ? 1e9 : 0) + (Number.isFinite(width) ? width : 0);
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
  }

  return best.slice(0, 1200);
}

function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaContent(html, key) {
  // Match either attribute order and keep the quote character so apostrophes
  // inside a double-quoted value do not truncate the description.
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=(["'])([\\s\\S]*?)\\1`, 'i'),
    new RegExp(`<meta[^>]+content=(["'])([\\s\\S]*?)\\1[^>]+(?:name|property)=["']${key}["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[2];
  }
  return '';
}

/**
 * Loads the article's meta description so a post carries a short summary, not
 * only the headline. Returns '' when the page cannot be read; the caption then
 * falls back to the title and tickers.
 */
export async function fetchStorySummary(story) {
  if (!story?.link) return '';

  try {
    const res = await fetch(story.link, {
      headers: {
        'User-Agent': YAHOO_UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) return '';

    const html = await res.text();
    let description = metaContent(html, 'description') || metaContent(html, 'og:description');

    if (!description) {
      const ld = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);
      if (ld) {
        try {
          const parsed = JSON.parse(ld[1]);
          const node = Array.isArray(parsed) ? parsed.find((entry) => entry?.description) : parsed;
          if (node?.description) description = String(node.description);
        } catch {
          // Ignore malformed JSON-LD and keep the title-only caption.
        }
      }
    }

    const summary = decodeEntities(stripHtml(description));
    if (summary.length < 40) return '';
    return summary.slice(0, 400);
  } catch (error) {
    console.warn(`Could not load article summary: ${error?.message || String(error)}`);
    return '';
  }
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': YAHOO_UA,
      'Accept': 'application/json, text/plain, */*',
    },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance HTTP ${res.status} ${res.statusText || ''}`.trim());
  }

  return res.json();
}

async function searchNews(query, newsCount) {
  const url =
    `${SEARCH_URL}?q=${encodeURIComponent(query)}` +
    `&newsCount=${newsCount}&quotesCount=0&enableFuzzyQuery=false`;
  const data = await getJson(url);
  return Array.isArray(data?.news) ? data.news : [];
}

async function fetchTrendingTickers() {
  const data = await getJson(`${TRENDING_URL}?count=${TRENDING_LIMIT}`);
  const quotes = data?.finance?.result?.[0]?.quotes;
  if (!Array.isArray(quotes)) return [];

  const out = [];
  const seen = new Set();
  for (const quote of quotes) {
    const symbol = String(quote?.symbol || '').toUpperCase();
    if (!symbol || seen.has(symbol) || !isEquityTicker(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
    if (out.length >= TRENDING_LIMIT) break;
  }
  return out;
}

// Runs async tasks with bounded concurrency. Never rejects: each slot is a
// Promise.allSettled-shaped result.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index]) };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error };
      }
    }
  }

  const workers = [];
  const count = Math.min(limit, items.length);
  for (let i = 0; i < count; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

function normalizeStory(raw, { query, queryTicker, now, lookbackHours }) {
  if (!raw || typeof raw !== 'object') return null;

  const rawTitle = decodeEntities(raw.title || '').replace(/\s+/g, ' ').trim();
  if (rawTitle.length < 15) return null;

  const link = decodeEntities(raw.link || '').trim();
  if (!/^https?:\/\//i.test(link) || !isYahooLink(link)) return null;

  let publishedAt = Number(raw.providerPublishTime);
  if (!Number.isFinite(publishedAt) || publishedAt <= 0) return null;
  if (publishedAt < 1e12) publishedAt *= 1000;

  const oldest = now - lookbackHours * 60 * 60 * 1000;
  if (publishedAt < oldest || publishedAt > now + 60 * 60 * 1000) return null;

  const extras = [];
  if (queryTicker) extras.push(queryTicker);
  extras.push(...extractCashtags(rawTitle));

  const tickers = cleanTickers(raw.relatedTickers, extras);
  const indexes = cleanIndexes(raw.relatedTickers);

  if (!tickers.length && !indexes.length) return null;

  // Personal-finance pieces are noise for a market channel unless they are
  // explicitly tied to a listed company.
  if (!tickers.length && PERSONAL_FINANCE_PATTERN.test(rawTitle)) return null;

  const title = rawTitle.slice(0, 400);
  const publisher = decodeEntities(raw.publisher || 'Yahoo Finance')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

  const uuid = typeof raw.uuid === 'string' && raw.uuid.trim() ? raw.uuid.trim() : '';
  const id = uuid || `h_${hash32(`${title}|${link}`)}`;

  return {
    id: id.slice(0, 128),
    title,
    link: link.slice(0, 1200),
    publisher: publisher || 'Yahoo Finance',
    publishedAt,
    image: pickImage(raw),
    tickers,
    indexes,
    market: tickers.length === 0,
    sourceQuery: query,
  };
}

export async function fetchLatestNews({ lookbackHours = 48 } = {}) {
  const now = Date.now();
  const tasks = GENERAL_QUERIES.map((query) => ({
    query,
    ticker: null,
    count: NEWS_PER_QUERY,
  }));

  let trending = [];
  try {
    trending = await fetchTrendingTickers();
  } catch (error) {
    console.warn('Yahoo trending tickers unavailable:', error?.message || String(error));
  }

  for (const ticker of trending.slice(0, TRENDING_QUERIES)) {
    tasks.push({ query: ticker, ticker, count: TRENDING_NEWS_PER_QUERY });
  }

  const responses = await mapLimit(tasks, 5, async (task) => ({
    task,
    items: await searchNews(task.query, task.count),
  }));

  const normalized = [];
  let failedQueries = 0;

  for (const response of responses) {
    if (response.status === 'rejected') {
      failedQueries++;
      console.warn('Yahoo search failed:', response.reason?.message || String(response.reason));
      continue;
    }
    const { task, items } = response.value;
    for (const raw of items) {
      const story = normalizeStory(raw, {
        query: task.query,
        queryTicker: task.ticker,
        now,
        lookbackHours,
      });
      if (story) normalized.push(story);
    }
  }

  if (!normalized.length) {
    throw new Error(
      `Yahoo Finance returned no usable stories (${failedQueries}/${tasks.length} queries failed)`,
    );
  }

  const byId = new Map();
  const byTitle = new Set();

  for (const story of normalized) {
    const titleKey = normalizeTitle(story.title) || story.id;
    if (byId.has(story.id) || byTitle.has(titleKey)) continue;
    byId.set(story.id, story);
    byTitle.add(titleKey);
  }

  const stories = Array.from(byId.values())
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, MAX_CANDIDATES);

  console.log(
    `Yahoo: ${normalized.length} normalized, ${stories.length} unique ` +
    `from ${tasks.length} queries (${failedQueries} failed)`,
  );

  return stories;
}
