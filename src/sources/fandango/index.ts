import type { BrowserSession } from '../../net/browser.js';
import type { Source, SourceRequest, SourceResult } from '../source.js';
import { harvestFandango } from './harvest.js';

export class FandangoSource implements Source {
  readonly id = 'fandango';

  constructor(
    private readonly session: BrowserSession,
    /** Pages fetched at once; 1 keeps the original serial behaviour. */
    private readonly concurrency = 1,
  ) {}

  async harvest(request: SourceRequest): Promise<SourceResult> {
    return harvestFandango(this.session, {
      zip: request.zip,
      dates: request.dates,
      radiusMiles: request.radiusMiles,
      concurrency: this.concurrency,
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
  }
}

export { parseShowtimesPage, parseAmenityGroup, parseMiles } from './parse.js';
