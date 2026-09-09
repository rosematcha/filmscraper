import { useCallback, useMemo, useState } from 'react';
import { DEFAULT_TABLE_IDS, SECTION_BY_ID, SECTIONS, knownTables } from '@core/core/sections.js';
import type { SortOrder } from '@core/core/types.js';

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

export const SORT_ORDERS: readonly SortOrder[] = ['reach', 'title', 'soonest'];

/** How the rows are grouped on the page. */
export type ViewMode = 'film' | 'day' | 'venue';
export const VIEW_MODES: readonly ViewMode[] = ['film', 'day', 'venue'];

/** The main table's id in the open-state record. */
export const MAIN_ID = 'main';

/** The one table whose rows fall outside the chosen window. */
export const COMING_ID = 'coming';

/**
 * Whether a table starts unfolded.
 *
 * This week's tables do; the wide releases and next week's listings start
 * shut behind their own counts. A day or a venue is always worth opening.
 */
function opensByDefault(id: string): boolean {
  if (id === MAIN_ID) return false;
  return SECTION_BY_ID.get(id)?.defaultOpen ?? true;
}

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
  /** Drop films playing widely enough to be unmissable. */
  readonly hideWide: boolean;
  /** Drop films playing a single theater. */
  readonly hideSingle: boolean;
}

export const DEFAULT_FLAGS: ViewFlags = {
  excludeForeign: false,
  keepYears: false,
  showAccessibility: false,
  showLanguage: false,
  hideWide: false,
  hideSingle: false,
};

interface StoredTables {
  /** Tables explicitly turned on. */
  readonly on: readonly string[];
  /** Tables explicitly turned off, so a new default-on table is not resurrected. */
  readonly off: readonly string[];
  readonly flags: ViewFlags;
  readonly sort: SortOrder;
  readonly view: ViewMode;
  /** Sections explicitly unfolded or folded; anything else takes its default. */
  readonly opened: readonly string[];
  readonly closed: readonly string[];
}

const EMPTY: StoredTables = {
  on: [],
  off: [],
  flags: DEFAULT_FLAGS,
  sort: 'reach',
  view: 'film',
  opened: [],
  closed: [],
};

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
        hideWide: flag('hideWide'),
        hideSingle: flag('hideSingle'),
      },
      sort: SORT_ORDERS.includes(record.sort as SortOrder) ? (record.sort as SortOrder) : 'reach',
      view: VIEW_MODES.includes(record.view as ViewMode) ? (record.view as ViewMode) : 'film',
      opened: ids(record.opened),
      closed: ids(record.closed),
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

/** Add to one decision list and drop from its opposite. */
function decide(
  yes: readonly string[],
  no: readonly string[],
  id: string,
  value: boolean,
): [string[], string[]] {
  return [
    value ? [...new Set([...yes, id])] : yes.filter((x) => x !== id),
    value ? no.filter((x) => x !== id) : [...new Set([...no, id])],
  ];
}

export interface TablePrefs {
  readonly tables: string[];
  readonly flags: ViewFlags;
  readonly sort: SortOrder;
  readonly view: ViewMode;
  readonly setTable: (id: string, enabled: boolean) => void;
  readonly setFlag: (key: keyof ViewFlags, value: boolean) => void;
  readonly setSort: (order: SortOrder) => void;
  readonly setView: (view: ViewMode) => void;
  /** Whether a section is unfolded; everything but the main table is by default. */
  readonly isOpen: (id: string) => boolean;
  readonly setOpen: (id: string, open: boolean) => void;
}

/** The table checklist, remembered across visits. */
export function useTablePrefs(): TablePrefs {
  const [stored, setStored] = useState<StoredTables | null>(read);
  // Stable between renders: this list is a dependency of the memo that
  // re-derives the whole table from the nightly dataset, and a fresh array
  // every render would re-run it on every keystroke and every progress tick.
  const tables = useMemo(() => knownTables(resolve(stored)), [stored]);

  const update = useCallback((change: (base: StoredTables) => StoredTables) => {
    setStored((prev) => {
      const next = change(prev ?? EMPTY);
      write(next);
      return next;
    });
  }, []);

  const setTable = useCallback(
    (id: string, enabled: boolean) => {
      update((base) => {
        const [on, off] = decide(base.on, base.off, id, enabled);
        // Asking for the table means wanting to see those films, which is the
        // opposite of dropping them. Left to contradict each other, the pair
        // produces a "Not in English" table that can never have a row in it.
        const flags =
          enabled && id === FOREIGN_ID ? { ...base.flags, excludeForeign: false } : base.flags;
        return { ...base, on, off, flags };
      });
    },
    [update],
  );

  const setFlag = useCallback(
    (key: keyof ViewFlags, value: boolean) => {
      update((base) => {
        const drops = key === 'excludeForeign' && value;
        // Dropping the films takes their table with it, visibly: the word goes
        // struck through in the same menu rather than the table just vanishing.
        const [on, off] = drops
          ? decide(base.on, base.off, FOREIGN_ID, false)
          : [base.on, base.off];
        return { ...base, on, off, flags: { ...base.flags, [key]: value } };
      });
    },
    [update],
  );

  const setSort = useCallback(
    (order: SortOrder) => {
      update((base) => ({ ...base, sort: order }));
    },
    [update],
  );

  const setView = useCallback(
    (view: ViewMode) => {
      update((base) => ({ ...base, view }));
    },
    [update],
  );

  const setOpen = useCallback(
    (id: string, open: boolean) => {
      update((base) => {
        const [opened, closed] = decide(base.opened, base.closed, id, open);
        return { ...base, opened, closed };
      });
    },
    [update],
  );

  const isOpen = useCallback(
    (id: string): boolean => {
      if (stored?.opened.includes(id)) return true;
      if (stored?.closed.includes(id)) return false;
      return opensByDefault(id);
    },
    [stored],
  );

  return {
    tables,
    flags: stored?.flags ?? DEFAULT_FLAGS,
    sort: stored?.sort ?? 'reach',
    view: stored?.view ?? 'film',
    setTable,
    setFlag,
    setSort,
    setView,
    isOpen,
    setOpen,
  };
}
