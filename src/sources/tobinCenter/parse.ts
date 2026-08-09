import type { IsoDate } from '../../core/types.js';

export interface TobinCinemaEvent {
  readonly title: string;
  readonly url: string;
  readonly date: IsoDate;
  readonly venueName: string;
}

const CINEMA_ROW =
  /<div class="views-field views-field-title"><span class="field-content"><a href="([^"]+)"[^>]*>([^<]+)<\/a><\/span><\/div><div class="views-field views-field-nothing"><span class="field-content">\s*([^<]+?)\s*<\/span><\/div><div class="views-field views-field-field-show-venue"><div class="field-content">([^<]+)<\/div>/gi;

const SERIES_MARKER = ' | H-E-B Cinema';

const PLACEHOLDER =
  /^(special feature\s+to be announced|special feature|tbd|tba|to be announced)$/i;

const MONTHS: Readonly<Record<string, string>> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/** `Sep 12, 2026` -> `2026-09-12`. */
export function parseTobinDate(text: string): IsoDate | null {
  const match = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const month = MONTHS[match[1]?.slice(0, 3).toLowerCase() ?? ''];
  const day = match[2]?.padStart(2, '0') ?? '';
  const year = match[3] ?? '';
  if (!month || !day || !year) return null;
  return `${year}-${month}-${day}`;
}

function absoluteUrl(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  return `https://www.tobincenter.org${href.startsWith('/') ? href : `/${href}`}`;
}

/**
 * Read H-E-B Cinema on Will's Plaza off the Tobin Center cinema page.
 *
 * Drupal renders the season as a views listing; each row names the film, date,
 * and plaza venue without needing a separate events API.
 */
export function parseTobinCinemaEvents(html: string): TobinCinemaEvent[] {
  const out: TobinCinemaEvent[] = [];
  for (const match of html.matchAll(CINEMA_ROW)) {
    const href = match[1] ?? '';
    const title = match[2]?.trim() ?? '';
    const date = parseTobinDate(match[3] ?? '');
    const venueName = match[4]?.trim() ?? '';
    if (!href || !title || !date || !venueName) continue;
    out.push({
      title,
      url: absoluteUrl(href),
      date,
      venueName,
    });
  }
  return out;
}

/** Strip the series suffix and skip placeholders that name no film. */
export function filmFromTobinTitle(title: string): string | null {
  const pipe = title.indexOf(SERIES_MARKER);
  const film = (pipe >= 0 ? title.slice(0, pipe) : title).trim();
  if (!film || PLACEHOLDER.test(film)) return null;
  return film;
}
