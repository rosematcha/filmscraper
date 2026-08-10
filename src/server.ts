import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { resolveChain } from './core/chains.js';
import { loadAliases } from './core/config.js';
import { paddedRadius } from './core/filters.js';
import { renderMarkdown, renderRows } from './core/markdown.js';
import { shortenTheater } from './core/notes.js';
import { runPipeline, todayIn } from './core/pipeline.js';
import {
  DEFAULT_TABLE_IDS,
  knownTables,
  SECTIONS,
  unfilteredSources,
  type SectionOptions,
} from './core/sections.js';
import type { RenderOptions, ScrapeRequest } from './core/types.js';
import type { Coords } from './core/geo.js';
import { BrowserSession, DEFAULT_BROWSER_OPTIONS } from './net/browser.js';
import { geocodeAddress, zipCentroid } from './net/geocode.js';
import { buildSources, DEFAULT_SOURCE_IDS, needsBrowser, SOURCES } from './sources/registry.js';

const PORT = Number(process.env['PORT'] ?? 8787);
const TIMEZONE = process.env['TIMEZONE'] ?? 'America/Chicago';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ScrapeBody {
  zip?: unknown;
  from?: unknown;
  to?: unknown;
  radius?: unknown;
  keepYears?: unknown;
  showAccessibility?: unknown;
  showLanguage?: unknown;
  sources?: unknown;
  concurrency?: unknown;
  tables?: unknown;
  excludeForeign?: unknown;
  excludeChains?: unknown;
  anchor?: unknown;
}

interface ParsedBody {
  request: ScrapeRequest;
  options: RenderOptions;
  sources: string[];
  concurrency: number;
  sections: SectionOptions;
  excludedChains: Set<string>;
  /** Free-text address to measure from; resolved once the request is accepted. */
  anchor: string | null;
}

function parseBody(body: ScrapeBody): ParsedBody | { error: string } {
  const zip = typeof body.zip === 'string' && /^\d{5}$/.test(body.zip) ? body.zip : null;
  if (!zip) return { error: 'zip must be five digits' };

  const from = typeof body.from === 'string' && ISO_DATE.test(body.from) ? body.from : todayIn(TIMEZONE);
  const to = typeof body.to === 'string' && ISO_DATE.test(body.to) ? body.to : from;
  if (to < from) return { error: '"to" is before "from"' };

  const radius = typeof body.radius === 'number' && body.radius > 0 ? body.radius : 15;
  if (radius > 100) return { error: 'radius must be 100 miles or less' };

  const known = new Set(SOURCES.map((s) => s.id));
  const sources = Array.isArray(body.sources)
    ? body.sources.filter((id): id is string => typeof id === 'string' && known.has(id))
    : [...DEFAULT_SOURCE_IDS];
  if (sources.length === 0) return { error: 'pick at least one source' };

  const concurrency =
    typeof body.concurrency === 'number' && body.concurrency >= 1 ? body.concurrency : 2;

  const tables = Array.isArray(body.tables)
    ? knownTables(body.tables.filter((id): id is string => typeof id === 'string'))
    : [...DEFAULT_TABLE_IDS];

  const excludedChains = new Set(
    (Array.isArray(body.excludeChains) ? body.excludeChains : [])
      .filter((id): id is string => typeof id === 'string')
      .map((id) => resolveChain(id))
      .filter((id): id is string => id !== null),
  );

  const anchor = typeof body.anchor === 'string' && body.anchor.trim() !== '' ? body.anchor.trim() : null;

  return {
    sources,
    concurrency,
    excludedChains,
    anchor,
    sections: {
      tables,
      excludeForeign: body.excludeForeign === true,
      currentYear: Number(todayIn(TIMEZONE).slice(0, 4)),
    },
    request: { zip, from, to, radiusMiles: radius },
    options: {
      keepYears: body.keepYears === true,
      showAccessibility: body.showAccessibility === true,
      showLanguage: body.showLanguage === true,
    },
  };
}

const app = new Hono();
app.use('/api/*', cors());

app.get('/api/health', (c) => c.json({ ok: true, timezone: TIMEZONE }));

app.get('/api/sources', (c) => c.json({ sources: SOURCES }));

/** The tables the build supports, so the checklist is never out of date. */
app.get('/api/tables', (c) =>
  c.json({
    tables: SECTIONS.map(({ id, label, hint, mode, defaultOn }) => ({
      id,
      label,
      hint,
      mode,
      defaultOn,
    })),
  }),
);

/**
 * Scrape and stream progress.
 *
 * A run takes tens of seconds, so progress is streamed rather than left to a
 * spinner with nothing behind it.
 */
app.post('/api/scrape', async (c) => {
  const parsed = parseBody(await c.req.json<ScrapeBody>().catch(() => ({})));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  const { request, options, sources, concurrency, sections, excludedChains, anchor } = parsed;
  return streamSSE(c, async (stream) => {
    const session = new BrowserSession({ ...DEFAULT_BROWSER_OPTIONS, timezone: TIMEZONE });
    const send = async (event: string, data: unknown): Promise<void> => {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    };

    try {
      // Only Fandango needs Playwright; feed-only runs skip the browser.
      if (needsBrowser(sources)) await session.open();
      // An address that cannot be located would silently fall back to the ZIP,
      // so it is reported rather than absorbed.
      let anchorPoint: Coords | null = null;
      if (anchor !== null) {
        anchorPoint = await geocodeAddress(anchor);
        if (!anchorPoint) {
          await send('failed', { message: `Could not locate "${anchor}".` });
          return;
        }
      }
      // Sources search outward from the ZIP, so an off-centre anchor needs a
      // wider sweep than the radius it will finally be filtered to.
      const searchRadiusMiles = paddedRadius(
        request.radiusMiles,
        anchorPoint,
        anchorPoint ? await zipCentroid(request.zip) : null,
      );
      const aliases = await loadAliases();
      // Writes are chained rather than awaited inline: the pipeline's callback
      // is synchronous, and buffering these until the run finished was why the
      // UI sat silent for the whole scrape.
      let writes = Promise.resolve();
      const result = await runPipeline(buildSources(sources, session, concurrency), request, {
        aliases,
        keepYears: options.keepYears,
        timezone: TIMEZONE,
        unfilteredSources: unfilteredSources(sections),
        excludedChains,
        anchor: anchorPoint,
        searchRadiusMiles,
        onProgress: (update) => {
          writes = writes.then(() => send('progress', update));
        },
      });
      await writes;

      await send('result', {
        request: result.request,
        dates: result.dates,
        horizon: result.horizon,
        theaters: result.theaters,
        warnings: result.warnings,
        rows: renderRows(result, options, aliases.theaterNames, sections).map((row) => ({
          title: row.movie.title,
          url: row.url,
          links: row.links,
          notes: row.notes,
          theaterCount: row.movie.theaters.length,
          dateCount: row.movie.dates.length,
          isEvent: row.movie.isEvent,
          section: row.section ?? 'main',
          sectionHeading: row.sectionHeading ?? null,
          // Detail for the hover panel on the reach column.
          theaters: row.movie.theaters.map((t) => shortenTheater(t, aliases.theaterNames)),
          dates: [...row.movie.dates],
        })),
        markdown: renderMarkdown(result, options, aliases.theaterNames, sections),
      });
    } catch (error) {
      await send('failed', { message: error instanceof Error ? error.message : String(error) });
    } finally {
      await session.close();
      await stream.close();
    }
  });
});

app.use('/*', serveStatic({ root: './web/dist' }));
app.get('/*', serveStatic({ path: './web/dist/index.html' }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`filmscraper listening on http://localhost:${info.port}`);
});
