import { describe, expect, it } from 'vitest';
import { DiskCache } from '../src/net/cache.js';

/** Namespaced per test so a run never reads what another one wrote. */
const cache = (name: string): DiskCache => new DiskCache(`test-${name}`);

describe('DiskCache', () => {
  it('computes once and serves the stored answer afterwards', async () => {
    const disk = cache('hit');
    const key = `zip-${String(process.pid)}-hit`;
    let calls = 0;
    const compute = async (): Promise<number> => {
      calls++;
      return Promise.resolve(42);
    };

    expect(await disk.wrap(key, compute)).toBe(42);
    expect(await disk.wrap(key, compute)).toBe(42);
    expect(calls).toBe(1);
  });

  it('retries a failed lookup instead of remembering the failure', async () => {
    // A null here is a geocode that did not answer, not a venue without
    // coordinates. Stored in a cache that never expires it would drop that
    // venue from every run afterwards — the one error worth paying to avoid.
    const disk = cache('null');
    const key = `zip-${String(process.pid)}-null`;
    let calls = 0;
    const flaky = async (): Promise<{ lat: number } | null> => {
      calls++;
      return Promise.resolve(calls === 1 ? null : { lat: 29.42 });
    };

    expect(await disk.wrap(key, flaky)).toBeNull();
    expect(await disk.wrap(key, flaky)).toEqual({ lat: 29.42 });
    expect(await disk.wrap(key, flaky)).toEqual({ lat: 29.42 });
    expect(calls).toBe(2);
  });
});
