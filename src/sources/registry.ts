import type { BrowserSession } from '../net/browser.js';
import { DriveInSource, STARS_AND_STRIPES } from './driveIn/index.js';
import { FandangoSource } from './fandango/index.js';
import { SaplSource } from './sapl/index.js';
import { MISSION_MARQUEE, MissionMarqueeSource } from './missionMarquee/index.js';
import { SLAB_ARTHOUSE, SLAB_OUTDOOR, SlabSource } from './slab/index.js';
import { TOBIN_CINEMA, TobinCinemaSource } from './tobinCenter/index.js';
import type { Source } from './source.js';

export interface SourceInfo {
  readonly id: string;
  readonly label: string;
  /** Whether a headless browser is required; only Fandango needs one. */
  readonly needsBrowser: boolean;
  readonly enabledByDefault: boolean;
}

export const SOURCES: readonly SourceInfo[] = [
  { id: 'fandango', label: 'Fandango', needsBrowser: true, enabledByDefault: true },
  { id: SLAB_ARTHOUSE.id, label: SLAB_ARTHOUSE.label, needsBrowser: false, enabledByDefault: true },
  { id: SLAB_OUTDOOR.id, label: SLAB_OUTDOOR.label, needsBrowser: false, enabledByDefault: true },
  { id: MISSION_MARQUEE.id, label: MISSION_MARQUEE.label, needsBrowser: false, enabledByDefault: true },
  { id: TOBIN_CINEMA.id, label: TOBIN_CINEMA.label, needsBrowser: false, enabledByDefault: true },
  {
    id: STARS_AND_STRIPES.id,
    label: STARS_AND_STRIPES.name,
    needsBrowser: false,
    enabledByDefault: true,
  },
  { id: 'sapl', label: 'San Antonio Public Library', needsBrowser: false, enabledByDefault: true },
];

export const DEFAULT_SOURCE_IDS: readonly string[] = SOURCES.filter(
  (s) => s.enabledByDefault,
).map((s) => s.id);

/**
 * Build the requested sources.
 *
 * Only Fandango needs the browser session; the rest read JSON or iCal feeds
 * directly, which is why they cost seconds rather than minutes.
 */
export function buildSources(
  ids: readonly string[],
  session: BrowserSession,
  concurrency = 1,
): Source[] {
  const wanted = new Set(ids);
  const sources: Source[] = [];
  if (wanted.has('fandango')) sources.push(new FandangoSource(session, concurrency));
  if (wanted.has(SLAB_ARTHOUSE.id)) sources.push(new SlabSource(SLAB_ARTHOUSE));
  if (wanted.has(SLAB_OUTDOOR.id)) sources.push(new SlabSource(SLAB_OUTDOOR));
  if (wanted.has(MISSION_MARQUEE.id)) sources.push(new MissionMarqueeSource());
  if (wanted.has(TOBIN_CINEMA.id)) sources.push(new TobinCinemaSource());
  if (wanted.has(STARS_AND_STRIPES.id)) sources.push(new DriveInSource(STARS_AND_STRIPES));
  if (wanted.has('sapl')) sources.push(new SaplSource());
  return sources;
}

/** Whether any requested source needs Playwright at all. */
export function needsBrowser(ids: readonly string[]): boolean {
  return SOURCES.some((s) => s.needsBrowser && ids.includes(s.id));
}
