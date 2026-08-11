import type { IsoDate, VenueDay } from './types.js';

/**
 * How far ahead one source has actually published.
 *
 * Three numbers, because the obvious one misleads twice over. Mission Marquee
 * lists a film twenty-six days out but only three dates in total: it is an
 * event calendar, and its reach says nothing about whether next Tuesday is
 * posted. Contiguity fixes that and then breaks the other way — one pre-sold
 * ticket a month out made Fandango read as posted for thirty-one straight
 * days. Only `solidDays`, which asks how long a real schedule holds up,
 * survives both.
 */
export interface SourcePosting {
  readonly sourceId: string;
  /** Furthest date with any listing. */
  readonly lastDate: IsoDate;
  /** Days from today to `lastDate`. */
  readonly reachDays: number;
  /** Unbroken days of listings starting today; 0 when today itself is empty. */
  readonly contiguousDays: number;
  /**
   * Unbroken days that still carry a real schedule rather than a stray
   * pre-sale. Contiguity alone is saturated by them: one ticket on sale a
   * month out made Fandango read as posted for thirty-one straight days when
   * the actual grid ran ten. This is the number worth watching.
   */
  readonly solidDays: number;
  /** Distinct dates with at least one listing. */
  readonly datesListed: number;
  readonly listings: number;
}

export interface PostingSnapshot {
  /** The day the scrape ran, which every span is measured from. */
  readonly today: IsoDate;
  readonly sources: readonly SourcePosting[];
}

/** Fandango days carry no source id, being the run's default source. */
const DEFAULT_SOURCE = 'fandango';

/** Share of a source's busiest day a date must keep to count as posted. */
const SOLID_SHARE = 0.5;

function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
}

function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * What each source had posted when the scrape ran.
 *
 * Recorded per run rather than derived from the dataset later, because the
 * dataset merges sources scraped on different days: by the time it is read,
 * "how far ahead was the library posting on Tuesday" is no longer answerable.
 */
export function postingSnapshot(days: readonly VenueDay[], today: IsoDate): PostingSnapshot {
  const dates = new Map<string, Map<IsoDate, number>>();
  for (const day of days) {
    const id = day.sourceId ?? DEFAULT_SOURCE;
    const listings = day.movies.length;
    if (listings === 0) continue;
    const perDate = dates.get(id) ?? new Map<IsoDate, number>();
    perDate.set(day.date, (perDate.get(day.date) ?? 0) + listings);
    dates.set(id, perDate);
  }

  const sources: SourcePosting[] = [];
  for (const [sourceId, perDate] of [...dates].sort(([a], [b]) => a.localeCompare(b))) {
    const listed = [...perDate.keys()].sort();
    const lastDate = listed.at(-1) ?? today;
    let contiguousDays = 0;
    while (perDate.has(addDays(today, contiguousDays))) contiguousDays += 1;

    // Measured against this source's own busiest day, so an event calendar
    // that never lists more than one film a day is judged on its own terms.
    const peak = Math.max(...perDate.values());
    let solidDays = 0;
    while ((perDate.get(addDays(today, solidDays)) ?? 0) >= peak * SOLID_SHARE) solidDays += 1;

    sources.push({
      sourceId,
      lastDate,
      reachDays: Math.max(0, daysBetween(today, lastDate)),
      contiguousDays,
      solidDays,
      datesListed: listed.length,
      listings: [...perDate.values()].reduce((sum, n) => sum + n, 0),
    });
  }
  return { today, sources };
}

/**
 * Sources posting less far ahead than they usually do.
 *
 * The point of keeping history: "the library reaches seven days" is only
 * interesting against "it normally reaches fourteen". Compared on solid days,
 * the one measure neither a stray pre-sale nor a sparse calendar can inflate.
 */
export function laggingSources(
  current: PostingSnapshot,
  history: readonly PostingSnapshot[],
  tolerance = 0.5,
): { sourceId: string; now: number; typical: number }[] {
  const out: { sourceId: string; now: number; typical: number }[] = [];
  for (const source of current.sources) {
    const past = history
      .flatMap((snap) => snap.sources.filter((s) => s.sourceId === source.sourceId))
      .map((s) => s.solidDays)
      .sort((a, b) => a - b);
    if (past.length === 0) continue;
    // Median, so one bad scrape does not move the baseline.
    const typical = past[Math.floor(past.length / 2)] ?? 0;
    if (typical > 0 && source.solidDays < typical * tolerance) {
      out.push({ sourceId: source.sourceId, now: source.solidDays, typical });
    }
  }
  return out;
}
