import { getStore, type Store } from '@netlify/blobs';
import type { KeyValue } from './kv.js';

/**
 * The subscriber list in Netlify Blobs.
 *
 * Inside a function the store configures itself from the runtime. The weekly
 * digest job runs in GitHub Actions instead, where NETLIFY_SITE_ID and
 * NETLIFY_API_TOKEN supply what the runtime would have.
 */
export function blobsKv(): KeyValue {
  const siteID = process.env['NETLIFY_SITE_ID'];
  const token = process.env['NETLIFY_API_TOKEN'];
  const store: Store =
    siteID !== undefined && token !== undefined
      ? getStore({ name: 'subscribers', siteID, token })
      : getStore('subscribers');
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
