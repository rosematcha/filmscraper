import type { IsoDate, Theater, VenueDay } from '../../core/types.js';
import { laggingTheaters } from '../../core/pipeline.js';
import { venueKey } from './seeds.js';
import type { TheaterTarget } from './harvest.js';

/** Fandango's visible pager advances ten theaters at a time. */
export const THEATERS_PER_PAGE = 10;

export interface RescrapePlan {
  readonly targets: readonly TheaterTarget[];
  readonly targetedPageReads: number;
  /** Optimistic lower bound; seed overlap makes comprehensive runs cost more. */
  readonly comprehensivePageReads: number;
  readonly efficient: boolean;
}

export function fandangoTheaters(days: readonly VenueDay[]): Theater[] {
  const theaters = new Map<string, Theater>();
  for (const day of days) {
    if (day.sourceId !== undefined && day.sourceId !== 'fandango') continue;
    const key = venueKey(day.theater.href);
    if (!key.includes('/theater-page')) continue;
    const current = theaters.get(key);
    if (!current || day.theater.miles < current.miles) {
      theaters.set(key, { ...day.theater, href: key });
    }
  }
  return [...theaters.values()].sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name));
}

export function planFandangoRescrape(
  days: readonly VenueDay[],
  dates: readonly IsoDate[],
  today: IsoDate,
  horizon: IsoDate,
  sentinels: Readonly<Record<string, string>>,
): RescrapePlan {
  const theaters = fandangoTheaters(days);
  const targets = theaters.flatMap((theater) => {
    const key = venueKey(theater.href);
    const theaterDays = days.filter(
      (day) =>
        (day.sourceId === undefined || day.sourceId === 'fandango') &&
        venueKey(day.theater.href) === key,
    );
    const [lag] = laggingTheaters(theaterDays, dates, today, horizon, sentinels);
    if (!lag) return [];
    const missing = dates.filter((date) => date > lag.postedThrough && date <= horizon);
    return missing.length === 0 ? [] : [{ theater, dates: missing }];
  });
  const targetedPageReads = targets.reduce((sum, target) => sum + target.dates.length, 0);
  const datesToRefresh = new Set(targets.flatMap((target) => target.dates));
  const comprehensivePageReads =
    Math.ceil(theaters.length / THEATERS_PER_PAGE) * datesToRefresh.size;
  return {
    targets,
    targetedPageReads,
    comprehensivePageReads,
    efficient: targetedPageReads > 0 && targetedPageReads < comprehensivePageReads,
  };
}
