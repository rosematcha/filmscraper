#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { Command, InvalidArgumentError } from 'commander';
import { chainIds, resolveChain } from './core/chains.js';
import { loadAliases } from './core/config.js';
import { paddedRadius } from './core/filters.js';
import { renderMarkdown, renderWarnings } from './core/markdown.js';
import { runPipeline, todayIn } from './core/pipeline.js';
import {
  DEFAULT_TABLE_IDS,
  knownTables,
  SECTIONS,
  unfilteredSources,
  type SectionOptions,
} from './core/sections.js';
import type { ProgressUpdate, RenderOptions, ScrapeRequest } from './core/types.js';
import { BrowserSession, DEFAULT_BROWSER_OPTIONS } from './net/browser.js';
import { geocodeAddress, zipCentroid } from './net/geocode.js';
import { buildSources, DEFAULT_SOURCE_IDS, needsBrowser, SOURCES } from './sources/registry.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A week is the useful unit: it spans a full theatrical program change. */
const DEFAULT_WINDOW_DAYS = 7;

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoDate(value: string): string {
  if (!ISO_DATE.test(value)) throw new InvalidArgumentError('expected YYYY-MM-DD');
  return value;
}

function positiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new InvalidArgumentError('expected a positive number');
  return parsed;
}

interface CliOptions {
  zip: string;
  from?: string;
  to?: string;
  radius: number;
  timezone: string;
  out?: string;
  keepYears: boolean;
  showAccessibility: boolean;
  showLanguage: boolean;
  headed: boolean;
  quiet: boolean;
  sources: string[];
  concurrency: number;
  tables: string[];
  excludeForeign: boolean;
  excludeChains: string[];
  anchor?: string;
}

const program = new Command()
  .name('filmscraper')
  .description('Aggregate nearby movie screenings into a markdown table')
  .option('-z, --zip <zip>', 'ZIP code to search from', '78205')
  .option('-f, --from <date>', 'first date, YYYY-MM-DD (default: today)', isoDate)
  .option('-t, --to <date>', 'last date, inclusive (default: a week from --from)', isoDate)
  .option('-r, --radius <miles>', 'search radius in miles', positiveNumber, 15)
  .option('--timezone <zone>', 'timezone the market sits in', 'America/Chicago')
  .option('-o, --out <file>', 'write markdown to a file instead of stdout')
  .option('--keep-years', 'keep (YYYY) release years in titles', false)
  .option('--show-accessibility', 'note open/closed caption screenings', false)
  .option('--show-language', 'note dubbed/subtitled screenings', false)
  .option(
    '-s, --sources <ids>',
    `comma-separated sources (${SOURCES.map((x) => x.id).join(', ')})`,
    (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean),
    [...DEFAULT_SOURCE_IDS],
  )
  .option(
    '-c, --concurrency <n>',
    'Fandango pages to fetch at once (1 = serial)',
    positiveNumber,
    2,
  )
  .option(
    '-T, --tables <ids>',
    `tables to build — ${SECTIONS.map((s) => s.id).join(', ')}, or "all" / "none"`,
    (value: string) => {
      const ids = value.split(',').map((v) => v.trim()).filter(Boolean);
      if (ids.includes('none')) return [];
      if (ids.includes('all')) return SECTIONS.map((s) => s.id);
      const unknownIds = ids.filter((id) => !SECTIONS.some((s) => s.id === id));
      if (unknownIds.length > 0) {
        throw new InvalidArgumentError(`unknown table(s): ${unknownIds.join(', ')}`);
      }
      return knownTables(ids);
    },
    [...DEFAULT_TABLE_IDS],
  )
  .option('--exclude-foreign', 'drop non-English releases from the output entirely', false)
  .option(
    '-x, --exclude-chains <chains>',
    `drop these chains (${chainIds().join(', ')})`,
    (value: string) => {
      const ids = value.split(',').map((v) => v.trim()).filter(Boolean);
      const resolved = ids.map((id) => {
        const chain = resolveChain(id);
        if (chain === null) throw new InvalidArgumentError(`unknown chain: ${id}`);
        return chain;
      });
      return resolved;
    },
    [],
  )
  .option(
    '-a, --anchor <address>',
    'measure the radius from this address instead of the ZIP centroid',
  )
  .option('--headed', 'run the browser headed, for debugging', false)
  .option('-q, --quiet', 'suppress progress output', false);

program.parse();
const options = program.opts<CliOptions>();

const from = options.from ?? todayIn(options.timezone);
const to = options.to ?? addDays(from, DEFAULT_WINDOW_DAYS - 1);
if (to < from) {
  console.error(`--to (${to}) is before --from (${from})`);
  process.exit(1);
}

const request: ScrapeRequest = {
  zip: options.zip,
  from,
  to,
  radiusMiles: options.radius,
};

const sectionOptions: SectionOptions = {
  tables: options.tables,
  excludeForeign: options.excludeForeign,
  currentYear: Number(todayIn(options.timezone).slice(0, 4)),
};

const renderOptions: RenderOptions = {
  keepYears: options.keepYears,
  showAccessibility: options.showAccessibility,
  showLanguage: options.showLanguage,
};

const log = (message: string): void => {
  if (!options.quiet) console.error(message);
};

const sourceLabel = new Map(SOURCES.map((s) => [s.id, s.label]));

const progress = ({ sourceId, message, step, total, done }: ProgressUpdate): void => {
  if (done) return; // the final line each source prints is enough
  const label = sourceLabel.get(sourceId) ?? sourceId;
  const count = total > 0 ? ` ${String(step)}/${String(total)}` : '';
  log(`[${label}${count}] ${message}`);
};

const unknown = options.sources.filter((id) => !SOURCES.some((s) => s.id === id));
if (unknown.length > 0) {
  console.error(`unknown source(s): ${unknown.join(', ')}`);
  process.exit(1);
}

const session = new BrowserSession({
  ...DEFAULT_BROWSER_OPTIONS,
  timezone: options.timezone,
  headless: !options.headed,
});
const wantsBrowser = needsBrowser(options.sources);

// Resolved before the scrape so a typo'd address fails in a second rather than
// after a minute of page loads.
const anchor = options.anchor ? await geocodeAddress(options.anchor) : null;
if (options.anchor && !anchor) {
  console.error(`could not locate --anchor "${options.anchor}"`);
  process.exit(1);
}
// Sources search outward from the ZIP, so an off-centre anchor needs a wider
// sweep than the radius it will finally be filtered to.
const searchRadiusMiles = paddedRadius(options.radius, anchor, await zipCentroid(options.zip));

try {
  // Only Fandango needs Playwright; a feeds-only run should not pay for it.
  if (wantsBrowser) await session.open();
  const aliases = await loadAliases();
  log(
    `Scraping ${request.zip} · ${from}${to === from ? '' : ` → ${to}`} · ${request.radiusMiles} mi ` +
      `from ${options.anchor ?? request.zip} · ${options.sources.join(', ')}` +
      (options.excludeChains.length > 0 ? ` · without ${options.excludeChains.join(', ')}` : ''),
  );

  const result = await runPipeline(
    buildSources(options.sources, session, options.concurrency),
    request,
    {
      aliases,
      keepYears: options.keepYears,
      timezone: options.timezone,
      onProgress: progress,
      unfilteredSources: unfilteredSources(sectionOptions),
      excludedChains: new Set(options.excludeChains),
      anchor,
      searchRadiusMiles,
    },
  );

  const table = renderMarkdown(result, renderOptions, aliases.theaterNames, sectionOptions);
  const warnings = renderWarnings(result);
  const output = warnings ? `${table}\n\n${warnings}\n` : `${table}\n`;

  if (options.out) {
    await writeFile(options.out, output, 'utf8');
    log(`Wrote ${options.out}`);
  } else {
    process.stdout.write(output);
  }
  log(`${result.movies.length} movies across ${result.theaters.length} theaters`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await session.close();
}
