#!/usr/bin/env node
/**
 * Produce the dataset the static site reads.
 *
 * Run on a schedule rather than on demand: Fandango needs a real browser, which
 * no static host provides, so the scrape happens in CI and the site ships the
 * result.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { loadAliases } from './core/config.js';
import { isDataset, mergeDataset, type Dataset } from './core/dataset.js';
import { allSources, dueSources } from './core/schedule.js';
import { runPipeline, todayIn } from './core/pipeline.js';
import { laggingSources, postingSnapshot } from './core/posting.js';
import { historyKv, readHistory, recordSnapshot } from './store/history.js';
import { unfilteredSources, DEFAULT_SECTION_OPTIONS, SECTIONS } from './core/sections.js';
import type { ProgressUpdate, VenueDay } from './core/types.js';
import { BrowserSession, DEFAULT_BROWSER_OPTIONS } from './net/browser.js';
import { fetchWithPolicy } from './net/fetch.js';
import { buildSources, DEFAULT_SOURCE_IDS, needsBrowser, SOURCES } from './sources/registry.js';

function positiveNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new InvalidArgumentError('expected a positive number');
  return parsed;
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('expected a positive integer');
  }
  return parsed;
}

interface PublishOptions {
  zip: string;
  days: number;
  radius: number;
  concurrency: number;
  timezone: string;
  out: string;
  sources?: string[];
  all: boolean;
  mergeFrom?: string;
}

const program = new Command()
  .name('filmscraper-publish')
  .description('Scrape a window and write the dataset the static site reads')
  .option('-z, --zip <zip>', 'ZIP code to search from', '78205')
  .option('-d, --days <n>', 'days to cover, starting today', positiveInteger, 31)
  .option(
    '-r, --radius <miles>',
    'radius to scrape; the site can filter below this but never above',
    positiveNumber,
    35,
  )
  .option('-c, --concurrency <n>', 'Fandango pages to fetch at once', positiveInteger, 4)
  .option('--timezone <zone>', 'timezone the market sits in', 'America/Chicago')
  .option('-o, --out <file>', 'where to write the dataset', 'web/public/data/latest.json')
  .option(
    '-s, --sources <ids>',
    'comma-separated sources; defaults to whichever are due now',
    (value: string) =>
      value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
  )
  .option('--all', 'scrape every source regardless of schedule', false)
  .option('--merge-from <url>', 'previous dataset to carry un-scraped sources over from');

program.parse();
const options = program.opts<PublishOptions>();

const from = todayIn(options.timezone);
const to = new Date(Date.parse(`${from}T12:00:00Z`) + (options.days - 1) * 86_400_000)
  .toISOString()
  .slice(0, 10);

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

/**
 * Read the dataset the last run published.
 *
 * A partial run depends on this: without the previous state the sources that
 * were not due would simply vanish. Failure is therefore not fatal but it does
 * force a full scrape, so the output is always complete rather than truncated.
 */
async function loadPrevious(source: string | undefined): Promise<Dataset | null> {
  if (!source) return null;
  // A SITE_URL with a trailing slash would otherwise ask for `//data/...`.
  const target = source.replace(/(?<!:)\/{2,}/g, '/');
  try {
    const text = target.startsWith('http')
      ? await (await fetchWithPolicy(target, { redirect: 'follow' })).text()
      : await readFile(target, 'utf8');
    const parsed: unknown = JSON.parse(text);
    return isDataset(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const previous = await loadPrevious(options.mergeFrom);

const unknownSources = (options.sources ?? []).filter(
  (id) => !SOURCES.some((source) => source.id === id),
);
if (unknownSources.length > 0) {
  console.error(`unknown source(s): ${unknownSources.join(', ')}`);
  process.exit(1);
}

const requested = options.all
  ? allSources()
  : (options.sources ?? dueSources(new Date())).filter((id) => DEFAULT_SOURCE_IDS.includes(id));

// Nothing carried over means nothing to preserve, so scrape the lot.
const sourceIds = previous === null ? allSources() : requested;
if (previous === null && !options.all && requested.length !== sourceIds.length) {
  log('No previous dataset available; scraping every source so the output is complete.');
}

if (sourceIds.length === 0) {
  log('Nothing due at this hour; leaving the published dataset untouched.');
  process.exit(0);
}

const session = new BrowserSession({
  ...DEFAULT_BROWSER_OPTIONS,
  timezone: options.timezone,
});

try {
  if (needsBrowser(sourceIds)) await session.open();
  const aliases = await loadAliases();
  log(
    `Scraping ${options.zip} · ${from} → ${to} · ${String(options.radius)} mi · ` +
      `${sourceIds.join(', ')}${previous ? ' (merging with previous)' : ''}`,
  );

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
      // The published dataset must carry every venue the site might later
      // break out, so the radius exemptions are taken at their widest.
      unfilteredSources: unfilteredSources({
        ...DEFAULT_SECTION_OPTIONS,
        tables: SECTIONS.map((s) => s.id),
      }),
    },
  );

  const dataset = mergeDataset(
    previous,
    {
      days: result.days,
      warnings: result.warnings,
      sourceIds,
      ...(result.failedSourceIds ? { failedSourceIds: result.failedSourceIds } : {}),
      from,
      to,
      zip: options.zip,
      radiusMiles: options.radius,
      horizon: result.horizon,
      knownFrom: result.knownFrom,
    },
    new Date(),
  );

  // A blocked or broken source is only a warning in the dataset, so without
  // this the run stays green and the log says nothing about it.
  for (const warning of result.warnings) {
    log(`[warning: ${warning.kind}] ${warning.message}`);
  }

  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, JSON.stringify(dataset), 'utf8');

  // Posting depth is measured on the freshly scraped days only: carried-over
  // days describe what a source had posted when *its* run happened.
  await recordPosting(result.days, from);

  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  const carried = dataset.days.length - result.days.length;
  log(
    `Wrote ${options.out} — ${String(dataset.days.length)} venue-days ` +
      `(${String(result.days.length)} fresh, ${String(carried)} carried), ` +
      `${String(result.theaters.length)} theaters, ${seconds}s`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await session.close();
}

/**
 * Keep a record of how far ahead each source had published, and say so when a
 * source is posting materially less far than it usually does.
 *
 * Internal awareness only, and never fatal: a scrape that produced a good
 * dataset must not fail because a bookkeeping write did.
 */
async function recordPosting(days: readonly VenueDay[], today: string): Promise<void> {
  if (process.env['NETLIFY_SITE_ID'] === undefined) return;
  try {
    const kv = historyKv();
    const snapshot = postingSnapshot(days, today);
    const history = await readHistory(kv);
    await recordSnapshot(kv, snapshot, new Date().toISOString());

    for (const source of snapshot.sources) {
      log(
        `[posting] ${source.sourceId}: ${String(source.solidDays)} solid days ` +
          `(${String(source.contiguousDays)} contiguous), ` +
          `reaches ${source.lastDate} (${String(source.datesListed)} dates listed)`,
      );
    }
    for (const lag of laggingSources(snapshot, history)) {
      log(
        `[posting] ${lag.sourceId} is posting ${String(lag.now)} days ahead, ` +
          `against a usual ${String(lag.typical)} — schedule may be late.`,
      );
    }
  } catch (error) {
    log(`[posting] could not record depth: ${error instanceof Error ? error.message : 'unknown'}`);
  }
}
