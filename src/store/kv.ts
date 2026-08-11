/**
 * The storage seam for the subscriber list.
 *
 * Everything above this interface is testable without Netlify, and swapping
 * Blobs for a real database later means one new implementation of these four
 * methods, not a rewrite of the service.
 */
export interface KeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Every key under a prefix; the list is small enough to hold whole. */
  list(prefix: string): Promise<string[]>;
}

/** In-memory store for tests. */
export function memoryKv(): KeyValue {
  const entries = new Map<string, string>();
  return {
    get: (key) => Promise.resolve(entries.get(key) ?? null),
    set: (key, value) => {
      entries.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
    list: (prefix) =>
      Promise.resolve([...entries.keys()].filter((key) => key.startsWith(prefix))),
  };
}
