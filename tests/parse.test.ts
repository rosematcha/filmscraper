import { describe, expect, it } from 'vitest';
import { pageDistances, parseAmenityGroup, parseMiles } from '../src/sources/fandango/parse.js';
import { fixture, fixtureVenueDays, findMovie } from './helpers.js';

describe('parseMiles', () => {
  it('reads Fandango distance labels', () => {
    expect(parseMiles('0.12 mi')).toBe(0.12);
    expect(parseMiles('14.49 mi')).toBe(14.49);
    expect(parseMiles('  16.15 mi.  ')).toBe(16.15);
  });

  it('returns null when there is no distance', () => {
    expect(parseMiles('')).toBeNull();
    expect(parseMiles('San Antonio, TX')).toBeNull();
  });
});

describe('parseAmenityGroup', () => {
  it('reads the embedded JSON', () => {
    const group = parseAmenityGroup(
      JSON.stringify({
        amenities: [{ id: 1080, name: '70MM Film' }],
        isDolby: false,
        movieVariantId: 245895,
        showtimes: [{ date: '9:15p', expired: false }],
      }),
    );
    expect(group).toEqual({
      amenities: [{ id: 1080, name: '70MM Film' }],
      isDolby: false,
      variantId: 245895,
      showtimes: [{ time: '9:15p', expired: false }],
    });
  });

  it('drops a malformed group instead of failing the page', () => {
    expect(parseAmenityGroup('{not json')).toBeNull();
    expect(parseAmenityGroup('null')).toBeNull();
  });

  it('ignores amenities missing an id or name', () => {
    const group = parseAmenityGroup(
      JSON.stringify({ amenities: [{ id: 1002 }, { name: 'IMAX' }, { id: 1, name: 'ok' }] }),
    );
    expect(group?.amenities).toEqual([{ id: 1, name: 'ok' }]);
  });
});

describe('parseShowtimesPage', () => {
  const days = fixtureVenueDays('2026-08-05');

  it('parses every theater on both pages', () => {
    expect(days.length).toBe(19);
    expect(days.every((d) => d.date === '2026-08-05')).toBe(true);
  });

  it('reads theater names, hrefs and distances', () => {
    const nearest = days.reduce((a, b) => (a.theater.miles <= b.theater.miles ? a : b));
    expect(nearest.theater.name).toBe('AMC Rivercenter 11 with Alamo IMAX');
    expect(nearest.theater.miles).toBe(0.12);
    expect(nearest.theater.href).toContain('/theater-page');
  });

  it('keeps every theater inside the radius, including the far page', () => {
    const miles = days.map((d) => d.theater.miles).sort((a, b) => a - b);
    expect(miles[0]).toBe(0.12);
    expect(miles.at(-1)).toBeLessThanOrEqual(15);
    // Santikos Palladium sits at 14.49 mi on page 2 — the exact venue a
    // single-page scrape would miss.
    expect(days.some((d) => d.theater.name.includes('Palladium'))).toBe(true);
  });

  it('extracts amenity groups with formats and showtimes', () => {
    const found = findMovie(
      days.filter((d) => d.theater.name.includes('Rivercenter')),
      'odyssey',
    );
    expect(found).not.toBeNull();
    const names = found?.movie.groups.flatMap((g) => g.amenities.map((a) => a.name)) ?? [];
    expect(names).toContain('IMAX® 70MM Film');
    expect(found?.movie.groups.some((g) => g.showtimes.length > 0)).toBe(true);
  });

  it('links each movie to its overview page', () => {
    const found = findMovie(days, 'spider-man');
    expect(found?.movie.href).toMatch(/\/spider-man-brand-new-day-2026-\d+\/movie-overview/);
  });

  it('reads expired flags from an evening capture', () => {
    const evening = fixtureVenueDays('2026-08-02');
    const all = evening.flatMap((d) => d.movies.flatMap((m) => m.groups.flatMap((g) => g.showtimes)));
    expect(all.some((s) => s.expired)).toBe(true);
    expect(all.some((s) => !s.expired)).toBe(true);
  });
});

describe('pageDistances', () => {
  it('returns the ten distances Fandango pages by', () => {
    const distances = pageDistances(fixture('zip-78205-2026-08-05-page1'));
    expect(distances.length).toBe(10);
    expect(Math.min(...distances)).toBe(0.12);
  });

  it('sees the second page start beyond the first', () => {
    const first = pageDistances(fixture('zip-78205-2026-08-05-page1'));
    const second = pageDistances(fixture('zip-78205-2026-08-05-page2'));
    expect(Math.min(...second)).toBeGreaterThan(Math.max(...first));
  });

  it('is not fooled by stray mileage text elsewhere on the page', () => {
    // Regression: an unrelated "45 mi" once tripped the pager's early exit and
    // silently dropped every theater past 8.61 mi.
    const html = fixture('zip-78205-2026-08-05-page1').replace(
      '<body>',
      '<body><div class="promo">Drive up to 45 mi for this deal</div>',
    );
    const distances = pageDistances(html);
    expect(distances.length).toBe(10);
    expect(Math.max(...distances)).toBeLessThan(45);
  });
});
