import { describe, expect, it } from 'vitest';
import { applyVenueFilter, milesFrom, unanchoredVenues, NO_VENUE_FILTER } from '../src/core/filters.js';
import { parseGeocodeResult } from '../src/core/geo.js';
import type { Coords } from '../src/core/geo.js';
import type { Theater, VenueDay } from '../src/core/types.js';

/** Downtown San Antonio, the ZIP the scrape runs on. */
const DOWNTOWN: Coords = { lat: 29.4241, lon: -98.4936 };
/** 1132 W French Pl, 78201 — roughly three miles north-west of downtown. */
const FRENCH_PL: Coords = { lat: 29.45, lon: -98.5086 };

function day(
  name: string,
  miles: number,
  coords?: Coords,
  sourceId = 'fandango',
): VenueDay {
  const theater: Theater = { name, href: `/${name}`, miles, ...(coords ? { coords } : {}) };
  return { theater, date: '2026-08-04', movies: [], sourceId };
}

const filter = (over: Partial<typeof NO_VENUE_FILTER>) => ({ ...NO_VENUE_FILTER, ...over });

describe('milesFrom', () => {
  it('keeps the scraped distance when there is no anchor', () => {
    expect(milesFrom(day('AMC', 4, DOWNTOWN).theater, null)).toBe(4);
  });

  it('keeps the scraped distance when the venue has no coordinates', () => {
    expect(milesFrom(day('AMC', 4).theater, FRENCH_PL)).toBe(4);
  });

  it('re-measures against the anchor', () => {
    const miles = milesFrom(day('AMC', 40, DOWNTOWN).theater, FRENCH_PL);
    expect(miles).toBeGreaterThan(1.5);
    expect(miles).toBeLessThan(3);
  });
});

describe('applyVenueFilter', () => {
  const days = [
    day('AMC Rivercenter 11', 0.5, DOWNTOWN),
    day('Santikos Palladium IMAX', 14, { lat: 29.6, lon: -98.6 }),
    day('Stars & Stripes Drive-In', 30, { lat: 29.7, lon: -98.1 }, 'stars-and-stripes'),
  ];

  it('passes everything through when nothing is set', () => {
    expect(applyVenueFilter(days, filter({}))).toHaveLength(3);
  });

  it('drops excluded chains wherever they are', () => {
    const kept = applyVenueFilter(days, filter({ excludedChains: new Set(['amc']) }));
    expect(kept.map((d) => d.theater.name)).toEqual([
      'Santikos Palladium IMAX',
      'Stars & Stripes Drive-In',
    ]);
  });

  it('applies the radius', () => {
    const kept = applyVenueFilter(days, filter({ radiusMiles: 5 }));
    expect(kept.map((d) => d.theater.name)).toEqual(['AMC Rivercenter 11']);
  });

  it('exempts sources that get their own table', () => {
    const kept = applyVenueFilter(
      days,
      filter({ radiusMiles: 5, exemptSources: new Set(['stars-and-stripes']) }),
    );
    expect(kept.map((d) => d.theater.name)).toEqual([
      'AMC Rivercenter 11',
      'Stars & Stripes Drive-In',
    ]);
  });

  it('rewrites mileage to the anchor so the table agrees with the filter', () => {
    const kept = applyVenueFilter(days, filter({ anchor: FRENCH_PL, radiusMiles: 100 }));
    const rivercenter = kept.find((d) => d.theater.name === 'AMC Rivercenter 11');
    expect(rivercenter?.theater.miles).toBeGreaterThan(1.5);
    expect(rivercenter?.theater.miles).not.toBe(0.5);
  });

  it('measures the radius from the anchor, not the ZIP', () => {
    // Ten miles north of downtown: outside a 5-mile downtown radius, inside a
    // 5-mile radius anchored further north.
    const north = day('North Venue', 10, { lat: 29.56, lon: -98.4936 });
    const fromDowntown = applyVenueFilter([north], filter({ radiusMiles: 5 }));
    const fromNorth = applyVenueFilter(
      [north],
      filter({ radiusMiles: 5, anchor: { lat: 29.52, lon: -98.4936 } }),
    );
    expect(fromDowntown).toHaveLength(0);
    expect(fromNorth).toHaveLength(1);
  });

  it('keeps a venue with no coordinates rather than guessing', () => {
    const legacy = [day('Old Venue', 2)];
    const kept = applyVenueFilter(legacy, filter({ anchor: FRENCH_PL, radiusMiles: 5 }));
    expect(kept).toHaveLength(1);
    expect(kept[0]?.theater.miles).toBe(2);
  });
});

describe('unanchoredVenues', () => {
  it('is empty without an anchor', () => {
    expect(unanchoredVenues([day('Old Venue', 2)], null)).toEqual([]);
  });

  it('names the venues the anchor could not re-measure', () => {
    const days = [day('Old Venue', 2), day('AMC', 1, DOWNTOWN), day('Old Venue', 3)];
    expect(unanchoredVenues(days, DOWNTOWN)).toEqual(['Old Venue']);
  });
});

describe('parseGeocodeResult', () => {
  it('reads the first Nominatim hit', () => {
    expect(parseGeocodeResult([{ lat: '29.4499720', lon: '-98.5086300' }])).toEqual({
      lat: 29.449972,
      lon: -98.50863,
    });
  });

  it('returns null for an empty or malformed answer', () => {
    expect(parseGeocodeResult([])).toBeNull();
    expect(parseGeocodeResult({})).toBeNull();
    expect(parseGeocodeResult([{ lat: 'nope', lon: '1' }])).toBeNull();
  });
});
