import { describe, expect, it } from 'vitest';
import { buildNotes, dateRange, humanList } from '../src/core/notes.js';
import {
  DEFAULT_RENDER_OPTIONS,
  type AggregatedMovie,
  type RenderOptions,
} from '../src/core/types.js';

const OPTS = DEFAULT_RENDER_OPTIONS;
const NAMES = {
  'Santikos Palladium IMAX': 'Palladium',
  'AMC Rivercenter 11 with Alamo IMAX': 'Rivercenter',
  'Regal Live Oak & RPX': 'Regal Live Oak',
};

function movie(over: Partial<AggregatedMovie> = {}): AggregatedMovie {
  return {
    key: 'x',
    title: 'X',
    href: '/x-1/movie-overview',
    theaters: [],
    freeVenues: [],
    freeDates: [],
    dates: [],
    formats: new Map(),
    optional: new Map(),
    optionalDates: new Map(),
    isEvent: false,
    events: new Map(),
    eventDates: new Map(),
    showings: [],
    isFixture: false,
    sources: ['fandango'],
    languages: [],
    foreign: false,
    releaseYear: 2026,
    mergedHrefs: [],
    ticketLinks: [],
    ...over,
  };
}

const notes = (
  m: AggregatedMovie,
  dates: string[],
  o: RenderOptions = OPTS,
  horizon = dates.at(-1) ?? '',
): string => buildNotes(m, dates, dates[0] ?? '', horizon, o, NAMES);

describe('humanList', () => {
  it('joins naturally', () => {
    expect(humanList(['a'])).toBe('a');
    expect(humanList(['a', 'b'])).toBe('a and b');
    expect(humanList(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('dateRange', () => {
  it('is inclusive of both ends', () => {
    expect(dateRange('2026-08-02', '2026-08-05')).toEqual([
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ]);
    expect(dateRange('2026-08-02', '2026-08-02')).toEqual(['2026-08-02']);
  });

  it('crosses month boundaries', () => {
    expect(dateRange('2026-08-30', '2026-09-01')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ]);
  });
});

describe('buildNotes', () => {
  const window2 = ['2026-08-04', '2026-08-05'];

  it('leaves a wide release with no noteworthy format blank', () => {
    // Spider-Man's premium format is Santikos AVX and it also plays 3D; neither
    // is noteworthy, so the cell stays empty.
    const m = movie({ theaters: Array.from({ length: 12 }, (_, i) => `T${i}`), dates: window2 });
    expect(notes(m, window2)).toBe('');
  });

  it('names venues for rare formats, rarest first', () => {
    const m = movie({
      theaters: Array.from({ length: 12 }, (_, i) => `T${i}`),
      dates: window2,
      formats: new Map([
        [
          'IMAX',
          ['Santikos Palladium IMAX', 'Regal Live Oak & RPX', 'AMC Rivercenter 11 with Alamo IMAX'],
        ],
        ['70MM', ['Santikos Palladium IMAX']],
        ['IMAX 70MM', ['AMC Rivercenter 11 with Alamo IMAX']],
      ]),
    });
    expect(notes(m, window2)).toBe(
      'IMAX 70MM at Rivercenter, 70MM at Palladium, IMAX at Palladium, Regal Live Oak and Rivercenter',
    );
  });

  it('drops the venue list when a format is not scarce', () => {
    const m = movie({
      theaters: Array.from({ length: 12 }, (_, i) => `T${i}`),
      dates: window2,
      formats: new Map([['IMAX', ['a', 'b', 'c', 'd']]]),
    });
    expect(notes(m, window2)).toBe('IMAX');
  });

  it('reports a limited run', () => {
    const m = movie({ theaters: ['Regal Live Oak & RPX'], dates: window2 });
    expect(notes(m, window2)).toBe('Only at Regal Live Oak');
  });

  it('does not repeat the venue when a format covers the whole run', () => {
    // Regression: this produced "IMAX at Rivercenter, only at Rivercenter".
    const m = movie({
      theaters: ['AMC Rivercenter 11 with Alamo IMAX'],
      dates: window2,
      formats: new Map([['IMAX', ['AMC Rivercenter 11 with Alamo IMAX']]]),
    });
    expect(notes(m, window2)).toBe('IMAX, only at Rivercenter');
  });

  it('calls out a single-date event by date', () => {
    const m = movie({
      theaters: Array.from({ length: 8 }, (_, i) => `T${i}`),
      dates: ['2026-08-05'],
    });
    expect(notes(m, window2)).toBe('Wednesday only');
  });

  it('folds date and venue into one clause', () => {
    const m = movie({ theaters: ['Regal Live Oak & RPX'], dates: ['2026-08-05'] });
    expect(notes(m, window2)).toBe('Wednesday only at Regal Live Oak');
  });

  it('names weekdays when a movie plays several days of a longer window', () => {
    const window4 = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'];
    const m = movie({ theaters: ['Slab Cinema'], dates: ['2026-08-03', '2026-08-04'] });
    expect(notes(m, window4)).toBe('Monday and Tuesday only at Slab Cinema');
  });

  it('says nothing about dates when the movie plays the whole window', () => {
    const m = movie({ theaters: Array.from({ length: 9 }, (_, i) => `T${i}`), dates: window2 });
    expect(notes(m, window2)).toBe('');
  });

  it('keeps accessibility and language notes out unless asked', () => {
    const m = movie({
      theaters: Array.from({ length: 9 }, (_, i) => `T${i}`),
      dates: window2,
      optional: new Map([
        ['Open caption', ['Regal Live Oak & RPX']],
        ['Spanish dubbed', ['Regal Live Oak & RPX']],
      ]),
    });
    expect(notes(m, window2)).toBe('');
    expect(notes(m, window2, { ...OPTS, showAccessibility: true })).toBe(
      'Open caption at Regal Live Oak',
    );
    expect(notes(m, window2, { ...OPTS, showLanguage: true })).toBe(
      'Spanish dubbed at Regal Live Oak',
    );
  });
});

describe('timed bookings', () => {
  const week = dateRange('2026-08-03', '2026-08-09');
  const showing = (date: string, theater: string, times: string[]) => ({
    date,
    theater,
    times,
    format: null,
    sourceId: 'fandango',
  });
  const LIVE_OAK = 'Regal Live Oak & RPX';
  const PALLADIUM = 'Santikos Palladium IMAX';

  it('spells out a one-night booking with its time', () => {
    const m = movie({
      theaters: [LIVE_OAK],
      dates: ['2026-08-05'],
      showings: [showing('2026-08-05', LIVE_OAK, ['7:00p'])],
    });
    expect(notes(m, week)).toBe('Wednesday 7:00p at Regal Live Oak');
  });

  it('names each venue with its own time when they differ', () => {
    const m = movie({
      theaters: [LIVE_OAK, PALLADIUM],
      dates: ['2026-08-05'],
      showings: [
        showing('2026-08-05', LIVE_OAK, ['7:00p']),
        showing('2026-08-05', PALLADIUM, ['9:15p']),
      ],
    });
    expect(notes(m, week)).toBe('Wednesday at Regal Live Oak (7:00p) and Palladium (9:15p)');
  });

  it('spells out two nights at one venue', () => {
    const m = movie({
      theaters: [PALLADIUM],
      dates: ['2026-08-05', '2026-08-08'],
      showings: [
        showing('2026-08-05', PALLADIUM, ['9:15p']),
        showing('2026-08-08', PALLADIUM, ['2:00p']),
      ],
    });
    // The venue is named once, at the end, rather than after every night.
    expect(notes(m, week)).toBe('Wednesday 9:15p and Saturday 2:00p at Palladium');
  });

  it('gives up once the booking needs more than a couple of time lists', () => {
    // Two nights at two venues is four bracketed lists, which nobody reads.
    const m = movie({
      theaters: [LIVE_OAK, PALLADIUM],
      dates: ['2026-08-05', '2026-08-08'],
      showings: [
        showing('2026-08-05', LIVE_OAK, ['7:00p']),
        showing('2026-08-05', PALLADIUM, ['9:15p']),
        showing('2026-08-08', PALLADIUM, ['2:00p']),
      ],
    });
    expect(notes(m, week)).toBe('Wednesday and Saturday only at Regal Live Oak and Palladium');
  });

  it('falls back to dates when a calendar gave no time or the booking is busy', () => {
    const untimed = movie({
      theaters: [LIVE_OAK],
      dates: ['2026-08-05'],
      showings: [showing('2026-08-05', LIVE_OAK, [])],
    });
    expect(notes(untimed, week)).toBe('Wednesday only at Regal Live Oak');
    const busy = movie({
      theaters: [LIVE_OAK],
      dates: ['2026-08-05'],
      showings: [showing('2026-08-05', LIVE_OAK, ['1:00p', '4:00p', '7:00p'])],
    });
    expect(notes(busy, week)).toBe('Wednesday only at Regal Live Oak');
  });

  it('never times a film that plays the whole window', () => {
    const m = movie({
      theaters: [LIVE_OAK],
      dates: week,
      showings: week.map((d) => showing(d, LIVE_OAK, ['7:00p'])),
    });
    expect(notes(m, week)).toBe('Only at Regal Live Oak');
  });
});

describe('run gaps, history and markers', () => {
  const week = dateRange('2026-08-03', '2026-08-09');
  const wide = Array.from({ length: 9 }, (_, i) => `T${i}`);
  const withHistory = (
    m: AggregatedMovie,
    firstDate: string | null,
    watchedSince: string | null = '2026-07-01',
  ): string =>
    buildNotes(m, week, week[0] ?? '', week.at(-1) ?? '', OPTS, NAMES, undefined, {
      firstDate,
      watchedSince,
    });

  it('says except for a run that skips a day', () => {
    const m = movie({ theaters: wide, dates: week.filter((d) => d !== '2026-08-06') });
    expect(notes(m, week)).toBe('Except Thursday');
  });

  it('says new this week when the ledger dates the film inside the window', () => {
    const m = movie({ theaters: wide, dates: week });
    expect(withHistory(m, '2026-08-03')).toBe('New this week');
    expect(withHistory(m, '2026-07-01')).toBe('');
    expect(withHistory(m, null)).toBe('');
  });

  it('says nothing about a film first listed the day the ledger started', () => {
    // A ledger's first run sees every film in the market for the first time;
    // that is evidence of nothing.
    const m = movie({ theaters: wide, dates: week });
    expect(withHistory(m, '2026-08-03', '2026-08-03')).toBe('');
    expect(withHistory(m, '2026-08-03', null)).toBe('');
  });

  it('reads a late start as a span, not an opening, for a film already running', () => {
    const m = movie({ theaters: wide, dates: week.slice(2) });
    expect(withHistory(m, null)).toBe('Opens Wednesday');
    expect(withHistory(m, '2026-07-20')).toBe('Wednesday through Sunday');
  });

  it('describes a fixture as daily and never as opening or closing', () => {
    const m = movie({
      theaters: ['AMC Rivercenter 11 with Alamo IMAX'],
      dates: week.slice(0, 3),
      isFixture: true,
    });
    expect(notes(m, week)).toBe('Daily at Rivercenter');
  });

  it('names Q&A and early-access nights', () => {
    const m = movie({
      theaters: wide,
      dates: week,
      events: new Map([['Q&A', ['Regal Live Oak & RPX']]]),
      eventDates: new Map([['Q&A', ['2026-08-06']]]),
    });
    expect(notes(m, week)).toBe('Q&A Thursday at Regal Live Oak');
  });
});
