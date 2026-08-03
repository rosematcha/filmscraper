import type { BrowserSession } from '../../net/browser.js';
import type { Source, SourceRequest, SourceResult } from '../source.js';
import { harvestFandango } from './harvest.js';

export class FandangoSource implements Source {
  readonly id = 'fandango';

  constructor(private readonly session: BrowserSession) {}

  async harvest(request: SourceRequest): Promise<SourceResult> {
    return harvestFandango(this.session, {
      zip: request.zip,
      dates: request.dates,
      radiusMiles: request.radiusMiles,
      ...(request.onProgress ? { onProgress: request.onProgress } : {}),
    });
  }
}

export { parseShowtimesPage, parseAmenityGroup, parseMiles } from './parse.js';
