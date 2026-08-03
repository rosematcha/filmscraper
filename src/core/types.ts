/** An ISO calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** One amenity as Fandango reports it inside `data-amenity-group`. */
export interface Amenity {
  readonly id: number;
  readonly name: string;
}

/** A single listed showtime. */
export interface Showtime {
  /** Display time as Fandango renders it, e.g. `"9:30p"`. */
  readonly time: string;
  /** Fandango marks past showtimes rather than removing them. */
  readonly expired: boolean;
}

/**
 * A block of showtimes sharing one amenity set — Fandango's own grouping,
 * e.g. all the IMAX 70MM times for a movie at a theater on a date.
 */
export interface ShowtimeGroup {
  readonly amenities: readonly Amenity[];
  readonly isDolby: boolean;
  /**
   * Fandango's per-format variant id. Differs from the movie id when a format
   * gets its own listing (3D and 70MM each get one).
   */
  readonly variantId: number | null;
  readonly showtimes: readonly Showtime[];
}

/** A movie as listed at one theater on one date. */
export interface MovieListing {
  /** Title exactly as Fandango renders it, e.g. `"Spider-Man: Brand New Day (2026)"`. */
  readonly title: string;
  /** Site-relative `movie-overview` path, e.g. `/spider-man-…-243819/movie-overview`. */
  readonly href: string;
  readonly groups: readonly ShowtimeGroup[];
}

export interface Theater {
  readonly name: string;
  /** Site-relative `theater-page` path. */
  readonly href: string;
  /** Distance from the search origin in miles. */
  readonly miles: number;
  /** Street address as listed, used to derive extra search seeds. */
  readonly address?: string;
}

/** Everything one venue is showing on one date. */
export interface VenueDay {
  readonly theater: Theater;
  readonly date: IsoDate;
  readonly movies: readonly MovieListing[];
  /** Which Source produced this, for provenance and horizon scoping. */
  readonly sourceId?: string;
}

export interface ScrapeRequest {
  readonly zip: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly radiusMiles: number;
}

export interface RenderOptions {
  /** Surface open/closed caption groups in Notes. Off by default. */
  readonly showAccessibility: boolean;
  /** Surface Spanish dubbed/subtitled/language groups in Notes. Off by default. */
  readonly showLanguage: boolean;
  /** Keep `(2026)`-style years in displayed titles. Off by default. */
  readonly keepYears: boolean;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  showAccessibility: false,
  showLanguage: false,
  keepYears: false,
};

/** One movie aggregated across every theater and date in the window. */
export interface AggregatedMovie {
  /** Stable key used for merging; derived from the normalized title. */
  readonly key: string;
  /** Title chosen for display, after normalization and merging. */
  readonly title: string;
  /** Canonical `movie-overview` path for the entry. */
  readonly href: string;
  /** Every distinct theater name showing it, sorted by distance then name. */
  readonly theaters: readonly string[];
  /** Every distinct date it screens on, ascending. */
  readonly dates: readonly IsoDate[];
  /** Noteworthy format label -> the theaters carrying that format. */
  readonly formats: ReadonlyMap<string, readonly string[]>;
  /** Opt-in amenity label -> theaters, for accessibility/language flags. */
  readonly optional: ReadonlyMap<string, readonly string[]>;
  /** True when any group carried a special-event marker (e.g. Fathom Features). */
  readonly isEvent: boolean;
  /** Every Fandango movie href folded into this entry, including merged variants. */
  readonly mergedHrefs: readonly string[];
}

export interface ScrapeWarning {
  readonly kind: 'expired-today' | 'radius-truncated' | 'page-error' | 'partial-horizon';
  readonly message: string;
}

export interface ProgressUpdate {
  readonly message: string;
  /** 1-based day currently being fetched. */
  readonly step: number;
  /** Total days in the window. */
  readonly total: number;
}

export type ProgressFn = (update: ProgressUpdate) => void;

export interface ScrapeResult {
  readonly request: ScrapeRequest;
  readonly dates: readonly IsoDate[];
  /**
   * Last date whose schedule looks fully posted.
   *
   * Fandango publishes weekly schedules a few days out, so a movie missing
   * after this date has no showtimes *listed* rather than no showtimes. Notes
   * must not read that absence as a limited engagement.
   */
  readonly horizon: IsoDate;
  /**
   * First date whose listings are complete.
   *
   * Today's already-started showtimes are dropped, which would otherwise make
   * a film that has run for weeks look like it opens tomorrow.
   */
  readonly knownFrom: IsoDate;
  readonly theaters: readonly Theater[];
  readonly movies: readonly AggregatedMovie[];
  readonly warnings: readonly ScrapeWarning[];
}
