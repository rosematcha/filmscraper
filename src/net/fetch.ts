const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface FetchPolicy {
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly retryDelayMs?: number;
  /** Test seam; production uses the platform fetch. */
  readonly fetch?: typeof fetch;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Fetch with a deadline and conservative retries for idempotent requests.
 *
 * POST is never retried implicitly: repeating a mail send can duplicate it.
 */
export async function fetchWithPolicy(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  policy: FetchPolicy = {},
): Promise<Response> {
  const fetcher = policy.fetch ?? fetch;
  const method = (init.method ?? 'GET').toUpperCase();
  const idempotent = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  const retries = policy.retries ?? (idempotent ? 2 : 0);
  const timeoutMs = policy.timeoutMs ?? 15_000;
  const retryDelayMs = policy.retryDelayMs ?? 250;

  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const response = await fetcher(input, { ...init, signal });
      if (attempt < retries && RETRYABLE_STATUS.has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
      } else {
        // `fetch()` resolves after headers. Consume one branch before returning
        // so the same deadline also covers a server that stalls mid-body.
        if (
          method === 'HEAD' ||
          response.body === null ||
          [204, 205, 304].includes(response.status)
        ) {
          return response;
        }
        const buffered = response.clone();
        await response.arrayBuffer();
        return buffered;
      }
    } catch (error) {
      if (attempt >= retries || init.signal?.aborted === true) throw error;
    }
    await delay(retryDelayMs * 2 ** attempt);
  }
}
