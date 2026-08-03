import type { Coords } from '../../core/geo.js';
import { DiskCache } from '../../net/cache.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const theaterCache = new DiskCache('theater-geo');
const zipCache = new DiskCache('zip-centroid');

const LD_JSON = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/;

function coordsFromLd(html: string): Coords | null {
  const raw = LD_JSON.exec(html)?.[1];
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw.trim());
    const geo = (parsed as { geo?: { latitude?: unknown; longitude?: unknown } }).geo;
    const lat = Number(geo?.latitude);
    const lon = Number(geo?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

/**
 * A theater's coordinates, from the JSON-LD its own page carries.
 *
 * Plain HTTP — no browser needed, since this block is server-rendered — and
 * cached forever, because theaters do not move.
 */
export async function theaterCoords(href: string): Promise<Coords | null> {
  return theaterCache.wrap(href, async () => {
    try {
      const response = await fetch(`https://www.fandango.com${href}`, {
        headers: { 'User-Agent': UA },
        redirect: 'follow',
      });
      if (!response.ok) return null;
      return coordsFromLd(await response.text());
    } catch {
      return null;
    }
  });
}

/**
 * Centroid of a US ZIP code.
 *
 * Needed only to measure theaters that a different ZIP seed discovered, whose
 * reported mileage is relative to that seed rather than to the search origin.
 */
export async function zipCentroid(zip: string): Promise<Coords | null> {
  return zipCache.wrap(zip, async () => {
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
