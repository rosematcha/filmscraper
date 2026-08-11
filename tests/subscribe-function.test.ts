import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import subscribeHandler, { config } from '../netlify/functions/subscribe.js';

beforeEach(() => {
  // Signup only answers on the dev server, so every case past the gate has to
  // stand where `netlify dev` stands.
  vi.stubEnv('NETLIFY_DEV', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const request = (body: object): Request =>
  new Request('https://films.example/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('subscribe function verification', () => {
  it('fails closed when Turnstile configuration is missing', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    vi.stubEnv('TURNSTILE_EXPECTED_HOSTNAME', '');
    expect((await subscribeHandler(request({ email: 'a@example.com' }))).status).toBe(503);
  });

  it('rejects a missing token before touching subscriber storage', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret');
    vi.stubEnv('TURNSTILE_EXPECTED_HOSTNAME', 'films.example');
    expect((await subscribeHandler(request({ email: 'a@example.com' }))).status).toBe(400);
  });

  it('rejects a verification issued for the wrong action', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret');
    vi.stubEnv('TURNSTILE_EXPECTED_HOSTNAME', 'films.example');
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ success: true, action: 'login', hostname: 'films.example' }),
        ),
    );
    expect(
      (await subscribeHandler(request({ email: 'a@example.com', turnstileToken: 'token' }))).status,
    ).toBe(400);
  });

  it('treats verification network failures as unavailable', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret');
    vi.stubEnv('TURNSTILE_EXPECTED_HOSTNAME', 'films.example');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')));
    expect(
      (await subscribeHandler(request({ email: 'a@example.com', turnstileToken: 'token' }))).status,
    ).toBe(503);
  });

  it('refuses signups anywhere but the dev server', async () => {
    // The deployed site has no Turnstile or mailer keys, so an accepted signup
    // would promise an email nothing can send.
    vi.stubEnv('NETLIFY_DEV', '');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret');
    vi.stubEnv('TURNSTILE_EXPECTED_HOSTNAME', 'films.example');
    const response = await subscribeHandler(request({ email: 'a@example.com' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Signup is not available right now.',
    });
  });

  it('declares an IP rate limit', () => {
    expect(config.rateLimit).toEqual({
      windowLimit: 10,
      windowSize: 60,
      aggregateBy: ['ip'],
    });
  });
});
