import { detectAdmission } from '../../core/admission.js';
import { toVenueDays, type SimpleScreening } from '../common.js';
import type { Source, SourceRequest, SourceResult } from '../source.js';
import { SCRAPER_USER_AGENT, browserHeaders } from '../../net/headers.js';
import { filmFromMcnayTitle, isMcnayFilmEvent, parseMcnayEvents } from './parse.js';

export const MCNAY = {
  id: 'mcnay',
  label: 'McNay Art Museum',
  eventsUrl: 'https://www.mcnayart.org/events/',
  venueName: 'McNay Art Museum',
  // Chiego Lecture Hall at the McNay, 6000 N New Braunfels Ave.
  postalCode: '78209',
} as const;

/**
 * The McNay Art Museum's occasional screenings.
 *
 * The museum is not a cinema: it programmes a film every month or two, usually
 * tied to an exhibition, so most runs of this source find nothing and that is
 * the expected result rather than a sign the page broke.
 */
export class McnaySource implements Source {
  readonly id = MCNAY.id;

  async harvest(request: SourceRequest): Promise<SourceResult> {
    const first = request.dates[0];
    const last = request.dates.at(-1);
    if (first === undefined || last === undefined) return { days: [], warnings: [] };

    request.onProgress?.({
      message: 'reading events page',
      step: 1,
      total: request.dates.length,
    });

    let html: string;
    try {
      const response = await fetch(MCNAY.eventsUrl, {
        headers: browserHeaders(undefined, SCRAPER_USER_AGENT),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      html = await response.text();
    } catch (error) {
      return {
        days: [],
        warnings: [
          {
            kind: 'page-error',
            message: `${MCNAY.label} could not be read (${error instanceof Error ? error.message : String(error)}).`,
          },
        ],
      };
    }

    const events = parseMcnayEvents(html);
    if (events.length === 0) {
      // A museum with no screenings this month is expected; a museum with no
      // events at all is the theme changing under the parser.
      return {
        days: [],
        warnings: [
          {
            kind: 'page-error',
            message: `${MCNAY.label}: the events page listed nothing this parser could read.`,
          },
        ],
      };
    }

    const screenings: SimpleScreening[] = [];
    let skipped = 0;
    for (const event of events) {
      if (event.date < first || event.date > last) continue;
      if (!isMcnayFilmEvent(event.title)) continue;
      const film = filmFromMcnayTitle(event.title);
      if (!film) {
        skipped++;
        continue;
      }
      screenings.push({
        film,
        url: event.url,
        venueName: MCNAY.venueName,
        postalCode: MCNAY.postalCode,
        date: event.date,
        time: event.time,
        // The museum stamps `FREE:` or `SOLD OUT:` onto the title itself.
        admission: detectAdmission(event.title),
      });
    }

    const days = await toVenueDays(screenings, request.zip, this.id);
    const warnings =
      skipped > 0
        ? [
            {
              kind: 'page-error' as const,
              message: `${MCNAY.label}: skipped ${String(skipped)} screening${skipped === 1 ? '' : 's'} that named no specific film.`,
            },
          ]
        : [];
    return { days, warnings };
  }
}
