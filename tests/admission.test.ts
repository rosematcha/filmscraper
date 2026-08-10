import { describe, expect, it } from 'vitest';
import { detectAdmission, firstKnown, textOf } from '../src/core/admission.js';

describe('detectAdmission', () => {
  it('reads the phrases venues actually use for a free screening', () => {
    for (const text of [
      'Free admission, bring a blanket.',
      'This screening is free and open to the public.',
      'Admission is free!',
      'No charge — seating is first come, first served.',
      'FREE: Film Series: The Story of Film',
      '08/15: A Minecraft Movie, Outdoor Family Film, Free Admission',
    ]) {
      expect(detectAdmission(text), text).toBe('free');
    }
  });

  it('says nothing when the listing says nothing', () => {
    expect(detectAdmission('Spider-Man: Brand New Day')).toBe('unknown');
    expect(detectAdmission('')).toBe('unknown');
    expect(detectAdmission(undefined)).toBe('unknown');
  });

  it('will not call a ticketed screening free on the strength of a perk', () => {
    // Both of these appear in this copy verbatim, and both are paid nights.
    expect(detectAdmission('Free popcorn for members. Tickets $12.')).toBe('paid');
    expect(detectAdmission('Free parking in the garage', 'Admission: $8')).toBe('paid');
  });

  it('treats "free with admission" as unknown, since the door still costs', () => {
    expect(detectAdmission('Free with museum admission')).toBe('unknown');
  });

  it('reads a price however it is written', () => {
    expect(detectAdmission('$16 general')).toBe('paid');
    expect(detectAdmission('Tickets are on sale now')).toBe('paid');
    // "$0" is a way of saying free, not a price.
    expect(detectAdmission('Tickets: $0 — free event')).toBe('free');
  });

  it('scans every text it is given, in one pass', () => {
    expect(detectAdmission('Movie Monday', '', 'Free admission for all ages')).toBe('free');
  });
});

describe('firstKnown', () => {
  it('prefers the first reading that committed to something', () => {
    expect(firstKnown('unknown', 'free')).toBe('free');
    expect(firstKnown('paid', 'free')).toBe('paid');
    expect(firstKnown('unknown', 'unknown')).toBe('unknown');
  });
});

describe('textOf', () => {
  it('reduces event markup to the prose inside it', () => {
    const html = '<div><!-- hidden --><h2>A Minecraft Movie</h2><p>Free&nbsp;admission</p></div>';
    expect(textOf(html)).toBe('A Minecraft Movie Free admission');
  });
});
