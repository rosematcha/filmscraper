import { escapeHtml } from './html.js';
import type { OutboundEmail } from './mailer.js';

/**
 * The double-opt-in email. The first name is subscriber-supplied text and is
 * escaped like any other untrusted input; unescaped it would let a "name"
 * carry markup into mail sent from our domain.
 */
export function confirmationEmail(options: {
  to: string;
  firstName?: string | undefined;
  confirmUrl: string;
}): OutboundEmail {
  const greeting = options.firstName ? `Hi ${options.firstName},` : 'Hi,';
  const text = `${greeting}

Someone asked to get the weekly San Antonio movie listings at this address. If that was you, confirm here:

${options.confirmUrl}

If it was not you, ignore this email. An unconfirmed address gets nothing further, and the unsubscribe link in any listing email deletes the address outright.`;

  const html = `<p>${escapeHtml(greeting)}</p>
<p>Someone asked to get the weekly San Antonio movie listings at this address. If that was you, confirm here:</p>
<p><a href="${escapeHtml(options.confirmUrl)}">Confirm subscription</a></p>
<p>If it was not you, ignore this email. An unconfirmed address gets nothing further, and the unsubscribe link in any listing email deletes the address outright.</p>`;

  return {
    to: options.to,
    subject: 'Confirm: weekly San Antonio movie listings',
    text,
    html,
  };
}
