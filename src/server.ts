import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { loadAliases } from './core/config.js';
import { renderMarkdown, renderRows } from './core/markdown.js';
import { runPipeline, todayIn } from './core/pipeline.js';
import { unfilteredSources, type ForeignMode, type SectionOptions } from './core/sections.js';
import type { RenderOptions, ScrapeRequest } from './core/types.js';
import { BrowserSession, DEFAULT_BROWSER_OPTIONS } from './net/browser.js';
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
  separateDriveIn?: unknown;
  separateLibrary?: unknown;
  separateEvents?: unknown;
  foreign?: unknown;
}

interface ParsedBody {
  request: ScrapeRequest;
  options: RenderOptions;
  sources: string[];
  concurrency: number;
  sections: SectionOptions;
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
    typeof body.concurrency === 'number' && body.concurrency >= 1 ? body.concurrency : 3;

  const foreign: ForeignMode =
    body.foreign === 'separate' || body.foreign === 'exclude' ? body.foreign : 'inline';

  return {
    sources,
    concurrency,
    sections: {
      separateDriveIn: body.separateDriveIn !== false,
      separateLibrary: body.separateLibrary !== false,
      separateEvents: body.separateEvents === true,
      foreign,
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

/**
 * Scrape and stream progress.
 *
 * A run takes tens of seconds, so progress is streamed rather than left to a
 * spinner with nothing behind it.
 */
app.post('/api/scrape', async (c) => {
  const parsed = parseBody(await c.req.json<ScrapeBody>().catch(() => ({})));
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  const { request, options, sources, concurrency, sections } = parsed;
  return streamSSE(c, async (stream) => {
    const session = new BrowserSession({ ...DEFAULT_BROWSER_OPTIONS, timezone: TIMEZONE });
    const send = async (event: string, data: unknown): Promise<void> => {
      await stream.writeSSE({ event, data: JSON.stringify(data) });
    };

    try {
      // Only Fandango needs Playwright; feed-only runs skip the browser.
      if (needsBrowser(sources)) await session.open();
      const aliases = await loadAliases();
      await send('progress', {
        message: `${request.zip} · ${request.from} → ${request.to} · ${String(request.radiusMiles)} mi`,
        step: 0,
        total: 0,
      });

      // Writes are chained rather than awaited inline: the pipeline's callback
      // is synchronous, and buffering these until the run finished was why the
      // UI sat silent for the whole scrape.
      let writes = Promise.resolve();
      const result = await runPipeline(buildSources(sources, session, concurrency), request, {
        aliases,
        keepYears: options.keepYears,
        timezone: TIMEZONE,
        unfilteredSources: unfilteredSources(sections),
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
          notes: row.notes,
          theaterCount: row.movie.theaters.length,
          dateCount: row.movie.dates.length,
          isEvent: row.movie.isEvent,
          section: row.section ?? 'main',
          sectionHeading: row.sectionHeading ?? null,
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
