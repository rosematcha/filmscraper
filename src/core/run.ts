import type { IsoDate } from './types.js';

/**
 * The shape of a film's run inside the window we actually have data for.
 *
 * Both the Notes cell and the highlight tables need the same judgement — "is
 * this closing or opening?" — and deriving it twice invited the two to
 * disagree. Everything past `horizon` is unknown rather than absent, because
 * Fandango posts weekly and a Friday it has not published yet is not a gap.
 *
 * - `throughout`     — plays every day we know about.
 * - `opens`          — starts partway through and runs to the edge of what we know.
 * - `span`           — the same shape, for a film history says was already
 *                      running: a mid-week gap, not an opening.
 * - `presale-opens`  — on sale before the schedule is posted; no reliable dates yet.
 * - `closing`        — runs from the start of the window and stops before the horizon.
 * - `single`         — one date only.
 * - `listed`         — scattered dates that need enumerating.
 * - `none`           — nothing to say.
 */
export type RunShape =
  'throughout' | 'opens' | 'span' | 'presale-opens' | 'closing' | 'single' | 'listed' | 'none';

/** Below this many dates, listing the days beats describing a run. */
export const MIN_DATES_FOR_RUN = 3;

/** True when `dates` includes every entry of `range` between `from` and `to` inclusive. */
export function coversSpan(
  dates: readonly IsoDate[],
  range: readonly IsoDate[],
  from: IsoDate,
  to: IsoDate,
): boolean {
  return range.filter((d) => d >= from && d <= to).every((d) => dates.includes(d));
}

/**
 * True when the film plays an unbroken stretch from its first date to the end
 * of the window. Held to a few days so a two-night pre-sale still reads as the
 * pair of dates it is.
 */
function opensAndRuns(playedDates: readonly IsoDate[], windowDates: readonly IsoDate[]): boolean {
  const first = playedDates[0] ?? '';
  const end = windowDates.at(-1) ?? '';
  return (
    playedDates.length >= MIN_DATES_FOR_RUN &&
    playedDates.includes(end) &&
    coversSpan(playedDates, windowDates, first, end)
  );
}

/** The dates that fall inside the reliable part of the window. */
export interface RunWindow {
  readonly windowDates: readonly IsoDate[];
  readonly knownFrom: IsoDate;
  readonly horizon: IsoDate;
  /**
   * Last date the broad schedule demonstrably reaches — the day up to which
   * most titles still have posted showtimes. The horizon says where *every*
   * listing is reliable; the frontier says how far a film's absence is
   * meaningful. A film with no dates after Tuesday has ended only if plenty
   * of other films play Wednesday through the frontier.
   *
   * Optional so a caller without peer data can omit it; the horizon then
   * stands in, which never claims more than the old behaviour did.
   */
  readonly frontier?: IsoDate;
}

/** A window with no dates in it: run shape is unanswerable, and says so. */
export const EMPTY_RUN_WINDOW: RunWindow = { windowDates: [], knownFrom: '', horizon: '' };

/** Share of the busiest day's titles a date must keep to count as posted. */
const FRONTIER_SHARE = 0.5;

/**
 * How far the posted schedule demonstrably reaches, judged across every title.
 *
 * Fandango publishes a week at a time, so title counts hold steady through the
 * posted week and fall off a cliff at the unposted Friday — only pre-sold
 * events survive past it. The frontier is the last date before that cliff:
 * absence up to it is evidence of an ended run, absence past it is just an
 * unposted schedule.
 */
export function detectFrontier(
  titleDates: readonly (readonly IsoDate[])[],
  windowDates: readonly IsoDate[],
  knownFrom: IsoDate,
  horizon: IsoDate,
): IsoDate {
  const counts = new Map<IsoDate, number>();
  for (const dates of titleDates) {
    for (const date of dates) counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const judged = windowDates.filter((d) => d >= knownFrom);
  const peak = Math.max(0, ...judged.map((d) => counts.get(d) ?? 0));
  // No titles to judge by: the horizon is all there is.
  if (peak === 0) return horizon;

  const floor = peak * FRONTIER_SHARE;
  let frontier = horizon;
  for (const date of judged) {
    if ((counts.get(date) ?? 0) < floor) break;
    if (date > frontier) frontier = date;
  }
  return frontier;
}

/**
 * What the ledger remembers about a film, when it remembers anything.
 *
 * One scrape cannot tell a Thursday opening from a film that played last
 * week and skips Wednesday; the first date it was ever listed for can.
 */
export interface RunHistory {
  /** Earliest date the film was ever listed for, across every run. */
  readonly firstDate?: IsoDate | null;
}

export interface RunClassification {
  readonly shape: RunShape;
  /** The date the phrasing hangs on: the opening day, or the last day of a closing run. */
  readonly date: IsoDate | null;
}

/**
 * Classify when a film plays, given how far the posted schedule actually runs.
 *
 * The naive version — "any date in the window it does not play is a gap" —
 * labelled most of the week's releases "Sunday through Thursday only", because
 * Fandango simply has not posted Friday yet.
 */
export function classifyRun(
  playedDates: readonly IsoDate[],
  window: RunWindow,
  history: RunHistory = {},
): RunClassification {
  const { windowDates, knownFrom, horizon } = window;
  if (playedDates.length === 0 || windowDates.length === 0) return { shape: 'none', date: null };
  // Listed before this window began: whatever the dates look like, the film
  // is not opening. Absent history the shape alone has to decide.
  const seenBefore =
    typeof history.firstDate === 'string' && history.firstDate < (windowDates[0] ?? '');

  const frontier = window.frontier ?? horizon;
  const known = windowDates.filter((d) => d >= knownFrom && d <= horizon);
  const playedKnown = playedDates.filter((d) => d >= knownFrom && d <= horizon);
  const firstPlayed = playedDates[0] ?? '';
  const lastPlayed = playedDates.at(-1) ?? '';

  // Nothing inside the reliable range: a pre-sold future event, or a title
  // whose only showings today have already started.
  if (playedKnown.length === 0 || known.length === 0) {
    if (playedDates.length === 1) return { shape: 'single', date: firstPlayed };
    // A wide release that goes on sale before the schedule is posted covers
    // every remaining day of the window. Enumerating those days reads as a
    // limited engagement when it is the opposite.
    if (opensAndRuns(playedDates, windowDates)) {
      return { shape: seenBefore ? 'span' : 'presale-opens', date: firstPlayed };
    }
    return { shape: 'listed', date: firstPlayed };
  }

  const windowStart = known[0] ?? '';
  const lastKnown = known.at(-1) ?? '';
  const firstKnown = playedKnown[0] ?? '';

  // Closing means three things at once: the film was already running when the
  // window began, it has no date anywhere after its last one — a pre-sale past
  // the horizon is proof of continuation, not nothing — and its absence
  // afterwards is meaningful, because the rest of the schedule reaches past it.
  // A film whose listings stop where everyone's listings stop has not ended;
  // a film missing from days that two dozen other films play has.
  //
  // A short run still counts when it fills the whole known range: a film
  // playing both days of a two-day known window and nothing after is ending,
  // and the date floor exists only to keep two-night bookings inside a fully
  // posted week from phrasing as runs — those never cover the known range.
  const longEnough =
    playedDates.length >= MIN_DATES_FOR_RUN ||
    (playedDates.length >= 2 && coversSpan(playedKnown, known, windowStart, lastKnown));
  if (
    firstKnown === windowStart &&
    longEnough &&
    lastPlayed < frontier &&
    coversSpan(playedDates, windowDates, windowStart, lastPlayed)
  ) {
    return { shape: 'closing', date: lastPlayed };
  }

  // Runs unbroken from its first date to the edge of what we know.
  if (coversSpan(playedKnown, known, firstKnown, lastKnown)) {
    if (firstKnown === windowStart) return { shape: 'throughout', date: firstKnown };
    // One listed date that happens to be the last we know about is not evidence
    // of an opening — Willy Wonka's single Wednesday is a one-night event.
    if (playedDates.length === 1) return { shape: 'single', date: firstPlayed };
    return { shape: seenBefore ? 'span' : 'opens', date: firstKnown };
  }

  // A couple of scattered early dates and then an unbroken run to the
  // frontier is the preview pattern: the film opens the day the run proper
  // starts, and the Tuesday preview must not read as a dying engagement.
  // History overrules it: a film that played last week and skips Thursday
  // has the same dates and is not opening on Friday.
  if (!seenBefore && playedDates.length >= MIN_DATES_FOR_RUN && lastPlayed >= frontier) {
    for (let start = 1; start <= 2 && start < playedDates.length; start += 1) {
      const tail = playedDates.slice(start);
      const tailStart = tail[0] ?? '';
      if (
        tail.length >= MIN_DATES_FOR_RUN &&
        coversSpan(tail, windowDates, tailStart, lastPlayed)
      ) {
        return { shape: 'opens', date: tailStart };
      }
    }
  }

  if (playedDates.length === 1) return { shape: 'single', date: firstPlayed };
  return { shape: 'listed', date: firstPlayed };
}
