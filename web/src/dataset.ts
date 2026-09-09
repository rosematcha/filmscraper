import { aggregate, type AliasConfig } from '@core/core/aggregate.js';
import { filterDataset, isDataset, type Dataset } from '@core/core/dataset.js';
import { unanchoredVenues } from '@core/core/filters.js';
import type { Coords } from '@core/core/geo.js';
import { firstDates, isLedger, watchedSince, type Ledger } from '@core/core/ledger.js';
import { fetchWithPolicy } from '@core/net/fetch.js';
import { renderMarkdown, renderRows, type SortedMovie } from '@core/core/markdown.js';
import { horizonWarning, laggingTheaters, theaterLagWarning } from '@core/core/pipeline.js';
import { dateRange, shortenTheater } from '@core/core/notes.js';
import { unfilteredSources, type SectionOptions } from '@core/core/sections.js';
import type {
  AggregatedMovie,
  IsoDate,
  RenderOptions,
  ScrapeResult,
  ScrapeWarning,
  Theater,
  VenueDay,
} from '@core/core/types.js';

import aliasesJson from '../../config/aliases.json';

export type { Dataset, Ledger };

/**
 * Merge overrides, bundled rather than fetched.
 *
 * The file is small, changes with the code, and reading it at runtime would
 * mean another request before the table could render.
 */
export const ALIASES: AliasConfig = {
  merge: aliasesJson.merge,
  split: aliasesJson.split,
  theaterNames: aliasesJson.theaterNames,
  sentinels: aliasesJson.sentinels,
};

async function loadJson(path: string): Promise<unknown> {
  try {
    const response = await fetchWithPolicy(path, { cache: 'no-cache' });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** Fetch the nightly dataset, or null when the site is running without one. */
export async function loadDataset(): Promise<Dataset | null> {
  const body = await loadJson('data/latest.json');
  return isDataset(body) ? body : null;
}

/**
 * Fetch the listing ledger, or null when none has been published yet.
 *
 * The table renders the same without it; only the judgement of what is
 * opening and what merely skipped a day gets sharper with it.
 */
export async function loadLedger(): Promise<Ledger | null> {
  const body = await loadJson('data/ledger.json');
  return isLedger(body) ? body : null;
}

export interface RenderedDataset {
  rows: SortedMovie[];
  markdown: string;
  theaters: Theater[];
  /** Every date in the window, for the day view. */
  dates: IsoDate[];
  movieCount: number;
  warnings: readonly string[];
  /**
   * Venues the anchor could not re-measure, because the scrape that produced
   * the dataset predates stored coordinates. Their distance is still relative
   * to the ZIP, and saying so beats a silently wrong mile count.
   */
  unanchored: string[];
}

export interface DatasetFilters {
  radiusMiles: number;
  excludedChains: ReadonlySet<string>;
  anchor: Coords | null;
}

function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function theatersOf(days: readonly VenueDay[]): Theater[] {
  return [...new Map(days.map((d) => [d.theater.name, d.theater])).values()].sort(
    (a, b) => a.miles - b.miles || a.name.localeCompare(b.name),
  );
}

/**
 * How far past the window "coming soon" reaches.
 *
 * The dataset covers a month, and every repertory one-nighter in it would
 * bury the fortnight a reader can actually plan around. A week is the same
 * unit the window itself uses.
 */
const LOOKAHEAD_DAYS = 7;

/**
 * Films on sale only for dates just after the window.
 *
 * A film with no showing in the chosen week may well have its opening on sale
 * for the week after. Anything already playing inside the window is left to
 * the window's own tables.
 */
function upcomingAfter(
  dataset: Dataset,
  to: IsoDate,
  filter: Parameters<typeof filterDataset>[3],
  aliases: AliasConfig,
  keepYears: boolean,
  playing: ReadonlySet<string>,
): AggregatedMovie[] {
  if (to >= dataset.to) return [];
  const until = addDays(to, LOOKAHEAD_DAYS);
  const later = filterDataset(
    dataset,
    addDays(to, 1),
    until < dataset.to ? until : dataset.to,
    filter,
  );
  return aggregate(later, theatersOf(later), { aliases, keepYears }).filter(
    (movie) => !playing.has(movie.key),
  );
}

/** Today in the market's timezone. */
function today(): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Re-derive the table in the browser.
 *
 * The dataset ships raw venue-days, so narrowing the radius or the date range
 * is a local recomputation rather than another scrape.
 */
export function renderDataset(
  dataset: Dataset,
  ledger: Ledger | null,
  from: string,
  to: string,
  filters: DatasetFilters,
  options: RenderOptions,
  sections: SectionOptions,
  aliases: AliasConfig,
): RenderedDataset {
  const filter = {
    radiusMiles: filters.radiusMiles,
    excludedChains: filters.excludedChains,
    anchor: filters.anchor,
    exemptSources: unfilteredSources(sections),
  };
  const days = filterDataset(dataset, from, to, filter);
  const theaters = theatersOf(days);
  const dates = dateRange(from, to);

  const movies = aggregate(days, theaters, { aliases, keepYears: options.keepYears });
  const playing = new Set(movies.map((m) => m.key));
  const upcoming = upcomingAfter(dataset, to, filter, aliases, options.keepYears, playing);

  // The scrape's own boundaries still apply: a date the multiplexes had not
  // posted when the job ran is unknown, not empty.
  const horizon = dataset.horizon < from ? from : dataset.horizon > to ? to : dataset.horizon;
  // Only the posting-boundary notes are shown here. A scraper page error is
  // shown beside the freshness line instead, since it describes the machinery
  // rather than the listings.
  const warnings = [
    horizonWarning(horizon, dates),
    theaterLagWarning(
      laggingTheaters(days, dates, today(), horizon, aliases.sentinels),
      aliases.theaterNames,
    ),
  ].filter((warning): warning is ScrapeWarning => warning !== null);
  const result: ScrapeResult = {
    request: { zip: dataset.zip, from, to, radiusMiles: filters.radiusMiles },
    dates,
    horizon,
    knownFrom: dataset.knownFrom < from ? from : dataset.knownFrom,
    theaters,
    movies,
    warnings,
    days,
    upcoming,
    ...(ledger ? { firstDates: firstDates(ledger), watchedSince: watchedSince(ledger) } : {}),
  };

  const rows = renderRows(result, options, aliases.theaterNames, sections);
  const table = renderMarkdown(result, options, aliases.theaterNames, sections);
  const warningMarkdown = warnings.map((warning) => `> **Note:** ${warning.message}`).join('\n>\n');
  return {
    rows,
    markdown: warningMarkdown === '' ? table : `${table}\n\n${warningMarkdown}`,
    theaters,
    dates,
    movieCount: new Set(movies.map((m) => m.title)).size,
    warnings: warnings.map((warning) => warning.message),
    unanchored: unanchoredVenues(days, filters.anchor),
  };
}

export { shortenTheater };
