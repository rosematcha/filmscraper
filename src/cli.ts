#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { Command, InvalidArgumentError } from 'commander';
import { loadAliases } from './core/config.js';
import { renderMarkdown, renderWarnings } from './core/markdown.js';
import { runPipeline, todayIn } from './core/pipeline.js';
import type { ProgressUpdate, RenderOptions, ScrapeRequest } from './core/types.js';
import { BrowserSession, DEFAULT_BROWSER_OPTIONS } from './net/browser.js';
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

const renderOptions: RenderOptions = {
  keepYears: options.keepYears,
  showAccessibility: options.showAccessibility,
  showLanguage: options.showLanguage,
};

const log = (message: string): void => {
  if (!options.quiet) console.error(message);
};

const progress = ({ message, step, total }: ProgressUpdate): void => {
  log(`[${String(step)}/${String(total)}] ${message}`);
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

try {
  // Only Fandango needs Playwright; a feeds-only run should not pay for it.
  if (wantsBrowser) await session.open();
  const aliases = await loadAliases();
  log(
    `Scraping ${request.zip} · ${from}${to === from ? '' : ` → ${to}`} · ${request.radiusMiles} mi · ` +
      options.sources.join(', '),
  );

  const result = await runPipeline(buildSources(options.sources, session), request, {
    aliases,
    keepYears: options.keepYears,
    timezone: options.timezone,
    onProgress: progress,
  });

  const table = renderMarkdown(result, renderOptions, aliases.theaterNames);
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
