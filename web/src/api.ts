export interface ScrapeParams {
  zip: string;
  from: string;
  to: string;
  radius: number;
  keepYears: boolean;
  showAccessibility: boolean;
  showLanguage: boolean;
}

export interface ResultRow {
  title: string;
  url: string;
  notes: string;
  theaterCount: number;
  dateCount: number;
  isEvent: boolean;
}

export interface TheaterInfo {
  name: string;
  href: string;
  miles: number;
}

export interface ScrapeWarning {
  kind: string;
  message: string;
}

export interface ScrapeResponse {
  dates: string[];
  theaters: TheaterInfo[];
  warnings: ScrapeWarning[];
  rows: ResultRow[];
  markdown: string;
}

export interface ScrapeHandlers {
  onProgress: (message: string) => void;
  onResult: (result: ScrapeResponse) => void;
  onError: (message: string) => void;
}

/**
 * Consume the server's SSE stream.
 *
 * EventSource cannot POST, so the stream is read off `fetch` directly and the
 * `event:`/`data:` frames are split by hand.
 */
export async function scrape(
  params: ScrapeParams,
  handlers: ScrapeHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String(body.error)
        : `Request failed (${String(response.status)})`;
    handlers.onError(message);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    handlers.onError('No response stream');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split = buffer.indexOf('\n\n');
    while (split !== -1) {
      dispatch(buffer.slice(0, split), handlers);
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf('\n\n');
    }
  }
}

function dispatch(frame: string, handlers: ScrapeHandlers): void {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (data.length === 0) return;

  let payload: unknown;
  try {
    payload = JSON.parse(data.join('\n'));
  } catch {
    return;
  }

  if (event === 'progress' && isMessage(payload)) handlers.onProgress(payload.message);
  else if (event === 'failed' && isMessage(payload)) handlers.onError(payload.message);
  else if (event === 'result') handlers.onResult(payload as ScrapeResponse);
}

function isMessage(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  );
}
