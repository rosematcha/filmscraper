import type { Dataset } from './dataset.js';
import { humanList, monthDay } from './notes.js';

/**
 * Plain names for the source ids the dataset stamps.
 *
 * Kept here rather than read from the source registry because the registry
 * pulls in Playwright, which the site cannot ship.
 */
export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  fandango: 'Fandango',
  'slab-arthouse': 'Slab Arthouse',
  'slab-outdoor': 'Slab outdoor',
  'mission-marquee': 'Mission Marquee',
  'tobin-cinema': 'Tobin Center',
  mcnay: 'McNay',
  'ruby-city': 'Ruby City',
  'stars-and-stripes': 'drive-in',
  sapl: 'library',
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** "just now", "3 hours ago", "yesterday", "6 days ago". */
export function relativeAge(at: string, now: Date): string {
  const ms = now.getTime() - Date.parse(at);
  if (!Number.isFinite(ms) || ms < HOUR) return 'just now';
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    return `${String(hours)} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(ms / DAY);
  return days === 1 ? 'yesterday' : `${String(days)} days ago`;
}

/** A source counts as behind the run when its own stamp trails it by this much. */
const STALE_AFTER_MS = 36 * HOUR;

/**
 * One line saying how old the listings are, and which sources are older.
 *
 * Sources run on different cadences, so "updated tonight" would imply the
 * drive-in calendar is as fresh as the multiplex grid when it may be a month
 * older. The sources that lag are named with the day they were last read.
 */
export function freshnessLine(dataset: Dataset, now: Date): string {
  const run = Date.parse(dataset.generatedAt);
  const behind = new Map<string, string[]>();
  for (const [id, stamp] of Object.entries(dataset.sources)) {
    const at = Date.parse(stamp.updatedAt);
    if (!Number.isFinite(at) || run - at < STALE_AFTER_MS) continue;
    const day = stamp.updatedAt.slice(0, 10);
    const names = behind.get(day) ?? [];
    names.push(SOURCE_LABELS[id] ?? id);
    behind.set(day, names);
  }
  const head = `Updated ${relativeAge(dataset.generatedAt, now)}`;
  if (behind.size === 0) return `${head}.`;
  const tail = [...behind]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, names]) => `${humanList(names)} last read ${monthDay(day)}`)
    .join('; ');
  return `${head}; ${tail}.`;
}

/** The dataset's own account of sources that could not be read. */
export function sourceFailures(dataset: Dataset): string[] {
  return dataset.warnings
    .filter((warning) => warning.kind === 'page-error')
    .map((warning) => warning.message);
}
