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

/** Every table but the named ones. */
const without = (...dropped: string[]): SectionOptions =>
  only(...DEFAULT_TABLE_IDS.filter((id) => !dropped.includes(id)));
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

function day(sourceId: string | undefined, title: string, groups: ReturnType<typeof group>[]): VenueDay {
  return {
    theater: { name: `V-${sourceId ?? 'fandango'}`, href: '', miles: 1 },
    date: '2026-08-07',
    movies: [{ title, href: `/${title}/movie-overview`, groups }],
    ...(sourceId ? { sourceId } : {}),
  };
}

const agg = (days: VenueDay[]): AggregatedMovie[] =>
  aggregate(days, days.map((d) => d.theater), { aliases: EMPTY_ALIASES, keepYears: false });

describe('foreign detection', () => {
  it('flags a release whose every showing is non-English', () => {
    const [movie] = agg([day(undefined, 'El Gawahergy', [group([{ id: 1512, name: 'Arabic Language' }])])]);
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
    const sections = buildSections(movies, without('events', 'foreign'));
    expect(find(sections, 'drive-in')?.movies.map((m) => m.title)).toEqual(['Drive-In Only']);
    expect(find(sections, 'library')?.movies.map((m) => m.title)).toEqual(['Library Only']);
    // Foreign stays inline by default.
    expect(find(sections, 'main')?.movies.map((m) => m.title).sort()).toEqual([
      'Foreign Film',
      'Wide Release',
    ]);
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
      { ...day('stars-and-stripes', 'Spider-Man', [group([])]), theater: { name: 'Drive-In', href: '', miles: 30 } },
    ]);
    const sections = buildSections(shared, without('events', 'foreign'));
    expect(find(sections, 'main')?.movies.map((m) => m.title)).toEqual(['Spider-Man']);
    expect(find(sections, 'drive-in')?.movies.map((m) => m.title)).toEqual(['Spider-Man']);
  });

  it('keeps a venue-exclusive film out of the main table', () => {
    const sections = buildSections(movies, without('events', 'foreign'));
    expect(find(sections, 'main')?.movies.map((m) => m.title)).not.toContain('Drive-In Only');
    expect(find(sections, 'main')?.movies.map((m) => m.title)).not.toContain('Library Only');
  });
});

describe('unfilteredSources', () => {
  it('exempts exactly the venues given their own table', () => {
    expect([...unfilteredSources(DEFAULT_SECTION_OPTIONS)].sort()).toEqual(['sapl', 'stars-and-stripes']);
    expect([...unfilteredSources(without('library'))]).toEqual(['stars-and-stripes']);
  });
});

describe('isSpecialEvent', () => {
  const movie = (over: Partial<AggregatedMovie>): AggregatedMovie => ({
    key: 'k',
    title: 'X',
    href: '/x',
    theaters: ['a'],
    freeVenues: [],
    dates: ['2026-08-04'],
    formats: new Map(),
    optional: new Map(),
    optionalDates: new Map(),
    isEvent: false,
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
    expect(isSpecialEvent(movie({ title: 'Manifest', releaseYear: 2026, dates: ['a', 'b', 'c'] }), 2026)).toBe(
      false,
    );
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
      isSpecialEvent(
        movie({ title: 'The Goonies', releaseYear: 1985, dates: ['d1', 'd2'] }),
        2026,
      ),
    ).toBe(true);
  });

  it('leaves current releases alone', () => {
    for (const title of ['Spider-Man: Brand New Day', 'Moana', 'Super Troopers 3', 'Evil Dead Burn']) {
      expect(isSpecialEvent(movie({ title, releaseYear: 2026, dates: ['a', 'b', 'c'] }), 2026), title).toBe(
        false,
      );
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
    dates: ['2026-08-04', '2026-08-05'],
    formats: new Map(),
    optional: oc ? new Map([['Open caption', ['Regal']]]) : new Map(),
    optionalDates: oc ? new Map([['Open caption', ['2026-08-05']]]) : new Map(),
    isEvent: false,
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
    expect(sections.find((s) => s.id === 'main')?.movies.map((m) => m.title).sort()).toEqual([
      'Captioned',
      'Plain',
    ]);
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
  it('splits events and non-English releases out of the box', () => {
    expect([...DEFAULT_SECTION_OPTIONS.tables].sort()).toEqual([
      'drive-in',
      'events',
      'foreign',
      'free',
      'last-chance',
      'library',
      'opens',
    ]);
    // Open captions duplicate rows for a minority audience, so that one is the
    // single table left opt-in.
    expect(DEFAULT_SECTION_OPTIONS.tables).not.toContain('open-captions');
    expect(DEFAULT_SECTION_OPTIONS.excludeForeign).toBe(false);
  });

  it('gives every table a label and a hint for the checklist', () => {
    for (const section of SECTIONS) {
      expect(section.label, section.id).not.toBe('');
      expect(section.hint, section.id).not.toBe('');
    }
  });
});
