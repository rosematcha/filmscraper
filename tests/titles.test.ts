import { describe, expect, it } from 'vitest';
import {
  displayTitle,
  extractYear,
  mergeKey,
  movieIdFromHref,
  stripYear,
} from '../src/core/titles.js';

describe('stripYear', () => {
  it('removes the trailing release year', () => {
    expect(stripYear('Spider-Man: Brand New Day (2026)')).toBe('Spider-Man: Brand New Day');
    expect(stripYear('The Twilight Saga: New Moon (2009)')).toBe('The Twilight Saga: New Moon');
  });

  it('leaves titles without one alone', () => {
    expect(stripYear('Paddington 2')).toBe('Paddington 2');
    expect(stripYear('The Untouchables')).toBe('The Untouchables');
  });

  it('does not touch a year that is part of the title', () => {
    expect(stripYear('Blade Runner 2049')).toBe('Blade Runner 2049');
    expect(stripYear('2001: A Space Odyssey')).toBe('2001: A Space Odyssey');
  });
});

describe('extractYear', () => {
  it('reads the year when present', () => {
    expect(extractYear('Moana (2026)')).toBe(2026);
    expect(extractYear('Paddington 2')).toBeNull();
  });
});

describe('displayTitle', () => {
  it('strips years by default and keeps them on request', () => {
    expect(displayTitle('Moana (2026)', false)).toBe('Moana');
    expect(displayTitle('Moana (2026)', true)).toBe('Moana (2026)');
  });

  it('collapses whitespace', () => {
    expect(displayTitle('  The   Odyssey (2026) ', false)).toBe('The Odyssey');
  });

  it('keeps anniversary suffixes, which are real information', () => {
    expect(displayTitle('Willy Wonka & The Chocolate Factory 55th Anniversary', false)).toBe(
      'Willy Wonka & The Chocolate Factory 55th Anniversary',
    );
  });
});

describe('mergeKey', () => {
  it('folds edition variants onto the base film', () => {
    expect(mergeKey('Backrooms: Everything Must Go Edition with Bonus Footage (2026)')).toBe(
      mergeKey('Backrooms (2026)'),
    );
  });

  it('folds anniversary re-releases onto the base title', () => {
    expect(mergeKey('Willy Wonka & The Chocolate Factory 55th Anniversary')).toBe(
      mergeKey('Willy Wonka and the Chocolate Factory'),
    );
  });

  it('folds format-specific listings together', () => {
    expect(mergeKey('The Odyssey (2026)')).toBe(mergeKey('The Odyssey - IMAX (2026)'));
    expect(mergeKey('Avatar 3D')).toBe(mergeKey('Avatar'));
  });

  it('ignores leading articles and ampersand spelling', () => {
    expect(mergeKey('The Untouchables')).toBe(mergeKey('Untouchables'));
    expect(mergeKey('Dungeons & Dragons')).toBe(mergeKey('Dungeons and Dragons'));
  });

  it('keeps genuinely different films apart', () => {
    expect(mergeKey('Moana (2026)')).not.toBe(mergeKey('Moana 2 (2024)'));
    expect(mergeKey('Toy Story 5')).not.toBe(mergeKey('Toy Story 4'));
    expect(mergeKey('Supergirl (2026)')).not.toBe(mergeKey('Superman (2025)'));
  });

  it('never collapses a title to nothing', () => {
    expect(mergeKey('IMAX')).not.toBe('');
    expect(mergeKey('3D')).not.toBe('');
  });
});

describe('movieIdFromHref', () => {
  it('reads Fandango movie ids', () => {
    expect(movieIdFromHref('/spider-man-brand-new-day-2026-243819/movie-overview')).toBe('243819');
    expect(movieIdFromHref('/alamo-the-price-of-freedom-2181/movie-overview')).toBe('2181');
  });

  it('returns null for anything else', () => {
    expect(movieIdFromHref('/movie-theaters/regal/78205')).toBeNull();
  });
});

describe('event-tail merging', () => {
  it('folds a fan-event screening into the film', () => {
    expect(mergeKey('Super Troopers 3: Special Broken Lizard Fan Event Q&A')).toBe(
      mergeKey('Super Troopers 3'),
    );
  });

  it('folds Ghibli Fest and early-access variants', () => {
    expect(mergeKey('Only Yesterday 35th Anniversary - Studio Ghibli Fest 2026')).toBe(
      mergeKey('Only Yesterday'),
    );
    expect(mergeKey('PAW Patrol: The Dino Movie - Early Access My First Movie')).toBe(
      mergeKey('PAW Patrol: The Dino Movie'),
    );
  });

  it('leaves ordinary subtitles alone', () => {
    expect(mergeKey('Mission: Impossible')).not.toBe(mergeKey('Mission'));
    expect(mergeKey("Gabby's Dollhouse: The Movie")).not.toBe(mergeKey("Gabby's Dollhouse"));
    expect(mergeKey('Hadestown: The Musical')).not.toBe(mergeKey('Hadestown'));
    expect(mergeKey('ATEEZ : LIGHT THE WAY IN CINEMAS')).not.toBe(mergeKey('ATEEZ'));
  });
});

describe('suffixed subtitles', () => {
  it('keeps a subtitle that only wears a suffix', () => {
    // The early-access night is a showing of the wide release, not a film
    // called "Oasis".
    expect(mergeKey("Oasis: Don't Look Back in Anger IMAX Early Access Screening")).toBe(
      mergeKey("Oasis: Don't Look Back in Anger"),
    );
    expect(mergeKey("Oasis: Don't Look Back in Anger")).not.toBe(mergeKey('Oasis'));
  });

  it('folds restorations and remasters onto the film', () => {
    expect(mergeKey('Akira 4K Re-Release')).toBe(mergeKey('Akira'));
    expect(mergeKey('Train to Busan - 10th Anniversary Remastered & Revived')).toBe(
      mergeKey('Train to Busan'),
    );
  });
});
