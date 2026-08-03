import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseShowtimesPage } from '../src/sources/fandango/parse.js';
import type { IsoDate, VenueDay } from '../src/core/types.js';

/** Fixtures are stored gzipped to keep full-fidelity markup out of the diff. */
export function fixture(name: string): string {
  const path = new URL(`./fixtures/${name}.html.gz`, import.meta.url);
  return gunzipSync(readFileSync(path)).toString('utf8');
}

/** Parse both captured pages for a date, mirroring what the pager produces. */
export function fixtureVenueDays(date: IsoDate, radiusMiles = 15): VenueDay[] {
  const days: VenueDay[] = [];
  for (const pageNo of [1, 2]) {
    const html = fixture(`zip-78205-${date}-page${pageNo}`);
    days.push(...parseShowtimesPage(html, date));
  }
  return days.filter((d) => d.theater.miles <= radiusMiles);
}

export function findMovie(days: readonly VenueDay[], titleFragment: string) {
  const needle = titleFragment.toLowerCase();
  for (const day of days) {
    for (const movie of day.movies) {
      if (movie.title.toLowerCase().includes(needle)) return { day, movie };
    }
  }
  return null;
}
