import type { Theater } from './types.js';

/**
 * A cinema chain, identified from the theater name a source reports.
 *
 * Names are the only stable handle: Fandango has no operator field, and the
 * independent sources report a venue name and nothing else.
 */
export interface Chain {
  readonly id: string;
  readonly label: string;
  /** Tested against the theater name, first match wins. */
  readonly pattern: RegExp;
}

/**
 * Order matters. "Regal Alamo Quarry" and "AMC Rivercenter 11 with Alamo IMAX"
 * both carry the word Alamo without being Alamo Drafthouse, so the operator
 * chains are tested before it.
 *
 * The short display names from `config/aliases.json` are matched too — Notes
 * calls the Quarry "Alamo Quarry" and the Palladium just "Palladium", and a
 * classifier that only knew the long form would file both as independent.
 */
export const CHAINS: readonly Chain[] = [
  { id: 'amc', label: 'AMC', pattern: /^amc\b|\brivercenter\b/ },
  { id: 'regal', label: 'Regal', pattern: /^regal\b|\balamo quarry\b|\bhuebner oaks\b/ },
  { id: 'cinemark', label: 'Cinemark', pattern: /\bcinemark\b/ },
  { id: 'alamo-drafthouse', label: 'Alamo Drafthouse', pattern: /\balamo\s+drafthouse\b/ },
  { id: 'flix', label: 'Flix Brewhouse', pattern: /\bflix\b/ },
  { id: 'santikos', label: 'Santikos', pattern: /\bsantikos\b|\bpalladium\b/ },
  { id: 'evo', label: 'EVO Entertainment', pattern: /\bevo\b/ },
  // Local operators. Slab runs both the free outdoor screenings and the paid
  // arthouse at Blue Star, which the calendar names without saying "Slab".
  { id: 'city-base', label: 'City Base', pattern: /\bcity ?base\b/ },
  { id: 'slab', label: 'Slab Cinema', pattern: /\bslab\b|\barthouse at blue star\b/ },
];

/** Everything the patterns do not claim: one-off venues, libraries, the drive-in. */
export const INDEPENDENT_CHAIN = 'independent';

export const INDEPENDENT_LABEL = 'Independent';

export function chainIds(): string[] {
  return [...CHAINS.map((c) => c.id), INDEPENDENT_CHAIN];
}

export function chainLabel(id: string): string {
  if (id === INDEPENDENT_CHAIN) return INDEPENDENT_LABEL;
  return CHAINS.find((c) => c.id === id)?.label ?? id;
}

/** The chain a venue belongs to, or `independent` when none claims it. */
export function chainOf(theaterName: string): string {
  const name = theaterName.toLowerCase();
  return CHAINS.find((chain) => chain.pattern.test(name))?.id ?? INDEPENDENT_CHAIN;
}

/**
 * Resolve a user-typed chain id or name.
 *
 * The CLI takes `--exclude-chains amc,alamo` from memory, so a prefix of the
 * label is accepted alongside the exact id.
 */
export function resolveChain(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (value === '') return null;
  if (value === INDEPENDENT_CHAIN) return INDEPENDENT_CHAIN;
  const match = CHAINS.find(
    (chain) => chain.id === value || chain.label.toLowerCase().startsWith(value),
  );
  return match?.id ?? null;
}

/** True when this venue survives the exclusion list. */
export function keepsChain(theater: Theater, excluded: ReadonlySet<string>): boolean {
  if (excluded.size === 0) return true;
  return !excluded.has(chainOf(theater.name));
}
