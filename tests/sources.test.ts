import { afterEach, describe, expect, it, vi } from 'vitest';
import { icalDate, icalTime, parseIcal } from '../src/core/ical.js';
import { mergeKey } from '../src/core/titles.js';
import { filmFromSaplEvent, filmFromLineup, isCancelled } from '../src/sources/sapl/extract.js';
import { filmFromSlabTitle, parseSlabEvents } from '../src/sources/slab/parse.js';
import {
  filmFromMarqueeTitle,
  parseMarqueeDateTime,
  parseMarqueeEvents,
} from '../src/sources/missionMarquee/parse.js';
import {
  filmFromTobinTitle,
  parseTobinCinemaEvents,
  parseTobinDate,
} from '../src/sources/tobinCenter/parse.js';
import { DriveInSource } from '../src/sources/driveIn/index.js';
import type { SourceRequest } from '../src/sources/source.js';

describe('Slab title extraction', () => {
  it('reads a clean arthouse title', () => {
    expect(filmFromSlabTitle('8/3: Polyester (1981)')).toBe('Polyester (1981)');
    expect(filmFromSlabTitle('8/10: Pearl (2022)')).toBe('Pearl (2022)');
  });

  it('strips the series, venue and sponsor from an outdoor title', () => {
    expect(
      filmFromSlabTitle(
        '08/15: A Minecraft Movie, Outdoor Family Film, Mission Marquee Plaza (Sponsored by COSA World Heritage Office)',
      ),
    ).toBe('A Minecraft Movie');
    expect(
      filmFromSlabTitle(
        '08/20: Ferris Bueller’s Day Off, Outdoor Family Film, Mission Marquee Plaza (Sponsored by COSA World Heritage Office)',
      ),
    ).toBe('Ferris Bueller’s Day Off');
  });

  it('skips outdoor events that name no film', () => {
    // Slab lists these placeholders months ahead of announcing the picture.
    expect(
      filmFromSlabTitle(
        '09/05: Outdoor Family Film, Mission Marquee Plaza (Sponsored by COSA World Heritage Office)',
      ),
    ).toBeNull();
  });

  it('survives a title with no date prefix', () => {
    expect(filmFromSlabTitle('Pearl (2022)')).toBe('Pearl (2022)');
  });
});

describe('parseSlabEvents', () => {
  const html = `<html><script id="wix-warmup-data" type="application/json">${JSON.stringify({
    appsWarmupData: {
      app: {
        widget: {
          events: {
            hasMore: false,
            events: [
              {
                title: '8/3: Polyester (1981)',
                slug: '8-3-polyester-1981',
                status: 0,
                location: {
                  name: 'Arthouse at Blue Star',
                  coordinates: { lat: 29.4083942, lng: -98.4952928 },
                },
                scheduling: {
                  config: { startDate: '2026-08-04T00:00:00.000Z', timeZoneId: 'America/Chicago' },
                },
              },
              {
                title: 'Draft event',
                slug: 'draft',
                status: 1,
                location: { name: 'X', coordinates: { lat: 1, lng: 2 } },
                scheduling: { config: { startDate: '2026-08-05T00:00:00.000Z' } },
              },
            ],
          },
        },
      },
    },
  })}</script></html>`;

  it('reads published events with their coordinates', () => {
    const events = parseSlabEvents(html);
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe('8/3: Polyester (1981)');
    expect(events[0]?.coords).toEqual({ lat: 29.4083942, lon: -98.4952928 });
    expect(events[0]?.venueName).toBe('Arthouse at Blue Star');
  });

  it('returns nothing when the payload is absent', () => {
    expect(parseSlabEvents('<html></html>')).toEqual([]);
  });
});

describe('Mission Marquee parsing', () => {
  it('reads date and time from the venue display string', () => {
    expect(parseMarqueeDateTime('8/15/2026 7:00 PM - 10:30 PM')).toEqual({
      date: '2026-08-15',
      time: '7:00p',
    });
    expect(parseMarqueeDateTime('11/21/2026 6:00 PM - 10:00 PM')).toEqual({
      date: '2026-11-21',
      time: '6:00p',
    });
  });

  it('reads events out of the EasyDNNNews markup', () => {
    const html = `<article class="edn_article edn_clearFix edn_eventsSimple">
      <h2 class="edn_articleTitle"><!-- <a href="https://www.missionmarquee.com/EVENTS/Outdoor-Family-Film-Series/ArtMID/23946/ArticleID/25643/A-Minecraft-Movie">-->A Minecraft Movie<!-- </a> --></h2>
      <time>8/15/2026 7:00 PM - 10:30 PM</time>
    </article>
    <article class="edn_article edn_clearFix edn_eventsSimple">
      <h2 class="edn_articleTitle"><!-- <a href="https://www.missionmarquee.com/EVENTS/Outdoor-Family-Film-Series/ArtMID/23946/ArticleID/25650/Special-Feature-To-be-Announced">-->Special Feature To be Announced<!-- </a> --></h2>
      <time>10/17/2026 6:00 PM - 10:00 PM</time>
    </article>`;
    const events = parseMarqueeEvents(html);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      title: 'A Minecraft Movie',
      url: 'https://www.missionmarquee.com/EVENTS/Outdoor-Family-Film-Series/ArtMID/23946/ArticleID/25643/A-Minecraft-Movie',
      date: '2026-08-15',
      time: '7:00p',
    });
  });

  it('skips placeholders that name no film', () => {
    expect(filmFromMarqueeTitle('Special Feature To be Announced')).toBeNull();
    expect(filmFromMarqueeTitle('La Bamba')).toBe('La Bamba');
  });
});

describe('Tobin Center cinema parsing', () => {
  it('reads a date from the listing', () => {
    expect(parseTobinDate('Sep 12, 2026')).toBe('2026-09-12');
    expect(parseTobinDate('Dec 12, 2026')).toBe('2026-12-12');
  });

  it('reads cinema events out of the Drupal views markup', () => {
    const html = `<div class="views-row"><div class="views-field views-field-title"><span class="field-content"><a href="/scottpilgrim" hreflang="en">Scott Pilgrim vs The World (2010) | H-E-B Cinema on Will’s Plaza</a></span></div><div class="views-field views-field-nothing"><span class="field-content">  Sep 12, 2026
</span></div><div class="views-field views-field-field-show-venue"><div class="field-content">Will Naylor Smith River Walk Plaza</div></div></div>
<div class="views-row"><div class="views-field views-field-title"><span class="field-content"><a href="/practicalmagic" hreflang="en">Practical Magic (1988) | H-E-B Cinema on Will’s Plaza</a></span></div><div class="views-field views-field-nothing"><span class="field-content">  Oct 10, 2026
</span></div><div class="views-field views-field-field-show-venue"><div class="field-content">Will Naylor Smith River Walk Plaza</div></div></div>`;
    const events = parseTobinCinemaEvents(html);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      title: 'Scott Pilgrim vs The World (2010) | H-E-B Cinema on Will’s Plaza',
      url: 'https://www.tobincenter.org/scottpilgrim',
      date: '2026-09-12',
      venueName: 'Will Naylor Smith River Walk Plaza',
    });
  });

  it('strips the series suffix to get the film title', () => {
    expect(
      filmFromTobinTitle('Scott Pilgrim vs The World (2010) | H-E-B Cinema on Will’s Plaza'),
    ).toBe('Scott Pilgrim vs The World (2010)');
    expect(filmFromTobinTitle('Special Feature To be Announced')).toBeNull();
  });
});

describe('iCal parsing', () => {
  const feed = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;TZID=America/Chicago:20260803T204000',
    'SUMMARY:SPIDERMAN: BRAND NEW DAY',
    'URL:https://nb.driveinusa.com/events/spaiderman-brand-new-day-2/',
    'LOCATION:2',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;TZID=America/Chicago:20260804T204500',
    'SUMMARY:MINIONS & MONSTERS',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('reads events and their properties', () => {
    const events = parseIcal(feed);
    expect(events).toHaveLength(2);
    expect(events[0]?.summary).toBe('SPIDERMAN: BRAND NEW DAY');
    expect(events[0]?.timeZone).toBe('America/Chicago');
    expect(events[0]?.url).toContain('driveinusa');
  });

  it('reads a date from a timestamp carrying seconds', () => {
    // Regression: the pattern required exactly four digits of time, so every
    // real `DTSTART` was rejected and the drive-in returned nothing.
    expect(icalDate('20260803T204000', 'America/Chicago')).toBe('2026-08-03');
    expect(icalDate('20260803', 'America/Chicago')).toBe('2026-08-03');
  });

  it('converts a UTC timestamp into the venue’s own date', () => {
    // 01:40Z on the 4th is still the evening of the 3rd in Texas.
    expect(icalDate('20260804T014000Z', 'America/Chicago')).toBe('2026-08-03');
  });

  it('formats the time the way the rest of the table does', () => {
    expect(icalTime('20260803T204000')).toBe('8:40p');
    expect(icalTime('20260803T090000')).toBe('9:00a');
    expect(icalTime('20260803T001500')).toBe('12:15a');
  });

  it('unfolds continuation lines', () => {
    const folded = 'BEGIN:VEVENT\r\nDTSTART:20260803\r\nSUMMARY:A very long\r\n  title\r\nEND:VEVENT';
    expect(parseIcal(folded)[0]?.summary).toBe('A very long title');
  });
});

describe('SAPL film extraction', () => {
  const event = (over: Partial<Parameters<typeof filmFromSaplEvent>[0]>) =>
    filmFromSaplEvent({ title: '', description: '', additionalInfo: '', date: '2026-08-03', ...over });

  it('reads the film out of a series title', () => {
    expect(event({ title: 'Movie Monday: Fall (2022)' })).toBe('Fall (2022)');
    expect(
      event({ title: 'Gen X Nostalgia Night: Nightmare on Elm Street' }),
    ).toBe('Nightmare on Elm Street');
  });

  it('skips cancelled screenings', () => {
    expect(isCancelled('CANCELLED - Gen X Nostalgia Night: Nightmare on Elm Street')).toBe(true);
    expect(event({ title: 'CANCELLED - Movie Monday: Fall (2022)' })).toBeNull();
  });

  it('reads the film from a series lineup matched to the event date', () => {
    // The branch's lineup says August 6 while the event record says August 7.
    expect(
      event({
        title: 'First Friday Film!',
        date: '2026-08-07',
        additionalInfo:
          'The lineup:•June 5 – Chicken Little (G)•July 3 – Matilda (PG)•August 6 – The Rescuers Down Under (G)',
      }),
    ).toBe('The Rescuers Down Under');
  });

  it('picks the right lineup entry even without bullets', () => {
    expect(
      filmFromLineup(
        'The lineup: June 5 – Chicken Little (G) July 3 – Matilda (PG) August 6 – The Rescuers Down Under (G)',
        '2026-08-07',
      ),
    ).toBe('The Rescuers Down Under');
  });

  it('ignores a lineup entry from another month', () => {
    expect(
      filmFromLineup('June 5 – Chicken Little (G)', '2026-08-07'),
    ).toBeNull();
  });

  it('skips a recurring series that names no film', () => {
    expect(event({ title: 'First Friday Film!', description: 'Join us every first Friday.' })).toBeNull();
    expect(event({ title: 'Geeks Assemble!', description: 'Gather to watch cult movies.' })).toBeNull();
    expect(event({ title: 'Monster Meet', description: 'Join fellow horror fans for scary movies.' })).toBeNull();
  });

  it('skips movie-themed events that are not screenings', () => {
    // Practical Magic trivia is themed around a film but screens nothing.
    expect(event({ title: 'Practical Magic Trivia Night' })).toBeNull();
    expect(event({ title: 'Movie Monday: Trivia Edition' })).toBeNull();
    expect(event({ title: 'Harry Potter Book Club' })).toBeNull();
  });

  it('accepts a bare film title when the description confirms a screening', () => {
    expect(
      event({ title: 'The Rescuers Down Under', description: 'Join us for a screening.' }),
    ).toBe('The Rescuers Down Under');
  });

  it('rejects a bare title with no screening language', () => {
    expect(event({ title: 'Summer Reading Kickoff', description: 'Sign up for prizes.' })).toBeNull();
  });
});

describe('cross-source merging', () => {
  it('folds an independent venue’s spelling into Fandango’s', () => {
    // The drive-in writes "Spiderman"; Fandango writes "Spider-Man".
    expect(mergeKey('SPIDERMAN: BRAND NEW DAY')).toBe(mergeKey('Spider-Man: Brand New Day (2026)'));
  });

  it('still separates genuinely different films', () => {
    expect(mergeKey('Toy Story 5')).not.toBe(mergeKey('Toy Story 4'));
    expect(mergeKey('Moana')).not.toBe(mergeKey('Moana 2'));
  });
});

describe('title selection across sources', () => {
  it('lets the widest listing supply the title and link', async () => {
    const { aggregate, EMPTY_ALIASES } = await import('../src/core/aggregate.js');
    const group = {
      amenities: [],
      isDolby: false,
      variantId: null,
      showtimes: [{ time: '7:00p', expired: false }],
    };
    const fandangoDays = ['A', 'B', 'C'].map((venue) => ({
      theater: { name: venue, href: `/${venue}/theater-page`, miles: 1 },
      date: '2026-08-03',
      movies: [
        {
          title: 'Spider-Man: Brand New Day (2026)',
          href: '/spider-man-brand-new-day-2026-243819/movie-overview',
          groups: [group],
        },
      ],
    }));
    const driveIn = {
      theater: { name: 'Drive-In', href: '', miles: 30 },
      date: '2026-08-03',
      movies: [
        { title: 'Spiderman: Brand New Day', href: 'https://nb.driveinusa.com/e/1', groups: [group] },
      ],
      sourceId: 'stars-and-stripes',
    };
    const days = [...fandangoDays, driveIn];
    const theaters = days.map((d) => d.theater);
    const out = aggregate(days, theaters, { aliases: EMPTY_ALIASES, keepYears: false });
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe('Spider-Man: Brand New Day');
    // Fandango hrefs stay site-relative until the renderer prefixes them.
    expect(out[0]?.href).toBe('/spider-man-brand-new-day-2026-243819/movie-overview');
    expect(out[0]?.theaters).toHaveLength(4);
  });
});

describe('Drive-in calendar feed', () => {
  const request: SourceRequest = { zip: '78205', dates: ['2026-08-03'], radiusMiles: 35 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('identifies itself as a browser, since the feed is behind a bot filter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('BEGIN:VCALENDAR\nEND:VCALENDAR'));
    vi.stubGlobal('fetch', fetchMock);

    await new DriveInSource().harvest(request);

    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers['User-Agent']).toMatch(/Chrome\//);
    expect(init.headers['Accept']).toContain('text/calendar');
  });

  it('reports the status code when the feed is blocked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('denied', { status: 403 })));

    const result = await new DriveInSource().harvest(request);

    expect(result.days).toEqual([]);
    expect(result.warnings[0]?.kind).toBe('page-error');
    expect(result.warnings[0]?.message).toContain('403');
  });
});
