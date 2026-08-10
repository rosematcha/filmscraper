import { describe, expect, it } from 'vitest';
import { aggregate, EMPTY_ALIASES } from '../src/core/aggregate.js';
import { linkCell, renderRows } from '../src/core/markdown.js';
import { isMysteryTitle, mysteryTitle } from '../src/core/mystery.js';
import { mergeKey } from '../src/core/titles.js';
import { DEFAULT_RENDER_OPTIONS } from '../src/core/types.js';
import type { MovieListing, ShowtimeGroup, Theater, VenueDay } from '../src/core/types.js';

const theater = (name: string, miles: number): Theater => ({
  name,
  href: `/${name.toLowerCase().replace(/\W+/g, '-')}-aaaaa/theater-page`,
  miles,
});

const showing: ShowtimeGroup = {
  amenities: [],
  isDolby: false,
  variantId: null,
  showtimes: [{ time: '7:00p', expired: false }],
};

const listing = (title: string, href: string): MovieListing => ({
  title,
  href,
  groups: [showing],
});

const day = (t: Theater, date: string, movies: MovieListing[]): VenueDay => ({
  theater: t,
  date,
  movies,
});

// The five listings San Antonio actually carried for the night of 2026-08-10.
const RIVERCENTER = theater('AMC Rivercenter 11 with Alamo IMAX', 0.12);
const MCCRELESS = theater('Cinemark McCreless Market', 4.2);
const LIVE_OAK = theater('Regal Live Oak & RPX', 12.1);
const PALLADIUM = theater('Santikos Palladium IMAX', 14.49);
const FLIX = theater('Flix Brewhouse San Antonio', 9.6);

const MYSTERY_NIGHT: VenueDay[] = [
  day(RIVERCENTER, '2026-08-10', [
    listing('AMC Screen Unseen: August 10', '/amc-screen-unseen-august-10-237146/movie-overview'),
  ]),
  day(MCCRELESS, '2026-08-10', [
    listing('Cinemark Secret Movie Series', '/cinemark-secret-movie-series-239403/movie-overview'),
  ]),
  day(LIVE_OAK, '2026-08-10', [
    listing('REGAL: Monday Mystery Movie', '/regal-monday-mystery-movie-229078/movie-overview'),
  ]),
  day(PALLADIUM, '2026-08-10', [
    listing(
      'Santikos Monday Mystery Movie',
      '/santikos-monday-mystery-movie-241250/movie-overview',
    ),
  ]),
  day(FLIX, '2026-08-10', [listing('SECRET FLIX', '/secret-flix-242637/movie-overview')]),
];

const THEATERS = [RIVERCENTER, MCCRELESS, LIVE_OAK, PALLADIUM, FLIX];
const OPTS = { aliases: EMPTY_ALIASES, keepYears: false };

describe('isMysteryTitle', () => {
  it("recognises every chain's branding for the same night", () => {
    for (const title of [
      'AMC Screen Unseen: August 10',
      'Cinemark Secret Movie Series',
      'REGAL: Monday Mystery Movie',
      'Santikos Monday Mystery Movie',
      'SECRET FLIX',
    ]) {
      expect(isMysteryTitle(title), title).toBe(true);
    }
  });

  it('leaves films that merely sound mysterious alone', () => {
    // A real title with the word in it must keep its own row.
    for (const title of ['A Simple Favor', 'Mystery Men', 'The Secret Life of Pets', 'Unseen']) {
      expect(isMysteryTitle(title), title).toBe(false);
    }
  });
});

describe('mysteryTitle', () => {
  it('names the night when every date falls on one weekday', () => {
    expect(mysteryTitle(['2026-08-10'])).toBe('Monday Mystery Movie');
    expect(mysteryTitle(['2026-08-10', '2026-08-17'])).toBe('Monday Mystery Movie');
  });

  it('drops the day when the window spans two of them', () => {
    expect(mysteryTitle(['2026-08-10', '2026-08-12'])).toBe('Mystery Movie');
    expect(mysteryTitle([])).toBe('Mystery Movie');
  });
});

describe('mergeKey', () => {
  it('gives every mystery listing the same key', () => {
    const keys = new Set(MYSTERY_NIGHT.flatMap((d) => d.movies.map((m) => mergeKey(m.title))));
    expect(keys.size).toBe(1);
  });
});

describe('aggregate of a mystery night', () => {
  const [movie, ...rest] = aggregate(MYSTERY_NIGHT, THEATERS, OPTS);

  it('produces exactly one row', () => {
    expect(rest).toEqual([]);
    expect(movie?.title).toBe('Monday Mystery Movie');
    expect(movie?.theaters).toHaveLength(5);
  });

  it('keeps a ticket link per chain', () => {
    expect(movie?.ticketLinks.map((l) => l.label)).toEqual([
      'AMC',
      'Cinemark',
      'Flix Brewhouse',
      'Regal',
      'Santikos',
    ]);
    expect(movie?.ticketLinks.find((l) => l.label === 'AMC')?.href).toBe(
      '/amc-screen-unseen-august-10-237146/movie-overview',
    );
  });

  it('leaves ordinary films with no per-chain links', () => {
    const days = [
      day(RIVERCENTER, '2026-08-10', [listing('Gone (2026)', '/gone-2026-1/movie-overview')]),
      day(MCCRELESS, '2026-08-10', [listing('Gone (2026)', '/gone-2026-1/movie-overview')]),
    ];
    expect(aggregate(days, THEATERS, OPTS)[0]?.ticketLinks).toEqual([]);
  });
});

describe('linkCell', () => {
  it('renders one absolute link per chain', () => {
    const movies = aggregate(MYSTERY_NIGHT, THEATERS, OPTS);
    const [row] = renderRows(
      {
        request: { zip: '78205', from: '2026-08-10', to: '2026-08-10', radiusMiles: 15 },
        dates: ['2026-08-10'],
        horizon: '2026-08-10',
        knownFrom: '2026-08-10',
        theaters: THEATERS,
        movies,
        warnings: [],
        days: MYSTERY_NIGHT,
      },
      DEFAULT_RENDER_OPTIONS,
      {},
    );
    expect(row && linkCell(row)).toBe(
      [
        '[AMC](https://www.fandango.com/amc-screen-unseen-august-10-237146/movie-overview)',
        '[Cinemark](https://www.fandango.com/cinemark-secret-movie-series-239403/movie-overview)',
        '[Flix Brewhouse](https://www.fandango.com/secret-flix-242637/movie-overview)',
        '[Regal](https://www.fandango.com/regal-monday-mystery-movie-229078/movie-overview)',
        '[Santikos](https://www.fandango.com/santikos-monday-mystery-movie-241250/movie-overview)',
      ].join(' · '),
    );
  });
});
