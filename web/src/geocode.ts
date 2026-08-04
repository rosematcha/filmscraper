import { geocodeUrl, parseGeocodeResult, type Coords } from '@core/core/geo.js';

/**
 * Anchor lookups, cached in the tab.
 *
 * The deployed site has no server, so the browser calls the geocoder itself.
 * Nominatim asks callers not to hammer it, and the same address is retyped
 * constantly across a session, so answers are kept for the life of the page.
 */
const memo = new Map<string, Coords | null>();

export async function geocodeAnchor(address: string): Promise<Coords | null> {
  const query = address.trim();
  if (query === '') return null;

  const cached = memo.get(query);
  if (cached !== undefined) return cached;

  let coords: Coords | null = null;
  try {
    const url = /^\d{5}$/.test(query)
      ? `https://api.zippopotam.us/us/${query}`
      : geocodeUrl(query);
    const response = await fetch(url);
    if (response.ok) {
      const body: unknown = await response.json();
      coords = /^\d{5}$/.test(query) ? zipCoords(body) : parseGeocodeResult(body);
    }
  } catch {
    coords = null;
  }

  memo.set(query, coords);
  return coords;
}

function zipCoords(body: unknown): Coords | null {
  const place = (body as { places?: { latitude?: string; longitude?: string }[] }).places?.[0];
  const lat = Number(place?.latitude);
  const lon = Number(place?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}
