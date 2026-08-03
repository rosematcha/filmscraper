import type { Page } from 'playwright';
import { BrowserSession, gotoWithRetry } from '../../net/browser.js';
import type { IsoDate, ScrapeWarning, VenueDay } from '../../core/types.js';
import { pageDistances, parseShowtimesPage } from './parse.js';
import {
  isCapped,
  nextSeeds,
  normalizeDistances,
  seedBudget,
  THEATERS_PER_ZIP_CAP,
} from './seeds.js';

const SITE = 'https://www.fandango.com';

/** Hard stop so a layout change can never spin the pager forever. */
const MAX_PAGES = 12;

const AMENITY_GROUP = '.js-amenity-btn[data-amenity-group]';
const MORE_BUTTON = 'button.js-page-btn, button.pagination__more-btn';

/** Emits a progress line for the day at `step` of `total`. */
export type HarvestProgress = (message: string, step: number, total: number) => void;

export type PageDecision = 'continue' | 'exhausted' | 'past-radius';

/**
 * Whether to ask for another page of theaters.
 *
 * Two independent stops, both learned the hard way:
 *  - `exhausted`: the pager wraps to the first page instead of ending, so a
 *    page with no new theaters means the list is done.
 *  - `past-radius`: the list is distance-ascending, so once a page runs past
 *    the radius every later page does too.
 */
export function decideNextPage(
  freshCount: number,
  furthestMiles: number,
  radiusMiles: number,
): PageDecision {
  if (freshCount === 0) return 'exhausted';
  if (furthestMiles > radiusMiles) return 'past-radius';
  return 'continue';
}

/**
 * Scroll until the lazily-rendered showtime groups stop appearing.
 *
 * Counts groups rather than movie blocks because the blocks mount before their
 * showtimes hydrate, which would otherwise settle a page early.
 */
async function exhaustLazyLoad(page: Page): Promise<void> {
  let stableRounds = 0;
  let previous = -1;
  for (let i = 0; i < 30 && stableRounds < 3; i++) {
    const count = await page.locator(AMENITY_GROUP).count();
    if (count === previous) stableRounds++;
    else stableRounds = 0;
    previous = count;
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(500);
  }
}

/**
 * Harvest every venue-day for one date.
 *
 * Fandango pages the theater list ten at a time in ascending distance order and
 * *replaces* the list rather than appending, so each page is scraped in turn.
 * The pager stops only once a whole page starts beyond the radius — checking a
 * single distance would let one stray "45 mi" string elsewhere on the page
 * truncate discovery and silently drop the far theaters.
 */
async function harvestSeedDate(
  session: BrowserSession,
  zip: string,
  date: IsoDate,
  radiusMiles: number,
  step: number,
  total: number,
  onProgress: HarvestProgress,
): Promise<{ days: VenueDay[]; warnings: ScrapeWarning[] }> {
  const days: VenueDay[] = [];
  const warnings: ScrapeWarning[] = [];
  const seenTheaters = new Set<string>();
  const page = await session.newPage();
  const report = (message: string): void => {
    onProgress(message, step, total);
  };

  try {
    // Announced before the request, not after: a page takes ~15s and silence
    // reads as a hung app.
    report(`Fandango · ${date} · loading`);
    await session.throttle();
    await gotoWithRetry(page, `${SITE}/${zip}_movietimes?date=${date}`);
    await page
      .waitForSelector('a[href*="/theater-page"]', { timeout: 45_000 })
      .catch(() => undefined);

    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      report(`Fandango · ${date} · page ${pageNo} · reading showtimes`);
      await exhaustLazyLoad(page);
      const html = await page.content();
      const parsed = parseShowtimesPage(html, date);
      const distances = pageDistances(html);

      if (parsed.length === 0) {
        warnings.push({
          kind: 'page-error',
          message: `No theaters parsed for ${date} (page ${pageNo}); Fandango's markup may have changed.`,
        });
        break;
      }

      const fresh = parsed.filter((d) => !seenTheaters.has(d.theater.href));
      for (const d of fresh) seenTheaters.add(d.theater.href);

      // Keep everything the seed returned; the radius filter runs later, once
      // distances have been re-measured against the true search origin.
      days.push(...fresh);
      const nearest = Math.min(...distances);
      const furthest = Math.max(...distances);
      if (fresh.length > 0) {
        report(
          `Fandango · ${date} · ${zip} · page ${pageNo} · ${fresh.length} theaters (${nearest.toFixed(2)}–${furthest.toFixed(2)} mi)`,
        );
      }

      if (decideNextPage(fresh.length, furthest, radiusMiles) !== 'continue') break;

      const more = page.locator(MORE_BUTTON).first();
      const hasMore = (await more.count()) > 0 && (await more.isVisible().catch(() => false));
      if (!hasMore) break;

      await more.scrollIntoViewIfNeeded().catch(() => undefined);
      await more.click({ timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(2500);
    }
  } finally {
    await page.close();
  }

  return { days, warnings };
}

export interface HarvestOptions {
  readonly zip: string;
  readonly dates: readonly IsoDate[];
  readonly radiusMiles: number;
  readonly onProgress?: HarvestProgress;
  /** Pages fetched at once. 1 restores the original serial behaviour. */
  readonly concurrency?: number;
}

/** Ceiling on parallel pages, whatever the caller asks for. */
export const MAX_CONCURRENCY = 8;

export function clampConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.floor(value)));
}

/**
 * Run `jobs` through `worker`, `limit` at a time, preserving input order in the
 * results. Each task owns its own page, so they do not contend.
 */
async function pool<T, R>(
  jobs: readonly T[],
  limit: number,
  worker: (job: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(jobs.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    for (;;) {
      const index = next++;
      const job = jobs[index];
      if (job === undefined) return;
      results[index] = await worker(job, index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function harvestFandango(
  session: BrowserSession,
  options: HarvestOptions,
): Promise<{ days: VenueDay[]; warnings: ScrapeWarning[] }> {
  const onProgress = options.onProgress ?? ((): void => undefined);
  const days: VenueDay[] = [];
  const warnings: ScrapeWarning[] = [];
  const total = options.dates.length;
  const firstDate = options.dates[0];
  if (firstDate === undefined) return { days, warnings };

  // --- pass 1: work out which ZIP seeds are needed --------------------------
  // Fandango returns at most 20 theaters per ZIP however wide the radius, so a
  // large search has to be assembled from several neighbouring ZIPs.
  const seeds = [options.zip];
  const visited = new Set(seeds);
  const seedDays = new Map<string, VenueDay[]>();

  const first = await harvestSeedDate(
    session,
    options.zip,
    firstDate,
    options.radiusMiles,
    1,
    total,
    onProgress,
  );
  seedDays.set(options.zip, first.days);
  warnings.push(...first.warnings);

  const originHrefs = new Set(first.days.map((d) => d.theater.href));
  let frontier = first.days.map((d) => d.theater);

  while (isCapped(frontier, options.radiusMiles) && seeds.length < seedBudget()) {
    const candidates = nextSeeds(frontier, visited, seedBudget() - seeds.length);
    if (candidates.length === 0) break;
    let discovered = 0;
    for (const seed of candidates) {
      visited.add(seed);
      seeds.push(seed);
      onProgress(`Fandango · expanding search to ${seed}`, 1, total);
      const extra = await harvestSeedDate(
        session,
        seed,
        firstDate,
        options.radiusMiles,
        1,
        total,
        onProgress,
      );
      seedDays.set(seed, extra.days);
      discovered += extra.days.filter((d) => !originHrefs.has(d.theater.href)).length;
    }
    if (discovered === 0) break;
    frontier = [...seedDays.values()].flat().map((d) => d.theater);
  }

  if (seeds.length > 1) {
    warnings.push({
      kind: 'radius-truncated',
      message:
        `Fandango lists at most ${String(THEATERS_PER_ZIP_CAP)} theaters per ZIP, which the ` +
        `${String(options.radiusMiles)} mi radius exceeded. Searched ${String(seeds.length)} ZIPs ` +
        `(${seeds.join(', ')}) and measured every venue from ${options.zip}.`,
    });
  }

  // --- pass 2: the remaining dates, across every seed that mattered ---------
  for (const day of seedDays.values()) days.push(...day);

  const jobs = options.dates
    .filter((date) => date !== firstDate)
    .flatMap((date) => seeds.map((seed) => ({ seed, date })));

  const limit = clampConcurrency(options.concurrency);
  let done = 0;
  const outcomes = await pool(jobs, limit, async (job) => {
    const result = await harvestSeedDate(
      session,
      job.seed,
      job.date,
      options.radiusMiles,
      // Progress counts finished pages rather than the calendar day, which is
      // the only meaningful measure once several days are in flight at once.
      done,
      jobs.length,
      (message) => {
        onProgress(message, done, jobs.length);
      },
    );
    done++;
    onProgress(`Fandango · ${job.date} · done`, done, jobs.length);
    return result;
  });

  for (const result of outcomes) {
    days.push(...result.days);
    warnings.push(...result.warnings);
  }

  // Neighbouring seeds overlap heavily, so the same venue-day arrives several
  // times; keep one of each before anything downstream counts listings.
  const unique = new Map<string, VenueDay>();
  for (const day of days) unique.set(`${day.theater.href} ${day.date}`, day);

  const measured = await normalizeDistances([...unique.values()], options.zip, originHrefs);
  return { days: measured.filter((d) => d.theater.miles <= options.radiusMiles), warnings };
}
