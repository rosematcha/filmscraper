import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPTY_ALIASES, type AliasConfig } from './aggregate.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Repo-relative default; resolves the same from `src/` and from `dist/`. */
export const DEFAULT_ALIASES_PATH = resolve(here, '../../config/aliases.json');

function stringRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

function idGroups(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((group): group is unknown[] => Array.isArray(group))
    .map((group) => group.filter((id): id is string => typeof id === 'string'))
    .filter((group) => group.length > 1);
}

/**
 * Load merge overrides and theater short names.
 *
 * A missing or malformed file is not fatal — the automatic behaviour is a
 * complete feature on its own, and losing the table to a stray comma is worse
 * than losing the overrides.
 */
export async function loadAliases(path = DEFAULT_ALIASES_PATH): Promise<AliasConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return EMPTY_ALIASES;
  }
  if (typeof raw !== 'object' || raw === null) return EMPTY_ALIASES;

  const record = raw as Record<string, unknown>;
  return {
    merge: idGroups(record['merge']),
    split: idGroups(record['split']),
    theaterNames: stringRecord(record['theaterNames']),
    sentinels: stringRecord(record['sentinels']),
  };
}
