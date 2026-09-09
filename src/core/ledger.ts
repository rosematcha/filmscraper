import type { AggregatedMovie, IsoDate } from './types.js';

/** Version stamp so an older ledger cannot be misread by a newer build. */
export const LEDGER_VERSION = 1;

/**
 * Films drop out of the ledger this long after their last listing.
 *
 * Long enough that a revival returning a few months later still reads as
 * something that has played before; short enough that the file stays a few
 * kilobytes rather than every title ever scraped.
 */
export const LEDGER_RETENTION_DAYS = 180;

/** What one run leaves behind about one film. */
export interface LedgerEntry {
  readonly title: string;
  /** Earliest date the film was ever listed for, across every run. */
  readonly firstDate: IsoDate;
  /** Latest date it was listed for. */
  readonly lastDate: IsoDate;
  /** The run day it first appeared in a scrape, which for a pre-sale precedes `firstDate`. */
  readonly firstSeen: IsoDate;
  readonly lastSeen: IsoDate;
}

/**
 * The listing history behind the run classifier.
 *
 * One scrape only knows the dates it saw. It cannot tell a film opening on
 * Thursday from one that played last week and skips Wednesday, nor a film that
 * opened last Friday from one that has run for a month. The ledger keeps the
 * one fact that resolves both: the first date each film was ever listed for.
 * Keyed by the same merge key the tables use, so variants fold together here
 * as they do there.
 */
export interface Ledger {
  readonly version: number;
  readonly updatedAt: string;
  /**
   * The first day a run was ever folded in.
   *
   * Without it the ledger cannot tell "this film opened on the 8th" from "the
   * 8th is simply the earliest day we ever looked", and a first-ever ledger
   * would report every film in the market as opening that week.
   */
  readonly since: IsoDate;
  readonly films: Readonly<Record<string, LedgerEntry>>;
}

export const EMPTY_LEDGER: Ledger = {
  version: LEDGER_VERSION,
  updatedAt: '',
  since: '',
  films: {},
};

function isEntry(value: unknown): value is LedgerEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e['title'] === 'string' &&
    typeof e['firstDate'] === 'string' &&
    typeof e['lastDate'] === 'string' &&
    typeof e['firstSeen'] === 'string' &&
    typeof e['lastSeen'] === 'string'
  );
}

export function isLedger(value: unknown): value is Ledger {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  if (d['version'] !== LEDGER_VERSION || typeof d['updatedAt'] !== 'string') return false;
  if (typeof d['since'] !== 'string') return false;
  const films = d['films'];
  if (typeof films !== 'object' || films === null) return false;
  return Object.values(films).every(isEntry);
}

function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fold one run's films into the ledger.
 *
 * Only films the run actually saw are touched, so a partial scrape of the
 * calendar sources leaves the multiplex entries as they were. Entries whose
 * last listing has aged out are dropped.
 */
export function updateLedger(
  previous: Ledger | null,
  movies: readonly AggregatedMovie[],
  runDay: IsoDate,
  now: Date,
): Ledger {
  const cutoff = addDays(runDay, -LEDGER_RETENTION_DAYS);
  const films: Record<string, LedgerEntry> = {};
  for (const [key, entry] of Object.entries(previous?.films ?? {})) {
    if (entry.lastDate >= cutoff) films[key] = entry;
  }
  for (const movie of movies) {
    const first = movie.dates[0];
    const last = movie.dates.at(-1);
    if (first === undefined || last === undefined) continue;
    const prior = films[movie.key];
    films[movie.key] = prior
      ? {
          title: movie.title,
          firstDate: prior.firstDate < first ? prior.firstDate : first,
          lastDate: prior.lastDate > last ? prior.lastDate : last,
          firstSeen: prior.firstSeen < runDay ? prior.firstSeen : runDay,
          lastSeen: runDay,
        }
      : {
          title: movie.title,
          firstDate: first,
          lastDate: last,
          firstSeen: runDay,
          lastSeen: runDay,
        };
  }
  const priorSince = previous?.since ?? '';
  const since = priorSince !== '' && priorSince < runDay ? priorSince : runDay;
  return { version: LEDGER_VERSION, updatedAt: now.toISOString(), since, films };
}

/**
 * What a run managed to learn about the previously published ledger.
 *
 * `absent` and `unreadable` are kept apart deliberately. A site that has never
 * published one should start a fresh ledger; a site whose ledger this run
 * merely failed to fetch must not be handed one, because a ledger claiming to
 * have started today reports every film in the city as opening this week and
 * silently discards months of history.
 */
export type LedgerState =
  | { readonly kind: 'loaded'; readonly ledger: Ledger }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly reason: string };

/**
 * The ledger to publish, or null to leave the published one alone.
 *
 * Null is the whole point: overwriting history with a ledger that begins today
 * is worse than publishing nothing, because the next run would believe it.
 */
export function nextLedger(
  state: LedgerState,
  movies: readonly AggregatedMovie[],
  runDay: IsoDate,
  now: Date,
): Ledger | null {
  if (state.kind === 'unreadable') return null;
  return updateLedger(state.kind === 'loaded' ? state.ledger : null, movies, runDay, now);
}

/** Film key -> first listed date, in the shape the renderer takes. */
export function firstDates(ledger: Ledger | null): ReadonlyMap<string, IsoDate> {
  const out = new Map<string, IsoDate>();
  for (const [key, entry] of Object.entries(ledger?.films ?? {})) out.set(key, entry.firstDate);
  return out;
}

/** The earliest date the ledger can speak to, or null when there is none. */
export function watchedSince(ledger: Ledger | null): IsoDate | null {
  const since = ledger?.since ?? '';
  return since === '' ? null : since;
}
