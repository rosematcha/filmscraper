import type { Amenity } from './types.js';

/**
 * How an amenity affects output.
 *
 * - `format`   — a premium format worth calling out in Notes.
 * - `plf`      — a chain-branded premium format we deliberately ignore (RPX, AVX, …).
 * - `three-d`  — 3D. Excluded: it is common enough to be noise on wide releases.
 * - `access`   — accessibility devices/captioning. Opt-in via `--show-accessibility`.
 * - `language` — dubbing/subtitling. Opt-in via `--show-language`.
 * - `event`    — marks a repertory or special-event screening.
 * - `comfort`  — seating and venue perks. Never surfaced.
 */
export type AmenityClass =
  | 'format'
  | 'plf'
  | 'three-d'
  | 'access'
  | 'language'
  | 'event'
  | 'comfort';

interface AmenityRule {
  readonly cls: AmenityClass;
  /** Display label for Notes; defaults to Fandango's own name. */
  readonly label?: string;
  /** Lower sorts first among `format` entries — rarer formats lead the note. */
  readonly rank?: number;
}

/**
 * Amenity ids observed live within 15 miles of 78205 (2026-08), plus formats
 * absent from that market but expected elsewhere (ScreenX, Dolby Cinema).
 *
 * Ids are matched first; `NAME_RULES` is the fallback for ids we have not seen,
 * since Fandango mints new ones as chains add formats.
 */
const ID_RULES: ReadonlyMap<number, AmenityRule> = new Map([
  // --- noteworthy formats -------------------------------------------------
  [1079, { cls: 'format', label: 'IMAX 70MM', rank: 0 }],
  [1080, { cls: 'format', label: '70MM', rank: 1 }],
  [1002, { cls: 'format', label: 'IMAX', rank: 3 }],

  // --- chain PLFs, deliberately excluded ----------------------------------
  [1019, { cls: 'plf' }], // RPX
  [1117, { cls: 'plf' }], // AVX
  [1075, { cls: 'plf' }], // CBX
  [1027, { cls: 'plf' }], // D-Box
  [1537, { cls: 'plf' }], // HDR
  [1554, { cls: 'plf' }], // HDR By Barco
  [1472, { cls: 'plf' }], // Laser Projection
  [1036, { cls: 'plf' }], // Dolby Atmos — audio, not Dolby Cinema

  // --- 3D -----------------------------------------------------------------
  [1009, { cls: 'three-d' }], // RealD 3D
  [1014, { cls: 'three-d' }], // Digital 3D

  // --- opt-in -------------------------------------------------------------
  [1003, { cls: 'access', label: 'Open caption' }],
  [1012, { cls: 'access', label: 'Closed caption' }],
  [1029, { cls: 'access', label: 'Accessibility devices' }],
  [1087, { cls: 'access', label: 'Accessibility devices' }],
  [1088, { cls: 'access', label: 'Accessibility devices' }],
  [1102, { cls: 'access', label: 'Accessibility devices' }],
  [1004, { cls: 'language', label: 'Spanish subtitled' }],
  [1037, { cls: 'language', label: 'Spanish dubbed' }],
  [1128, { cls: 'language', label: 'Spanish language' }],

  // --- event marker -------------------------------------------------------
  [1182, { cls: 'event' }], // Fathom Features

  // --- comfort ------------------------------------------------------------
  [2011, { cls: 'comfort' }], // Reserved seating
  [2012, { cls: 'comfort' }], // No passes
  [1071, { cls: 'comfort' }], // Recliner Seats
  [1150, { cls: 'comfort' }], // Recliner Seats
  [1121, { cls: 'comfort' }], // Buttkicker Recliners
  [1164, { cls: 'comfort' }], // Luxury Lounge Recliners
  [1283, { cls: 'comfort' }], // Stadium Seating
  [1219, { cls: 'comfort' }], // Dine-In Delivery to Seat
  [1170, { cls: 'comfort' }], // Baby Friendly
  [1406, { cls: 'comfort' }], // Kid Friendly
  [1590, { cls: 'comfort' }], // Ad Free Preshow
  [1573, { cls: 'comfort' }], // No Trailers
  [1592, { cls: 'comfort' }], // Flix Jr.
  [1254, { cls: 'comfort' }], // VIP 18+ — an admission policy, not a format
]);

/**
 * Name-based fallback, applied in order, for amenity ids absent from `ID_RULES`.
 * Ordering matters: `IMAX 70MM` must be tested before bare `IMAX`.
 */
const NAME_RULES: readonly (readonly [RegExp, AmenityRule])[] = [
  [/imax\s*(®)?\s*70\s*mm/i, { cls: 'format', label: 'IMAX 70MM', rank: 0 }],
  [/\b70\s*mm/i, { cls: 'format', label: '70MM', rank: 1 }],
  [/\b35\s*mm/i, { cls: 'format', label: '35MM', rank: 1 }],
  [/screenx/i, { cls: 'format', label: 'ScreenX', rank: 2 }],
  [/dolby\s+cinema/i, { cls: 'format', label: 'Dolby Cinema', rank: 2 }],
  [/\bimax\b/i, { cls: 'format', label: 'IMAX', rank: 3 }],

  [/dolby\s+atmos|atmos/i, { cls: 'plf' }],
  [/\brpx\b|\bxd\b|\bavx\b|\bcbx\b|d-?box|\bhdr\b|laser|barco|\bplf\b|big\s*d/i, { cls: 'plf' }],
  [/\b(3d|three-?d)\b/i, { cls: 'three-d' }],

  [/open\s+caption/i, { cls: 'access', label: 'Open caption' }],
  [/closed\s+caption/i, { cls: 'access', label: 'Closed caption' }],
  [/accessibility|assisted\s+listening|descriptive\s+audio/i, {
    cls: 'access',
    label: 'Accessibility devices',
  }],
  [/dubbed/i, { cls: 'language', label: 'Dubbed' }],
  [/subtitled/i, { cls: 'language', label: 'Subtitled' }],
  [/spanish|language/i, { cls: 'language', label: 'Spanish language' }],

  [/fathom|anniversary|special\s+event|encore/i, { cls: 'event' }],
];

export interface ClassifiedAmenity {
  readonly cls: AmenityClass;
  readonly label: string;
  readonly rank: number;
}

/** Default rank places unranked formats after every explicitly ranked one. */
const DEFAULT_RANK = 50;

export function classifyAmenity(amenity: Amenity): ClassifiedAmenity {
  const byId = ID_RULES.get(amenity.id);
  if (byId) {
    return { cls: byId.cls, label: byId.label ?? amenity.name, rank: byId.rank ?? DEFAULT_RANK };
  }
  for (const [pattern, rule] of NAME_RULES) {
    if (pattern.test(amenity.name)) {
      return { cls: rule.cls, label: rule.label ?? amenity.name, rank: rule.rank ?? DEFAULT_RANK };
    }
  }
  // Unknown amenities are comfort by default: a new seating perk must never
  // leak into Notes just because we have not catalogued it yet.
  return { cls: 'comfort', label: amenity.name, rank: DEFAULT_RANK };
}

/** Amenity ids present in `ID_RULES`, for the vocabulary-drift test. */
export function knownAmenityIds(): ReadonlySet<number> {
  return new Set(ID_RULES.keys());
}
