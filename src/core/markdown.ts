import { buildNotes } from './notes.js';
import type { AggregatedMovie, IsoDate, RenderOptions, ScrapeResult } from './types.js';

const SITE = 'https://www.fandango.com';

/** Escape the pipe so a title containing one cannot break the table. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').trim();
}

/**
 * Deep-link to a specific date only when the movie plays part of the window —
 * a link to "today" is redundant when it plays every day anyway.
 */
export function movieUrl(
  movie: AggregatedMovie,
  windowDates: readonly IsoDate[],
  knownFrom: IsoDate,
  horizon: IsoDate,
): string {
  const base = movie.href.startsWith('http') ? movie.href : `${SITE}${movie.href}`;
  if (movie.dates.length === 0) return base;
  // Only deep-link when the film misses a date we actually have data for;
  // an unposted Friday is not a reason to pin the link to a day.
  const known = windowDates.filter((d) => d >= knownFrom && d <= horizon);
  const missesKnownDate = known.some((d) => !movie.dates.includes(d));
  if (!missesKnownDate) return base;
  return `${base}?date=${movie.dates[0] ?? ''}`;
}

export interface SortedMovie {
  readonly movie: AggregatedMovie;
  readonly notes: string;
  readonly url: string;
}

/** Below this many venues a film reads as a limited run rather than a wide release. */
const WIDE_THEATER_FLOOR = 4;

export type Tier = 0 | 1 | 2;

/**
 * Which band a film belongs to.
 *
 * 0 — wide release, or anything in a rare film format.
 * 1 — limited run, playing several days at a few venues.
 * 2 — one-night screenings and special events.
 *
 * Reach alone buried the interesting rows: over a week, dozens of one-night
 * repertory titles all sort identically at one theater and one day.
 */
export function tierOf(movie: AggregatedMovie): Tier {
  const rare = [...movie.formats.keys()].some((f) => f.includes('70MM') || f === 'ScreenX');
  if (rare) return 0;
  if (movie.dates.length === 1) return 2;
  if (movie.theaters.length >= WIDE_THEATER_FLOOR) return 0;
  return 1;
}

/**
 * Wide releases first, then limited runs, then one-night events — the order the
 * list gets written up in. Within a tier, widest reach leads.
 */
export function sortMovies(movies: readonly AggregatedMovie[]): AggregatedMovie[] {
  return [...movies].sort(
    (a, b) =>
      tierOf(a) - tierOf(b) ||
      b.theaters.length - a.theaters.length ||
      b.dates.length - a.dates.length ||
      a.title.localeCompare(b.title),
  );
}

export function renderRows(
  result: ScrapeResult,
  options: RenderOptions,
  theaterNames: Readonly<Record<string, string>>,
): SortedMovie[] {
  return sortMovies(result.movies).map((movie) => ({
    movie,
    notes: buildNotes(movie, result.dates, result.knownFrom, result.horizon, options, theaterNames),
    url: movieUrl(movie, result.dates, result.knownFrom, result.horizon),
  }));
}

export function renderMarkdown(
  result: ScrapeResult,
  options: RenderOptions,
  theaterNames: Readonly<Record<string, string>>,
): string {
  const rows = renderRows(result, options, theaterNames);
  const lines = ['| Movie | Link | Notes |', '|-------|------|-------|'];
  for (const row of rows) {
    lines.push(`| ${cell(row.movie.title)} | [Showtimes](${row.url}) | ${cell(row.notes)} |`);
  }
  return lines.join('\n');
}

/** Warnings rendered beneath the table so a thin result is never mistaken for a complete one. */
export function renderWarnings(result: ScrapeResult): string {
  if (result.warnings.length === 0) return '';
  return result.warnings.map((w) => `> **Note:** ${w.message}`).join('\n>\n');
}
