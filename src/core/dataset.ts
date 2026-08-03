import type { IsoDate, ScrapeWarning, VenueDay } from './types.js';

/** Version stamp so a stale file cannot be misread by a newer site build. */
export const DATASET_VERSION = 1;

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
}

export function isDataset(value: unknown): value is Dataset {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Partial<Dataset>;
  return (
    d.version === DATASET_VERSION &&
    typeof d.zip === 'string' &&
    typeof d.from === 'string' &&
    typeof d.to === 'string' &&
    typeof d.radiusMiles === 'number' &&
    Array.isArray(d.days)
  );
}

/**
 * Narrow a dataset to a tighter radius and date window.
 *
 * Venues from sources that ignore the radius keep their exemption, which is why
 * the drive-in and the library survive a filter down to five miles.
 */
export function filterDataset(
  dataset: Dataset,
  radiusMiles: number,
  from: IsoDate,
  to: IsoDate,
  exemptSources: ReadonlySet<string>,
): VenueDay[] {
  return dataset.days.filter(
    (day) =>
      day.date >= from &&
      day.date <= to &&
      (day.theater.miles <= radiusMiles || exemptSources.has(day.sourceId ?? 'fandango')),
  );
}
