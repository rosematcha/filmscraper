export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * The provider seam. Resend today; the planned swap to SES at around a
 * hundred subscribers is a second implementation of this one method.
 */
export interface Mailer {
  send(email: OutboundEmail): Promise<void>;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function resendMailer(options: { apiKey: string; from: string }): Mailer {
  return {
    async send(email) {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(email.headers ? { headers: email.headers } : {}),
        }),
      });
      // The status is enough to debug with; the address stays out of every
      // error message because thrown errors end up in function and CI logs.
      if (!response.ok) throw new Error(`resend responded ${response.status}`);
    },
  };
}
