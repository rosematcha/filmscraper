import { classifyRun, EMPTY_RUN_WINDOW, type RunWindow } from './run.js';
import type { AggregatedMovie } from './types.js';

export const DRIVE_IN_SOURCE = 'stars-and-stripes';
export const LIBRARY_SOURCE = 'sapl';

/** Amenity label the accessibility classifier assigns to open-caption groups. */
export const OPEN_CAPTION_LABEL = 'Open caption';

/**
 * How a table takes its rows.
 *
 * - `claims`     — the film leaves the main table for this one.
 * - `duplicates` — a highlight; the film stays in the main table as well.
 * - `venue`      — everything one venue is showing, and the film leaves the
 *                  main table only when that venue is the sole place it plays.
 */
export type SectionMode = 'claims' | 'duplicates' | 'venue';

export interface SectionContext extends RunWindow {
  /** Year the run is measured against; injected so tests stay stable. */
  readonly currentYear: number;
}

/**
 * One table the output can carry.
 *
 * Order in `SECTIONS` is the order the tables render in, and adding a table is
 * one entry here rather than a field on the options, a branch in the builder
 * and a checkbox in three places.
 */
export interface SectionDef {
  readonly id: string;
  /** Markdown heading. */
  readonly heading: string;
  /** Checklist label, when the heading is too long to be a control. */
  readonly label: string;
  /** One line saying what lands in it, shown beside the checkbox. */
  readonly hint: string;
  readonly mode: SectionMode;
  readonly defaultOn: boolean;
  /**
   * Source whose venues this table is about.
   *
   * A venue asked for by name stops being subject to the radius: the drive-in
   * is thirty miles out and that is not a reason to drop the table you asked
   * for.
   */
  readonly source?: string;
  readonly match: (movie: AggregatedMovie, ctx: SectionContext) => boolean;
  /** Narrow the entry before it is listed, for tables that show a subset of a run. */
  readonly project?: (movie: AggregatedMovie) => AggregatedMovie;
}

/**
 * Titles that announce a one-off booking rather than a run.
 * Mystery and secret screenings carry no amenity marker at all.
 */
const EVENT_TITLE =
  /\b(mystery|secret|anniversary|encore|fest\b|meet-?up|unseen|marathon|double\s+feature|sing-?along|q\s*(&|and)\s*a|fan\s+event|in\s+concert|live\s+in\s+cinemas?)\b/i;

/**
 * A film at least this many years old, playing a short run, is a revival
 * rather than a late leg of its original release.
 */
const REVIVAL_AGE_YEARS = 2;
const REVIVAL_MAX_DATES = 2;

/**
 * Whether this is a special screening rather than a film in release.
 *
 * The strongest signal turns out to be the year: Fandango appends `(2026)` to
 * everything in current release and omits it entirely on catalogue titles, so
 * "Paddington 2" and "The Untouchables" announce themselves. Amenity markers
 * cover Fathom, Q&A and concert broadcasts, and the title pattern catches
 * mystery nights, which carry no marker of any kind.
 */
export function isSpecialEvent(movie: AggregatedMovie, currentYear: number): boolean {
  if (movie.isEvent) return true;
  if (EVENT_TITLE.test(movie.title)) return true;
  if (movie.releaseYear === null) return true;
  return (
    currentYear - movie.releaseYear >= REVIVAL_AGE_YEARS && movie.dates.length <= REVIVAL_MAX_DATES
  );
}

export function hasOpenCaptions(movie: AggregatedMovie): boolean {
  return (movie.optional.get(OPEN_CAPTION_LABEL) ?? []).length > 0;
}

/**
 * The open-caption booking as its own entry.
 *
 * All poodles are dogs: the captioned screenings are a subset of the film's
 * run, so the row is narrowed to the venues and dates that actually carry
 * captions. Reusing the whole film would claim twenty theaters when only two
 * show it captioned. Formats are dropped rather than inherited, since an IMAX
 * booking elsewhere says nothing about the captioned one.
 */
export function openCaptionEntry(movie: AggregatedMovie): AggregatedMovie {
  return {
    ...movie,
    theaters: movie.optional.get(OPEN_CAPTION_LABEL) ?? [],
    dates: movie.optionalDates.get(OPEN_CAPTION_LABEL) ?? [],
    formats: new Map(),
  };
}

/** The free screenings, and only those, as their own entry. */
export function freeEntry(movie: AggregatedMovie): AggregatedMovie {
  return { ...movie, theaters: movie.freeVenues, formats: new Map() };
}

/** True when this source listed the film at all. */
function playsAt(movie: AggregatedMovie, sourceId: string): boolean {
  return movie.sources.includes(sourceId);
}

/**
 * Every table, in render order.
 *
 * The highlights sit directly under the main table: they duplicate rows that
 * are already there, and their whole job is to be seen before the long list is
 * read. The partitions — which actually remove rows — follow.
 */
export const SECTIONS: readonly SectionDef[] = [
  {
    id: 'last-chance',
    heading: 'Last chance',
    label: 'Last chance',
    hint: 'Runs that end before the posted schedule does',
    mode: 'duplicates',
    defaultOn: true,
    match: (movie, ctx) => classifyRun(movie.dates, ctx).shape === 'closing',
  },
  {
    id: 'opens',
    heading: 'Opens this week',
    label: 'Opens this week',
    hint: 'Films that start partway through the window',
    mode: 'duplicates',
    defaultOn: true,
    match: (movie, ctx) => {
      const { shape } = classifyRun(movie.dates, ctx);
      return shape === 'opens' || shape === 'presale-opens';
    },
  },
  {
    id: 'free',
    heading: 'Free screenings',
    label: 'Free screenings',
    hint: 'Venues whose listing says admission is free',
    mode: 'duplicates',
    defaultOn: true,
    match: (movie) => movie.freeVenues.length > 0,
    project: freeEntry,
  },
  {
    id: 'foreign',
    heading: 'Not in English',
    label: 'Not in English',
    hint: 'Releases whose every showing is non-English',
    mode: 'claims',
    defaultOn: true,
    match: (movie) => movie.foreign,
  },
  {
    id: 'events',
    heading: 'Special screenings and events',
    label: 'Special screenings and events',
    hint: 'Revivals, mystery nights and broadcasts',
    mode: 'claims',
    defaultOn: true,
    match: (movie, ctx) => isSpecialEvent(movie, ctx.currentYear),
  },
  {
    id: 'drive-in',
    heading: 'Stars & Stripes Drive-In',
    label: 'Drive-in',
    hint: 'Everything on at the drive-in, radius ignored',
    mode: 'venue',
    defaultOn: true,
    source: DRIVE_IN_SOURCE,
    match: (movie) => playsAt(movie, DRIVE_IN_SOURCE),
  },
  {
    id: 'library',
    heading: 'San Antonio Public Library',
    label: 'Library',
    hint: 'Everything the library is screening, radius ignored',
    mode: 'venue',
    defaultOn: true,
    source: LIBRARY_SOURCE,
    match: (movie) => playsAt(movie, LIBRARY_SOURCE),
  },
  {
    id: 'open-captions',
    heading: 'Open caption screenings',
    label: 'Open captions',
    hint: 'Captioned bookings, narrowed to the venues that carry them',
    mode: 'duplicates',
    defaultOn: false,
    match: hasOpenCaptions,
    project: openCaptionEntry,
  },
];

export const SECTION_BY_ID: ReadonlyMap<string, SectionDef> = new Map(
  SECTIONS.map((section) => [section.id, section]),
);

export const DEFAULT_TABLE_IDS: readonly string[] = SECTIONS.filter((s) => s.defaultOn).map(
  (s) => s.id,
);

export interface SectionOptions {
  /** Ids of the tables to build; anything not listed stays in the main table. */
  readonly tables: readonly string[];
  /** Drop non-English releases from the output entirely. */
  readonly excludeForeign: boolean;
  readonly currentYear: number;
}

export const DEFAULT_SECTION_OPTIONS: SectionOptions = {
  tables: DEFAULT_TABLE_IDS,
  excludeForeign: false,
  currentYear: new Date().getFullYear(),
};

/** Keep only ids that name a real table, preserving the registry's order. */
export function knownTables(ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  return SECTIONS.filter((s) => wanted.has(s.id)).map((s) => s.id);
}

export interface MovieSection {
  readonly id: string;
  /** Markdown heading, omitted for the main table. */
  readonly heading: string | null;
  readonly movies: readonly AggregatedMovie[];
}

/**
 * Sources whose venues are exempt from the radius filter.
 *
 * A venue given its own table is being asked for by name, so how far away it
 * sits stops being a reason to drop it.
 */
export function unfilteredSources(options: SectionOptions): Set<string> {
  const enabled = new Set(options.tables);
  const out = new Set<string>();
  for (const section of SECTIONS) {
    if (section.source && enabled.has(section.id)) out.add(section.source);
  }
  return out;
}

/**
 * Split the aggregated films into the tables the output will carry.
 *
 * A film showing at both a multiplex and the drive-in stays in the main table;
 * only entries that exist *solely* at a broken-out venue move. A `claims` table
 * takes the row outright, and the first one in registry order wins it.
 */
export function buildSections(
  movies: readonly AggregatedMovie[],
  options: SectionOptions,
  window: RunWindow = EMPTY_RUN_WINDOW,
): MovieSection[] {
  const ctx: SectionContext = { ...window, currentYear: options.currentYear };
  const active = SECTIONS.filter((s) => options.tables.includes(s.id));
  const collected = new Map<string, AggregatedMovie[]>(active.map((s) => [s.id, []]));
  const main: AggregatedMovie[] = [];

  for (const movie of movies) {
    if (movie.foreign && options.excludeForeign) continue;

    let claimed = false;
    for (const section of active) {
      // A row belongs to one partition, not to every partition it qualifies
      // for: a revival that is also non-English is listed once, under whichever
      // table comes first.
      if (claimed && section.mode !== 'duplicates') continue;
      if (!section.match(movie, ctx)) continue;
      const entry = section.project ? section.project(movie) : movie;
      collected.get(section.id)?.push(entry);
      // A venue table answers "what is on at the drive-in this week", so it
      // lists everything playing there — including wide releases that also play
      // a multiplex, which keep their place in the main table.
      if (section.mode === 'claims') claimed = true;
      if (section.mode === 'venue' && movie.sources.length === 1) claimed = true;
    }
    if (!claimed) main.push(movie);
  }

  const sections: MovieSection[] = [{ id: 'main', heading: null, movies: main }];
  for (const section of active) {
    const found = collected.get(section.id) ?? [];
    if (found.length > 0) {
      sections.push({ id: section.id, heading: section.heading, movies: found });
    }
  }
  return sections;
}
