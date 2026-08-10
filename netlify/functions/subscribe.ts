import { blobsKv } from '../../src/subscribers/blobs.js';
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
async function passesTurnstile(token: unknown, remoteIp: string | null): Promise<boolean> {
  const secret = process.env['TURNSTILE_SECRET_KEY'];
  if (secret === undefined || secret === '') return true;
  if (typeof token !== 'string' || token === '') return false;
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp !== null) body.set('remoteip', remoteIp);
  const response = await fetch(TURNSTILE_VERIFY, { method: 'POST', body });
  if (!response.ok) return false;
  const result: unknown = await response.json();
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as Record<string, unknown>)['success'] === true
  );
}

export default async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return json(405, { ok: false, error: 'POST only' });

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

  // The client IP goes to Turnstile for verification and is not stored or
  // logged; the subscriber record never holds it.
  const remoteIp = request.headers.get('x-nf-client-connection-ip');
  if (!(await passesTurnstile(fields['turnstileToken'], remoteIp))) {
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
    store: new SubscriberStore(blobsKv()),
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

export const config = { path: '/api/subscribe' };
