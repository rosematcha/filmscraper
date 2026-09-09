import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { restorePublishedData } from '../src/restoreData.js';

const generatedAt = '2026-08-23T18:00:00.000Z';
const latest = {
  version: 2,
  generatedAt,
  zip: '78205',
  from: '2026-08-23',
  to: '2026-09-22',
  radiusMiles: 35,
  days: [],
};
const publicExport = (mode: 'full' | 'truncated', at = generatedAt) => ({
  version: 1,
  mode,
  generatedAt: at,
  market: {
    zip: latest.zip,
    from: latest.from,
    to: latest.to,
    radiusMiles: latest.radiusMiles,
  },
  theaters: [],
  films: [],
});

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function target(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'filmscraper-restore-'));
  directories.push(directory);
  return directory;
}

function mockSite(overrides: Readonly<Record<string, unknown>> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      const name = new URL(url).pathname.split('/').at(-1) ?? '';
      const value =
        overrides[name] ??
        (name === 'latest.json'
          ? latest
          : publicExport(name === 'full.json' ? 'full' : 'truncated'));
      return Promise.resolve(new Response(JSON.stringify(value)));
    }),
  );
}

describe('restorePublishedData', () => {
  it('restores a validated three-file snapshot', async () => {
    mockSite();
    const directory = await target();

    expect(await restorePublishedData('https://films.example/', directory)).toBe(true);
    expect(JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'))).toMatchObject(
      latest,
    );
    expect(JSON.parse(await readFile(join(directory, 'full.json'), 'utf8'))).toMatchObject({
      mode: 'full',
      generatedAt,
    });
    expect(JSON.parse(await readFile(join(directory, 'truncated.json'), 'utf8'))).toMatchObject({
      mode: 'truncated',
      generatedAt,
    });
  });

  it('restores the ledger beside the dataset when it is readable', async () => {
    const ledger = {
      version: 1,
      updatedAt: generatedAt,
      since: '2026-08-01',
      films: {
        x: {
          title: 'X',
          firstDate: '2026-08-01',
          lastDate: '2026-08-30',
          firstSeen: '2026-08-01',
          lastSeen: '2026-08-23',
        },
      },
    };
    mockSite({ 'ledger.json': ledger });
    const directory = await target();
    await expect(restorePublishedData('https://example.test', directory)).resolves.toBe(true);
    expect(JSON.parse(await readFile(join(directory, 'ledger.json'), 'utf8'))).toEqual(ledger);
  });

  it('leaves the ledger out when the site has none', async () => {
    mockSite({ 'ledger.json': { not: 'a ledger' } });
    const directory = await target();
    await expect(restorePublishedData('https://example.test', directory)).resolves.toBe(true);
    await expect(readFile(join(directory, 'ledger.json'), 'utf8')).rejects.toThrow();
  });

  it('never combines exports from a different scrape', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockSite({ 'full.json': publicExport('full', '2026-08-22T18:00:00.000Z') });
    const directory = await target();
    await writeFile(join(directory, 'full.json'), 'stale', 'utf8');
    await writeFile(join(directory, 'truncated.json'), 'stale', 'utf8');

    expect(await restorePublishedData('https://films.example', directory)).toBe(true);
    await expect(readFile(join(directory, 'latest.json'), 'utf8')).resolves.toContain(generatedAt);
    await expect(readFile(join(directory, 'full.json'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(directory, 'truncated.json'), 'utf8')).rejects.toThrow();
  });
});
