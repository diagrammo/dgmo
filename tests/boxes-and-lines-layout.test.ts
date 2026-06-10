import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';

describe('boxes-and-lines layout', () => {
  it('returns a Promise', () => {
    const parsed = parseBoxesAndLines('boxes-and-lines\nA\n  -> B');
    const result = layoutBoxesAndLines(parsed);
    expect(result).toBeInstanceOf(Promise);
  });

  it('lays out a simple 2-node graph', async () => {
    const parsed = parseBoxesAndLines('boxes-and-lines\nA\n  -> B');
    const layout = await layoutBoxesAndLines(parsed);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(1);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    // Both nodes should have positive coords
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThan(0);
      expect(n.y).toBeGreaterThan(0);
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
    }
  });

  it('routes edges with polyline points', async () => {
    const parsed = parseBoxesAndLines('boxes-and-lines\nA\n  -> B');
    const layout = await layoutBoxesAndLines(parsed);
    const edge = layout.edges[0];
    expect(edge.source).toBe('A');
    expect(edge.target).toBe('B');
    expect(edge.points.length).toBeGreaterThanOrEqual(2);
    // First point should be near A's right edge, last near B's left edge (LR default)
    const a = layout.nodes.find((n) => n.label === 'A')!;
    const b = layout.nodes.find((n) => n.label === 'B')!;
    expect(edge.points[0].x).toBeGreaterThan(a.x);
    expect(edge.points[edge.points.length - 1].x).toBeLessThan(b.x);
  });

  it('places nodes inside their expanded group container', async () => {
    const parsed = parseBoxesAndLines(
      'boxes-and-lines\n[G]\n  A\n  B\n  A -> B'
    );
    const layout = await layoutBoxesAndLines(parsed);
    expect(layout.groups).toHaveLength(1);
    const g = layout.groups[0];
    const a = layout.nodes.find((n) => n.label === 'A')!;
    const b = layout.nodes.find((n) => n.label === 'B')!;
    // Each node's center must be inside the group's bounding box
    for (const n of [a, b]) {
      expect(n.x).toBeGreaterThan(g.x - g.width / 2);
      expect(n.x).toBeLessThan(g.x + g.width / 2);
      expect(n.y).toBeGreaterThan(g.y - g.height / 2);
      expect(n.y).toBeLessThan(g.y + g.height / 2);
    }
  });

  it('treats collapsed group as a single node', async () => {
    const parsed = parseBoxesAndLines(
      'boxes-and-lines\n[G]\n  A\n  B\n  A -> B\nC\n  -> A'
    );
    const cr = collapseBoxesAndLines(parsed, new Set(['G']));
    const layout = await layoutBoxesAndLines(cr.parsed, {
      collapsedChildCounts: cr.collapsedChildCounts,
      originalGroups: cr.originalGroups,
    });
    // G is collapsed → not in nodes, but in groups with collapsed=true
    expect(layout.nodes.find((n) => n.label === 'A')).toBeUndefined();
    expect(layout.nodes.find((n) => n.label === 'B')).toBeUndefined();
    expect(layout.nodes.find((n) => n.label === 'C')).toBeDefined();
    const collapsed = layout.groups.find((g) => g.label === 'G');
    expect(collapsed).toBeDefined();
    expect(collapsed!.collapsed).toBe(true);
    expect(collapsed!.childCount).toBe(2);
  });

  it('redirects edges to collapsed group', async () => {
    const parsed = parseBoxesAndLines(
      'boxes-and-lines\n[G]\n  A\n  B\nC\n  -> A'
    );
    const cr = collapseBoxesAndLines(parsed, new Set(['G']));
    const layout = await layoutBoxesAndLines(cr.parsed, {
      collapsedChildCounts: cr.collapsedChildCounts,
      originalGroups: cr.originalGroups,
    });
    // The C -> A edge should now point to __group_G
    const edge = layout.edges.find((e) => e.source === 'C');
    expect(edge).toBeDefined();
    expect(edge!.target).toBe('__group_G');
  });

  it('honors direction TB (top-to-bottom)', async () => {
    const parsed = parseBoxesAndLines(
      'boxes-and-lines\ndirection TB\nA\n  -> B'
    );
    const layout = await layoutBoxesAndLines(parsed);
    const a = layout.nodes.find((n) => n.label === 'A')!;
    const b = layout.nodes.find((n) => n.label === 'B')!;
    // In TB layout, target should be below source
    expect(b.y).toBeGreaterThan(a.y);
  });

  it('returns empty-ish result for empty parsed graph', async () => {
    const parsed = parseBoxesAndLines('boxes-and-lines');
    const layout = await layoutBoxesAndLines(parsed);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
  });

  it('produces no crossings on a simple chain', async () => {
    const parsed = parseBoxesAndLines(
      'boxes-and-lines\nA\n  -> B\nB\n  -> C\nC\n  -> D'
    );
    const layout = await layoutBoxesAndLines(parsed);
    // 4-node linear chain — should layout cleanly
    expect(layout.nodes).toHaveLength(4);
    expect(layout.edges).toHaveLength(3);
  });

  it('finishes in reasonable time on a medium graph', async () => {
    // 10 nodes, 12 edges, 2 groups
    const src = `boxes-and-lines
[G1]
  A
  B
  A -> B
[G2]
  C
  D
  C -> D
E
F
G
H
A -> C
B -> D
E -> F
F -> G
G -> H
H -> E
A -> E
D -> H`;
    const parsed = parseBoxesAndLines(src);
    await layoutBoxesAndLines(parsed); // warm up the dynamic import + dagre init
    const t0 = performance.now();
    const layout = await layoutBoxesAndLines(parsed);
    const elapsed = performance.now() - t0;
    expect(layout.nodes.length).toBeGreaterThan(0);
    // Budget: the placement-search engine runs a multi-seed search (steady-state
    // ~250-320ms here; up to ~950ms on hard graphs). Generous bound so it stays a
    // "doesn't hang" guard, not a flake under contended CI.
    expect(elapsed).toBeLessThan(2000);
  });

  // Regression: group-incident edges used to crash dagre ("Cannot set
  // properties of undefined (setting 'rank')") because an edge endpoint was a
  // compound cluster node. They are now routed through a representative member
  // and clipped back to the group boundary. See spec §13.3 / §13.5.
  describe('group-incident edges (§13.3/§13.5)', () => {
    const inside = (
      p: { x: number; y: number },
      g: { x: number; y: number; width: number; height: number }
    ) =>
      Math.abs(p.x - g.x) <= g.width / 2 + 0.5 &&
      Math.abs(p.y - g.y) <= g.height / 2 + 0.5;

    it('routes a group -> node edge from the group boundary', async () => {
      const parsed = parseBoxesAndLines(
        ['boxes-and-lines', '[G]', '  A', '  -> B', 'B'].join('\n')
      );
      const layout = await layoutBoxesAndLines(parsed);
      const edge = layout.edges.find((e) => e.target === 'B')!;
      expect(edge).toBeDefined();
      expect(edge.source).toBe('__group_G');
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
      const grp = layout.groups.find((g) => g.label === 'G')!;
      // First point sits on (not inside) the group rect; last point is outside.
      expect(inside(edge.points[edge.points.length - 1], grp)).toBe(false);
    });

    it('routes a node -> group edge into the group boundary', async () => {
      const parsed = parseBoxesAndLines(
        ['boxes-and-lines', 'A -> [G]', '[G]', '  B', '  C'].join('\n')
      );
      const layout = await layoutBoxesAndLines(parsed);
      const edge = layout.edges.find((e) => e.source === 'A')!;
      expect(edge.target).toBe('__group_G');
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
    });

    it('routes a group -> group edge between two boundaries', async () => {
      const parsed = parseBoxesAndLines(
        ['boxes-and-lines', '[A] -> [B]', '[A]', '  X', '[B]', '  Y'].join('\n')
      );
      const layout = await layoutBoxesAndLines(parsed);
      const edge = layout.edges[0];
      expect(edge.source).toBe('__group_A');
      expect(edge.target).toBe('__group_B');
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
    });
  });
});
