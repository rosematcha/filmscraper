import { humanList, weekdayOrDate } from './notes.js';
import type { AggregatedMovie, IsoDate, Showing } from './types.js';

/**
 * The cell beside a film in the day and venue views.
 *
 * Both views answer a narrower question than the film table — "what is on
 * tonight", "what is on at Park North" — so the detail is the times, not the
 * run. Past a few venues or a few times the cell counts instead of listing.
 */

/** Below this many venues on a day, each is named with its times. */
const NAMED_VENUES = 3;
/** Past this many times at one venue, the venue is named without them. */
const NAMED_TIMES = 4;

interface VenueTimes {
  readonly theater: string;
  readonly times: readonly string[];
}

/** Times pooled per venue for one date, format variants folded together. */
function venuesOn(showings: readonly Showing[], date: IsoDate): VenueTimes[] {
  const byTheater = new Map<string, Set<string>>();
  for (const showing of showings) {
    if (showing.date !== date) continue;
    const times = byTheater.get(showing.theater) ?? new Set<string>();
    for (const time of showing.times) times.add(time);
    byTheater.set(showing.theater, times);
  }
  return [...byTheater].map(([theater, times]) => ({ theater, times: [...times] }));
}

function timesOf(venue: VenueTimes): string {
  if (venue.times.length === 0) return '';
  if (venue.times.length > NAMED_TIMES) return `${String(venue.times.length)} showings`;
  return venue.times.join(', ');
}

/**
 * What a film is doing on one date: "7:00p at Park North, 9:15p at Stone
 * Oak", or "12 theaters" when it is everywhere.
 */
export function dayDetail(
  movie: AggregatedMovie,
  date: IsoDate,
  short: (name: string) => string,
): string {
  const venues = venuesOn(movie.showings, date);
  if (venues.length === 0) return '';
  if (venues.length > NAMED_VENUES) {
    return `${String(venues.length)} theater${venues.length === 1 ? '' : 's'}`;
  }
  return venues
    .map((venue) => {
      const times = timesOf(venue);
      return times === '' ? short(venue.theater) : `${times} at ${short(venue.theater)}`;
    })
    .join(', ');
}

/** Below this many dates at a venue, each is named with its times. */
const NAMED_DATES = 3;

/**
 * What a film is doing at one venue across the window: "Wednesday 7:00p,
 * Saturday 2:00p" for a short booking, "daily" or "Wednesday through Sunday"
 * for a run.
 */
export function venueDetail(
  movie: AggregatedMovie,
  theater: string,
  windowDates: readonly IsoDate[],
): string {
  const dates = [
    ...new Set(movie.showings.filter((s) => s.theater === theater).map((s) => s.date)),
  ].sort();
  if (dates.length === 0) return '';
  const day = (d: IsoDate): string => weekdayOrDate(d, windowDates);
  if (dates.length <= NAMED_DATES) {
    return dates
      .map((date) => {
        const [venue] = venuesOn(
          movie.showings.filter((s) => s.theater === theater),
          date,
        );
        const times = venue ? timesOf(venue) : '';
        return times === '' ? day(date) : `${day(date)} ${times}`;
      })
      .join(', ');
  }
  const inWindow = windowDates.filter((d) => d >= (dates[0] ?? '') && d <= (dates.at(-1) ?? ''));
  const unbroken = inWindow.every((d) => dates.includes(d));
  if (unbroken && dates.length === windowDates.length) return 'daily';
  if (unbroken) return `${day(dates[0] ?? '')} through ${day(dates.at(-1) ?? '')}`;
  return humanList(dates.map(day));
}
