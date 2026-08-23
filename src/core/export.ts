import { aggregate, type AliasConfig } from './aggregate.js';
import { classifyAmenity } from './amenities.js';
import { chainLabel, chainOf } from './chains.js';
import type { Dataset } from './dataset.js';
import type { Admission } from './admission.js';
import type { IsoDate, MovieListing, Showtime, ShowtimeGroup, Theater, VenueDay } from './types.js';

/** Version of the public JSON shape — distinct from the internal dataset version. */
export const PUBLIC_EXPORT_VERSION = 1;

const FANDANGO = 'https://www.fandango.com';

export type ExportMode = 'full' | 'truncated';

export interface ExportOptions {
  readonly mode: ExportMode;
  readonly aliases: AliasConfig;
  /** IANA zone for deciding which calendar day is "today". */
  readonly timezone: string;
}

export interface PublicTheater {
  readonly id: string;
  readonly name: string;
  readonly shortName?: string;
  readonly chain: string;
  readonly chainLabel: string;
  readonly href?: string;
  readonly distanceMiles: number;
  readonly address?: string;
  readonly location?: { lat: number; lon: number };
  readonly source: string;
}

export interface PublicShowing {
  readonly theaterId: string;
  readonly date: IsoDate;
  /** Venue-local display time, or null when the calendar does not publish one. */
  readonly time: string | null;
  readonly format?: string;
  readonly amenities?: string[];
  readonly admission?: Admission;
  readonly source: string;
  /** Present only in the full export. */
  readonly expired?: boolean;
}

export interface PublicFilm {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly releaseYear: number | null;
  readonly showings: readonly PublicShowing[];
}

export interface PublicExport {
  readonly version: number;
  readonly mode: ExportMode;
  readonly generatedAt: string;
  /** Calendar day in the market timezone when this scrape ran. */
  readonly asOf: IsoDate;
  readonly market: {
    readonly zip: string;
    readonly radiusMiles: number;
    readonly from: IsoDate;
    readonly to: IsoDate;
  };
  readonly posting: {
    readonly horizon: IsoDate;
    readonly knownFrom: IsoDate;
  };
  readonly warnings: Dataset['warnings'];
  readonly sources: Dataset['sources'];
  readonly theaters: readonly PublicTheater[];
  readonly films: readonly PublicFilm[];
}

function pathOf(href: string): string {
  try {
    return new URL(href, FANDANGO).pathname.replace(/\/$/, '');
  } catch {
    return (href.split(/[?#]/)[0] ?? href).replace(/\/$/, '');
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function absoluteHref(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  return `${FANDANGO}${href.startsWith('/') ? href : `/${href}`}`;
}

function theaterId(theater: Theater, sourceId: string): string {
  const match = /^\/([^/]+)\/theater-page/.exec(pathOf(theater.href));
  if (match?.[1]) return match[1];
  return `${sourceId}-${slugify(theater.name)}`;
}

function filmId(href: string, title: string): string {
  const match = /^\/([^/]+)\/movie-overview/.exec(pathOf(href));
  if (match?.[1]) return match[1];
  return slugify(title);
}

function groupFormat(group: ShowtimeGroup): string | null {
  let best: { label: string; rank: number } | null = null;
  for (const amenity of group.amenities) {
    const c = classifyAmenity(amenity);
    if (c.cls !== 'format') continue;
    if (!best || c.rank < best.rank) best = { label: c.label, rank: c.rank };
  }
  if (!best && group.isDolby) return 'Dolby Cinema';
  return best?.label ?? null;
}

function amenityLabels(group: ShowtimeGroup): string[] {
  const labels: string[] = [];
  const format = groupFormat(group);
  for (const amenity of group.amenities) {
    const c = classifyAmenity(amenity);
    if (c.cls === 'comfort' || c.cls === 'plf' || c.cls === 'three-d') continue;
    const label = c.label;
    if (label === format) continue;
    labels.push(label);
  }
  if (group.isDolby && format !== 'Dolby Cinema') labels.push('Dolby Cinema');
  return [...new Set(labels)];
}

function scrapeDayOf(dataset: Dataset, timezone: string): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(dataset.generatedAt));
}

function includeShowing(
  date: IsoDate,
  showtime: Showtime,
  scrapeDay: IsoDate,
  mode: ExportMode,
): boolean {
  if (mode === 'full') return true;
  if (date < scrapeDay) return false;
  return !showtime.expired;
}

interface FilmAccumulator {
  id: string;
  title: string;
  href: string;
  releaseYear: number | null;
  showings: PublicShowing[];
}

interface FilmIdentity {
  readonly id: string;
  readonly title: string;
  readonly href: string;
  readonly releaseYear: number | null;
}

/**
 * Apply the same title, variant, and explicit alias merging as the rendered
 * tables, including listings whose only captured showtimes have expired.
 */
function filmIdentities(dataset: Dataset, aliases: AliasConfig): Map<string, FilmIdentity> {
  const identityDays: VenueDay[] = dataset.days.map((day) => ({
    ...day,
    movies: day.movies.map((movie) => ({
      ...movie,
      groups: movie.groups.map((group) => ({
        ...group,
        showtimes: group.showtimes.map((showtime) => ({ ...showtime, expired: false })),
      })),
    })),
  }));
  const theaterList = [
    ...new Map(identityDays.map((day) => [day.theater.name, day.theater])).values(),
  ];
  const identities = new Map<string, FilmIdentity>();
  for (const film of aggregate(identityDays, theaterList, { aliases, keepYears: true })) {
    const identity = {
      id: filmId(film.href, film.title),
      title: film.title,
      href: absoluteHref(film.href),
      releaseYear: film.releaseYear,
    };
    for (const href of film.mergedHrefs) identities.set(href, identity);
  }
  return identities;
}

/** Minutes after midnight for chronological sorting of Fandango-style times. */
function timeValue(time: string | null): number {
  if (time === null) return Number.POSITIVE_INFINITY;
  const match = /^(\d{1,2}):(\d{2})([ap])$/.exec(time);
  if (!match) return Number.POSITIVE_INFINITY;
  const hour = (Number(match[1]) % 12) + (match[3] === 'p' ? 12 : 0);
  return hour * 60 + Number(match[2]);
}

function compareShowings(a: PublicShowing, b: PublicShowing): number {
  return (
    a.date.localeCompare(b.date) ||
    timeValue(a.time) - timeValue(b.time) ||
    a.theaterId.localeCompare(b.theaterId) ||
    (a.format ?? '').localeCompare(b.format ?? '') ||
    a.source.localeCompare(b.source)
  );
}

function showingKey(showing: PublicShowing): string {
  return JSON.stringify(showing);
}

/**
 * Turn the internal scrape into a film-centric export other tools can read.
 *
 * `truncated` drops past dates and showtimes Fandango already marked expired;
 * `full` keeps everything the scrape captured.
 */
export function exportPublicDataset(dataset: Dataset, options: ExportOptions): PublicExport {
  const scrapeDay = scrapeDayOf(dataset, options.timezone);
  const theaters = new Map<string, PublicTheater>();
  const films = new Map<string, FilmAccumulator>();
  const identities = filmIdentities(dataset, options.aliases);

  for (const day of dataset.days) {
    const sourceId = day.sourceId ?? 'fandango';
    const tid = theaterId(day.theater, sourceId);
    if (!theaters.has(tid)) {
      const chain = chainOf(day.theater.name, sourceId);
      const shortName = options.aliases.theaterNames[day.theater.name];
      theaters.set(tid, {
        id: tid,
        name: day.theater.name,
        ...(shortName ? { shortName } : {}),
        chain,
        chainLabel: chainLabel(chain),
        ...(day.theater.href ? { href: absoluteHref(day.theater.href) } : {}),
        distanceMiles: day.theater.miles,
        ...(day.theater.address ? { address: day.theater.address } : {}),
        ...(day.theater.coords ? { location: day.theater.coords } : {}),
        source: sourceId,
      });
    }

    for (const movie of day.movies) {
      const identity = identities.get(movie.href);
      if (identity) {
        accumulateFilm(films, day, movie, identity, tid, sourceId, scrapeDay, options.mode);
      }
    }
  }

  const filmList = [...films.values()]
    .filter((film) => film.showings.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((film) => ({
      id: film.id,
      title: film.title,
      href: film.href,
      releaseYear: film.releaseYear,
      showings: [
        ...new Map(film.showings.map((showing) => [showingKey(showing), showing])).values(),
      ].sort(compareShowings),
    }));
  const referencedTheaters = new Set(
    filmList.flatMap((film) => film.showings.map((showing) => showing.theaterId)),
  );
  const theaterList = [...theaters.values()]
    .filter((theater) => referencedTheaters.has(theater.id))
    .sort((a, b) => a.distanceMiles - b.distanceMiles || a.name.localeCompare(b.name));

  return {
    version: PUBLIC_EXPORT_VERSION,
    mode: options.mode,
    generatedAt: dataset.generatedAt,
    asOf: scrapeDay,
    market: {
      zip: dataset.zip,
      radiusMiles: dataset.radiusMiles,
      from: dataset.from,
      to: dataset.to,
    },
    posting: {
      horizon: dataset.horizon,
      knownFrom: dataset.knownFrom,
    },
    warnings: dataset.warnings,
    sources: dataset.sources,
    theaters: theaterList,
    films: filmList,
  };
}

function accumulateFilm(
  films: Map<string, FilmAccumulator>,
  day: VenueDay,
  movie: MovieListing,
  identity: FilmIdentity,
  theaterId: string,
  sourceId: string,
  scrapeDay: IsoDate,
  mode: ExportMode,
): void {
  let film = films.get(identity.id);
  if (!film) {
    film = {
      ...identity,
      showings: [],
    };
    films.set(identity.id, film);
  }

  for (const group of movie.groups) {
    const format = groupFormat(group);
    const amenities = amenityLabels(group);
    for (const showtime of group.showtimes) {
      if (!includeShowing(day.date, showtime, scrapeDay, mode)) continue;

      const showing: PublicShowing = {
        theaterId,
        date: day.date,
        time: showtime.time || null,
        ...(format ? { format } : {}),
        ...(amenities.length > 0 ? { amenities } : {}),
        ...(movie.admission ? { admission: movie.admission } : {}),
        source: sourceId,
        ...(mode === 'full' ? { expired: showtime.expired } : {}),
      };
      film.showings.push(showing);
    }
  }
}
