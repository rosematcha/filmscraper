/**
 * What a screening costs, as far as the listing says.
 *
 * `unknown` is the honest default and the common one: no source we read
 * publishes a price field, so this is read out of whatever prose the event
 * carries. A film only reaches the free table on `free`, never on `unknown` —
 * telling someone a ticketed museum screening is free is a worse failure than
 * leaving a genuinely free one out.
 */
export type Admission = 'free' | 'paid' | 'unknown';

/**
 * A price in the copy.
 *
 * `$0` and `$0.00` are a way of saying free, so they are excluded here and
 * caught by the free patterns below.
 */
const PRICE = /\$\s*(?!0(?:\.00)?\b)\d/;

/** Words that price a screening without naming a figure. */
const PAID =
  /\b(tickets?\s+(?:are\s+)?(?:on\s+sale|required|\$)|admission\s+(?:is\s+)?\$|paid\s+admission|purchase\s+tickets?|ticketed\s+event|members?\s+only)\b/i;

/**
 * Phrases that mean the screening itself is free.
 *
 * Deliberately narrow. "Free parking", "free popcorn" and "free with museum
 * admission" all appear in this copy and none of them makes the film free, so
 * the pattern requires a word that refers to entry.
 */
const FREE =
  /\b(?:free\s+(?:and\s+open\s+to\s+the\s+public|admission|entry|event|screening|movie|film|to\s+(?:attend|the\s+public))|admission\s+is\s+free|no\s+(?:admission\s+)?(?:charge|cost)|open\s+to\s+the\s+public\s+(?:for\s+)?free)\b|\bfree\s*[!.]/i;

/** "Free with admission" prices the film at the door, whatever the door costs. */
const FREE_WITH = /\bfree\s+with\b/i;

/**
 * A venue that stamps `FREE` onto the front of its own event title.
 *
 * The McNay writes `FREE: Film Series: …` and Slab's outdoor calendar appends
 * `Free Admission` to the same effect; both are saying it about the screening
 * and nothing else, which a mid-sentence "free" cannot be trusted to be.
 */
const FREE_LEAD = /^\s*free\b\s*[:|–—-]/i;

/**
 * Read admission out of a listing's own words.
 *
 * A named price wins over the word "free": copy that says "Free popcorn,
 * tickets $12" is a paid screening, and the reverse reading would publish a
 * false claim.
 */
export function detectAdmission(...texts: readonly (string | undefined)[]): Admission {
  const text = texts.filter((t): t is string => typeof t === 'string' && t !== '').join(' \n ');
  if (text === '') return 'unknown';
  if (PRICE.test(text) || PAID.test(text)) return 'paid';
  if (FREE_WITH.test(text)) return 'unknown';
  if (FREE.test(text) || texts.some((t) => typeof t === 'string' && FREE_LEAD.test(t))) return 'free';
  return 'unknown';
}

/**
 * The first reading that actually says something.
 *
 * Lets a source fall back from an event's own copy to the page it sits on,
 * which is only sound when that page carries a single series.
 */
export function firstKnown(...readings: readonly Admission[]): Admission {
  return readings.find((r) => r !== 'unknown') ?? 'unknown';
}

/** Strip tags and entities so event markup can be scanned as prose. */
export function textOf(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}
