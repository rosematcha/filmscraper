import { classifyAmenity } from './amenities.js';
import type { AggregatedMovie, IsoDate, RenderOptions } from './types.js';

/** At or below this many venues, a note names them instead of counting them. */
export const NAMED_THEATER_LIMIT = 3;

/** Below this many dates, listing the days beats describing a run. */
const MIN_DATES_FOR_RUN = 3;

/** Rank lookup so notes lead with the rarest format. */
function formatRank(label: string): number {
  return classifyAmenity({ id: -1, name: label }).rank;
}

export function shortenTheater(name: string, overrides: Readonly<Record<string, string>>): string {
  const direct = overrides[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(overrides)) {
    if (key.toLowerCase() === lower) return value;
  }
  return name;
}

/** `["a"] -> "a"`, `["a","b"] -> "a and b"`, `["a","b","c"] -> "a, b and c"`. */
export function humanList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  const head = items.slice(0, -1).join(', ');
  return `${head} and ${items.at(-1) ?? ''}`;
}

/** Parsed at noon so a date never slips a day under local timezone rules. */
function atNoon(date: IsoDate): Date {
  return new Date(`${date}T12:00:00`);
}

export function weekdayName(date: IsoDate): string {
  return atNoon(date).toLocaleDateString('en-US', { weekday: 'long' });
}

export function monthDay(date: IsoDate): string {
  return atNoon(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

/** Every date in `[from, to]` inclusive. */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = [];
  const cursor = atNoon(from);
  const end = atNoon(to);
  while (cursor.getTime() <= end.getTime()) {
    const iso = cursor.toISOString().slice(0, 10);
    dates.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/** True when `dates` includes every entry of `range` between `from` and `to` inclusive. */
function coversSpan(
  dates: readonly IsoDate[],
  range: readonly IsoDate[],
  from: IsoDate,
  to: IsoDate,
): boolean {
  return range.filter((d) => d >= from && d <= to).every((d) => dates.includes(d));
}

/**
 * Describe when a movie plays, given how far the posted schedule actually runs.
 *
 * The naive version — "any date in the window it does not play is a gap" —
 * labelled most of the week's releases "Sunday through Thursday only", because
 * Fandango simply has not posted Friday yet. Everything past `horizon` is
 * therefore treated as unknown rather than absent.
 */
export function describeDates(
  playedDates: readonly IsoDate[],
  windowDates: readonly IsoDate[],
  knownFrom: IsoDate,
  horizon: IsoDate,
): string | null {
  if (playedDates.length === 0 || windowDates.length === 0) return null;

  const known = windowDates.filter((d) => d >= knownFrom && d <= horizon);
  const playedKnown = playedDates.filter((d) => d >= knownFrom && d <= horizon);
  const first = playedDates[0] ?? '';

  // Nothing inside the reliable range: a pre-sold future event (or a title whose
  // only showings today have already started), so state its actual dates.
  if (playedKnown.length === 0 || known.length === 0) {
    return playedDates.length === 1
      ? `${monthDay(first)} only`
      : `${humanList(playedDates.map(monthDay))} only`;
  }

  const windowStart = known[0] ?? '';
  const lastKnown = known.at(-1) ?? '';
  const firstKnown = playedKnown[0] ?? '';
  const lastPlayedKnown = playedKnown.at(-1) ?? '';

  // Runs unbroken from its first date to the edge of what we know.
  if (coversSpan(playedKnown, known, firstKnown, lastKnown)) {
    if (firstKnown === windowStart) return null; // plays throughout
    // One listed date that happens to be the last we know about is not evidence
    // of an opening — Willy Wonka's single Wednesday is a one-night event.
    if (playedDates.length === 1) return `${monthDay(first)} only`;
    return `opens ${weekdayOrDate(firstKnown, windowDates)}`;
  }

  // Runs unbroken from the start of the window but stops before the horizon:
  // genuinely ending its engagement, not merely unposted. Only worth phrasing
  // as a run once it spans a few days — a two-night booking reads better
  // enumerated ("Monday and Tuesday only") than as "through Tuesday".
  if (
    playedDates.length >= MIN_DATES_FOR_RUN &&
    firstKnown === windowStart &&
    lastPlayedKnown < lastKnown &&
    coversSpan(playedKnown, known, windowStart, lastPlayedKnown)
  ) {
    return `through ${weekdayOrDate(lastPlayedKnown, windowDates)}`;
  }

  if (playedDates.length === 1) return `${monthDay(first)} only`;
  return `${humanList(playedDates.map((d) => weekdayOrDate(d, windowDates)))} only`;
}

/** Weekdays read better inside a week; longer windows need the date. */
function weekdayOrDate(date: IsoDate, windowDates: readonly IsoDate[]): string {
  return windowDates.length <= 7 ? weekdayName(date) : monthDay(date);
}

/**
 * Build the Notes cell for one movie.
 *
 * Clause order is formats, then the scarcity clause. The scarcity clause folds
 * dates and venues together — "August 5 only at Alamo Quarry" rather than
 * repeating the venue in two separate notes.
 */
export function buildNotes(
  movie: AggregatedMovie,
  windowDates: readonly IsoDate[],
  knownFrom: IsoDate,
  horizon: IsoDate,
  options: RenderOptions,
  theaterNames: Readonly<Record<string, string>>,
): string {
  const short = (n: string): string => shortenTheater(n, theaterNames);
  const allTheaters = new Set(movie.theaters);
  const clauses: string[] = [];

  // --- formats ------------------------------------------------------------
  const formats = [...movie.formats.entries()].sort(
    ([a], [b]) => formatRank(a) - formatRank(b) || a.localeCompare(b),
  );
  for (const [label, venues] of formats) {
    // When a format runs everywhere the movie does, naming venues just repeats
    // the scarcity clause below.
    const coversAll = venues.length === allTheaters.size;
    clauses.push(
      !coversAll && venues.length <= NAMED_THEATER_LIMIT
        ? `${label} at ${humanList(venues.map(short))}`
        : label,
    );
  }

  // --- opt-in accessibility / language ------------------------------------
  if (options.showAccessibility || options.showLanguage) {
    for (const [label, venues] of movie.optional) {
      const cls = classifyAmenity({ id: -1, name: label }).cls;
      const wanted =
        (cls === 'access' && options.showAccessibility) ||
        (cls === 'language' && options.showLanguage);
      if (!wanted) continue;
      clauses.push(
        venues.length <= NAMED_THEATER_LIMIT
          ? `${label} at ${humanList(venues.map(short))}`
          : label,
      );
    }
  }

  // --- language -----------------------------------------------------------
  // Worth stating plainly: a Telugu release with English subtitles is a very
  // different night out from the multiplex default.
  if (movie.foreign) {
    if (movie.languages.length > 0) clauses.push(`in ${humanList([...movie.languages])}`);
    else clauses.push('not in English');
  }

  // --- scarcity: dates and venues -----------------------------------------
  const limitedVenues = movie.theaters.length <= NAMED_THEATER_LIMIT;
  const venueList = humanList(movie.theaters.map(short));
  const dateClause = describeDates(movie.dates, windowDates, knownFrom, horizon);

  if (dateClause && limitedVenues) clauses.push(`${dateClause} at ${venueList}`);
  else if (dateClause) clauses.push(dateClause);
  else if (limitedVenues) clauses.push(`only at ${venueList}`);

  const joined = clauses.join(', ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}
