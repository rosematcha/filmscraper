#!/usr/bin/env node
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

interface RawDatasetHeader {
  readonly generatedAt: string;
  readonly zip: string;
  readonly from: string;
  readonly to: string;
  readonly radiusMiles: number;
}

interface PublicExportHeader {
  readonly generatedAt: string;
  readonly market: {
    readonly zip: string;
    readonly from: string;
    readonly to: string;
    readonly radiusMiles: number;
  };
}

interface Downloaded<T> {
  readonly text: string;
  readonly data: T;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function rawHeader(value: unknown): RawDatasetHeader | null {
  const data = record(value);
  if (
    data?.['version'] !== 2 ||
    !Array.isArray(data['days']) ||
    typeof data['generatedAt'] !== 'string' ||
    typeof data['zip'] !== 'string' ||
    typeof data['from'] !== 'string' ||
    typeof data['to'] !== 'string' ||
    typeof data['radiusMiles'] !== 'number'
  ) {
    return null;
  }
  return {
    generatedAt: data['generatedAt'],
    zip: data['zip'],
    from: data['from'],
    to: data['to'],
    radiusMiles: data['radiusMiles'],
  };
}

function exportHeader(value: unknown, mode: string): PublicExportHeader | null {
  const data = record(value);
  const market = record(data?.['market']);
  if (
    data?.['version'] !== 1 ||
    data['mode'] !== mode ||
    !Array.isArray(data['theaters']) ||
    !Array.isArray(data['films']) ||
    typeof data['generatedAt'] !== 'string' ||
    typeof market?.['zip'] !== 'string' ||
    typeof market['from'] !== 'string' ||
    typeof market['to'] !== 'string' ||
    typeof market['radiusMiles'] !== 'number'
  ) {
    return null;
  }
  return {
    generatedAt: data['generatedAt'],
    market: {
      zip: market['zip'],
      from: market['from'],
      to: market['to'],
      radiusMiles: market['radiusMiles'],
    },
  };
}

async function download<T>(
  url: string,
  validate: (value: unknown) => T | null,
): Promise<Downloaded<T>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('invalid JSON');
  }
  const data = validate(value);
  if (data === null) throw new Error('unexpected structure');
  return { text, data };
}

function sameSnapshot(raw: RawDatasetHeader, exported: PublicExportHeader): boolean {
  return (
    exported.generatedAt === raw.generatedAt &&
    exported.market.zip === raw.zip &&
    exported.market.from === raw.from &&
    exported.market.to === raw.to &&
    exported.market.radiusMiles === raw.radiusMiles
  );
}

/** Restore the currently deployed data without ever mixing export snapshots. */
export async function restorePublishedData(baseUrl: string, targetDir: string): Promise<boolean> {
  const base = baseUrl.replace(/\/$/, '');
  let latest: Downloaded<RawDatasetHeader>;
  try {
    latest = await download(`${base}/data/latest.json`, rawHeader);
  } catch (error) {
    console.warn(
      `no valid published dataset available (${error instanceof Error ? error.message : String(error)})`,
    );
    return false;
  }

  const exports = await Promise.all(
    ['full', 'truncated'].map(async (mode) => {
      try {
        return await download(`${base}/data/${mode}.json`, (value) => exportHeader(value, mode));
      } catch (error) {
        console.warn(
          `no valid published ${mode} export available (${error instanceof Error ? error.message : String(error)})`,
        );
        return null;
      }
    }),
  );
  const completeExports = exports.every(
    (item): item is Downloaded<PublicExportHeader> =>
      item !== null && sameSnapshot(latest.data, item.data),
  );
  if (!completeExports && exports.every((item) => item !== null)) {
    console.warn('published exports do not match latest.json; leaving both exports out');
  }

  await mkdir(targetDir, { recursive: true });
  const stage = await mkdtemp(join(targetDir, '.restore-'));
  try {
    await writeFile(join(stage, 'latest.json'), latest.text, 'utf8');
    if (completeExports) {
      await Promise.all(
        exports.map((item, index) =>
          writeFile(join(stage, `${index === 0 ? 'full' : 'truncated'}.json`), item.text, 'utf8'),
        ),
      );
    }

    await rename(join(stage, 'latest.json'), join(targetDir, 'latest.json'));
    if (completeExports) {
      await rename(join(stage, 'full.json'), join(targetDir, 'full.json'));
      await rename(join(stage, 'truncated.json'), join(targetDir, 'truncated.json'));
    } else {
      await Promise.all(
        ['full.json', 'truncated.json'].map((name) => rm(join(targetDir, name), { force: true })),
      );
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return true;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  const baseUrl = process.argv[2];
  const targetDir = process.argv[3];
  if (!baseUrl || !targetDir) throw new Error('usage: restoreData <site-url> <target-directory>');
  await restorePublishedData(baseUrl, targetDir);
}
