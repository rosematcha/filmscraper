import { classifyAmenity } from './amenities.js';
import { classifyRun } from './run.js';
import type { AggregatedMovie, IsoDate, RenderOptions } from './types.js';

/** At or below this many venues, a note names them instead of counting them. */
export const NAMED_THEATER_LIMIT = 3;

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

/**
 * Phrase when a movie plays, from the shape of its run.
 *
 * The judgement itself lives in `classifyRun`, because the highlight tables ask
 * the same question and the two must not be able to disagree about whether a
 * film is closing.
 */
export function describeDates(
  playedDates: readonly IsoDate[],
  windowDates: readonly IsoDate[],
  knownFrom: IsoDate,
  horizon: IsoDate,
  frontier: IsoDate = horizon,
): string | null {
  const { shape, date } = classifyRun(playedDates, { windowDates, knownFrom, horizon, frontier });
  const on = date ?? '';
  switch (shape) {
    case 'none':
    case 'throughout':
      return null;
    case 'single':
      return `${monthDay(on)} only`;
    case 'presale-opens':
      return `opens ${monthDay(on)}`;
    case 'opens':
      return `opens ${weekdayOrDate(on, windowDates)}`;
    case 'closing':
      return `through ${weekdayOrDate(on, windowDates)}`;
    case 'listed': {
      // A film with nothing inside the reliable range is a pre-sale with no
      // weekday context around it, so its dates are spelled out in full.
      const inRange = (d: IsoDate): boolean => d >= knownFrom && d <= horizon;
      const reliable = playedDates.some(inRange) && windowDates.some(inRange);
      const label = (d: IsoDate): string => (reliable ? weekdayOrDate(d, windowDates) : monthDay(d));
      return `${humanList(playedDates.map(label))} only`;
    }
  }
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
  frontier: IsoDate = horizon,
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

  // --- admission ----------------------------------------------------------
  // Free is the rarest thing a screening can be in a table of multiplexes, and
  // it is only ever claimed where a listing said so outright.
  if (movie.freeVenues.length > 0) {
    const everywhere = movie.freeVenues.length === allTheaters.size;
    clauses.push(
      !everywhere && movie.freeVenues.length <= NAMED_THEATER_LIMIT
        ? `free at ${humanList(movie.freeVenues.map(short))}`
        : 'free',
    );
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
  const dateClause = describeDates(movie.dates, windowDates, knownFrom, horizon, frontier);

  if (dateClause && limitedVenues) clauses.push(`${dateClause} at ${venueList}`);
  else if (dateClause) clauses.push(dateClause);
  else if (limitedVenues) clauses.push(`only at ${venueList}`);

  const joined = clauses.join(', ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}
