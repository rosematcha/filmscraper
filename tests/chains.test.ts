import { describe, expect, it } from 'vitest';
import {
  CHAINS,
  INDEPENDENT_CHAIN,
  chainIds,
  chainLabel,
  chainOf,
  keepsChain,
  resolveChain,
} from '../src/core/chains.js';
import type { Theater } from '../src/core/types.js';

const theater = (name: string): Theater => ({ name, href: '', miles: 1 });

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
    expect(chainOf('Slab Cinema')).toBe('slab');
  });

  it('places the short display names Notes uses', () => {
    // `config/aliases.json` renders these instead of the full venue name.
    expect(chainOf('Alamo Quarry')).toBe('regal');
    expect(chainOf('Huebner Oaks')).toBe('regal');
    expect(chainOf('Rivercenter')).toBe('amc');
    expect(chainOf('Palladium')).toBe('santikos');
  });

  it('files unclaimed venues as independent', () => {
    expect(chainOf('Stars & Stripes Drive-In')).toBe(INDEPENDENT_CHAIN);
    expect(chainOf('San Antonio Central Library')).toBe(INDEPENDENT_CHAIN);
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
    expect(resolveChain('independent')).toBe(INDEPENDENT_CHAIN);
  });

  it('rejects what it cannot place', () => {
    expect(resolveChain('landmark')).toBeNull();
    expect(resolveChain('')).toBeNull();
  });
});

describe('keepsChain', () => {
  it('keeps everything when nothing is excluded', () => {
    expect(keepsChain(theater('AMC Rivercenter 11'), new Set())).toBe(true);
  });

  it('drops only the excluded operator', () => {
    const excluded = new Set(['amc', 'regal']);
    expect(keepsChain(theater('AMC Rivercenter 11'), excluded)).toBe(false);
    expect(keepsChain(theater('Regal Alamo Quarry'), excluded)).toBe(false);
    expect(keepsChain(theater('Santikos Galaxy'), excluded)).toBe(true);
  });
});

describe('chain listing', () => {
  it('lists every chain plus independent, with labels', () => {
    expect(chainIds()).toHaveLength(CHAINS.length + 1);
    expect(chainIds()).toContain(INDEPENDENT_CHAIN);
    expect(chainLabel('alamo-drafthouse')).toBe('Alamo Drafthouse');
    expect(chainLabel(INDEPENDENT_CHAIN)).toBe('Independent');
    expect(chainLabel('nope')).toBe('nope');
  });
});
