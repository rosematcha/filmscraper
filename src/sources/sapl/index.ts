import { postalCodeFrom } from '../../core/geo.js';
import type { IsoDate } from '../../core/types.js';
import { toVenueDays, type SimpleScreening } from '../common.js';
import type { Source, SourceRequest, SourceResult } from '../source.js';
import { filmFromSaplEvent } from './extract.js';

const FEED = 'https://www.trumba.com/calendars/san-antonio-public-library.json';

/** Trumba caps a response at 200 events; a single day is far below that. */
const DAY_WINDOW = 1;

interface TrumbaField {
  readonly label?: unknown;
  readonly value?: unknown;
}

interface TrumbaEvent {
  readonly eventID?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly location?: unknown;
  readonly startDateTime?: unknown;
  readonly permaLinkUrl?: unknown;
  readonly customFields?: readonly TrumbaField[];
}

function stripHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#160;/g, ' ')
    .replace(/&(#\d+|[a-z]+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function field(event: TrumbaEvent, label: string): string {
  for (const f of event.customFields ?? []) {
    if (f.label === label) return stripHtml(f.value);
  }
  return '';
}

/**
 * San Antonio Public Library, via the Trumba calendar behind its events page.
 *
 * The site embeds Trumba as a JavaScript widget, but the same calendar is
 * published as JSON, so the category filtering the page does with checkboxes is
 * done here on the `Event Type(s)` field instead.
 */
export class SaplSource implements Source {
  readonly id = 'sapl';

  async harvest(request: SourceRequest): Promise<SourceResult> {
    const screenings: SimpleScreening[] = [];
    const warnings: SourceResult['warnings'] = [];
    let considered = 0;
    let skipped = 0;

    for (const [index, date] of request.dates.entries()) {
      request.onProgress?.({
        message: `San Antonio Public Library · ${date}`,
        step: index + 1,
        total: request.dates.length,
      });

      let events: TrumbaEvent[];
      try {
        const url = `${FEED}?startdate=${date.replace(/-/g, '')}&days=${String(DAY_WINDOW)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        events = (await response.json()) as TrumbaEvent[];
      } catch (error) {
        warnings.push({
          kind: 'page-error',
          message: `Library calendar failed for ${date} (${error instanceof Error ? error.message : String(error)}).`,
        });
        continue;
      }

      for (const event of events) {
        const start = typeof event.startDateTime === 'string' ? event.startDateTime : '';
        const eventDate: IsoDate = start.slice(0, 10);
        if (eventDate !== date) continue;
        if (!/movie/i.test(field(event, 'Event Type(s)'))) continue;

        considered++;
        const film = filmFromSaplEvent({
          title: typeof event.title === 'string' ? event.title : '',
          description: stripHtml(event.description),
          additionalInfo: field(event, 'Additional Info'),
          date: eventDate,
        });
        if (!film) {
          skipped++;
          continue;
        }

        const branch = field(event, 'Branch Location') || stripHtml(event.location) || 'San Antonio Public Library';
        const postalCode = postalCodeFrom(field(event, 'Address'));
        if (!postalCode) {
          skipped++;
          continue;
        }

        screenings.push({
          film,
          url:
            typeof event.permaLinkUrl === 'string' && event.permaLinkUrl
              ? event.permaLinkUrl.replace(/^http:/, 'https:')
              : 'https://www.mysapl.org/Events-News/Events-Calendar',
          venueName: branch,
          postalCode,
          date: eventDate,
          time: timeFrom(start),
        });
      }
    }

    if (skipped > 0) {
      warnings.push({
        kind: 'page-error',
        message:
          `Library: ${String(skipped)} of ${String(considered)} movie-tagged events named no specific ` +
          `film (or were trivia and similar) and were skipped.`,
      });
    }

    return { days: await toVenueDays(screenings, request.zip, this.id), warnings };
  }
}

/** `2026-08-03T17:30` -> `"5:30p"`. */
function timeFrom(startDateTime: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(startDateTime);
  if (!match) return '';
  const hour = Number(match[1]);
  const half = hour >= 12 ? 'p' : 'a';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(display)}:${match[2] ?? '00'}${half}`;
}
