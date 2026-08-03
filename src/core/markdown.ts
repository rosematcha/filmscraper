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
export function movieUrl(movie: AggregatedMovie, windowDates: readonly IsoDate[]): string {
  const playsEveryDay = windowDates.every((d) => movie.dates.includes(d));
  const base = movie.href.startsWith('http') ? movie.href : `${SITE}${movie.href}`;
  if (playsEveryDay || movie.dates.length === 0) return base;
  return `${base}?date=${movie.dates[0] ?? ''}`;
}

export interface SortedMovie {
  readonly movie: AggregatedMovie;
  readonly notes: string;
  readonly url: string;
}

/**
 * Widest release first, so the table opens with what most people are looking
 * for and tapers into the repertory oddities.
 */
export function sortMovies(movies: readonly AggregatedMovie[]): AggregatedMovie[] {
  return [...movies].sort(
    (a, b) =>
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
    notes: buildNotes(movie, result.dates, options, theaterNames),
    url: movieUrl(movie, result.dates),
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
