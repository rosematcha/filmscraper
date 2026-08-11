import { describe, expect, it } from 'vitest';
import { classifyRun, detectFrontier } from '../src/core/run.js';
import { dateRange } from '../src/core/notes.js';

const WEEK = dateRange('2026-08-03', '2026-08-09');

/** A window whose schedule is fully posted, which is the simple case. */
const posted = { windowDates: WEEK, knownFrom: '2026-08-03', horizon: '2026-08-09' };

describe('classifyRun', () => {
  it('says nothing about a film that plays the whole window', () => {
    expect(classifyRun(WEEK, posted).shape).toBe('throughout');
  });

  it('calls a run that starts partway through an opening', () => {
    const from = WEEK.slice(2);
    expect(classifyRun(from, posted)).toEqual({ shape: 'opens', date: '2026-08-05' });
  });

  it('calls a run that stops before the horizon a closing', () => {
    const until = WEEK.slice(0, 4);
    expect(classifyRun(until, posted)).toEqual({ shape: 'closing', date: '2026-08-06' });
  });

  it('does not call an unposted Friday a closing', () => {
    // The whole point of the horizon: Fandango publishes weekly, and a film
    // whose listings stop where the schedule stops is not ending its run.
    const partial = { ...posted, horizon: '2026-08-06' };
    expect(classifyRun(WEEK.slice(0, 4), partial).shape).toBe('throughout');
  });

  it('needs a few days before it describes a run at all', () => {
    // Two nights read better enumerated than as "through Tuesday".
    expect(classifyRun(WEEK.slice(0, 2), posted).shape).toBe('listed');
  });

  it('treats a single date as a single date, wherever it falls', () => {
    expect(classifyRun(['2026-08-09'], posted)).toEqual({ shape: 'single', date: '2026-08-09' });
    expect(classifyRun(['2026-08-05'], posted).shape).toBe('single');
  });

  it('reads a pre-sale that covers the rest of the window as an opening', () => {
    // On sale before the schedule is posted: nothing inside the reliable range,
    // but it plays every remaining day, which is an opening and not a limited
    // engagement.
    const unposted = { windowDates: WEEK, knownFrom: '2026-08-03', horizon: '2026-08-04' };
    expect(classifyRun(WEEK.slice(4), unposted)).toEqual({
      shape: 'presale-opens',
      date: '2026-08-07',
    });
  });

  it('has nothing to say about an empty run or an empty window', () => {
    expect(classifyRun([], posted).shape).toBe('none');
    expect(classifyRun(WEEK, { windowDates: [], knownFrom: '', horizon: '' }).shape).toBe('none');
  });

  // The frontier cases: a month-long window where the horizon covers two days
  // but the broad schedule is demonstrably posted through the 20th.
  const MONTH = dateRange('2026-08-10', '2026-09-09');
  const scraped = {
    windowDates: MONTH,
    knownFrom: '2026-08-11',
    horizon: '2026-08-12',
    frontier: '2026-08-20',
  };

  it('calls a run that ends while the rest of the schedule goes on a closing', () => {
    // Obsession: a long run whose last date sits inside the horizon. Its
    // absence afterwards is meaningful because the frontier reaches past it.
    expect(classifyRun(dateRange('2026-08-10', '2026-08-12'), scraped)).toEqual({
      shape: 'closing',
      date: '2026-08-12',
    });
  });

  it('sees a run end past the horizon but short of the frontier', () => {
    // Moana: ends the 13th, one day beyond the horizon. Still a closing,
    // because twenty other films play through the 20th.
    expect(classifyRun(dateRange('2026-08-10', '2026-08-13'), scraped)).toEqual({
      shape: 'closing',
      date: '2026-08-13',
    });
  });

  it('treats a pre-sale past the horizon as continuation, not closing', () => {
    // Nimrods: a Tuesday preview inside the horizon, then an unbroken run on
    // sale through the frontier. The preview must not read as a dying run —
    // this is an opening, dated to the day the run proper starts.
    const nimrods = ['2026-08-11', ...dateRange('2026-08-13', '2026-08-20')];
    expect(classifyRun(nimrods, scraped)).toEqual({ shape: 'opens', date: '2026-08-13' });
  });

  it('keeps a film that runs to the frontier out of the closing bucket', () => {
    expect(classifyRun(dateRange('2026-08-10', '2026-08-20'), scraped).shape).toBe('throughout');
  });

  it('still declines to call an ending without frontier evidence', () => {
    // Same dates, no frontier: the film stops where the horizon stops, and
    // nothing distinguishes that from an unposted schedule.
    const { frontier, ...bare } = scraped;
    void frontier;
    expect(classifyRun(dateRange('2026-08-10', '2026-08-12'), bare).shape).toBe('throughout');
  });

  it('calls a two-day run closing when it fills the whole known range', () => {
    // Obsession after aggregation: today's showtimes are gone, leaving only
    // the two known days — which it plays in full before vanishing.
    expect(classifyRun(['2026-08-11', '2026-08-12'], scraped)).toEqual({
      shape: 'closing',
      date: '2026-08-12',
    });
  });

  it('leaves scattered dates enumerated even when they end early', () => {
    // A twice-a-week repertory booking is not a closing run.
    expect(classifyRun(['2026-08-11', '2026-08-13', '2026-08-15'], scraped).shape).toBe('listed');
  });
});

describe('detectFrontier', () => {
  const MONTH = dateRange('2026-08-10', '2026-09-09');

  /** N titles playing every day of `span`. */
  const cohort = (n: number, from: string, to: string): string[][] =>
    Array.from({ length: n }, () => dateRange(from, to));

  it('finds the posting cliff where most titles stop', () => {
    // Twenty wide releases posted through the 20th, a handful of pre-sold
    // events past it: the frontier is the 20th, not the events' September.
    const titles = [...cohort(20, '2026-08-10', '2026-08-20'), ...cohort(3, '2026-08-10', '2026-09-05')];
    expect(detectFrontier(titles, MONTH, '2026-08-11', '2026-08-12')).toBe('2026-08-20');
  });

  it('never reaches past a genuine falloff', () => {
    const titles = [...cohort(10, '2026-08-10', '2026-08-13'), ...cohort(2, '2026-08-10', '2026-08-30')];
    expect(detectFrontier(titles, MONTH, '2026-08-11', '2026-08-12')).toBe('2026-08-13');
  });

  it('falls back to the horizon with nothing to judge by', () => {
    expect(detectFrontier([], MONTH, '2026-08-11', '2026-08-12')).toBe('2026-08-12');
  });
});
