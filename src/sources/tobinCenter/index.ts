import { detectAdmission, firstKnown, textOf } from '../../core/admission.js';
import { toVenueDays, type SimpleScreening } from '../common.js';
import type { Source, SourceRequest, SourceResult } from '../source.js';
import { browserHeaders } from '../../net/headers.js';
import { fetchWithPolicy } from '../../net/fetch.js';
import { filmFromTobinTitle, parseTobinCinemaEvents } from './parse.js';

export const TOBIN_CINEMA = {
  id: 'tobin-cinema',
  label: 'Tobin Center Cinema',
  cinemaUrl: 'https://www.tobincenter.org/cinema',
  // Will Naylor Smith River Walk Plaza at the Tobin Center, 100 Auditorium Circle.
  // Given as coordinates rather than a ZIP: the venue's ZIP is the one the
  // scrape searches from, so the centroid fallback measured it as zero miles
  // away, which sorted the plaza above every theater in the city.
  coords: { lat: 29.4297, lon: -98.4899 },
  /** Every screening on the plaza page begins at 7 PM. */
  defaultTime: '7:00p',
} as const;

/**
 * H-E-B Cinema on Will's Plaza — free monthly outdoor screenings at the Tobin
 * Center's River Walk plaza.
 *
 * The cinema landing page lists the whole season with film titles and dates;
 * unlike Slab's Wix calendar, each entry links to a Tobin event page with the
 * full write-up.
 */
export class TobinCinemaSource implements Source {
  readonly id = TOBIN_CINEMA.id;

  async harvest(request: SourceRequest): Promise<SourceResult> {
    const first = request.dates[0];
    const last = request.dates.at(-1);
    if (first === undefined || last === undefined) return { days: [], warnings: [] };

    request.onProgress?.({
      message: 'reading cinema page',
      step: 1,
      total: request.dates.length,
    });

    let html: string;
    try {
      const response = await fetchWithPolicy(TOBIN_CINEMA.cinemaUrl, {
        headers: browserHeaders(),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      html = await response.text();
    } catch (error) {
      return {
        days: [],
        complete: false,
        warnings: [
          {
            kind: 'page-error',
            message: `${TOBIN_CINEMA.label} could not be read (${error instanceof Error ? error.message : String(error)}).`,
          },
        ],
      };
    }

    const events = parseTobinCinemaEvents(html);
    if (events.length === 0) {
      return {
        days: [],
        complete: false,
        warnings: [
          {
            kind: 'page-error',
            message: `${TOBIN_CINEMA.label}: the cinema page contained no readable events.`,
          },
        ],
      };
    }

    const pageAdmission = detectAdmission(textOf(html));
    const screenings: SimpleScreening[] = [];
    let skipped = 0;
    for (const event of events) {
      if (event.date < first || event.date > last) continue;
      const film = filmFromTobinTitle(event.title);
      if (!film) {
        skipped++;
        continue;
      }
      screenings.push({
        film,
        url: event.url,
        venueName: event.venueName,
        coords: TOBIN_CINEMA.coords,
        date: event.date,
        time: TOBIN_CINEMA.defaultTime,
        // The cinema page describes one series, so its admission line covers
        // every row on it.
        admission: firstKnown(detectAdmission(event.title), pageAdmission),
      });
    }

    const days = await toVenueDays(screenings, request.zip, this.id);
    const warnings =
      skipped > 0
        ? [
            {
              kind: 'skipped-event' as const,
              message: `${TOBIN_CINEMA.label}: skipped ${String(skipped)} event${skipped === 1 ? '' : 's'} that named no specific film.`,
            },
          ]
        : [];
    return { days, warnings };
  }
}
