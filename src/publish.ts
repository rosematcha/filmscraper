#!/usr/bin/env node
/**
 * Produce the dataset the static site reads.
 *
 * Run on a schedule rather than on demand: Fandango needs a real browser, which
 * no static host provides, so the scrape happens in CI and the site ships the
 * result.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { loadAliases } from './core/config.js';
import { isDataset, mergeDataset, type Dataset } from './core/dataset.js';
import { exportPublicDataset } from './core/export.js';
import { isLedger, nextLedger, type LedgerState } from './core/ledger.js';
import { dateRange } from './core/notes.js';
import { allSources, dueSources, isComprehensiveFandangoRun } from './core/schedule.js';
import { runPipeline, todayIn } from './core/pipeline.js';
import { laggingSources, postingSnapshot } from './core/posting.js';
import { historyKv, readHistory, recordSnapshot } from './store/history.js';
import { unfilteredSources, DEFAULT_SECTION_OPTIONS, SECTIONS } from './core/sections.js';
import type { ProgressUpdate, VenueDay } from './core/types.js';
import { BrowserSession, DEFAULT_BROWSER_OPTIONS } from './net/browser.js';
import { fetchWithPolicy } from './net/fetch.js';
import { buildSources, DEFAULT_SOURCE_IDS, needsBrowser, SOURCES } from './sources/registry.js';
import type { FandangoSourceOptions } from './sources/fandango/index.js';
import { planFandangoRescrape } from './sources/fandango/rescrape.js';

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

/**
 * The ledger the last run published, which sits beside the dataset.
 *
 * The three outcomes are kept apart because `nextLedger` treats them
 * differently: only a site that genuinely has none starts a fresh one.
 */
async function loadPreviousLedger(source: string | undefined): Promise<LedgerState> {
  if (!source) return { kind: 'absent' };
  const target = source.replace(/(?<!:)\/{2,}/g, '/').replace(/[^/]*$/, 'ledger.json');
  try {
    let text: string;
    if (target.startsWith('http')) {
      const response = await fetchWithPolicy(target, { redirect: 'follow' });
      // A 404 is the site saying it has none, which is an answer.
      if (response.status === 404) return { kind: 'absent' };
      if (!response.ok) return { kind: 'unreadable', reason: `HTTP ${String(response.status)}` };
      text = await response.text();
    } else {
      try {
        text = await readFile(target, 'utf8');
      } catch {
        return { kind: 'absent' };
      }
    }
    const parsed: unknown = JSON.parse(text);
    // Served but not a ledger: an older version, or the SPA shell. Either way
    // it is not evidence that no history exists.
    if (!isLedger(parsed)) return { kind: 'unreadable', reason: 'unexpected structure' };
    return { kind: 'loaded', ledger: parsed };
  } catch (error) {
    return { kind: 'unreadable', reason: error instanceof Error ? error.message : 'unknown' };
  }
}

const previous = await loadPrevious(options.mergeFrom);
const previousLedger = await loadPreviousLedger(options.mergeFrom);
if (previousLedger.kind === 'unreadable') {
  log(
    `Could not read the published ledger (${previousLedger.reason}); leaving it untouched. ` +
      `Openings will be judged without history until the next run reads it.`,
  );
}
const aliases = await loadAliases();

const unknownSources = (options.sources ?? []).filter(
  (id) => !SOURCES.some((source) => source.id === id),
);
if (unknownSources.length > 0) {
  console.error(`unknown source(s): ${unknownSources.join(', ')}`);
  process.exit(1);
}

const scheduledAt = new Date();
const requested = options.all
  ? allSources()
  : (options.sources ?? dueSources(scheduledAt)).filter((id) => DEFAULT_SOURCE_IDS.includes(id));

// Nothing carried over means nothing to preserve, so scrape the lot.
let sourceIds = previous === null ? allSources() : requested;
let fandangoOptions: Omit<FandangoSourceOptions, 'concurrency'> = {};
if (previous === null && !options.all && requested.length !== sourceIds.length) {
  log('No previous dataset available; scraping every source so the output is complete.');
}

const compatiblePrevious =
  previous !== null && previous.zip === options.zip && previous.radiusMiles === options.radius;
const scheduledHourlyFandango =
  sourceIds.includes('fandango') &&
  options.sources === undefined &&
  !options.all &&
  !isComprehensiveFandangoRun(scheduledAt) &&
  compatiblePrevious;

if (scheduledHourlyFandango) {
  const dates = dateRange(from, to);
  const plan = planFandangoRescrape(
    previous.days,
    dates,
    from,
    previous.horizon < from ? from : previous.horizon > to ? to : previous.horizon,
    aliases.sentinels,
  );
  const baselineDays = previous.days;
  if (plan.targets.length > 0 && plan.efficient) {
    fandangoOptions = { targets: plan.targets, baselineDays };
    log(
      `Hourly Fandango refresh: ${String(plan.targets.length)} lagging theater(s), ` +
        `${String(plan.targetedPageReads)} direct page(s) versus at least ` +
        `${String(plan.comprehensivePageReads)} ZIP result page(s).`,
    );
  } else if (plan.targets.length > 0) {
    const datesToRefresh = [...new Set(plan.targets.flatMap((target) => target.dates))];
    fandangoOptions = { dates: datesToRefresh, baselineDays };
    log(
      `Hourly Fandango refresh: ZIP search is cheaper than ` +
        `${String(plan.targetedPageReads)} direct theater page(s); refreshing ` +
        `${String(datesToRefresh.length)} incomplete date(s).`,
    );
  } else {
    const next = new Date(`${previous.horizon}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const probe = next.toISOString().slice(0, 10);
    if (probe >= from && probe <= to) {
      fandangoOptions = { dates: [probe], baselineDays };
      log(`Hourly Fandango refresh: no laggards; probing the next unposted date (${probe}).`);
    } else {
      sourceIds = sourceIds.filter((id) => id !== 'fandango');
      log('Hourly Fandango refresh: every theater is already posted through the window.');
    }
  }
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
  log(
    `Scraping ${options.zip} · ${from} → ${to} · ${String(options.radius)} mi · ` +
      `${sourceIds.join(', ')}${previous ? ' (merging with previous)' : ''}`,
  );

  const result = await runPipeline(
    buildSources(sourceIds, session, options.concurrency, fandangoOptions),
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
      ...(result.failedSourceDates ? { failedSourceDates: result.failedSourceDates } : {}),
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

  const outDir = dirname(options.out);
  await mkdir(outDir, { recursive: true });
  await writeFile(options.out, JSON.stringify(dataset), 'utf8');

  // Only the films this run saw are recorded, so a partial refresh cannot
  // pretend a film it never looked at has stopped being listed. A ledger that
  // could not be read is left alone rather than replaced with a new one.
  const ledger = nextLedger(previousLedger, result.movies, from, new Date());
  if (ledger) await writeFile(join(outDir, 'ledger.json'), JSON.stringify(ledger), 'utf8');

  const exportOptions = {
    aliases,
    timezone: options.timezone,
  };
  const truncated = exportPublicDataset(dataset, { ...exportOptions, mode: 'truncated' });
  await writeFile(
    join(outDir, 'full.json'),
    JSON.stringify(exportPublicDataset(dataset, { ...exportOptions, mode: 'full' }), null, 2),
    'utf8',
  );
  await writeFile(join(outDir, 'truncated.json'), JSON.stringify(truncated, null, 2), 'utf8');

  // Posting depth is measured on the freshly scraped days only: carried-over
  // days describe what a source had posted when *its* run happened.
  await recordPosting(result.days, from);

  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  const carried = dataset.days.length - result.days.length;
  log(
    `Wrote ${options.out}, full.json, truncated.json` +
      (ledger
        ? `, ledger.json (${String(Object.keys(ledger.films).length)} films remembered)`
        : '') +
      ` — ` +
      `${String(dataset.days.length)} venue-days ` +
      `(${String(result.days.length)} fresh, ${String(carried)} carried), ` +
      `${String(truncated.theaters.length)} theaters, ${String(truncated.films.length)} films ` +
      `with upcoming showtimes, ${seconds}s`,
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
