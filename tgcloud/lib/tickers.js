// Ticker normalization and display helpers.

const INDEX_NAMES = {
  '^GSPC': 'S&P 500',
  '^DJI': 'Dow Jones',
  '^IXIC': 'Nasdaq',
  '^RUT': 'Russell 2000',
  '^VIX': 'VIX',
};

const EQUITY_RE = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

// Symbols that are quotes, futures, FX, private companies or crypto — not
// stocks/ETFs the reader can act on.
const NON_EQUITY_RE = /(\^|=F$|=X$|-USD$|\.PVT$)/i;

const CASHTAG_RE = /\$([A-Za-z]{1,5}(?:\.[A-Za-z]{1,3})?)/g;

export function isIndexTicker(symbol) {
  return Object.prototype.hasOwnProperty.call(INDEX_NAMES, symbol);
}

export function isEquityTicker(symbol) {
  if (typeof symbol !== 'string') return false;
  const s = symbol.trim().toUpperCase();
  if (!s || !EQUITY_RE.test(s)) return false;
  if (NON_EQUITY_RE.test(s)) return false;
  if (isIndexTicker(s)) return false;
  return true;
}

export function indexLabel(symbol) {
  return INDEX_NAMES[symbol] || symbol;
}

export function extractCashtags(text) {
  if (typeof text !== 'string') return [];
  const found = [];
  let match;
  CASHTAG_RE.lastIndex = 0;
  while ((match = CASHTAG_RE.exec(text)) !== null) {
    const symbol = match[1].toUpperCase();
    if (isEquityTicker(symbol)) found.push(symbol);
  }
  return found;
}

// Returns up to `limit` unique stock/ETF symbols.
export function cleanTickers(raw, extras = [], limit = 6) {
  const out = [];
  const seen = new Set();

  const add = (value) => {
    if (out.length >= limit || typeof value !== 'string') return;
    const symbol = value.trim().toUpperCase();
    if (!isEquityTicker(symbol) || seen.has(symbol)) return;
    seen.add(symbol);
    out.push(symbol);
  };

  if (Array.isArray(raw)) {
    for (const value of raw) add(value);
  }
  for (const value of extras) add(value);

  return out;
}

// Returns up to `limit` unique market indices referenced by a story.
export function cleanIndexes(raw, limit = 4) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(raw)) return out;

  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const symbol = value.trim().toUpperCase();
    if (!isIndexTicker(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
    if (out.length >= limit) break;
  }
  return out;
}

export function tickerLine(item) {
  if (item.market && item.indexes?.length) {
    const names = item.indexes.map(indexLabel);
    return `Market-wide: ${names.join(' · ')}`;
  }
  if (item.tickers?.length) {
    return item.tickers.map((t) => `$${t}`).join(' · ');
  }
  return 'Market-wide';
}
