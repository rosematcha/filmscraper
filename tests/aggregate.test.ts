import { describe, expect, it } from 'vitest';
import { aggregate, EMPTY_ALIASES, isLive, type AliasConfig } from '../src/core/aggregate.js';
import type { MovieListing, ShowtimeGroup, Theater, VenueDay } from '../src/core/types.js';
import { fixtureVenueDays } from './helpers.js';

const theater = (name: string, miles: number): Theater => ({
  name,
  href: `/${name.toLowerCase().replace(/\W+/g, '-')}-aaaaa/theater-page`,
  miles,
});

const group = (
  amenities: [number, string][],
  times: [string, boolean][] = [['7:00p', false]],
): ShowtimeGroup => ({
  amenities: amenities.map(([id, name]) => ({ id, name })),
  isDolby: false,
  variantId: null,
  showtimes: times.map(([time, expired]) => ({ time, expired })),
});

const listing = (title: string, href: string, groups: ShowtimeGroup[]): MovieListing => ({
  title,
  href,
  groups,
});

const day = (t: Theater, date: string, movies: MovieListing[]): VenueDay => ({
  theater: t,
  date,
  movies,
});

const PALLADIUM = theater('Santikos Palladium IMAX', 14.49);
const RIVERCENTER = theater('AMC Rivercenter 11 with Alamo IMAX', 0.12);
const OPTS = { aliases: EMPTY_ALIASES, keepYears: false };

describe('isLive', () => {
  it('is false only when every showtime has passed', () => {
    expect(isLive(group([[1002, 'IMAX']], [['1:00p', true]]))).toBe(false);
    expect(
      isLive(
        group(
          [[1002, 'IMAX']],
          [
            ['1:00p', true],
            ['9:00p', false],
          ],
        ),
      ),
    ).toBe(true);
  });
});

describe('aggregate', () => {
  it('drops listings whose showtimes have all expired', () => {
    const days = [
      day(RIVERCENTER, '2026-08-02', [
        listing('Gone (2026)', '/gone-2026-1/movie-overview', [
          group([[1002, 'IMAX']], [['1:00p', true]]),
        ]),
        listing('Live (2026)', '/live-2026-2/movie-overview', [
          group([[1002, 'IMAX']], [['9:00p', false]]),
        ]),
      ]),
    ];
    const out = aggregate(days, [RIVERCENTER], OPTS);
    expect(out.map((m) => m.title)).toEqual(['Live']);
  });

  it('collects theaters and dates across the window', () => {
    const days = [
      day(RIVERCENTER, '2026-08-04', [
        listing('A (2026)', '/a-1/movie-overview', [group([[1002, 'IMAX']])]),
      ]),
      day(PALLADIUM, '2026-08-05', [
        listing('A (2026)', '/a-1/movie-overview', [group([[1080, '70MM Film']])]),
      ]),
    ];
    const [m] = aggregate(days, [RIVERCENTER, PALLADIUM], OPTS);
    expect(m?.dates).toEqual(['2026-08-04', '2026-08-05']);
    expect(m?.theaters).toEqual([RIVERCENTER.name, PALLADIUM.name]); // nearest first
    expect([...(m?.formats.keys() ?? [])].sort()).toEqual(['70MM', 'IMAX']);
  });

  it('records only the rarest format in a stacked group', () => {
    // Rivercenter's IMAX 70MM group also carries plain IMAX; counting both
    // would inflate the IMAX venue list.
    const days = [
      day(RIVERCENTER, '2026-08-05', [
        listing('O (2026)', '/o-1/movie-overview', [
          group([
            [1002, 'IMAX'],
            [1079, 'IMAX® 70MM Film'],
          ]),
        ]),
      ]),
    ];
    const [m] = aggregate(days, [RIVERCENTER], OPTS);
    expect([...(m?.formats.keys() ?? [])]).toEqual(['IMAX 70MM']);
  });

  it('still records IMAX from a separate plain-IMAX group', () => {
    const days = [
      day(RIVERCENTER, '2026-08-05', [
        listing('O (2026)', '/o-1/movie-overview', [
          group([
            [1002, 'IMAX'],
            [1079, 'IMAX® 70MM Film'],
          ]),
          group([[1002, 'IMAX']]),
        ]),
      ]),
    ];
    const [m] = aggregate(days, [RIVERCENTER], OPTS);
    expect([...(m?.formats.keys() ?? [])].sort()).toEqual(['IMAX', 'IMAX 70MM']);
  });

  it('merges edition variants of one film', () => {
    const days = [
      day(RIVERCENTER, '2026-08-05', [
        listing('Backrooms (2026)', '/backrooms-2026-244954/movie-overview', [
          group([[2011, 'Reserved seating']]),
        ]),
        listing(
          'Backrooms: Everything Must Go Edition with Bonus Footage (2026)',
          '/backrooms-everything-must-go-edition-with-bonus-footage-2026-246362/movie-overview',
          [group([[2011, 'Reserved seating']])],
        ),
      ]),
    ];
    const out = aggregate(days, [RIVERCENTER], OPTS);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe('Backrooms');
    expect(out[0]?.mergedHrefs).toHaveLength(2);
  });

  it('honours a split override', () => {
    const aliases: AliasConfig = {
      merge: [],
      split: [['244954', '246362']],
      theaterNames: {},
      sentinels: {},
    };
    const days = [
      day(RIVERCENTER, '2026-08-05', [
        listing('Backrooms (2026)', '/backrooms-2026-244954/movie-overview', [
          group([[2011, 'Reserved seating']]),
        ]),
        listing(
          'Backrooms: Everything Must Go Edition (2026)',
          '/backrooms-everything-must-go-edition-2026-246362/movie-overview',
          [group([[2011, 'Reserved seating']])],
        ),
      ]),
    ];
    expect(aggregate(days, [RIVERCENTER], { ...OPTS, aliases })).toHaveLength(2);
  });

  it('honours a merge override for titles that do not look alike', () => {
    const aliases: AliasConfig = {
      merge: [['1', '2']],
      split: [],
      theaterNames: {},
      sentinels: {},
    };
    const days = [
      day(RIVERCENTER, '2026-08-05', [
        listing('Alpha (2026)', '/alpha-1/movie-overview', [group([[2011, 'Reserved seating']])]),
        listing('Completely Different (2026)', '/different-2/movie-overview', [
          group([[2011, 'Reserved seating']]),
        ]),
      ]),
    ];
    const out = aggregate(days, [RIVERCENTER], { ...OPTS, aliases });
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe('Alpha');
  });

  it('flags special-event programming', () => {
    const days = [
      day(PALLADIUM, '2026-08-05', [
        listing('Willy Wonka 55th Anniversary', '/ww-1/movie-overview', [
          group([[1182, 'Fathom Features']]),
        ]),
      ]),
    ];
    expect(aggregate(days, [PALLADIUM], OPTS)[0]?.isEvent).toBe(true);
  });
});

describe('showings and markers', () => {
  it('records every live showing with its times and format', () => {
    const days = [
      day(PALLADIUM, '2026-08-05', [
        listing('X', '/x-1/movie-overview', [
          group(
            [[1002, 'IMAX']],
            [
              ['1:00p', true],
              ['7:00p', false],
            ],
          ),
          group([], [['4:00p', false]]),
        ]),
      ]),
    ];
    const [movie] = aggregate(days, [PALLADIUM], OPTS);
    expect(movie?.showings).toEqual([
      {
        date: '2026-08-05',
        theater: PALLADIUM.name,
        times: ['7:00p'],
        format: 'IMAX',
        labels: [],
        admission: 'unknown',
        sourceId: 'fandango',
      },
      {
        date: '2026-08-05',
        theater: PALLADIUM.name,
        times: ['4:00p'],
        format: null,
        labels: [],
        admission: 'unknown',
        sourceId: 'fandango',
      },
    ]);
  });

  it('marks an event only when every group carries the marker', () => {
    // One early-access night does not make a wide release an event.
    const mixed = [
      day(PALLADIUM, '2026-08-05', [
        listing('Oasis', '/o-1/movie-overview', [
          group([[1380, 'Early Access Screening']]),
          group([[2011, 'Reserved seating']]),
        ]),
      ]),
    ];
    const [movie] = aggregate(mixed, [PALLADIUM], OPTS);
    expect(movie?.isEvent).toBe(false);
    expect([...(movie?.events.entries() ?? [])]).toEqual([['Early access', [PALLADIUM.name]]]);
    expect(movie?.eventDates.get('Early access')).toEqual(['2026-08-05']);
  });

  it('recognises a fixture named in the sentinels', () => {
    const days = [
      day(RIVERCENTER, '2026-08-05', [
        listing('Alamo: The Price of Freedom', '/a-1/movie-overview', [group([[1002, 'IMAX']])]),
      ]),
    ];
    const aliases: AliasConfig = {
      ...EMPTY_ALIASES,
      sentinels: { [RIVERCENTER.name]: 'Alamo: The Price of Freedom' },
    };
    expect(aggregate(days, [RIVERCENTER], { ...OPTS, aliases })[0]?.isFixture).toBe(true);
    expect(aggregate(days, [RIVERCENTER], OPTS)[0]?.isFixture).toBe(false);
  });

  it("prefers the venue's own time over a mirror listing the same night", () => {
    const plaza = theater('Mission Marquee Plaza', 4);
    const days: VenueDay[] = [
      {
        ...day(plaza, '2026-08-15', [
          listing('A Minecraft Movie', 'https://missionmarquee/x', [group([], [['7:00p', false]])]),
        ]),
        sourceId: 'mission-marquee',
      },
      {
        ...day(plaza, '2026-08-15', [
          listing('A Minecraft Movie', 'https://slab/x', [group([], [['8:00p', false]])]),
        ]),
        sourceId: 'slab-outdoor',
      },
    ];
    const out = aggregate(days, [plaza], OPTS);
    expect(out).toHaveLength(1);
    expect(out[0]?.showings).toEqual([
      {
        date: '2026-08-15',
        theater: plaza.name,
        times: ['7:00p'],
        format: null,
        labels: [],
        admission: 'unknown',
        sourceId: 'mission-marquee',
      },
    ]);
  });
});

describe('aggregate over live fixtures', () => {
  const days = [...fixtureVenueDays('2026-08-04'), ...fixtureVenueDays('2026-08-05')];
  const theaters = [...new Map(days.map((d) => [d.theater.name, d.theater])).values()];
  const movies = aggregate(days, theaters, OPTS);
  const find = (t: string) => movies.find((m) => m.title.toLowerCase().includes(t));

  it('finds The Odyssey in both film formats at the right venues', () => {
    const odyssey = find('odyssey');
    expect(odyssey?.formats.get('70MM')).toEqual(['Santikos Palladium IMAX']);
    expect(odyssey?.formats.get('IMAX 70MM')).toEqual(['AMC Rivercenter 11 with Alamo IMAX']);
  });

  it('gives Spider-Man no noteworthy format', () => {
    // Its premium format is Santikos AVX, plus 3D — both excluded by design.
    expect(find('spider-man')?.formats.size).toBe(0);
  });

  it('sees Willy Wonka only on August 5', () => {
    expect(find('willy wonka')?.dates).toEqual(['2026-08-05']);
  });
});
