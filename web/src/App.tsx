import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ALIASES, loadDataset, renderDataset, type Dataset } from './dataset';
import { geocodeAnchor } from './geocode';
import { chainIds, chainLabel } from '@core/core/chains.js';
import type { Coords } from '@core/core/geo.js';
import type { SortOrder } from '@core/core/types.js';
import { DEFAULT_SECTION_OPTIONS } from '@core/core/sections.js';
import { SECTIONS, SORT_ORDERS, useTablePrefs, type ViewFlags } from './tables';
import Subscribe from './Subscribe';
import { Menu, Section, Stepper, Word } from './controls';

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

/**
 * The settings that change how a row reads, in menu order.
 *
 * Each one is off by default because each adds words to the Notes cell, and a
 * blank Notes cell is a correct and common answer.
 */
const VIEW_FLAGS: readonly [keyof ViewFlags, string, string][] = [
  ['hideWide', 'Hide wide releases', 'Drops anything at four or more theaters'],
  ['hideSingle', 'Hide single-theater films', 'Drops one-off bookings'],
  ['showAccessibility', 'Show open captions', 'Names the captioned bookings'],
  ['showLanguage', 'Show subtitles and dubs', 'Names subtitled and dubbed showings'],
  ['keepYears', 'Keep years in titles', 'Leaves “(2026)” where the listing had it'],
  ['excludeForeign', 'Drop non-English entirely', 'Removes them rather than tabling them'],
];

/** What each sort order is for, shown beside its word. */
const SORT_LABELS: Record<SortOrder, [string, string]> = {
  reach: ['Widest first', 'Wide releases, then limited runs, then one-nighters'],
  title: ['By title', 'Alphabetical, for looking one film up'],
  soonest: ['Soonest first', 'Earliest date first, for tonight'],
};

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

interface Row {
  readonly title: string;
  readonly url: string;
  readonly links: readonly { readonly url: string; readonly label: string }[];
  readonly notes: string;
  readonly theaterCount: number;
  readonly dateCount: number;
  readonly section: string;
  readonly sectionHeading: string | null;
  readonly theaters: readonly string[];
  readonly dates: readonly string[];
}

/** One listing, rendered the same whichever table it lands in. */
function movieRow(row: Row): React.JSX.Element {
  return (
    <tr key={`${row.section}:${row.url}`}>
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
          <span className="reach__heading">{row.dateCount === 1 ? 'Date' : 'Dates'}</span>
          <span className="reach__list">{compactDates(row.dates)}</span>
        </span>
      </td>
    </tr>
  );
}

export default function App(): React.JSX.Element {
  const start = today();
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(addDays(start, DEFAULT_WINDOW_DAYS - 1));
  const [radius, setRadius] = useState(15);
  const [excludedChains, setExcludedChains] = useState<string[]>([]);
  const [anchorText, setAnchorText] = useState('');
  const [anchor, setAnchor] = useState<Coords | null>(null);
  const [anchorState, setAnchorState] = useState<'idle' | 'looking' | 'failed'>('idle');

  const { tables, flags, sort, setTable, setFlag, setSort } = useTablePrefs();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const seededRadius = useRef(false);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(new Set());
  const [showSignup, setShowSignup] = useState(false);

  // The site has no API: it reads whatever the scheduled scrape published and
  // filters that in the browser.
  useEffect(() => {
    void loadDataset().then((d) => {
      if (!d) return;
      setDataset(d);
      setFrom(d.from);
      setTo(d.to < addDays(d.from, DEFAULT_WINDOW_DAYS - 1) ? d.to : addDays(d.from, DEFAULT_WINDOW_DAYS - 1));
    });
  }, []);

  // The radius can only narrow what the published run covered, so the
  // dataset's own reach is the honest starting point.
  useEffect(() => {
    if (!dataset || seededRadius.current) return;
    seededRadius.current = true;
    setRadius(dataset.radiusMiles);
  }, [dataset]);

  // Anchors are resolved in the browser, and the debounce keeps a typed
  // address from firing a lookup per keystroke.
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
  // Filtering below the published radius is fine; above it there is simply no
  // data, and the wider number would promise coverage the dataset lacks.
  const effectiveRadius = Math.min(radius, dataset?.radiusMiles ?? radius);

  const view = useMemo(() => {
    if (!dataset) return null;
    try {
      return renderDataset(
        dataset,
        from,
        to,
        { radiusMiles: effectiveRadius, excludedChains: new Set(excludedChains), anchor },
        {
          keepYears: flags.keepYears,
          showAccessibility: flags.showAccessibility,
          showLanguage: flags.showLanguage,
          sort,
        },
        {
          ...DEFAULT_SECTION_OPTIONS,
          tables,
          excludeForeign: flags.excludeForeign,
          hideWide: flags.hideWide,
          hideSingle: flags.hideSingle,
          currentYear: Number(from.slice(0, 4)),
        },
        ALIASES,
      );
    } catch {
      return null;
    }
  }, [dataset, from, to, effectiveRadius, tables, flags, sort, excludedChains, anchor]);

  const rows = useMemo(
    () =>
      (view?.rows ?? []).map((r) => ({
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
    [view],
  );

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


  /**
   * The main table and the broken-out tables, kept apart.
   *
   * The renderer hands back one flat list tagged by section; this splits it
   * so each extra table can fold behind its own header while the main one
   * stays open.
   */
  const grouped = useMemo(() => {
    const main = rows.filter((row) => row.section === 'main');
    const order: string[] = [];
    const bySection = new Map<string, { heading: string; rows: typeof main }>();
    for (const row of rows) {
      if (row.section === 'main') continue;
      let entry = bySection.get(row.section);
      if (!entry) {
        entry = { heading: row.sectionHeading ?? row.section, rows: [] };
        bySection.set(row.section, entry);
        order.push(row.section);
      }
      entry.rows.push(row);
    }
    return {
      main,
      sections: order.map((id) => {
        const entry = bySection.get(id);
        return { id, heading: entry?.heading ?? id, rows: entry?.rows ?? [] };
      }),
    };
  }, [rows]);

  /** How many view flags are on, so the shut menu says whether it holds any. */
  const activeFlags = VIEW_FLAGS.filter(([key]) => flags[key]).length;

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const summary = useMemo(() => {
    if (!view) return '';
    // Rows can repeat across tables, so count distinct films rather than rows.
    const titles = new Set(rows.map((r) => r.title));
    const movies = `${String(titles.size)} movie${titles.size === 1 ? '' : 's'}`;
    const theaters = `${String(view.theaters.length)} theater${view.theaters.length === 1 ? '' : 's'}`;
    // No distance here: the drive-in and library tables are radius-exempt, so
    // the furthest venue would contradict the miles field beside it.
    return `${movies} · ${theaters}`;
  }, [view, rows]);

  return (
    <main>
      {/* The published dataset covers one ZIP at one radius, so the window,
          distance and anchor are the only things worth adjusting. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label>
          From
          <input
            type="date"
            value={from}
            {...(dataset ? { min: dataset.from, max: dataset.to } : {})}
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
            {...(dataset ? { max: dataset.to } : {})}
            onChange={(e) => {
              setTo(e.target.value);
            }}
            required
          />
        </label>
        <label>
          Miles
          <Stepper
            value={radius}
            min={1}
            max={dataset?.radiusMiles ?? 100}
            onChange={setRadius}
          />
        </label>
        {/* Distance is measured from here rather than from the ZIP centroid,
            which is what makes "within 15 miles of my house" answerable. */}
        <label className="anchor">
          Of
          <input
            type="text"
            placeholder={placeName(dataset?.zip ?? HOME_ZIP)}
            value={anchorText}
            onChange={(e) => {
              setAnchorText(e.target.value);
            }}
          />
        </label>

        {/* Each group is its own menu, anchored to its button, so opening one
            never moves the table underneath. */}
        <Menu
          label="chains"
          count={`${String(chainIds().length - excludedChains.length)}/${String(chainIds().length)}`}
          onAll={() => {
            setExcludedChains([]);
          }}
          onNone={() => {
            setExcludedChains(chainIds());
          }}
        >
          {chainIds().map((id) => (
            <Word
              key={id}
              on={!excludedChains.includes(id)}
              label={chainLabel(id)}
              onToggle={() => {
                setExcludedChains((prev) =>
                  prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                );
              }}
            />
          ))}
        </Menu>

        {/* Built from the same registry the renderer reads, so a table added
            to the build cannot go missing here. Choices are remembered. */}
        <Menu
          label="tables"
          count={`${String(tables.length)}/${String(SECTIONS.length)}`}
          onAll={() => {
            for (const section of SECTIONS) setTable(section.id, true);
          }}
          onNone={() => {
            for (const section of SECTIONS) setTable(section.id, false);
          }}
        >
          {SECTIONS.map((section) => (
            <Word
              key={section.id}
              on={tables.includes(section.id)}
              label={section.label}
              hint={section.hint}
              onToggle={() => {
                setTable(section.id, !tables.includes(section.id));
              }}
            />
          ))}
        </Menu>

        <Menu label="sort" count={SORT_LABELS[sort][0].toLowerCase()} align="right">
          {SORT_ORDERS.map((order) => (
            <Word
              key={order}
              on={sort === order}
              label={SORT_LABELS[order][0]}
              hint={SORT_LABELS[order][1]}
              onToggle={() => {
                setSort(order);
              }}
            />
          ))}
        </Menu>

        <Menu
          label="other"
          count={activeFlags > 0 ? String(activeFlags) : undefined}
          align="right"
        >
          {VIEW_FLAGS.map(([key, label, hint]) => (
            <Word
              key={key}
              on={flags[key]}
              label={label}
              hint={hint}
              onToggle={() => {
                setFlag(key, !flags[key]);
              }}
            />
          ))}
        </Menu>
      </form>

      {anchorState === 'looking' && <p className="status">Locating {anchorText.trim()}…</p>}
      {anchorState === 'failed' && (
        <p className="status error">
          Could not find “{anchorText.trim()}”. Distances are still measured from{' '}
          {placeName(dataset?.zip ?? HOME_ZIP)}.
        </p>
      )}
      {/* Venues scraped before coordinates were stored cannot be re-measured,
          so their mileage still refers to the ZIP. */}
      {anchor && (view?.unanchored.length ?? 0) > 0 && (
        <p className="status">
          Measured from the ZIP, not the anchor: {(view?.unanchored ?? []).join(', ')}.
        </p>
      )}

      {invalidRange && <p className="status error">“To” is before “from”.</p>}


      {rows.length === 0 && dataset && (
        <p className="empty">
          Nothing playing in that window within {effectiveRadius} miles of{' '}
          {anchor ? anchorText.trim() : placeName(dataset.zip)}.
        </p>
      )}

      {!dataset && (
        <p className="empty">
          No listings published yet. The scrape runs daily at 1pm Central; this page
          fills in after the first run.
        </p>
      )}

      {view && rows.length > 0 && (
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
            <>
              <table>
                <thead>
                  <tr>
                    <th className="title">movie</th>
                    <th>notes</th>
                    <th className="reach">reach</th>
                  </tr>
                </thead>
                <tbody>{grouped.main.map(movieRow)}</tbody>
              </table>

              {/* Everything else folds to a header carrying its own count:
                  this week is the product, the rest is one click away. */}
              {grouped.sections.length > 0 && (
                <div className="sections">
                  {grouped.sections.map((section) => (
                    <Section
                      key={section.id}
                      heading={section.heading}
                      count={section.rows.length}
                      open={openSections.has(section.id)}
                      onToggle={() => {
                        toggleSection(section.id);
                      }}
                    >
                      <table>
                        <tbody>{section.rows.map(movieRow)}</tbody>
                      </table>
                    </Section>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {showSignup && <Subscribe defaultTables={tables} />}

      <footer>
        Maintained by <a href="https://rosematcha.com">Reese Lundquist.</a>{' '}
        {!showSignup && (
          <>
            ·{' '}
            <button
              type="button"
              onClick={() => {
                setShowSignup(true);
              }}
            >
              get this weekly by email
            </button>
          </>
        )}
      </footer>
    </main>
  );
}
