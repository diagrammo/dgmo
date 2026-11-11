import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';

// Stable collapse layout (anchor + compaction): interactive collapse freezes
// surviving nodes, puts a top-level pill in its group's slot (the old frame's
// top-left), and closes up what follows while keeping the order (#1784).
// Opt-in via `stableCollapse` + `previousPositions`; falls back to the
// placement search when coverage is incomplete.

const HEADER = 'boxes-and-lines';

const CONTENT = [
  HEADER,
  'A',
  '  -e1-> B',
  '  -e2-> C',
  '[G]',
  '  B',
  '  C',
  'B',
  '  -e3-> D',
  'E',
].join('\n');

// Hand-crafted "previous" layout (centre coords): A feeds the G column
// (B above, C below), D sits to the right, E hangs below-left.
const PREV = new Map([
  ['A', { x: 100, y: 150 }],
  ['B', { x: 300, y: 60 }],
  ['C', { x: 300, y: 240 }],
  ['D', { x: 500, y: 150 }],
  ['E', { x: 100, y: 400 }],
]);

async function stableLayout(
  collapsed: Set<string>,
  prev: ReadonlyMap<string, { x: number; y: number }>
) {
  const parsed = parseBoxesAndLines(CONTENT);
  const cr = collapseBoxesAndLines(parsed, collapsed);
  return layoutBoxesAndLines(
    cr.parsed,
    {
      collapsedChildCounts: cr.collapsedChildCounts,
      originalGroups: cr.originalGroups,
    },
    { previousPositions: prev, stableCollapse: true }
  );
}

describe('stable collapse layout', () => {
  it('closes up what follows the pill by exactly the space the group freed', async () => {
    const layout = await stableLayout(new Set(['G']), PREV);
    const pos = new Map(layout.nodes.map((n) => [n.label, n]));
    const a = pos.get('A')!;
    const d = pos.get('D')!;
    // G's frame was 129 wide (97 + 2×16 padding); the pill is 97, so D, which
    // sat after G, closes up by 32 and keeps its old 87px spacing to G's slot.
    expect(d.x - a.x).toBeCloseTo(368, 5);
    expect(d.y - a.y).toBeCloseTo(0, 5);
  });

  it("puts a top-level pill at the top-left of its group's old frame", async () => {
    const layout = await stableLayout(new Set(['G']), PREV);
    const pos = new Map(layout.nodes.map((n) => [n.label, n]));
    const pill = layout.groups.find((g) => g.label === 'G' && g.collapsed)!;
    expect(pill).toBeDefined();
    const a = pos.get('A')!;
    // Frame: members x 251.5–348.5, y 30–270, padded 16 and a 32 label zone →
    // left 235.5, top −18. Pill centre = (235.5 + 48.5, −18 + 30) = (284, 12).
    expect(pill.x - a.x).toBeCloseTo(184, 5);
    expect(pill.y - a.y).toBeCloseTo(-138, 5);
    expect(pill.childCount).toBe(2);
  });

  it('leaves a gap the collapse did not free', async () => {
    const layout = await stableLayout(new Set(['G']), PREV);
    const pos = new Map(layout.nodes.map((n) => [n.label, n]));
    const a = pos.get('A')!;
    const e = pos.get('E')!;
    // E sits below A, not below G, so nothing was freed above it.
    expect(e.y - a.y).toBeCloseTo(250, 5);
    expect(e.x - a.x).toBeCloseTo(0, 5);
  });

  it('routes edges as straight border-to-border segments', async () => {
    const layout = await stableLayout(new Set(['G']), PREV);
    for (const e of layout.edges) {
      // A pair redirected onto the same collapsed pill is parallel, and a
      // parallel edge carries the 5-point fan rather than a straight segment.
      // That is not new on screen: the renderer built the fan itself from
      // `yOffset` and threw the 2-point polyline away, so these two edges have
      // always been DRAWN fanned. The fan moved into layout with #640 so the
      // edge label is placed against the curve the reader actually sees; the
      // picture is unchanged, and this assertion was reading a value that never
      // reached it.
      const fanned = e.parallelCount > 1 && e.yOffset !== 0;
      expect(e.points).toHaveLength(fanned ? 5 : 2);
      for (const p of e.points) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
    // Redirected edges target the pill.
    const toPill = layout.edges.filter((e) => e.target === '__group_G');
    expect(toPill.length).toBeGreaterThan(0);
  });

  it('reuses the previous pill position when the group was already collapsed', async () => {
    const prev = new Map([
      ['A', { x: 100, y: 150 }],
      ['D', { x: 500, y: 150 }],
      ['E', { x: 100, y: 400 }],
      ['__group_G', { x: 320, y: 170 }],
    ]);
    const layout = await stableLayout(new Set(['G']), prev);
    const pos = new Map(layout.nodes.map((n) => [n.label, n]));
    const pill = layout.groups.find((g) => g.label === 'G' && g.collapsed)!;
    const a = pos.get('A')!;
    expect(pill.x - a.x).toBeCloseTo(220, 5);
    expect(pill.y - a.y).toBeCloseTo(20, 5);
  });

  it('falls back to the placement search when coverage is incomplete', async () => {
    // Previous positions missing node E → stable path bails, search runs.
    const prev = new Map([
      ['A', { x: 100, y: 150 }],
      ['B', { x: 300, y: 60 }],
      ['C', { x: 300, y: 240 }],
      ['D', { x: 500, y: 150 }],
    ]);
    const layout = await stableLayout(new Set(['G']), prev);
    expect(layout.nodes.map((n) => n.label).sort()).toEqual(['A', 'D', 'E']);
    expect(layout.groups.some((g) => g.label === 'G' && g.collapsed)).toBe(
      true
    );
  });

  it('keeps normalized canvas coordinates positive', async () => {
    const layout = await stableLayout(new Set(['G']), PREV);
    for (const n of layout.nodes) {
      expect(n.x - n.width / 2).toBeGreaterThanOrEqual(0);
      expect(n.y - n.height / 2).toBeGreaterThanOrEqual(0);
    }
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

// #1784 — collapse keeps the ORDER, not the coordinates: a pill takes its
// group's slot and the groups after it close up to their old spacing.
describe('stable collapse closes the gaps and keeps the order (#1784)', () => {
  type Box = {
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  const top = (b: Box) => b.y - b.height / 2;
  const bottom = (b: Box) => b.y + b.height / 2;
  const seed = (l: Awaited<ReturnType<typeof layoutBoxesAndLines>>) => {
    const m = new Map(l.nodes.map((n) => [n.label, { x: n.x, y: n.y }]));
    for (const g of l.groups)
      if (g.collapsed) m.set(`__group_${g.label}`, { x: g.x, y: g.y });
    return m;
  };
  const layoutOf = async (
    src: string,
    collapsed: Set<string>,
    prev?: ReadonlyMap<string, { x: number; y: number }>
  ) => {
    const cr = collapseBoxesAndLines(parseBoxesAndLines(src), collapsed);
    return layoutBoxesAndLines(
      cr.parsed,
      {
        collapsedChildCounts: cr.collapsedChildCounts,
        originalGroups: cr.originalGroups,
      },
      { ...(prev && { previousPositions: prev }), stableCollapse: true }
    );
  };

  it('a stacked pill keeps both of its old spacings', async () => {
    const src = [
      HEADER,
      '[X]',
      '  x1',
      '  x2',
      '[Y]',
      '  y1',
      '  y2',
      '  y3',
      '[Z]',
      '  z1',
    ].join('\n');
    const prev = new Map([
      ['x1', { x: 100, y: 100 }],
      ['x2', { x: 250, y: 100 }],
      ['y1', { x: 100, y: 300 }],
      ['y2', { x: 100, y: 400 }],
      ['y3', { x: 100, y: 500 }],
      ['z1', { x: 100, y: 700 }],
    ]);
    const layout = await layoutOf(src, new Set(['Y']), prev);
    const g = new Map(layout.groups.map((b) => [b.label, b]));
    const x = g.get('X')!;
    const y = g.get('Y')!;
    const z = g.get('Z')!;
    expect(y.collapsed).toBe(true);
    // Old frames: X bottom 146, Y 222–546, Z top 622 → both spacings 76.
    expect(top(y) - bottom(x)).toBeCloseTo(76, 5);
    expect(top(z) - bottom(y)).toBeCloseTo(76, 5);
    // The pill sits at the left edge of Y's slot, aligned with X and Z.
    expect(y.x - y.width / 2).toBeCloseTo(x.x - x.width / 2, 5);
  });

  it("the report's source: collapse 2, then 2+3, then 2+3+4", async () => {
    const src = readFileSync(
      'tests/fixtures/boxes-and-lines-collapse-gaps.dgmo',
      'utf8'
    );
    const L = parseBoxesAndLines(src).groups.map((g) => g.label);
    expect(L).toHaveLength(4);
    const tops = (l: Awaited<ReturnType<typeof layoutBoxesAndLines>>) =>
      l.groups
        .filter((g) => L.includes(g.label))
        .sort((a, b) => top(a) - top(b));
    const maxGap = (boxes: Box[]) => {
      let gap = 0;
      let end = bottom(boxes[0]!);
      for (const b of boxes.slice(1)) {
        gap = Math.max(gap, top(b) - end);
        end = Math.max(end, bottom(b));
      }
      return gap;
    };

    const base = await layoutOf(src, new Set());
    const order = tops(base).map((b) => b.label);
    const normalGap = maxGap(tops(base));

    let prev = base;
    const collapsed = new Set<string>();
    for (const idx of [1, 2, 3]) {
      collapsed.add(L[idx]!);
      const next = await layoutOf(src, new Set(collapsed), seed(prev));
      const boxes = tops(next);
      // Every collapsed group shows as a pill; the stack order is unchanged.
      for (const label of collapsed)
        expect(next.groups.find((g) => g.label === label)?.collapsed).toBe(
          true
        );
      expect(boxes.map((b) => b.label)).toEqual(order);
      // No gap wider than the uncollapsed diagram's own group spacing.
      expect(maxGap(boxes)).toBeLessThanOrEqual(normalGap + 1e-6);
      // Survivors keep their relative placement (the stable path ran).
      const was = new Map(prev.nodes.map((n) => [n.label, n]));
      const ref = next.nodes[0]!;
      const refWas = was.get(ref.label)!;
      for (const n of next.nodes) {
        const w = was.get(n.label)!;
        expect(n.x - ref.x).toBeCloseTo(w.x - refWas.x, 5);
      }
      prev = next;
    }
  });
});
