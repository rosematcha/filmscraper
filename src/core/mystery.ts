import type { IsoDate } from './types.js';

/**
 * Merge key shared by every chain's unannounced-title screening.
 *
 * Chains run these as a promotional block: the same unreleased film opens on
 * the same night at Cinemark, Regal, AMC, Santikos and Flix under five
 * different marketing names. They are one event, so they get one key.
 */
export const MYSTERY_KEY = 'mysterymovie';

/**
 * Titles that name the *format* rather than the film.
 *
 * Matched on the distinctive phrase each chain uses, not on "mystery" alone,
 * so an actual film with mystery in its title keeps its own row. AMC restamps
 * its listing every week ("AMC Screen Unseen: August 10"), which is why this
 * is a pattern and not a list of Fandango ids.
 */
const MYSTERY_TITLE =
  /\b(secret movie series|mystery movie|screen unseen|secret flix|secret screening|mystery screening)\b/i;

export function isMysteryTitle(title: string): boolean {
  return MYSTERY_TITLE.test(title);
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function weekdayOf(date: IsoDate): string | null {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : (WEEKDAYS[parsed.getUTCDay()] ?? null);
}

/**
 * What the merged entry is called.
 *
 * The chains all brand it by the night it runs, and that night is the only
 * fact about the film anyone has — so it leads. A window that catches two
 * different weekdays drops the day rather than picking one.
 */
export function mysteryTitle(dates: readonly IsoDate[]): string {
  const days = new Set(dates.map(weekdayOf));
  const [only] = [...days];
  return days.size === 1 && typeof only === 'string' ? `${only} Mystery Movie` : 'Mystery Movie';
}
