import { describe, expect, it } from 'vitest';
import {
  firstDates,
  isLedger,
  LEDGER_VERSION,
  updateLedger,
  watchedSince,
} from '../src/core/ledger.js';
import type { AggregatedMovie } from '../src/core/types.js';

const film = (key: string, dates: string[]): AggregatedMovie => ({
  key,
  title: key,
  href: `/${key}`,
  theaters: ['Palladium'],
  freeVenues: [],
  freeDates: [],
  dates,
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
});

const NOW = new Date('2026-09-09T01:00:00Z');

describe('updateLedger', () => {
  it('records the first and last date a film was ever listed for', () => {
    const ledger = updateLedger(
      null,
      [film('spiderman', ['2026-09-08', '2026-09-14'])],
      '2026-09-08',
      NOW,
    );
    expect(ledger.films['spiderman']).toEqual({
      title: 'spiderman',
      firstDate: '2026-09-08',
      lastDate: '2026-09-14',
      firstSeen: '2026-09-08',
      lastSeen: '2026-09-08',
    });
    expect(ledger.version).toBe(LEDGER_VERSION);
  });

  it('keeps the earliest first date across runs', () => {
    // A later run only sees today onward; the film did not start playing today.
    const first = updateLedger(null, [film('x', ['2026-09-01', '2026-09-07'])], '2026-09-01', NOW);
    const later = updateLedger(first, [film('x', ['2026-09-08', '2026-09-14'])], '2026-09-08', NOW);
    expect(later.films['x']?.firstDate).toBe('2026-09-01');
    expect(later.films['x']?.lastDate).toBe('2026-09-14');
    expect(later.films['x']?.firstSeen).toBe('2026-09-01');
    expect(later.films['x']?.lastSeen).toBe('2026-09-08');
  });

  it('leaves films the run did not see untouched', () => {
    // A calendar-only run must not erase what is known about the multiplexes.
    const first = updateLedger(null, [film('x', ['2026-09-01'])], '2026-09-01', NOW);
    const later = updateLedger(first, [film('y', ['2026-09-08'])], '2026-09-08', NOW);
    expect(Object.keys(later.films).sort()).toEqual(['x', 'y']);
  });

  it('forgets films whose last listing is old', () => {
    const first = updateLedger(null, [film('old', ['2026-01-01'])], '2026-01-01', NOW);
    const later = updateLedger(first, [], '2026-09-08', NOW);
    expect(later.films['old']).toBeUndefined();
  });

  it('a pre-sale is first seen before its first date', () => {
    const ledger = updateLedger(null, [film('presale', ['2026-10-02'])], '2026-09-08', NOW);
    expect(ledger.films['presale']?.firstSeen).toBe('2026-09-08');
    expect(ledger.films['presale']?.firstDate).toBe('2026-10-02');
  });
});

describe('how far back the ledger reaches', () => {
  it('remembers the earliest run day it ever folded in', () => {
    const first = updateLedger(null, [film('x', ['2026-09-08'])], '2026-09-08', NOW);
    expect(first.since).toBe('2026-09-08');
    const earlier = updateLedger(first, [film('x', ['2026-09-01'])], '2026-09-01', NOW);
    expect(earlier.since).toBe('2026-09-01');
    const later = updateLedger(earlier, [film('x', ['2026-09-15'])], '2026-09-15', NOW);
    expect(later.since).toBe('2026-09-01');
  });

  it('reports its reach only once it has one', () => {
    expect(watchedSince(null)).toBeNull();
    expect(watchedSince(updateLedger(null, [film('x', ['2026-09-08'])], '2026-09-08', NOW))).toBe(
      '2026-09-08',
    );
  });
});

describe('isLedger', () => {
  it('accepts what updateLedger writes and rejects the rest', () => {
    const ledger = updateLedger(null, [film('x', ['2026-09-08'])], '2026-09-08', NOW);
    expect(isLedger(JSON.parse(JSON.stringify(ledger)))).toBe(true);
    expect(isLedger({ version: 0, updatedAt: '', since: '', films: {} })).toBe(false);
    expect(isLedger({ version: LEDGER_VERSION, updatedAt: '', films: {} })).toBe(false);
    expect(
      isLedger({ version: LEDGER_VERSION, updatedAt: '', since: '', films: { x: { title: 'x' } } }),
    ).toBe(false);
    expect(isLedger(null)).toBe(false);
  });
});

describe('firstDates', () => {
  it('maps keys to first dates and is empty without a ledger', () => {
    const ledger = updateLedger(null, [film('x', ['2026-09-08'])], '2026-09-08', NOW);
    expect([...firstDates(ledger)]).toEqual([['x', '2026-09-08']]);
    expect(firstDates(null).size).toBe(0);
  });
});
