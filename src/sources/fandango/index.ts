import type { BrowserSession } from '../../net/browser.js';
import type { IsoDate, VenueDay } from '../../core/types.js';
import type { Source, SourceRequest, SourceResult } from '../source.js';
import {
  harvestFandango,
  harvestFandangoTheaters,
  venueDateKey,
  type TheaterTarget,
} from './harvest.js';

export interface FandangoSourceOptions {
  readonly concurrency?: number;
  readonly targets?: readonly TheaterTarget[];
  /** Dates to refresh through ZIP search while carrying all other dates over. */
  readonly dates?: readonly IsoDate[];
  /** Last complete Fandango snapshot, retained around targeted page failures. */
  readonly baselineDays?: readonly VenueDay[];
}

export class FandangoSource implements Source {
  readonly id = 'fandango';

  constructor(
    private readonly session: BrowserSession,
    private readonly options: FandangoSourceOptions = {},
  ) {}

  async harvest(request: SourceRequest): Promise<SourceResult> {
    if (this.options.targets) {
      const result = await harvestFandangoTheaters(this.session, this.options.targets, {
        ...(this.options.concurrency === undefined
          ? {}
          : { concurrency: this.options.concurrency }),
        ...(request.onProgress
          ? {
              onProgress: (
                message: string,
                step: number,
                total: number,
                active: readonly string[],
              ): void => {
                request.onProgress?.({ message, step, total, active });
              },
            }
          : {}),
      });
      const baseline = (this.options.baselineDays ?? []).filter(
        (day) =>
          (day.sourceId === undefined || day.sourceId === 'fandango') &&
          request.dates.includes(day.date) &&
          !result.completed.has(venueDateKey(day.theater.href, day.date)),
      );
      return { days: [...baseline, ...result.days], warnings: result.warnings, complete: true };
    }

    const result = await harvestFandango(this.session, {
      zip: request.zip,
      dates: this.options.dates ?? request.dates,
      radiusMiles: request.radiusMiles,
      ...(this.options.concurrency === undefined
        ? {}
        : { concurrency: this.options.concurrency }),
      ...(request.onProgress
        ? {
            onProgress: (
              message: string,
              step: number,
              total: number,
              active: readonly string[],
            ): void => {
              request.onProgress?.({ message, step, total, active });
            },
          }
        : {}),
    });
    const complete = !result.warnings.some((warning) => warning.kind === 'page-error');
    if (this.options.dates && this.options.baselineDays && complete) {
      const refreshed = new Set(this.options.dates);
      const baseline = this.options.baselineDays.filter(
        (day) =>
          (day.sourceId === undefined || day.sourceId === 'fandango') &&
          request.dates.includes(day.date) &&
          !refreshed.has(day.date),
      );
      return { ...result, days: [...baseline, ...result.days], complete: true };
    }
    return { ...result, complete };
  }
}

export { parseShowtimesPage, parseAmenityGroup, parseMiles } from './parse.js';
