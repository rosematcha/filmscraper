import type { Page } from 'playwright';
import { BrowserSession, gotoWithRetry } from '../../net/browser.js';
import type { IsoDate, ScrapeWarning, VenueDay } from '../../core/types.js';
import { pageDistances, parseShowtimesPage } from './parse.js';

const SITE = 'https://www.fandango.com';

/** Fandango serves ten theaters per page, nearest first. */
const THEATERS_PER_PAGE = 10;
/** Hard stop so a layout change can never spin the pager forever. */
const MAX_PAGES = 12;

const AMENITY_GROUP = '.js-amenity-btn[data-amenity-group]';
const MORE_BUTTON = 'button.js-page-btn, button.pagination__more-btn';

export type HarvestProgress = (message: string) => void;

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
async function harvestDate(
  session: BrowserSession,
  zip: string,
  date: IsoDate,
  radiusMiles: number,
  onProgress: HarvestProgress,
): Promise<{ days: VenueDay[]; warnings: ScrapeWarning[] }> {
  const days: VenueDay[] = [];
  const warnings: ScrapeWarning[] = [];
  const seenTheaters = new Set<string>();
  const page = await session.newPage();

  try {
    await session.throttle();
    await gotoWithRetry(page, `${SITE}/${zip}_movietimes?date=${date}`);
    await page
      .waitForSelector('a[href*="/theater-page"]', { timeout: 45_000 })
      .catch(() => undefined);

    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
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

      const inRange = fresh.filter((d) => d.theater.miles <= radiusMiles);
      days.push(...inRange);
      const nearest = Math.min(...distances);
      const furthest = Math.max(...distances);
      if (fresh.length > 0) {
        onProgress(
          `${date} page ${pageNo}: ${fresh.length} theaters (${nearest.toFixed(2)}–${furthest.toFixed(2)} mi), kept ${inRange.length}`,
        );
      }

      const decision = decideNextPage(fresh.length, furthest, radiusMiles);
      if (decision !== 'continue') break;

      const more = page.locator(MORE_BUTTON).first();
      const hasMore = (await more.count()) > 0 && (await more.isVisible().catch(() => false));
      if (!hasMore) {
        if (furthest <= radiusMiles && parsed.length === THEATERS_PER_PAGE) {
          warnings.push({
            kind: 'radius-truncated',
            message: `Theater list ended at ${furthest.toFixed(2)} mi for ${date}, inside the ${radiusMiles} mi radius. Some venues may be missing.`,
          });
        }
        break;
      }

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
}

export async function harvestFandango(
  session: BrowserSession,
  options: HarvestOptions,
): Promise<{ days: VenueDay[]; warnings: ScrapeWarning[] }> {
  const onProgress = options.onProgress ?? ((): void => undefined);
  const days: VenueDay[] = [];
  const warnings: ScrapeWarning[] = [];

  for (const date of options.dates) {
    const result = await harvestDate(
      session,
      options.zip,
      date,
      options.radiusMiles,
      onProgress,
    );
    days.push(...result.days);
    warnings.push(...result.warnings);
  }

  return { days, warnings };
}
