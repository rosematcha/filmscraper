import type { AggregatedMovie, IsoDate, Theater } from '@core/core/types.js';
import { weekdayAndDate } from '@core/core/notes.js';
import { dayDetail, venueDetail } from '@core/core/views.js';
import { Section } from './controls';

/** One listing as the page renders it, whichever table or view it lands in. */
export interface Row {
  readonly movie: AggregatedMovie;
  readonly title: string;
  readonly url: string;
  readonly links: readonly { readonly url: string; readonly label: string }[];
  readonly notes: string;
  readonly section: string;
  readonly sectionHeading: string | null;
  /** Short venue names, for the reach panel. */
  readonly theaters: readonly string[];
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

function TitleCell({ row }: { readonly row: Row }): React.JSX.Element {
  return (
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
  );
}

/** One listing, rendered the same whichever table it lands in. */
function movieRow(row: Row): React.JSX.Element {
  const theaterCount = row.movie.theaters.length;
  const dateCount = row.movie.dates.length;
  return (
    <tr key={`${row.section}:${row.url}`}>
      <TitleCell row={row} />
      <td className="notes">{row.notes}</td>
      <td className="reach" tabIndex={0}>
        {reach(theaterCount, dateCount)}
        <span className="reach__detail" role="tooltip">
          <span className="reach__heading">{theaterCount === 1 ? 'Theater' : 'Theaters'}</span>
          <span className="reach__list">{row.theaters.join(', ')}</span>
          <span className="reach__heading">{dateCount === 1 ? 'Date' : 'Dates'}</span>
          <span className="reach__list">{compactDates(row.movie.dates)}</span>
        </span>
      </td>
    </tr>
  );
}

function Head({ hidden }: { readonly hidden: boolean }): React.JSX.Element {
  return (
    <thead className={hidden ? 'sr-only' : undefined}>
      <tr>
        <th className="title">movie</th>
        <th>notes</th>
        <th className="reach">reach</th>
      </tr>
    </thead>
  );
}

/** The film table: one row per film, notes describing its run. */
export function FilmTable({
  rows,
  hideHead = false,
}: {
  readonly rows: readonly Row[];
  readonly hideHead?: boolean;
}): React.JSX.Element {
  return (
    <table>
      <Head hidden={hideHead} />
      <tbody>{rows.map(movieRow)}</tbody>
    </table>
  );
}

/** A two-column table for the day and venue views: film, then where or when. */
function DetailTable({
  rows,
  detail,
}: {
  readonly rows: readonly Row[];
  readonly detail: (row: Row) => string;
}): React.JSX.Element {
  return (
    <table>
      <thead className="sr-only">
        <tr>
          <th>movie</th>
          <th>showings</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.url}>
            <TitleCell row={row} />
            <td className="notes detail">{detail(row)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The film rows once each, in table order.
 *
 * Duplicating tables (free, open captions) list a film the main table also
 * carries; a day or venue answers for the film once.
 */
function distinct(rows: readonly Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const row of rows) {
    if (row.section === 'coming' || seen.has(row.movie.key)) continue;
    seen.add(row.movie.key);
    out.push(row);
  }
  return out;
}

interface FoldProps {
  readonly isOpen: (id: string) => boolean;
  readonly toggle: (id: string) => void;
}

/** Every date in the window, each with what plays that day and when. */
export function DayView({
  rows,
  dates,
  short,
  isOpen,
  toggle,
}: {
  readonly rows: readonly Row[];
  readonly dates: readonly IsoDate[];
  readonly short: (name: string) => string;
} & FoldProps): React.JSX.Element {
  const films = distinct(rows);
  return (
    <div className="sections">
      {dates.map((date) => {
        const today = films.filter((row) => row.movie.dates.includes(date));
        if (today.length === 0) return null;
        const id = `day:${date}`;
        return (
          <Section
            key={date}
            heading={weekdayAndDate(date)}
            count={today.length}
            open={isOpen(id)}
            onToggle={() => {
              toggle(id);
            }}
          >
            <DetailTable rows={today} detail={(row) => dayDetail(row.movie, date, short)} />
          </Section>
        );
      })}
    </div>
  );
}

/** Every venue in range, nearest first, each with what it is showing. */
export function VenueView({
  rows,
  theaters,
  dates,
  isOpen,
  toggle,
}: {
  readonly rows: readonly Row[];
  readonly theaters: readonly Theater[];
  readonly dates: readonly IsoDate[];
} & FoldProps): React.JSX.Element {
  const films = distinct(rows);
  return (
    <div className="sections">
      {theaters.map((theater) => {
        const here = films.filter((row) => row.movie.theaters.includes(theater.name));
        if (here.length === 0) return null;
        const id = `venue:${theater.name}`;
        return (
          <Section
            key={theater.name}
            heading={`${theater.name} · ${theater.miles.toFixed(theater.miles < 10 ? 1 : 0)} mi`}
            count={here.length}
            open={isOpen(id)}
            onToggle={() => {
              toggle(id);
            }}
          >
            <DetailTable
              rows={here}
              detail={(row) => venueDetail(row.movie, theater.name, dates)}
            />
          </Section>
        );
      })}
    </div>
  );
}
