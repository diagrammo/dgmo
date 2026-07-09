// ============================================================
// Family Diagram — Card content model (shared layout ⇄ renderer)
// ============================================================
//
// The set of rows shown inside a person card is computed ONCE here so the
// layout's card sizing and the renderer's card drawing can never diverge.
//
// Row order (top → bottom, under the name header):
//   1. a muted year-range row (`1682 – 1720` / `b. 1690` / `d. 1720`) when a
//      birth and/or death year is present — keyless.
//   2. one labeled row per present fixed key, in this fixed declaration order.

/** Fixed labeled keys, in render order. `b`/`d` are folded into the year row. */
const LABELED_KEYS: ReadonlyArray<readonly [key: string, label: string]> = [
  ['bp', 'Born'],
  ['dp', 'Died'],
  ['occupation', 'Occupation'],
  ['military', 'Military'],
  ['education', 'Education'],
  ['religion', 'Religion'],
  ['burial', 'Burial'],
];

export interface FamilyCardRow {
  /** Display key (empty string for the keyless year-range row). */
  readonly key: string;
  readonly value: string;
  /** True for the muted, keyless year-range row. */
  readonly year: boolean;
}

/** Build the ordered card rows for a person / laid-out node (may be empty). */
export function familyCardRows(p: {
  metadata: Readonly<Record<string, string>>;
}): FamilyCardRow[] {
  const rows: FamilyCardRow[] = [];
  const b = p.metadata['b'];
  const d = p.metadata['d'];
  if (b && d) rows.push({ key: '', value: `${b} – ${d}`, year: true });
  else if (b) rows.push({ key: '', value: `b. ${b}`, year: true });
  else if (d) rows.push({ key: '', value: `d. ${d}`, year: true });
  for (const [key, label] of LABELED_KEYS) {
    const v = p.metadata[key];
    if (v) rows.push({ key: label, value: v, year: false });
  }
  return rows;
}
