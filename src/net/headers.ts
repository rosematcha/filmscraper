/**
 * The identity every plain-HTTP fetch goes out with.
 *
 * Several of these sites sit behind Cloudflare, which blocks unrecognized user
 * agents coming from datacenter ranges — so a request that works from a laptop
 * gets a 403 on a CI runner. Sending a real browser's headers is what keeps the
 * scheduled scrape working.
 */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Who the scraper says it is when a site refuses the browser agent.
 *
 * The McNay's WAF answers any Chrome user agent with a 403, so pretending to be
 * one is not an option there; an honest, contactable agent is served normally.
 */
export const SCRAPER_USER_AGENT = 'filmscraper/0.1 (https://github.com/rosematcha/filmscraper)';

/** Browser-shaped request headers, with `Accept` set to whatever is being asked for. */
export function browserHeaders(
  accept = 'text/html,application/xhtml+xml,*/*;q=0.8',
  userAgent = BROWSER_USER_AGENT,
): Record<string, string> {
  return {
    'User-Agent': userAgent,
    Accept: accept,
    'Accept-Language': 'en-US,en;q=0.9',
  };
}
