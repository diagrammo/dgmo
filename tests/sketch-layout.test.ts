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
    // B is 3 half-units right (gap-legal); C is off in y so its non-SEP x=1
    // (half-unit granularity) doesn't collide with A.
    const p = parseSketch('sketch\nA at: 0 0\nB at: 3 0\nC at: 1 6');
    const l = layoutSketch(p);
    expect(node(l, 'A').x).toBe(0);
    expect(node(l, 'A').y).toBe(0);
    expect(node(l, 'B').x).toBe(3 * SKETCH_HALF_SLOT_X);
    expect(node(l, 'C').x).toBe(1 * SKETCH_HALF_SLOT_X);
    expect(node(l, 'C').y).toBe(6 * SKETCH_HALF_SLOT_Y);
    expect(node(l, 'A').w).toBe(SKETCH_FOOT_W);
    expect(node(l, 'A').h).toBe(SKETCH_FOOT_H);
  });

  it('normalizes negative authored coordinates to a 0-based origin', () => {
    const p = parseSketch('sketch\nA at: -3 -3\nB at: 0 0');
    const l = layoutSketch(p);
    expect(node(l, 'A').x).toBe(0);
    expect(node(l, 'A').y).toBe(0);
    expect(node(l, 'B').x).toBe(3 * SKETCH_HALF_SLOT_X);
  });

  it('brick offsets are legal: 1 half-unit apart on x with 3 on y', () => {
    // A footprint spans 2 half-units + a 1-unit gap, so the clear axis needs
    // a full SEP (3) of separation; the other can be a single half-unit.
    const p = parseSketch('sketch\nA at: 0 0\nB at: 1 3');
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
  Ship Ledger at: 3 0
`;

  it('absolutizes box-relative children and wraps the frame around them', () => {
    const p = parseSketch(SRC);
    const l = layoutSketch(p);
    const q = node(l, 'Booty Queue');
    const s = node(l, 'Ship Ledger');
    expect(q.slot).toEqual({ c: 2, r: 2 });
    expect(s.slot).toEqual({ c: 5, r: 2 });
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

describe('sketch layout — auto-layout stage flags', () => {
  const GROUP_SRC = [
    'sketch',
    'Lookout at: 0 9',
    '[Hold] at: 0 0',
    '  Cargo at: 0 0',
    '  Ledger at: 3 0',
  ].join('\n');

  it('all-default flags match the no-options output byte-for-byte', () => {
    const p = parseSketch(GROUP_SRC);
    const plain = layoutSketch(p);
    const flagged = layoutSketch(p, { autoLayout: {} });
    expect(flagged.nodes).toEqual(plain.nodes);
    expect(flagged.boxes).toEqual(plain.boxes);
    expect(flagged.width).toBe(plain.width);
    expect(flagged.height).toBe(plain.height);
  });

  it('resolveOverlap off keeps a colliding authored slot in place', () => {
    const p = parseSketch('sketch\nA at: 0 0\nB at: 0 0');
    const on = layoutSketch(p);
    const off = layoutSketch(p, { autoLayout: { resolveOverlap: false } });
    expect(node(on, 'B').slot).not.toEqual({ c: 0, r: 0 });
    expect(node(off, 'B').slot).toEqual({ c: 0, r: 0 });
    expect(off.diagnostics).toHaveLength(0);
  });

  it('groupCollisionAsRect off lets a root shape sit over a group interior', () => {
    // Shape at the group's right edge: collides with the full frame rect but
    // not with the group's origin cell.
    const p = parseSketch(`${GROUP_SRC}\nSpy at: 3 0`);
    const asRect = layoutSketch(p);
    const asCell = layoutSketch(p, {
      autoLayout: { groupCollisionAsRect: false },
    });
    expect(asRect.diagnostics.length).toBeGreaterThan(0);
    expect(asCell.diagnostics).toHaveLength(0);
    expect(node(asCell, 'Spy').slot).toEqual({ c: 3, r: 0 });
  });

  it('avoidEdges off leaves a flow-placed shape sitting on a foreign edge', () => {
    // All flow-placed in one row: X (0,0), Y (3,0), Z (6,0); the edge X->Z
    // crosses Y. Authored-`at` shapes are exempt (Stage 5), so the flag is
    // observable only on flow-placed shapes.
    const src = 'sketch\nX\n  -> z\nY\nZ as z';
    const p = parseSketch(src);
    const on = layoutSketch(p);
    const off = layoutSketch(p, { autoLayout: { avoidEdges: false } });
    expect(node(on, 'Y').slot).not.toEqual({ c: 3, r: 0 });
    expect(node(off, 'Y').slot).toEqual({ c: 3, r: 0 });
  });

  it('flowPlaceUnpositioned off parks coord-less shapes at the origin', () => {
    const p = parseSketch('sketch\nA at: 0 0\nB\nC');
    const off = layoutSketch(p, {
      autoLayout: { flowPlaceUnpositioned: false },
    });
    expect(node(off, 'B').slot).toEqual({ c: 0, r: 0 });
    expect(node(off, 'C').slot).toEqual({ c: 0, r: 0 });
  });
});

describe('sketch layout — golden: Plunder Pipeline (spec repro)', () => {
  const SRC = `sketch Plunder Pipeline

tag Crew
  Deck
  Hold

Spyglass Feed shape: database, at: 0 0, crew: Deck
  -sightings-> con

[Below Decks] crew: Hold
  Divvy Service as dvy at: 1 -3
    -entries-> ledger
  Captain's Console as con at: -3 0, crew: Deck
    -orders-> bq
  Booty Queue as bq shape: queue, at: 0 0
    ~haul~> dvy
  Ship Ledger as ledger shape: database, at: 2 0
  Powder Store at: -6 0
`;

  const GOLDEN: Record<string, { c: number; r: number }> = {
    'Spyglass Feed': { c: 0, r: 0 },
    'Divvy Service': { c: 13, r: 0 },
    "Captain's Console": { c: 9, r: 3 },
    'Booty Queue': { c: 12, r: 3 },
    'Ship Ledger': { c: 15, r: 3 }, // authored 2 0 bumped clear of Booty Queue
    'Powder Store': { c: 6, r: 3 },
  };

  it('default flags land every node on the golden slots', () => {
    const l = layoutSketch(parseSketch(SRC));
    for (const [label, slot] of Object.entries(GOLDEN)) {
      expect(node(l, label).slot, label).toEqual(slot);
    }
    expect(
      l.diagnostics.filter((d) => d.code === 'W_SKETCH_OVERLAP_RESOLVED')
    ).toHaveLength(1);
  });

  it('sortRootsBySource off yields the same golden slots (one positioned root)', () => {
    const l = layoutSketch(parseSketch(SRC), {
      autoLayout: { sortRootsBySource: false },
    });
    for (const [label, slot] of Object.entries(GOLDEN)) {
      expect(node(l, label).slot, label).toEqual(slot);
    }
  });
});

describe('sketch layout — Stage 3: geometry-derived placement order', () => {
  // Node overlaps the group frame's left edge, so collision resolution must
  // pick a winner. Same shapes, opposite declaration order.
  const NODE_FIRST = [
    'sketch',
    'Spy at: -3 0',
    '[Hold] at: 0 0',
    '  Cargo at: 0 0',
    '  Ledger at: 3 0',
  ].join('\n');
  const NODE_LAST = [
    'sketch',
    '[Hold] at: 0 0',
    '  Cargo at: 0 0',
    '  Ledger at: 3 0',
    'Spy at: -3 0',
  ].join('\n');

  it('sortRootsBySource off: declaration order does not change the layout', () => {
    const first = layoutSketch(parseSketch(NODE_FIRST), {
      autoLayout: { sortRootsBySource: false },
    });
    const last = layoutSketch(parseSketch(NODE_LAST), {
      autoLayout: { sortRootsBySource: false },
    });
    for (const label of ['Spy', 'Cargo', 'Ledger']) {
      expect(node(first, label).slot, label).toEqual(node(last, label).slot);
    }
    expect(first.boxes[0]!.x).toBe(last.boxes[0]!.x);
    expect(first.boxes[0]!.y).toBe(last.boxes[0]!.y);
    // The geometrically-left node wins the contested slot in both.
    expect(node(first, 'Spy').slot).toEqual({ c: -3, r: 0 });
    expect(node(first, 'Spy').x).toBeLessThan(first.boxes[0]!.x);
    expect(node(last, 'Spy').x).toBeLessThan(last.boxes[0]!.x);
  });

  it('sortRootsBySource on (default): declaration order still decides', () => {
    const first = layoutSketch(parseSketch(NODE_FIRST));
    const last = layoutSketch(parseSketch(NODE_LAST));
    // Declared first → keeps its slot; declared last → bumped by the group.
    expect(node(first, 'Spy').slot).toEqual({ c: -3, r: 0 });
    expect(node(last, 'Spy').slot).not.toEqual({ c: -3, r: 0 });
  });

  it('flow-placed roots keep reading order after positioned units', () => {
    const p = parseSketch('sketch\nLate\nB at: 3 0\nEarly\nA at: 0 6');
    const l = layoutSketch(p, { autoLayout: { sortRootsBySource: false } });
    // Positioned by coordinate regardless of line; flow after, by line.
    expect(node(l, 'B').slot).toEqual({ c: 3, r: 0 });
    expect(node(l, 'A').slot).toEqual({ c: 0, r: 6 });
    const late = node(l, 'Late');
    const early = node(l, 'Early');
    expect(late.slot.r).toBe(early.slot.r);
    expect(late.slot.c).toBeLessThan(early.slot.c); // Late declared first
    expect(late.slot.r).toBeGreaterThanOrEqual(9); // below all positioned
  });
});

describe('sketch layout — Stage 5: authored positions exempt from edge-avoidance', () => {
  it('an authored shape crossing a non-incident edge keeps its exact slot', () => {
    // C sits dead-center on the edge A->B but is authored — never nudged,
    // even with all default flags.
    const src = 'sketch\nA at: 0 0\n  -> b\nB as b at: 12 0\nC at: 6 0';
    const l = layoutSketch(parseSketch(src));
    expect(node(l, 'C').slot).toEqual({ c: 6, r: 0 });
    expect(l.diagnostics).toHaveLength(0);
  });

  it('a flow-placed shape in the same spot still gets nudged', () => {
    const src = 'sketch\nX\n  -> z\nY\nZ as z';
    const l = layoutSketch(parseSketch(src));
    expect(node(l, 'X').slot).toEqual({ c: 0, r: 0 });
    expect(node(l, 'Z').slot).toEqual({ c: 6, r: 0 });
    expect(node(l, 'Y').slot).toEqual({ c: 3, r: 3 }); // pushed off the edge
    expect(
      l.diagnostics.filter((d) => d.code === 'W_SKETCH_OVERLAP_RESOLVED')
    ).toHaveLength(1);
  });

  it('an authored collapsed-box card on a foreign edge also stays put', () => {
    const src = [
      'sketch',
      'A at: 0 0',
      '  -> b',
      'B as b at: 12 0',
      '[Cabin] at: 6 0, collapsed',
      '  Bunk at: 0 0',
    ].join('\n');
    const l = layoutSketch(parseSketch(src));
    const card = l.nodes.find((n) => n.isCollapsedBox)!;
    // Centred inside the would-be expanded frame (anchored at 6 0), and
    // deterministic — edge-avoidance must not move it.
    expect(card.slot).toEqual({ c: 6, r: -0 });
  });
});

describe('sketch layout — collapse is positionally stable', () => {
  const SRC = [
    'sketch',
    'Dock at: 0 0',
    '  -> galley',
    '[Galley] as galley at: 6 0%COLLAPSED%',
    '  Stove at: 0 0',
    '  Pantry at: 6 0',
    '  Sink at: 0 3',
    'Mast at: 18 0',
    'Keel at: 0 9',
  ].join('\n');
  const expanded = () =>
    layoutSketch(parseSketch(SRC.replace('%COLLAPSED%', '')));
  const collapsedL = () =>
    layoutSketch(parseSketch(SRC.replace('%COLLAPSED%', ', collapsed')));

  it('collapsing a box moves nothing else', () => {
    const e = expanded();
    const c = collapsedL();
    for (const label of ['Dock', 'Mast', 'Keel']) {
      const en = e.nodes.find((n) => n.label === label)!;
      const cn = c.nodes.find((n) => n.label === label)!;
      expect(cn.slot).toEqual(en.slot);
      expect(cn.x).toBe(en.x);
      expect(cn.y).toBe(en.y);
    }
  });

  it('the card sits at the would-be frame centre, not the anchor corner', () => {
    const e = expanded();
    const c = collapsedL();
    const frame = e.boxes.find((b) => b.label === 'Galley')!;
    const card = c.nodes.find((n) => n.isCollapsedBox)!;
    const frameCx = frame.x + frame.w / 2;
    const frameCy = frame.y + frame.h / 2;
    const cardCx = card.x + card.w / 2;
    const cardCy = card.y + card.h / 2;
    // Within one slot of the true centre (card slot rounds to the lattice).
    expect(Math.abs(cardCx - frameCx)).toBeLessThanOrEqual(30);
    expect(Math.abs(cardCy - frameCy)).toBeLessThanOrEqual(30);
    expect(card.childCount).toBe(3);
  });

  it('collapsing a FLOW-placed box leaves flow neighbours where they were', () => {
    const flowSrc = (collapsed: string) =>
      [
        'sketch',
        'Dock at: 0 0',
        `[Galley]${collapsed}`,
        '  Stove',
        '  Pantry',
        'Mast',
      ].join('\n');
    const e = layoutSketch(parseSketch(flowSrc('')));
    const c = layoutSketch(parseSketch(flowSrc(' collapsed')));
    const em = e.nodes.find((n) => n.label === 'Mast')!;
    const cm = c.nodes.find((n) => n.label === 'Mast')!;
    expect(cm.slot).toEqual(em.slot);
  });
});

describe('sketch layout — frozen origin', () => {
  it('reports the origin used for px mapping', () => {
    const p = parseSketch('sketch\nA at: 2 4\nB at: 6 4');
    const l = layoutSketch(p);
    expect(l.origin).toEqual({ c: 2, r: 4 });
  });

  it('moving one node does not re-shift the others', () => {
    const before = layoutSketch(parseSketch('sketch\nA at: 0 0\nB at: 6 0'), {
      autoLayout: { normalizeOrigin: false },
    });
    const after = layoutSketch(parseSketch('sketch\nA at: 3 3\nB at: 6 0'), {
      autoLayout: { normalizeOrigin: false },
      frozenOrigin: before.origin,
    });
    expect(node(after, 'B').x).toBe(node(before, 'B').x);
    expect(node(after, 'B').y).toBe(node(before, 'B').y);
    expect(node(after, 'A').x).toBe(3 * SKETCH_HALF_SLOT_X);
    expect(node(after, 'A').y).toBe(3 * SKETCH_HALF_SLOT_Y);
  });

  it('clamps to the live min so content never goes negative', () => {
    const l = layoutSketch(parseSketch('sketch\nA at: -3 -3\nB at: 6 0'), {
      autoLayout: { normalizeOrigin: false },
      frozenOrigin: { c: 0, r: 0 },
    });
    expect(node(l, 'A').x).toBe(0);
    expect(node(l, 'A').y).toBe(0);
    expect(l.origin).toEqual({ c: -3, r: -3 });
  });
});
