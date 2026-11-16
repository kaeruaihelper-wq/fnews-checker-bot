// Static configuration for FNEWS.

export const BOT_USERNAME = 'FNewsChecker_bot';
export const BOT_ID = 9269986816;

// The owner can change settings and trigger posts from private chat.
export const DEFAULT_OWNER_ID = 1709377874;

// The channel the bot was connected to when the project was created. It is
// inserted as a default on first run; afterwards channels are managed in the
// database (and auto-detected through my_chat_member updates).
export const DEFAULT_CHANNEL_ID = -1004269805142;
export const DEFAULT_CHANNEL_TITLE = 'Financial News';

export const DEFAULT_INTERVAL_MINUTES = 5;
export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 1440;

// Each story is posted as its own message with a photo. This is the maximum
// number of such posts in one scheduler run; extra fresh stories are deferred
// to the next run.
export const DEFAULT_MAX_POSTS = 5;
export const MIN_MAX_POSTS = 1;
export const MAX_MAX_POSTS = 10;

// Only stories published within this window are posted. Older unseen stories
// are ignored, so a quiet day never turns into a backlog dump.
export const MAX_POST_AGE_HOURS = 6;

// The channel publishes only stories from the current calendar day. Days are
// counted in Moscow time (UTC+3, no daylight saving) so a story published late
// yesterday is not posted after midnight MSK.
export const DAY_OFFSET_MINUTES = 180;

export const DEFAULT_LOOKBACK_HOURS = 48;
export const SEEN_RETENTION_DAYS = 30;

// Two runs may not overlap. A lock older than this is considered abandoned.
export const LOCK_MS = 120_000;

// Telegram's photo caption limit. Photo captions must stay below it, so text
// posts use the same limit for consistent post length.
export const MAX_CAPTION_LENGTH = 1024;

export const YAHOO_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// General Yahoo Finance searches. Each returns up to 30 stories; they overlap
// heavily and are deduplicated by uuid/title.
export const GENERAL_QUERIES = [
  'stock market',
  'stocks',
  'finance',
  'earnings',
  'Wall Street',
  'economy',
  'technology stocks',
  'energy stocks',
];

export const NEWS_PER_QUERY = 30;
export const TRENDING_LIMIT = 10;
export const TRENDING_QUERIES = 6;
export const TRENDING_NEWS_PER_QUERY = 15;

// Cap on stories kept after deduplication in one run.
export const MAX_CANDIDATES = 250;

// Stories matching these patterns are usually personal-finance listicles
// rather than market news. They are dropped unless they still carry a ticker.
export const PERSONAL_FINANCE_PATTERN =
  /\b(401\(k\)|roth ira|social security|student loan|credit card|cd rates?|savings account|personal finance|retirement)\b/i;
