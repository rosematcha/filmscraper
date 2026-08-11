import type { PostingSnapshot } from '../core/posting.js';
import { blobsKv } from './blobs.js';
import type { KeyValue } from './kv.js';

/**
 * The posting-depth backlog.
 *
 * Internal only: it never reaches the published dataset, because it answers
 * operator questions ("has Fandango stopped posting a week out?") rather than
 * reader ones. One blob per run, keyed by timestamp, so concurrent runs cannot
 * clobber each other the way a single appended file would.
 */
const STORE = 'posting-history';
const PREFIX = 'snapshot/';

export function historyKv(): KeyValue {
  return blobsKv(STORE);
}

function isSnapshot(value: unknown): value is PostingSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['today'] === 'string' && Array.isArray(record['sources']);
}

/** Keep one run's snapshot. `runAt` supplies the key, so it must be unique per run. */
export async function recordSnapshot(
  kv: KeyValue,
  snapshot: PostingSnapshot,
  runAt: string,
): Promise<void> {
  await kv.set(`${PREFIX}${runAt}`, JSON.stringify({ ...snapshot, runAt }));
}

/** Every snapshot kept, oldest first. The backlog is one small blob per run. */
export async function readHistory(kv: KeyValue): Promise<PostingSnapshot[]> {
  const keys = (await kv.list(PREFIX)).sort();
  const out: PostingSnapshot[] = [];
  for (const key of keys) {
    const raw = await kv.get(key);
    if (raw === null) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isSnapshot(parsed)) out.push(parsed);
    } catch {
      // A truncated write is not worth failing a scrape over.
    }
  }
  return out;
}
