import { useCallback, useState } from 'react';
import { DEFAULT_TABLE_IDS, SECTIONS, knownTables } from '@core/core/sections.js';

export { SECTIONS };

/**
 * Where the checklist is kept between visits.
 *
 * Which tables to build is a standing preference, not a per-run decision:
 * whoever wants the drive-in broken out wants it broken out every week, and
 * re-ticking five boxes before each paste is the kind of overhead the table is
 * supposed to be free of.
 */
const KEY = 'filmscraper.tables.v1';

interface StoredTables {
  /** Tables explicitly turned on. */
  readonly on: readonly string[];
  /** Tables explicitly turned off, so a new default-on table is not resurrected. */
  readonly off: readonly string[];
  readonly excludeForeign: boolean;
}

function read(): StoredTables | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const ids = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    return {
      on: ids(record.on),
      off: ids(record.off),
      excludeForeign: record.excludeForeign === true,
    };
  } catch {
    // A private-mode browser or a hand-edited entry: the defaults are a
    // complete answer, and losing the table to it would not be.
    return null;
  }
}

function write(stored: StoredTables): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Nothing to do and nothing worth saying: the session still works.
  }
}

/**
 * Resolve the stored choices against the tables this build actually has.
 *
 * Storing decisions rather than a list is what lets a table added later show up
 * at its own default instead of silently missing, while a table someone turned
 * off stays off.
 */
function resolve(stored: StoredTables | null): string[] {
  if (stored === null) return [...DEFAULT_TABLE_IDS];
  const on = new Set(stored.on);
  const off = new Set(stored.off);
  return SECTIONS.filter((s) => (on.has(s.id) ? true : off.has(s.id) ? false : s.defaultOn)).map(
    (s) => s.id,
  );
}

export interface TablePrefs {
  readonly tables: string[];
  readonly excludeForeign: boolean;
  readonly setTable: (id: string, enabled: boolean) => void;
  readonly setExcludeForeign: (value: boolean) => void;
}

/** The table checklist, remembered across visits. */
export function useTablePrefs(): TablePrefs {
  const [stored, setStored] = useState<StoredTables | null>(read);
  const tables = resolve(stored);

  const setTable = useCallback((id: string, enabled: boolean) => {
    setStored((prev) => {
      const base = prev ?? { on: [], off: [], excludeForeign: false };
      const next: StoredTables = {
        on: enabled ? [...new Set([...base.on, id])] : base.on.filter((x) => x !== id),
        off: enabled ? base.off.filter((x) => x !== id) : [...new Set([...base.off, id])],
        excludeForeign: base.excludeForeign,
      };
      write(next);
      return next;
    });
  }, []);

  const setExcludeForeign = useCallback((value: boolean) => {
    setStored((prev) => {
      const base = prev ?? { on: [], off: [], excludeForeign: false };
      const next = { ...base, excludeForeign: value };
      write(next);
      return next;
    });
  }, []);

  return {
    tables: knownTables(tables),
    excludeForeign: stored?.excludeForeign ?? false,
    setTable,
    setExcludeForeign,
  };
}
