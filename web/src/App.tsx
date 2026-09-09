import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ALIASES,
  loadDataset,
  loadLedger,
  renderDataset,
  type Dataset,
  type Ledger,
} from './dataset';
import { geocodeAnchor } from './geocode';
import { chainIds, chainLabel } from '@core/core/chains.js';
import { freshnessLine, sourceFailures } from '@core/core/freshness.js';
import type { Coords } from '@core/core/geo.js';
import { shortenTheater } from '@core/core/notes.js';
import type { SortOrder } from '@core/core/types.js';
import { DEFAULT_SECTION_OPTIONS } from '@core/core/sections.js';
import {
  COMING_ID,
  MAIN_ID,
  SECTIONS,
  SORT_ORDERS,
  VIEW_MODES,
  useTablePrefs,
  type ViewFlags,
  type ViewMode,
} from './tables';
import { Menu, Section, Stepper, Word } from './controls';
import { DayView, FilmTable, VenueView, type Row } from './views';
import Subscribe from './Subscribe';

/**
 * The weekly email is offered on the dev server and nowhere else.
 *
 * Turnstile and the mailer are not configured on the deployed site, so the
 * signup endpoint answers every visitor with "not available right now" — an
 * invitation the site cannot honour. Vite folds this to `false` when it builds,
 * which drops the form from the production bundle rather than merely hiding it.
 * Delete the guard once the keys are set.
 */
const SIGNUP_ENABLED = import.meta.env.DEV;

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
 * Distance the page opens at.
 *
 * The published run covers thirty-five miles so the drive-in and Boerne are
 * there when asked for, but "what is playing" means the city, and a default
 * that reaches Castroville answers a question nobody asked.
 */
const DEFAULT_RADIUS_MILES = 15;

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
  reach: ['Each table’s own order', 'Screenings by date, wide releases by reach'],
  title: ['By title', 'Alphabetical, for looking one film up'],
  soonest: ['Soonest first', 'Earliest date first, everywhere'],
};

/** How the page is grouped, and what each grouping answers. */
const VIEW_LABELS: Record<ViewMode, [string, string]> = {
  film: ['By film', 'One row per film, grouped into tables'],
  day: ['By day', 'Every date, with what plays that day and when'],
  venue: ['By venue', 'Every theater in range, nearest first'],
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
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function App(): React.JSX.Element {
  const start = today();
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(addDays(start, DEFAULT_WINDOW_DAYS - 1));
  const [radius, setRadius] = useState(DEFAULT_RADIUS_MILES);
  const [excludedChains, setExcludedChains] = useState<string[]>([]);
  const [anchorText, setAnchorText] = useState('');
  const [anchor, setAnchor] = useState<Coords | null>(null);
  const [anchorState, setAnchorState] = useState<'idle' | 'looking' | 'failed'>('idle');

  const { tables, flags, sort, view, setTable, setFlag, setSort, setView, isOpen, setOpen } =
    useTablePrefs();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [datasetState, setDatasetState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  // The site has no API: it reads whatever the scheduled scrape published and
  // filters that in the browser. The ledger is optional — the tables render
  // without it, they just judge openings less sharply.
  useEffect(() => {
    void Promise.all([loadDataset(), loadLedger()]).then(([d, l]) => {
      if (!d) {
        setDatasetState('failed');
        return;
      }
      setDataset(d);
      setLedger(l);
      setDatasetState('ready');
      const first = start < d.from ? d.from : start > d.to ? d.to : start;
      setFrom(first);
      setTo(
        d.to < addDays(first, DEFAULT_WINDOW_DAYS - 1)
          ? d.to
          : addDays(first, DEFAULT_WINDOW_DAYS - 1),
      );
    });
  }, [start]);

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

  const rendered = useMemo(() => {
    if (!dataset) return null;
    try {
      return renderDataset(
        dataset,
        ledger,
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
  }, [dataset, ledger, from, to, effectiveRadius, tables, flags, sort, excludedChains, anchor]);

  const short = useCallback((name: string) => shortenTheater(name, ALIASES.theaterNames), []);

  const rows: Row[] = useMemo(
    () =>
      (rendered?.rows ?? []).map((r) => ({
        movie: r.movie,
        title: r.movie.title,
        url: r.url,
        links: r.links,
        notes: r.notes,
        section: r.section ?? MAIN_ID,
        sectionHeading: r.sectionHeading ?? null,
        theaters: r.movie.theaters.map(short),
      })),
    [rendered, short],
  );

  const copy = useCallback(() => {
    if (!rendered) return;
    setCopyState('idle');
    void navigator.clipboard
      .writeText(rendered.markdown)
      .then(() => {
        setCopyState('copied');
        setTimeout(() => {
          setCopyState('idle');
        }, 2000);
      })
      .catch(() => {
        setCopyState('failed');
      });
  }, [rendered]);

  /**
   * The tables in render order, each with its own heading and count.
   *
   * The renderer hands back one flat list tagged by section; the main table is
   * one of them rather than a special case, because the wide releases are what
   * folds away now and the screenings are what leads.
   */
  const sections = useMemo(() => {
    const order: string[] = [];
    const bySection = new Map<string, { heading: string; rows: Row[] }>();
    for (const row of rows) {
      let entry = bySection.get(row.section);
      if (!entry) {
        entry = {
          heading:
            row.sectionHeading ?? (row.section === MAIN_ID ? 'Everything else' : row.section),
          rows: [],
        };
        bySection.set(row.section, entry);
        order.push(row.section);
      }
      entry.rows.push(row);
    }
    // The main table renders last: it is the long tail of wide releases, and
    // what changed this week is the reason to open the page.
    const ids = [...order.filter((id) => id !== MAIN_ID), ...order.filter((id) => id === MAIN_ID)];
    return ids.map((id) => {
      const entry = bySection.get(id);
      return { id, heading: entry?.heading ?? id, rows: entry?.rows ?? [] };
    });
  }, [rows]);

  /**
   * The rows in reading order, tables first and the wide releases last.
   *
   * The day and venue views group these again by date or theater, and they
   * want the same order: a one-night booking is the reason to look at a day,
   * and the twelfth multiplex listing is not.
   */
  const orderedRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  /** How many view flags are on, so the shut menu says whether it holds any. */
  const activeFlags = VIEW_FLAGS.filter(([key]) => flags[key]).length;

  const toggleSection = useCallback(
    (id: string) => {
      setOpen(id, !isOpen(id));
    },
    [isOpen, setOpen],
  );

  const summary = useMemo(() => {
    if (!rendered) return '';
    // Rows can repeat across tables, so count distinct films rather than rows.
    // Next week's listings are left out: the theater count beside this one is
    // the window's, and the two must describe the same thing.
    const films = new Set(rows.filter((r) => r.section !== COMING_ID).map((r) => r.movie.key));
    const movies = `${String(films.size)} movie${films.size === 1 ? '' : 's'}`;
    const count = rendered.theaters.length;
    // No distance here: the drive-in and library tables are radius-exempt, so
    // the furthest venue would contradict the miles field beside it.
    return `${movies} · ${count} theater${count === 1 ? '' : 's'}`;
  }, [rendered, rows]);

  const freshness = useMemo(() => (dataset ? freshnessLine(dataset, new Date()) : ''), [dataset]);
  const failures = useMemo(() => (dataset ? sourceFailures(dataset) : []), [dataset]);

  return (
    <main>
      <h1 className="sr-only">Film listings</h1>
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
          <Stepper value={radius} min={1} max={dataset?.radiusMiles ?? 100} onChange={setRadius} />
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

        <Menu label="view" count={VIEW_LABELS[view][0].toLowerCase().replace('by ', '')}>
          {VIEW_MODES.map((mode) => (
            <Word
              key={mode}
              on={view === mode}
              label={VIEW_LABELS[mode][0]}
              hint={VIEW_LABELS[mode][1]}
              onToggle={() => {
                setView(mode);
              }}
            />
          ))}
        </Menu>

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

        <Menu label="other" count={activeFlags > 0 ? String(activeFlags) : undefined} align="right">
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
      {anchor && (rendered?.unanchored.length ?? 0) > 0 && (
        <p className="status">
          Measured from the ZIP, not the anchor: {(rendered?.unanchored ?? []).join(', ')}.
        </p>
      )}

      {invalidRange && <p className="status error">“To” is before “from”.</p>}

      {rows.length === 0 && dataset && !invalidRange && rendered && (
        <p className="empty">
          Nothing playing in that window within {effectiveRadius} miles of{' '}
          {anchor ? anchorText.trim() : placeName(dataset.zip)}.
        </p>
      )}

      {datasetState === 'loading' && <p className="empty">Loading listings…</p>}

      {datasetState === 'failed' && (
        <p className="empty">Listings could not be loaded. Reload the page to try again.</p>
      )}

      {dataset && !invalidRange && !rendered && (
        <p className="empty error">The published listings could not be read.</p>
      )}

      {rendered && rows.length > 0 && (
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
                {copyState === 'copied'
                  ? 'copied'
                  : copyState === 'failed'
                    ? 'copy failed'
                    : 'copy markdown'}
              </button>
            </span>
          </div>

          {/* Open on the page rather than behind a disclosure: how old the
              listings are, and what is not on sale yet, both change what a
              reader does with the table. */}
          <aside className="warning">
            <p className="warning__age">{freshness}</p>
            {failures.map((failure) => (
              <p key={failure}>{failure}</p>
            ))}
            {rendered.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </aside>

          {showMarkdown ? (
            <pre>{rendered.markdown}</pre>
          ) : view === 'day' ? (
            <DayView
              rows={orderedRows}
              dates={rendered.dates}
              short={short}
              isOpen={isOpen}
              toggle={toggleSection}
            />
          ) : view === 'venue' ? (
            <VenueView
              rows={orderedRows}
              theaters={rendered.theaters}
              dates={rendered.dates}
              isOpen={isOpen}
              toggle={toggleSection}
            />
          ) : (
            /* Every table folds to a header carrying its own count, the wide
               releases included: what changed this week is the product. */
            <div className="sections">
              {sections.map((section) => (
                <Section
                  key={section.id}
                  heading={section.heading}
                  count={section.rows.length}
                  open={isOpen(section.id)}
                  onToggle={() => {
                    toggleSection(section.id);
                  }}
                >
                  <FilmTable rows={section.rows} hideHead />
                </Section>
              ))}
            </div>
          )}
        </>
      )}

      {SIGNUP_ENABLED && showSignup && <Subscribe defaultTables={tables} />}

      <footer>
        Maintained by <a href="https://rosematcha.com">Reese Lundquist.</a>
        {SIGNUP_ENABLED && !showSignup && (
          <>
            {' '}
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
