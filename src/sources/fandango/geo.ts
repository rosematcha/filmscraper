import type { Coords } from '../../core/geo.js';
import { DiskCache } from '../../net/cache.js';
import { browserHeaders } from '../../net/headers.js';
export { zipCentroid } from '../../net/geocode.js';

const theaterCache = new DiskCache('theater-geo');

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
        headers: browserHeaders(),
        redirect: 'follow',
      });
      if (!response.ok) return null;
      return coordsFromLd(await response.text());
    } catch {
      return null;
    }
  });
}
