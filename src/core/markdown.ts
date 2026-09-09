import { buildNotes, humanList, monthDay, shortenTheater, weekdayAndDate } from './notes.js';
import {
  buildSections,
  DEFAULT_SECTION_OPTIONS,
  NAMED_THEATER_LIMIT_FOR_UPCOMING,
  SECTION_BY_ID,
  WIDE_THEATER_FLOOR,
  type SectionOptions,
} from './sections.js';
import { detectFrontier, type RunWindow } from './run.js';
import type { AggregatedMovie, IsoDate, RenderOptions, ScrapeResult, SortOrder } from './types.js';

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
 *
 * The alternatives drop the tiers entirely: asking for alphabetical or for
 * what plays soonest is asking to find one row, not to read the column in
 * order, and a tier boundary in the middle of that only hides things.
 */
export function sortMovies(
  movies: readonly AggregatedMovie[],
  order: SortOrder = 'reach',
): AggregatedMovie[] {
  const byTitle = (a: AggregatedMovie, b: AggregatedMovie): number =>
    a.title.localeCompare(b.title);
  if (order === 'title') return [...movies].sort(byTitle);
  if (order === 'soonest') {
    return [...movies].sort(
      (a, b) =>
        (a.dates[0] ?? '').localeCompare(b.dates[0] ?? '') ||
        b.theaters.length - a.theaters.length ||
        byTitle(a, b),
    );
  }
  return [...movies].sort(
    (a, b) =>
      tierOf(a) - tierOf(b) ||
      b.theaters.length - a.theaters.length ||
      b.dates.length - a.dates.length ||
      byTitle(a, b),
  );
}

/**
 * The order a given table is read in.
 *
 * `reach` is the default and means "whatever this table reads best in": a
 * list of one-nighters by date, the wide releases by reach. Any other choice
 * is the reader asking for that order everywhere.
 */
export function sectionOrder(sectionId: string, requested: SortOrder | undefined): SortOrder {
  const preferred = SECTION_BY_ID.get(sectionId)?.order;
  if (requested === undefined || requested === 'reach') return preferred ?? 'reach';
  return requested;
}

/**
 * "Opens Friday, September 18 at Park North": the note for a film with no
 * date inside the window. The weekday is spelled out because nothing else on
 * the page gives the reader its context.
 */
export function upcomingNotes(
  movie: AggregatedMovie,
  theaterNames: Readonly<Record<string, string>>,
): string {
  const first = movie.dates[0];
  if (first === undefined) return '';
  const short = (n: string): string => shortenTheater(n, theaterNames);
  const where =
    movie.theaters.length <= NAMED_THEATER_LIMIT_FOR_UPCOMING
      ? ` at ${humanList(movie.theaters.map(short))}`
      : '';
  const single = movie.dates.length === 1 ? ' only' : '';
  return `${weekdayAndDate(first)}${single}${where}`;
}

function toRow(
  movie: AggregatedMovie,
  result: ScrapeResult,
  options: RenderOptions,
  theaterNames: Readonly<Record<string, string>>,
  window: RunWindow,
  upcoming: boolean,
): SortedMovie {
  const frontier = window.frontier ?? result.horizon;
  const extras = {
    firstDate: result.firstDates?.get(movie.key) ?? null,
    watchedSince: result.watchedSince ?? null,
  };
  const notes = upcoming
    ? upcomingNotes(movie, theaterNames)
    : buildNotes(
        movie,
        result.dates,
        result.knownFrom,
        result.horizon,
        options,
        theaterNames,
        frontier,
        extras,
      );
  return {
    movie,
    notes,
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

/** Sections with their rows already built and ordered. */
function renderSections(
  result: ScrapeResult,
  options: RenderOptions,
  theaterNames: Readonly<Record<string, string>>,
  sectionOptions: SectionOptions,
): { id: string; heading: string | null; rows: SortedMovie[] }[] {
  const window = runWindow(result);
  const firstDateOf = (movie: AggregatedMovie): IsoDate | null =>
    result.firstDates?.get(movie.key) ?? null;
  const sections = buildSections(result.movies, sectionOptions, window, {
    ...(result.upcoming ? { upcoming: result.upcoming } : {}),
    ...(result.firstDates ? { firstDateOf } : {}),
    watchedSince: result.watchedSince ?? null,
  });
  return sections.map((section) => {
    const upcoming = SECTION_BY_ID.get(section.id)?.mode === 'upcoming';
    const order = sectionOrder(section.id, options.sort);
    return {
      id: section.id,
      heading: section.heading,
      rows: sortMovies(section.movies, order).map((movie) => ({
        ...toRow(movie, result, options, theaterNames, window, upcoming),
        section: section.id,
        sectionHeading: section.heading,
      })),
    };
  });
}

export function renderRows(
  result: ScrapeResult,
  options: RenderOptions,
  theaterNames: Readonly<Record<string, string>>,
  sectionOptions: SectionOptions = DEFAULT_SECTION_OPTIONS,
): SortedMovie[] {
  return renderSections(result, options, theaterNames, sectionOptions).flatMap((s) => s.rows);
}

const HEADER = ['| Movie | Link | Notes |', '|-------|------|-------|'];

export function renderMarkdown(
  result: ScrapeResult,
  options: RenderOptions,
  theaterNames: Readonly<Record<string, string>>,
  sectionOptions: SectionOptions = DEFAULT_SECTION_OPTIONS,
): string {
  const blocks: string[] = [];
  for (const section of renderSections(result, options, theaterNames, sectionOptions)) {
    if (section.rows.length === 0) continue;
    const lines = section.heading ? [`### ${section.heading}`, '', ...HEADER] : [...HEADER];
    for (const row of section.rows) {
      lines.push(`| ${cell(row.movie.title)} | ${linkCell(row)} | ${cell(row.notes)} |`);
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

/** Re-exported so the site can phrase a date the way the notes do. */
export { monthDay };
