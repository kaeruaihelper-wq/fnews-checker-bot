import { fetch } from 'sdk';

// Google's public translate endpoint. No API key is available inside a
// serverless module, so this keyless endpoint is used; it is best-effort and
// the post falls back to the original English text when it fails.
const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';
const MAX_INPUT_LENGTH = 1800;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function parseTranslation(data) {
  const segments = Array.isArray(data?.[0]) ? data[0] : [];
  return segments
    .map((segment) =>
      Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : '',
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Translates English news text to Russian. Returns '' on any failure so the
 * caller can keep the original text instead of blocking a post.
 */
export async function translateToRussian(text) {
  const source = String(text ?? '').trim();
  if (!source) return '';
  if (!/[A-Za-z]/.test(source)) return source;

  try {
    const url =
      `${TRANSLATE_URL}?client=gtx&sl=en&tl=ru&dt=t&q=` +
      encodeURIComponent(source.slice(0, MAX_INPUT_LENGTH));

    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn(`Translation HTTP ${res.status}`);
      return '';
    }

    return parseTranslation(await res.json());
  } catch (error) {
    console.warn(`Translation failed: ${error?.message || String(error)}`);
    return '';
  }
}
