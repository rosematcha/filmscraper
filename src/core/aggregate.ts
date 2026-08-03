import { classifyAmenity, foreignLanguageOf } from './amenities.js';
import { displayTitle, extractYear, mergeKey, movieIdFromHref } from './titles.js';
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
  /** Venue count behind the current title, so the widest listing wins it. */
  titleWeight: number;
  ids: Set<string>;
  hrefs: Set<string>;
  theaters: Set<string>;
  dates: Set<IsoDate>;
  formats: Map<string, Set<string>>;
  optional: Map<string, Set<string>>;
  optionalDates: Map<string, Set<IsoDate>>;
  isEvent: boolean;
  sources: Set<string>;
  languages: Set<string>;
  /** Live groups carrying a non-English marker, against the total seen. */
  foreignGroups: number;
  totalGroups: number;
  /** Release years found in any variant's title, before the year is stripped. */
  years: Set<number>;
}

function blank(key: string, title: string, href: string): Accumulator {
  return {
    key,
    title,
    href,
    titleWeight: 0,
    ids: new Set(),
    hrefs: new Set(),
    theaters: new Set(),
    dates: new Set(),
    formats: new Map(),
    optional: new Map(),
    optionalDates: new Map(),
    isEvent: false,
    sources: new Set(),
    languages: new Set(),
    foreignGroups: 0,
    totalGroups: 0,
    years: new Set(),
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
      const year = extractYear(listing.title);
      if (year !== null) acc.years.add(year);
      const id = movieIdFromHref(listing.href);
      if (id) acc.ids.add(id);
      acc.hrefs.add(listing.href);
      acc.theaters.add(day.theater.name);
      acc.dates.add(day.date);
      acc.sources.add(day.sourceId ?? 'fandango');

      for (const group of live) {
        const format = groupFormat(group);
        if (format) addTo(acc.formats, format, day.theater.name);
        for (const amenity of group.amenities) {
          const c = classifyAmenity(amenity);
          if (c.cls === 'access' || c.cls === 'language') {
            addTo(acc.optional, c.label, day.theater.name);
            addTo(acc.optionalDates, c.label, day.date);
          } else if (c.cls === 'event') {
            acc.isEvent = true;
          }
        }
        // A film counts as foreign only when *every* showing is non-English.
        // Spider-Man has one Spanish-dubbed screening among dozens; that makes
        // it a dub of an English film, not a foreign release.
        acc.totalGroups++;
        let foreignHere = false;
        for (const amenity of group.amenities) {
          const language = foreignLanguageOf(amenity);
          if (language === null) continue;
          foreignHere = true;
          if (language) acc.languages.add(language);
        }
        if (foreignHere) acc.foreignGroups++;
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
    acc.titleWeight = acc.theaters.size;
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
    // The listing seen at the most venues supplies the title and link: a
    // drive-in spelling "Spiderman" should not outrank Fandango's nineteen
    // screens. Among equals the shortest title wins, so "Backrooms" beats the
    // bonus-footage edition.
    const weight = acc.theaters.size;
    if (weight > target.titleWeight || (weight === target.titleWeight && acc.title.length < target.title.length)) {
      target.title = acc.title;
      target.href = acc.href;
      target.titleWeight = weight;
    }
    for (const id of acc.ids) target.ids.add(id);
    for (const href of acc.hrefs) target.hrefs.add(href);
    for (const t of acc.theaters) target.theaters.add(t);
    for (const d of acc.dates) target.dates.add(d);
    for (const [label, set] of acc.formats) for (const t of set) addTo(target.formats, label, t);
    for (const [label, set] of acc.optional) for (const t of set) addTo(target.optional, label, t);
    for (const [label, set] of acc.optionalDates) {
      for (const d of set) addTo(target.optionalDates, label, d);
    }
    for (const source of acc.sources) target.sources.add(source);
    for (const language of acc.languages) target.languages.add(language);
    target.isEvent ||= acc.isEvent;
    target.foreignGroups += acc.foreignGroups;
    target.totalGroups += acc.totalGroups;
    for (const year of acc.years) target.years.add(year);
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
    optionalDates: new Map([...acc.optionalDates].map(([k, v]) => [k, [...v].sort()])),
    isEvent: acc.isEvent,
    sources: [...acc.sources].sort(),
    languages: acc.foreignGroups === acc.totalGroups ? [...acc.languages].sort() : [],
    foreign: acc.totalGroups > 0 && acc.foreignGroups === acc.totalGroups,
    releaseYear: acc.years.size > 0 ? Math.min(...acc.years) : null,
    mergedHrefs: [...acc.hrefs].sort(),
  }));
}
