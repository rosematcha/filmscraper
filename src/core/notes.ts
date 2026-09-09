import { classifyAmenity } from './amenities.js';
import { classifyRun, type RunHistory, type RunWindow } from './run.js';
import type { AggregatedMovie, IsoDate, RenderOptions, Showing } from './types.js';

/** At or below this many venues, a note names them instead of counting them. */
export const NAMED_THEATER_LIMIT = 3;

/** Rank lookup so notes lead with the rarest format. */
function formatRank(label: string): number {
  return classifyAmenity({ id: -1, name: label }).rank;
}

export function shortenTheater(name: string, overrides: Readonly<Record<string, string>>): string {
  const direct = overrides[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(overrides)) {
    if (key.toLowerCase() === lower) return value;
  }
  return name;
}

/** `["a"] -> "a"`, `["a","b"] -> "a and b"`, `["a","b","c"] -> "a, b and c"`. */
export function humanList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  const head = items.slice(0, -1).join(', ');
  return `${head} and ${items.at(-1) ?? ''}`;
}

/** Parsed at noon so a date never slips a day under local timezone rules. */
function atNoon(date: IsoDate): Date {
  return new Date(`${date}T12:00:00`);
}

export function weekdayName(date: IsoDate): string {
  return atNoon(date).toLocaleDateString('en-US', { weekday: 'long' });
}

export function monthDay(date: IsoDate): string {
  return atNoon(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

/** `"Friday, September 18"`, for a date the reader has no weekday context for. */
export function weekdayAndDate(date: IsoDate): string {
  return `${weekdayName(date)}, ${monthDay(date)}`;
}

/** Every date in `[from, to]` inclusive. */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = [];
  const cursor = atNoon(from);
  const end = atNoon(to);
  while (cursor.getTime() <= end.getTime()) {
    const iso = cursor.toISOString().slice(0, 10);
    dates.push(iso);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/** Weekdays read better inside a week; longer windows need the date. */
export function weekdayOrDate(date: IsoDate, windowDates: readonly IsoDate[]): string {
  return windowDates.length <= 7 ? weekdayName(date) : monthDay(date);
}

/** A run may skip at most this many posted days and still read as a run. */
const MAX_GAP_DAYS = 2;

/**
 * "except Thursday", for a run that skips a day or two of a posted week.
 *
 * Without this a film missing one Thursday was spelled out as six weekdays,
 * which reads as a scattered booking when it is a run with a gap.
 */
function exceptClause(
  playedDates: readonly IsoDate[],
  window: RunWindow,
  label: (d: IsoDate) => string,
): string | null {
  const { windowDates, knownFrom, horizon } = window;
  const frontier = window.frontier ?? horizon;
  const firstPlayed = playedDates[0] ?? '';
  const lastPlayed = playedDates.at(-1) ?? '';
  const span = windowDates.filter((d) => d >= firstPlayed && d <= lastPlayed);
  const missing = span.filter((d) => !playedDates.includes(d));
  if (missing.length === 0 || missing.length > MAX_GAP_DAYS) return null;
  if (playedDates.length < MAX_GAP_DAYS * 2 || lastPlayed < frontier) return null;
  const except = `except ${humanList(missing.map(label))}`;
  const startsAtWindow = firstPlayed === (windowDates.find((d) => d >= knownFrom) ?? '');
  return startsAtWindow ? except : `${label(firstPlayed)} through ${label(lastPlayed)} ${except}`;
}

/**
 * Phrase when a movie plays, from the shape of its run.
 *
 * The judgement itself lives in `classifyRun`, because the highlight tables ask
 * the same question and the two must not be able to disagree about whether a
 * film is closing.
 */
export function describeDates(
  playedDates: readonly IsoDate[],
  windowDates: readonly IsoDate[],
  knownFrom: IsoDate,
  horizon: IsoDate,
  frontier: IsoDate = horizon,
  history: RunHistory = {},
): string | null {
  const window: RunWindow = { windowDates, knownFrom, horizon, frontier };
  const { shape, date } = classifyRun(playedDates, window, history);
  const on = date ?? '';
  const day = (d: IsoDate): string => weekdayOrDate(d, windowDates);
  // A date outside the reliable range has no weekday context around it, so
  // it is spelled out in full.
  const inRange = (d: IsoDate): boolean => d >= knownFrom && d <= horizon;
  switch (shape) {
    case 'none':
    case 'throughout':
      return null;
    case 'single':
      return `${inRange(on) ? day(on) : monthDay(on)} only`;
    case 'presale-opens':
      return `opens ${monthDay(on)}`;
    case 'opens':
      return `opens ${day(on)}`;
    case 'span':
      return `${day(on)} through ${day(playedDates.at(-1) ?? on)}`;
    case 'closing':
      return `through ${day(on)}`;
    case 'listed': {
      const reliable = playedDates.some(inRange) && windowDates.some(inRange);
      const label = reliable ? day : monthDay;
      return (
        exceptClause(playedDates, window, label) ?? `${humanList(playedDates.map(label))} only`
      );
    }
  }
}

/**
 * How much of a booking a note will spell out with times.
 *
 * The budget is dates times venues, not each separately: one night at two
 * venues and two nights at one both read cleanly, while two nights at two
 * venues is four bracketed time lists and nobody reads that.
 */
const MAX_TIMED_SLOTS = 2;
const MAX_TIMED_DATES = 2;
const MAX_TIMES = 2;

interface VenueTimes {
  readonly theater: string;
  readonly times: readonly string[];
}

/** One entry per venue for a date, times pooled across format variants. */
function venuesOn(showings: readonly Showing[], date: IsoDate): VenueTimes[] {
  const byTheater = new Map<string, Set<string>>();
  for (const showing of showings) {
    if (showing.date !== date) continue;
    const times = byTheater.get(showing.theater) ?? new Set<string>();
    for (const time of showing.times) times.add(time);
    byTheater.set(showing.theater, times);
  }
  return [...byTheater].map(([theater, times]) => ({ theater, times: [...times] }));
}

/**
 * The booking spelled out with its times: "Saturday 7:00p at Park North and
 * Tuesday 9:30p at Stone Oak".
 *
 * Only for the handful of one-night and two-night bookings a reader would act
 * on; a wide release has dozens of times and the link answers that. Null when
 * the booking is too big to spell out or a calendar published no time.
 */
export function timedClause(
  movie: AggregatedMovie,
  windowDates: readonly IsoDate[],
  short: (name: string) => string,
): string | null {
  const dates = movie.dates.filter((d) => windowDates.includes(d));
  if (dates.length === 0 || dates.length > MAX_TIMED_DATES) return null;
  if (movie.theaters.length > NAMED_THEATER_LIMIT) return null;
  const byDate: { date: IsoDate; venues: VenueTimes[] }[] = [];
  let slots = 0;
  for (const date of dates) {
    const venues = venuesOn(movie.showings, date);
    if (venues.length === 0) return null;
    if (venues.some((v) => v.times.length === 0 || v.times.length > MAX_TIMES)) return null;
    slots += venues.length;
    if (slots > MAX_TIMED_SLOTS) return null;
    byDate.push({ date, venues });
  }

  // A two-night booking at one venue names it once at the end: "Saturday
  // 4:00p and Tuesday 10:10p at Park North", not the venue twice.
  const venue = byDate[0]?.venues[0];
  const oneVenue =
    venue !== undefined && byDate.every((d) => d.venues.length === 1 && d.venues[0]?.theater === venue.theater);
  const when = (date: IsoDate): string => weekdayOrDate(date, windowDates);
  if (oneVenue) {
    const nights = byDate.map(({ date, venues }) => `${when(date)} ${humanList(venues[0]?.times ?? [])}`);
    return `${humanList(nights)} at ${short(venue.theater)}`;
  }
  return byDate.map(({ date, venues }) => `${when(date)} ${dayClause(venues, short)}`).join(', ');
}

/** "7:00p at A and B", or "at A (7:00p) and B (9:15p)" when the venues differ. */
function dayClause(venues: readonly VenueTimes[], short: (name: string) => string): string {
  const timeSets = new Set(venues.map((v) => humanList(v.times)));
  if (timeSets.size === 1) {
    return `${[...timeSets][0] ?? ''} at ${humanList(venues.map((v) => short(v.theater)))}`;
  }
  return `at ${humanList(venues.map((v) => `${short(v.theater)} (${humanList(v.times)})`))}`;
}

/** True when a format or marker runs at every venue the film plays. */
function coversAll(venues: readonly string[], movie: AggregatedMovie): boolean {
  return venues.length === movie.theaters.length;
}

function formatClauses(movie: AggregatedMovie, short: (n: string) => string): string[] {
  const formats = [...movie.formats.entries()].sort(
    ([a], [b]) => formatRank(a) - formatRank(b) || a.localeCompare(b),
  );
  // When a format runs everywhere the movie does, naming venues just repeats
  // the scarcity clause below.
  return formats.map(([label, venues]) =>
    !coversAll(venues, movie) && venues.length <= NAMED_THEATER_LIMIT
      ? `${label} at ${humanList(venues.map(short))}`
      : label,
  );
}

function optionalClauses(
  movie: AggregatedMovie,
  options: RenderOptions,
  short: (n: string) => string,
): string[] {
  if (!options.showAccessibility && !options.showLanguage) return [];
  const clauses: string[] = [];
  for (const [label, venues] of movie.optional) {
    const cls = classifyAmenity({ id: -1, name: label }).cls;
    const wanted =
      (cls === 'access' && options.showAccessibility) ||
      (cls === 'language' && options.showLanguage);
    if (!wanted) continue;
    clauses.push(
      venues.length <= NAMED_THEATER_LIMIT ? `${label} at ${humanList(venues.map(short))}` : label,
    );
  }
  return clauses;
}

/**
 * "Q&A Thursday at Park North", "early access Wednesday": the event markers
 * that describe particular showings rather than the whole booking.
 */
function eventClauses(
  movie: AggregatedMovie,
  windowDates: readonly IsoDate[],
  short: (n: string) => string,
): string[] {
  const clauses: string[] = [];
  for (const [label, venues] of movie.events) {
    const dates = (movie.eventDates.get(label) ?? []).filter((d) => windowDates.includes(d));
    if (dates.length === 0) continue;
    const when = dates.length === 1 ? ` ${weekdayOrDate(dates[0] ?? '', windowDates)}` : '';
    const where =
      !coversAll(venues, movie) && venues.length <= NAMED_THEATER_LIMIT
        ? ` at ${humanList(venues.map(short))}`
        : '';
    clauses.push(`${label}${when}${where}`);
  }
  return clauses;
}

function admissionClause(movie: AggregatedMovie, short: (n: string) => string): string | null {
  // Free is the rarest thing a screening can be in a table of multiplexes, and
  // it is only ever claimed where a listing said so outright.
  if (movie.freeVenues.length === 0) return null;
  const everywhere = movie.freeVenues.length === movie.theaters.length;
  return !everywhere && movie.freeVenues.length <= NAMED_THEATER_LIMIT
    ? `free at ${humanList(movie.freeVenues.map(short))}`
    : 'free';
}

function languageClause(movie: AggregatedMovie): string | null {
  // Worth stating plainly: a Telugu release with English subtitles is a very
  // different night out from the multiplex default.
  if (!movie.foreign) return null;
  return movie.languages.length > 0 ? `in ${humanList([...movie.languages])}` : 'not in English';
}

/** What a note may know beyond the run itself. */
export interface NoteExtras {
  /** Earliest date the ledger ever listed the film for. */
  readonly firstDate?: IsoDate | null;
  /** Earliest date the ledger itself covers. */
  readonly watchedSince?: IsoDate | null;
}

/**
 * The scarcity clause: dates and venues folded together — "Saturday 7:00p at
 * Park North" rather than the venue repeated in two separate notes.
 */
function whenClause(
  movie: AggregatedMovie,
  windowDates: readonly IsoDate[],
  knownFrom: IsoDate,
  horizon: IsoDate,
  frontier: IsoDate,
  extras: NoteExtras,
  short: (n: string) => string,
): string | null {
  if (movie.isFixture) {
    return movie.theaters.length <= NAMED_THEATER_LIMIT
      ? `daily at ${humanList(movie.theaters.map(short))}`
      : 'daily';
  }
  const history = {
    firstDate: extras.firstDate ?? null,
    watchedSince: extras.watchedSince ?? null,
  };
  // Times are spelled out only for scattered bookings. A film that plays the
  // whole window has dozens of them, and the link answers that.
  const { shape } = classifyRun(
    movie.dates,
    { windowDates, knownFrom, horizon, frontier },
    history,
  );
  const timed =
    shape === 'single' || shape === 'listed' ? timedClause(movie, windowDates, short) : null;
  if (timed !== null) return timed;

  const limitedVenues = movie.theaters.length <= NAMED_THEATER_LIMIT;
  const venueList = humanList(movie.theaters.map(short));
  const dateClause = describeDates(movie.dates, windowDates, knownFrom, horizon, frontier, history);
  // Same evidence the opening table needs: a first date on the day the ledger
  // started watching says nothing about when the film actually opened.
  const newThisWeek =
    dateClause === null &&
    typeof extras.firstDate === 'string' &&
    typeof extras.watchedSince === 'string' &&
    extras.firstDate > extras.watchedSince &&
    extras.firstDate >= (windowDates[0] ?? '');

  if (dateClause && limitedVenues) return `${dateClause} at ${venueList}`;
  if (dateClause) return dateClause;
  if (newThisWeek) return limitedVenues ? `new this week at ${venueList}` : 'new this week';
  if (limitedVenues) return `only at ${venueList}`;
  return null;
}

/**
 * Build the Notes cell for one movie.
 *
 * Clause order is formats, opt-in flags, event markers, admission, language,
 * then the scarcity clause.
 */
export function buildNotes(
  movie: AggregatedMovie,
  windowDates: readonly IsoDate[],
  knownFrom: IsoDate,
  horizon: IsoDate,
  options: RenderOptions,
  theaterNames: Readonly<Record<string, string>>,
  frontier: IsoDate = horizon,
  extras: NoteExtras = {},
): string {
  const short = (n: string): string => shortenTheater(n, theaterNames);
  const clauses: (string | null)[] = [
    ...formatClauses(movie, short),
    ...optionalClauses(movie, options, short),
    ...eventClauses(movie, windowDates, short),
    admissionClause(movie, short),
    languageClause(movie),
    whenClause(movie, windowDates, knownFrom, horizon, frontier, extras, short),
  ];
  const joined = clauses.filter((c): c is string => c !== null && c !== '').join(', ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}
