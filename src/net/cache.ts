import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(here, '../../.cache');

interface Entry<T> {
  readonly savedAt: number;
  readonly value: T;
}

/**
 * Tiny on-disk cache for facts that do not change.
 *
 * Theater coordinates and ZIP centroids are stable, so re-fetching them on
 * every run is pure waste — and pure load on someone else's servers.
 */
export class DiskCache {
  constructor(private readonly namespace: string) {}

  private path(key: string): string {
    const digest = createHash('sha256').update(key).digest('hex').slice(0, 32);
    return join(CACHE_DIR, this.namespace, `${digest}.json`);
  }

  private async read(key: string, maxAgeMs: number): Promise<{ value: unknown } | null> {
    try {
      const raw = await readFile(this.path(key), 'utf8');
      const entry = JSON.parse(raw) as Entry<unknown>;
      if (Date.now() - entry.savedAt > maxAgeMs) return null;
      return { value: entry.value };
    } catch {
      return null;
    }
  }

  private async write(key: string, value: unknown): Promise<void> {
    const file = this.path(key);
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify({ savedAt: Date.now(), value } satisfies Entry<unknown>),
        'utf8',
      );
    } catch {
      // A cache that cannot write is a slow cache, not a broken program.
    }
  }

  /**
   * Read through the cache, computing and storing on a miss.
   *
   * A `null` is never stored. Everything cached here — a ZIP centroid, a
   * theater's coordinates — exists; `null` means the lookup failed, and a
   * failure written to a cache that never expires drops that venue from every
   * run afterwards. Retrying costs one request against a host that answers in
   * milliseconds, so the cheap error is the one worth making.
   */
  async wrap<T>(
    key: string,
    compute: () => Promise<T | null>,
    maxAgeMs = Infinity,
  ): Promise<T | null> {
    const hit = await this.read(key, maxAgeMs);
    if (hit) return hit.value as T;
    const value = await compute();
    if (value !== null) await this.write(key, value);
    return value;
  }
}
