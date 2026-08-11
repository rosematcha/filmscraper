import { blobsKv } from '../../src/store/blobs.js';
import { fetchWithPolicy } from '../../src/net/fetch.js';
import { resendMailer } from '../../src/subscribers/mailer.js';
import { subscribe, type ServiceDeps } from '../../src/subscribers/service.js';
import { SubscriberStore } from '../../src/subscribers/store.js';

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * The human check, when a Turnstile secret is configured. Without one the
 * endpoint still stands — the per-address cooldown in the service is the
 * backstop — but the secret should be set anywhere real.
 */
async function passesTurnstile(
  secret: string,
  expectedHostname: string,
  token: unknown,
  remoteIp: string | null,
): Promise<'passed' | 'rejected' | 'unavailable'> {
  if (typeof token !== 'string' || token === '' || token.length > 2048) return 'rejected';
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp !== null) body.set('remoteip', remoteIp);
  try {
    const response = await fetchWithPolicy(
      TURNSTILE_VERIFY,
      { method: 'POST', body },
      { timeoutMs: 5_000 },
    );
    if (!response.ok) return 'unavailable';
    const result: unknown = await response.json();
    if (typeof result !== 'object' || result === null) return 'unavailable';
    const record = result as Record<string, unknown>;
    return record['success'] === true &&
      record['action'] === 'subscribe' &&
      record['hostname'] === expectedHostname
      ? 'passed'
      : 'rejected';
  } catch {
    return 'unavailable';
  }
}

/**
 * Signup is open on the local dev server and nowhere else, matching the form
 * the site only renders there.
 *
 * `netlify dev` sets NETLIFY_DEV; no deployed context does. Confirm and
 * unsubscribe stay open everywhere on purpose — a link already sitting in
 * someone's inbox has to keep working, and refusing to unsubscribe a person is
 * the one failure this list must never have.
 */
function localOnly(): boolean {
  return process.env['NETLIFY_DEV'] === 'true';
}

export default async (request: Request): Promise<Response> => {
  if (!localOnly()) {
    return json(503, { ok: false, error: 'Signup is not available right now.' });
  }
  if (request.method !== 'POST') return json(405, { ok: false, error: 'POST only' });
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 10_000) {
    return json(413, { ok: false, error: 'Request is too large.' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, error: 'Malformed request.' });
  }
  if (typeof body !== 'object' || body === null) {
    return json(400, { ok: false, error: 'Malformed request.' });
  }
  const fields = body as Record<string, unknown>;

  const turnstileSecret = process.env['TURNSTILE_SECRET_KEY'];
  const expectedHostname = process.env['TURNSTILE_EXPECTED_HOSTNAME'];
  if (
    turnstileSecret === undefined ||
    turnstileSecret === '' ||
    expectedHostname === undefined ||
    expectedHostname === ''
  ) {
    console.error('subscribe: Turnstile configuration is incomplete');
    return json(503, { ok: false, error: 'Signup is not available right now.' });
  }

  // The client IP goes to Turnstile for verification and is not stored or
  // logged; the subscriber record never holds it.
  const remoteIp = request.headers.get('x-nf-client-connection-ip');
  const verification = await passesTurnstile(
    turnstileSecret,
    expectedHostname,
    fields['turnstileToken'],
    remoteIp,
  );
  if (verification === 'unavailable') {
    return json(503, { ok: false, error: 'Verification is unavailable. Try again later.' });
  }
  if (verification === 'rejected') {
    return json(400, { ok: false, error: 'Verification failed. Reload and try again.' });
  }

  const apiKey = process.env['RESEND_API_KEY'];
  const from = process.env['EMAIL_FROM'];
  const siteUrl = process.env['URL'] ?? new URL(request.url).origin;
  if (apiKey === undefined || from === undefined) {
    console.error('subscribe: RESEND_API_KEY or EMAIL_FROM is not set');
    return json(500, { ok: false, error: 'Signup is not available right now.' });
  }

  const deps: ServiceDeps = {
    store: new SubscriberStore(blobsKv('subscribers')),
    mailer: resendMailer({ apiKey, from }),
    siteUrl,
  };

  try {
    const result = await subscribe(deps, {
      email: typeof fields['email'] === 'string' ? fields['email'] : '',
      firstName: typeof fields['firstName'] === 'string' ? fields['firstName'] : undefined,
      tables: Array.isArray(fields['tables'])
        ? fields['tables'].filter((id): id is string => typeof id === 'string')
        : undefined,
    });
    if (result === 'invalid-email') {
      return json(400, { ok: false, error: 'That does not look like an email address.' });
    }
    // One answer whatever the store held before: the response must not reveal
    // whether an address is already on the list.
    return json(200, { ok: true });
  } catch (cause) {
    // The address must stay out of the log; the cause of a mailer failure is
    // a status code and carries none.
    console.error('subscribe failed:', cause instanceof Error ? cause.message : 'unknown');
    return json(500, { ok: false, error: 'Something failed on our end. Try again later.' });
  }
};

export const config = {
  path: '/api/subscribe',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip'] },
};
