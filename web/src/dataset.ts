import { aggregate, type AliasConfig } from '@core/core/aggregate.js';
import { filterDataset, isDataset, type Dataset } from '@core/core/dataset.js';
import { unanchoredVenues } from '@core/core/filters.js';
import type { Coords } from '@core/core/geo.js';
import { renderMarkdown, renderRows, type SortedMovie } from '@core/core/markdown.js';
import { shortenTheater } from '@core/core/notes.js';
import { unfilteredSources, type SectionOptions } from '@core/core/sections.js';
import type { RenderOptions, ScrapeResult, Theater } from '@core/core/types.js';

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
};

/** Fetch the nightly dataset, or null when the site is running without one. */
export async function loadDataset(): Promise<Dataset | null> {
  try {
    const response = await fetch('data/latest.json', { cache: 'no-cache' });
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
  const dates: string[] = [];
  for (let d = new Date(`${from}T12:00:00`); d <= new Date(`${to}T12:00:00`); d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const movies = aggregate(days, theaters, { aliases, keepYears: options.keepYears });
  const result: ScrapeResult = {
    request: { zip: dataset.zip, from, to, radiusMiles: filters.radiusMiles },
    dates,
    // The scrape's own boundaries still apply: a date the multiplexes had not
    // posted when the job ran is unknown, not empty.
    horizon: dataset.horizon < from ? from : dataset.horizon > to ? to : dataset.horizon,
    knownFrom: dataset.knownFrom < from ? from : dataset.knownFrom,
    theaters,
    movies,
    warnings: dataset.warnings,
    days,
  };

  return {
    rows: renderRows(result, options, aliases.theaterNames, sections),
    markdown: renderMarkdown(result, options, aliases.theaterNames, sections),
    theaters,
    movieCount: new Set(movies.map((m) => m.title)).size,
    unanchored: unanchoredVenues(days, filters.anchor),
  };
}

export { shortenTheater };
