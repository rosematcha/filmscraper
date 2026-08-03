import { useCallback, useMemo, useRef, useState } from 'react';
import { scrape, type ScrapeResponse } from './api';

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
  const [to, setTo] = useState(addDays(start, 1));
  const [radius, setRadius] = useState(15);
  const [keepYears, setKeepYears] = useState(false);
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [showLanguage, setShowLanguage] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScrapeResponse | null>(null);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const invalidRange = to < from;

  const run = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (running || invalidRange) return;

      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      setRunning(true);
      setProgress([]);
      setError(null);
      setResult(null);
      setCopied(false);

      void scrape(
        { zip, from, to, radius, keepYears, showAccessibility, showLanguage },
        {
          onProgress: (message) => {
            setProgress((prev) => [...prev, message]);
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
          if (!controller.signal.aborted) setRunning(false);
        });
    },
    [running, invalidRange, zip, from, to, radius, keepYears, showAccessibility, showLanguage],
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
        <button type="submit" disabled={running || invalidRange}>
          {running ? 'Scraping…' : 'Scrape'}
        </button>

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
        </div>
      </form>

      {invalidRange && <p className="status error">“To” is before “from”.</p>}

      {(running || progress.length > 0) && !error && (
        <p className="status">{progress.join('\n') || 'Starting…'}</p>
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
                {result.rows.map((row) => (
                  <tr key={row.url}>
                    <td className="title">
                      <a href={row.url} target="_blank" rel="noreferrer">
                        {row.title}
                      </a>
                    </td>
                    <td className="notes">{row.notes}</td>
                    <td className="reach">{reach(row.theaterCount, row.dateCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}
