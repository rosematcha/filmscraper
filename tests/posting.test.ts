import { describe, expect, it } from 'vitest';
import { laggingSources, postingSnapshot, type PostingSnapshot } from '../src/core/posting.js';
import { memoryKv } from '../src/store/kv.js';
import { readHistory, recordSnapshot } from '../src/store/history.js';
import type { VenueDay } from '../src/core/types.js';

const theater = { name: 'Palladium', href: '/palladium', miles: 5 };

/** One venue-day carrying `count` listings. */
const day = (date: string, count: number, sourceId?: string): VenueDay =>
  ({
    date,
    theater,
    movies: Array.from({ length: count }, (_, i) => ({ title: `Film ${String(i)}`, groups: [] })),
    ...(sourceId === undefined ? {} : { sourceId }),
  }) as unknown as VenueDay;

describe('postingSnapshot', () => {
  it('counts unbroken days from today, not the furthest date', () => {
    // The event-calendar trap: one screening a month out says nothing about
    // whether next week is posted.
    const days = [day('2026-08-10', 2, 'mission-marquee'), day('2026-09-05', 1, 'mission-marquee')];
    const [source] = postingSnapshot(days, '2026-08-10').sources;
    expect(source).toMatchObject({
      sourceId: 'mission-marquee',
      lastDate: '2026-09-05',
      reachDays: 26,
      contiguousDays: 1,
      datesListed: 2,
      listings: 3,
    });
  });

  it('follows a weekly grid to the end of its posted run', () => {
    const days = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13'].map((d) => day(d, 20));
    const [source] = postingSnapshot(days, '2026-08-10').sources;
    expect(source?.contiguousDays).toBe(4);
    expect(source?.solidDays).toBe(4);
    expect(source?.sourceId).toBe('fandango');
  });

  it('stops counting solid days where the grid thins to pre-sales', () => {
    // The failure the live data exposed: an unbroken chain of dates says
    // nothing when the tail is one ticket a day.
    const days = [
      day('2026-08-10', 40),
      day('2026-08-11', 38),
      day('2026-08-12', 3),
      day('2026-08-13', 2),
    ];
    const [source] = postingSnapshot(days, '2026-08-10').sources;
    expect(source?.contiguousDays).toBe(4);
    expect(source?.solidDays).toBe(2);
  });

  it('reports nothing posted when today itself is empty', () => {
    const [source] = postingSnapshot([day('2026-08-12', 5)], '2026-08-10').sources;
    expect(source?.contiguousDays).toBe(0);
    expect(source?.reachDays).toBe(2);
  });

  it('stops at the first gap', () => {
    const days = [day('2026-08-10', 3), day('2026-08-11', 3), day('2026-08-14', 3)];
    expect(postingSnapshot(days, '2026-08-10').sources[0]?.contiguousDays).toBe(2);
  });

  it('keeps sources apart and ignores empty days', () => {
    const days = [day('2026-08-10', 4), day('2026-08-10', 2, 'sapl'), day('2026-08-11', 0, 'sapl')];
    const snapshot = postingSnapshot(days, '2026-08-10');
    expect(snapshot.sources.map((s) => s.sourceId)).toEqual(['fandango', 'sapl']);
    expect(snapshot.sources.find((s) => s.sourceId === 'sapl')?.contiguousDays).toBe(1);
  });
});

describe('laggingSources', () => {
  const snap = (id: string, contiguousDays: number): PostingSnapshot => ({
    today: '2026-08-10',
    sources: [
      {
        sourceId: id,
        lastDate: '2026-08-10',
        reachDays: 0,
        contiguousDays,
        solidDays: contiguousDays,
        datesListed: 1,
        listings: 1,
      },
    ],
  });

  it('names a source posting well short of its usual depth', () => {
    const history = [snap('fandango', 10), snap('fandango', 12), snap('fandango', 11)];
    expect(laggingSources(snap('fandango', 3), history)).toEqual([
      { sourceId: 'fandango', now: 3, typical: 11 },
    ]);
  });

  it('stays quiet within tolerance', () => {
    const history = [snap('fandango', 10), snap('fandango', 12), snap('fandango', 11)];
    expect(laggingSources(snap('fandango', 8), history)).toEqual([]);
  });

  it('says nothing about a source it has never seen before', () => {
    expect(laggingSources(snap('new-source', 1), [snap('fandango', 10)])).toEqual([]);
  });

  it('is not moved by one bad scrape in the history', () => {
    // Median, not mean: a single zero must not drag the baseline down.
    const history = [snap('sapl', 7), snap('sapl', 0), snap('sapl', 7), snap('sapl', 8)];
    expect(laggingSources(snap('sapl', 2), history)).toHaveLength(1);
  });
});

describe('history store', () => {
  it('keeps every run and reads them back oldest first', async () => {
    const kv = memoryKv();
    await recordSnapshot(kv, { today: '2026-08-10', sources: [] }, '2026-08-10T12:00:00.000Z');
    await recordSnapshot(kv, { today: '2026-08-11', sources: [] }, '2026-08-11T12:00:00.000Z');

    const history = await readHistory(kv);
    expect(history.map((h) => h.today)).toEqual(['2026-08-10', '2026-08-11']);
  });

  it('skips a corrupted entry rather than failing the read', async () => {
    const kv = memoryKv();
    await recordSnapshot(kv, { today: '2026-08-10', sources: [] }, '2026-08-10T12:00:00.000Z');
    await kv.set('snapshot/2026-08-11T12:00:00.000Z', '{ truncated');

    expect(await readHistory(kv)).toHaveLength(1);
  });
});
