import { parseHTML } from 'linkedom';
import type {
  Amenity,
  IsoDate,
  MovieListing,
  Showtime,
  ShowtimeGroup,
  Theater,
  VenueDay,
} from '../../core/types.js';
import { venueKey } from './seeds.js';

/**
 * The slice of the DOM this parser touches.
 *
 * linkedom's own types resolve to `any` under `strictTypeChecked`, which would
 * silently disable type checking across every selector call. Declaring the
 * surface explicitly keeps the parser honest.
 */
interface DomElement {
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selectors: string): DomElement | null;
  querySelectorAll(selectors: string): Iterable<DomElement>;
}

interface DomDocument {
  querySelector(selectors: string): DomElement | null;
  querySelectorAll(selectors: string): Iterable<DomElement>;
}

function documentFrom(html: string): DomDocument {
  const { document } = parseHTML(html) as { document: DomDocument };
  return document;
}

/** Shape of the JSON Fandango embeds in each `data-amenity-group` attribute. */
interface RawAmenityGroup {
  readonly amenities?: readonly { readonly id?: unknown; readonly name?: unknown }[];
  readonly isDolby?: unknown;
  readonly movieVariantId?: unknown;
  readonly showtimes?: readonly { readonly date?: unknown; readonly expired?: unknown }[];
}

const SEL = {
  theaterRow: '.shared-showtimes__container',
  theaterLink: '.shared-theater-header__name-link',
  theaterDistance: '.shared-theater-header__distance',
  theaterAddress: '.shared-theater-header__address',
  theaterPageName: '.theater-details-header__heading',
  theaterPageAddress: '.theater-details-header__addy',
  movieBlock: '.shared-movie-showtimes',
  movieTitle: '[class*="movie-title"]',
  movieLink: 'a[href*="/movie-overview"]',
  amenityGroup: '.js-amenity-btn[data-amenity-group]',
} as const;

function parseMovies(container: DomElement | DomDocument): MovieListing[] {
  const movies: MovieListing[] = [];
  for (const block of container.querySelectorAll(SEL.movieBlock)) {
    const movieHref = block.querySelector(SEL.movieLink)?.getAttribute('href') ?? null;
    const title =
      text(block.querySelector(SEL.movieTitle)) || text(block.querySelector(SEL.movieLink));
    if (!movieHref || !title) continue;

    const groups: ShowtimeGroup[] = [];
    for (const button of block.querySelectorAll(SEL.amenityGroup)) {
      const attr = button.getAttribute('data-amenity-group');
      if (!attr) continue;
      const group = parseAmenityGroup(attr);
      if (group) groups.push(group);
    }
    if (groups.length === 0) continue;
    movies.push({ title, href: movieHref, groups });
  }
  return movies;
}

function text(node: DomElement | null | undefined): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** `"14.49 mi"` -> `14.49`. Returns null when the label is missing or unparseable. */
export function parseMiles(label: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*mi/i.exec(label);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseAmenities(raw: RawAmenityGroup): Amenity[] {
  const out: Amenity[] = [];
  for (const a of raw.amenities ?? []) {
    if (typeof a.id !== 'number' || typeof a.name !== 'string') continue;
    out.push({ id: a.id, name: a.name });
  }
  return out;
}

function parseShowtimes(raw: RawAmenityGroup): Showtime[] {
  const out: Showtime[] = [];
  for (const s of raw.showtimes ?? []) {
    if (typeof s.date !== 'string') continue;
    out.push({ time: s.date, expired: s.expired === true });
  }
  return out;
}

/**
 * Read one showtime group out of its `data-amenity-group` attribute.
 *
 * Returns null on malformed JSON rather than throwing: one bad group should
 * cost that group, not the whole scrape.
 */
export function parseAmenityGroup(json: string): ShowtimeGroup | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const group = raw as RawAmenityGroup;
  return {
    amenities: parseAmenities(group),
    isDolby: group.isDolby === true,
    variantId: typeof group.movieVariantId === 'number' ? group.movieVariantId : null,
    showtimes: parseShowtimes(group),
  };
}

/**
 * Parse one rendered `{zip}_movietimes` page into venue-days.
 *
 * The page must already be hydrated and fully scrolled; this function is pure
 * and does no waiting of its own.
 */
export function parseShowtimesPage(
  html: string,
  date: IsoDate,
  fallbackTheater?: Theater,
): VenueDay[] {
  const document = documentFrom(html);
  const days: VenueDay[] = [];

  for (const row of document.querySelectorAll(SEL.theaterRow)) {
    const link = row.querySelector(SEL.theaterLink);
    const name = text(link) || fallbackTheater?.name;
    const rawHref = link?.getAttribute('href') ?? fallbackTheater?.href;
    const href = rawHref ? venueKey(rawHref) : undefined;
    const miles =
      parseMiles(text(row.querySelector(SEL.theaterDistance))) ?? fallbackTheater?.miles ?? null;
    if (!name || !href || miles === null) continue;
    const address = text(row.querySelector(SEL.theaterAddress));

    days.push({
      theater: { name, href, miles, ...(address ? { address } : {}) },
      date,
      movies: parseMovies(row),
    });
  }

  // A direct theater page has the same movie blocks but no surrounding search
  // result row. The requested theater supplies its stable href and distance.
  if (days.length === 0 && fallbackTheater) {
    const name = text(document.querySelector(SEL.theaterPageName));
    // A challenge/error document has neither a result row nor the venue header.
    // Do not turn that into an authoritative empty schedule.
    if (!name) return days;
    const address = text(document.querySelector(SEL.theaterPageAddress));
    days.push({
      theater: {
        ...fallbackTheater,
        name,
        href: venueKey(fallbackTheater.href),
        ...(address ? { address } : {}),
      },
      date,
      movies: parseMovies(document),
    });
  }

  return days;
}

/** Distances present on a page, used to decide whether to request the next page. */
export function pageDistances(html: string): number[] {
  const document = documentFrom(html);
  const out: number[] = [];
  for (const el of document.querySelectorAll(SEL.theaterDistance)) {
    const miles = parseMiles(text(el));
    if (miles !== null) out.push(miles);
  }
  return out;
}
