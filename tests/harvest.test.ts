import { describe, expect, it } from 'vitest';
import {
  clampConcurrency,
  decideNextPage,
  MAX_CONCURRENCY,
} from '../src/sources/fandango/harvest.js';

describe('decideNextPage', () => {
  it('keeps paging while pages stay inside the radius', () => {
    expect(decideNextPage(10, 8.61, 15)).toBe('continue');
  });

  it('stops once a page runs past the radius', () => {
    // Page 2 for 78205 spans 9.83–16.15 mi; every later page is further still.
    expect(decideNextPage(10, 16.15, 15)).toBe('past-radius');
  });

  it('stops when a page repeats theaters already seen', () => {
    // Fandango's pager wraps to page 1 rather than ending. Without this the
    // scraper looped the same two pages twelve times per date.
    expect(decideNextPage(0, 8.61, 15)).toBe('exhausted');
  });

  it('treats exhaustion as the stronger signal', () => {
    expect(decideNextPage(0, 99, 15)).toBe('exhausted');
  });

  it('keeps a page that lands exactly on the radius', () => {
    expect(decideNextPage(10, 15, 15)).toBe('continue');
  });
});

describe('clampConcurrency', () => {
  it('defaults to serial when unset', () => {
    expect(clampConcurrency(undefined)).toBe(1);
    expect(clampConcurrency(Number.NaN)).toBe(1);
  });

  it('keeps a sensible request as-is', () => {
    expect(clampConcurrency(3)).toBe(3);
    expect(clampConcurrency(1)).toBe(1);
  });

  it('refuses to hammer the site', () => {
    expect(clampConcurrency(100)).toBe(MAX_CONCURRENCY);
    expect(clampConcurrency(0)).toBe(1);
    expect(clampConcurrency(-5)).toBe(1);
  });

  it('rounds fractional requests down', () => {
    expect(clampConcurrency(2.9)).toBe(2);
  });
});
