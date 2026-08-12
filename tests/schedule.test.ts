import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeDataset, DATASET_VERSION, type Dataset } from '../src/core/dataset.js';
import {
  allSources,
  describeSchedule,
  dueSources,
  isComprehensiveFandangoRun,
  runSlots,
} from '../src/core/schedule.js';
import type { VenueDay } from '../src/core/types.js';

/** A UTC instant on a given weekday, 0 = Sunday. */
const at = (day: number, hour: number): Date => {
  // 2026-08-02 is a Sunday, so adding the index lands on the right weekday.
  const base = Date.UTC(2026, 7, 2 + day, hour);
  return new Date(base);
};

/** Every hour of a UTC day, for exhaustive "must not run" sweeps. */
const ALL_HOURS = Array.from({ length: 24 }, (_, h) => h);

describe('dueSources', () => {
  it('marks only Monday and Thursday evening as comprehensive Fandango runs', () => {
    expect(isComprehensiveFandangoRun(at(1, 18))).toBe(true);
    expect(isComprehensiveFandangoRun(at(4, 18))).toBe(true);
    expect(isComprehensiveFandangoRun(at(2, 18))).toBe(false);
    expect(isComprehensiveFandangoRun(at(1, 17))).toBe(false);
  });

  it('runs Fandango once on Monday and once on Thursday', () => {
    for (const day of [1, 4]) {
      expect(dueSources(at(day, 18)), `day ${String(day)} 18:00`).toContain('fandango');
      for (const hour of ALL_HOURS.filter((h) => h !== 18)) {
        expect(dueSources(at(day, hour)), `day ${String(day)} ${String(hour)}:00`).not.toContain(
          'fandango',
        );
      }
    }
  });

  it('watches Fandango hourly from Tuesday noon to Wednesday noon', () => {
    // 17:00 UTC is noon CDT. Nineteen slots: 25 hours less the six dark ones.
    const window = [
      ...[17, 18, 19, 20, 21, 22, 23].map((h) => [2, h] as const),
      ...[0, 1, 2, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((h) => [3, h] as const),
    ];
    expect(window).toHaveLength(19);
    for (const [day, hour] of window) {
      expect(dueSources(at(day, hour)), `day ${String(day)} ${String(hour)}:00`).toContain(
        'fandango',
      );
    }
  });

  it('goes dark from 10pm Tuesday to 4am Wednesday', () => {
    // Wed 03:00–08:00 UTC is Tue 10pm – Wed 3am CDT; the 4am slot resumes at 09:00.
    for (const hour of [3, 4, 5, 6, 7, 8]) {
      expect(dueSources(at(3, hour)), `Wed ${String(hour)}:00`).toEqual([]);
    }
    expect(dueSources(at(3, 9))).toContain('fandango');
  });

  it('leaves Fandango alone for the rest of the week', () => {
    for (const day of [0, 5, 6]) {
      for (const hour of ALL_HOURS) {
        expect(dueSources(at(day, hour)), `day ${String(day)} ${String(hour)}:00`).not.toContain(
          'fandango',
        );
      }
    }
  });

  it('runs the venue calendars weekly on Sunday only', () => {
    const weekly = [
      'slab-arthouse',
      'slab-outdoor',
      'mission-marquee',
      'tobin-cinema',
      'mcnay',
      'ruby-city',
    ];
    expect(dueSources(at(0, 18))).toEqual(expect.arrayContaining(weekly));
    for (const day of [1, 2, 3, 4, 5, 6]) {
      for (const id of weekly) {
        expect(dueSources(at(day, 18)), `${id} on day ${String(day)}`).not.toContain(id);
      }
    }
  });

  it('runs the drive-in and library on Sunday and Thursday', () => {
    for (const day of [0, 4]) {
      expect(dueSources(at(day, 18))).toEqual(
        expect.arrayContaining(['stars-and-stripes', 'sapl']),
      );
    }
    for (const day of [1, 2, 3, 5, 6]) {
      expect(dueSources(at(day, 18)), `day ${String(day)}`).not.toContain('stars-and-stripes');
      expect(dueSources(at(day, 18)), `day ${String(day)}`).not.toContain('sapl');
    }
  });

  it('is empty off the scheduled hours', () => {
    expect(dueSources(at(1, 3))).toEqual([]);
    expect(dueSources(at(4, 17))).toEqual([]);
  });

  it('covers every calendar source on a Sunday evening', () => {
    // The one slot where the venue calendars line up. Fandango sits it out; its
    // week starts Monday evening.
    const expected = allSources().filter((id) => id !== 'fandango');
    expect(dueSources(at(0, 18)).sort()).toEqual(expected);
  });

  it('describes each cadence in plain words', () => {
    expect(describeSchedule('fandango')).toMatch(/Monday and Thursday/);
    expect(describeSchedule('slab-arthouse')).toMatch(/Sunday/);
    expect(describeSchedule('unknown-source')).toBe('on demand');
  });
});

describe('workflow cron', () => {
  /** Expand a `0 <hours> * * <days>` field list, e.g. `0-2,9-17`. */
  const expand = (field: string): number[] =>
    field.split(',').flatMap((part) => {
      const [from, to] = part.split('-').map(Number);
      if (from === undefined || Number.isNaN(from)) throw new Error(`bad cron field: ${field}`);
      const end = to ?? from;
      return Array.from({ length: end - from + 1 }, (_, i) => from + i);
    });

  it('fires at exactly the slots some source is due', () => {
    const yaml = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8');
    const crons = [...yaml.matchAll(/^\s*- cron: '([^']+)'/gm)].map((m) => m[1] ?? '');
    expect(crons.length).toBeGreaterThan(0);

    const fired = new Set<string>();
    for (const cron of crons) {
      const [minute, hourField, , , dayField] = cron.split(' ');
      // A non-zero minute would drift the run out of its scheduled hour.
      expect(minute, cron).toBe('0');
      for (const day of expand(dayField ?? '')) {
        for (const hour of expand(hourField ?? '')) fired.add(`${String(day)}:${String(hour)}`);
      }
    }

    // Set equality both ways: a missing cron slot silently never runs, and an
    // extra one boots a runner that scrapes nothing.
    expect([...fired].sort()).toEqual([...runSlots()].sort());
  });
});

const day = (sourceId: string | undefined, date: string): VenueDay => ({
  theater: { name: `T-${sourceId ?? 'fandango'}`, href: '', miles: 1 },
  date,
  movies: [],
  ...(sourceId ? { sourceId } : {}),
});

const base = (over: Partial<Dataset> = {}): Dataset => ({
  version: DATASET_VERSION,
  generatedAt: '2026-08-01T18:00:00.000Z',
  zip: '78205',
  from: '2026-08-01',
  to: '2026-08-31',
  radiusMiles: 35,
  horizon: '2026-08-08',
  knownFrom: '2026-08-01',
  // Dates inside the window the next run will use, so only the source that
  // re-ran is replaced rather than everything ageing out.
  days: [
    day(undefined, '2026-08-01'),
    day('sapl', '2026-08-05'),
    day('slab-arthouse', '2026-08-06'),
  ],
  warnings: [],
  sources: {},
  ...over,
});

describe('mergeDataset', () => {
  const now = new Date('2026-08-03T18:00:00.000Z');
  const fresh = {
    days: [day(undefined, '2026-08-03')],
    warnings: [],
    sourceIds: ['fandango'],
    from: '2026-08-03',
    to: '2026-09-02',
    zip: '78205',
    radiusMiles: 35,
    horizon: '2026-08-10',
    knownFrom: '2026-08-03',
  };

  it('keeps sources that did not run', () => {
    // A Fandango-only run must not drop the library and arthouse data.
    const merged = mergeDataset(base(), fresh, now);
    const ids = merged.days.map((d) => d.sourceId ?? 'fandango').sort();
    expect(ids).toEqual(['fandango', 'sapl', 'slab-arthouse']);
  });

  it('replaces the source that did run', () => {
    const merged = mergeDataset(base(), fresh, now);
    const fandangoDays = merged.days.filter((d) => (d.sourceId ?? 'fandango') === 'fandango');
    // The old 2026-08-01 entry is gone, not duplicated.
    expect(fandangoDays.map((d) => d.date)).toEqual(['2026-08-03']);
  });

  it('drops carried dates that have fallen out of the window', () => {
    const merged = mergeDataset(
      base({ days: [day('sapl', '2026-08-01'), day('sapl', '2026-08-05')] }),
      fresh,
      now,
    );
    expect(merged.days.filter((d) => d.sourceId === 'sapl').map((d) => d.date)).toEqual([
      '2026-08-05',
    ]);
  });

  it('stamps only the sources that ran', () => {
    const merged = mergeDataset(base(), fresh, now);
    expect(merged.sources['fandango']?.updatedAt).toBe(now.toISOString());
    expect(merged.sources['sapl']).toBeUndefined();
  });

  it('keeps last-known-good rows and freshness when a source fails', () => {
    const priorStamp = {
      updatedAt: '2026-08-02T18:00:00.000Z',
      from: '2026-08-02',
      to: '2026-09-01',
    };
    const previous = base({
      days: [day(undefined, '2026-08-04'), day('sapl', '2026-08-05')],
      sources: { fandango: priorStamp },
    });
    const failed = {
      ...fresh,
      failedSourceIds: ['fandango'],
      days: [day(undefined, '2026-08-03')],
    };

    const merged = mergeDataset(previous, failed, now);
    expect(merged.days.filter((d) => d.sourceId === undefined).map((d) => d.date)).toEqual([
      '2026-08-04',
    ]);
    expect(merged.sources['fandango']).toEqual(priorStamp);
    expect(merged.horizon).toBe('2026-08-08');
  });

  it('preserves earlier stamps across runs', () => {
    const withStamp = base({
      sources: {
        sapl: { updatedAt: '2026-08-01T18:00:00.000Z', from: '2026-08-01', to: '2026-08-31' },
      },
    });
    const merged = mergeDataset(withStamp, fresh, now);
    expect(merged.sources['sapl']?.updatedAt).toBe('2026-08-01T18:00:00.000Z');
    expect(merged.sources['fandango']?.updatedAt).toBe(now.toISOString());
  });

  it('clears page errors after a successful later run', () => {
    const previous = base({
      warnings: [{ kind: 'page-error', message: 'McNay could not be read.' }],
    });
    expect(mergeDataset(previous, fresh, now).warnings).toEqual([]);
  });

  it('starts clean when the previous run used a different radius', () => {
    // Blending a 15 mi history into a 35 mi run would leave phantom gaps.
    const merged = mergeDataset(base({ radiusMiles: 15 }), fresh, now);
    expect(merged.days).toHaveLength(1);
    expect(merged.sources['sapl']).toBeUndefined();
  });

  it('takes the horizon from a run that measured it', () => {
    const merged = mergeDataset(base(), fresh, now);
    expect(merged.horizon).toBe('2026-08-10');
    expect(merged.knownFrom).toBe('2026-08-03');
  });

  it('keeps the carried horizon when Fandango did not run', () => {
    // A library-only run finds no posting boundary and so reports the end of
    // its window. Believing that would claim the multiplexes have posted a
    // month ahead, and every unposted Friday would read as a run ending.
    const libraryOnly = { ...fresh, sourceIds: ['sapl'], horizon: '2026-09-02' };
    const merged = mergeDataset(base(), libraryOnly, now);
    expect(merged.horizon).toBe('2026-08-08');
  });

  it('does not resurrect a horizon from before the window', () => {
    const libraryOnly = { ...fresh, sourceIds: ['sapl'], horizon: '2026-09-02' };
    const merged = mergeDataset(base({ horizon: '2026-07-20' }), libraryOnly, now);
    expect(merged.horizon).toBe('2026-08-03');
  });

  it('keeps the later first-reliable date when Fandango did not run', () => {
    // Today is thinned by showtimes that have already started; a partial run
    // that cannot see that must not widen what counts as known.
    const libraryOnly = { ...fresh, sourceIds: ['sapl'] };
    const merged = mergeDataset(base({ knownFrom: '2026-08-04' }), libraryOnly, now);
    expect(merged.knownFrom).toBe('2026-08-04');
  });

  it('handles having no previous dataset at all', () => {
    const merged = mergeDataset(null, fresh, now);
    expect(merged.days).toHaveLength(1);
    expect(merged.version).toBe(DATASET_VERSION);
  });
});
