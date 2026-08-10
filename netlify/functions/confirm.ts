import { blobsKv } from '../../src/subscribers/blobs.js';
import { actionPage, messagePage } from '../../src/subscribers/html.js';
import { confirm, type ServiceDeps } from '../../src/subscribers/service.js';
import { SubscriberStore } from '../../src/subscribers/store.js';

function html(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/** Mailer-free: confirming sends nothing. */
function deps(): ServiceDeps {
  return {
    store: new SubscriberStore(blobsKv()),
    mailer: {
      send: () => Promise.reject(new Error('confirm sends no email')),
    },
    siteUrl: process.env['URL'] ?? '',
  };
}

async function tokenFrom(request: Request): Promise<string> {
  const fromQuery = new URL(request.url).searchParams.get('token');
  if (request.method === 'GET') return fromQuery ?? '';
  // The button posts application/x-www-form-urlencoded, which URLSearchParams
  // parses without touching the deprecated formData().
  try {
    const fromForm = new URLSearchParams(await request.text()).get('token');
    if (fromForm !== null && fromForm !== '') return fromForm;
  } catch {
    // Fall through to the query token.
  }
  return fromQuery ?? '';
}

export default async (request: Request): Promise<Response> => {
  const token = await tokenFrom(request);
  if (token === '') return html(404, messagePage('Not found', 'This link is incomplete.'));

  // The GET only shows a button. A mail scanner prefetching this URL must not
  // confirm anyone; the POST from the button is what commits.
  if (request.method === 'GET') {
    return html(
      200,
      actionPage({
        title: 'Weekly movie listings',
        text: 'Press the button to start the subscription.',
        button: 'Confirm',
        token,
      }),
    );
  }

  if (request.method !== 'POST') {
    return html(405, messagePage('Not allowed', 'Use the link from the email.'));
  }

  const confirmed = await confirm(deps(), token);
  return confirmed
    ? html(
        200,
        messagePage(
          'Confirmed',
          'The listings arrive once a week. Every one carries an unsubscribe link that also deletes your data.',
        ),
      )
    : html(
        410,
        messagePage(
          'Link expired',
          'This link was already used or has been replaced. If you still want the listings, sign up again and a fresh link will arrive.',
        ),
      );
};

export const config = { path: '/api/confirm' };
