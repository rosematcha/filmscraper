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
  filmFromMcnayTitle,
  isMcnayFilmEvent,
  parseMcnayDate,
  parseMcnayEvents,
  parseMcnayTime,
} from '../src/sources/mcnay/parse.js';
import {
  filmFromRubyCityTitle,
  isRubyCityFilmEvent,
  parseRubyCityDate,
  parseRubyCityEvents,
  parseRubyCityTime,
} from '../src/sources/rubyCity/parse.js';
import {
  filmFromTobinTitle,
  parseTobinCinemaEvents,
  parseTobinDate,
} from '../src/sources/tobinCenter/parse.js';
import { RubyCitySource } from '../src/sources/rubyCity/index.js';
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
    const folded =
      'BEGIN:VEVENT\r\nDTSTART:20260803\r\nSUMMARY:A very long\r\n  title\r\nEND:VEVENT';
    expect(parseIcal(folded)[0]?.summary).toBe('A very long title');
  });
});

describe('SAPL film extraction', () => {
  const event = (over: Partial<Parameters<typeof filmFromSaplEvent>[0]>) =>
    filmFromSaplEvent({
      title: '',
      description: '',
      additionalInfo: '',
      date: '2026-08-03',
      ...over,
    });

  it('reads the film out of a series title', () => {
    expect(event({ title: 'Movie Monday: Fall (2022)' })).toBe('Fall (2022)');
    expect(event({ title: 'Gen X Nostalgia Night: Nightmare on Elm Street' })).toBe(
      'Nightmare on Elm Street',
    );
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
    expect(filmFromLineup('June 5 – Chicken Little (G)', '2026-08-07')).toBeNull();
  });

  it('skips a recurring series that names no film', () => {
    expect(
      event({ title: 'First Friday Film!', description: 'Join us every first Friday.' }),
    ).toBeNull();
    expect(
      event({ title: 'Geeks Assemble!', description: 'Gather to watch cult movies.' }),
    ).toBeNull();
    expect(
      event({ title: 'Monster Meet', description: 'Join fellow horror fans for scary movies.' }),
    ).toBeNull();
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
    expect(
      event({ title: 'Summer Reading Kickoff', description: 'Sign up for prizes.' }),
    ).toBeNull();
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
        {
          title: 'Spiderman: Brand New Day',
          href: 'https://nb.driveinusa.com/e/1',
          groups: [group],
        },
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

describe('McNay events page', () => {
  // Trimmed from https://www.mcnayart.org/events/: the featured event, then two
  // cards, the second of which the theme repeats for its mobile layout.
  const html = `<div class="featured-event">
    <div class="featured-event-info">
      <a href="https://www.mcnayart.org/event/mcnay-summer-film-series-lovefest-paris-is-burning/">
        <h3 class="title">McNay Summer Film Series: LOVEfest | Paris is Burning</h3>
      </a>
      <p class="event-date">Saturday, August 15, 2026</p>
      <p class="event-time">1:00 pm &ndash; 3:00 pm</p>
    </div>
  </div>
  <div class="secondary-events-single programs">
    <a href="https://www.mcnayart.org/event/gallery-talk-two-faced/" class="title">Gallery Talk | Two Faced</a>
    <p class="event-date">September 3, 2026</p>
    <p class="event-time">6:00 pm &ndash; 7:00 pm</p>
  </div>
  <div class="secondary-events-single programs">
    <a href="https://www.mcnayart.org/event/film-screening-angels-in-america-part-one/" class="title">Film Screening and Panel Discussion | Angels in America Part One: Millennium Approaches (2003)</a>
    <p class="event-date">September 27, 2026</p>
    <p class="event-time">1:00 pm &ndash; 5:00 pm</p>
  </div>
  <div class="secondary-events-single programs">
    <a href="https://www.mcnayart.org/event/film-screening-angels-in-america-part-one/" class="title">Film Screening and Panel Discussion | Angels in America Part One: Millennium Approaches (2003)</a>
    <p class="event-date">September 27, 2026</p>
    <p class="event-time">1:00 pm &ndash; 5:00 pm</p>
  </div>`;

  it('reads the featured event and the cards once each', () => {
    const events = parseMcnayEvents(html);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      title: 'McNay Summer Film Series: LOVEfest | Paris is Burning',
      url: 'https://www.mcnayart.org/event/mcnay-summer-film-series-lovefest-paris-is-burning/',
      date: '2026-08-15',
      time: '1:00p',
    });
    expect(events[2]?.date).toBe('2026-09-27');
  });

  it('keeps both showings when an event repeats in a day', () => {
    const twice = html.replace(
      '<p class="event-time">6:00 pm &ndash; 7:00 pm</p>',
      '<p class="event-time">6:00 pm &ndash; 7:00 pm</p><p class="event-date">September 3, 2026</p><p class="event-time">8:00 pm &ndash; 9:00 pm</p>',
    );
    expect(parseMcnayEvents(twice).map((e) => e.time)).toEqual([
      '1:00p',
      '6:00p',
      '8:00p',
      '1:00p',
    ]);
  });

  it('keeps the museum programme that is not a screening out', () => {
    const titles = parseMcnayEvents(html).filter((e) => isMcnayFilmEvent(e.title));
    expect(titles.map((e) => e.date)).toEqual(['2026-08-15', '2026-09-27']);
  });

  it('reads both date styles the theme uses', () => {
    expect(parseMcnayDate('Sunday, September 27, 2026')).toBe('2026-09-27');
    expect(parseMcnayDate('September 4, 2026')).toBe('2026-09-04');
    expect(parseMcnayDate('Opening soon')).toBeNull();
  });

  it('takes the start of the time range', () => {
    expect(parseMcnayTime('1:00 pm &ndash; 5:00 pm')).toBe('1:00p');
    expect(parseMcnayTime('10:00 am &ndash; 11:00 am')).toBe('10:00a');
    expect(parseMcnayTime('')).toBe('');
  });
});

describe('McNay title extraction', () => {
  it('takes the film after the series prefix', () => {
    expect(filmFromMcnayTitle('McNay Summer Film Series: LOVEfest | Paris is Burning')).toBe(
      'Paris is Burning',
    );
    expect(filmFromMcnayTitle('Film Screening: The Walkout')).toBe('The Walkout');
    expect(filmFromMcnayTitle('1954 Film Series: Godzilla')).toBe('Godzilla');
    expect(filmFromMcnayTitle('Film: Deep in the Heart of Texas')).toBe(
      'Deep in the Heart of Texas',
    );
  });

  it('drops the run status the museum stamps on the front', () => {
    expect(filmFromMcnayTitle('SOLD OUT | 1954 Film Series: Godzilla')).toBe('Godzilla');
    expect(filmFromMcnayTitle('FREE | Film Screening: The Walkout')).toBe('The Walkout');
  });

  it('drops a screening that is not happening', () => {
    expect(filmFromMcnayTitle('POSTPONED: GET REEL: Clueless')).toBeNull();
    expect(filmFromMcnayTitle('CANCELLED | Film Screening: Hamlet')).toBeNull();
  });

  it('ignores the session a repeated event is tagged with', () => {
    // The museum runs the same event twice and tells them apart in the title.
    expect(filmFromMcnayTitle('Film Screening | Rear Window | Friday Morning')).toBe('Rear Window');
  });

  it('keeps a film whose own name reads like a series label', () => {
    expect(filmFromMcnayTitle('The Story of Film: An Odyssey')).toBe(
      'The Story of Film: An Odyssey',
    );
  });

  it('keeps a colon that belongs to the film', () => {
    expect(
      filmFromMcnayTitle(
        'Film Screening and Panel Discussion | Angels in America Part One: Millennium Approaches (2003)',
      ),
    ).toBe('Angels in America Part One: Millennium Approaches (2003)');
  });

  it('skips an entry that names no film', () => {
    expect(filmFromMcnayTitle('Film Screening')).toBeNull();
    expect(filmFromMcnayTitle('Film Screening: TBA')).toBeNull();
  });
});

describe('Ruby City events page', () => {
  /** Elementor's loop card: a stack of unlabelled headings under the post id. */
  const card = (postId: string, headings: readonly string[]) =>
    `<div data-elementor-type="loop-item" data-elementor-id="113" class="elementor e-loop-item post-${postId} event type-event">${headings
      .map((h) => `<div class="elementor-heading-title elementor-size-default">${h}</div>`)
      .join('')}</div>`;

  const html = [
    card('1906', ['MONTHLY MEDITATION', 'SUN', '08.16.2026', '9—10AM', 'CHRIS PARK']),
    card('2007', [
      'THEYDREAM FILM SCREENING + FILMMAKER TALK WITH WILLIAM D. CABALLERO',
      'FRI',
      '09.18.2026',
      '8:30—10:00PM',
      'CHRIS PARK',
    ]),
    // Past events render through a second template that carries a title only.
    card('1834', ['ASCO: WITHOUT PERMISSION FILM SCREENING']),
  ].join('\n');

  it('reads the upcoming cards and skips the ones with no date', () => {
    const events = parseRubyCityEvents(html);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      title: 'THEYDREAM FILM SCREENING + FILMMAKER TALK WITH WILLIAM D. CABALLERO',
      postId: '2007',
      date: '2026-09-18',
      time: '8:30p',
      place: 'CHRIS PARK',
    });
  });

  it('keeps the rest of the museum programme out', () => {
    const films = parseRubyCityEvents(html).filter((e) => isRubyCityFilmEvent(e.title));
    expect(films.map((e) => e.postId)).toEqual(['2007']);
  });

  it('reads the date the museum writes with dots', () => {
    expect(parseRubyCityDate('08.16.2026')).toBe('2026-08-16');
    expect(parseRubyCityDate('9.7.2026')).toBe('2026-09-07');
    expect(parseRubyCityDate('16.16.2026')).toBeNull();
  });

  it('borrows the half of the day from whichever end of the range carries it', () => {
    expect(parseRubyCityTime('9—10AM')).toBe('9:00a');
    expect(parseRubyCityTime('2PM—5PM')).toBe('2:00p');
    expect(parseRubyCityTime('11:00AM—12:30PM')).toBe('11:00a');
    expect(parseRubyCityTime('8:30–10:00PM')).toBe('8:30p');
    expect(parseRubyCityTime('8PM')).toBe('8:00p');
    expect(parseRubyCityTime('')).toBe('');
  });
});

describe('Ruby City title extraction', () => {
  it('takes what is being shown from in front of the label', () => {
    expect(filmFromRubyCityTitle('ASCO: WITHOUT PERMISSION FILM SCREENING')).toBe(
      'ASCO: WITHOUT PERMISSION',
    );
    expect(
      filmFromRubyCityTitle('THEYDREAM FILM SCREENING + FILMMAKER TALK WITH WILLIAM D. CABALLERO'),
    ).toBe('THEYDREAM');
  });

  it('reads a title that puts the film after the label instead', () => {
    expect(filmFromRubyCityTitle('FILM SCREENING: THE WALKOUT')).toBe('THE WALKOUT');
    expect(filmFromRubyCityTitle('SCREENING — PARIS IS BURNING + DISCUSSION')).toBe(
      'PARIS IS BURNING',
    );
  });

  it('skips an entry that names no film', () => {
    expect(filmFromRubyCityTitle('FILM SCREENING')).toBeNull();
    expect(filmFromRubyCityTitle('FILM SCREENING: TBA')).toBeNull();
  });
});

describe('Ruby City harvest', () => {
  const request: SourceRequest = { zip: '78205', dates: ['2026-09-18'], radiusMiles: 35 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubSite(eventsHtml: string): void {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: { method?: string }) => {
        if (input.includes('zippopotam')) {
          return Promise.resolve(
            Response.json({ places: [{ latitude: '29.42', longitude: '-98.49' }] }),
          );
        }
        if (init?.method === 'HEAD') {
          const response = new Response(null);
          Object.defineProperty(response, 'url', {
            value: 'https://rubycity.org/events/theydream-film-screening/',
          });
          return Promise.resolve(response);
        }
        return Promise.resolve(new Response(eventsHtml));
      }),
    );
  }

  const card = (postId: string, headings: readonly string[]) =>
    `<div data-elementor-type="loop-item" class="elementor e-loop-item post-${postId} event type-event">${headings
      .map((h) => `<div class="elementor-heading-title elementor-size-default">${h}</div>`)
      .join('')}</div>`;

  it('publishes a screening under the permalink the card does not carry', async () => {
    stubSite(
      [
        card('1906', ['MONTHLY MEDITATION', 'SUN', '09.20.2026', '9—10AM', 'CHRIS PARK']),
        card('2007', [
          'THEYDREAM FILM SCREENING + FILMMAKER TALK',
          'FRI',
          '09.18.2026',
          '8:30—10:00PM',
          'CHRIS PARK',
        ]),
      ].join('\n'),
    );

    const result = await new RubyCitySource().harvest(request);

    expect(result.warnings).toEqual([]);
    expect(result.days).toHaveLength(1);
    expect(result.days[0]?.theater.name).toBe('Chris Park at Ruby City');
    expect(result.days[0]?.movies[0]?.title).toBe('THEYDREAM');
    expect(result.days[0]?.movies[0]?.href).toBe(
      'https://rubycity.org/events/theydream-film-screening/',
    );
    expect(result.days[0]?.movies[0]?.groups[0]?.showtimes[0]?.time).toBe('8:30p');
  });

  it('warns when the page parses to nothing, since a quiet museum still has events', async () => {
    stubSite('<div>Elementor rebuilt the loop</div>');

    const result = await new RubyCitySource().harvest(request);

    expect(result.days).toEqual([]);
    expect(result.warnings[0]?.message).toContain('nothing this parser could read');
  });
});

describe('Ruby City title edge cases', () => {
  it('refuses a title that bills a talk after the screening and no film', () => {
    expect(filmFromRubyCityTitle('FILM SCREENING + ARTIST TALK')).toBeNull();
    expect(filmFromRubyCityTitle('FILM SCREENING (TBA)')).toBeNull();
  });

  it('keeps a film whose own name ends in the word film', () => {
    expect(filmFromRubyCityTitle('THE STORY OF FILM: AN ODYSSEY')).toBe(
      'THE STORY OF FILM: AN ODYSSEY',
    );
  });

  it('reads the labels the museum has not used yet', () => {
    expect(filmFromRubyCityTitle('OUTDOOR CINEMA: THE WALKOUT')).toBe('THE WALKOUT');
    expect(filmFromRubyCityTitle('FILMS AT RUBY CITY: THE WALKOUT')).toBe('THE WALKOUT');
  });

  it('refuses a range with no half of the day on either end', () => {
    expect(parseRubyCityTime('9—10')).toBe('');
  });

  it('keeps the place when a card names no time', () => {
    const card = `<div data-elementor-type="loop-item" class="elementor e-loop-item post-42 event">${[
      'THEYDREAM FILM SCREENING',
      'FRI',
      '09.18.2026',
      'RUBY CITY',
    ]
      .map((h) => `<div class="elementor-heading-title elementor-size-default">${h}</div>`)
      .join('')}</div>`;
    expect(parseRubyCityEvents(card)[0]).toMatchObject({ time: '', place: 'RUBY CITY' });
  });

  it('ignores a date the page prints below the last card', () => {
    const card = `<div data-elementor-type="loop-item" class="elementor e-loop-item post-189 event">${[
      'ESTAFIATE, A PERFORMANCE BY TELETEXTILE',
    ]
      .map((h) => `<div class="elementor-heading-title elementor-size-default">${h}</div>`)
      .join('')}</div>
      <footer>${['Opening soon', 'Newsletter', 'Since', '09.18.2026']
        .map((h) => `<div class="elementor-heading-title elementor-size-default">${h}</div>`)
        .join('')}</footer>`;
    expect(parseRubyCityEvents(card)).toEqual([]);
  });
});
