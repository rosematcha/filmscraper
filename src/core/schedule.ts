/**
 * When each source is worth re-scraping.
 *
 * Sources move at very different speeds. Fandango republishes showtimes
 * constantly and sells out screenings during the day; an arthouse calendar
 * changes about once a week. Scraping them all on the same cadence either
 * hammers the calendars for nothing or lets the multiplex data go stale.
 *
 * All times are UTC, matching GitHub's cron. 18:00 UTC is 1pm in San Antonio
 * during CDT and noon once CST begins.
 */

export interface ScheduleRule {
  /** UTC days of the week, 0 = Sunday. Empty means every day. */
  readonly days: readonly number[];
  /** UTC hours of the day. */
  readonly hours: readonly number[];
}

export const EVERY_DAY: readonly number[] = [];

/** The hours a scheduled run can start; the workflow's cron must match. */
export const RUN_HOURS: readonly number[] = [0, 6, 12, 18];

export const SUNDAY = 0;
export const MONDAY = 1;
export const THURSDAY = 4;

export const SCHEDULES: Readonly<Record<string, readonly ScheduleRule[]>> = {
  // Four times a day on Monday and Thursday, when the new week's grids and the
  // weekend's go up; once a day otherwise.
  fandango: [
    { days: EVERY_DAY, hours: [18] },
    { days: [MONDAY, THURSDAY], hours: [0, 6, 12] },
  ],
  // Wix calendars are published in batches and rarely change mid-week.
  'slab-arthouse': [{ days: [SUNDAY], hours: [18] }],
  'slab-outdoor': [{ days: [SUNDAY], hours: [18] }],
  // Same outdoor season as Slab's Wix calendar; the venue page carries richer copy.
  'mission-marquee': [{ days: [SUNDAY], hours: [18] }],
  // Monthly cinema lineup; the season page changes rarely once published.
  'tobin-cinema': [{ days: [SUNDAY], hours: [18] }],
  // The museum screens a film every month or two; a weekly look is generous.
  mcnay: [{ days: [SUNDAY], hours: [18] }],
  // Twice a week: the drive-in posts its week, the library its programme.
  'stars-and-stripes': [{ days: [SUNDAY, THURSDAY], hours: [18] }],
  sapl: [{ days: [SUNDAY, THURSDAY], hours: [18] }],
};

function matches(rule: ScheduleRule, day: number, hour: number): boolean {
  const dayOk = rule.days.length === 0 || rule.days.includes(day);
  return dayOk && rule.hours.includes(hour);
}

/**
 * Source ids due at this instant.
 *
 * The hour must land exactly on a scheduled slot, so a run started a few
 * minutes late by GitHub's queue still resolves to the same set.
 */
export function dueSources(at: Date): string[] {
  const day = at.getUTCDay();
  const hour = at.getUTCHours();
  return Object.entries(SCHEDULES)
    .filter(([, rules]) => rules.some((rule) => matches(rule, day, hour)))
    .map(([id]) => id)
    .sort();
}

/** Every source, for a manual run. */
export function allSources(): string[] {
  return Object.keys(SCHEDULES).sort();
}

/** A human summary of one source's cadence, for the site's freshness note. */
export function describeSchedule(sourceId: string): string {
  const rules = SCHEDULES[sourceId];
  if (!rules || rules.length === 0) return 'on demand';
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const parts = rules.map((rule) => {
    const when = rule.days.length === 0 ? 'daily' : rule.days.map((d) => names[d] ?? '').join(' and ');
    const times = rule.hours.length === 1 ? 'once' : `${String(rule.hours.length)}×`;
    return `${times} ${when}`;
  });
  return parts.join(', plus ');
}
