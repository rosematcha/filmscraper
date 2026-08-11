import { getStore, type Store } from '@netlify/blobs';
import type { KeyValue } from './kv.js';

/**
 * A named Netlify Blobs store.
 *
 * Inside a function the store configures itself from the runtime. Jobs that
 * run in GitHub Actions instead pass NETLIFY_SITE_ID and NETLIFY_API_TOKEN,
 * which supply what the runtime would have.
 */
export function blobsKv(name: string): KeyValue {
  const siteID = process.env['NETLIFY_SITE_ID'];
  const token = process.env['NETLIFY_API_TOKEN'];
  const store: Store =
    siteID !== undefined && token !== undefined
      ? getStore({ name, siteID, token })
      : getStore(name);
  return {
    get: (key) => store.get(key, { type: 'text' }),
    set: async (key, value) => {
      await store.set(key, value);
    },
    delete: async (key) => {
      await store.delete(key);
    },
    list: async (prefix) => {
      const { blobs } = await store.list({ prefix });
      return blobs.map((blob) => blob.key);
    },
  };
}
