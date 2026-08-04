import { keepsChain } from './chains.js';
import { haversineMiles, type Coords } from './geo.js';
import type { Theater, VenueDay } from './types.js';

/**
 * Which venues make it into the table, and what distance is measured against.
 *
 * Kept apart from the scrape: the dataset ships every venue-day inside the
 * scraped radius, and both the CLI and the static site narrow it afterwards.
 */
export interface VenueFilter {
  /** Chain ids to drop entirely, from `chains.ts`. */
  readonly excludedChains: ReadonlySet<string>;
  /** Measure distance from here instead of the scrape's ZIP centroid. */
  readonly anchor: Coords | null;
  readonly radiusMiles: number;
  /** Sources exempt from the radius because they get their own table. */
  readonly exemptSources: ReadonlySet<string>;
}

export const NO_VENUE_FILTER: VenueFilter = {
  excludedChains: new Set(),
  anchor: null,
  radiusMiles: Infinity,
  exemptSources: new Set(),
};

/**
 * How wide the scrape must search to cover a radius drawn around the anchor.
 *
 * Sources discover venues outward from the ZIP, so a cinema five miles from the
 * anchor but nine from downtown is never fetched unless the search is widened.
 * Everything within R of the anchor sits within R plus the anchor-to-ZIP
 * distance of the ZIP, so that is the padding — the extra venues are then
 * dropped by the filter.
 */
export function paddedRadius(
  radiusMiles: number,
  anchor: Coords | null,
  origin: Coords | null,
): number {
  if (!anchor || !origin) return radiusMiles;
  return radiusMiles + haversineMiles(anchor, origin);
}

/**
 * Distance from the anchor, or the scraped distance when it cannot be measured.
 *
 * A venue with no coordinates keeps its original mileage rather than being
 * dropped: it is wrong by however far the anchor sits from the ZIP centroid,
 * which is a smaller lie than pretending the venue does not exist.
 */
export function milesFrom(theater: Theater, anchor: Coords | null): number {
  if (!anchor || !theater.coords) return theater.miles;
  return haversineMiles(anchor, theater.coords);
}

/** Venues the anchor could not re-measure, by name. Empty when not anchored. */
export function unanchoredVenues(
  days: readonly VenueDay[],
  anchor: Coords | null,
): string[] {
  if (!anchor) return [];
  const names = new Set<string>();
  for (const day of days) {
    if (!day.theater.coords) names.add(day.theater.name);
  }
  return [...names].sort();
}

/**
 * Apply chain exclusions and the radius, re-measuring against the anchor.
 *
 * Returns venue-days whose `theater.miles` is relative to the anchor, so
 * everything downstream — the distance sort, the Notes column — reads the same
 * number the filter used.
 */
export function applyVenueFilter(
  days: readonly VenueDay[],
  filter: VenueFilter,
): VenueDay[] {
  const out: VenueDay[] = [];
  for (const day of days) {
    if (!keepsChain(day.theater, filter.excludedChains)) continue;
    const miles = milesFrom(day.theater, filter.anchor);
    const exempt = filter.exemptSources.has(day.sourceId ?? 'fandango');
    if (!exempt && miles > filter.radiusMiles) continue;
    out.push(miles === day.theater.miles ? day : { ...day, theater: { ...day.theater, miles } });
  }
  return out;
}
