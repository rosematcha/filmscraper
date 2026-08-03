import type { AggregatedMovie } from './types.js';

/** How foreign-language releases are treated in the output. */
export type ForeignMode = 'inline' | 'separate' | 'exclude';

export interface SectionOptions {
  /** Give the drive-in its own table, and ignore the radius for it. */
  readonly separateDriveIn: boolean;
  /** Give library screenings their own table, and ignore the radius for them. */
  readonly separateLibrary: boolean;
  readonly foreign: ForeignMode;
}

export const DEFAULT_SECTION_OPTIONS: SectionOptions = {
  separateDriveIn: true,
  separateLibrary: true,
  foreign: 'inline',
};

export const DRIVE_IN_SOURCE = 'stars-and-stripes';
export const LIBRARY_SOURCE = 'sapl';

export interface MovieSection {
  readonly id: string;
  /** Markdown heading, omitted for the main table. */
  readonly heading: string | null;
  readonly movies: readonly AggregatedMovie[];
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

  for (const movie of movies) {
    if (movie.foreign && options.foreign === 'exclude') continue;

    // A venue table answers "what is on at the drive-in this week", so it lists
    // everything playing there. A wide release also showing at a multiplex
    // appears in both tables rather than being pulled out of the main one.
    if (options.separateDriveIn && playsAt(movie, DRIVE_IN_SOURCE)) driveIn.push(movie);
    if (options.separateLibrary && playsAt(movie, LIBRARY_SOURCE)) library.push(movie);

    // Films exclusive to a broken-out venue have no business in the main table.
    if (options.separateDriveIn && onlyFrom(movie, DRIVE_IN_SOURCE)) continue;
    if (options.separateLibrary && onlyFrom(movie, LIBRARY_SOURCE)) continue;

    if (movie.foreign && options.foreign === 'separate') {
      foreign.push(movie);
      continue;
    }
    main.push(movie);
  }

  const sections: MovieSection[] = [{ id: 'main', heading: null, movies: main }];
  if (foreign.length > 0) {
    sections.push({ id: 'foreign', heading: 'Not in English', movies: foreign });
  }
  if (driveIn.length > 0) {
    sections.push({ id: 'drive-in', heading: 'Stars & Stripes Drive-In', movies: driveIn });
  }
  if (library.length > 0) {
    sections.push({ id: 'library', heading: 'San Antonio Public Library', movies: library });
  }
  return sections;
}
