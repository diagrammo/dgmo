import { describe, expect, it } from 'vitest';

import {
  SKETCH_FOOT_H,
  SKETCH_FOOT_W,
  SKETCH_GEOMETRY,
  SKETCH_HALF_SLOT_X,
  SKETCH_HALF_SLOT_Y,
  SKETCH_SEP,
  SKETCH_SLOT_X,
  SKETCH_SLOT_Y,
} from '../src/sketch/geometry';

// 🔴 The docblocks in `src/sketch/geometry.ts` quote these figures, and so do
// `diagrammo-app/src/features/preview/sketch-canvas/geometry.ts` and
// `_bmad-output/implementation-artifacts/tech-spec-sketch-rebuild.md`.
//
// Until 2026-08-29 all three described a 208 x 128 footprint, a half-slot of
// 104 and a slot of 312 — figures from a cell size the library had stopped
// using. Nothing failed, because prose cannot fail. The stale numbers were
// copied into a spec, reasoned from, and put into the first draft of an issue.
//
// This test is the thing that fails instead. If a change to `cellPx` moves
// these, the docblocks and the spec Appendix are wrong and must move with it.

describe('sketch geometry — the figures the docs quote', () => {
  it('derives from one cell size', () => {
    expect(SKETCH_GEOMETRY.cellPx).toBe(16);
    expect(SKETCH_GEOMETRY.footprintCellsW).toBe(8);
  });

  it('a footprint is 128 x 80', () => {
    expect(SKETCH_FOOT_W).toBe(128);
    expect(SKETCH_FOOT_H).toBe(80);
  });

  it('a half-unit is half a footprint: 64 / 40', () => {
    expect(SKETCH_HALF_SLOT_X).toBe(64);
    expect(SKETCH_HALF_SLOT_Y).toBe(40);
  });

  it('a slot is SEP half-units: 192 / 120', () => {
    expect(SKETCH_SEP).toBe(3);
    expect(SKETCH_SLOT_X).toBe(192);
    expect(SKETCH_SLOT_Y).toBe(120);
  });

  it('leaves 64 x 40 of clear air between edge-adjacent footprints', () => {
    // The quantity the canvas's JOIN_REACH is (#560), so it is not free to
    // drift without that rule drifting with it.
    expect(SKETCH_SLOT_X - SKETCH_FOOT_W).toBe(64);
    expect(SKETCH_SLOT_Y - SKETCH_FOOT_H).toBe(40);
  });

  it('keeps every half-unit a whole pixel', () => {
    // Why FOOT_H is forced even: half the height must not be fractional.
    expect(SKETCH_FOOT_H % 2).toBe(0);
    expect(Number.isInteger(SKETCH_HALF_SLOT_X)).toBe(true);
    expect(Number.isInteger(SKETCH_HALF_SLOT_Y)).toBe(true);
  });
});
