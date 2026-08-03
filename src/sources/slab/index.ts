import type { Source, SourceRequest, SourceResult } from '../source.js';
import { localDate, localTime, toVenueDays, type SimpleScreening } from '../common.js';
import { filmFromSlabTitle, parseSlabEvents } from './parse.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface SlabCalendar {
  readonly id: string;
  readonly label: string;
  readonly calendarUrl: string;
  /** Event pages live under this path, keyed by slug. */
  readonly eventBase: string;
}

export const SLAB_ARTHOUSE: SlabCalendar = {
  id: 'slab-arthouse',
  label: 'Slab Cinema Arthouse',
  calendarUrl: 'https://www.slabcinemaarthouse.com/movie-calendar',
  eventBase: 'https://www.slabcinemaarthouse.com/event-details/',
};

export const SLAB_OUTDOOR: SlabCalendar = {
  id: 'slab-outdoor',
  label: 'Slab Cinema (outdoor)',
  calendarUrl: 'https://www.slabcinema.com/movie-calendar',
  eventBase: 'https://www.slabcinema.com/event-details/',
};

/**
 * Slab's Wix-hosted calendars.
 *
 * One implementation serves both the Blue Star arthouse and the outdoor
 * programme; they differ only in URL and in how much noise their titles carry.
 */
export class SlabSource implements Source {
  readonly id: string;

  constructor(private readonly calendar: SlabCalendar) {
    this.id = calendar.id;
  }

  async harvest(request: SourceRequest): Promise<SourceResult> {
    const first = request.dates[0];
    const last = request.dates.at(-1);
    if (first === undefined || last === undefined) return { days: [], warnings: [] };

    request.onProgress?.({
      message: 'reading calendar',
      step: 1,
      total: request.dates.length,
    });

    let html: string;
    try {
      const response = await fetch(this.calendar.calendarUrl, { headers: { 'User-Agent': UA } });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      html = await response.text();
    } catch (error) {
      return {
        days: [],
        warnings: [
          {
            kind: 'page-error',
            message: `${this.calendar.label} could not be read (${error instanceof Error ? error.message : String(error)}).`,
          },
        ],
      };
    }

    const screenings: SimpleScreening[] = [];
    let skipped = 0;
    for (const event of parseSlabEvents(html)) {
      const instant = new Date(event.startDate);
      if (Number.isNaN(instant.getTime())) continue;
      const date = localDate(instant, event.timeZone);
      if (date < first || date > last) continue;

      const film = filmFromSlabTitle(event.title);
      if (!film) {
        skipped++;
        continue;
      }
      screenings.push({
        film,
        url: event.slug ? `${this.calendar.eventBase}${event.slug}` : this.calendar.calendarUrl,
        venueName: event.venueName,
        ...(event.coords ? { coords: event.coords } : {}),
        date,
        time: localTime(instant, event.timeZone),
      });
    }

    const days = await toVenueDays(screenings, request.zip, this.id);
    const warnings =
      skipped > 0
        ? [
            {
              kind: 'page-error' as const,
              message: `${this.calendar.label}: skipped ${String(skipped)} event${skipped === 1 ? '' : 's'} that named no specific film.`,
            },
          ]
        : [];
    return { days, warnings };
  }
}
