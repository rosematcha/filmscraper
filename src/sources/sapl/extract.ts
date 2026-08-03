/** Events that revolve around a film without screening it. */
const NON_SCREENING =
  /\b(trivia|quiz|bingo|book\s*club|craft|crafts|discussion|karaoke|cosplay|costume\s+contest|paint(ing)?|escape\s+room|scavenger\s+hunt|read[- ]?along|story\s*time|workshop|panel)\b/i;

/** Series names that precede the film rather than naming one. */
const SERIES_PREFIX =
  /^(movie\s+monday|movie\s+matinee|matinee\s+movie|family\s+film|film\s+friday|first\s+friday\s+film|gen\s*x\s+nostalgia\s+night|anime\s+club|movie\s+night|teen\s+movie|senior\s+movie|classic\s+film|cult\s+classics?|dive[- ]in\s+movie)\b/i;

/** Titles that name a programme, never a particular picture. */
const PROGRAMME_ONLY =
  /^(first\s+friday\s+film!?|movie\s+night|family\s+film|film\s+screening|movie\s+matinee|geeks\s+assemble!?|monster\s+meet|movie\s+day|afternoon\s+movie|free\s+movie)$/i;

/** MPAA rating that trails a lineup entry, e.g. `The Rescuers Down Under (G)`. */
const TRAILING_RATING = /\s*\((?:G|PG|PG-13|R|NC-17|NR|TV-[A-Z0-9]+)\)\s*$/i;

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** How far a lineup entry's date may sit from the event's own date. */
const LINEUP_TOLERANCE_DAYS = 3;

export interface SaplEvent {
  readonly title: string;
  readonly description: string;
  /** The `Additional Info` custom field, which often holds a series lineup. */
  readonly additionalInfo: string;
  /** Event date, `YYYY-MM-DD`. */
  readonly date: string;
}

export function isCancelled(title: string): boolean {
  return /^\s*cancell?ed\b/i.test(title);
}

function cleanFilm(candidate: string): string | null {
  const film = candidate.replace(TRAILING_RATING, '').replace(/\s+/g, ' ').trim().replace(/[!.]+$/, '');
  if (film.length < 2) return null;
  if (PROGRAMME_ONLY.test(film) || SERIES_PREFIX.test(film)) return null;
  if (NON_SCREENING.test(film)) return null;
  return film;
}

/**
 * A film named in a series lineup, matched to the event's own date.
 *
 * `The lineup:•June 5 – Chicken Little (G)•July 3 – Matilda (PG)•August 6 – The
 * Rescuers Down Under (G)` — the branch's own dates drift a day from the event
 * record, so the nearest entry wins rather than an exact match.
 */
export function filmFromLineup(additionalInfo: string, date: string): string | null {
  if (!additionalInfo) return null;
  const eventTime = new Date(`${date}T12:00:00Z`).getTime();
  if (Number.isNaN(eventTime)) return null;
  const year = Number(date.slice(0, 4));

  let best: { film: string; distance: number } | null = null;
  // The film runs until the next dated entry begins. Without that lookahead a
  // bullet-free lineup collapses into one match that swallows the whole list.
  const entry = new RegExp(
    String.raw`(${MONTHS.join('|')})\s+(\d{1,2})\s*[–—:-]+\s*(.+?)` +
      String.raw`(?=\s*[•|\n\r]|\s+(?:${MONTHS.join('|')})\s+\d{1,2}\s*[–—:-]|$)`,
    'gi',
  );
  for (const match of additionalInfo.matchAll(entry)) {
    const month = MONTHS.indexOf((match[1] ?? '').toLowerCase());
    const day = Number(match[2]);
    const film = cleanFilm(match[3] ?? '');
    if (month < 0 || !Number.isFinite(day) || !film) continue;
    const entryTime = Date.UTC(year, month, day, 12);
    const distance = Math.abs(entryTime - eventTime) / 86_400_000;
    if (distance > LINEUP_TOLERANCE_DAYS) continue;
    if (!best || distance < best.distance) best = { film, distance };
  }
  return best?.film ?? null;
}

/**
 * The film a library event screens, or null when it does not clearly screen one.
 *
 * Deliberately conservative: a movie-themed trivia night, or a recurring series
 * that never names its picture, is dropped rather than guessed at.
 */
export function filmFromSaplEvent(event: SaplEvent): string | null {
  if (isCancelled(event.title)) return null;

  const title = event.title.replace(/\s+/g, ' ').trim();
  // Themed-but-not-a-screening events are excluded even when a film is named.
  if (NON_SCREENING.test(title)) return null;

  // "Movie Monday: Fall (2022)" — the film follows the series name.
  const colon = title.indexOf(':');
  if (colon > 0) {
    const head = title.slice(0, colon).trim();
    const tail = title.slice(colon + 1).trim();
    if (SERIES_PREFIX.test(head) || /movie|film|cinema|screening|night/i.test(head)) {
      const film = cleanFilm(tail);
      if (film) return film;
    }
  }

  // A recurring series that names its film only in the lineup field.
  const fromLineup = filmFromLineup(event.additionalInfo, event.date);
  if (fromLineup) return fromLineup;

  // A bare title that is itself a film, e.g. "The Rescuers Down Under".
  if (!PROGRAMME_ONLY.test(title) && !SERIES_PREFIX.test(title) && colon === -1) {
    const film = cleanFilm(title);
    // Guard against generic one-liners: require the description to mention a
    // screening, so "Summer Reading Kickoff" cannot slip through.
    if (film && /\b(screening|watch|showing|film|movie)\b/i.test(event.description)) {
      return film;
    }
  }

  return null;
}
