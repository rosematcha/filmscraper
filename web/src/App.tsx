import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchSources,
  scrape,
  type ProgressUpdate,
  type ScrapeResponse,
  type SourceInfo,
} from './api';

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
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [showLanguage, setShowLanguage] = useState(false);

  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [concurrency, setConcurrency] = useState(3);
  const [separateDriveIn, setSeparateDriveIn] = useState(true);
  const [separateLibrary, setSeparateLibrary] = useState(true);
  const [separateEvents, setSeparateEvents] = useState(false);
  const [foreign, setForeign] = useState<'inline' | 'separate' | 'exclude'>('inline');
  const [showOptions, setShowOptions] = useState(false);
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
    });
  }, []);

  const invalidRange = to < from;
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
          showAccessibility,
          showLanguage,
          sources: chosen,
          concurrency,
          separateDriveIn,
          separateLibrary,
          separateEvents,
          foreign,
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
      showAccessibility,
      showLanguage,
      chosen,
      concurrency,
      separateDriveIn,
      separateLibrary,
      separateEvents,
      foreign,
    ],
  );

  const copy = useCallback(() => {
    if (!result) return;
    void navigator.clipboard.writeText(result.markdown).then(() => {
      setCopied(true);
      // Inline label change instead of a toast; it reverts on its own.
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    });
  }, [result]);

  const summary = useMemo(() => {
    if (!result) return '';
    const movies = `${String(result.rows.length)} movie${result.rows.length === 1 ? '' : 's'}`;
    const theaters = `${String(result.theaters.length)} theater${result.theaters.length === 1 ? '' : 's'}`;
    const furthest = result.theaters.at(-1)?.miles;
    return `${movies} · ${theaters}${furthest === undefined ? '' : ` within ${furthest.toFixed(1)} mi`}`;
  }, [result]);

  return (
    <main>
      <h1>filmscraper</h1>

      <form onSubmit={run}>
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
        <label>
          From
          <input
            type="date"
            value={from}
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
            max={100}
            step={1}
            value={radius}
            onChange={(e) => {
              setRadius(Number(e.target.value));
            }}
            required
          />
        </label>
        <button type="submit" disabled={running || invalidRange || noSources}>
          {running ? 'Scraping…' : 'Scrape'}
        </button>

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
          <>
            <div className="toggles sources">
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

            <div className="toggles">
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
          <label>
            <input
              type="checkbox"
              checked={showAccessibility}
              onChange={(e) => {
                setShowAccessibility(e.target.checked);
              }}
            />
            captions
          </label>
          <label>
            <input
              type="checkbox"
              checked={showLanguage}
              onChange={(e) => {
                setShowLanguage(e.target.checked);
              }}
            />
                language
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={separateDriveIn}
                  onChange={(e) => {
                    setSeparateDriveIn(e.target.checked);
                  }}
                />
                drive-in table
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={separateLibrary}
                  onChange={(e) => {
                    setSeparateLibrary(e.target.checked);
                  }}
                />
                library table
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={separateEvents}
                  onChange={(e) => {
                    setSeparateEvents(e.target.checked);
                  }}
                />
                events table
              </label>
              <label className="inline-number">
                not in English
                <select
                  value={foreign}
                  onChange={(e) => {
                    setForeign(e.target.value as 'inline' | 'separate' | 'exclude');
                  }}
                >
                  <option value="inline">inline</option>
                  <option value="separate">own table</option>
                  <option value="exclude">exclude</option>
                </select>
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
          </>
        )}
      </form>

      {invalidRange && <p className="status error">“To” is before “from”.</p>}
      {noSources && <p className="status error">Pick at least one source.</p>}

      {(running || progress.size > 0) && !error && (
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

      {result?.warnings.map((warning) => (
        <p className="warning" key={warning.kind + warning.message}>
          {warning.message}
        </p>
      ))}

      {result?.rows.length === 0 && !running && (
        <p className="empty">
          Nothing playing in that window within {radius} miles of {zip}.
        </p>
      )}

      {result && result.rows.length > 0 && (
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
            <pre>{result.markdown}</pre>
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
                {result.rows.map((row, index) => (
                  <Fragment key={`${row.section}:${row.url}`}>
                    {row.sectionHeading !== null &&
                      row.sectionHeading !== result.rows[index - 1]?.sectionHeading && (
                        <tr className="section-row">
                          <th colSpan={3}>{row.sectionHeading}</th>
                        </tr>
                      )}
                  <tr>
                    <td className="title">
                      <a href={row.url} target="_blank" rel="noreferrer">
                        {row.title}
                      </a>
                    </td>
                    <td className="notes">{row.notes}</td>
                    <td className="reach">{reach(row.theaterCount, row.dateCount)}</td>
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
