import { isMysteryTitle, MYSTERY_KEY } from './mystery.js';

/** A trailing release year Fandango appends inconsistently, e.g. `"Moana (2026)"`. */
const TRAILING_YEAR = /\s*\((?:19|20)\d{2}\)\s*$/;

/**
 * Edition and event suffixes that distinguish Fandango variants of one film.
 * Stripped for the merge key only — they stay in the displayed title, where
 * "55th Anniversary" is genuinely useful information.
 */
const VARIANT_SUFFIX =
  /\s*[-–—:]?\s*\(?\b(\d{1,3}(st|nd|rd|th)\s+anniversary|anniversary(\s+edition)?|(extended|special|collector'?s|director'?s|ultimate|deluxe|final)\s+(edition|cut)|everything\s+must\s+go\s+edition|with\s+bonus\s+footage|re-?release|encore(\s+\d{4})?|fan\s+event|early\s+access|sing-?along|in\s+concert|imax\s+experience|the\s+imax\s+experience|3d|imax|dubbed|subtitled|in\s+spanish|spanish\s+language)\b\)?\s*/gi;

/** Leading articles ignored when comparing titles for merge purposes. */
const LEADING_ARTICLE = /^(the|a|an)\s+/i;

/**
 * Separators Fandango uses before an event descriptor.
 * `Super Troopers 3: Special Broken Lizard Fan Event Q&A`
 */
const TITLE_SEPARATOR = /\s+[-–—]\s+|:\s+/;

/**
 * A trailing segment that describes the *screening* rather than the film.
 *
 * Deliberately conservative: only matched against segments after a separator,
 * and only on distinctive words, so `Mission: Impossible` and
 * `Gabby's Dollhouse: The Movie` keep their tails.
 */
const EVENT_TAIL =
  /\b(fan\s*event|q\s*(&|and)\s*a|qanda|anniversary|early\s+access|sing-?along|encore|fest\b|presented\s+by|edition|re-?release|special\s+screening|my\s+first\s+movie|imax\s+experience|bonus\s+footage|(extended|director'?s|special|final)\s+cut)\b/i;

/**
 * Drop a trailing screening descriptor.
 *
 * `Super Troopers 3: Special Broken Lizard Fan Event Q&A` and `Super Troopers 3`
 * are the same film playing the same week, and belong in one row.
 */
function stripEventTail(title: string): string {
  const parts = title.split(TITLE_SEPARATOR);
  if (parts.length < 2) return title;
  const cut = parts.findIndex((part, i) => i > 0 && EVENT_TAIL.test(part));
  if (cut === -1) return title;
  const head = parts.slice(0, cut).join(': ').trim();
  return head.length > 0 ? head : title;
}

/** Strip the trailing `(YYYY)` Fandango appends to most current releases. */
export function stripYear(title: string): string {
  return title.replace(TRAILING_YEAR, '').trim();
}

/** Extract the trailing `(YYYY)` year, if present. */
export function extractYear(title: string): number | null {
  const match = TRAILING_YEAR.exec(title);
  if (!match) return null;
  const digits = /(\d{4})/.exec(match[0]);
  return digits?.[1] ? Number(digits[1]) : null;
}

/**
 * The title as it appears in the output table.
 *
 * Years are stripped by default. `keepYears` restores them, which matters for
 * repertory programming where the year is the disambiguator — Fandango is
 * inconsistent about supplying one, so this is a presentation choice, not a
 * data one.
 */
export function displayTitle(title: string, keepYears: boolean): string {
  const collapsed = title.replace(/\s+/g, ' ').trim();
  return keepYears ? collapsed : stripYear(collapsed);
}

/**
 * Aggressively normalized form used to decide whether two Fandango entries are
 * the same film. Drops years, edition/event suffixes, leading articles,
 * punctuation, and ampersand spelling.
 */
export function mergeKey(title: string): string {
  // Every chain's unannounced-title night is the same screening under five
  // marketing names, so it short-circuits the normal title comparison.
  if (isMysteryTitle(title)) return MYSTERY_KEY;

  let key = stripEventTail(stripYear(title.replace(/\s+/g, ' ').trim()));
  // Repeat until stable: entries can stack suffixes, e.g. "… 3D Re-Release".
  for (;;) {
    const stripped = stripEventTail(key.replace(VARIANT_SUFFIX, ' ').trim());
    // A film actually called "IMAX" or "3D" is all suffix; keep the last form
    // that still says something rather than collapsing to an empty key that
    // would merge every such title together.
    if (stripped === key || stripped.length === 0) break;
    key = stripped;
  }

  // Separators are dropped entirely rather than normalised, so an independent
  // venue's "Spiderman: Brand New Day" folds into Fandango's "Spider-Man:
  // Brand New Day" instead of becoming a second row.
  return key
    .replace(/&/g, ' and ')
    .replace(LEADING_ARTICLE, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Fandango's numeric movie id, parsed out of a `movie-overview` path. */
export function movieIdFromHref(href: string): string | null {
  return /-(\d+)\/movie-overview/.exec(href)?.[1] ?? null;
}
