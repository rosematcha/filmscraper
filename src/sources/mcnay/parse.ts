import type { IsoDate } from '../../core/types.js';

export interface McnayEvent {
  readonly title: string;
  readonly url: string;
  readonly date: IsoDate;
  /** Display time, e.g. `"1:00p"`; empty when the card omits one. */
  readonly time: string;
}

/** Each card ends with its date and, usually, a start–end time range. */
const CARD_WHEN = /<p class="event-date">([^<]*)<\/p>\s*(?:<p class="event-time">([^<]*)<\/p>)?/gi;

/** The card's link and title sit just above the date, inside the same block. */
const EVENT_HREF = /href="(https:\/\/www\.mcnayart\.org\/event\/[^"]+)"/gi;
const CARD_TITLE = /class="title"[^>]*>\s*([^<]+?)\s*</gi;

/** How far back from a date to look for the link and title it belongs to. */
const CARD_WINDOW = 3000;

/** Where a card begins, so one card cannot borrow the one above it's link. */
const CARD_START = /class="(?:featured-event-info|secondary-events-single)/gi;

/**
 * Only the museum's screenings are wanted; it also runs talks, camps and tours.
 * GET REEL is the one series the museum names without the word film.
 */
const FILM_EVENT = /\b(films?|screenings?|cinema|movies?|get reel)\b/i;

/** A screening that is off; the library feed drops these the same way. */
const CALLED_OFF = /^(postponed|cancell?ed)\b/i;

/** A run status the museum prefixes onto the title of a screening still on. */
const STATUS_PREFIX = /^(sold out|free)\b[^|:]*[|:]\s*/i;

/**
 * `Film Screening:`, `1954 Film Series:`, `GET REEL:` — a label, not part of
 * the picture. Deliberately narrow: `The Story of Film: An Odyssey` names a film
 * before its colon too, and stripping that would publish half a title.
 */
const SERIES_LABEL =
  /^(?:[^:]*\b(?:screenings?|series)\b[^:]*|films?|movies?|cinema|get reel):\s*/i;

/** A session the same event repeats, e.g. `… | Friday Morning`; never the film. */
const SESSION_QUALIFIER =
  /^((mon|tues|wednes|thurs|fri|satur|sun)day|weekend)?\s*(morning|afternoon|evening|matinee|night|session \d+|part \d+)$/i;

const PLACEHOLDER = /^(film (screening|series)|screening|tbd|tba|to be announced)$/i;

const MONTHS: Readonly<Record<string, string>> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

function decode(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/g, '&')
    .replace(/&#0*8217;|&rsquo;/gi, '’')
    .replace(/&#0*8216;|&lsquo;/gi, '‘')
    .replace(/&#0*8220;|&ldquo;/gi, '“')
    .replace(/&#0*8221;|&rdquo;/gi, '”')
    .replace(/&#0*8211;|&ndash;/gi, '–')
    .replace(/&#0*8212;|&mdash;/gi, '—')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `Sunday, September 27, 2026` or `September 27, 2026` -> `2026-09-27`. */
export function parseMcnayDate(text: string): IsoDate | null {
  const match = /(?:^|,\s*)([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*$/.exec(decode(text));
  if (!match) return null;
  const month = MONTHS[match[1]?.toLowerCase() ?? ''];
  const day = match[2]?.padStart(2, '0') ?? '';
  const year = match[3] ?? '';
  if (!month || !day || !year) return null;
  return `${year}-${month}-${day}`;
}

/** `1:00 pm – 5:00 pm` -> `"1:00p"`; only the start matters to the table. */
export function parseMcnayTime(text: string): string {
  const match = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i.exec(decode(text));
  if (!match) return '';
  const hour = Number(match[1]);
  if (!Number.isFinite(hour) || hour < 1 || hour > 12) return '';
  return `${String(hour)}:${match[2] ?? '00'}${(match[3] ?? 'p').toLowerCase()}`;
}

function lastIndex(haystack: string, pattern: RegExp): number {
  let found = 0;
  pattern.lastIndex = 0;
  for (const match of haystack.matchAll(pattern)) found = match.index;
  return found;
}

function lastMatch(haystack: string, pattern: RegExp): string | null {
  let found: string | null = null;
  pattern.lastIndex = 0;
  for (const match of haystack.matchAll(pattern)) found = match[1] ?? found;
  return found;
}

/**
 * Read upcoming events off the McNay's events page.
 *
 * The theme renders one featured event and then a card per event, with the
 * link, title, date and time all in the markup — the WordPress REST API
 * exposes the same posts but not the event date, so the page is the source.
 * Cards are emitted twice for the desktop and mobile layouts, hence the dedupe.
 */
export function parseMcnayEvents(html: string): McnayEvent[] {
  const out: McnayEvent[] = [];
  const seen = new Set<string>();
  for (const when of html.matchAll(CARD_WHEN)) {
    const date = parseMcnayDate(when[1] ?? '');
    if (!date) continue;

    const window = html.slice(Math.max(0, when.index - CARD_WINDOW), when.index);
    // Anchored at the card's own opening tag: an event whose card links
    // somewhere else would otherwise inherit the link above it.
    const card = window.slice(lastIndex(window, CARD_START));
    const url = lastMatch(card, EVENT_HREF);
    const title = lastMatch(card, CARD_TITLE);
    if (!url || !title) continue;

    const time = parseMcnayTime(when[2] ?? '');
    const key = `${url} ${date} ${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: decode(title), url, date, time });
  }
  return out;
}

/** Whether an event is a screening at all; the museum mostly programmes talks. */
export function isMcnayFilmEvent(title: string): boolean {
  return FILM_EVENT.test(title);
}

/**
 * Pull the picture out of an event title.
 *
 * The museum titles a screening after its series — `McNay Summer Film Series:
 * LOVEfest | Paris is Burning` — so the film is what follows the last pipe, and
 * failing that whatever follows a `Film Screening:`-style label. Colons inside
 * the film's own name survive because only a leading label is stripped.
 */
export function filmFromMcnayTitle(title: string): string | null {
  const trimmed = title.trim();
  if (CALLED_OFF.test(trimmed)) return null;

  const segments = trimmed
    .replace(STATUS_PREFIX, '')
    .split('|')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '' && !SESSION_QUALIFIER.test(segment));

  const last = segments.at(-1);
  if (last === undefined) return null;
  const film = (segments.length > 1 ? last : last.replace(SERIES_LABEL, '')).trim();
  if (!film || PLACEHOLDER.test(film)) return null;
  return film;
}
