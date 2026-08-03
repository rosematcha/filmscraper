import { classifyAmenity } from './amenities.js';
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
 * Build the Notes cell for one movie.
 *
 * Clause order is formats, then the scarcity clause. The scarcity clause folds
 * dates and venues together — "August 5 only at Alamo Quarry" rather than
 * repeating the venue in two separate notes.
 */
export function buildNotes(
  movie: AggregatedMovie,
  windowDates: readonly IsoDate[],
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

  // --- scarcity: dates and venues -----------------------------------------
  const playsEveryDay = windowDates.every((d) => movie.dates.includes(d));
  const limitedVenues = movie.theaters.length <= NAMED_THEATER_LIMIT;
  const venueList = humanList(movie.theaters.map(short));

  let dateClause: string | null = null;
  if (!playsEveryDay && movie.dates.length > 0) {
    dateClause =
      movie.dates.length === 1
        ? `${monthDay(movie.dates[0] ?? '')} only`
        : `${humanList(movie.dates.map(weekdayName))} only`;
  }

  if (dateClause && limitedVenues) clauses.push(`${dateClause} at ${venueList}`);
  else if (dateClause) clauses.push(dateClause);
  else if (limitedVenues) clauses.push(`only at ${venueList}`);

  const joined = clauses.join(', ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}
