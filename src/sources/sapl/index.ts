import { postalCodeFrom } from '../../core/geo.js';
import type { IsoDate } from '../../core/types.js';
import { toVenueDays, type SimpleScreening } from '../common.js';
import type { Source, SourceRequest, SourceResult } from '../source.js';
import { filmFromSaplEvent } from './extract.js';

/** Run `items` through `worker`, `limit` at a time, keeping input order. */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next++;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await worker(item);
      }
    }),
  );
  return results;
}

const FEED = 'https://www.trumba.com/calendars/san-antonio-public-library.json';

/** Trumba caps a response at 200 events; a single day is far below that. */
const DAY_WINDOW = 1;

/** Days fetched at once. The feed is small and on a different host to Fandango. */
const DAY_CONCURRENCY = 4;

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
    let done = 0;

    // One request per day, several at a time: the whole week lands in about the
    // time a single serial pass used to take.
    const perDay = await mapWithLimit(request.dates, DAY_CONCURRENCY, async (date) => {
      let events: TrumbaEvent[] = [];
      let failure: string | null = null;
      try {
        const url = `${FEED}?startdate=${date.replace(/-/g, '')}&days=${String(DAY_WINDOW)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        events = (await response.json()) as TrumbaEvent[];
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      done++;
      request.onProgress?.({
        message: date,
        step: done,
        total: request.dates.length,
      });
      return { date, events, failure };
    });

    for (const { date, events, failure } of perDay) {
      if (failure !== null) {
        warnings.push({
          kind: 'page-error',
          message: `Library calendar failed for ${date} (${failure}).`,
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
