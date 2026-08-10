import { describe, expect, it } from 'vitest';
import { describeDates } from '../src/core/notes.js';
import {
  detectHorizon,
  detectKnownFrom,
  horizonWarning,
  pastDatesWarning,
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
    expect(describeDates(['2026-08-05'], WEEK, WEEK[0] ?? '', HORIZON)).toBe('August 5 only');
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
    expect(describeDates(['2026-08-05'], short, short[0] ?? '', '2026-08-05')).toBe('August 5 only');
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
