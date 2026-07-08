// ============================================================
// Sketch diagram — Slot geometry (single source of truth)
// ============================================================
//
// The sketch canvas is a coarse half-slot lattice: ONE universal footprint
// (8×4 grid cells) and a mandatory gap between shapes. A slot = footprint +
// gap; `at: C R` counts half-slots (the half-step permits brick offsets).
//
// These constants are consumed by layout, renderer, AND the app's canvas
// editor (via the `advanced` entrypoint) — the app must never redefine them.
// Values were tuned in the BL-115 Task-1 placement-feel spike.

/** The golden ratio, φ. Every shape's footprint is φ:1 (width:height). */
export const SKETCH_PHI = (1 + Math.sqrt(5)) / 2;

export const SKETCH_GEOMETRY = {
  /** px per grid cell (the dot-grid pitch) */
  cellPx: 26,
  /** universal footprint width, in grid cells */
  footprintCellsW: 8,
  /** mandatory gap between footprints, in cells */
  gapCellsX: 4,
  gapCellsY: 4,
  /** box reserved top band, px (spec decision 12) */
  bandPx: 44,
  /** box frame padding around the children bbox, px */
  boxPadPx: 26,
  /** edge-ring (connect hook) width as a fraction of footprint height */
  ringFrac: 0.22,
} as const;

/** Footprint width, px (208 at the default cell). */
export const SKETCH_FOOT_W =
  SKETCH_GEOMETRY.footprintCellsW * SKETCH_GEOMETRY.cellPx;

/**
 * Footprint height, px — the ONE universal size (spec §31.2). Golden-ratio
 * derived from the width (φ:1), so 208 → 129. Every shape kind draws to
 * exactly SKETCH_FOOT_W × SKETCH_FOOT_H; no shape is bigger, smaller, or a
 * different aspect than any other.
 */
export const SKETCH_FOOT_H = Math.round(SKETCH_FOOT_W / SKETCH_PHI);

/** Horizontal half-slot pitch, px: (footprint + gap) / 2. */
export const SKETCH_HALF_SLOT_X =
  (SKETCH_FOOT_W + SKETCH_GEOMETRY.gapCellsX * SKETCH_GEOMETRY.cellPx) / 2;

/** Vertical half-slot pitch, px: (footprint + gap) / 2. */
export const SKETCH_HALF_SLOT_Y =
  (SKETCH_FOOT_H + SKETCH_GEOMETRY.gapCellsY * SKETCH_GEOMETRY.cellPx) / 2;

/**
 * Minimum origin separation in half-slots: two shapes collide when BOTH
 * axis deltas are < SKETCH_SEP (at exactly SEP the footprint gap equals the
 * mandatory gap).
 */
export const SKETCH_SEP = 2;

/** Slot → px (origin of the footprint), before any canvas padding. */
export function sketchSlotToPx(c: number, r: number): { x: number; y: number } {
  return { x: c * SKETCH_HALF_SLOT_X, y: r * SKETCH_HALF_SLOT_Y };
}
