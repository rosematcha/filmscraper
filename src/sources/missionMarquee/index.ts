import { toVenueDays, type SimpleScreening } from '../common.js';
import type { Source, SourceRequest, SourceResult } from '../source.js';
import { browserHeaders } from '../../net/headers.js';
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
      const response = await fetch(MISSION_MARQUEE.eventsUrl, { headers: browserHeaders() });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      html = await response.text();
    } catch (error) {
      return {
        days: [],
        warnings: [
          {
            kind: 'page-error',
            message: `${MISSION_MARQUEE.label} could not be read (${error instanceof Error ? error.message : String(error)}).`,
          },
        ],
      };
    }

    const screenings: SimpleScreening[] = [];
    let skipped = 0;
    for (const event of parseMarqueeEvents(html)) {
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
      });
    }

    const days = await toVenueDays(screenings, request.zip, this.id);
    const warnings =
      skipped > 0
        ? [
            {
              kind: 'page-error' as const,
              message: `${MISSION_MARQUEE.label}: skipped ${String(skipped)} event${skipped === 1 ? '' : 's'} that named no specific film.`,
            },
          ]
        : [];
    return { days, warnings };
  }
}
