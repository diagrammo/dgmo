import { describe, expect, it } from 'vitest';

import { collapseSketch } from '../src/sketch/collapse';
import {
  SKETCH_FOOT_H,
  SKETCH_FOOT_W,
  SKETCH_GEOMETRY,
  SKETCH_HALF_SLOT_X,
  SKETCH_HALF_SLOT_Y,
} from '../src/sketch/geometry';
import { layoutSketch } from '../src/sketch/layout';
import { parseSketch } from '../src/sketch/parser';

const node = (l: ReturnType<typeof layoutSketch>, label: string) =>
  l.nodes.find((n) => n.label === label)!;

describe('sketch layout — slot math', () => {
  it('maps half-slot coordinates to the px lattice', () => {
    const p = parseSketch('sketch\nA at: 0 0\nB at: 2 0\nC at: 1 2');
    const l = layoutSketch(p);
    expect(node(l, 'A').x).toBe(0);
    expect(node(l, 'A').y).toBe(0);
    expect(node(l, 'B').x).toBe(2 * SKETCH_HALF_SLOT_X);
    expect(node(l, 'C').x).toBe(1 * SKETCH_HALF_SLOT_X);
    expect(node(l, 'C').y).toBe(2 * SKETCH_HALF_SLOT_Y);
    expect(node(l, 'A').w).toBe(SKETCH_FOOT_W);
    expect(node(l, 'A').h).toBe(SKETCH_FOOT_H);
  });

  it('normalizes negative authored coordinates to a 0-based origin', () => {
    const p = parseSketch('sketch\nA at: -2 -2\nB at: 0 0');
    const l = layoutSketch(p);
    expect(node(l, 'A').x).toBe(0);
    expect(node(l, 'A').y).toBe(0);
    expect(node(l, 'B').x).toBe(2 * SKETCH_HALF_SLOT_X);
  });

  it('brick offsets are legal: 1 half-slot apart on x with 2 on y', () => {
    const p = parseSketch('sketch\nA at: 0 0\nB at: 1 2');
    const l = layoutSketch(p);
    expect(l.diagnostics).toHaveLength(0);
    expect(node(l, 'B').x).toBe(SKETCH_HALF_SLOT_X);
  });
});

describe('sketch layout — flow auto-place', () => {
  it('appends un-positioned shapes below existing content in reading order', () => {
    const p = parseSketch('sketch\nA at: 0 0\nLazy One\nLazy Two');
    const l = layoutSketch(p);
    const a = node(l, 'A');
    const l1 = node(l, 'Lazy One');
    const l2 = node(l, 'Lazy Two');
    expect(l1.y).toBeGreaterThan(a.y);
    expect(l2.slot.r).toBe(l1.slot.r);
    expect(l2.slot.c).toBeGreaterThan(l1.slot.c);
    expect(l.diagnostics).toHaveLength(0);
  });

  it('an all-flow sketch lays out without warnings', () => {
    const p = parseSketch('sketch\nA\nB\nC\nD\nE');
    const l = layoutSketch(p);
    expect(l.nodes).toHaveLength(5);
    expect(l.diagnostics).toHaveLength(0);
    // No two nodes collide.
    for (const m of l.nodes) {
      for (const n of l.nodes) {
        if (m.id === n.id) continue;
        const apart =
          Math.abs(m.slot.c - n.slot.c) >= 2 ||
          Math.abs(m.slot.r - n.slot.r) >= 2;
        expect(apart).toBe(true);
      }
    }
  });
});

describe('sketch layout — overlap auto-resolution', () => {
  it('moves the later shape to the nearest free slot with W_SKETCH_OVERLAP_RESOLVED', () => {
    const p = parseSketch('sketch\nA at: 0 0\nB at: 0 0');
    const l = layoutSketch(p);
    const a = node(l, 'A');
    const b = node(l, 'B');
    expect(a.slot).not.toEqual(b.slot);
    const apart =
      Math.abs(a.slot.c - b.slot.c) >= 2 || Math.abs(a.slot.r - b.slot.r) >= 2;
    expect(apart).toBe(true);
    expect(
      l.diagnostics.filter((d) => d.code === 'W_SKETCH_OVERLAP_RESOLVED')
    ).toHaveLength(1);
  });

  it('near-miss overlap (1 half-slot apart both axes) also resolves', () => {
    const p = parseSketch('sketch\nA at: 0 0\nB at: 1 1');
    const l = layoutSketch(p);
    expect(
      l.diagnostics.filter((d) => d.code === 'W_SKETCH_OVERLAP_RESOLVED')
    ).toHaveLength(1);
  });
});

describe('sketch layout — boxes', () => {
  const SRC = `sketch
[Below Decks] at: 2 2
  Booty Queue at: 0 0
  Ship Ledger at: 2 0
`;

  it('absolutizes box-relative children and wraps the frame around them', () => {
    const p = parseSketch(SRC);
    const l = layoutSketch(p);
    const q = node(l, 'Booty Queue');
    const s = node(l, 'Ship Ledger');
    expect(q.slot).toEqual({ c: 2, r: 2 });
    expect(s.slot).toEqual({ c: 4, r: 2 });
    expect(l.boxes).toHaveLength(1);
    const box = l.boxes[0]!;
    expect(box.x).toBe(q.x - SKETCH_GEOMETRY.boxPadPx);
    expect(box.y).toBe(q.y - SKETCH_GEOMETRY.bandPx);
    expect(box.w).toBe(s.x + s.w - q.x + 2 * SKETCH_GEOMETRY.boxPadPx);
    expect(box.bandH).toBe(SKETCH_GEOMETRY.bandPx);
  });

  it('a shape overlapping a box frame is pushed clear', () => {
    const p = parseSketch(`${SRC}Intruder at: 2 2\n`);
    const l = layoutSketch(p);
    expect(
      l.diagnostics.filter((d) => d.code === 'W_SKETCH_OVERLAP_RESOLVED')
    ).toHaveLength(1);
    const i = node(l, 'Intruder');
    const box = l.boxes[0]!;
    const clear =
      i.x + i.w <= box.x ||
      box.x + box.w <= i.x ||
      i.y + i.h <= box.y ||
      box.y + box.h <= i.y;
    expect(clear).toBe(true);
  });
});

describe('sketch layout — collapse (Pattern B)', () => {
  const SRC = `sketch
App at: 0 0
  -> armory
  -uses-> Powder Store
[Armory] as armory at: 2 0, collapsed
  Powder Store at: 0 0
  Cutlass Rack at: 2 0
`;

  it('folds an authored-collapsed box to a virtual node card', () => {
    const p = parseSketch(SRC);
    const l = layoutSketch(p);
    const card = l.nodes.find((n) => n.isCollapsedBox);
    expect(card).toBeDefined();
    expect(card!.label).toBe('Armory');
    expect(card!.childCount).toBe(2);
    expect(card!.w).toBe(SKETCH_FOOT_W);
    expect(l.boxes).toHaveLength(0);
    expect(l.nodes.find((n) => n.label === 'Powder Store')).toBeUndefined();
  });

  it('re-targets child edges to the virtual node and dedupes', () => {
    const p = parseSketch(SRC);
    const c = collapseSketch(p);
    // Both edges (to box, to child) collapse onto the box id and dedupe
    // only if identical — labels differ here, so both survive re-targeted.
    expect(c.edges).toHaveLength(2);
    expect(c.edges.every((e) => e.targetId === '[armory]')).toBe(true);
  });

  it('an explicit collapsed set overrides authored state', () => {
    const p = parseSketch(SRC);
    const l = layoutSketch(p, { collapsedBoxes: new Set() });
    expect(l.boxes).toHaveLength(1);
    expect(l.nodes.find((n) => n.label === 'Powder Store')).toBeDefined();
  });

  it('drops edges internal to a collapsed box', () => {
    const p = parseSketch(
      'sketch\n[Armory] collapsed\n  A at: 0 0\n    -> b\n  B as b at: 2 0'
    );
    const c = collapseSketch(p);
    expect(c.edges).toHaveLength(0);
  });
});

describe('sketch layout — dimensions', () => {
  it('reports content extent', () => {
    const p = parseSketch('sketch\nA at: 0 0\nB at: 4 0');
    const l = layoutSketch(p);
    expect(l.width).toBe(4 * SKETCH_HALF_SLOT_X + SKETCH_FOOT_W);
    expect(l.height).toBe(SKETCH_FOOT_H);
  });
});
