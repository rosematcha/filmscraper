import type { IsoDate, ProgressFn, ScrapeWarning, VenueDay } from '../core/types.js';

export interface SourceRequest {
  readonly zip: string;
  readonly dates: readonly IsoDate[];
  readonly radiusMiles: number;
  readonly onProgress?: ProgressFn;
}

export interface SourceResult {
  readonly days: VenueDay[];
  readonly warnings: ScrapeWarning[];
}

/**
 * A venue listings provider.
 *
 * Fandango is the only implementation today. Independent venues that sell their
 * own tickets — Slab Cinema, for one — are not on Fandango at all and land here
 * as sibling implementations rather than special cases inside the pipeline.
 */
export interface Source {
  readonly id: string;
  harvest(request: SourceRequest): Promise<SourceResult>;
}
