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
 * Stable identity for a venue, independent of the date being listed.
 *
 * Theater hrefs carry the date they were scraped for
 * (`/amc-boerne-11-aaxyz/theater-page?date=2026-08-16`), so using the raw href
 * as an identity makes every venue-day a different venue. That is what let one
 * theater carry several distances at once: the same cinema measured 26.63 mi on
 * the days its coordinates resolved and 9.74 mi — the figure a neighbouring
 * seed ZIP reported — on the days they did not. The radius filter then kept
 * part of a run and dropped the rest, which read as a one-day engagement.
 */
export function venueKey(href: string): string {
  return href.split('?')[0] ?? href;
}

/**
 * Distance from the origin plus the venue's own coordinates.
 *
 * Coordinates are looked up even when Fandango's own mileage is trustworthy,
 * because re-measuring against a different anchor later needs a point, not a
 * distance. The lookups are cached forever — theaters do not move.
 *
 * `originMiles` is what the origin ZIP's own page said, when it listed this
 * venue at all; that number is already relative to the right place. Otherwise
 * the venue is measured from the origin centroid. The last resort — no
 * coordinates and never seen from the origin — is the largest figure any seed
 * reported: a venue missing from the origin's own list is further away than a
 * neighbouring seed makes it look, so overstating is the safer error.
 */
export async function locate(
  theater: Theater,
  originZip: string,
  originMiles: number | undefined,
  fallbackMiles: number,
): Promise<{ miles: number; coords: Coords | null }> {
  const [origin, venue] = await Promise.all([
    zipCentroid(originZip),
    theaterCoords(venueKey(theater.href)),
  ]);
  const measured = origin && venue ? haversineMiles(origin, venue) : null;
  return { miles: originMiles ?? measured ?? fallbackMiles, coords: venue };
}

/** Coordinate lookups issued at once; they hit a different host to the scrape. */
const GEO_CONCURRENCY = 8;

/**
 * Re-measure every venue-day against the search origin.
 *
 * Resolved once per venue — not per venue-day — so a theater carries one
 * distance and one set of coordinates across the whole window, whatever mix of
 * seed pages listed it. Distances are resolved in parallel; walking the days in
 * order instead meant one serial HTTP round trip per new theater, which cost
 * over a minute of dead time at the end of a month-long run.
 *
 * `originSeedMiles` maps a venue key to the mileage the origin ZIP's own pages
 * reported for it.
 */
export async function normalizeDistances(
  days: readonly VenueDay[],
  originZip: string,
  originSeedMiles: ReadonlyMap<string, number>,
): Promise<VenueDay[]> {
  const unique = new Map<string, Theater>();
  const widest = new Map<string, number>();
  for (const day of days) {
    const key = venueKey(day.theater.href);
    if (!unique.has(key)) unique.set(key, day.theater);
    widest.set(key, Math.max(widest.get(key) ?? 0, day.theater.miles));
  }

  const entries = [...unique.entries()];
  const located = new Map<string, { miles: number; coords: Coords | null }>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(GEO_CONCURRENCY, entries.length) }, async () => {
      for (;;) {
        const index = next++;
        const entry = entries[index];
        if (entry === undefined) return;
        const [key, theater] = entry;
        located.set(
          key,
          await locate(
            theater,
            originZip,
            originSeedMiles.get(key),
            widest.get(key) ?? theater.miles,
          ),
        );
      }
    }),
  );

  return days.map((day) => {
    const fix = located.get(venueKey(day.theater.href));
    return {
      ...day,
      theater: {
        ...day.theater,
        miles: fix?.miles ?? day.theater.miles,
        ...(fix?.coords ? { coords: fix.coords } : {}),
      },
    };
  });
}

export type { Coords };
