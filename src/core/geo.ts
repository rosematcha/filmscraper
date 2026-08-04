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

/**
 * Nominatim lookup for a free-text US address.
 *
 * Chosen over the Census geocoder because it answers with `Access-Control-
 * Allow-Origin: *`, which is what lets the deployed site — a static bundle with
 * no server behind it — resolve an anchor at all. The two agree to four decimal
 * places on a street address, well inside what a mileage filter needs.
 */
export function geocodeUrl(address: string): string {
  const params = new URLSearchParams({
    q: address,
    format: 'json',
    limit: '1',
    countrycodes: 'us',
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

/** First result's coordinates from a Nominatim response, or null. */
export function parseGeocodeResult(body: unknown): Coords | null {
  if (!Array.isArray(body)) return null;
  const first = body[0] as { lat?: unknown; lon?: unknown } | undefined;
  const lat = Number(first?.lat);
  const lon = Number(first?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/** A US ZIP, or null if the string holds none. */
export function postalCodeFrom(address: string): string | null {
  return /\b(\d{5})(?:-\d{4})?\b\s*$/.exec(address.trim())?.[1] ?? null;
}
