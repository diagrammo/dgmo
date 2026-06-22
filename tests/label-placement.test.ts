import { describe, it, expect } from 'vitest';
import {
  measureEdgeLabel,
  placeEdgeLabels,
  EDGE_LABEL_FONT_SIZE,
} from '../src/boxes-and-lines/label-placement';
import type {
  BLLayoutResult,
  BLLayoutEdge,
  BLLayoutNode,
} from '../src/boxes-and-lines/layout';
import { measureText } from '../src/utils/text-measure';

const MAX = 160;

function node(
  label: string,
  x: number,
  y: number,
  w = 60,
  h = 40
): BLLayoutNode {
  return { label, x, y, width: w, height: h };
}

function edge(
  partial: Partial<BLLayoutEdge> & {
    points: { x: number; y: number }[];
  }
): BLLayoutEdge {
  return {
    source: 'A',
    target: 'B',
    bidirectional: false,
    lineNumber: 1,
    yOffset: 0,
    parallelCount: 1,
    metadata: {},
    ...partial,
  };
}

function layout(nodes: BLLayoutNode[], edges: BLLayoutEdge[]): BLLayoutResult {
  return { nodes, edges, groups: [], width: 1000, height: 1000 };
}

// Build the obstacle rect for a label box, to assert clearance in tests.
function overlaps(
  cx: number,
  cy: number,
  w: number,
  h: number,
  n: BLLayoutNode
): boolean {
  return (
    cx - w / 2 < n.x + n.width / 2 &&
    cx + w / 2 > n.x - n.width / 2 &&
    cy - h / 2 < n.y + n.height / 2 &&
    cy + h / 2 > n.y - n.height / 2
  );
}

describe('measureEdgeLabel — wrap + cap', () => {
  it('keeps a short label on one line', () => {
    const m = measureEdgeLabel('calls');
    expect(m.lines).toEqual(['calls']);
    expect(m.width).toBeGreaterThan(0);
  });

  it('wraps a long multi-word label, each line within maxWidth', () => {
    const m = measureEdgeLabel('reads the styling guidance document carefully');
    expect(m.lines.length).toBeGreaterThan(1);
    for (const line of m.lines)
      expect(measureText(line, EDGE_LABEL_FONT_SIZE)).toBeLessThanOrEqual(MAX);
  });

  it('hard-breaks an unbreakable long token to fit maxWidth', () => {
    const m = measureEdgeLabel('get_language_reference_supercalifragilistic');
    expect(m.lines.length).toBeGreaterThan(1);
    for (const line of m.lines)
      expect(measureText(line, EDGE_LABEL_FONT_SIZE)).toBeLessThanOrEqual(MAX);
  });

  it('caps at 3 lines (ellipsizes the overflow)', () => {
    const m = measureEdgeLabel(
      'one two three four five six seven eight nine ten eleven twelve thirteen'
    );
    expect(m.lines.length).toBeLessThanOrEqual(3);
  });
});

describe('placeEdgeLabels — collision-aware positioning', () => {
  it('writes labelLines/box fields onto labeled edges', () => {
    const lay = layout(
      [node('A', 0, 0), node('B', 300, 0)],
      [
        edge({
          label: 'calls',
          points: [
            { x: 30, y: 0 },
            { x: 270, y: 0 },
          ],
        }),
      ]
    );
    const { layout: out } = placeEdgeLabels(lay);
    const e = out.edges[0]!;
    expect(e.labelLines).toEqual(['calls']);
    expect(e.labelWidth).toBeGreaterThan(0);
    expect(e.labelHeight).toBeGreaterThan(0);
    expect(e.labelX).toBeDefined();
    expect(e.labelY).toBeDefined();
  });

  it('repositions a label off a node it would otherwise overlap', () => {
    // Two boxes close together: the midpoint label box straddles both nodes.
    const a = node('A', 0, 0);
    const b = node('B', 80, 0);
    const lay = layout(
      [a, b],
      [
        edge({
          label: 'plain English',
          points: [
            { x: 30, y: 0 },
            { x: 50, y: 0 },
          ],
        }),
      ]
    );
    const { layout: out, unresolved } = placeEdgeLabels(lay);
    const e = out.edges[0]!;
    expect(unresolved).toHaveLength(0);
    // Final box clears BOTH node boxes.
    expect(
      overlaps(e.labelX!, e.labelY!, e.labelWidth!, e.labelHeight!, a)
    ).toBe(false);
    expect(
      overlaps(e.labelX!, e.labelY!, e.labelWidth!, e.labelHeight!, b)
    ).toBe(false);
    // Pushed off the line (perpendicular) but stayed proximal in x.
    expect(Math.abs(e.labelY!)).toBeGreaterThan(0);
  });

  it('reports unresolved when a label is boxed in on all sides', () => {
    // A central edge surrounded by nodes above and below — no clear spot within
    // the perpendicular budget.
    const lay = layout(
      [
        node('A', 0, 0, 60, 40),
        node('B', 80, 0, 60, 40),
        node('C', 40, -45, 200, 40),
        node('D', 40, 45, 200, 40),
      ],
      [
        edge({
          label: 'a fairly long label here',
          points: [
            { x: 30, y: 0 },
            { x: 50, y: 0 },
          ],
        }),
      ]
    );
    const { unresolved } = placeEdgeLabels(lay);
    expect(unresolved).toContain(0);
  });

  it('folds in the parallel-edge offset so stacked labels separate', () => {
    const lay = layout(
      [node('A', 0, 0), node('B', 400, 0)],
      [
        edge({
          label: 'up',
          lineNumber: 1,
          yOffset: -22,
          parallelCount: 2,
          points: [
            { x: 30, y: 0 },
            { x: 370, y: 0 },
          ],
        }),
        edge({
          label: 'down',
          lineNumber: 2,
          yOffset: 22,
          parallelCount: 2,
          points: [
            { x: 30, y: 0 },
            { x: 370, y: 0 },
          ],
        }),
      ]
    );
    const { layout: out } = placeEdgeLabels(lay);
    const up = out.edges[0]!;
    const down = out.edges[1]!;
    expect(up.labelY!).toBeLessThan(down.labelY!);
  });
});
