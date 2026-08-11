import { buildNotes } from './notes.js';
import { buildSections, DEFAULT_SECTION_OPTIONS, type SectionOptions } from './sections.js';
import { detectFrontier, type RunWindow } from './run.js';
import type { AggregatedMovie, IsoDate, RenderOptions, ScrapeResult } from './types.js';

/**
 * The dates a result can actually speak to.
 *
 * The tables that highlight a closing or opening run need the same posting
 * boundaries the Notes cell respects, or they would call a film "last chance"
 * on the strength of a Friday nobody has published yet. The frontier is
 * derived here because judging one film's absence takes every film's presence.
 */
function runWindow(result: ScrapeResult): RunWindow {
  return {
    windowDates: result.dates,
    knownFrom: result.knownFrom,
    horizon: result.horizon,
    frontier: detectFrontier(
      result.movies.map((m) => m.dates),
      result.dates,
      result.knownFrom,
      result.horizon,
    ),
  };
}

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
  href: string = movie.href,
): string {
  const base = href.startsWith('http') ? href : `${SITE}${href}`;
  if (movie.dates.length === 0) return base;
  // Only deep-link when the film misses a date we actually have data for;
  // an unposted Friday is not a reason to pin the link to a day.
  const known = windowDates.filter((d) => d >= knownFrom && d <= horizon);
  const missesKnownDate = known.some((d) => !movie.dates.includes(d));
  if (!missesKnownDate) return base;
  // Event links from other sources already carry a query string.
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}date=${movie.dates[0] ?? ''}`;
}

/** A rendered ticket link: operator name and the absolute URL to buy from. */
export interface RenderedLink {
  readonly label: string;
  readonly url: string;
}

export interface SortedMovie {
  readonly movie: AggregatedMovie;
  readonly notes: string;
  readonly url: string;
  /**
   * Per-operator links, when one row covers listings that sell separately.
   * Empty for ordinary films, where `url` is the whole story.
   */
  readonly links: readonly RenderedLink[];
  readonly section?: string;
  readonly sectionHeading?: string | null;
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

function toRow(
  movie: AggregatedMovie,
  result: ScrapeResult,
  options: RenderOptions,
  theaterNames: Readonly<Record<string, string>>,
  frontier: IsoDate,
): SortedMovie {
  return {
    movie,
    notes: buildNotes(movie, result.dates, result.knownFrom, result.horizon, options, theaterNames, frontier),
    url: movieUrl(movie, result.dates, result.knownFrom, result.horizon),
    links: movie.ticketLinks.map((link) => ({
      label: link.label,
      url: movieUrl(movie, result.dates, result.knownFrom, result.horizon, link.href),
    })),
  };
}

/** The Link cell: one "Showtimes" link, or a link per operator when they differ. */
export function linkCell(row: SortedMovie): string {
  if (row.links.length === 0) return `[Showtimes](${row.url})`;
  return row.links.map((link) => `[${cell(link.label)}](${link.url})`).join(' · ');
}

export function renderRows(
  result: ScrapeResult,
  options: RenderOptions,
  theaterNames: Readonly<Record<string, string>>,
  sectionOptions: SectionOptions = DEFAULT_SECTION_OPTIONS,
): SortedMovie[] {
  const window = runWindow(result);
  return buildSections(result.movies, sectionOptions, window).flatMap((section) =>
    sortMovies(section.movies).map((movie) => ({
      ...toRow(movie, result, options, theaterNames, window.frontier ?? result.horizon),
      section: section.id,
      sectionHeading: section.heading,
    })),
  );
}

const HEADER = ['| Movie | Link | Notes |', '|-------|------|-------|'];

export function renderMarkdown(
  result: ScrapeResult,
  options: RenderOptions,
  theaterNames: Readonly<Record<string, string>>,
  sectionOptions: SectionOptions = DEFAULT_SECTION_OPTIONS,
): string {
  const blocks: string[] = [];
  const window = runWindow(result);
  for (const section of buildSections(result.movies, sectionOptions, window)) {
    if (section.movies.length === 0) continue;
    const lines = section.heading ? [`### ${section.heading}`, '', ...HEADER] : [...HEADER];
    for (const movie of sortMovies(section.movies)) {
      const row = toRow(movie, result, options, theaterNames, window.frontier ?? result.horizon);
      lines.push(`| ${cell(movie.title)} | ${linkCell(row)} | ${cell(row.notes)} |`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

/** Warnings rendered beneath the table so a thin result is never mistaken for a complete one. */
export function renderWarnings(result: ScrapeResult): string {
  if (result.warnings.length === 0) return '';
  return result.warnings.map((w) => `> **Note:** ${w.message}`).join('\n>\n');
}
