import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSources,
  scrape,
  type ProgressUpdate,
  type ScrapeResponse,
  type SourceInfo,
} from './api';
import { ALIASES, loadDataset, renderDataset, type Dataset } from './dataset';
import { geocodeAnchor } from './geocode';
import { chainIds, chainLabel } from '@core/core/chains.js';
import type { Coords } from '@core/core/geo.js';
import { DEFAULT_SECTION_OPTIONS } from '@core/core/sections.js';
import { SECTIONS, useTablePrefs } from './tables';
import { describeSchedule } from '@core/core/schedule.js';

/**
 * Labels for sources the API cannot describe, because a deployed site has no
 * API at all and the dataset only carries ids.
 */
const SOURCE_LABELS: Record<string, string> = {
  fandango: 'Fandango',
  'slab-arthouse': 'Slab Cinema Arthouse',
  'slab-outdoor': 'Slab Cinema (outdoor)',
  'mission-marquee': 'Mission Marquee Plaza',
  'tobin-cinema': 'Tobin Center Cinema',
  mcnay: 'McNay Art Museum',
  'ruby-city': 'Ruby City',
  'stars-and-stripes': 'Stars & Stripes Drive-In',
  sapl: 'San Antonio Public Library',
};

/** "3h ago" — sources refresh on different cadences, so absolute times mislead. */
function sinceLabel(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

/**
 * The market the scrape is centred on.
 *
 * Downtown's ZIP is what the scraper searches from, but nobody thinks of where
 * they live as five digits — the city is the honest way to say it. Any other
 * ZIP is a live run somewhere else and gets shown as itself.
 */
const HOME_ZIP = '78205';
const HOME_PLACE = 'San Antonio';

function placeName(zip: string): string {
  return zip === HOME_ZIP ? HOME_PLACE : zip;
}

/** A week spans a full theatrical program change, so it is the useful default. */
const DEFAULT_WINDOW_DAYS = 7;

/** Today in the market's timezone, which is the only window that makes sense as a default. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Compact a run of ISO dates: `["2026-08-04","2026-08-05"]` -> `"Aug 4, 5"`.
 * The full list overflows the row once six pages are in flight.
 */
function compactDates(dates: readonly string[]): string {
  const parts = dates
    .map((d) => /^(\d{4})-(\d{2})-(\d{2})$/.exec(d))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ month: Number(m[2]), day: Number(m[3]) }));
  if (parts.length === 0) return dates.join(', ');

  const monthName = (month: number): string =>
    new Date(Date.UTC(2000, month - 1, 1)).toLocaleDateString('en-US', {
      month: 'short',
      timeZone: 'UTC',
    });

  const out: string[] = [];
  let lastMonth = -1;
  for (const { month, day } of parts) {
    out.push(month === lastMonth ? String(day) : `${monthName(month)} ${String(day)}`);
    lastMonth = month;
  }
  return out.join(', ');
}

/** "2 theaters · 1 day" — the reach numbers behind each Notes cell. */
function reach(theaters: number, dates: number): string {
  const t = `${String(theaters)} theater${theaters === 1 ? '' : 's'}`;
  const d = `${String(dates)} day${dates === 1 ? '' : 's'}`;
  return `${t} · ${d}`;
}

export default function App(): React.JSX.Element {
  const start = today();
  const [zip, setZip] = useState('78205');
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(addDays(start, DEFAULT_WINDOW_DAYS - 1));
  const [radius, setRadius] = useState(15);
  const [keepYears, setKeepYears] = useState(false);
  const [excludedChains, setExcludedChains] = useState<string[]>([]);
  const [anchorText, setAnchorText] = useState('');
  const [anchor, setAnchor] = useState<Coords | null>(null);
  const [anchorState, setAnchorState] = useState<'idle' | 'looking' | 'failed'>('idle');

  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [concurrency, setConcurrency] = useState(2);
  const { tables, excludeForeign, setTable, setExcludeForeign } = useTablePrefs();
  const [showOptions, setShowOptions] = useState(false);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const seededRadius = useRef(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Map<string, ProgressUpdate>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScrapeResponse | null>(null);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    void fetchSources().then((list) => {
      setSources(list);
      setChosen(list.filter((s) => s.enabledByDefault).map((s) => s.id));
      setLiveAvailable(list.length > 0);
      setSourcesLoaded(true);
    });
    // The deployed site has no API at all; it reads the nightly scrape instead.
    void loadDataset().then((d) => {
      if (!d) return;
      setDataset(d);
      setZip(d.zip);
      setFrom(d.from);
      setTo(d.to < addDays(d.from, DEFAULT_WINDOW_DAYS - 1) ? d.to : addDays(d.from, DEFAULT_WINDOW_DAYS - 1));
    });
  }, []);

  // Without a live scrape the radius can only narrow what the nightly run
  // covered, so the dataset's own reach is the honest starting point.
  useEffect(() => {
    if (!sourcesLoaded || !dataset || liveAvailable || seededRadius.current) return;
    seededRadius.current = true;
    setRadius(dataset.radiusMiles);
  }, [sourcesLoaded, dataset, liveAvailable]);

  // Anchors are resolved in the browser: the deployed site has no server, and
  // the debounce keeps a typed address from firing a lookup per keystroke.
  useEffect(() => {
    const query = anchorText.trim();
    if (query === '') {
      setAnchor(null);
      setAnchorState('idle');
      return;
    }
    let live = true;
    setAnchorState('looking');
    const timer = setTimeout(() => {
      void geocodeAnchor(query).then((coords) => {
        if (!live) return;
        setAnchor(coords);
        setAnchorState(coords ? 'idle' : 'failed');
      });
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [anchorText]);

  const invalidRange = to < from;
  // The site may filter below the scraped radius, never above it: beyond that
  // line there is simply no data, and the wider number would promise coverage
  // the dataset does not have.
  const effectiveRadius = liveAvailable
    ? radius
    : Math.min(radius, dataset?.radiusMiles ?? radius);
  const noSources = sources.length > 0 && chosen.length === 0;

  const run = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (running || invalidRange || noSources) return;

      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      setRunning(true);
      // Seed a row per source up front so the block does not reflow as each
      // one reports in.
      setProgress(
        new Map(
          chosen.map((id) => [id, { sourceId: id, message: 'waiting', step: 0, total: 0 }]),
        ),
      );
      setError(null);
      setResult(null);
      setCopied(false);

      void scrape(
        {
          zip,
          from,
          to,
          radius,
          keepYears,
          sources: chosen,
          concurrency,
          tables,
          excludeForeign,
          excludeChains: excludedChains,
          anchor: anchorText.trim() === '' ? null : anchorText.trim(),
        },
        {
          onProgress: (update) => {
            setProgress((prev) => new Map(prev).set(update.sourceId, update));
          },
          onResult: (payload) => {
            setResult(payload);
          },
          onError: setError,
        },
        controller.signal,
      )
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (controller.signal.aborted) return;
          setRunning(false);
          // A stream that ends without delivering a result is a failure, not an
          // empty listing; saying "nothing playing" there would be a lie.
          setResult((current) => {
            if (current === null) {
              setError((e) => e ?? 'The scrape ended without returning results. Try again.');
            }
            return current;
          });
        });
    },
    [
      running,
      invalidRange,
      noSources,
      zip,
      from,
      to,
      radius,
      keepYears,
      chosen,
      concurrency,
      tables,
      excludeForeign,
      excludedChains,
      anchorText,
    ],
  );

  const fromDataset = useMemo(() => {
    if (!dataset) return null;
    try {
      return renderDataset(
        dataset,
        from,
        to,
        { radiusMiles: effectiveRadius, excludedChains: new Set(excludedChains), anchor },
        { keepYears, showAccessibility: false, showLanguage: false },
        {
          ...DEFAULT_SECTION_OPTIONS,
          tables,
          excludeForeign,
          currentYear: Number(from.slice(0, 4)),
        },
        ALIASES,
      );
    } catch {
      return null;
    }
  }, [
    dataset,
    from,
    to,
    effectiveRadius,
    keepYears,
    tables,
    excludeForeign,
    excludedChains,
    anchor,
  ]);

  /** The nightly dataset when there is one; otherwise whatever a live run returned. */
  const view = useMemo(() => {
    if (fromDataset) {
      return {
        rows: fromDataset.rows.map((r) => ({
          title: r.movie.title,
          url: r.url,
          links: r.links,
          notes: r.notes,
          theaterCount: r.movie.theaters.length,
          dateCount: r.movie.dates.length,
          section: r.section ?? 'main',
          sectionHeading: r.sectionHeading ?? null,
          theaters: r.movie.theaters.map((t) => ALIASES.theaterNames[t] ?? t),
          dates: [...r.movie.dates],
        })),
        markdown: fromDataset.markdown,
        theaters: fromDataset.theaters,
        warnings: dataset?.warnings ?? [],
      };
    }
    if (!result) return null;
    return {
      rows: result.rows,
      markdown: result.markdown,
      theaters: result.theaters,
      warnings: result.warnings,
    };
  }, [fromDataset, result, dataset]);

  const copy = useCallback(() => {
    if (!view) return;
    void navigator.clipboard.writeText(view.markdown).then(() => {
      setCopied(true);
      // Inline label change instead of a toast; it reverts on its own.
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    });
  }, [view]);

  const summary = useMemo(() => {
    if (!view) return '';
    // Rows can repeat across tables, so count distinct films rather than rows.
    const titles = new Set(view.rows.map((r) => r.title));
    const movies = `${String(titles.size)} movie${titles.size === 1 ? '' : 's'}`;
    const theaters = `${String(view.theaters.length)} theater${view.theaters.length === 1 ? '' : 's'}`;
    // No distance here: the drive-in and library tables are radius-exempt, so
    // the furthest venue would contradict the miles field beside it.
    return `${movies} · ${theaters}`;
  }, [view]);

  return (
    <main>
      <h1>filmscraper</h1>

      <form onSubmit={run}>
        {/* The nightly dataset covers one ZIP at one radius; without a live run
            neither field can do anything, so the deployed site omits both. */}
        {liveAvailable && (
          <label>
            ZIP
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{5}"
              value={zip}
              onChange={(e) => {
                setZip(e.target.value);
              }}
              required
            />
          </label>
        )}
        <label>
          From
          <input
            type="date"
            value={from}
            {...(dataset && !liveAvailable ? { min: dataset.from, max: dataset.to } : {})}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
            required
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            min={from}
            {...(dataset && !liveAvailable ? { max: dataset.to } : {})}
            onChange={(e) => {
              setTo(e.target.value);
            }}
            required
          />
        </label>
        <label>
          Miles
          <input
            type="number"
            min={1}
            max={liveAvailable ? 100 : (dataset?.radiusMiles ?? 100)}
            step={1}
            value={radius}
            onChange={(e) => {
              setRadius(Number(e.target.value));
            }}
            required
          />
        </label>
        {/* Distance is measured from here rather than from the ZIP centroid,
            which is what makes "within 15 miles of my house" answerable. */}
        <label className="anchor">
          Of
          <input
            type="text"
            placeholder={placeName(dataset?.zip ?? zip)}
            value={anchorText}
            onChange={(e) => {
              setAnchorText(e.target.value);
            }}
          />
        </label>
        {liveAvailable && (
          <button type="submit" disabled={running || invalidRange || noSources}>
            {running ? 'Scraping…' : 'Scrape'}
          </button>
        )}

        <button
          type="button"
          className="disclosure"
          aria-expanded={showOptions}
          onClick={() => {
            setShowOptions((v) => !v);
          }}
        >
          {showOptions ? 'hide options' : 'options'}
        </button>

        {showOptions && (
          <div className="options">
            {liveAvailable && (
            <div className="optgroup">
              <span className="optgroup__title">Sources</span>
              <div className="optgroup__items">
                {sources.map((source) => (
                  <label key={source.id}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(source.id)}
                      onChange={(e) => {
                        setChosen((prev) =>
                          e.target.checked
                            ? [...prev, source.id]
                            : prev.filter((id) => id !== source.id),
                        );
                      }}
                    />
                    {source.label}
                  </label>
                ))}
              </div>
            </div>
            )}

            <div className="optgroup">
              <span className="optgroup__title">Chains</span>
              <div className="optgroup__items">
                {chainIds().map((id) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={!excludedChains.includes(id)}
                      onChange={(e) => {
                        setExcludedChains((prev) =>
                          e.target.checked ? prev.filter((x) => x !== id) : [...prev, id],
                        );
                      }}
                    />
                    {chainLabel(id)}
                  </label>
                ))}
              </div>
            </div>

            {/* One checklist, built from the same registry the renderer reads,
                so a table added to the build cannot go missing here. Choices
                are remembered between visits. */}
            <div className="optgroup">
              <span className="optgroup__title">Tables</span>
              <div className="optgroup__items">
                {SECTIONS.map((section) => (
                  <label key={section.id} title={section.hint}>
                    <input
                      type="checkbox"
                      checked={tables.includes(section.id)}
                      onChange={(e) => {
                        setTable(section.id, e.target.checked);
                      }}
                    />
                    {section.label}
                  </label>
                ))}
                <label title="Leave non-English releases out of the output entirely">
                  <input
                    type="checkbox"
                    checked={excludeForeign}
                    onChange={(e) => {
                      setExcludeForeign(e.target.checked);
                    }}
                  />
                  drop non-English
                </label>
              </div>
            </div>

            {/* Both only bite on a live scrape: the published dataset is already
                title-normalized and fetched. */}
            {liveAvailable && (
            <div className="optgroup">
              <span className="optgroup__title">Other</span>
              <div className="optgroup__items">
                <label>
                  <input
                    type="checkbox"
                    checked={keepYears}
                    onChange={(e) => {
                      setKeepYears(e.target.checked);
                    }}
                  />
                  keep years
                </label>
                <label className="inline-number">
                  parallel
                  <input
                    type="number"
                    min={1}
                    max={8}
                    step={1}
                    value={concurrency}
                    onChange={(e) => {
                      setConcurrency(Number(e.target.value));
                    }}
                  />
                </label>
              </div>
            </div>
            )}
          </div>
        )}
      </form>

      {anchorState === 'looking' && <p className="status">Locating {anchorText.trim()}…</p>}
      {anchorState === 'failed' && (
        <p className="status error">
          Could not find “{anchorText.trim()}”. Distances are still measured from{' '}
          {placeName(dataset?.zip ?? zip)}.
        </p>
      )}
      {/* Venues scraped before coordinates were stored cannot be re-measured,
          so their mileage still refers to the ZIP. */}
      {anchor && (fromDataset?.unanchored.length ?? 0) > 0 && (
        <p className="status">
          Measured from the ZIP, not the anchor:{' '}
          {(fromDataset?.unanchored ?? []).join(', ')}.
        </p>
      )}

      {invalidRange && <p className="status error">“To” is before “from”.</p>}
      {noSources && <p className="status error">Pick at least one source.</p>}

      {liveAvailable && (running || progress.size > 0) && !error && (
        <div className="status">
          {[...progress.values()].map((row) => {
            const label = sources.find((s) => s.id === row.sourceId)?.label ?? row.sourceId;
            const inFlight = row.active ?? [];
            const fraction = row.done ? 1 : row.total > 0 ? row.step / row.total : 0;
            // A second, fainter segment covers what is loading right now, so a
            // parallel source visibly moves between completions.
            const pending =
              row.done || row.total === 0
                ? fraction
                : Math.min(1, (row.step + inFlight.length) / row.total);
            const detail = row.done
              ? ''
              : inFlight.length > 1
                ? `${String(inFlight.length)} loading · ${compactDates(inFlight)}`
                : row.message;
            return (
              <div className={`track${row.done ? ' track--done' : ''}`} key={row.sourceId}>
                <span className="track__label">{label}</span>
                <span className="track__count">
                  {row.done ? 'done' : row.total > 0 ? `${row.step}/${row.total}` : ''}
                </span>
                <span
                  className="bar"
                  style={
                    {
                      '--fill': `${String(fraction * 100)}%`,
                      '--pending': `${String(pending * 100)}%`,
                    } as React.CSSProperties
                  }
                />
                <span className="track__now">{detail}</span>
              </div>
            );
          })}
        </div>
      )}

      {error !== null && <p className="status error">{error}</p>}

      {/* Source freshness and scrape caveats are operator detail: useful while
          running the scraper locally, noise for a reader of the listings. */}
      {liveAvailable && dataset && Object.keys(dataset.sources).length > 0 && (
        <div className="status freshness">
          {Object.entries(dataset.sources)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, stamp]) => (
              <div className="track" key={id}>
                <span className="track__label">{SOURCE_LABELS[id] ?? id}</span>
                <span className="track__count">{sinceLabel(stamp.updatedAt)}</span>
                <span className="track__now">{describeSchedule(id)}</span>
              </div>
            ))}
        </div>
      )}

      {liveAvailable &&
        view?.warnings.map((warning) => (
          <p className="warning" key={warning.kind + warning.message}>
            {warning.message}
          </p>
        ))}

      {view?.rows.length === 0 && !running && (
        <p className="empty">
          Nothing playing in that window within {effectiveRadius} miles of{' '}
          {anchor ? anchorText.trim() : placeName(liveAvailable ? zip : (dataset?.zip ?? zip))}.
        </p>
      )}

      {!dataset && !liveAvailable && (
        <p className="empty">
          No listings published yet. The scrape runs daily at 1pm Central; this page
          fills in after the first run.
        </p>
      )}

      {view && view.rows.length > 0 && (
        <>
          <div className="summary">
            <span>{summary}</span>
            <span className="group">
              <button
                type="button"
                onClick={() => {
                  setShowMarkdown((v) => !v);
                }}
              >
                {showMarkdown ? 'hide markdown' : 'show markdown'}
              </button>
              <button type="button" onClick={copy}>
                {copied ? 'copied' : 'copy markdown'}
              </button>
            </span>
          </div>

          {showMarkdown ? (
            <pre>{view.markdown}</pre>
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="title">movie</th>
                  <th>notes</th>
                  <th className="reach">reach</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row, index) => (
                  <Fragment key={`${row.section}:${row.url}`}>
                    {row.sectionHeading !== null &&
                      row.sectionHeading !== view.rows[index - 1]?.sectionHeading && (
                        <tr className="section-row">
                          <th colSpan={3}>{row.sectionHeading}</th>
                        </tr>
                      )}
                  <tr>
                    <td className="title">
                      <a href={row.url} target="_blank" rel="noreferrer">
                        {row.title}
                      </a>
                      {row.links.length > 0 && (
                        <span className="title__links">
                          {row.links.map((link) => (
                            <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                              {link.label}
                            </a>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="notes">{row.notes}</td>
                    <td className="reach" tabIndex={0}>
                      {reach(row.theaterCount, row.dateCount)}
                      <span className="reach__detail" role="tooltip">
                        <span className="reach__heading">
                          {row.theaterCount === 1 ? 'Theater' : 'Theaters'}
                        </span>
                        <span className="reach__list">{row.theaters.join(', ')}</span>
                        <span className="reach__heading">
                          {row.dateCount === 1 ? 'Date' : 'Dates'}
                        </span>
                        <span className="reach__list">{compactDates(row.dates)}</span>
                      </span>
                    </td>
                  </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}
