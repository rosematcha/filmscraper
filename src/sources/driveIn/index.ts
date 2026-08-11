import { detectAdmission } from '../../core/admission.js';
import { icalDate, icalTime, parseIcal } from '../../core/ical.js';
import { toVenueDays, type SimpleScreening } from '../common.js';
import type { Source, SourceRequest, SourceResult } from '../source.js';
import { browserHeaders } from '../../net/headers.js';

export interface DriveInVenue {
  readonly id: string;
  readonly name: string;
  readonly icalUrl: string;
  readonly postalCode: string;
  readonly timeZone: string;
}

export const STARS_AND_STRIPES: DriveInVenue = {
  id: 'stars-and-stripes',
  name: 'Stars & Stripes Drive-In',
  icalUrl: 'https://nb.driveinusa.com/?post_type=tribe_events&ical=1&eventDisplay=list',
  // 1178 Kroesche Ln, New Braunfels TX. Roughly 30 miles from downtown San
  // Antonio, so it only appears once the radius is opened up.
  postalCode: '78130',
  timeZone: 'America/Chicago',
};

/** Drive-in marquee titles are shouted; the rest of the table is not. */
function tidyTitle(summary: string): string {
  const trimmed = summary.replace(/\s+/g, ' ').trim();
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(
      /(^|[\s:('"-])([a-z])/g,
      (_, lead: string, letter: string) => lead + letter.toUpperCase(),
    );
}

/**
 * Stars & Stripes, read from its iCal feed.
 *
 * The site's own listing page takes the better part of a minute to render; the
 * Tribe Events iCal export carries the same programme in one fast request, with
 * no browser at all.
 */
export class DriveInSource implements Source {
  readonly id: string;

  constructor(private readonly venue: DriveInVenue = STARS_AND_STRIPES) {
    this.id = venue.id;
  }

  async harvest(request: SourceRequest): Promise<SourceResult> {
    const first = request.dates[0];
    const last = request.dates.at(-1);
    if (first === undefined || last === undefined) return { days: [], warnings: [] };

    request.onProgress?.({
      message: 'reading calendar feed',
      step: 1,
      total: request.dates.length,
    });

    let text: string;
    try {
      const response = await fetch(this.venue.icalUrl, {
        headers: browserHeaders('text/calendar,text/html;q=0.9,*/*;q=0.8'),
        redirect: 'follow',
      });
      if (!response.ok)
        throw new Error(`HTTP ${String(response.status)} ${response.statusText}`.trim());
      text = await response.text();
    } catch (error) {
      return {
        days: [],
        warnings: [
          {
            kind: 'page-error',
            message: `${this.venue.name} calendar feed could not be read (${error instanceof Error ? error.message : String(error)}).`,
          },
        ],
      };
    }

    const screenings: SimpleScreening[] = [];
    for (const event of parseIcal(text)) {
      const date = icalDate(event.start, event.timeZone ?? this.venue.timeZone);
      if (!date || date < first || date > last) continue;
      const film = tidyTitle(event.summary);
      if (!film) continue;
      const time = icalTime(event.start, event.timeZone ?? this.venue.timeZone);
      screenings.push({
        film,
        url: event.url || this.venue.icalUrl,
        venueName: this.venue.name,
        postalCode: this.venue.postalCode,
        date,
        admission: detectAdmission(event.summary, event.description),
        ...(time ? { time } : {}),
      });
    }

    return { days: await toVenueDays(screenings, request.zip, this.id), warnings: [] };
  }
}
