import { MAX_CAPTION_LENGTH } from './config.js';
import { tickerLine } from './tickers.js';

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function truncate(value, max) {
  const text = String(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function plural(count, one, few, many) {
  const n = Math.abs(Number(count) || 0);
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

export function formatDateRu(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}, ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`
  );
}

function captionBody(item, titleLimit, summaryLimit) {
  const title = escapeHtml(truncate(item.title, titleLimit));
  const summary = item.summary ? escapeHtml(truncate(item.summary, summaryLimit)) : '';
  const tickers = escapeHtml(tickerLine(item));

  return (
    `<b>${title}</b>\n\n` +
    (summary ? `${summary}\n\n` : '') +
    `🏷 ${tickers}`
  );
}

/**
 * Builds a Telegram HTML caption for one story: headline, short article
 * summary, affected tickers and a source link. Captions are limited to 1024
 * characters, so the summary and title are shortened until everything fits.
 */
export function buildCaption(item) {
  let titleLimit = 220;
  let summaryLimit = 380;
  let caption = captionBody(item, titleLimit, summaryLimit);

  while (item.summary && caption.length > MAX_CAPTION_LENGTH && summaryLimit > 80) {
    summaryLimit -= 40;
    caption = captionBody(item, titleLimit, summaryLimit);
  }

  while (caption.length > MAX_CAPTION_LENGTH && titleLimit > 60) {
    titleLimit -= 20;
    caption = captionBody(item, titleLimit, summaryLimit);
  }

  return caption;
}

export function errorMessage(error) {
  const text = error?.description || error?.message || String(error || 'Unknown error');
  return truncate(text, 300);
}
