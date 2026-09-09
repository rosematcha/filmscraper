import { describe, expect, it } from 'vitest';
import { describeDates } from '../src/core/notes.js';
import {
  detectHorizon,
  detectKnownFrom,
  horizonWarning,
  laggingTheaters,
  pastDatesWarning,
  theaterLagWarning,
} from '../src/core/pipeline.js';
import type { MovieListing, VenueDay } from '../src/core/types.js';

/** Sun 2 Aug through Sat 8 Aug: seven days, so every weekday name is unique. */
const WEEK = [
  '2026-08-02',
  '2026-08-03',
  '2026-08-04',
  '2026-08-05',
  '2026-08-06',
  '2026-08-07',
  '2026-08-08',
];

/** Build `count` live listings for one date at one theater. */
function venueDay(date: string, count: number): VenueDay {
  const movies: MovieListing[] = Array.from({ length: count }, (_, i) => ({
    title: `M${String(i)}`,
    href: `/m${String(i)}/movie-overview`,
    groups: [
      {
        amenities: [],
        isDolby: false,
        variantId: null,
        showtimes: [{ time: '7:00p', expired: false }],
      },
    ],
  }));
  return { theater: { name: 'T', href: '/t/theater-page', miles: 1 }, date, movies };
}

describe('detectHorizon', () => {
  it('finds the boundary where posted schedules run out', () => {
    // Measured live for 78205: full through Aug 6, then a drop to 62 on Aug 7.
    const counts = [46, 147, 142, 149, 100, 62, 90];
    const days = WEEK.map((d, i) => venueDay(d, counts[i] ?? 0));
    expect(detectHorizon(days, WEEK, '2026-08-02')).toBe('2026-08-06');
  });

  it('does not let a thin "today" cut the window short', () => {
    // Today is expired-thinned by definition and must not set the boundary.
    const counts = [10, 147, 142, 149, 140, 141, 145];
    const days = WEEK.map((d, i) => venueDay(d, counts[i] ?? 0));
    expect(detectHorizon(days, WEEK, '2026-08-02')).toBe('2026-08-08');
  });

  it('returns the last date when every day is well populated', () => {
    const days = WEEK.map((d) => venueDay(d, 140));
    expect(detectHorizon(days, WEEK, '2026-08-02')).toBe('2026-08-08');
  });

  it('handles a single-date window', () => {
    expect(detectHorizon([venueDay('2026-08-02', 5)], ['2026-08-02'], '2026-08-02')).toBe('2026-08-02');
  });

  it('warns only when the horizon falls short of the window', () => {
    expect(horizonWarning('2026-08-06', WEEK)?.kind).toBe('partial-horizon');
    expect(horizonWarning('2026-08-08', WEEK)).toBeNull();
  });
});

describe('laggingTheaters', () => {
  const RIVERCENTER = 'AMC Rivercenter 11 with Alamo IMAX';
  const SENTINELS = { [RIVERCENTER]: 'Alamo: The Price of Freedom' };
  const TODAY = WEEK[0] ?? '';

  /** One venue-day listing the given titles, all live. */
  function at(theater: string, date: string, titles: readonly string[], sourceId?: string): VenueDay {
    const movies: MovieListing[] = titles.map((title) => ({
      title,
      href: `/${title.replaceAll(/\W+/g, '-').toLowerCase()}/movie-overview`,
      groups: [
        {
          amenities: [],
          isDolby: false,
          variantId: null,
          showtimes: [{ time: '7:00p', expired: false }],
        },
      ],
    }));
    return {
      theater: { name: theater, href: '/t/theater-page', miles: 1 },
      date,
      movies,
      ...(sourceId === undefined ? {} : { sourceId }),
    };
  }

  /** `n` filler titles, plus the sentinel unless the day is unposted. */
  function grid(n: number, sentinel = false): string[] {
    const titles = Array.from({ length: n }, (_, i) => `Film ${String(i)}`);
    return sentinel ? ['Alamo: The Price of Freedom', ...titles] : titles;
  }

  /**
   * The pattern measured live on Aug 10: Rivercenter ran ten films (sentinel
   * included) through Wednesday, then one pre-sold title a day.
   */
  function rivercenterWeek(): VenueDay[] {
    return WEEK.map((d, i) => at(RIVERCENTER, d, i < 3 ? grid(9, true) : grid(1)));
  }

  it('flags a theater still on pre-sales past its own posting boundary', () => {
    const lags = laggingTheaters(rivercenterWeek(), WEEK, TODAY, WEEK[6] ?? '', SENTINELS);
    expect(lags).toEqual([{ theater: RIVERCENTER, postedThrough: '2026-08-04' }]);
  });

  it('says nothing when the venue is posted to the market horizon', () => {
    expect(laggingTheaters(rivercenterWeek(), WEEK, TODAY, '2026-08-04', SENTINELS)).toEqual([]);
  });

  it('flags a theater whose listings stop dead after today', () => {
    // No future peak to measure, but a full grid today proves the venue is a
    // multiplex — the worst laggard must not slip the warning entirely.
    const days = [at(RIVERCENTER, TODAY, grid(9, true))];
    const lags = laggingTheaters(days, WEEK, TODAY, WEEK[6] ?? '', SENTINELS);
    expect(lags).toEqual([{ theater: RIVERCENTER, postedThrough: TODAY }]);
  });

  it('trusts a live sentinel to mark a thin day as posted', () => {
    // A quiet Wednesday with three films is still a posted schedule when the
    // thirty-year fixture is on it.
    const days = [
      at(RIVERCENTER, WEEK[1] ?? '', grid(9, true)),
      at(RIVERCENTER, WEEK[2] ?? '', grid(2, true)),
      at(RIVERCENTER, WEEK[3] ?? '', grid(1)),
    ];
    const lags = laggingTheaters(days, WEEK.slice(0, 4), TODAY, WEEK[3] ?? '', SENTINELS);
    expect(lags).toEqual([{ theater: RIVERCENTER, postedThrough: '2026-08-04' }]);
  });

  it('does not let a missing sentinel condemn a busy day', () => {
    // An IMAX takeover can bump even the fixture; a full grid stays posted.
    const days = [
      at(RIVERCENTER, WEEK[1] ?? '', grid(9, true)),
      at(RIVERCENTER, WEEK[2] ?? '', grid(8)),
    ];
    expect(laggingTheaters(days, WEEK.slice(0, 3), TODAY, WEEK[2] ?? '', SENTINELS)).toEqual([]);
  });

  it('skips venues too small to measure by density', () => {
    // The Rainbow books one film for three dates: that is its whole schedule.
    const days = [
      at('Rainbow Theater', WEEK[4] ?? '', ['Rocky Horror']),
      at('Rainbow Theater', WEEK[5] ?? '', ['Rocky Horror']),
    ];
    expect(laggingTheaters(days, WEEK, TODAY, WEEK[6] ?? '', {})).toEqual([]);
  });

  it('ignores sources that are not weekly grids', () => {
    const days = WEEK.map((d, i) => at('Central Library', d, i < 2 ? grid(5) : [], 'sapl'));
    expect(laggingTheaters(days, WEEK, TODAY, WEEK[6] ?? '', {})).toEqual([]);
  });

  it('names the laggards with their short names, grouped by boundary', () => {
    // A midweek split can put seventeen venues here; venues sharing a boundary
    // share one date mention rather than repeating it seventeen times.
    const lags = [
      { theater: RIVERCENTER, postedThrough: '2026-08-04' },
      { theater: 'Santikos Galaxy', postedThrough: '2026-08-04' },
      { theater: 'City Base Entertainment', postedThrough: '2026-08-05' },
    ];
    const warning = theaterLagWarning(lags, {
      [RIVERCENTER]: 'Rivercenter',
      'City Base Entertainment': 'City Base',
    });
    expect(warning?.kind).toBe('theater-lag');
    expect(warning?.message).toBe(
      'Some theaters have not posted full schedules yet: Rivercenter and Santikos Galaxy have ' +
        'listings through 2026-08-04; City Base through 2026-08-05. Most theaters announce the ' +
        'coming week on Tuesday or Wednesday, so a film missing at these venues after those ' +
        'dates may not be on sale yet.',
    );
  });

  it('speaks in the singular for a lone laggard', () => {
    const warning = theaterLagWarning([{ theater: RIVERCENTER, postedThrough: '2026-08-04' }], {});
    expect(warning?.message).toBe(
      'AMC Rivercenter 11 with Alamo IMAX has not posted full schedules past 2026-08-04 yet. ' +
        'Most theaters announce the coming week on Tuesday or Wednesday, so a film missing ' +
        'there after that date may not be on sale yet.',
    );
    expect(theaterLagWarning([], {})).toBeNull();
  });

  it('keeps subject and verb agreeing when the first group has one theater', () => {
    const warning = theaterLagWarning(
      [
        { theater: 'Theater A', postedThrough: '2026-08-04' },
        { theater: 'Theater B', postedThrough: '2026-08-05' },
      ],
      {},
    );
    expect(warning?.message).toContain('Theater A has listings through 2026-08-04');
  });

  it('speaks of one date when every laggard shares a boundary', () => {
    const warning = theaterLagWarning(
      [
        { theater: 'Theater A', postedThrough: '2026-08-04' },
        { theater: 'Theater B', postedThrough: '2026-08-04' },
      ],
      {},
    );
    expect(warning?.message).toContain('at these venues after that date');
  });
});

describe('describeDates', () => {
  const HORIZON = '2026-08-06';

  it('says nothing when a film plays every posted day', () => {
    // Regression: this used to read "Sunday, Monday, Tuesday, Wednesday and
    // Thursday only" simply because Friday was not posted yet.
    const played = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'];
    expect(describeDates(played, WEEK, WEEK[0] ?? '', HORIZON)).toBeNull();
  });

  it('reports an opening rather than a limited run', () => {
    // Cookie Queens opens Thursday; it is not "Thursday through Sunday only".
    const played = ['2026-08-06', '2026-08-07', '2026-08-08'];
    expect(describeDates(played, WEEK, WEEK[0] ?? '', HORIZON)).toBe('opens Thursday');
  });

  it('reports a run that genuinely ends inside the posted range', () => {
    const played = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'];
    expect(describeDates(played, WEEK, WEEK[0] ?? '', HORIZON)).toBe('through Wednesday');
  });

  it('keeps single-date events exact', () => {
    expect(describeDates(['2026-08-05'], WEEK, WEEK[0] ?? '', HORIZON)).toBe('Wednesday only');
  });

  it('dates pre-sold events beyond the horizon', () => {
    expect(describeDates(['2026-08-08'], WEEK, WEEK[0] ?? '', HORIZON)).toBe('August 8 only');
    expect(describeDates(['2026-08-07', '2026-08-08'], WEEK, WEEK[0] ?? '', HORIZON)).toBe(
      'August 7 and August 8 only',
    );
  });

  it('reads a pre-sold run to the end of the window as an opening', () => {
    // PAW Patrol goes on sale for Thursday onward before Fandango posts the
    // week; "August 6, 7 and 8 only" claimed a limited run that does not exist.
    const played = ['2026-08-06', '2026-08-07', '2026-08-08'];
    expect(describeDates(played, WEEK, WEEK[0] ?? '', '2026-08-05')).toBe('opens August 6');
  });

  it('lists genuinely broken runs', () => {
    const played = ['2026-08-02', '2026-08-04', '2026-08-06'];
    expect(describeDates(played, WEEK, WEEK[0] ?? '', HORIZON)).toBe('Sunday, Tuesday and Thursday only');
  });

  it('treats the whole window as posted when the horizon is the last date', () => {
    const short = ['2026-08-04', '2026-08-05'];
    expect(describeDates(['2026-08-05'], short, short[0] ?? '', '2026-08-05')).toBe('Wednesday only');
    expect(describeDates(short, short, short[0] ?? '', '2026-08-05')).toBeNull();
  });
});

describe('detectKnownFrom', () => {
  const WINDOW = ['2026-08-02', '2026-08-03', '2026-08-04'];

  it('skips a partial today so a long run is not read as an opening', () => {
    // Regression: Toy Story 5 reported "Opens Monday" purely because its
    // Sunday showtimes had already started by the time the scrape ran.
    expect(detectKnownFrom(WINDOW, '2026-08-02', true, '2026-08-04')).toBe('2026-08-03');
  });

  it('keeps today when its listings are still complete', () => {
    expect(detectKnownFrom(WINDOW, '2026-08-02', false, '2026-08-04')).toBe('2026-08-02');
  });

  it('keeps today when the window is only today', () => {
    expect(detectKnownFrom(['2026-08-02'], '2026-08-02', true, '2026-08-02')).toBe('2026-08-02');
  });

  it('keeps today when the window does not start today', () => {
    expect(detectKnownFrom(WINDOW, '2026-08-01', true, '2026-08-04')).toBe('2026-08-02');
  });

  it('never skips past the horizon', () => {
    expect(detectKnownFrom(WINDOW, '2026-08-02', true, '2026-08-02')).toBe('2026-08-02');
  });
});

describe('describeDates with a partial today', () => {
  it('says nothing for a film running the rest of the posted week', () => {
    const week = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'];
    const played = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'];
    expect(describeDates(played, week, '2026-08-03', '2026-08-06')).toBeNull();
  });
});

describe('windows that reach into the past', () => {
  const WINDOW = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'];

  it('does not let a finished date collapse the horizon', () => {
    // Regression: a scrape run on Aug 3 for a window starting Aug 2 saw zero
    // listings on day one and treated that as the posting boundary, which made
    // every film in the table look like a limited engagement.
    const counts: Record<string, number> = {
      '2026-08-02': 0,
      '2026-08-03': 176,
      '2026-08-04': 170,
      '2026-08-05': 178,
      '2026-08-06': 119,
    };
    const days = WINDOW.map((d) => venueDay(d, counts[d] ?? 0));
    expect(detectHorizon(days, WINDOW, '2026-08-03')).toBe('2026-08-06');
  });

  it('starts reliable data at today, never before it', () => {
    expect(detectKnownFrom(WINDOW, '2026-08-03', false, '2026-08-06')).toBe('2026-08-03');
    expect(detectKnownFrom(WINDOW, '2026-08-03', true, '2026-08-06')).toBe('2026-08-04');
  });

  it('warns that the past dates are empty', () => {
    expect(pastDatesWarning(WINDOW, '2026-08-03')?.message).toMatch(/already passed/);
    expect(pastDatesWarning(WINDOW, '2026-08-02')).toBeNull();
  });
});
