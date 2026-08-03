import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

/** A current desktop Chrome UA; Fandango serves the mobile layout to anything else. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface BrowserOptions {
  /** Minimum gap between navigations, in ms. */
  readonly throttleMs: number;
  /** IANA zone the pages should believe they are in. */
  readonly timezone: string;
  readonly headless: boolean;
}

export const DEFAULT_BROWSER_OPTIONS: BrowserOptions = {
  throttleMs: 1500,
  timezone: 'America/Chicago',
  headless: true,
};

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private lastNavigation = 0;

  constructor(private readonly options: BrowserOptions = DEFAULT_BROWSER_OPTIONS) {}

  async open(): Promise<void> {
    this.browser = await chromium.launch({ headless: this.options.headless });
    this.context = await this.browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 1400 },
      locale: 'en-US',
      timezoneId: this.options.timezone,
    });
  }

  async newPage(): Promise<Page> {
    if (!this.context) throw new Error('BrowserSession.open() must be called first');
    return this.context.newPage();
  }

  /** Space out navigations so a run stays well under any sane rate limit. */
  async throttle(): Promise<void> {
    const wait = this.lastNavigation + this.options.throttleMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastNavigation = Date.now();
  }

  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.context = null;
    this.browser = null;
  }
}

/**
 * Navigate with retries, backing off when the site pushes back.
 *
 * A 429 or 503 means slow down rather than give up, so the delay grows with
 * each attempt instead of failing on the first refusal.
 */
export async function gotoWithRetry(
  page: Page,
  url: string,
  attempts = 3,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const status = response?.status() ?? 0;
      if (status === 429 || status >= 500) {
        throw new Error(`HTTP ${status} from ${url}`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
      }
    }
  }
  throw new Error(`failed to load ${url}: ${String(lastError)}`);
}
