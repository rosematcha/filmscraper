import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithPolicy } from '../src/net/fetch.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchWithPolicy', () => {
  it('retries transient GET responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok'));

    const response = await fetchWithPolicy(
      'https://example.test',
      {},
      {
        fetch: fetcher,
        retryDelayMs: 0,
      },
    );
    expect(await response.text()).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry POST requests', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }));
    const response = await fetchWithPolicy(
      'https://example.test',
      { method: 'POST' },
      { fetch: fetcher, retryDelayMs: 0 },
    );
    expect(response.status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns a non-retryable response immediately', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('missing', { status: 404 }));
    const response = await fetchWithPolicy('https://example.test', {}, { fetch: fetcher });
    expect(response.status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not retry a caller-aborted request', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('cancelled'));
    await expect(
      fetchWithPolicy(
        'https://example.test',
        { signal: controller.signal },
        { fetch: fetcher, retryDelayMs: 0 },
      ),
    ).rejects.toThrow('cancelled');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled request at its deadline', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('request aborted'));
        });
      });
    });
    const request = fetchWithPolicy(
      'https://example.test',
      {},
      {
        fetch: fetcher,
        timeoutMs: 10,
        retries: 0,
      },
    );
    await vi.advanceTimersByTimeAsync(10);
    await expect(request).rejects.toBeDefined();
  });
});
