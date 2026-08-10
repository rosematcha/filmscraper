import { describe, expect, it } from 'vitest';
import { classifyRun } from '../src/core/run.js';
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
});
