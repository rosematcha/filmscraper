import { blobsKv } from '../../src/subscribers/blobs.js';
import { actionPage, messagePage } from '../../src/subscribers/html.js';
import { unsubscribe, type ServiceDeps } from '../../src/subscribers/service.js';
import { SubscriberStore } from '../../src/subscribers/store.js';

function html(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function deps(): ServiceDeps {
  return {
    store: new SubscriberStore(blobsKv()),
    mailer: {
      send: () => Promise.reject(new Error('unsubscribe sends no email')),
    },
    siteUrl: process.env['URL'] ?? '',
  };
}

/**
 * The POST accepts the token from the form or from the query string: the
 * in-page button submits a form, while Gmail's one-click unsubscribe
 * (List-Unsubscribe-Post) POSTs straight to the List-Unsubscribe URL, where
 * the token rides in the query.
 */
async function tokenFrom(request: Request): Promise<string> {
  const fromQuery = new URL(request.url).searchParams.get('token');
  if (request.method === 'GET') return fromQuery ?? '';
  // Both the button and a one-click POST arrive urlencoded; URLSearchParams
  // parses either without touching the deprecated formData().
  try {
    const fromForm = new URLSearchParams(await request.text()).get('token');
    if (fromForm !== null && fromForm !== '') return fromForm;
  } catch {
    // A one-click POST with no readable body still has the query token.
  }
  return fromQuery ?? '';
}

export default async (request: Request): Promise<Response> => {
  const token = await tokenFrom(request);
  if (token === '') return html(404, messagePage('Not found', 'This link is incomplete.'));

  // GET renders, POST deletes. A prefetching mail scanner must never be able
  // to remove a subscriber.
  if (request.method === 'GET') {
    return html(
      200,
      actionPage({
        title: 'Unsubscribe',
        text: 'This stops the weekly listings and deletes everything held about you: address, name and table choices. Nothing is kept.',
        button: 'Unsubscribe and delete my data',
        token,
      }),
    );
  }

  if (request.method !== 'POST') {
    return html(405, messagePage('Not allowed', 'Use the link from the email.'));
  }

  const removed = await unsubscribe(deps(), token);
  return removed
    ? html(200, messagePage('Done', 'You are unsubscribed and your data is deleted.'))
    : html(
        410,
        messagePage(
          'Link expired',
          'This link no longer matches a subscription. If you were on the list, you are not any more.',
        ),
      );
};

export const config = { path: '/api/unsubscribe' };
