import { haversineMiles, postalCodeFrom, type Coords } from '../../core/geo.js';
import type { Theater, VenueDay } from '../../core/types.js';
import { theaterCoords, zipCentroid } from './geo.js';

/** Fandango returns at most this many theaters for any one ZIP, across all pages. */
export const THEATERS_PER_ZIP_CAP = 20;

/** Stop expanding after this many ZIP seeds, however wide the radius. */
const MAX_SEEDS = 6;

/**
 * Whether a seed's results were cut short by Fandango's cap.
 *
 * The cap only matters when the furthest theater it returned is still inside
 * the radius — that means there were more to give and we never saw them.
 */
export function isCapped(theaters: readonly Theater[], radiusMiles: number): boolean {
  if (theaters.length < THEATERS_PER_ZIP_CAP) return false;
  const furthest = Math.max(...theaters.map((t) => t.miles));
  return furthest <= radiusMiles;
}

/**
 * ZIP codes to search next, taken from the addresses of the outermost theaters
 * already found. Using the results themselves to expand keeps this working in
 * any metro without shipping a ZIP database.
 */
export function nextSeeds(
  theaters: readonly Theater[],
  visited: ReadonlySet<string>,
  limit: number,
): string[] {
  const ranked = [...theaters].sort((a, b) => b.miles - a.miles);
  const out: string[] = [];
  for (const theater of ranked) {
    if (out.length >= limit) break;
    const zip = theater.address ? postalCodeFrom(theater.address) : null;
    if (zip && !visited.has(zip) && !out.includes(zip)) out.push(zip);
  }
  return out;
}

export interface SeedPlan {
  /** Every ZIP whose page must be read to cover the radius. */
  readonly seeds: string[];
  /** True when the origin ZIP alone was capped, so extra seeds were needed. */
  readonly expanded: boolean;
}

export function seedBudget(): number {
  return MAX_SEEDS;
}

/**
 * True distance from the search origin, in miles.
 *
 * Fandango reports mileage relative to whichever ZIP page listed the theater,
 * so a venue found via a neighbouring seed carries the wrong number. Its own
 * page has coordinates; the origin ZIP has a centroid.
 */
export async function trueMiles(
  theater: Theater,
  originZip: string,
  foundViaOrigin: boolean,
): Promise<number> {
  if (foundViaOrigin) return theater.miles;
  const [origin, venue] = await Promise.all([zipCentroid(originZip), theaterCoords(theater.href)]);
  if (!origin || !venue) return theater.miles;
  return haversineMiles(origin, venue);
}

/** Coordinate lookups issued at once; they hit a different host to the scrape. */
const GEO_CONCURRENCY = 8;

/**
 * Re-measure every venue-day against the search origin.
 *
 * Distances are resolved once per venue and in parallel. Walking the days in
 * order instead meant one serial HTTP round trip per new theater, which cost
 * over a minute of dead time at the end of a month-long run.
 */
export async function normalizeDistances(
  days: readonly VenueDay[],
  originZip: string,
  originSeedHrefs: ReadonlySet<string>,
): Promise<VenueDay[]> {
  const unique = new Map<string, Theater>();
  for (const day of days) {
    if (!unique.has(day.theater.href)) unique.set(day.theater.href, day.theater);
  }

  const entries = [...unique.entries()];
  const miles = new Map<string, number>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(GEO_CONCURRENCY, entries.length) }, async () => {
      for (;;) {
        const index = next++;
        const entry = entries[index];
        if (entry === undefined) return;
        const [href, theater] = entry;
        miles.set(href, await trueMiles(theater, originZip, originSeedHrefs.has(href)));
      }
    }),
  );

  return days.map((day) => ({
    ...day,
    theater: { ...day.theater, miles: miles.get(day.theater.href) ?? day.theater.miles },
  }));
}

export type { Coords };
