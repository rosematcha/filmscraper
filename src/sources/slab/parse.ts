import type { Coords } from '../../core/geo.js';

export interface WixEvent {
  readonly title: string;
  readonly slug: string;
  readonly startDate: string;
  readonly timeZone: string;
  readonly venueName: string;
  readonly coords: Coords | null;
  /** The event's own blurb, where the outdoor calendar states admission. */
  readonly description: string;
}

const WARMUP = /id="wix-warmup-data"[^>]*>([\s\S]*?)<\/script>/;

interface RawEvent {
  title?: unknown;
  description?: unknown;
  slug?: unknown;
  status?: unknown;
  location?: { name?: unknown; coordinates?: { lat?: unknown; lng?: unknown } };
  scheduling?: { config?: { startDate?: unknown; timeZoneId?: unknown } };
}

/** Depth-first hunt for the events widget's payload. */
function* eventLists(node: unknown): Generator<RawEvent[]> {
  if (Array.isArray(node)) {
    for (const child of node) yield* eventLists(child);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const record = node as Record<string, unknown>;
  if (Array.isArray(record['events']) && 'hasMore' in record) {
    yield record['events'] as RawEvent[];
  }
  for (const value of Object.values(record)) yield* eventLists(value);
}

/**
 * Read Slab's calendar out of the Wix warm-up payload.
 *
 * The visible page has a "load more" control, but the embedded JSON reports
 * `hasMore: false` and already carries the full upcoming list, so no browser
 * and no clicking are needed.
 */
export function parseSlabEvents(html: string): WixEvent[] {
  const raw = WARMUP.exec(html)?.[1];
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }

  const out: WixEvent[] = [];
  for (const list of eventLists(data)) {
    for (const event of list) {
      const title = typeof event.title === 'string' ? event.title : null;
      const startDate = event.scheduling?.config?.startDate;
      if (!title || typeof startDate !== 'string') continue;
      // status 0 is published; anything else is a draft or cancellation.
      if (typeof event.status === 'number' && event.status !== 0) continue;

      const lat = Number(event.location?.coordinates?.lat);
      const lng = Number(event.location?.coordinates?.lng);
      out.push({
        title,
        slug: typeof event.slug === 'string' ? event.slug : '',
        startDate,
        timeZone:
          typeof event.scheduling?.config?.timeZoneId === 'string'
            ? event.scheduling.config.timeZoneId
            : 'America/Chicago',
        venueName: typeof event.location?.name === 'string' ? event.location.name : 'Slab Cinema',
        description: typeof event.description === 'string' ? event.description : '',
        coords: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lon: lng } : null,
      });
    }
  }
  return out;
}

/** Leading `8/3:` or `08/15:` date stamp Slab prefixes onto every title. */
const DATE_PREFIX = /^\s*\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*[:–—-]\s*/;

/**
 * Programme labels that describe the series rather than the film.
 * A title made only of these names no particular movie, so it is skipped.
 */
const PROGRAMME_ONLY =
  /^(outdoor\s+family\s+film|family\s+film|movie\s+night|film\s+screening|movie\s+in\s+the\s+park|free\s+movie|double\s+feature|tbd|tba)$/i;

/** Trailing sponsor and venue chatter Slab appends after the film. */
const TRAILING_NOISE =
  /^(outdoor\s+family\s+film|family\s+film|movie\s+night|presented\s+by\b.*|sponsored\s+by\b.*|free\s+admission|.*\bplaza\b.*|.*\bpark\b.*|.*\btheater\b.*|.*\blibrary\b.*)$/i;

/** Calendar entries that use the cinema as an event venue but screen no film. */
const NON_FILM_PROGRAMME =
  /\b(kids(?:\s+\w+){0,2}\s+festival|culture\s+celebration|music\s+festival|arts?\s+festival|live\s+music|makers?\s+market|arts?\s+workshop)\b/i;

/** A label Slab puts before the actual title on occasional partner screenings. */
const SCREENING_PREFIX = /^(?:free\s+)?(?:film\s+)?screening\s*:\s*/i;

/**
 * Pull the film out of a Slab event title.
 *
 * Arthouse titles are clean (`8/3: Polyester (1981)`). Outdoor ones bundle the
 * series, venue and sponsor (`08/15: A Minecraft Movie, Outdoor Family Film,
 * Mission Marquee Plaza (Sponsored by …)`), and some name no film at all.
 */
export function filmFromSlabTitle(title: string): string | null {
  const withoutDate = title.replace(DATE_PREFIX, '').trim();
  if (!withoutDate) return null;

  // The movie calendar occasionally carries use-of-space events such as a
  // music festival. Film-related words override this guard because a film
  // festival or a screening tied to a symposium is still wanted.
  if (
    NON_FILM_PROGRAMME.test(withoutDate) &&
    !/\b(film|movie|cinema|screening)\b/i.test(withoutDate)
  ) {
    return null;
  }

  const withoutLabel = withoutDate.replace(SCREENING_PREFIX, '').trim();
  // Partner events can put the programme first and the film in quotation
  // marks: `Xicanx Symposium: “ASCO: WITHOUT PERMISSION”`.
  const quoted = [...withoutLabel.matchAll(/[“"]([^”"]+)[”"]/g)].at(-1)?.[1];
  const named = quoted?.trim() ?? withoutLabel;

  // Drop a parenthesised sponsor tail before splitting on commas.
  const withoutSponsor = named.replace(/\s*\((?:sponsored|presented)\b[^)]*\)\s*$/i, '').trim();
  const [first = ''] = withoutSponsor.split(',');
  const film = first.trim();

  if (!film || PROGRAMME_ONLY.test(film) || TRAILING_NOISE.test(film)) return null;
  // A bare venue or series name is not a film.
  if (film.length < 2) return null;
  return film;
}
