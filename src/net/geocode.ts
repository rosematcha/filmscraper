import type { Coords } from '../core/geo.js';
import { DiskCache } from './cache.js';

const cache = new DiskCache('zip-centroid');

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
