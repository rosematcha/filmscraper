#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { Command, InvalidArgumentError } from 'commander';
import { loadAliases } from './core/config.js';
import { renderMarkdown, renderWarnings } from './core/markdown.js';
import { runPipeline, todayIn } from './core/pipeline.js';
import type { RenderOptions, ScrapeRequest } from './core/types.js';
import { BrowserSession, DEFAULT_BROWSER_OPTIONS } from './net/browser.js';
import { FandangoSource } from './sources/fandango/index.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
}

const program = new Command()
  .name('filmscraper')
  .description('Aggregate nearby movie screenings into a markdown table')
  .option('-z, --zip <zip>', 'ZIP code to search from', '78205')
  .option('-f, --from <date>', 'first date, YYYY-MM-DD (default: today)', isoDate)
  .option('-t, --to <date>', 'last date, inclusive (default: same as --from)', isoDate)
  .option('-r, --radius <miles>', 'search radius in miles', positiveNumber, 15)
  .option('--timezone <zone>', 'timezone the market sits in', 'America/Chicago')
  .option('-o, --out <file>', 'write markdown to a file instead of stdout')
  .option('--keep-years', 'keep (YYYY) release years in titles', false)
  .option('--show-accessibility', 'note open/closed caption screenings', false)
  .option('--show-language', 'note dubbed/subtitled screenings', false)
  .option('--headed', 'run the browser headed, for debugging', false)
  .option('-q, --quiet', 'suppress progress output', false);

program.parse();
const options = program.opts<CliOptions>();

const from = options.from ?? todayIn(options.timezone);
const to = options.to ?? from;
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

const session = new BrowserSession({
  ...DEFAULT_BROWSER_OPTIONS,
  timezone: options.timezone,
  headless: !options.headed,
});

try {
  await session.open();
  const aliases = await loadAliases();
  log(`Scraping ${request.zip} · ${from}${to === from ? '' : ` → ${to}`} · ${request.radiusMiles} mi`);

  const result = await runPipeline([new FandangoSource(session)], request, {
    aliases,
    keepYears: options.keepYears,
    timezone: options.timezone,
    onProgress: log,
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
