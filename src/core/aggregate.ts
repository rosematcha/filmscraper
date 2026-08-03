import { classifyAmenity } from './amenities.js';
import { displayTitle, mergeKey, movieIdFromHref } from './titles.js';
import type { AggregatedMovie, IsoDate, ShowtimeGroup, Theater, VenueDay } from './types.js';

export interface AliasConfig {
  /** Groups of Fandango movie ids to fold together regardless of title. */
  readonly merge: readonly (readonly string[])[];
  /** Groups of ids that must stay separate even if titles normalize alike. */
  readonly split: readonly (readonly string[])[];
  /** Full theater name -> short name for the Notes column. */
  readonly theaterNames: Readonly<Record<string, string>>;
}

export const EMPTY_ALIASES: AliasConfig = { merge: [], split: [], theaterNames: {} };

export interface AggregateOptions {
  readonly aliases: AliasConfig;
  readonly keepYears: boolean;
}

/** A group counts as live if anything in it has not already screened. */
export function isLive(group: ShowtimeGroup): boolean {
  return group.showtimes.some((s) => !s.expired);
}

/**
 * The single format a group represents.
 *
 * Fandango stacks amenities, so the IMAX 70MM group at Rivercenter also carries
 * plain `IMAX`. Taking only the rarest keeps "IMAX" meaning "IMAX, not 70MM" —
 * the venue still picks up a separate IMAX entry from its other group.
 */
function groupFormat(group: ShowtimeGroup): string | null {
  let best: { label: string; rank: number } | null = null;
  for (const amenity of group.amenities) {
    const c = classifyAmenity(amenity);
    if (c.cls !== 'format') continue;
    if (!best || c.rank < best.rank) best = { label: c.label, rank: c.rank };
  }
  if (!best && group.isDolby) return 'Dolby Cinema';
  return best?.label ?? null;
}

interface Accumulator {
  key: string;
  title: string;
  href: string;
  ids: Set<string>;
  hrefs: Set<string>;
  theaters: Set<string>;
  dates: Set<IsoDate>;
  formats: Map<string, Set<string>>;
  optional: Map<string, Set<string>>;
  isEvent: boolean;
}

function blank(key: string, title: string, href: string): Accumulator {
  return {
    key,
    title,
    href,
    ids: new Set(),
    hrefs: new Set(),
    theaters: new Set(),
    dates: new Set(),
    formats: new Map(),
    optional: new Map(),
    isEvent: false,
  };
}

function addTo(map: Map<string, Set<string>>, label: string, theater: string): void {
  const existing = map.get(label);
  if (existing) existing.add(theater);
  else map.set(label, new Set([theater]));
}

/**
 * Fold every venue-day into one entry per film.
 *
 * Movies whose showtimes have all expired are dropped: an 11pm run should not
 * claim a matinee is available.
 */
export function aggregate(
  venueDays: readonly VenueDay[],
  theaters: readonly Theater[],
  options: AggregateOptions,
): AggregatedMovie[] {
  const distanceByName = new Map(theaters.map((t) => [t.name, t.miles]));
  const byHref = new Map<string, Accumulator>();

  for (const day of venueDays) {
    for (const listing of day.movies) {
      const live = listing.groups.filter(isLive);
      if (live.length === 0) continue;

      let acc = byHref.get(listing.href);
      if (!acc) {
        acc = blank(mergeKey(listing.title), listing.title, listing.href);
        byHref.set(listing.href, acc);
      }
      const id = movieIdFromHref(listing.href);
      if (id) acc.ids.add(id);
      acc.hrefs.add(listing.href);
      acc.theaters.add(day.theater.name);
      acc.dates.add(day.date);

      for (const group of live) {
        const format = groupFormat(group);
        if (format) addTo(acc.formats, format, day.theater.name);
        for (const amenity of group.amenities) {
          const c = classifyAmenity(amenity);
          if (c.cls === 'access' || c.cls === 'language') {
            addTo(acc.optional, c.label, day.theater.name);
          } else if (c.cls === 'event') {
            acc.isEvent = true;
          }
        }
      }
    }
  }

  return mergeAccumulators([...byHref.values()], options, distanceByName);
}

/** Ids that an explicit `split` rule forbids from sharing an entry. */
function splitBarrier(aliases: AliasConfig): (a: Set<string>, b: Set<string>) => boolean {
  return (a, b) =>
    aliases.split.some(
      (group) =>
        group.some((id) => a.has(id)) &&
        group.some((id) => b.has(id)) &&
        // Only a barrier when the two sides sit on different ids of the group.
        ![...a].some((id) => b.has(id)),
    );
}

function mergeAccumulators(
  accumulators: readonly Accumulator[],
  options: AggregateOptions,
  distanceByName: ReadonlyMap<string, number>,
): AggregatedMovie[] {
  const { aliases, keepYears } = options;
  const isBarred = splitBarrier(aliases);

  // Forced merges take priority: map every id in a group to its group leader.
  const forcedLeader = new Map<string, string>();
  for (const group of aliases.merge) {
    const leader = group[0];
    if (leader === undefined) continue;
    for (const id of group) forcedLeader.set(id, leader);
  }

  const buckets: Accumulator[] = [];
  for (const acc of accumulators) {
    const forced = [...acc.ids].map((id) => forcedLeader.get(id)).find((v) => v !== undefined);
    const target = buckets.find((b) => {
      if (isBarred(b.ids, acc.ids)) return false;
      if (forced !== undefined) {
        return [...b.ids].some((id) => forcedLeader.get(id) === forced);
      }
      // Never auto-merge something an explicit rule already placed elsewhere.
      if ([...b.ids].some((id) => forcedLeader.has(id))) return false;
      return b.key === acc.key;
    });

    if (!target) {
      buckets.push(acc);
      continue;
    }
    // Shortest title wins: "Backrooms" reads better than the bonus-footage edition.
    if (acc.title.length < target.title.length) {
      target.title = acc.title;
      target.href = acc.href;
    }
    for (const id of acc.ids) target.ids.add(id);
    for (const href of acc.hrefs) target.hrefs.add(href);
    for (const t of acc.theaters) target.theaters.add(t);
    for (const d of acc.dates) target.dates.add(d);
    for (const [label, set] of acc.formats) for (const t of set) addTo(target.formats, label, t);
    for (const [label, set] of acc.optional) for (const t of set) addTo(target.optional, label, t);
    target.isEvent ||= acc.isEvent;
  }

  const byDistance = (a: string, b: string): number =>
    (distanceByName.get(a) ?? Infinity) - (distanceByName.get(b) ?? Infinity) || a.localeCompare(b);

  return buckets.map((acc) => ({
    key: acc.key,
    title: displayTitle(acc.title, keepYears),
    href: acc.href,
    theaters: [...acc.theaters].sort(byDistance),
    dates: [...acc.dates].sort(),
    formats: new Map([...acc.formats].map(([k, v]) => [k, [...v].sort(byDistance)])),
    optional: new Map([...acc.optional].map(([k, v]) => [k, [...v].sort(byDistance)])),
    isEvent: acc.isEvent,
    mergedHrefs: [...acc.hrefs].sort(),
  }));
}
