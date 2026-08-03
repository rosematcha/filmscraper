import { describe, expect, it } from 'vitest';
import { classifyAmenity, knownAmenityIds } from '../src/core/amenities.js';
import { fixtureVenueDays } from './helpers.js';

const classOf = (id: number, name: string): string => classifyAmenity({ id, name }).cls;
const labelOf = (id: number, name: string): string => classifyAmenity({ id, name }).label;

describe('classifyAmenity', () => {
  it('treats rare film formats as noteworthy', () => {
    expect(classOf(1079, 'IMAX® 70MM Film')).toBe('format');
    expect(labelOf(1079, 'IMAX® 70MM Film')).toBe('IMAX 70MM');
    expect(classOf(1080, '70MM Film')).toBe('format');
    expect(labelOf(1080, '70MM Film')).toBe('70MM');
    expect(classOf(1002, 'IMAX')).toBe('format');
  });

  it('ranks rarer formats ahead of common ones', () => {
    const imax70 = classifyAmenity({ id: 1079, name: 'IMAX® 70MM Film' });
    const seventy = classifyAmenity({ id: 1080, name: '70MM Film' });
    const imax = classifyAmenity({ id: 1002, name: 'IMAX' });
    expect(imax70.rank).toBeLessThan(seventy.rank);
    expect(seventy.rank).toBeLessThan(imax.rank);
  });

  it('excludes chain-branded premium formats', () => {
    for (const [id, name] of [
      [1019, 'RPX'],
      [1117, 'AVX'],
      [1075, 'CBX'],
      [1027, 'D-Box'],
      [1537, 'HDR'],
      [1554, 'HDR By Barco'],
      [1472, 'Laser Projection'],
    ] as const) {
      expect(classOf(id, name), name).toBe('plf');
    }
  });

  it('excludes Dolby Atmos, which is audio rather than Dolby Cinema', () => {
    expect(classOf(1036, 'Dolby Atmos')).toBe('plf');
    expect(classOf(-1, 'Dolby Cinema')).toBe('format');
  });

  it('excludes 3D', () => {
    expect(classOf(1009, 'RealD 3D')).toBe('three-d');
    expect(classOf(1014, 'Digital 3D')).toBe('three-d');
  });

  it('classes captioning and language as opt-in', () => {
    expect(classOf(1003, 'Open caption')).toBe('access');
    expect(classOf(1012, 'Closed caption')).toBe('access');
    expect(classOf(1088, 'Accessibility devices available')).toBe('access');
    expect(classOf(1004, 'Spanish subtitled')).toBe('language');
    expect(classOf(1037, 'Spanish Dubbed')).toBe('language');
  });

  it('flags special-event programming', () => {
    expect(classOf(1182, 'Fathom Features')).toBe('event');
  });

  it('never surfaces seating perks', () => {
    for (const [id, name] of [
      [2011, 'Reserved seating'],
      [1071, 'Recliner Seats'],
      [1219, 'Dine-In Delivery to Seat'],
      [1573, 'No Trailers'],
    ] as const) {
      expect(classOf(id, name), name).toBe('comfort');
    }
  });

  it('falls back to names for unseen ids, preferring the rarer match', () => {
    expect(classOf(99991, 'IMAX 70MM Film')).toBe('format');
    expect(labelOf(99991, 'IMAX 70MM Film')).toBe('IMAX 70MM');
    expect(labelOf(99992, 'ScreenX')).toBe('ScreenX');
    expect(classOf(99993, 'Cinemark XD')).toBe('plf');
  });

  it('defaults an unrecognised amenity to comfort so it cannot leak into Notes', () => {
    expect(classOf(99994, 'Heated Massage Loungers')).toBe('comfort');
  });
});

describe('amenity vocabulary drift', () => {
  it('has a catalogued id for every amenity in the fixtures', () => {
    const known = knownAmenityIds();
    const seen = new Map<number, string>();
    for (const date of ['2026-08-02', '2026-08-05']) {
      for (const day of fixtureVenueDays(date)) {
        for (const movie of day.movies) {
          for (const group of movie.groups) {
            for (const amenity of group.amenities) seen.set(amenity.id, amenity.name);
          }
        }
      }
    }
    const missing = [...seen].filter(([id]) => !known.has(id));
    expect(missing, `uncatalogued amenities: ${JSON.stringify(missing)}`).toEqual([]);
  });
});
