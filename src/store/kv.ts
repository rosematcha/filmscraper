/**
 * The storage seam for the subscriber list.
 *
 * Everything above this interface is testable without Netlify, and swapping
 * Blobs for a real database later means one new implementation of these four
 * methods, not a rewrite of the service.
 */
export interface KeyValue {
  get(key: string): Promise<string | null>;
  getVersioned(key: string): Promise<{ value: string; etag: string } | null>;
  set(key: string, value: string): Promise<void>;
  create(key: string, value: string): Promise<{ modified: boolean; etag?: string }>;
  update(key: string, value: string, etag: string): Promise<{ modified: boolean; etag?: string }>;
  delete(key: string): Promise<void>;
  /** Every key under a prefix; the list is small enough to hold whole. */
  list(prefix: string): Promise<string[]>;
}

/** In-memory store for tests. */
export function memoryKv(): KeyValue {
  const entries = new Map<string, { value: string; version: number }>();
  let version = 0;
  const write = (key: string, value: string): string => {
    const next = ++version;
    entries.set(key, { value, version: next });
    return String(next);
  };
  return {
    get: (key) => Promise.resolve(entries.get(key)?.value ?? null),
    getVersioned: (key) => {
      const entry = entries.get(key);
      return Promise.resolve(entry ? { value: entry.value, etag: String(entry.version) } : null);
    },
    set: (key, value) => {
      write(key, value);
      return Promise.resolve();
    },
    create: (key, value) => {
      if (entries.has(key)) return Promise.resolve({ modified: false });
      return Promise.resolve({ modified: true, etag: write(key, value) });
    },
    update: (key, value, etag) => {
      if (String(entries.get(key)?.version) !== etag) {
        return Promise.resolve({ modified: false });
      }
      return Promise.resolve({ modified: true, etag: write(key, value) });
    },
    delete: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
    list: (prefix) => Promise.resolve([...entries.keys()].filter((key) => key.startsWith(prefix))),
  };
}
