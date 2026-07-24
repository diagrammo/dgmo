import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';

// Stable collapse layout (anchor + gap-close): interactive collapse freezes
// surviving nodes, anchors the pill at its members' previous bounding-box
// centre, and slides far-side content in to close the vacated gap. Opt-in via
// `stableCollapse` + `previousPositions`; falls back to the placement search
// when coverage is incomplete.

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
  it('freezes surviving nodes relative to each other', async () => {
    const layout = await stableLayout(new Set(['G']), PREV);
    const pos = new Map(layout.nodes.map((n) => [n.label, n]));
    const a = pos.get('A')!;
    const d = pos.get('D')!;
    // A and D are both static (D is right of the pill but the vacated span is
    // vertical, and the horizontal reclaim is zero for a single column).
    expect(d.x - a.x).toBeCloseTo(400, 5);
    expect(d.y - a.y).toBeCloseTo(0, 5);
  });

  it('anchors the pill at the members previous bounding-box centre', async () => {
    const layout = await stableLayout(new Set(['G']), PREV);
    const pos = new Map(layout.nodes.map((n) => [n.label, n]));
    const pill = layout.groups.find((g) => g.label === 'G' && g.collapsed)!;
    expect(pill).toBeDefined();
    const a = pos.get('A')!;
    // Members bbox centre was (300, 150) vs A at (100, 150).
    expect(pill.x - a.x).toBeCloseTo(200, 5);
    expect(pill.y - a.y).toBeCloseTo(0, 5);
    expect(pill.childCount).toBe(2);
  });

  it('closes the vacated vertical gap without colliding', async () => {
    const layout = await stableLayout(new Set(['G']), PREV);
    const pos = new Map(layout.nodes.map((n) => [n.label, n]));
    const a = pos.get('A')!;
    const e = pos.get('E')!;
    // E sat 250px below A; the collapsed column vacates vertical space and E
    // slides up — but never within the 36px clearance of A's box.
    expect(e.y - a.y).toBeLessThan(250);
    expect(e.y - a.y).toBeGreaterThanOrEqual(
      a.height / 2 + e.height / 2 + 36 - 1e-6
    );
  });

  it('routes edges as straight border-to-border segments', async () => {
    const layout = await stableLayout(new Set(['G']), PREV);
    for (const e of layout.edges) {
      expect(e.points).toHaveLength(2);
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
