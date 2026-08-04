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

/** Browser-shaped request headers, with `Accept` set to whatever is being asked for. */
export function browserHeaders(accept = 'text/html,application/xhtml+xml,*/*;q=0.8'): Record<string, string> {
  return {
    'User-Agent': BROWSER_USER_AGENT,
    Accept: accept,
    'Accept-Language': 'en-US,en;q=0.9',
  };
}
