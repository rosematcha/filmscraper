import { describe, expect, it } from 'vitest';
import { freshnessLine, relativeAge, sourceFailures } from '../src/core/freshness.js';
import { freeEntry } from '../src/core/sections.js';
import { dayDetail, venueDetail } from '../src/core/views.js';
import type { Dataset } from '../src/core/dataset.js';
import type { AggregatedMovie, Showing } from '../src/core/types.js';

const showing = (date: string, theater: string, times: string[]): Showing => ({
  date,
  theater,
  times,
  format: null,
  labels: [],
  admission: 'unknown',
  sourceId: 'fandango',
});

const film = (showings: Showing[]): AggregatedMovie => ({
  key: 'x',
  title: 'X',
  href: '/x',
  theaters: [...new Set(showings.map((s) => s.theater))],
  freeVenues: [],
  freeDates: [],
  dates: [...new Set(showings.map((s) => s.date))].sort(),
  formats: new Map(),
  optional: new Map(),
  optionalDates: new Map(),
  isEvent: false,
  events: new Map(),
  eventDates: new Map(),
  showings,
  isFixture: false,
  sources: ['fandango'],
  languages: [],
  foreign: false,
  releaseYear: 2026,
  mergedHrefs: [],
  ticketLinks: [],
});

const short = (name: string): string => name.replace('Alamo Drafthouse ', '');
const WEEK = ['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];

describe('projected entries', () => {
  it('keeps only the free screenings in a free entry', () => {
    // The same venue can run a free night and a ticketed one; only the first
    // belongs under "Free screenings".
    const paid = { ...showing('2026-09-09', 'A', ['7:00p']), admission: 'paid' as const };
    const free = { ...showing('2026-09-10', 'A', ['8:00p']), admission: 'free' as const };
    const m = { ...film([paid, free]), freeVenues: ['A'], freeDates: ['2026-09-10'] };
    expect(freeEntry(m).showings.flatMap((s) => s.times)).toEqual(['8:00p']);
  });
});

describe('dayDetail', () => {
  it('names each venue with its times', () => {
    const m = film([
      showing('2026-09-09', 'Alamo Drafthouse Park North', ['7:00p']),
      showing('2026-09-09', 'Alamo Drafthouse Stone Oak', ['9:15p', '11:30p']),
    ]);
    expect(dayDetail(m, '2026-09-09', short)).toBe(
      '7:00p at Park North, 9:15p, 11:30p at Stone Oak',
    );
  });

  it('counts venues once there are too many to name', () => {
    const m = film(['A', 'B', 'C', 'D'].map((t) => showing('2026-09-09', t, ['7:00p'])));
    expect(dayDetail(m, '2026-09-09', short)).toBe('4 theaters');
  });

  it('counts showings past a handful and copes with a calendar that gave no time', () => {
    const busy = film([showing('2026-09-09', 'A', ['1p', '2p', '3p', '4p', '5p'])]);
    expect(dayDetail(busy, '2026-09-09', short)).toBe('5 showings at A');
    const untimed = film([showing('2026-09-09', 'A', [])]);
    expect(dayDetail(untimed, '2026-09-09', short)).toBe('A');
    expect(dayDetail(untimed, '2026-09-10', short)).toBe('');
  });
});

describe('venueDetail', () => {
  it('lists a short booking date by date with times', () => {
    const m = film([
      showing('2026-09-09', 'A', ['7:00p']),
      showing('2026-09-12', 'A', ['2:00p', '7:00p']),
    ]);
    expect(venueDetail(m, 'A', WEEK)).toBe('Wednesday 7:00p, Saturday 2:00p, 7:00p');
  });

  it('describes a run rather than listing it', () => {
    const daily = film(WEEK.map((d) => showing(d, 'A', ['7:00p'])));
    expect(venueDetail(daily, 'A', WEEK)).toBe('daily');
    const partial = film(WEEK.slice(1).map((d) => showing(d, 'A', ['7:00p'])));
    expect(venueDetail(partial, 'A', WEEK)).toBe('Thursday through Sunday');
    const gapped = film(
      WEEK.filter((d) => d !== '2026-09-11').map((d) => showing(d, 'A', ['7:00p'])),
    );
    expect(venueDetail(gapped, 'A', WEEK)).toBe('Wednesday, Thursday, Saturday and Sunday');
  });

  it('is empty for a venue the film does not play', () => {
    expect(venueDetail(film([showing('2026-09-09', 'A', ['7:00p'])]), 'B', WEEK)).toBe('');
  });
});

const dataset = (sources: Record<string, string>, warnings: Dataset['warnings'] = []): Dataset => ({
  version: 2,
  generatedAt: '2026-09-09T01:07:08.768Z',
  zip: '78205',
  from: '2026-09-08',
  to: '2026-10-08',
  radiusMiles: 35,
  horizon: '2026-09-16',
  knownFrom: '2026-09-09',
  days: [],
  warnings,
  sources: Object.fromEntries(
    Object.entries(sources).map(([id, updatedAt]) => [
      id,
      { updatedAt, from: '2026-09-08', to: '2026-10-08' },
    ]),
  ),
});

describe('relativeAge', () => {
  it('phrases the gap coarsely', () => {
    const now = new Date('2026-09-09T04:00:00Z');
    expect(relativeAge('2026-09-09T03:30:00Z', now)).toBe('just now');
    expect(relativeAge('2026-09-09T01:00:00Z', now)).toBe('3 hours ago');
    expect(relativeAge('2026-09-08T03:00:00Z', now)).toBe('yesterday');
    expect(relativeAge('2026-09-03T03:00:00Z', now)).toBe('6 days ago');
  });
});

describe('freshnessLine', () => {
  const now = new Date('2026-09-09T04:00:00Z');

  it('says only when everything ran together', () => {
    const d = dataset({ fandango: '2026-09-09T01:07:08.768Z', sapl: '2026-09-09T01:07:08.768Z' });
    expect(freshnessLine(d, now)).toBe('Updated 2 hours ago.');
  });

  it('names the sources that trail the run, newest first', () => {
    const d = dataset({
      fandango: '2026-09-09T01:07:08.768Z',
      mcnay: '2026-08-24T01:05:22.488Z',
      sapl: '2026-08-24T01:05:22.488Z',
      'stars-and-stripes': '2026-08-10T19:05:13.575Z',
    });
    expect(freshnessLine(d, now)).toBe(
      'Updated 2 hours ago; McNay and library last read August 24; drive-in last read August 10.',
    );
  });
});

describe('sourceFailures', () => {
  it('passes through page errors and nothing else', () => {
    const d = dataset({}, [
      { kind: 'page-error', message: 'Drive-in feed could not be read (HTTP 403 Forbidden).' },
      { kind: 'partial-horizon', message: 'posted through Wednesday' },
    ]);
    expect(sourceFailures(d)).toEqual(['Drive-in feed could not be read (HTTP 403 Forbidden).']);
  });
});
