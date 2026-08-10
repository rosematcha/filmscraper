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
 * - `presale-opens`  — on sale before the schedule is posted; no reliable dates yet.
 * - `closing`        — runs from the start of the window and stops before the horizon.
 * - `single`         — one date only.
 * - `listed`         — scattered dates that need enumerating.
 * - `none`           — nothing to say.
 */
export type RunShape =
  | 'throughout'
  | 'opens'
  | 'presale-opens'
  | 'closing'
  | 'single'
  | 'listed'
  | 'none';

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
}

/** A window with no dates in it: run shape is unanswerable, and says so. */
export const EMPTY_RUN_WINDOW: RunWindow = { windowDates: [], knownFrom: '', horizon: '' };

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
): RunClassification {
  const { windowDates, knownFrom, horizon } = window;
  if (playedDates.length === 0 || windowDates.length === 0) return { shape: 'none', date: null };

  const known = windowDates.filter((d) => d >= knownFrom && d <= horizon);
  const playedKnown = playedDates.filter((d) => d >= knownFrom && d <= horizon);
  const first = playedDates[0] ?? '';

  // Nothing inside the reliable range: a pre-sold future event, or a title
  // whose only showings today have already started.
  if (playedKnown.length === 0 || known.length === 0) {
    if (playedDates.length === 1) return { shape: 'single', date: first };
    // A wide release that goes on sale before the schedule is posted covers
    // every remaining day of the window. Enumerating those days reads as a
    // limited engagement when it is the opposite.
    if (opensAndRuns(playedDates, windowDates)) return { shape: 'presale-opens', date: first };
    return { shape: 'listed', date: first };
  }

  const windowStart = known[0] ?? '';
  const lastKnown = known.at(-1) ?? '';
  const firstKnown = playedKnown[0] ?? '';
  const lastPlayedKnown = playedKnown.at(-1) ?? '';

  // Runs unbroken from its first date to the edge of what we know.
  if (coversSpan(playedKnown, known, firstKnown, lastKnown)) {
    if (firstKnown === windowStart) return { shape: 'throughout', date: firstKnown };
    // One listed date that happens to be the last we know about is not evidence
    // of an opening — Willy Wonka's single Wednesday is a one-night event.
    if (playedDates.length === 1) return { shape: 'single', date: first };
    return { shape: 'opens', date: firstKnown };
  }

  // Runs unbroken from the start of the window but stops before the horizon:
  // genuinely ending its engagement, not merely unposted. Only worth phrasing
  // as a run once it spans a few days — a two-night booking reads better
  // enumerated ("Monday and Tuesday only") than as "through Tuesday".
  if (
    playedDates.length >= MIN_DATES_FOR_RUN &&
    firstKnown === windowStart &&
    lastPlayedKnown < lastKnown &&
    coversSpan(playedKnown, known, windowStart, lastPlayedKnown)
  ) {
    return { shape: 'closing', date: lastPlayedKnown };
  }

  if (playedDates.length === 1) return { shape: 'single', date: first };
  return { shape: 'listed', date: first };
}
