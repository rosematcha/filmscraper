import { aggregate, isLive, type AliasConfig } from './aggregate.js';
import { dateRange } from './notes.js';
import type {
  IsoDate,
  ProgressFn,
  ScrapeRequest,
  ScrapeResult,
  ScrapeWarning,
  Theater,
  VenueDay,
} from './types.js';
import type { Source } from '../sources/source.js';

/** Today in the market's timezone, not the machine's. */
export function todayIn(timezone: string): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Fandango keeps already-started showtimes in the markup and flags them
 * `expired`. An evening run therefore sees a mostly-empty "today", which looks
 * identical to a quiet day unless we say so.
 */
export function expiredTodayWarning(
  days: readonly VenueDay[],
  today: IsoDate,
): ScrapeWarning | null {
  const todayDays = days.filter((d) => d.date === today);
  if (todayDays.length === 0) return null;

  let live = 0;
  let dropped = 0;
  for (const day of todayDays) {
    for (const movie of day.movies) {
      if (movie.groups.some(isLive)) live++;
      else dropped++;
    }
  }
  if (dropped === 0) return null;

  return {
    kind: 'expired-today',
    message:
      `${dropped} of ${dropped + live} listings for today (${today}) have already started and were excluded. ` +
      `Today's results are necessarily partial — re-run in the morning for a full picture.`,
  };
}

/** A date holding less than this share of the peak day is treated as unposted. */
const HORIZON_DENSITY = 0.6;

/**
 * Last date whose schedule looks fully posted.
 *
 * Theaters publish a week at a time, so the tail of a long window carries only
 * pre-sold events. Measured live for 78205: 147/142/149 live listings through
 * Aug 5, 100 on Aug 6, then 62 on Aug 7 — the drop is the posting boundary, not
 * a week where nothing plays.
 *
 * Today is excluded from the baseline because expired showtimes already thin it.
 */
export function detectHorizon(
  days: readonly VenueDay[],
  dates: readonly IsoDate[],
  today: IsoDate,
): IsoDate {
  const last = dates.at(-1) ?? today;
  // Only dates after today carry evidence. Today is thinned by expired
  // showtimes, and anything earlier is simply gone — a past date at the start
  // of the window reports zero listings, which would otherwise read as the
  // posting boundary and collapse the horizon onto day one.
  const counted = dates.filter((d) => d > today);
  if (counted.length === 0) return last;

  // Measured on the source that posts weekly grids. A library screening a
  // single film three weeks out must not imply the multiplexes have posted
  // that far ahead — and with no such source in the run there is no posting
  // boundary to find, because event calendars publish months ahead in full.
  const scoped = days.filter((d) => d.sourceId === undefined || d.sourceId === 'fandango');
  if (scoped.length === 0) return last;

  const liveCount = (date: IsoDate): number =>
    scoped
      .filter((d) => d.date === date)
      .reduce((sum, d) => sum + d.movies.filter((m) => m.groups.some(isLive)).length, 0);

  const counts = new Map(counted.map((d) => [d, liveCount(d)]));
  const peak = Math.max(...counts.values());
  if (peak === 0) return last;

  const floor = peak * HORIZON_DENSITY;
  let horizon = dates[0] ?? last;
  for (const date of dates) {
    if (date <= today) {
      horizon = date;
      continue;
    }
    if ((counts.get(date) ?? 0) < floor) break;
    horizon = date;
  }
  return horizon;
}

/**
 * First date whose listings can be trusted as complete.
 *
 * When today's showtimes have partly started, a film that has run for weeks
 * shows nothing for today and would otherwise be described as "opens Monday".
 * Skipping today makes its absence read as unknown rather than as a gap.
 */
export function detectKnownFrom(
  dates: readonly IsoDate[],
  today: IsoDate,
  todayIsPartial: boolean,
  horizon: IsoDate,
): IsoDate {
  // Dates before today have no listings left at all, so they can never be the
  // start of reliable data.
  const usable = dates.filter((d) => d >= today);
  const first = usable[0] ?? dates[0] ?? today;
  if (!todayIsPartial || first !== today) return first;
  const next = usable[1];
  // Never skip past the horizon; a one-day window has to use what it has.
  if (next === undefined || next > horizon) return first;
  return next;
}

/** Dates already gone by the time the scrape ran. */
export function pastDatesWarning(
  dates: readonly IsoDate[],
  today: IsoDate,
): ScrapeWarning | null {
  const past = dates.filter((d) => d < today);
  if (past.length === 0) return null;
  return {
    kind: 'partial-horizon',
    message:
      `${String(past.length)} date${past.length === 1 ? '' : 's'} in the window ` +
      `(${past[0] ?? ''}${past.length > 1 ? ` – ${past.at(-1) ?? ''}` : ''}) ` +
      `already passed, so no showtimes remain for them.`,
  };
}

export function horizonWarning(horizon: IsoDate, dates: readonly IsoDate[]): ScrapeWarning | null {
  const last = dates.at(-1);
  if (last === undefined || horizon >= last) return null;
  return {
    kind: 'partial-horizon',
    message:
      `Fandango has only posted full schedules through ${horizon}. Dates after that show pre-sold ` +
      `events and advance tickets, so a film missing from them may simply not be on sale yet.`,
  };
}

function collectTheaters(days: readonly VenueDay[]): Theater[] {
  const byName = new Map<string, Theater>();
  for (const day of days) {
    const existing = byName.get(day.theater.name);
    if (!existing || day.theater.miles < existing.miles) byName.set(day.theater.name, day.theater);
  }
  return [...byName.values()].sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name));
}

/**
 * Merge several sources' progress into one counter.
 *
 * Each source counts its own work, so with them running together the raw
 * numbers would jump around. This sums the latest reading from each into a
 * single "N of M" that only ever moves forward.
 */
export function combineProgress(
  sourceIds: readonly string[],
  onProgress: ProgressFn | undefined,
): (sourceId: string) => ProgressFn | undefined {
  if (!onProgress) return () => undefined;
  const state = new Map(sourceIds.map((id) => [id, { step: 0, total: 0 }]));
  return (sourceId) => (update) => {
    state.set(sourceId, { step: update.step, total: update.total });
    let step = 0;
    let total = 0;
    for (const entry of state.values()) {
      step += entry.step;
      total += entry.total;
    }
    onProgress({ message: update.message, step, total });
  };
}

export interface PipelineOptions {
  readonly aliases: AliasConfig;
  readonly keepYears: boolean;
  readonly timezone: string;
  readonly onProgress?: ProgressFn;
  /** Sources exempt from the radius filter because they get their own table. */
  readonly unfilteredSources?: ReadonlySet<string>;
}

export async function runPipeline(
  sources: readonly Source[],
  request: ScrapeRequest,
  options: PipelineOptions,
): Promise<ScrapeResult> {
  const dates = dateRange(request.from, request.to);
  const days: VenueDay[] = [];
  const warnings: ScrapeWarning[] = [];

  // Sources hit unrelated hosts, so they run together: the whole scrape costs
  // the slowest source rather than the sum of all of them.
  const progress = combineProgress(sources.map((s) => s.id), options.onProgress);
  const results = await Promise.all(
    sources.map((source) =>
      source
        .harvest({
          zip: request.zip,
          dates,
          radiusMiles: request.radiusMiles,
          ...(() => {
            const fn = progress(source.id);
            return fn ? { onProgress: fn } : {};
          })(),
        })
        .catch((error: unknown) => ({
          days: [],
          warnings: [
            {
              kind: 'page-error' as const,
              message: `${source.id} failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        })),
    ),
  );
  for (const result of results) {
    days.push(...result.days);
    warnings.push(...result.warnings);
  }

  const today = todayIn(options.timezone);
  const expired = expiredTodayWarning(days, today);
  if (expired) warnings.push(expired);

  const stale = pastDatesWarning(dates, today);
  if (stale) warnings.push(stale);

  const horizon = detectHorizon(days, dates, today);
  const knownFrom = detectKnownFrom(dates, today, expired !== null, horizon);
  const partial = horizonWarning(horizon, dates);
  if (partial) warnings.push(partial);

  // Venues broken out into their own table are wanted by name, so distance
  // stops being a reason to drop them.
  const exempt = options.unfilteredSources ?? new Set<string>();
  const inRange = days.filter(
    (d) => d.theater.miles <= request.radiusMiles || exempt.has(d.sourceId ?? 'fandango'),
  );

  const theaters = collectTheaters(inRange);
  const movies = aggregate(inRange, theaters, {
    aliases: options.aliases,
    keepYears: options.keepYears,
  });

  return { request, dates, horizon, knownFrom, theaters, movies, warnings };
}
