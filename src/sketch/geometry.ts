// ============================================================
// Sketch diagram — Slot geometry (single source of truth)
// ============================================================
//
// The sketch canvas is a HALF-UNIT lattice. ONE universal footprint (a
// golden-ratio box) is exactly 2×2 half-units, so its four corners land on
// lattice dots. The mandatory gap between shapes is one more half-unit per
// axis, so a shape claims a 3×3 (SKETCH_SEP) block. `at: C R` counts
// half-units — the half-step is the finest snap and permits brick offsets.
//
// Because a footprint == 2 half-units and the half-unit == footprint/2, the
// dot grid the canvas paints coincides exactly with where a shape's corner
// snaps (this was NOT true when the pitch was (footprint+gap)/2).
//
// These constants are consumed by layout, renderer, AND the app's canvas
// editor (via the `advanced` entrypoint) — the app must never redefine them.

/** The golden ratio, φ. Every shape's footprint is φ:1 (width:height). */
export const SKETCH_PHI = (1 + Math.sqrt(5)) / 2;

export const SKETCH_GEOMETRY = {
  /** px per grid cell (the dot-grid pitch) */
  cellPx: 26,
  /** universal footprint width, in grid cells */
  footprintCellsW: 8,
  /**
   * Legacy — the gap is now a derived half-unit (footprint/2 per axis), not
   * these cell counts. Kept only so the shape of SKETCH_GEOMETRY is stable.
   */
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
 * Footprint height, px — the ONE universal size (spec §31.2). Every shape is a
 * golden-ratio landscape box: height ≈ width / φ, forced EVEN so half the
 * height is a whole pixel (the vertical half-unit). 208/φ = 128.6 → 128
 * (ratio 1.625). Uniform: every shape draws to exactly SKETCH_FOOT_W ×
 * SKETCH_FOOT_H. The org-card body (header + rule + ~4 rows) fits within it.
 */
export const SKETCH_FOOT_H = 2 * Math.round(SKETCH_FOOT_W / SKETCH_PHI / 2);

/**
 * Horizontal half-unit pitch, px: HALF a footprint (104). This is the dot grid
 * AND the snap step — a footprint is 2 of these wide, so its left/right edges
 * both land on dots.
 */
export const SKETCH_HALF_SLOT_X = SKETCH_FOOT_W / 2;

/** Vertical half-unit pitch, px: half a footprint (64). */
export const SKETCH_HALF_SLOT_Y = SKETCH_FOOT_H / 2;

/**
 * Minimum origin separation in half-units. A footprint spans 2 half-units and
 * the mandatory gap adds 1 more, so each shape claims a SEP×SEP (3×3) collision
 * block (unitRect in layout.ts); two shapes collide when their blocks overlap.
 * At exactly SEP apart the gap between footprints == one half-unit.
 */
export const SKETCH_SEP = 3;

/**
 * Full-slot pitch, px: footprint + gap (== SKETCH_SEP half-units). The
 * origin-to-origin distance between two edge-adjacent shapes. 312 × 192 —
 * horizontal spacing is unchanged from the old geometry, vertical is tighter.
 */
export const SKETCH_SLOT_X = SKETCH_HALF_SLOT_X * SKETCH_SEP;
export const SKETCH_SLOT_Y = SKETCH_HALF_SLOT_Y * SKETCH_SEP;

/** Slot → px (origin of the footprint), before any canvas padding. */
export function sketchSlotToPx(c: number, r: number): { x: number; y: number } {
  return { x: c * SKETCH_HALF_SLOT_X, y: r * SKETCH_HALF_SLOT_Y };
}
