import { aggregate, isLive, type AliasConfig } from './aggregate.js';
import { applyVenueFilter } from './filters.js';
import type { Coords } from './geo.js';
import { dateRange, humanList, shortenTheater, weekdayAndDate } from './notes.js';
import type {
  IsoDate,
  ProgressFn,
  ScrapeRequest,
  ScrapeResult,
  ScrapeWarning,
  Theater,
  VenueDay,
} from './types.js';
import type { Source, SourceProgressFn } from '../sources/source.js';

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
 * Days from the source that posts weekly grids, which is the only source a
 * posting boundary can be read from. Fandango days carry no source id, being
 * the run's default source.
 */
function isWeeklyGridDay(day: VenueDay): boolean {
  return day.sourceId === undefined || day.sourceId === 'fandango';
}

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
  const scoped = days.filter(isWeeklyGridDay);
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
export function pastDatesWarning(dates: readonly IsoDate[], today: IsoDate): ScrapeWarning | null {
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

/** A theater-day holding less than this share of the venue's peak is unposted. */
const THEATER_DENSITY = 0.5;

/**
 * A venue whose busiest day lists fewer films than this cannot be measured by
 * density. The Rainbow Theater books one film for three dates a month: that is
 * its whole schedule, not a schedule waiting to be posted.
 */
const MIN_MEASURABLE_PEAK = 4;

/** A theater still showing pre-sales where the rest have posted schedules. */
export interface TheaterLag {
  readonly theater: string;
  /** Last date whose schedule looks posted at this venue. */
  readonly postedThrough: IsoDate;
}

/**
 * Theaters that have not caught up to the market-wide posting boundary.
 *
 * Most theaters put the coming week on sale Tuesday or Wednesday, but not in
 * step: the Regals can be posted through Sunday while Rivercenter still shows
 * one pre-sold title a day past Wednesday. The global horizon averages over
 * that split, so the laggards need naming on their own.
 *
 * Each venue is measured against its own peak, the same way `detectHorizon`
 * measures the market. A sentinel film from `AliasConfig.sentinels` — a title
 * that screens daily year-round, like Rivercenter's *Alamo: The Price of
 * Freedom* — marks a thin day as posted anyway, since the fixture only appears
 * once the real grid is up. Its absence never condemns a busy day: even a
 * thirty-year run can lose a date to an IMAX takeover.
 */
export function laggingTheaters(
  days: readonly VenueDay[],
  dates: readonly IsoDate[],
  today: IsoDate,
  horizon: IsoDate,
  sentinels: Readonly<Record<string, string>>,
): TheaterLag[] {
  const future = dates.filter((d) => d > today);
  if (future.length === 0) return [];

  const sentinelFor = new Map(
    Object.entries(sentinels).map(([name, title]) => [name.toLowerCase(), title.toLowerCase()]),
  );

  interface Venue {
    readonly counts: Map<IsoDate, number>;
    readonly sentinelDates: Set<IsoDate>;
  }
  const venues = new Map<string, Venue>();
  for (const day of days) {
    // Only the weekly-grid source can lag. An event calendar posts months
    // ahead in full, so density says nothing about it.
    if (!isWeeklyGridDay(day)) continue;
    const live = day.movies.filter((m) => m.groups.some(isLive));
    let venue = venues.get(day.theater.name);
    if (!venue) {
      venue = { counts: new Map(), sentinelDates: new Set() };
      venues.set(day.theater.name, venue);
    }
    venue.counts.set(day.date, (venue.counts.get(day.date) ?? 0) + live.length);
    const sentinel = sentinelFor.get(day.theater.name.toLowerCase());
    if (sentinel !== undefined && live.some((m) => m.title.toLowerCase().includes(sentinel))) {
      venue.sentinelDates.add(day.date);
    }
  }

  // Today is part of the baseline even though expired showtimes may have
  // thinned it: the theater that has posted nothing past today at all has no
  // future peak to measure, and the worst laggard would otherwise slip the
  // warning. A thinned count only ever lowers the floor, which errs quiet.
  const measured = dates.filter((d) => d >= today);

  const lags: TheaterLag[] = [];
  for (const [theater, venue] of venues) {
    const peak = Math.max(...measured.map((d) => venue.counts.get(d) ?? 0));
    if (peak < MIN_MEASURABLE_PEAK) continue;
    const floor = peak * THEATER_DENSITY;

    let postedThrough = dates[0] ?? today;
    for (const date of dates) {
      if (date <= today) {
        postedThrough = date;
        continue;
      }
      if (!venue.sentinelDates.has(date) && (venue.counts.get(date) ?? 0) < floor) break;
      postedThrough = date;
    }
    if (postedThrough < horizon) lags.push({ theater, postedThrough });
  }
  return lags.sort(
    (a, b) => a.postedThrough.localeCompare(b.postedThrough) || a.theater.localeCompare(b.theater),
  );
}

export function theaterLagWarning(
  lags: readonly TheaterLag[],
  theaterNames: Readonly<Record<string, string>>,
): ScrapeWarning | null {
  const first = lags[0];
  if (first === undefined) return null;

  // Grouped by boundary, because the laggards mostly share one: a midweek
  // split can put seventeen venues here, and naming a date seventeen times
  // buries the theaters it is meant to surface.
  const byDate = new Map<IsoDate, string[]>();
  for (const lag of lags) {
    const names = byDate.get(lag.postedThrough) ?? [];
    names.push(shortenTheater(lag.theater, theaterNames));
    byDate.set(lag.postedThrough, names);
  }

  const where = lags.length === 1 ? 'there' : 'at these venues';
  const when = byDate.size === 1 ? 'that date' : 'those dates';
  const explain =
    `Most theaters announce the coming week on Tuesday or Wednesday, so a film missing ` +
    `${where} after ${when} may not be on sale yet.`;

  // Dates are spelled out the way the notes spell them: the warning sits
  // above a table that says "through Thursday", not "through 2026-09-10".
  if (lags.length === 1) {
    return {
      kind: 'theater-lag',
      message:
        `${shortenTheater(first.theater, theaterNames)} has not posted full schedules ` +
        `past ${weekdayAndDate(first.postedThrough)} yet. ${explain}`,
    };
  }

  const groups = [...byDate]
    .map(([date, names], i) =>
      i === 0
        ? `${humanList(names)} ${names.length === 1 ? 'has' : 'have'} listings through ` +
          weekdayAndDate(date)
        : `${humanList(names)} through ${weekdayAndDate(date)}`,
    )
    .join('; ');
  return {
    kind: 'theater-lag',
    message: `Some theaters have not posted full schedules yet: ${groups}. ${explain}`,
  };
}

export function horizonWarning(horizon: IsoDate, dates: readonly IsoDate[]): ScrapeWarning | null {
  const last = dates.at(-1);
  if (last === undefined || horizon >= last) return null;
  return {
    kind: 'partial-horizon',
    message:
      `Fandango has only posted full schedules through ${weekdayAndDate(horizon)}. ` +
      `Dates after that show pre-sold ` +
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
 * Tag a source's progress with its own id.
 *
 * Readings are deliberately *not* merged into one counter. With several sources
 * running at once a single number jumps between unrelated jobs and the line
 * flickers; keeping them separate lets each be displayed on its own row, where
 * every count moves forward on its own.
 */
export function taggedProgress(
  sourceId: string,
  onProgress: ProgressFn | undefined,
): SourceProgressFn | undefined {
  if (!onProgress) return undefined;
  return (update) => {
    onProgress({ ...update, sourceId });
  };
}

export interface PipelineOptions {
  readonly aliases: AliasConfig;
  readonly keepYears: boolean;
  readonly timezone: string;
  readonly onProgress?: ProgressFn;
  /** Sources exempt from the radius filter because they get their own table. */
  readonly unfilteredSources?: ReadonlySet<string>;
  /** Chains to drop from the results, from `chains.ts`. */
  readonly excludedChains?: ReadonlySet<string>;
  /** Measure the radius from here rather than from the ZIP's centroid. */
  readonly anchor?: Coords | null;
  /**
   * Radius the sources search, when it has to exceed the requested one.
   *
   * An anchor off to one side of the ZIP is only fully covered by a wider
   * search; the extra venues that turns up are dropped by the radius filter
   * unless they are genuinely close to the anchor.
   */
  readonly searchRadiusMiles?: number;
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
  const results = await Promise.all(
    sources.map((source) => {
      const tagged = taggedProgress(source.id, options.onProgress);
      const finish = <T>(value: T): T => {
        options.onProgress?.({
          sourceId: source.id,
          message: 'done',
          step: 1,
          total: 1,
          done: true,
        });
        return value;
      };
      return source
        .harvest({
          zip: request.zip,
          dates,
          radiusMiles: options.searchRadiusMiles ?? request.radiusMiles,
          ...(tagged ? { onProgress: tagged } : {}),
        })
        .then((result) => ({ ...finish(result), sourceId: source.id }))
        .catch((error: unknown) => ({
          ...finish({
            days: [],
            warnings: [
              {
                kind: 'page-error' as const,
                message: `${source.id} failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          }),
          sourceId: source.id,
          complete: false,
          failedDates: [] as readonly IsoDate[],
        }));
    }),
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
  const inRange = applyVenueFilter(days, {
    excludedChains: options.excludedChains ?? new Set<string>(),
    anchor: options.anchor ?? null,
    radiusMiles: request.radiusMiles,
    exemptSources: options.unfilteredSources ?? new Set<string>(),
  });

  // Measured after the venue filter, so the warning never names a theater the
  // radius or a chain exclusion has already dropped from the table.
  const lagging = theaterLagWarning(
    laggingTheaters(inRange, dates, today, horizon, options.aliases.sentinels),
    options.aliases.theaterNames,
  );
  if (lagging) warnings.push(lagging);

  const theaters = collectTheaters(inRange);
  const movies = aggregate(inRange, theaters, {
    aliases: options.aliases,
    keepYears: options.keepYears,
  });
  const failedSourceIds = results
    .filter(
      (result) =>
        result.complete === false ||
        ((result.failedDates?.length ?? 0) === 0 &&
          result.days.length === 0 &&
          result.warnings.some((warning) => warning.kind === 'page-error')),
    )
    .map((result) => result.sourceId);
  const failedSourceDates = Object.fromEntries(
    results
      .filter((result) => (result.failedDates?.length ?? 0) > 0)
      .map((result) => [result.sourceId, result.failedDates ?? []]),
  );

  return {
    request,
    dates,
    horizon,
    knownFrom,
    theaters,
    movies,
    warnings,
    days: inRange,
    failedSourceIds,
    ...(Object.keys(failedSourceDates).length > 0 ? { failedSourceDates } : {}),
  };
}
