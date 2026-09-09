import { describe, expect, it } from 'vitest';
import { foreignLanguageOf } from '../src/core/amenities.js';
import { aggregate, EMPTY_ALIASES } from '../src/core/aggregate.js';
import {
  buildSections,
  hasOpenCaptions,
  isSpecialEvent,
  openCaptionEntry,
  unfilteredSources,
  DEFAULT_SECTION_OPTIONS,
  DEFAULT_TABLE_IDS,
  SECTIONS,
  type SectionOptions,
} from '../src/core/sections.js';

/** Options carrying exactly the named tables, and nothing else. */
const only = (...tables: string[]): SectionOptions => ({
  ...DEFAULT_SECTION_OPTIONS,
  tables,
  currentYear: 2026,
});

import type { AggregatedMovie, Amenity, VenueDay } from '../src/core/types.js';

describe('foreignLanguageOf', () => {
  const of = (name: string): string | null => foreignLanguageOf({ id: -1, name });

  it('names the language Fandango tags', () => {
    // Real ids seen live: 1512 Arabic, 1289 Japanese, 1324 Korean.
    expect(of('Arabic Language')).toBe('Arabic');
    expect(of('Japanese Language')).toBe('Japanese');
    expect(of('Telugu Language')).toBe('Telugu');
  });

  it('treats English dubs and subtitles as a foreign original', () => {
    expect(of('English Dubbed')).toBe('');
    expect(of('English Subtitles')).toBe('');
  });

  it('ignores English itself and unrelated amenities', () => {
    expect(of('English Language')).toBeNull();
    expect(of('Reserved seating')).toBeNull();
    expect(of('IMAX')).toBeNull();
  });
});

const group = (amenities: Amenity[]) => ({
  amenities,
  isDolby: false,
  variantId: null,
  showtimes: [{ time: '7:00p', expired: false }],
});

function day(
  sourceId: string | undefined,
  title: string,
  groups: ReturnType<typeof group>[],
): VenueDay {
  return {
    theater: { name: `V-${sourceId ?? 'fandango'}`, href: '', miles: 1 },
    date: '2026-08-07',
    movies: [{ title, href: `/${title}/movie-overview`, groups }],
    ...(sourceId ? { sourceId } : {}),
  };
}

const agg = (days: VenueDay[]): AggregatedMovie[] =>
  aggregate(
    days,
    days.map((d) => d.theater),
    { aliases: EMPTY_ALIASES, keepYears: false },
  );

describe('foreign detection', () => {
  it('flags a release whose every showing is non-English', () => {
    const [movie] = agg([
      day(undefined, 'El Gawahergy', [group([{ id: 1512, name: 'Arabic Language' }])]),
    ]);
    expect(movie?.foreign).toBe(true);
    expect(movie?.languages).toEqual(['Arabic']);
  });

  it('does not flag an English film that has one dubbed screening', () => {
    // Spider-Man plays Spanish-dubbed at a single venue; that is a dub, not a
    // foreign release, and it must not end up in a "not in English" table.
    const [movie] = agg([
      day(undefined, 'Spider-Man', [
        group([{ id: 2011, name: 'Reserved seating' }]),
        group([{ id: 1128, name: 'Spanish Language' }]),
      ]),
    ]);
    expect(movie?.foreign).toBe(false);
    expect(movie?.languages).toEqual([]);
  });

  it('flags an anime shown only in an English dub', () => {
    const [movie] = agg([
      day(undefined, 'Tales from Earthsea', [group([{ id: 1055, name: 'English Dubbed' }])]),
    ]);
    expect(movie?.foreign).toBe(true);
  });
});

describe('buildSections', () => {
  const movies = agg([
    day(undefined, 'Wide Release', [group([])]),
    day('stars-and-stripes', 'Drive-In Only', [group([])]),
    day('sapl', 'Library Only', [group([])]),
    day(undefined, 'Foreign Film', [group([{ id: 1512, name: 'Arabic Language' }])]),
  ]);
  const find = (sections: ReturnType<typeof buildSections>, id: string) =>
    sections.find((s) => s.id === id);

  it('breaks the drive-in and library into their own tables', () => {
    // Asked for by name: both venue tables are opt-in.
    const sections = buildSections(movies, only('drive-in', 'library'));
    expect(find(sections, 'drive-in')?.movies.map((m) => m.title)).toEqual(['Drive-In Only']);
    expect(find(sections, 'library')?.movies.map((m) => m.title)).toEqual(['Library Only']);
    // Foreign stays inline by default.
    expect(
      find(sections, 'main')
        ?.movies.map((m) => m.title)
        .sort(),
    ).toEqual(['Foreign Film', 'Wide Release']);
  });

  it('keeps everything in one table when the options are off', () => {
    const sections = buildSections(movies, only());
    expect(sections).toHaveLength(1);
    expect(sections[0]?.movies).toHaveLength(4);
  });

  it('can give non-English releases their own table', () => {
    const sections = buildSections(movies, only('foreign'));
    expect(find(sections, 'foreign')?.movies.map((m) => m.title)).toEqual(['Foreign Film']);
  });

  it('can drop non-English releases entirely', () => {
    const sections = buildSections(movies, { ...only(), excludeForeign: true });
    expect(sections.flatMap((s) => s.movies).map((m) => m.title)).not.toContain('Foreign Film');
  });

  it('lists a shared film in both the main and the venue table', () => {
    // The drive-in mostly plays wide releases, so an "exclusive only" rule
    // would leave its table empty nearly every week.
    const shared = agg([
      day(undefined, 'Spider-Man', [group([])]),
      {
        ...day('stars-and-stripes', 'Spider-Man', [group([])]),
        theater: { name: 'Drive-In', href: '', miles: 30 },
      },
    ]);
    const sections = buildSections(shared, only('drive-in'));
    expect(find(sections, 'main')?.movies.map((m) => m.title)).toEqual(['Spider-Man']);
    expect(find(sections, 'drive-in')?.movies.map((m) => m.title)).toEqual(['Spider-Man']);
  });

  it('keeps a venue-exclusive film out of the main table', () => {
    const sections = buildSections(movies, only('drive-in', 'library'));
    expect(find(sections, 'main')?.movies.map((m) => m.title)).not.toContain('Drive-In Only');
    expect(find(sections, 'main')?.movies.map((m) => m.title)).not.toContain('Library Only');
  });
});

describe('unfilteredSources', () => {
  it('exempts exactly the venues given their own table', () => {
    expect([...unfilteredSources(only('drive-in', 'library'))].sort()).toEqual([
      'sapl',
      'stars-and-stripes',
    ]);
    expect([...unfilteredSources(only('drive-in'))]).toEqual(['stars-and-stripes']);
  });

  it('exempts nothing by default, since neither venue table is on', () => {
    // The radius is the only thing keeping the drive-in out of a downtown
    // search once its table is off, so the exemption has to go with it.
    expect([...unfilteredSources(DEFAULT_SECTION_OPTIONS)]).toEqual([]);
  });
});

describe('isSpecialEvent', () => {
  const movie = (over: Partial<AggregatedMovie>): AggregatedMovie => ({
    key: 'k',
    title: 'X',
    href: '/x',
    theaters: ['a'],
    freeVenues: [],
    freeDates: [],
    dates: ['2026-08-04'],
    formats: new Map(),
    optional: new Map(),
    optionalDates: new Map(),
    isEvent: false,
    events: new Map(),
    eventDates: new Map(),
    showings: [],
    isFixture: false,
    sources: ['fandango'],
    languages: [],
    foreign: false,
    releaseYear: 2026,
    mergedHrefs: [],
    ticketLinks: [],
    ...over,
  });

  it('treats a missing year as a catalogue booking', () => {
    // Fandango omits the year on repertory titles: "Paddington 2",
    // "The Untouchables", "Billy Madison", "CatVideoFest" all arrive without
    // one, which is why the year carries most of the weight here.
    for (const title of ['Paddington 2', 'The Untouchables', 'Billy Madison', 'CatVideoFest']) {
      expect(isSpecialEvent(movie({ title, releaseYear: null }), 2026), title).toBe(true);
    }
  });

  it('does not mistake an ordinary title for a festival', () => {
    // "Manifest" ends in "fest"; the pattern must not fire on it.
    expect(
      isSpecialEvent(movie({ title: 'Manifest', releaseYear: 2026, dates: ['a', 'b', 'c'] }), 2026),
    ).toBe(false);
  });

  it('flags amenity-marked events', () => {
    expect(isSpecialEvent(movie({ isEvent: true, title: 'Some Broadcast' }), 2026)).toBe(true);
  });

  it('flags mystery and secret screenings, which carry no marker', () => {
    for (const title of [
      'Santikos Monday Mystery Movie',
      'REGAL: Monday Mystery Movie',
      'Cinemark Secret Movie Series',
      'SECRET FLIX',
      'Grateful Dead Meet-Up At The Movies 2026',
      'Aida: Met Summer Encore 2026',
    ]) {
      expect(isSpecialEvent(movie({ title, releaseYear: 2026 }), 2026), title).toBe(true);
    }
  });

  it('flags a revival of an older film on a short run', () => {
    expect(
      isSpecialEvent(movie({ title: 'The Sandlot', releaseYear: 1993, dates: ['d1'] }), 2026),
    ).toBe(true);
    expect(
      isSpecialEvent(movie({ title: 'The Goonies', releaseYear: 1985, dates: ['d1', 'd2'] }), 2026),
    ).toBe(true);
  });

  it('flags a revival of an old film however long it runs', () => {
    // A week of The Sandlot is repertory programming, not a late leg.
    expect(
      isSpecialEvent(
        movie({ title: 'The Sandlot', releaseYear: 1993, dates: ['a', 'b', 'c', 'd', 'e'] }),
        2026,
      ),
    ).toBe(true);
  });

  it('never flags a fixture', () => {
    expect(
      isSpecialEvent(
        movie({ title: 'Alamo: The Price of Freedom', releaseYear: null, isFixture: true }),
        2026,
      ),
    ).toBe(false);
  });

  it('reads restorations and re-releases as events', () => {
    for (const title of [
      'Practical Magic Re-Release',
      "Michael Mann's Manhunter: The Final Cut",
      'Akira 4K Re-Release',
      'August Crunchyroll Anime Nights - Your Letter',
      'MST3K: The RiffTrax Experiments - Sting of Death',
    ]) {
      expect(
        isSpecialEvent(movie({ title, releaseYear: 2026, dates: ['a', 'b', 'c'] }), 2026),
        title,
      ).toBe(true);
    }
  });

  it('leaves current releases alone', () => {
    for (const title of [
      'Spider-Man: Brand New Day',
      'Moana',
      'Super Troopers 3',
      'Evil Dead Burn',
    ]) {
      expect(
        isSpecialEvent(movie({ title, releaseYear: 2026, dates: ['a', 'b', 'c'] }), 2026),
        title,
      ).toBe(false);
    }
  });

  it('leaves a recent film still playing a real run alone', () => {
    // Despicable Me 4 is two years old but plays five venues across three days;
    // that is a late leg of its release, not a revival.
    expect(
      isSpecialEvent(
        movie({ title: 'Despicable Me 4', releaseYear: 2024, dates: ['a', 'b', 'c'] }),
        2026,
      ),
    ).toBe(false);
  });

  it('only builds the events table when asked', () => {
    const revival = movie({ title: 'The Goonies', releaseYear: 1985, dates: ['d1'] });
    const inline = buildSections([revival], only());
    expect(inline.find((s) => s.id === 'events')).toBeUndefined();
    const split = buildSections([revival], only('events'));
    expect(split.find((s) => s.id === 'events')?.movies).toHaveLength(1);
  });
});

describe('open-caption table', () => {
  const withOc = (title: string, oc: boolean): AggregatedMovie => ({
    key: title,
    title,
    href: `/${title}`,
    theaters: ['Regal'],
    freeVenues: [],
    freeDates: [],
    dates: ['2026-08-04', '2026-08-05'],
    formats: new Map(),
    optional: oc ? new Map([['Open caption', ['Regal']]]) : new Map(),
    optionalDates: oc ? new Map([['Open caption', ['2026-08-05']]]) : new Map(),
    isEvent: false,
    events: new Map(),
    eventDates: new Map(),
    showings: [],
    isFixture: false,
    sources: ['fandango'],
    languages: [],
    foreign: false,
    releaseYear: 2026,
    mergedHrefs: [],
    ticketLinks: [],
  });
  const films = [withOc('Captioned', true), withOc('Plain', false)];

  it('is absent unless asked for', () => {
    const sections = buildSections(films, only(...DEFAULT_TABLE_IDS));
    expect(sections.find((s) => s.id === 'open-captions')).toBeUndefined();
  });

  it('lists captioned films without removing them from the main table', () => {
    // Duplication is intended: the film still has ordinary screenings.
    const sections = buildSections(films, only('open-captions'));
    expect(sections.find((s) => s.id === 'open-captions')?.movies.map((m) => m.title)).toEqual([
      'Captioned',
    ]);
    expect(
      sections
        .find((s) => s.id === 'main')
        ?.movies.map((m) => m.title)
        .sort(),
    ).toEqual(['Captioned', 'Plain']);
  });

  it('keeps only the captioned screenings, not the whole day at that venue', () => {
    // A screen runs a plain 4:00p and a captioned 7:00p. Filtering by venue
    // and date alone kept both, so the captioned table printed a time nobody
    // could see captioned.
    const showing = (times: string[], labels: string[]) => ({
      date: '2026-08-05',
      theater: 'Regal',
      times,
      format: null,
      labels,
      admission: 'unknown' as const,
      sourceId: 'fandango',
    });
    const film: AggregatedMovie = {
      ...withOc('Spider-Man', true),
      showings: [showing(['4:00p'], []), showing(['7:00p'], ['Open caption'])],
    };
    expect(openCaptionEntry(film).showings.flatMap((s) => s.times)).toEqual(['7:00p']);
  });

  it('narrows the captioned entry to its own venues and dates', () => {
    // All poodles are dogs: the captioned booking is a subset of the run, so it
    // must not inherit the film's full twenty-theater reach.
    const wide: AggregatedMovie = {
      ...withOc('Spider-Man', true),
      theaters: ['Regal', 'Palladium', 'Rivercenter'],
      dates: ['2026-08-04', '2026-08-05', '2026-08-06'],
      formats: new Map([['IMAX', ['Rivercenter']]]),
    };
    const entry = openCaptionEntry(wide);
    expect(entry.theaters).toEqual(['Regal']);
    expect(entry.dates).toEqual(['2026-08-05']);
    // An IMAX booking elsewhere says nothing about the captioned screening.
    expect(entry.formats.size).toBe(0);
  });

  it('ignores a film whose caption list is empty', () => {
    const empty = { ...withOc('Plain', false), optional: new Map([['Open caption', []]]) };
    expect(hasOpenCaptions(empty)).toBe(false);
  });
});

describe('default section options', () => {
  it('leads with what is coming, opening and closing out of the box', () => {
    // The timing tables answer "what should I see this week" and now judge
    // runs against the ledger as well as the posting frontier. The two venue
    // tables are a standing interest rather than a default one, and open
    // captions duplicate rows for a minority audience.
    expect([...DEFAULT_SECTION_OPTIONS.tables].sort()).toEqual([
      'coming',
      'events',
      'foreign',
      'free',
      'last-chance',
      'opens',
    ]);
    for (const optIn of ['drive-in', 'library', 'open-captions']) {
      expect(DEFAULT_SECTION_OPTIONS.tables).not.toContain(optIn);
    }
    expect(DEFAULT_SECTION_OPTIONS.excludeForeign).toBe(false);
  });

  it('gives every table a label and a hint for the checklist', () => {
    for (const section of SECTIONS) {
      expect(section.label, section.id).not.toBe('');
      expect(section.hint, section.id).not.toBe('');
    }
  });
});

describe('highlight tables', () => {
  const week = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'];
  const window = { windowDates: week, knownFrom: '2026-08-03', horizon: '2026-08-07' };

  const film = (
    title: string,
    dates: string[],
    over: Partial<AggregatedMovie> = {},
  ): AggregatedMovie => ({
    key: title,
    title,
    href: `/${title}`,
    theaters: ['Palladium'],
    freeVenues: [],
    freeDates: [],
    dates,
    formats: new Map(),
    optional: new Map(),
    optionalDates: new Map(),
    isEvent: false,
    events: new Map(),
    eventDates: new Map(),
    showings: [],
    isFixture: false,
    sources: ['fandango'],
    languages: [],
    foreign: false,
    releaseYear: 2026,
    mergedHrefs: [],
    ticketLinks: [],
    ...over,
  });

  const titles = (sections: ReturnType<typeof buildSections>, id: string): string[] =>
    sections.find((s) => s.id === id)?.movies.map((m) => m.title) ?? [];

  it('lists a run that ends before the horizon under last chance', () => {
    const films = [film('Closing', week.slice(0, 3)), film('Staying', week)];
    const sections = buildSections(films, only('last-chance'), window);
    expect(titles(sections, 'last-chance')).toEqual(['Closing']);
  });

  it('takes the film out of the main table', () => {
    // A timing table owns its rows: listing the same film twice made the page
    // read as though there were two bookings.
    const sections = buildSections(
      [film('Closing', week.slice(0, 3))],
      only('last-chance'),
      window,
    );
    expect(titles(sections, 'main')).toEqual([]);
  });

  it('leaves a non-English film under its own table rather than last chance', () => {
    // What a film is outranks what its week is doing, so the table a reader
    // scans for stays populated.
    const closing = film('Ending', week.slice(0, 3), { foreign: true });
    const sections = buildSections([closing], only('last-chance', 'foreign'), window);
    expect(titles(sections, 'foreign')).toEqual(['Ending']);
    expect(titles(sections, 'last-chance')).toEqual([]);
    expect(titles(sections, 'main')).toEqual([]);
  });

  it('still keeps a partial-run table alongside the main row', () => {
    // A free park screening describes a subset of the run, so the main row
    // that describes the rest of it has to survive.
    const mixed = film('Paddington', week, {
      theaters: ['Palladium', 'Travis Park'],
      freeVenues: ['Travis Park'],
      freeDates: [week[1] ?? ''],
    });
    const sections = buildSections([mixed], only('free'), window);
    expect(titles(sections, 'free')).toEqual(['Paddington']);
    expect(titles(sections, 'main')).toEqual(['Paddington']);
  });

  it('lists a film that starts partway through under opens', () => {
    const films = [film('New', week.slice(2)), film('Running', week)];
    const sections = buildSections(films, only('opens'), window);
    expect(titles(sections, 'opens')).toEqual(['New']);
  });

  it('builds no highlight tables without the dates to judge a run', () => {
    // The dataset view can render a window it has no posting boundary for; an
    // empty window must not turn every film into an opening.
    const sections = buildSections([film('Whatever', week)], only('last-chance', 'opens'));
    expect(sections.map((s) => s.id)).toEqual(['main']);
  });

  it('names only the venues that said the screening was free', () => {
    const mixed = film('A Minecraft Movie', week, {
      theaters: ['Palladium', 'Mission Marquee Plaza'],
      freeVenues: ['Mission Marquee Plaza'],
      freeDates: ['2026-08-05'],
    });
    const sections = buildSections([mixed], only('free'), window);
    const entry = sections.find((s) => s.id === 'free')?.movies[0];
    expect(entry?.theaters).toEqual(['Mission Marquee Plaza']);
    // Narrowed on both axes: the free night is one date, not the paid week.
    expect(entry?.dates).toEqual(['2026-08-05']);
    // It still plays for money at the multiplex, so it keeps its main-table row.
    expect(titles(sections, 'main')).toEqual(['A Minecraft Movie']);
  });

  it('leaves a film out of the free table when nothing said it was free', () => {
    const sections = buildSections([film('Spider-Man', week)], only('free'), window);
    expect(sections.find((s) => s.id === 'free')).toBeUndefined();
  });

  describe('reach filters', () => {
    const wide = film('Wide', week, { theaters: ['A', 'B', 'C', 'D', 'E'] });
    const middle = film('Middle', week, { theaters: ['A', 'B'] });
    const single = film('Single', week, { theaters: ['A'] });
    const all = [wide, middle, single];

    it('drops wide releases and keeps the rest', () => {
      const sections = buildSections(all, { ...only(), hideWide: true }, window);
      expect(titles(sections, 'main')).toEqual(['Middle', 'Single']);
    });

    it('drops one-theater bookings and keeps the rest', () => {
      const sections = buildSections(all, { ...only(), hideSingle: true }, window);
      expect(titles(sections, 'main')).toEqual(['Wide', 'Middle']);
    });

    it('leaves only the middle when both are on', () => {
      const sections = buildSections(all, { ...only(), hideWide: true, hideSingle: true }, window);
      expect(titles(sections, 'main')).toEqual(['Middle']);
    });

    it('still answers a venue table in full', () => {
      // "What is on at the library" is asked for by name, so pruning the
      // listing must not prune the answer — the same reasoning that exempts
      // these tables from the radius.
      const atLibrary = film('Library Only', week, { theaters: ['Central'], sources: ['sapl'] });
      const sections = buildSections([atLibrary], { ...only('library'), hideSingle: true }, window);
      expect(titles(sections, 'library')).toEqual(['Library Only']);
      expect(titles(sections, 'main')).toEqual([]);
    });
  });
});

describe('claimed rows', () => {
  it('keeps a venue table filled even when the events table would claim its films', () => {
    // Library screenings are nearly all undated catalogue titles, so every one
    // of them is a "special event" too. Letting that table claim them first
    // left the library table permanently empty.
    const sections = buildSections(agg([day('sapl', 'Old Library Film', [group([])])]), {
      ...only('library', 'events'),
      currentYear: 2026,
    });
    expect(sections.find((s) => s.id === 'library')?.movies.map((m) => m.title)).toEqual([
      'Old Library Film',
    ]);
    // And it is still out of the main table, since it plays nowhere else.
    expect(sections.find((s) => s.id === 'main')?.movies).toEqual([]);
    expect(sections.find((s) => s.id === 'events')).toBeUndefined();
  });

  it('lists a film in one partition even when it qualifies for two', () => {
    // An Arabic-language revival is both foreign and a special screening; it is
    // listed once, under whichever table comes first in the registry.
    const revival: AggregatedMovie = {
      key: 'k',
      title: 'Old Foreign Film',
      href: '/x',
      theaters: ['Alamo Quarry'],
      freeVenues: [],
      freeDates: [],
      dates: ['2026-08-04'],
      formats: new Map(),
      optional: new Map(),
      optionalDates: new Map(),
      isEvent: false,
      events: new Map(),
      eventDates: new Map(),
      showings: [],
      isFixture: false,
      sources: ['fandango'],
      languages: ['Arabic'],
      foreign: true,
      releaseYear: 1974,
      mergedHrefs: [],
      ticketLinks: [],
    };
    const sections = buildSections([revival], only('foreign', 'events'));
    const listed = sections.filter((s) => s.movies.some((m) => m.title === 'Old Foreign Film'));
    expect(listed.map((s) => s.id)).toEqual(['foreign']);
  });
});

describe('coming soon and the ledger', () => {
  const week = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'];
  const window = { windowDates: week, knownFrom: '2026-08-03', horizon: '2026-08-07' };
  const film = (
    title: string,
    dates: string[],
    over: Partial<AggregatedMovie> = {},
  ): AggregatedMovie => ({
    key: title,
    title,
    href: `/${title}`,
    theaters: ['Palladium'],
    freeVenues: [],
    freeDates: [],
    dates,
    formats: new Map(),
    optional: new Map(),
    optionalDates: new Map(),
    isEvent: false,
    events: new Map(),
    eventDates: new Map(),
    showings: [],
    isFixture: false,
    sources: ['fandango'],
    languages: [],
    foreign: false,
    releaseYear: 2026,
    mergedHrefs: [],
    ticketLinks: [],
    ...over,
  });
  const titles = (sections: ReturnType<typeof buildSections>, id: string): string[] =>
    sections.find((s) => s.id === id)?.movies.map((m) => m.title) ?? [];

  it('lists films on sale for after the window under coming soon', () => {
    const later = film('Later', ['2026-08-20']);
    const fixture = film('Fixture', ['2026-08-20'], { isFixture: true });
    const sections = buildSections([], only('coming'), window, { upcoming: [later, fixture] });
    expect(titles(sections, 'coming')).toEqual(['Later']);
  });

  it('applies the reach filters to what is coming', () => {
    const wide = film('Wide', ['2026-08-20'], { theaters: ['a', 'b', 'c', 'd'] });
    const one = film('Single', ['2026-08-20']);
    const shown = buildSections([], { ...only('coming'), hideWide: true }, window, {
      upcoming: [wide, one],
    });
    expect(titles(shown, 'coming')).toEqual(['Single']);
    const hidden = buildSections([], { ...only('coming'), hideSingle: true }, window, {
      upcoming: [wide, one],
    });
    expect(titles(hidden, 'coming')).toEqual(['Wide']);
  });

  it('is absent without anything upcoming', () => {
    const sections = buildSections([film('Now', week)], only('coming'), window);
    expect(sections.find((s) => s.id === 'coming')).toBeUndefined();
  });

  it('opens a film the ledger first lists inside the window, even when it plays every day', () => {
    const all = film('Opened Friday', week);
    const opened = buildSections([all], only('opens'), window, {
      firstDateOf: () => '2026-08-03',
      watchedSince: '2026-07-01',
    });
    expect(titles(opened, 'opens')).toEqual(['Opened Friday']);
    const running = buildSections([all], only('opens'), window, {
      firstDateOf: () => '2026-07-20',
      watchedSince: '2026-07-01',
    });
    expect(titles(running, 'opens')).toEqual([]);
    expect(titles(running, 'main')).toEqual(['Opened Friday']);
  });

  it('opens nothing on a ledger that started the same day it first saw the film', () => {
    // Otherwise the first run after a fresh ledger reports the entire market
    // as opening this week.
    const all = film('Already Running', week);
    const sections = buildSections([all], only('opens'), window, {
      firstDateOf: () => '2026-08-03',
      watchedSince: '2026-08-03',
    });
    expect(titles(sections, 'opens')).toEqual([]);
    expect(titles(sections, 'main')).toEqual(['Already Running']);
  });

  it('keeps a fixture out of every timing table', () => {
    const fixture = film('Fixture', week.slice(0, 3), { isFixture: true, releaseYear: null });
    const sections = buildSections([fixture], only('opens', 'last-chance', 'events'), window);
    expect(titles(sections, 'main')).toEqual(['Fixture']);
  });
});
