import { detectAdmission, firstKnown, textOf } from '../../core/admission.js';
import { toVenueDays, type SimpleScreening } from '../common.js';
import type { Source, SourceRequest, SourceResult } from '../source.js';
import { browserHeaders } from '../../net/headers.js';
import { fetchWithPolicy } from '../../net/fetch.js';
import { filmFromMarqueeTitle, parseMarqueeEvents } from './parse.js';

export const MISSION_MARQUEE = {
  id: 'mission-marquee',
  label: 'Mission Marquee Plaza',
  eventsUrl: 'https://www.missionmarquee.com/EVENTS/Outdoor-Family-Film-Series',
  venueName: 'Mission Marquee Plaza',
  // 3100 Roosevelt Ave — the outdoor screen Slab also programmes under its calendar.
  postalCode: '78214',
} as const;

/**
 * Mission Marquee Plaza's official Outdoor Family Film Series listing.
 *
 * Slab Cinema's outdoor calendar often carries the same screenings with less
 * detail; this page names the film directly and links to the venue's event
 * record, including descriptions the Wix calendar never surfaces.
 */
export class MissionMarqueeSource implements Source {
  readonly id = MISSION_MARQUEE.id;

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
      const response = await fetchWithPolicy(MISSION_MARQUEE.eventsUrl, {
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
            message: `${MISSION_MARQUEE.label} could not be read (${error instanceof Error ? error.message : String(error)}).`,
          },
        ],
      };
    }

    const events = parseMarqueeEvents(html);
    if (events.length === 0) {
      return {
        days: [],
        complete: false,
        warnings: [
          {
            kind: 'page-error',
            message: `${MISSION_MARQUEE.label}: the events page contained no readable events.`,
          },
        ],
      };
    }

    const pageAdmission = detectAdmission(textOf(html));
    const screenings: SimpleScreening[] = [];
    let skipped = 0;
    for (const event of events) {
      if (event.date < first || event.date > last) continue;
      const film = filmFromMarqueeTitle(event.title);
      if (!film) {
        skipped++;
        continue;
      }
      screenings.push({
        film,
        url: event.url,
        venueName: MISSION_MARQUEE.venueName,
        postalCode: MISSION_MARQUEE.postalCode,
        date: event.date,
        time: event.time,
        // The page carries one series and nothing else, so a statement of
        // admission anywhere on it is a statement about these screenings.
        admission: firstKnown(detectAdmission(event.title, event.description), pageAdmission),
      });
    }

    const days = await toVenueDays(screenings, request.zip, this.id);
    const warnings =
      skipped > 0
        ? [
            {
              kind: 'skipped-event' as const,
              message: `${MISSION_MARQUEE.label}: skipped ${String(skipped)} event${skipped === 1 ? '' : 's'} that named no specific film.`,
            },
          ]
        : [];
    return { days, warnings };
  }
}
