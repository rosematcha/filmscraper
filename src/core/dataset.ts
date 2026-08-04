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

/**
 * Narrow a dataset to a tighter radius and date window.
 *
 * Venues from sources that ignore the radius keep their exemption, which is why
 * the drive-in and the library survive a filter down to five miles.
 */
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
    readonly from: IsoDate;
    readonly to: IsoDate;
    readonly zip: string;
    readonly radiusMiles: number;
    readonly horizon: IsoDate;
    readonly knownFrom: IsoDate;
  },
  now: Date,
): Dataset {
  const scraped = new Set(fresh.sourceIds);
  const sourceOf = (day: VenueDay): string => day.sourceId ?? 'fandango';

  // A previous run at a different ZIP or a narrower radius cannot be trusted
  // to line up with this one, so start clean rather than blend the two.
  const compatible =
    previous !== null &&
    previous.zip === fresh.zip &&
    previous.radiusMiles === fresh.radiusMiles &&
    previous.version === DATASET_VERSION;

  const carried = compatible
    ? previous.days.filter((d) => !scraped.has(sourceOf(d)) && d.date >= fresh.from && d.date <= fresh.to)
    : [];

  const stamps: Record<string, SourceStamp> = compatible ? { ...previous.sources } : {};
  const stamp: SourceStamp = { updatedAt: now.toISOString(), from: fresh.from, to: fresh.to };
  for (const id of fresh.sourceIds) stamps[id] = stamp;

  // Warnings from carried-over sources no longer describe this run.
  const carriedWarnings = compatible
    ? previous.warnings.filter((w) => !fresh.warnings.some((f) => f.message === w.message))
    : [];

  return {
    version: DATASET_VERSION,
    generatedAt: now.toISOString(),
    zip: fresh.zip,
    from: fresh.from,
    to: fresh.to,
    radiusMiles: fresh.radiusMiles,
    horizon: fresh.horizon,
    knownFrom: fresh.knownFrom,
    days: [...carried, ...fresh.days],
    warnings: [...fresh.warnings, ...carriedWarnings.filter((w) => w.kind !== 'expired-today')],
    sources: stamps,
  };
}

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
