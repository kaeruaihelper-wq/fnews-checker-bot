import { table, integer, text, boolean, json, index, sql } from 'sdk/db';

// Global bot settings. There is always exactly one row, with id = 1.
export const settings = table('settings', {
  id: integer('id').primaryKey(),
  ownerId: integer('owner_id'),
  enabled: boolean('enabled').default(true),
  // The app inserts 5 explicitly on first run; the SQLite default stays 15 to
  // avoid a manual table rebuild for existing deployments.
  intervalMinutes: integer('interval_minutes').default(15),
  maxItems: integer('max_items').default(5), // max individual posts per run
  lookbackHours: integer('lookback_hours').default(48),
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
  lastPostAt: integer('last_post_at', { mode: 'timestamp' }),
  lockAt: integer('lock_at'), // unix ms, used as a short-lived run lock
  lastError: text('last_error'),
  lastResult: json('last_result'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Telegram channels the bot publishes to. chatId is the channel's numeric id.
export const channels = table('channels', {
  chatId: integer('chat_id').primaryKey(),
  title: text('title'),
  username: text('username'),
  enabled: boolean('enabled').default(true),
  addedBy: integer('added_by'),
  addedAt: integer('added_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  lastPostAt: integer('last_post_at', { mode: 'timestamp' }),
  lastMessageId: integer('last_message_id'),
  lastError: text('last_error'),
}, (t) => ({
  enabledIdx: index('idx_channels_enabled').on(t.enabled),
}));

// Stories the bot has already considered, so the same news is never posted
// twice. id is Yahoo's uuid (or a stable hash fallback).
export const seenNews = table('seen_news', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  link: text('link').notNull(),
  publisher: text('publisher'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  tickers: json('tickers'),
  sourceQuery: text('source_query'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (t) => ({
  publishedIdx: index('idx_seen_published').on(t.publishedAt),
}));
