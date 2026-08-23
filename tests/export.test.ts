import { describe, expect, it } from 'vitest';
import { EMPTY_ALIASES } from '../src/core/aggregate.js';
import { DATASET_VERSION, type Dataset } from '../src/core/dataset.js';
import { exportPublicDataset, PUBLIC_EXPORT_VERSION } from '../src/core/export.js';
import type { VenueDay } from '../src/core/types.js';
import { fixtureVenueDays } from './helpers.js';

const TIMEZONE = 'America/Chicago';

function datasetFor(days: VenueDay[]): Dataset {
  const dates = [...new Set(days.map((d) => d.date))].sort();
  return {
    version: DATASET_VERSION,
    generatedAt: '2026-08-04T18:00:00.000Z',
    zip: '78205',
    from: dates[0] ?? '2026-08-04',
    to: dates.at(-1) ?? '2026-08-04',
    radiusMiles: 15,
    horizon: dates.at(-1) ?? '2026-08-04',
    knownFrom: dates[0] ?? '2026-08-04',
    days,
    warnings: [],
    sources: {},
  };
}

describe('exportPublicDataset', () => {
  const days = fixtureVenueDays('2026-08-04');
  const dataset = datasetFor(days);

  it('uses the public export version stamp', () => {
    const exported = exportPublicDataset(dataset, {
      mode: 'full',
      aliases: EMPTY_ALIASES,
      timezone: TIMEZONE,
    });
    expect(exported.version).toBe(PUBLIC_EXPORT_VERSION);
    expect(exported.mode).toBe('full');
  });

  it('groups showings under films with a theater index', () => {
    const exported = exportPublicDataset(dataset, {
      mode: 'full',
      aliases: EMPTY_ALIASES,
      timezone: TIMEZONE,
    });

    expect(exported.theaters.length).toBeGreaterThan(0);
    expect(exported.films.length).toBeGreaterThan(0);

    const spider = exported.films.find((film) => film.title.includes('Spider-Man'));
    expect(spider).toBeDefined();
    expect(spider?.showings.length).toBeGreaterThan(0);

    const theaterIds = new Set(exported.theaters.map((t) => t.id));
    for (const showing of spider?.showings ?? []) {
      expect(theaterIds.has(showing.theaterId)).toBe(true);
      expect(showing.date).toBe('2026-08-04');
      expect(showing.source).toBe('fandango');
    }
  });

  it('marks expired showtimes only in the full export', () => {
    const synthetic = datasetFor([
      {
        theater: {
          name: 'Test Cinema',
          href: '/test-cinema-abc/theater-page',
          miles: 1,
        },
        date: '2026-08-04',
        movies: [
          {
            title: 'Fixture Film',
            href: '/fixture-film-123/movie-overview',
            groups: [
              {
                amenities: [],
                isDolby: false,
                variantId: null,
                showtimes: [
                  { time: '1:00p', expired: true },
                  { time: '7:00p', expired: false },
                ],
              },
            ],
          },
        ],
      },
    ]);

    const full = exportPublicDataset(synthetic, {
      mode: 'full',
      aliases: EMPTY_ALIASES,
      timezone: TIMEZONE,
    });
    const truncated = exportPublicDataset(synthetic, {
      mode: 'truncated',
      aliases: EMPTY_ALIASES,
      timezone: TIMEZONE,
    });

    const fullExpired = full.films.flatMap((film) =>
      film.showings.filter((showing) => showing.expired === true),
    );
    expect(fullExpired).toHaveLength(1);
    expect(truncated.films[0]?.showings).toHaveLength(1);
    expect(truncated.films[0]?.showings[0]?.time).toBe('7:00p');
  });

  it('uses absolute ticket links', () => {
    const exported = exportPublicDataset(dataset, {
      mode: 'full',
      aliases: EMPTY_ALIASES,
      timezone: TIMEZONE,
    });
    const film = exported.films.find((f) => f.href.includes('fandango.com'));
    expect(film?.href.startsWith('https://')).toBe(true);
    expect(exported.theaters[0]?.href?.startsWith('https://')).toBe(true);
  });

  it('keeps screenings whose source publishes no time', () => {
    const exported = exportPublicDataset(
      datasetFor([
        {
          theater: { name: 'Branch Library', href: '', miles: 2 },
          date: '2026-08-04',
          sourceId: 'sapl',
          movies: [
            {
              title: 'A Film',
              href: 'https://example.test/a-film',
              groups: [
                {
                  amenities: [],
                  isDolby: false,
                  variantId: null,
                  showtimes: [{ time: '', expired: false }],
                },
              ],
            },
          ],
        },
      ]),
      { mode: 'truncated', aliases: EMPTY_ALIASES, timezone: TIMEZONE },
    );

    expect(exported.films[0]?.showings[0]?.time).toBeNull();
    expect(exported.films[0]?.showings[0]?.source).toBe('sapl');
    expect(exported.theaters[0]?.href).toBeUndefined();
    expect(exported.theaters[0]?.source).toBe('sapl');
  });

  it('orders same-day showings chronologically', () => {
    const synthetic = datasetFor([
      {
        theater: { name: 'Test Cinema', href: '/test-cinema/theater-page', miles: 1 },
        date: '2026-08-04',
        movies: [
          {
            title: 'Fixture Film',
            href: '/fixture-film-123/movie-overview',
            groups: [
              {
                amenities: [],
                isDolby: false,
                variantId: null,
                showtimes: ['7:00p', '1:00p', '12:00p', '11:00a'].map((time) => ({
                  time,
                  expired: false,
                })),
              },
            ],
          },
        ],
      },
    ]);
    const exported = exportPublicDataset(synthetic, {
      mode: 'full',
      aliases: EMPTY_ALIASES,
      timezone: TIMEZONE,
    });

    expect(exported.films[0]?.showings.map((showing) => showing.time)).toEqual([
      '11:00a',
      '12:00p',
      '1:00p',
      '7:00p',
    ]);
  });

  it('uses the table merge rules across variants and sources', () => {
    const group = {
      amenities: [],
      isDolby: false,
      variantId: null,
      showtimes: [{ time: '7:00p', expired: false }],
    };
    const fandango = ['Cinema A', 'Cinema B'].map((name) => ({
      theater: { name, href: `/${name}/theater-page`, miles: 1 },
      date: '2026-08-04',
      movies: [
        {
          title: 'Spider-Man: Brand New Day (2026)',
          href: '/spider-man-brand-new-day-2026-243819/movie-overview',
          groups: [group],
        },
      ],
    }));
    const driveIn = {
      theater: { name: 'Drive-In', href: '', miles: 30 },
      date: '2026-08-04',
      sourceId: 'stars-and-stripes',
      movies: [
        {
          title: 'Spiderman: Brand New Day',
          href: 'https://example.test/spiderman',
          groups: [group],
        },
      ],
    };
    const exported = exportPublicDataset(datasetFor([...fandango, driveIn]), {
      mode: 'full',
      aliases: EMPTY_ALIASES,
      timezone: TIMEZONE,
    });

    expect(exported.films).toHaveLength(1);
    expect(exported.films[0]?.title).toBe('Spider-Man: Brand New Day (2026)');
    expect(exported.films[0]?.showings).toHaveLength(3);
  });

  it('omits theaters with no retained showings', () => {
    const past = datasetFor([
      {
        theater: { name: 'Past Cinema', href: '/past/theater-page', miles: 1 },
        date: '2026-08-03',
        movies: [
          {
            title: 'Past Film',
            href: '/past-film-1/movie-overview',
            groups: [
              {
                amenities: [],
                isDolby: false,
                variantId: null,
                showtimes: [{ time: '7:00p', expired: false }],
              },
            ],
          },
        ],
      },
    ]);
    const exported = exportPublicDataset(past, {
      mode: 'truncated',
      aliases: EMPTY_ALIASES,
      timezone: TIMEZONE,
    });

    expect(exported.films).toEqual([]);
    expect(exported.theaters).toEqual([]);
  });
});
