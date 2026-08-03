import { describe, expect, it } from 'vitest';
import { decideNextPage } from '../src/sources/fandango/harvest.js';

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
