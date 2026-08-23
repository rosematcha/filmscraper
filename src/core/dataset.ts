import { applyVenueFilter, type VenueFilter } from './filters.js';
import type { IsoDate, ScrapeWarning, VenueDay } from './types.js';

/** Version stamp so a stale file cannot be misread by a newer site build. */
export const DATASET_VERSION = 2;

/** When a source last ran, and the window it covered at the time. */
export interface SourceStamp {
  readonly updatedAt: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
}

/**
 * The published scrape.
 *
 * Raw venue-days rather than a finished table: at roughly 150 KB gzipped for a
 * month it is small enough to ship whole, and shipping it whole is what lets
 * the site re-filter by date and radius without a server.
 */
export interface Dataset {
  readonly version: number;
  /** ISO timestamp of the run that produced this. */
  readonly generatedAt: string;
  readonly zip: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** Radius the scrape covered. The site may filter below this, never above. */
  readonly radiusMiles: number;
  /** Last date whose schedule Fandango had fully posted at scrape time. */
  readonly horizon: IsoDate;
  readonly knownFrom: IsoDate;
  readonly days: readonly VenueDay[];
  readonly warnings: readonly ScrapeWarning[];
  /**
   * Per-source freshness.
   *
   * Sources run on different cadences, so a single `generatedAt` would imply
   * the arthouse calendar is as fresh as the multiplex grid when it may be six
   * days older.
   */
  readonly sources: Readonly<Record<string, SourceStamp>>;
}

/**
 * Validate a file that may well be an older version, or not a dataset at all.
 *
 * Typed against a raw record rather than `Partial<Dataset>`: pretending the
 * input already has the right shape hides exactly the checks worth making.
 */
export function isDataset(value: unknown): value is Dataset {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  return (
    d['version'] === DATASET_VERSION &&
    typeof d['zip'] === 'string' &&
    typeof d['from'] === 'string' &&
    typeof d['to'] === 'string' &&
    typeof d['radiusMiles'] === 'number' &&
    Array.isArray(d['days']) &&
    typeof d['sources'] === 'object' &&
    d['sources'] !== null
  );
}

/** ISO dates sort lexically, so the earlier of two is the smaller string. */
function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b;
}

function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}

/**
 * Fold a partial scrape into the previous dataset.
 *
 * Only the sources that just ran are replaced; everything else is carried over,
 * minus dates that have since passed. Without this a Fandango-only run would
 * silently drop the drive-in and the library until their next slot came round.
 */
export function mergeDataset(
  previous: Dataset | null,
  fresh: {
    readonly days: readonly VenueDay[];
    readonly warnings: readonly ScrapeWarning[];
    readonly sourceIds: readonly string[];
    readonly failedSourceIds?: readonly string[];
    readonly failedSourceDates?: Readonly<Record<string, readonly IsoDate[]>>;
    readonly from: IsoDate;
    readonly to: IsoDate;
    readonly zip: string;
    readonly radiusMiles: number;
    readonly horizon: IsoDate;
    readonly knownFrom: IsoDate;
  },
  now: Date,
): Dataset {
  const failed = new Set(fresh.failedSourceIds ?? []);
  const failedDates = new Map(
    Object.entries(fresh.failedSourceDates ?? {}).map(([sourceId, dates]) => [
      sourceId,
      new Set(dates),
    ]),
  );
  const scraped = new Set(fresh.sourceIds.filter((id) => !failed.has(id)));
  const sourceOf = (day: VenueDay): string => day.sourceId ?? 'fandango';
  const failedOn = (day: VenueDay): boolean =>
    failedDates.get(sourceOf(day))?.has(day.date) === true;

  // A previous run at a different ZIP or a narrower radius cannot be trusted
  // to line up with this one, so start clean rather than blend the two.
  const compatible =
    previous !== null &&
    previous.zip === fresh.zip &&
    previous.radiusMiles === fresh.radiusMiles &&
    previous.version === DATASET_VERSION;

  const carried = compatible
    ? previous.days.filter(
        (d) =>
          (!scraped.has(sourceOf(d)) || failedOn(d)) && d.date >= fresh.from && d.date <= fresh.to,
      )
    : [];
  // A failed source is not authoritative emptiness. Keep its old rows when we
  // have them; on a first run, retain whatever partial rows it did return.
  const freshDays = compatible
    ? fresh.days.filter((day) => !failed.has(sourceOf(day)) && !failedOn(day))
    : fresh.days;

  // The posting boundary is measured on Fandango and nothing else, so a run
  // without it reports the end of the window — no boundary found. Writing that
  // over the carried multiplex days would state as fact that every date is
  // fully posted, and a wide release that has not put Friday on sale yet would
  // read as "through Thursday". Keep whichever pair claims less: the earlier
  // horizon, the later first-reliable date.
  const measuresHorizon = scraped.has('fandango');
  const clamp = (date: IsoDate): IsoDate =>
    date < fresh.from ? fresh.from : date > fresh.to ? fresh.to : date;
  const horizon =
    compatible && !measuresHorizon
      ? minDate(fresh.horizon, clamp(previous.horizon))
      : fresh.horizon;
  const knownFrom =
    compatible && !measuresHorizon
      ? maxDate(fresh.knownFrom, clamp(previous.knownFrom))
      : fresh.knownFrom;

  const stamps: Record<string, SourceStamp> = compatible ? { ...previous.sources } : {};
  const stamp: SourceStamp = { updatedAt: now.toISOString(), from: fresh.from, to: fresh.to };
  for (const id of scraped) {
    if (!failedDates.has(id)) stamps[id] = stamp;
  }

  // Page errors describe one attempt and must clear after a later successful
  // run. The radius warning describes the carried Fandango rows themselves,
  // so it survives until Fandango runs authoritatively again.
  const carriedWarnings = compatible
    ? previous.warnings.filter(
        (warning) => warning.kind === 'radius-truncated' && !scraped.has('fandango'),
      )
    : [];
  const warnings = [...fresh.warnings, ...carriedWarnings].filter(
    (warning, index, all) => all.findIndex((other) => other.message === warning.message) === index,
  );

  return {
    version: DATASET_VERSION,
    generatedAt: now.toISOString(),
    zip: fresh.zip,
    from: fresh.from,
    to: fresh.to,
    radiusMiles: fresh.radiusMiles,
    horizon,
    knownFrom,
    days: [...carried, ...freshDays],
    warnings,
    sources: stamps,
  };
}

/**
 * Narrow a dataset to a tighter radius and date window.
 *
 * Venues from sources that ignore the radius keep their exemption, which is why
 * the drive-in and the library survive a filter down to five miles.
 */
export function filterDataset(
  dataset: Dataset,
  from: IsoDate,
  to: IsoDate,
  filter: VenueFilter,
): VenueDay[] {
  return applyVenueFilter(
    dataset.days.filter((day) => day.date >= from && day.date <= to),
    filter,
  );
}
