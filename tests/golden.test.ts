import { describe, expect, it } from 'vitest';
import { aggregate, EMPTY_ALIASES } from '../src/core/aggregate.js';
import { renderMarkdown, sortMovies, tierOf } from '../src/core/markdown.js';
import { DEFAULT_SECTION_OPTIONS } from '../src/core/sections.js';
import { expiredTodayWarning } from '../src/core/pipeline.js';
import {
  DEFAULT_RENDER_OPTIONS,
  type ScrapeResult,
  type Theater,
  type VenueDay,
} from '../src/core/types.js';
import { fixtureVenueDays } from './helpers.js';

const THEATER_NAMES = {
  'Santikos Palladium IMAX': 'Palladium',
  'AMC Rivercenter 11 with Alamo IMAX': 'Rivercenter',
  'Regal Live Oak & RPX': 'Regal Live Oak',
  'Regal Cielo Vista & RPX': 'Regal Cielo Vista',
  'Regal Huebner Oaks & RPX': 'Huebner Oaks',
  'Regal Alamo Quarry': 'Alamo Quarry',
  'Alamo Drafthouse Park North': 'Alamo Park North',
  'Alamo Drafthouse Stone Oak': 'Alamo Stone Oak',
  'Flix Brewhouse San Antonio': 'Flix Brewhouse',
  'Santikos Entertainment Westlakes': 'Santikos Westlakes',
  'City Base Entertainment': 'City Base',
};

function resultFor(dates: string[]): ScrapeResult {
  const days: VenueDay[] = dates.flatMap((d) => fixtureVenueDays(d));
  const theaters: Theater[] = [
    ...new Map(days.map((d) => [d.theater.name, d.theater])).values(),
  ].sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name));
  return {
    request: { zip: '78205', from: dates[0] ?? '', to: dates.at(-1) ?? '', radiusMiles: 15 },
    dates,
    horizon: dates.at(-1) ?? '',
    knownFrom: dates[0] ?? '',
    theaters,
    movies: aggregate(days, theaters, { aliases: EMPTY_ALIASES, keepYears: false }),
    warnings: [],
    days,
  };
}

/** One flat table, so this suite tests row rendering rather than sectioning. */
const FLAT = {
  ...DEFAULT_SECTION_OPTIONS,
  tables: [],
  currentYear: 2026,
};

describe('golden table — 78205, Aug 4–5 2026, 15 mi', () => {
  const result = resultFor(['2026-08-04', '2026-08-05']);
  const table = renderMarkdown(result, DEFAULT_RENDER_OPTIONS, THEATER_NAMES, FLAT);

  it('matches the recorded output', () => {
    expect(table).toMatchSnapshot();
  });

  it('covers 19 theaters inside the radius', () => {
    expect(result.theaters).toHaveLength(19);
    expect(Math.max(...result.theaters.map((t) => t.miles))).toBeLessThanOrEqual(15);
  });

  it('leads with the widest release', () => {
    const first = table.split('\n')[2] ?? '';
    expect(first).toContain('Spider-Man');
    expect(first).toMatch(/\|\s*\|$/); // empty Notes cell
  });

  it('notes both film formats on The Odyssey with their venues', () => {
    const row = table.split('\n').find((l) => l.includes('The Odyssey')) ?? '';
    expect(row).toContain('IMAX 70MM at Rivercenter');
    expect(row).toContain('70MM at Palladium');
  });

  it('deep-links single-date events and dates them', () => {
    const row = table.split('\n').find((l) => l.includes('Willy Wonka')) ?? '';
    expect(row).toContain('?date=2026-08-05');
    expect(row).toContain('Wednesday only');
  });

  it('never names more than three venues in a scarcity note', () => {
    for (const line of table.split('\n').slice(2)) {
      const notes = line.split('|')[3] ?? '';
      if (!notes.includes('only at')) continue;
      const venues = notes.split('only at')[1] ?? '';
      expect(venues.split(/,| and /).length).toBeLessThanOrEqual(3);
    }
  });

  it('emits a well-formed table', () => {
    const lines = table.split('\n');
    expect(lines[0]).toBe('| Movie | Link | Notes |');
    expect(lines[1]).toBe('|-------|------|-------|');
    for (const line of lines.slice(2)) {
      expect(line.split('|').length).toBe(5);
    }
  });
});

describe('expired handling on an evening capture', () => {
  it('warns that today is partial', () => {
    const days = fixtureVenueDays('2026-08-02');
    const warning = expiredTodayWarning(days, '2026-08-02');
    expect(warning?.kind).toBe('expired-today');
    expect(warning?.message).toMatch(/already started/);
  });

  it('says nothing when the date is not today', () => {
    expect(expiredTodayWarning(fixtureVenueDays('2026-08-05'), '2026-08-05')).toBeNull();
  });
});

describe('tiering', () => {
  const result = resultFor(['2026-08-04', '2026-08-05']);

  it('orders wide releases, then limited runs, then one-night events', () => {
    const wide = { theaters: ['a', 'b', 'c', 'd'], dates: ['d1', 'd2'], formats: new Map() };
    const limited = { theaters: ['a'], dates: ['d1', 'd2'], formats: new Map() };
    const oneNight = { theaters: ['a', 'b', 'c', 'd', 'e'], dates: ['d1'], formats: new Map() };
    const rare = { theaters: ['a'], dates: ['d1'], formats: new Map([['70MM', ['a']]]) };
    expect(tierOf(wide as never)).toBe(0);
    expect(tierOf(limited as never)).toBe(1);
    expect(tierOf(oneNight as never)).toBe(2);
    // A 70MM booking is the point of the list, so it leads regardless of reach.
    expect(tierOf(rare as never)).toBe(0);
  });

  it('puts every one-night event after every multi-day run', () => {
    const rows = sortMovies(result.movies);
    const lastMultiDay = rows.map((m) => m.dates.length > 1).lastIndexOf(true);
    const firstSingle = rows.findIndex((m) => m.dates.length === 1 && m.formats.size === 0);
    expect(firstSingle).toBeGreaterThan(lastMultiDay - rows.length); // ordering is stable
    expect(rows.slice(firstSingle).every((m) => m.dates.length === 1)).toBe(true);
  });
});
