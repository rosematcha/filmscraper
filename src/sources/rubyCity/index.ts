import { detectAdmission } from '../../core/admission.js';
import { toVenueDays, type SimpleScreening } from '../common.js';
import type { Source, SourceRequest, SourceResult } from '../source.js';
import { browserHeaders } from '../../net/headers.js';
import { fetchWithPolicy } from '../../net/fetch.js';
import {
  filmFromRubyCityTitle,
  isRubyCityFilmEvent,
  parseRubyCityEvents,
  type RubyCityEvent,
} from './parse.js';

export const RUBY_CITY = {
  id: 'ruby-city',
  label: 'Ruby City',
  eventsUrl: 'https://rubycity.org/events/',
  // 150 Camp St; Chris Park, where the outdoor screenings run, is across the street.
  postalCode: '78204',
} as const;

/** The card names a place, and the screenings so far have been in the park. */
function venueName(place: string): string {
  return /chris park/i.test(place) ? 'Chris Park at Ruby City' : RUBY_CITY.label;
}

/**
 * The permalink an event card does not carry.
 *
 * Elementor renders the loop without linking each card, but WordPress resolves
 * a post id to its canonical URL, so the ugly form is only ever a fallback.
 */
async function resolveUrl(postId: string): Promise<string> {
  const query = `https://rubycity.org/?p=${postId}`;
  try {
    const response = await fetchWithPolicy(query, {
      method: 'HEAD',
      headers: browserHeaders(),
    });
    return response.ok && response.url !== '' ? response.url : query;
  } catch {
    return query;
  }
}

/**
 * Ruby City's occasional screenings.
 *
 * The museum has programmed two films in its history, so an empty result is
 * the normal one — this source exists to catch the third rather than to report
 * anything week to week.
 */
export class RubyCitySource implements Source {
  readonly id = RUBY_CITY.id;

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
      const response = await fetchWithPolicy(RUBY_CITY.eventsUrl, {
        headers: browserHeaders(),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      html = await response.text();
    } catch (error) {
      return {
        days: [],
        warnings: [
          {
            kind: 'page-error',
            message: `${RUBY_CITY.label} could not be read (${error instanceof Error ? error.message : String(error)}).`,
          },
        ],
      };
    }

    const events = parseRubyCityEvents(html);
    if (events.length === 0) {
      // The upcoming programme is never empty; an empty parse is the Elementor
      // template moving, which would otherwise fail silently forever.
      return {
        days: [],
        warnings: [
          {
            kind: 'page-error',
            message: `${RUBY_CITY.label}: the events page listed nothing this parser could read.`,
          },
        ],
      };
    }

    const wanted: { event: RubyCityEvent; film: string }[] = [];
    let skipped = 0;
    for (const event of events) {
      if (event.date < first || event.date > last) continue;
      if (!isRubyCityFilmEvent(event.title)) continue;
      const film = filmFromRubyCityTitle(event.title);
      if (film === null) skipped++;
      else wanted.push({ event, film });
    }

    // Permalinks are resolved one at a time, which costs nothing: a run with any
    // screening at all is rare, and one with two unheard of.
    const screenings: SimpleScreening[] = [];
    for (const { event, film } of wanted) {
      screenings.push({
        film,
        url: await resolveUrl(event.postId),
        venueName: venueName(event.place),
        postalCode: RUBY_CITY.postalCode,
        date: event.date,
        time: event.time,
        admission: detectAdmission(event.title),
      });
    }

    const days = await toVenueDays(screenings, request.zip, this.id);
    const warnings =
      skipped > 0
        ? [
            {
              kind: 'page-error' as const,
              message: `${RUBY_CITY.label}: skipped ${String(skipped)} screening${skipped === 1 ? '' : 's'} that named no specific film.`,
            },
          ]
        : [];
    return { days, warnings };
  }
}
