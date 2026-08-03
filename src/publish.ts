#!/usr/bin/env node
/**
 * Produce the dataset the static site reads.
 *
 * Run on a schedule rather than on demand: Fandango needs a real browser, which
 * no static host provides, so the scrape happens in CI and the site ships the
 * result.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { loadAliases } from './core/config.js';
import { DATASET_VERSION, type Dataset } from './core/dataset.js';
import { runPipeline, todayIn } from './core/pipeline.js';
import { unfilteredSources, DEFAULT_SECTION_OPTIONS } from './core/sections.js';
import type { ProgressUpdate } from './core/types.js';
import { BrowserSession, DEFAULT_BROWSER_OPTIONS } from './net/browser.js';
import { buildSources, DEFAULT_SOURCE_IDS, needsBrowser, SOURCES } from './sources/registry.js';

function positiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new InvalidArgumentError('expected a positive number');
  return parsed;
}

interface PublishOptions {
  zip: string;
  days: number;
  radius: number;
  concurrency: number;
  timezone: string;
  out: string;
}

const program = new Command()
  .name('filmscraper-publish')
  .description('Scrape a window and write the dataset the static site reads')
  .option('-z, --zip <zip>', 'ZIP code to search from', '78205')
  .option('-d, --days <n>', 'days to cover, starting today', positiveNumber, 31)
  .option(
    '-r, --radius <miles>',
    'radius to scrape; the site can filter below this but never above',
    positiveNumber,
    35,
  )
  .option('-c, --concurrency <n>', 'Fandango pages to fetch at once', positiveNumber, 4)
  .option('--timezone <zone>', 'timezone the market sits in', 'America/Chicago')
  .option('-o, --out <file>', 'where to write the dataset', 'web/public/data/latest.json');

program.parse();
const options = program.opts<PublishOptions>();

const from = todayIn(options.timezone);
const to = new Date(Date.parse(`${from}T12:00:00Z`) + (options.days - 1) * 86_400_000)
  .toISOString()
  .slice(0, 10);

const sourceIds = [...DEFAULT_SOURCE_IDS];
const started = Date.now();
const log = (message: string): void => {
  console.error(message);
};
const label = new Map(SOURCES.map((s) => [s.id, s.label]));
let lastLogged = 0;
const progress = ({ sourceId, message, step, total, done }: ProgressUpdate): void => {
  // CI logs are read after the fact, so only milestones are worth a line.
  const now = Date.now();
  if (!done && now - lastLogged < 5000) return;
  lastLogged = now;
  const count = total > 0 ? ` ${String(step)}/${String(total)}` : '';
  log(`[${label.get(sourceId) ?? sourceId}${count}] ${done === true ? 'done' : message}`);
};

const session = new BrowserSession({
  ...DEFAULT_BROWSER_OPTIONS,
  timezone: options.timezone,
});

try {
  if (needsBrowser(sourceIds)) await session.open();
  const aliases = await loadAliases();
  log(`Scraping ${options.zip} · ${from} → ${to} · ${String(options.radius)} mi`);

  const result = await runPipeline(
    buildSources(sourceIds, session, options.concurrency),
    { zip: options.zip, from, to, radiusMiles: options.radius },
    {
      aliases,
      // Years are kept in the published data; the site strips them for display
      // so the `keep years` toggle keeps working without another scrape.
      keepYears: true,
      timezone: options.timezone,
      onProgress: progress,
      unfilteredSources: unfilteredSources({
        ...DEFAULT_SECTION_OPTIONS,
        separateDriveIn: true,
        separateLibrary: true,
      }),
    },
  );

  const dataset: Dataset = {
    version: DATASET_VERSION,
    generatedAt: new Date().toISOString(),
    zip: options.zip,
    from,
    to,
    radiusMiles: options.radius,
    horizon: result.horizon,
    knownFrom: result.knownFrom,
    days: result.days,
    warnings: result.warnings,
  };

  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, JSON.stringify(dataset), 'utf8');

  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  log(
    `Wrote ${options.out} — ${String(result.days.length)} venue-days, ` +
      `${String(result.movies.length)} movies, ${String(result.theaters.length)} theaters, ${seconds}s`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await session.close();
}
