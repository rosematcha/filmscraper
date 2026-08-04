import { describe, expect, it } from 'vitest';
import {
  CHAINS,
  UNKNOWN_CHAIN,
  chainIds,
  chainLabel,
  chainOf,
  keepsChain,
  resolveChain,
} from '../src/core/chains.js';
import type { VenueDay } from '../src/core/types.js';

const venue = (name: string, sourceId = 'fandango'): VenueDay => ({
  theater: { name, href: '', miles: 1 },
  date: '2026-08-04',
  movies: [],
  sourceId,
});

describe('chainOf', () => {
  it('names the operator behind each San Antonio venue', () => {
    expect(chainOf('AMC Rivercenter 11 with Alamo IMAX')).toBe('amc');
    expect(chainOf('Regal Live Oak & RPX')).toBe('regal');
    expect(chainOf('Cinemark McCreless Market')).toBe('cinemark');
    expect(chainOf('Alamo Drafthouse Park North')).toBe('alamo-drafthouse');
    expect(chainOf('Flix Brewhouse San Antonio')).toBe('flix');
    expect(chainOf('Santikos Palladium IMAX')).toBe('santikos');
  });

  it('does not read "Alamo" as Alamo Drafthouse', () => {
    // Both carry the word without being the chain; the operator name wins.
    expect(chainOf('Regal Alamo Quarry')).toBe('regal');
    expect(chainOf('AMC Rivercenter 11 with Alamo IMAX')).toBe('amc');
  });

  it('recognises the local operators', () => {
    expect(chainOf('City Base Entertainment')).toBe('city-base');
    expect(chainOf('Arthouse at Blue Star')).toBe('slab');
  });

  it('takes the source over the name for the independent venues', () => {
    // The library posts under branch names and Slab under park names, so the
    // venue name alone would file them as unknown.
    expect(chainOf('Bazan Branch Library', 'sapl')).toBe('library');
    expect(chainOf('Travis Park', 'slab-outdoor')).toBe('slab');
    expect(chainOf('Arthouse at Blue Star', 'slab-arthouse')).toBe('slab');
    expect(chainOf('Stars & Stripes Drive-In', 'stars-and-stripes')).toBe('stars-and-stripes');
  });

  it('places the short display names Notes uses', () => {
    // `config/aliases.json` renders these instead of the full venue name.
    expect(chainOf('Alamo Quarry')).toBe('regal');
    expect(chainOf('Huebner Oaks')).toBe('regal');
    expect(chainOf('Rivercenter')).toBe('amc');
    expect(chainOf('Palladium')).toBe('santikos');
  });

  it('falls back to the name when the source says nothing', () => {
    expect(chainOf('Stars & Stripes Drive-In')).toBe('stars-and-stripes');
    expect(chainOf('San Antonio Central Library')).toBe('library');
    expect(chainOf('Some New Microcinema')).toBe(UNKNOWN_CHAIN);
  });

  it('ignores case', () => {
    expect(chainOf('santikos northwest 14')).toBe('santikos');
  });
});

describe('resolveChain', () => {
  it('takes an id or the start of a label', () => {
    expect(resolveChain('amc')).toBe('amc');
    expect(resolveChain('Alamo')).toBe('alamo-drafthouse');
    expect(resolveChain(' flix ')).toBe('flix');
    expect(resolveChain('San Antonio Public')).toBe('library');
  });

  it('rejects what it cannot place', () => {
    expect(resolveChain('landmark')).toBeNull();
    expect(resolveChain('')).toBeNull();
  });
});

describe('keepsChain', () => {
  it('keeps everything when nothing is excluded', () => {
    expect(keepsChain(venue('AMC Rivercenter 11'), new Set())).toBe(true);
  });

  it('drops only the excluded operator', () => {
    const excluded = new Set(['amc', 'regal']);
    expect(keepsChain(venue('AMC Rivercenter 11'), excluded)).toBe(false);
    expect(keepsChain(venue('Regal Alamo Quarry'), excluded)).toBe(false);
    expect(keepsChain(venue('Santikos Galaxy'), excluded)).toBe(true);
  });

  it('drops a library branch by its source', () => {
    expect(keepsChain(venue('Bazan Branch Library', 'sapl'), new Set(['library']))).toBe(false);
  });
});

describe('chain listing', () => {
  it('offers every chain by name, and no catch-all bucket', () => {
    expect(chainIds()).toEqual(CHAINS.map((c) => c.id));
    expect(chainIds()).not.toContain(UNKNOWN_CHAIN);
    expect(chainLabel('alamo-drafthouse')).toBe('Alamo Drafthouse');
    expect(chainLabel('stars-and-stripes')).toBe('Stars & Stripes Drive-In');
    expect(chainLabel('nope')).toBe('nope');
  });
});
