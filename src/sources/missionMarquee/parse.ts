import { textOf } from '../../core/admission.js';
import type { IsoDate } from '../../core/types.js';

export interface MarqueeEvent {
  readonly title: string;
  readonly url: string;
  readonly date: IsoDate;
  readonly time: string;
  /** The card's copy as prose, which is where admission is stated. */
  readonly description: string;
}

const ARTICLE = /<article class="edn_article[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
const TITLE = /<h2 class="edn_articleTitle"[^>]*>(?:<!--[\s\S]*?-->)?\s*([^<]+?)\s*(?:<!--[\s\S]*?-->)?\s*<\/h2>/i;
const TIME = /<time>([^<]+)<\/time>/i;
const EVENT_LINK =
  /href="(https:\/\/www\.missionmarquee\.com\/EVENTS\/Outdoor-Family-Film-Series\/ArtMID\/\d+\/ArticleID\/\d+\/[^"]+)"/i;

const PLACEHOLDER =
  /^(special feature\s+to be announced|special feature|tbd|tba|to be announced)$/i;

/** `8/15/2026 7:00 PM - 10:30 PM` -> date and a `"7:00p"`-style time. */
export function parseMarqueeDateTime(text: string): { date: IsoDate; time: string } | null {
  const match =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP])M/i.exec(text.trim());
  if (!match) return null;
  const month = match[1]?.padStart(2, '0') ?? '';
  const day = match[2]?.padStart(2, '0') ?? '';
  const year = match[3] ?? '';
  const hour = Number(match[4]);
  const minute = match[5] ?? '00';
  const half = (match[6] ?? 'P').toLowerCase();
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return {
    date: `${year}-${month}-${day}`,
    time: `${String(displayHour)}:${minute}${half}`,
  };
}

/**
 * Read the Outdoor Family Film Series off Mission Marquee's events page.
 *
 * EasyDNNNews renders the full season in one HTML response; an RSS export of
 * the same module drops entries and shifts dates, so the page is the source.
 */
export function parseMarqueeEvents(html: string): MarqueeEvent[] {
  const out: MarqueeEvent[] = [];
  for (const block of html.matchAll(ARTICLE)) {
    const article = block[1] ?? '';
    const titleMatch = TITLE.exec(article);
    const timeMatch = TIME.exec(article);
    const linkMatch = EVENT_LINK.exec(article);
    if (!titleMatch || !timeMatch || !linkMatch) continue;

    const title = titleMatch[1]?.trim() ?? '';
    const when = parseMarqueeDateTime(timeMatch[1] ?? '');
    if (!title || !when) continue;

    out.push({
      title,
      url: linkMatch[1] ?? '',
      date: when.date,
      time: when.time,
      description: textOf(article),
    });
  }
  return out;
}

/** TBA placeholders name no film and are skipped like Slab's outdoor series. */
export function filmFromMarqueeTitle(title: string): string | null {
  const film = title.trim();
  if (!film || PLACEHOLDER.test(film)) return null;
  return film;
}
