import { aggregate, type AliasConfig } from '@core/core/aggregate.js';
import { filterDataset, isDataset, type Dataset } from '@core/core/dataset.js';
import { unanchoredVenues } from '@core/core/filters.js';
import type { Coords } from '@core/core/geo.js';
import { fetchWithPolicy } from '@core/net/fetch.js';
import { renderMarkdown, renderRows, type SortedMovie } from '@core/core/markdown.js';
import {
  expiredTodayWarning,
  horizonWarning,
  laggingTheaters,
  pastDatesWarning,
  theaterLagWarning,
} from '@core/core/pipeline.js';
import { dateRange, shortenTheater } from '@core/core/notes.js';
import { unfilteredSources, type SectionOptions } from '@core/core/sections.js';
import type { RenderOptions, ScrapeResult, ScrapeWarning, Theater } from '@core/core/types.js';

import aliasesJson from '../../config/aliases.json';

export type { Dataset };

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

/** Fetch the nightly dataset, or null when the site is running without one. */
export async function loadDataset(): Promise<Dataset | null> {
  try {
    const response = await fetchWithPolicy('data/latest.json', { cache: 'no-cache' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isDataset(body) ? body : null;
  } catch {
    return null;
  }
}

export interface RenderedDataset {
  rows: SortedMovie[];
  markdown: string;
  theaters: Theater[];
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

/**
 * Re-derive the table in the browser.
 *
 * The dataset ships raw venue-days, so narrowing the radius or the date range
 * is a local recomputation rather than another scrape.
 */
export function renderDataset(
  dataset: Dataset,
  from: string,
  to: string,
  filters: DatasetFilters,
  options: RenderOptions,
  sections: SectionOptions,
  aliases: AliasConfig,
): RenderedDataset {
  const days = filterDataset(dataset, from, to, {
    radiusMiles: filters.radiusMiles,
    excludedChains: filters.excludedChains,
    anchor: filters.anchor,
    exemptSources: unfilteredSources(sections),
  });
  const theaters = [...new Map(days.map((d) => [d.theater.name, d.theater])).values()].sort(
    (a, b) => a.miles - b.miles || a.name.localeCompare(b.name),
  );
  const dates = dateRange(from, to);

  const movies = aggregate(days, theaters, { aliases, keepYears: options.keepYears });
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const warnings = dataset.warnings.filter(
    (warning) => warning.kind === 'page-error' || warning.kind === 'radius-truncated',
  );
  // The scrape's own boundaries still apply: a date the multiplexes had not
  // posted when the job ran is unknown, not empty.
  const horizon = dataset.horizon < from ? from : dataset.horizon > to ? to : dataset.horizon;
  const dynamicWarnings = [
    expiredTodayWarning(days, today),
    pastDatesWarning(dates, today),
    horizonWarning(horizon, dates),
    theaterLagWarning(
      laggingTheaters(days, dates, today, horizon, aliases.sentinels),
      aliases.theaterNames,
    ),
  ].filter((warning): warning is ScrapeWarning => warning !== null);
  warnings.push(...dynamicWarnings);
  const result: ScrapeResult = {
    request: { zip: dataset.zip, from, to, radiusMiles: filters.radiusMiles },
    dates,
    horizon,
    knownFrom: dataset.knownFrom < from ? from : dataset.knownFrom,
    theaters,
    movies,
    warnings,
    days,
  };

  const rows = renderRows(result, options, aliases.theaterNames, sections);
  const table = renderMarkdown(result, options, aliases.theaterNames, sections);
  const warningMarkdown = warnings.map((warning) => `> **Note:** ${warning.message}`).join('\n>\n');
  return {
    rows,
    markdown: warningMarkdown === '' ? table : `${table}\n\n${warningMarkdown}`,
    theaters,
    movieCount: new Set(movies.map((m) => m.title)).size,
    warnings: warnings.map((warning) => warning.message),
    unanchored: unanchoredVenues(days, filters.anchor),
  };
}

export { shortenTheater };
