import { useCallback, useEffect, useRef, useState } from 'react';
import { SECTIONS } from './tables';
import { fetchWithPolicy } from '@core/net/fetch.js';

const TURNSTILE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const TURNSTILE_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';

interface Props {
  /** The visitor's current table picks, which seed what their email covers. */
  readonly defaultTables: readonly string[];
}

/**
 * Signup for the weekly email, folded away behind a disclosure like the
 * options block: the table is the product and this must not compete with it.
 */
export default function Subscribe({ defaultTables }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [tables, setTables] = useState<string[]>(() => [...defaultTables]);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const widget = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const renderedWidget = useRef(false);

  // The Turnstile script loads only if a site key is configured, and only
  // once the form is opened: a reader who never subscribes loads nothing.
  useEffect(() => {
    if (!open || TURNSTILE_KEY === undefined || renderedWidget.current) return;
    const key = TURNSTILE_KEY;
    const render = (): void => {
      if (!widget.current || !window.turnstile || renderedWidget.current) return;
      renderedWidget.current = true;
      widgetId.current = window.turnstile.render(widget.current, {
        sitekey: key,
        action: 'subscribe',
        callback: (token) => {
          setCaptcha(token);
        },
        'expired-callback': () => {
          setCaptcha(null);
        },
      });
    };
    if (window.turnstile) {
      render();
      return;
    }
    window.onTurnstileLoad = render;
    if (document.querySelector(`script[src^="${TURNSTILE_SRC}"]`) === null) {
      const script = document.createElement('script');
      script.src = TURNSTILE_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  }, [open]);

  const resetCaptcha = useCallback((): void => {
    setCaptcha(null);
    if (widgetId.current !== null) window.turnstile?.reset(widgetId.current);
  }, []);

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (state === 'sending') return;
      setState('sending');
      setError(null);
      void fetchWithPolicy('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          ...(firstName.trim() === '' ? {} : { firstName: firstName.trim() }),
          tables,
          ...(captcha === null ? {} : { turnstileToken: captcha }),
        }),
      })
        .then(async (response) => {
          if (response.ok) {
            setState('sent');
            return;
          }
          const body: unknown = await response.json().catch(() => null);
          const message =
            typeof body === 'object' &&
            body !== null &&
            typeof (body as { error?: unknown }).error === 'string'
              ? (body as { error: string }).error
              : 'Signup failed. Try again in a minute.';
          setState('idle');
          setError(message);
          resetCaptcha();
        })
        .catch(() => {
          setState('idle');
          setError('Signup failed. Try again in a minute.');
          resetCaptcha();
        });
    },
    [state, email, firstName, tables, captcha, resetCaptcha],
  );

  return (
    <section className="subscribe">
      <button
        type="button"
        className="disclosure"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {open ? 'hide email signup' : 'get this weekly by email'}
      </button>

      {open && state === 'sent' && (
        <p className="status">Check your inbox. The listings start once you confirm.</p>
      )}

      {open && state !== 'sent' && (
        <form onSubmit={submit} className="subscribe__form">
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </label>
          <label>
            First name
            <input
              type="text"
              maxLength={50}
              placeholder="optional"
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
              }}
            />
          </label>

          <div className="optgroup">
            <span className="optgroup__title">Include</span>
            <div className="optgroup__items">
              {SECTIONS.map((section) => (
                <label key={section.id} title={section.hint}>
                  <input
                    type="checkbox"
                    checked={tables.includes(section.id)}
                    onChange={(e) => {
                      setTables((prev) =>
                        e.target.checked
                          ? [...prev, section.id]
                          : prev.filter((id) => id !== section.id),
                      );
                    }}
                  />
                  {section.label}
                </label>
              ))}
            </div>
          </div>

          {TURNSTILE_KEY !== undefined && <div ref={widget} />}

          <button
            type="submit"
            disabled={state === 'sending' || (TURNSTILE_KEY !== undefined && captcha === null)}
          >
            {state === 'sending' ? 'Subscribing…' : 'Subscribe'}
          </button>

          {error !== null && <p className="status error">{error}</p>}

          <p className="subscribe__note">
            One email a week. Stored: the address, the name if you give one, and these choices. The
            unsubscribe link in every email deletes all of it. Delivery runs through Resend.
          </p>
        </form>
      )}
    </section>
  );
}
