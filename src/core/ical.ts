export interface IcalEvent {
  readonly summary: string;
  readonly url: string;
  readonly location: string;
  /** Free-text body, where a feed says what a screening costs. */
  readonly description: string;
  /** Raw `DTSTART` value, e.g. `20260803T204000`. */
  readonly start: string;
  /** IANA zone from `TZID`, when the feed supplies one. */
  readonly timeZone: string | null;
}

/** RFC 5545 folds long lines by starting continuations with a space or tab. */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

/** `\,` `\;` `\n` escapes defined by RFC 5545. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

/**
 * Minimal VEVENT reader.
 *
 * Only the handful of properties this project needs, which is far less code
 * than a general iCalendar library and has no dependency to keep current.
 */
export function parseIcal(text: string): IcalEvent[] {
  const events: IcalEvent[] = [];
  let current: Record<string, string> | null = null;
  let currentTz: string | null = null;

  for (const line of unfold(text)) {
    if (line.startsWith('BEGIN:VEVENT')) {
      current = {};
      currentTz = null;
      continue;
    }
    if (line.startsWith('END:VEVENT')) {
      if (current?.['DTSTART']) {
        events.push({
          summary: unescapeText(current['SUMMARY'] ?? ''),
          url: current['URL'] ?? '',
          location: unescapeText(current['LOCATION'] ?? ''),
          description: unescapeText(current['DESCRIPTION'] ?? ''),
          start: current['DTSTART'],
          timeZone: currentTz,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const rawName = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name = ''] = rawName.split(';');
    if (name === 'DTSTART') {
      currentTz = /TZID=([^;:]+)/.exec(rawName)?.[1] ?? null;
    }
    current[name] = value;
  }
  return events;
}

/**
 * Calendar date of a `DTSTART`.
 *
 * Floating and zoned values are already local to the venue, so the date is read
 * off the literal rather than converted; only a `Z` value is a real instant.
 */
export function icalDate(start: string, fallbackZone: string): string | null {
  // Times carry seconds (`20260803T204000`), so the tail must be optional and
  // greedy rather than a fixed four digits.
  const local = /^(\d{4})(\d{2})(\d{2})(?:T\d{2}\d{2}\d{2}?)?$/.exec(start);
  if (local) return `${local[1] ?? ''}-${local[2] ?? ''}-${local[3] ?? ''}`;

  const utc = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(start);
  if (!utc) return null;
  const instant = new Date(
    Date.UTC(
      Number(utc[1]),
      Number(utc[2]) - 1,
      Number(utc[3]),
      Number(utc[4]),
      Number(utc[5]),
      Number(utc[6]),
    ),
  );
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fallbackZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** `20260803T204000` -> `"8:40p"`. */
export function icalTime(start: string): string | null {
  const match = /T(\d{2})(\d{2})/.exec(start);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ?? '00';
  const half = hour >= 12 ? 'p' : 'a';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(display)}:${minute}${half}`;
}
