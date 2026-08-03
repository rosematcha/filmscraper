export interface Coords {
  readonly lat: number;
  readonly lon: number;
}

const EARTH_RADIUS_MILES = 3958.7613;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in miles. Straight-line, not driving. */
export function haversineMiles(a: Coords, b: Coords): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(s));
}

/** A US ZIP, or null if the string holds none. */
export function postalCodeFrom(address: string): string | null {
  return /\b(\d{5})(?:-\d{4})?\b\s*$/.exec(address.trim())?.[1] ?? null;
}
