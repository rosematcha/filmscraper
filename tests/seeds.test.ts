import { describe, expect, it } from 'vitest';
import { haversineMiles, postalCodeFrom } from '../src/core/geo.js';
import {
  isCapped,
  nextSeeds,
  venueKey,
  THEATERS_PER_ZIP_CAP,
} from '../src/sources/fandango/seeds.js';
import type { Theater } from '../src/core/types.js';

const theater = (miles: number, address?: string): Theater => ({
  name: `T${String(miles)}`,
  href: `/t${String(miles)}-aaaaa/theater-page`,
  miles,
  ...(address ? { address } : {}),
});

/** Twenty venues ending at `furthest`, matching Fandango's per-ZIP cap. */
const cappedSet = (furthest: number): Theater[] =>
  Array.from({ length: THEATERS_PER_ZIP_CAP }, (_, i) => theater((furthest / 20) * (i + 1)));

describe('haversineMiles', () => {
  it('matches Fandango’s own mileage for a known pair', () => {
    // 78205 centroid to Alamo Drafthouse Stone Oak; Fandango reports 16.15 mi.
    const miles = haversineMiles({ lat: 29.4237, lon: -98.4925 }, { lat: 29.6395, lon: -98.4842 });
    expect(miles).toBeGreaterThan(14.5);
    expect(miles).toBeLessThan(16.5);
  });

  it('is zero for the same point', () => {
    expect(haversineMiles({ lat: 29.4, lon: -98.5 }, { lat: 29.4, lon: -98.5 })).toBe(0);
  });
});

describe('postalCodeFrom', () => {
  it('reads the ZIP off a listed address', () => {
    expect(postalCodeFrom('17703 IH 10 West, San Antonio, TX 78257')).toBe('78257');
    expect(postalCodeFrom('849 E Commerce St, San Antonio, TX 78205-2802')).toBe('78205');
  });

  it('returns null when there is none', () => {
    expect(postalCodeFrom('San Antonio, TX')).toBeNull();
    // A street number must not be mistaken for a ZIP.
    expect(postalCodeFrom('17703 IH 10 West')).toBeNull();
  });
});

describe('venueKey', () => {
  it('is the same venue on every date', () => {
    const monday = venueKey('/amc-boerne-11-aaxyz/theater-page?date=2026-08-16');
    const tuesday = venueKey('/amc-boerne-11-aaxyz/theater-page?date=2026-08-17');
    expect(monday).toBe('/amc-boerne-11-aaxyz/theater-page');
    expect(tuesday).toBe(monday);
  });

  it('leaves a bare theater path alone', () => {
    expect(venueKey('/amc-boerne-11-aaxyz/theater-page')).toBe('/amc-boerne-11-aaxyz/theater-page');
  });

  it('keys absolute and dated URLs to the same theater page', () => {
    expect(
      venueKey(
        'https://www.fandango.com/amc-boerne-11-aaxyz/theater-page/?date=2026-08-16#showtimes',
      ),
    ).toBe('/amc-boerne-11-aaxyz/theater-page');
  });

  it('separates genuinely different venues', () => {
    expect(venueKey('/a-aaxyz/theater-page?date=2026-08-16')).not.toBe(
      venueKey('/b-aaxyz/theater-page?date=2026-08-16'),
    );
  });
});

describe('isCapped', () => {
  it('is true when twenty venues all sit inside the radius', () => {
    // Fandango stops at 20 per ZIP, so a full set inside the radius means more
    // exist that were never returned.
    expect(isCapped(cappedSet(12), 15)).toBe(true);
  });

  it('is false when the list reaches past the radius', () => {
    // 78205 at 15 mi: the 20th venue sits at 16.15 mi, so nothing is missing.
    expect(isCapped(cappedSet(16.15), 15)).toBe(false);
  });

  it('is false when fewer than twenty came back', () => {
    expect(isCapped([theater(1), theater(2)], 15)).toBe(false);
  });
});

describe('nextSeeds', () => {
  const found = [
    theater(2, '1 A St, San Antonio, TX 78205'),
    theater(14, '2 B St, San Antonio, TX 78247'),
    theater(9, '3 C St, San Antonio, TX 78230'),
  ];

  it('expands from the outermost venues first', () => {
    expect(nextSeeds(found, new Set(['78205']), 5)).toEqual(['78247', '78230']);
  });

  it('skips ZIPs already searched', () => {
    expect(nextSeeds(found, new Set(['78205', '78247']), 5)).toEqual(['78230']);
  });

  it('respects the budget', () => {
    expect(nextSeeds(found, new Set(), 1)).toEqual(['78247']);
  });

  it('copes with venues that have no address', () => {
    expect(nextSeeds([theater(5)], new Set(), 3)).toEqual([]);
  });
});
