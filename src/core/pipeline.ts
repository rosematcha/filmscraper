import { aggregate, isLive, type AliasConfig } from './aggregate.js';
import { dateRange } from './notes.js';
import type {
  IsoDate,
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

function collectTheaters(days: readonly VenueDay[]): Theater[] {
  const byName = new Map<string, Theater>();
  for (const day of days) {
    const existing = byName.get(day.theater.name);
    if (!existing || day.theater.miles < existing.miles) byName.set(day.theater.name, day.theater);
  }
  return [...byName.values()].sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name));
}

export interface PipelineOptions {
  readonly aliases: AliasConfig;
  readonly keepYears: boolean;
  readonly timezone: string;
  readonly onProgress?: (message: string) => void;
}

export async function runPipeline(
  sources: readonly Source[],
  request: ScrapeRequest,
  options: PipelineOptions,
): Promise<ScrapeResult> {
  const dates = dateRange(request.from, request.to);
  const days: VenueDay[] = [];
  const warnings: ScrapeWarning[] = [];

  for (const source of sources) {
    const result = await source.harvest({
      zip: request.zip,
      dates,
      radiusMiles: request.radiusMiles,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
    days.push(...result.days);
    warnings.push(...result.warnings);
  }

  const expired = expiredTodayWarning(days, todayIn(options.timezone));
  if (expired) warnings.push(expired);

  const theaters = collectTheaters(days);
  const movies = aggregate(days, theaters, {
    aliases: options.aliases,
    keepYears: options.keepYears,
  });

  return { request, dates, theaters, movies, warnings };
}
