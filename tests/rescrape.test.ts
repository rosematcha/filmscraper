import { describe, expect, it } from 'vitest';
import type { MovieListing, VenueDay } from '../src/core/types.js';
import { fandangoTheaters, planFandangoRescrape } from '../src/sources/fandango/rescrape.js';

const DATES = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'];
const TODAY = '2026-08-10';
const HORIZON = '2026-08-14';

const movies = (count: number): MovieListing[] =>
  Array.from({ length: count }, (_, index) => ({
    title: `Film ${String(index)}`,
    href: `/film-${String(index)}/movie-overview`,
    groups: [
      {
        amenities: [],
        isDolby: false,
        variantId: null,
        showtimes: [{ time: '7:00p', expired: false }],
      },
    ],
  }));

function theaterDays(index: number, postedDates = DATES.length): VenueDay[] {
  return DATES.map((date, dateIndex) => ({
    theater: {
      name: `Theater ${String(index)}`,
      href: `/theater-${String(index)}-aaxyz/theater-page?date=${date}`,
      miles: index,
    },
    date,
    movies: movies(dateIndex < postedDates ? 8 : 1),
  }));
}

describe('fandangoTheaters', () => {
  it('returns one canonical page per theater and ignores other sources', () => {
    const [saplDay] = theaterDays(2);
    if (!saplDay) throw new Error('fixture did not produce a venue-day');
    const days = [...theaterDays(1), { ...saplDay, sourceId: 'sapl' }];
    expect(fandangoTheaters(days)).toEqual([
      expect.objectContaining({ href: '/theater-1-aaxyz/theater-page' }),
    ]);
  });

  it('keeps distinct pages even when Fandango renders the same theater name', () => {
    const first = theaterDays(1)[0];
    const second = theaterDays(2)[0];
    if (!first || !second) throw new Error('fixture did not produce venue-days');
    const keyed = fandangoTheaters([
      first,
      { ...second, theater: { ...second.theater, name: first.theater.name } },
    ]);
    expect(keyed.map((theater) => theater.href)).toEqual([
      '/theater-1-aaxyz/theater-page',
      '/theater-2-aaxyz/theater-page',
    ]);
  });
});

describe('planFandangoRescrape', () => {
  it('directly refreshes a small lagging subset only after its known boundary', () => {
    const days = Array.from({ length: 20 }, (_, index) =>
      theaterDays(index + 1, index === 0 ? 2 : DATES.length),
    ).flat();
    const plan = planFandangoRescrape(days, DATES, TODAY, HORIZON, {});
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]?.dates).toEqual(DATES.slice(2));
    expect(plan.targetedPageReads).toBe(3);
    expect(plan.comprehensivePageReads).toBe(6);
    expect(plan.efficient).toBe(true);
  });

  it('prefers batched ZIP pages when many theaters lag together', () => {
    const days = Array.from({ length: 20 }, (_, index) => theaterDays(index + 1, 2)).flat();
    const plan = planFandangoRescrape(days, DATES, TODAY, HORIZON, {});
    expect(plan.targetedPageReads).toBe(60);
    expect(plan.comprehensivePageReads).toBe(6);
    expect(plan.efficient).toBe(false);
  });

  it('does no work when every theater is caught up', () => {
    const plan = planFandangoRescrape(theaterDays(1), DATES, TODAY, HORIZON, {});
    expect(plan.targets).toEqual([]);
    expect(plan.targetedPageReads).toBe(0);
    expect(plan.efficient).toBe(false);
  });
});
