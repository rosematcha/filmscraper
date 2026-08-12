/**
 * When each source is worth re-scraping.
 *
 * Sources move at very different speeds. Fandango republishes showtimes
 * constantly and sells out screenings during the day; an arthouse calendar
 * changes about once a week. Scraping them all on the same cadence either
 * hammers the calendars for nothing or lets the multiplex data go stale.
 *
 * All times are UTC, matching GitHub's cron. San Antonio is UTC-5 on CDT, so
 * 17:00 UTC is local noon for the months this schedule was tuned for; 18:00
 * UTC is the long-standing evening slot every calendar source shares.
 */

export interface ScheduleRule {
  /** UTC days of the week, 0 = Sunday. */
  readonly days: readonly number[];
  /** UTC hours of the day. */
  readonly hours: readonly number[];
}

export const SUNDAY = 0;
export const MONDAY = 1;
export const TUESDAY = 2;
export const WEDNESDAY = 3;
export const THURSDAY = 4;

/** Inclusive run of hours, so the windows below read as the clock does. */
function hours(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export const SCHEDULES: Readonly<Record<string, readonly ScheduleRule[]>> = {
  // Once each on Monday and Thursday, when the new week's grids and the
  // weekend's go up, plus an hourly watch from Tuesday noon to Wednesday noon
  // local — the stretch where showtimes churn and screenings sell out. The
  // overnight hours are skipped: nothing moves between 10pm and 4am.
  //
  //   Tue 17:00–23:00 UTC = Tue noon–6pm CDT
  //   Wed 00:00–02:00 UTC = Tue 7pm–9pm CDT
  //   (Tue 10pm – Wed 4am CDT is dark)
  //   Wed 09:00–17:00 UTC = Wed 4am–noon CDT
  fandango: [
    { days: [MONDAY, THURSDAY], hours: [18] },
    { days: [TUESDAY], hours: hours(17, 23) },
    { days: [WEDNESDAY], hours: [...hours(0, 2), ...hours(9, 17)] },
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
  // Two screenings in the museum's history, so weekly is already optimistic.
  'ruby-city': [{ days: [SUNDAY], hours: [18] }],
  // Twice a week: the drive-in posts its week, the library its programme.
  'stars-and-stripes': [{ days: [SUNDAY, THURSDAY], hours: [18] }],
  sapl: [{ days: [SUNDAY, THURSDAY], hours: [18] }],
};

function matches(rule: ScheduleRule, day: number, hour: number): boolean {
  return rule.days.includes(day) && rule.hours.includes(hour);
}

/**
 * Every UTC slot some source is due, as `day:hour`.
 *
 * The workflow's cron has to cover exactly this set: a slot missing from cron
 * never runs, and a cron slot missing here wakes a runner that exits doing
 * nothing. The parity test compares the two.
 */
export function runSlots(): Set<string> {
  const slots = new Set<string>();
  for (const rules of Object.values(SCHEDULES)) {
    for (const rule of rules) {
      for (const day of rule.days) {
        for (const hour of rule.hours) slots.add(`${String(day)}:${String(hour)}`);
      }
    }
  }
  return slots;
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
    const when = rule.days.map((d) => names[d] ?? '').join(' and ');
    const times = rule.hours.length === 1 ? 'once' : `${String(rule.hours.length)}×`;
    return `${times} ${when}`;
  });
  return parts.join(', plus ');
}
