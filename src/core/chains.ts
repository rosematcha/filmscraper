import type { VenueDay } from './types.js';

/**
 * A cinema chain or venue operator, as the filter offers it.
 *
 * Multiplexes are identified from the theater name — Fandango has no operator
 * field — while the independent venues are identified from the source that
 * produced them, because a library screening is named after its branch and a
 * drive-in after itself.
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
 * classifier that only knew the long form would file both as unknown.
 */
export const CHAINS: readonly Chain[] = [
  { id: 'amc', label: 'AMC', pattern: /^amc\b|\brivercenter\b/ },
  { id: 'regal', label: 'Regal', pattern: /^regal\b|\balamo quarry\b|\bhuebner oaks\b/ },
  { id: 'cinemark', label: 'Cinemark', pattern: /\bcinemark\b/ },
  { id: 'alamo-drafthouse', label: 'Alamo Drafthouse', pattern: /\balamo\s+drafthouse\b/ },
  { id: 'flix', label: 'Flix Brewhouse', pattern: /\bflix\b/ },
  { id: 'santikos', label: 'Santikos', pattern: /\bsantikos\b|\bpalladium\b/ },
  { id: 'evo', label: 'EVO Entertainment', pattern: /\bevo\b/ },
  { id: 'city-base', label: 'City Base', pattern: /\bcity ?base\b/ },
  // Slab runs both the free outdoor screenings and the paid arthouse at Blue
  // Star, which the calendar names without saying "Slab".
  { id: 'slab', label: 'Slab Cinema', pattern: /\bslab\b|\barthouse at blue star\b/ },
  { id: 'stars-and-stripes', label: 'Stars & Stripes Drive-In', pattern: /\bdrive-?in\b/ },
  { id: 'library', label: 'San Antonio Public Library', pattern: /\blibrary\b/ },
];

/**
 * Sources whose venues belong to one operator whatever they are called.
 *
 * The library posts screenings under twenty branch names and Slab under the
 * name of whichever park it is in that week, so the source is the only
 * reliable handle.
 */
const SOURCE_CHAINS: Readonly<Record<string, string>> = {
  'stars-and-stripes': 'stars-and-stripes',
  sapl: 'library',
  'slab-arthouse': 'slab',
  'slab-outdoor': 'slab',
};

/** Venues no rule claims. Not offered as a filter; nothing has landed here yet. */
export const UNKNOWN_CHAIN = 'other';

/** Every chain the filter offers, in display order. */
export function chainIds(): string[] {
  return CHAINS.map((c) => c.id);
}

export function chainLabel(id: string): string {
  return CHAINS.find((c) => c.id === id)?.label ?? id;
}

/** The operator behind a venue, from its source when known and its name otherwise. */
export function chainOf(theaterName: string, sourceId?: string): string {
  const fromSource = sourceId === undefined ? undefined : SOURCE_CHAINS[sourceId];
  if (fromSource !== undefined) return fromSource;
  const name = theaterName.toLowerCase();
  return CHAINS.find((chain) => chain.pattern.test(name))?.id ?? UNKNOWN_CHAIN;
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
  const match = CHAINS.find(
    (chain) => chain.id === value || chain.label.toLowerCase().startsWith(value),
  );
  return match?.id ?? null;
}

/** True when this venue-day survives the exclusion list. */
export function keepsChain(day: VenueDay, excluded: ReadonlySet<string>): boolean {
  if (excluded.size === 0) return true;
  return !excluded.has(chainOf(day.theater.name, day.sourceId));
}
