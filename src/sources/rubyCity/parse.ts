import type { IsoDate } from '../../core/types.js';

export interface RubyCityEvent {
  readonly title: string;
  /** WordPress post id; the card carries no permalink, only this. */
  readonly postId: string;
  readonly date: IsoDate;
  /** Display time, e.g. `"8:30p"`; empty when the card omits one. */
  readonly time: string;
  /** `RUBY CITY` or `CHRIS PARK`, as the card writes it. */
  readonly place: string;
}

/** How many headings into a card the date can be; past this it is page furniture. */
const LATEST_DATE_HEADING = 3;

/** Elementor renders each event as a loop item tagged with its post id. */
const LOOP_ITEM = /<div data-elementor-type="loop-item"[\s\S]*?class="[^"]*\bpost-(\d+)\b[^"]*"/gi;
const HEADING = /elementor-heading-title[^>]*>\s*([^<]*?)\s*</gi;

/** `08.16.2026` — the only heading in a card shaped like a date. */
const CARD_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

/** `9—10AM`, `2PM—5PM`, `8:30–10:00PM`: a range whose start may borrow the half. */
const CARD_TIME = /^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?\s*[—–-]\s*\d{1,2}(?::\d{2})?\s*([ap]m)?$/i;
/** A single time, for the day a card names one rather than a range. */
const LONE_TIME = /^(\d{1,2})(?::(\d{2}))?\s*([ap])m$/i;

/** The museum programmes a screening about once a year; everything else is not one. */
const FILM_EVENT = /\b(film|screening|cinema|movie)s?\b/i;

/**
 * A label in front of the film, as in `FILM SCREENING: THE WALKOUT`.
 *
 * Narrow on purpose: `THE STORY OF FILM: AN ODYSSEY` also names a film before a
 * colon, so a bare `film` only counts as a label when it is the whole prefix.
 */
const LEADING_LABEL =
  /^(?:[^:]*\b(?:screenings?|series|cinema|films)\b[^:]*|films?|movies?)(?::|\s+[—–-])\s*/i;

/**
 * The same label after the film, which is how the museum usually writes it.
 *
 * It has to end the title or hand over to a second billing — `+ FILMMAKER TALK`
 * — because a label followed by a colon is the leading case above.
 */
const TRAILING_LABEL =
  /\s+\b(?:film screenings?|screenings?|film series|films?|cinema|movies?)\b(?=\s*(?:$|[+|]|with\b))/i;

/** What is left over when the title billed the programme and never the picture. */
const PLACEHOLDER =
  /^[("']?(films?|screenings?|film screenings?|film series|cinema|movies?|tbd|tba|to be announced)[)"']?$/i;

function decode(text: string): string {
  return text
    .replace(/&nbsp;| /gi, ' ')
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

/** `08.16.2026` -> `2026-08-16`. */
export function parseRubyCityDate(text: string): IsoDate | null {
  const match = CARD_DATE.exec(text.trim());
  if (!match) return null;
  const month = match[1]?.padStart(2, '0') ?? '';
  const day = match[2]?.padStart(2, '0') ?? '';
  const year = match[3] ?? '';
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day}`;
}

/**
 * `9—10AM` -> `"9:00a"`.
 *
 * Ruby City writes the half of the day once, on whichever end of the range
 * needs it, so a start with no `AM` takes the one the end carries.
 */
export function parseRubyCityTime(text: string): string {
  const value = decode(text);
  const lone = LONE_TIME.exec(value);
  if (lone) return `${String(Number(lone[1]))}:${lone[2] ?? '00'}${(lone[3] ?? 'p').toLowerCase()}`;

  const range = CARD_TIME.exec(value);
  if (!range) return '';
  const hour = Number(range[1]);
  if (!Number.isFinite(hour) || hour < 1 || hour > 12) return '';
  const half = (range[3] ?? range[4])?.slice(0, 1).toLowerCase();
  // `9—10` with no AM or PM anywhere is not a time anyone can be told to arrive at.
  if (half === undefined) return '';
  return `${String(hour)}:${range[2] ?? '00'}${half}`;
}

/**
 * Read the events page's upcoming cards.
 *
 * Elementor's loop grid renders a card as a bare stack of headings — title,
 * weekday, date, time, place — with no permalink and no markup naming any of
 * them, so the date is found by its shape and the rest by its position around
 * it. Past events render through a second template that carries a title only,
 * which is why a card with no date is skipped rather than repaired.
 */
export function parseRubyCityEvents(html: string): RubyCityEvent[] {
  const out: RubyCityEvent[] = [];
  const seen = new Set<string>();
  const starts = [...html.matchAll(LOOP_ITEM)];

  for (const [index, start] of starts.entries()) {
    const end = starts[index + 1]?.index ?? html.length;
    const card = html.slice(start.index, end);
    const postId = start[1] ?? '';
    const headings = [...card.matchAll(HEADING)].map((match) => decode(match[1] ?? ''));

    const dateAt = headings.findIndex((heading) => CARD_DATE.test(heading));
    const title = headings[0];
    // The last card runs to the end of the document, so a date further down the
    // heading list than any card puts it belongs to the page, not the event.
    if (dateAt < 1 || dateAt > LATEST_DATE_HEADING || title === undefined || title === '') continue;
    const date = parseRubyCityDate(headings[dateAt] ?? '');
    if (!date) continue;

    // Time and place follow the date in that order, but a card that names no
    // time leaves the place where the time would have been.
    const time = parseRubyCityTime(headings[dateAt + 1] ?? '');
    const place = (time === '' ? headings[dateAt + 1] : headings[dateAt + 2]) ?? '';

    const key = `${postId} ${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, postId, date, time, place });
  }
  return out;
}

/** Whether the card is a screening; the rest of the programme is talks and yoga. */
export function isRubyCityFilmEvent(title: string): boolean {
  return FILM_EVENT.test(title);
}

/**
 * Pull the picture out of an event title.
 *
 * Ruby City names the film first and says what the evening is afterwards —
 * `ASCO: WITHOUT PERMISSION FILM SCREENING`, `THEYDREAM FILM SCREENING +
 * FILMMAKER TALK WITH …` — so everything from the words `film screening` on is
 * programme description. The museum's own capitalisation is kept: `ASCO` and
 * `THEYDREAM` are titles no case rule could rebuild.
 */
export function filmFromRubyCityTitle(title: string): string | null {
  const trimmed = decode(title);

  // A leading label names the film after itself; a trailing one, before itself.
  // `SCREENING — PARIS IS BURNING` is the leading case with a dash for a colon.
  const leading = LEADING_LABEL.exec(trimmed);
  const trailing = TRAILING_LABEL.exec(trimmed);
  const named =
    leading !== null
      ? trimmed.slice(leading[0].length)
      : trailing?.index !== undefined && trailing.index > 0
        ? trimmed.slice(0, trailing.index)
        : trailing?.index === 0
          ? trimmed.slice(trailing[0].length).replace(/^\s*[:—–-]\s*/, '')
          : trimmed;

  // Only a naming separator hands over a film; `FILM SCREENING + ARTIST TALK`
  // billed a talk after the screening and never said what was screened.
  if (/^\s*[+|]/.test(named)) return null;

  const film = (named.split(/\s+[+|]\s+/)[0] ?? '')
    // `FILM SCREENING (TBA)` announced a screening and named nothing.
    .replace(/[([{"']?\b(tbd|tba|to be announced)\b[)\]}"']?/i, '')
    .replace(/[\s:,–—-]+$/, '')
    .trim();
  if (!film || PLACEHOLDER.test(film)) return null;
  return film;
}
