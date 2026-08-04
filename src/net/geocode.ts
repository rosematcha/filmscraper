import { geocodeUrl, parseGeocodeResult, type Coords } from '../core/geo.js';
import { DiskCache } from './cache.js';
import { browserHeaders } from './headers.js';

const cache = new DiskCache('zip-centroid');
const addressCache = new DiskCache('address-geo');

/** Nominatim's usage policy asks for an identifying agent on server-side calls. */
const NOMINATIM_AGENT = 'filmscraper/0.1 (https://github.com/reese/filmscraper)';

/**
 * Coordinates for a free-text address, e.g. `1132 W French Pl, 78201`.
 *
 * A bare ZIP is answered from the ZIP service instead: it is exact for the
 * centroid and one dependency lighter.
 */
export async function geocodeAddress(address: string): Promise<Coords | null> {
  const query = address.trim();
  if (query === '') return null;
  if (/^\d{5}$/.test(query)) return zipCentroid(query);

  return addressCache.wrap(query, async () => {
    try {
      const response = await fetch(geocodeUrl(query), {
        headers: { ...browserHeaders('application/json'), 'User-Agent': NOMINATIM_AGENT },
      });
      if (!response.ok) return null;
      return parseGeocodeResult(await response.json());
    } catch {
      return null;
    }
  });
}

/**
 * Centroid of a US ZIP code.
 *
 * Venues outside Fandango report an address rather than a distance, so their
 * ZIP stands in for a coordinate. Accurate to a mile or so, which is well
 * inside the precision a radius filter needs.
 */
export async function zipCentroid(zip: string): Promise<Coords | null> {
  return cache.wrap(zip, async () => {
    try {
      const response = await fetch(`https://api.zippopotam.us/us/${zip}`);
      if (!response.ok) return null;
      const body = (await response.json()) as {
        places?: { latitude?: string; longitude?: string }[];
      };
      const place = body.places?.[0];
      const lat = Number(place?.latitude);
      const lon = Number(place?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon };
    } catch {
      return null;
    }
  });
}
