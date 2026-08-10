import { describe, expect, it } from 'vitest';
import { buildNotes, dateRange, humanList } from '../src/core/notes.js';
import { DEFAULT_RENDER_OPTIONS, type AggregatedMovie, type RenderOptions } from '../src/core/types.js';

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
    dates: [],
    formats: new Map(),
    optional: new Map(),
    optionalDates: new Map(),
    isEvent: false,
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
    expect(dateRange('2026-08-30', '2026-09-01')).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
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
        ['IMAX', ['Santikos Palladium IMAX', 'Regal Live Oak & RPX', 'AMC Rivercenter 11 with Alamo IMAX']],
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
    expect(notes(m, window2)).toBe('August 5 only');
  });

  it('folds date and venue into one clause', () => {
    const m = movie({ theaters: ['Regal Live Oak & RPX'], dates: ['2026-08-05'] });
    expect(notes(m, window2)).toBe('August 5 only at Regal Live Oak');
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
