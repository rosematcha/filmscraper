import { useCallback, useMemo, useState } from 'react';
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

/** The one table another setting can contradict. */
const FOREIGN_ID = 'foreign';

/**
 * Settings that change how a row reads rather than which table it lands in.
 *
 * Kept in one record so adding another is a key here and a word in the menu,
 * not a field threaded through three components.
 */
export interface ViewFlags {
  /** Drop non-English releases from the output entirely. */
  readonly excludeForeign: boolean;
  /** Leave "(2026)" on titles instead of normalizing it away. */
  readonly keepYears: boolean;
  /** Name open-caption and other accessibility bookings in the Notes cell. */
  readonly showAccessibility: boolean;
  /** Name subtitled and dubbed bookings in the Notes cell. */
  readonly showLanguage: boolean;
}

export const DEFAULT_FLAGS: ViewFlags = {
  excludeForeign: false,
  keepYears: false,
  showAccessibility: false,
  showLanguage: false,
};

interface StoredTables {
  /** Tables explicitly turned on. */
  readonly on: readonly string[];
  /** Tables explicitly turned off, so a new default-on table is not resurrected. */
  readonly off: readonly string[];
  readonly flags: ViewFlags;
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
    // `excludeForeign` sat at the top level before the flags record existed.
    const stored = (record.flags ?? record) as Record<string, unknown>;
    const flag = (key: keyof ViewFlags): boolean => stored[key] === true;
    return {
      on: ids(record.on),
      off: ids(record.off),
      flags: {
        excludeForeign: flag('excludeForeign'),
        keepYears: flag('keepYears'),
        showAccessibility: flag('showAccessibility'),
        showLanguage: flag('showLanguage'),
      },
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
  readonly flags: ViewFlags;
  readonly setTable: (id: string, enabled: boolean) => void;
  readonly setFlag: (key: keyof ViewFlags, value: boolean) => void;
}

/** The table checklist, remembered across visits. */
export function useTablePrefs(): TablePrefs {
  const [stored, setStored] = useState<StoredTables | null>(read);
  // Stable between renders: this list is a dependency of the memo that
  // re-derives the whole table from the nightly dataset, and a fresh array
  // every render would re-run it on every keystroke and every progress tick.
  const tables = useMemo(() => knownTables(resolve(stored)), [stored]);

  const setTable = useCallback((id: string, enabled: boolean) => {
    setStored((prev) => {
      const base = prev ?? { on: [], off: [], flags: DEFAULT_FLAGS };
      const next: StoredTables = {
        on: enabled ? [...new Set([...base.on, id])] : base.on.filter((x) => x !== id),
        off: enabled ? base.off.filter((x) => x !== id) : [...new Set([...base.off, id])],
        // Asking for the table means wanting to see those films, which is the
        // opposite of dropping them. Left to contradict each other, the pair
        // produces a "Not in English" table that can never have a row in it.
        flags:
          enabled && id === FOREIGN_ID
            ? { ...base.flags, excludeForeign: false }
            : base.flags,
      };
      write(next);
      return next;
    });
  }, []);

  const setFlag = useCallback((key: keyof ViewFlags, value: boolean) => {
    setStored((prev) => {
      const base = prev ?? { on: [], off: [], flags: DEFAULT_FLAGS };
      const drops = key === 'excludeForeign' && value;
      // Dropping the films takes their table with it, visibly: the word goes
      // struck through in the same menu rather than the table just vanishing.
      const next: StoredTables = {
        on: drops ? base.on.filter((x) => x !== FOREIGN_ID) : base.on,
        off: drops ? [...new Set([...base.off, FOREIGN_ID])] : base.off,
        flags: { ...base.flags, [key]: value },
      };
      write(next);
      return next;
    });
  }, []);

  return {
    tables,
    flags: stored?.flags ?? DEFAULT_FLAGS,
    setTable,
    setFlag,
  };
}
