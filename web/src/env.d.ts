/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Cloudflare Turnstile site key; the signup form skips the widget without it. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface Window {
  turnstile?: {
    render: (
      element: HTMLElement,
      options: {
        sitekey: string;
        action: string;
        callback: (token: string) => void;
        'expired-callback': () => void;
      },
    ) => string;
    reset: (widgetId: string) => void;
  };
  /** Callback name handed to the Turnstile script tag. */
  onTurnstileLoad?: () => void;
}
