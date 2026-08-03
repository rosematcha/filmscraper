import type { AggregatedMovie } from './types.js';

/** How foreign-language releases are treated in the output. */
export type ForeignMode = 'inline' | 'separate' | 'exclude';

export interface SectionOptions {
  /** Give the drive-in its own table, and ignore the radius for it. */
  readonly separateDriveIn: boolean;
  /** Give library screenings their own table, and ignore the radius for them. */
  readonly separateLibrary: boolean;
  /** Split revivals, mystery nights and event broadcasts into their own table. */
  readonly separateEvents: boolean;
  /**
   * List open-caption screenings in their own table.
   *
   * Unlike the other splits this one duplicates: a film shown with open
   * captions at one venue still belongs in the main table for its ordinary
   * screenings.
   */
  readonly separateOpenCaptions: boolean;
  readonly foreign: ForeignMode;
  /** Year the run is measured against; injected so tests stay stable. */
  readonly currentYear: number;
}

export const DEFAULT_SECTION_OPTIONS: SectionOptions = {
  separateDriveIn: true,
  separateLibrary: true,
  separateEvents: true,
  separateOpenCaptions: false,
  foreign: 'separate',
  currentYear: new Date().getFullYear(),
};

/** Amenity label the accessibility classifier assigns to open-caption groups. */
export const OPEN_CAPTION_LABEL = 'Open caption';

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
    optional: new Map(),
    optionalDates: new Map(),
  };
}

export const DRIVE_IN_SOURCE = 'stars-and-stripes';
export const LIBRARY_SOURCE = 'sapl';

export interface MovieSection {
  readonly id: string;
  /** Markdown heading, omitted for the main table. */
  readonly heading: string | null;
  readonly movies: readonly AggregatedMovie[];
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
    currentYear - movie.releaseYear >= REVIVAL_AGE_YEARS &&
    movie.dates.length <= REVIVAL_MAX_DATES
  );
}

/** True when this source listed the film at all. */
function playsAt(movie: AggregatedMovie, sourceId: string): boolean {
  return movie.sources.includes(sourceId);
}

/** True when this source is the *only* place the film plays. */
function onlyFrom(movie: AggregatedMovie, sourceId: string): boolean {
  return movie.sources.length === 1 && movie.sources[0] === sourceId;
}

/**
 * Sources whose venues are exempt from the radius filter.
 *
 * A venue given its own table is being asked for by name, so how far away it
 * sits stops being a reason to drop it.
 */
export function unfilteredSources(options: SectionOptions): Set<string> {
  const out = new Set<string>();
  if (options.separateDriveIn) out.add(DRIVE_IN_SOURCE);
  if (options.separateLibrary) out.add(LIBRARY_SOURCE);
  return out;
}

/**
 * Split the aggregated films into the tables the output will carry.
 *
 * A film showing at both a multiplex and the drive-in stays in the main table;
 * only entries that exist *solely* at a broken-out venue move.
 */
export function buildSections(
  movies: readonly AggregatedMovie[],
  options: SectionOptions,
): MovieSection[] {
  const main: AggregatedMovie[] = [];
  const driveIn: AggregatedMovie[] = [];
  const library: AggregatedMovie[] = [];
  const foreign: AggregatedMovie[] = [];
  const events: AggregatedMovie[] = [];
  const openCaptions: AggregatedMovie[] = [];

  for (const movie of movies) {
    if (movie.foreign && options.foreign === 'exclude') continue;

    // A venue table answers "what is on at the drive-in this week", so it lists
    // everything playing there. A wide release also showing at a multiplex
    // appears in both tables rather than being pulled out of the main one.
    if (options.separateDriveIn && playsAt(movie, DRIVE_IN_SOURCE)) driveIn.push(movie);
    if (options.separateLibrary && playsAt(movie, LIBRARY_SOURCE)) library.push(movie);
    if (options.separateOpenCaptions && hasOpenCaptions(movie)) {
      openCaptions.push(openCaptionEntry(movie));
    }

    // Films exclusive to a broken-out venue have no business in the main table.
    if (options.separateDriveIn && onlyFrom(movie, DRIVE_IN_SOURCE)) continue;
    if (options.separateLibrary && onlyFrom(movie, LIBRARY_SOURCE)) continue;

    if (movie.foreign && options.foreign === 'separate') {
      foreign.push(movie);
      continue;
    }
    if (options.separateEvents && isSpecialEvent(movie, options.currentYear)) {
      events.push(movie);
      continue;
    }
    main.push(movie);
  }

  const sections: MovieSection[] = [{ id: 'main', heading: null, movies: main }];
  if (foreign.length > 0) {
    sections.push({ id: 'foreign', heading: 'Not in English', movies: foreign });
  }
  if (events.length > 0) {
    sections.push({ id: 'events', heading: 'Special screenings and events', movies: events });
  }
  if (driveIn.length > 0) {
    sections.push({ id: 'drive-in', heading: 'Stars & Stripes Drive-In', movies: driveIn });
  }
  if (library.length > 0) {
    sections.push({ id: 'library', heading: 'San Antonio Public Library', movies: library });
  }
  if (openCaptions.length > 0) {
    sections.push({ id: 'open-captions', heading: 'Open caption screenings', movies: openCaptions });
  }
  return sections;
}
