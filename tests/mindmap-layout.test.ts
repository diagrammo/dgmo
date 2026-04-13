import { describe, it, expect } from 'vitest';
import { parseMindmap } from '../src/mindmap/parser';
import { layoutMindmap } from '../src/mindmap/layout';
import { getPalette } from '../src/palettes';

const palette = getPalette('bold').light;

describe('layoutMindmap', () => {
  it('single node: root centered, no NaN/Infinity', () => {
    const parsed = parseMindmap('mindmap My Idea');
    const layout = layoutMindmap(parsed, palette);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toHaveLength(0);
    const root = layout.nodes[0];
    expect(Number.isFinite(root.x)).toBe(true);
    expect(Number.isFinite(root.y)).toBe(true);
    expect(root.width).toBeGreaterThan(0);
    expect(root.height).toBeGreaterThan(0);
  });

  it('one root + one child: two nodes, one edge', () => {
    const parsed = parseMindmap('mindmap Root\n  Child');
    const layout = layoutMindmap(parsed, palette);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].sourceId).toBe(layout.nodes[0].id);
    expect(layout.edges[0].targetId).toBe(layout.nodes[1].id);
  });

  it('balanced tree: nodes positioned without NaN', () => {
    const parsed = parseMindmap(
      `mindmap Root
  A
    A1
    A2
  B
    B1
    B2`
    );
    const layout = layoutMindmap(parsed, palette);
    expect(layout.nodes).toHaveLength(7);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it('children split into right and left sides', () => {
    const parsed = parseMindmap(
      `mindmap Root
  A
  B
  C
  D`
    );
    const layout = layoutMindmap(parsed, palette);
    const root = layout.nodes.find((n) => n.label === 'Root')!;
    const rootCenterX = root.x + root.width / 2;

    // Some children should be right of root, some left
    const childNodes = layout.nodes.filter((n) => n.label !== 'Root');
    const rightNodes = childNodes.filter((n) => n.x > rootCenterX);
    const leftNodes = childNodes.filter((n) => n.x + n.width < rootCenterX);
    expect(rightNodes.length).toBeGreaterThan(0);
    expect(leftNodes.length).toBeGreaterThan(0);
  });

  it('nodes at same depth on the same side share the same X coordinate', () => {
    const parsed = parseMindmap(
      `mindmap Root
  A
    A1
    A2`
    );
    const layout = layoutMindmap(parsed, palette);
    // A1, A2 are siblings at the same depth on the same side — same X
    const a1 = layout.nodes.find((n) => n.label === 'A1')!;
    const a2 = layout.nodes.find((n) => n.label === 'A2')!;
    expect(a1.x).toBe(a2.x);
  });

  it('multi-root: two trees side by side, no overlap', () => {
    const parsed = parseMindmap(
      `mindmap

Q1 Goals
  Ship MVP
Q2 Goals
  Launch`
    );
    const layout = layoutMindmap(parsed, palette);
    expect(layout.nodes).toHaveLength(4);

    const q1Nodes = layout.nodes.filter(
      (n) => n.label === 'Q1 Goals' || n.label === 'Ship MVP'
    );
    const q2Nodes = layout.nodes.filter(
      (n) => n.label === 'Q2 Goals' || n.label === 'Launch'
    );

    const q1MaxX = Math.max(...q1Nodes.map((n) => n.x + n.width));
    const q2MinX = Math.min(...q2Nodes.map((n) => n.x));
    expect(q2MinX).toBeGreaterThanOrEqual(q1MaxX - 1);
  });

  it('collapsed nodes: hiddenCount set correctly', () => {
    const parsed = parseMindmap(
      `mindmap Root
  Branch
    Child1
    Child2`
    );
    const hiddenCounts = new Map([['node-2', 2]]);
    const layout = layoutMindmap(parsed, palette, { hiddenCounts });
    const branchNode = layout.nodes.find((n) => n.label === 'Branch');
    expect(branchNode?.hiddenCount).toBe(2);
  });

  it('root node width is wider than children', () => {
    const parsed = parseMindmap(
      `mindmap Root
  Child`
    );
    const layout = layoutMindmap(parsed, palette);
    const root = layout.nodes.find((n) => n.label === 'Root')!;
    const child = layout.nodes.find((n) => n.label === 'Child')!;
    expect(root.width).toBeGreaterThan(child.width);
  });

  it('edges have valid SVG paths with M and L commands', () => {
    const parsed = parseMindmap(
      `mindmap Root
  A
  B`
    );
    const layout = layoutMindmap(parsed, palette);
    expect(layout.edges.length).toBeGreaterThan(0);
    for (const edge of layout.edges) {
      expect(edge.path).toMatch(/^M\s/);
      expect(edge.path).toContain('L');
    }
  });

  it('layout dimensions are positive', () => {
    const parsed = parseMindmap(
      `mindmap Root
  A
    B`
    );
    const layout = layoutMindmap(parsed, palette);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('hasChildren flag set on nodes with children', () => {
    const parsed = parseMindmap(
      `mindmap Root
  Parent
    Child
  Leaf`
    );
    const layout = layoutMindmap(parsed, palette);
    const root = layout.nodes.find((n) => n.label === 'Root')!;
    const parent = layout.nodes.find((n) => n.label === 'Parent')!;
    const leaf = layout.nodes.find((n) => n.label === 'Leaf')!;
    expect(root.hasChildren).toBe(true);
    expect(parent.hasChildren).toBe(true);
    expect(leaf.hasChildren).toBe(false);
  });

  it('no node overlaps', () => {
    const parsed = parseMindmap(
      `mindmap Root
  A
    A1
    A2
    A3
  B
    B1
    B2
  C
  D`
    );
    const layout = layoutMindmap(parsed, palette);
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        const overlapX = !(a.x + a.width <= b.x || b.x + b.width <= a.x);
        const overlapY = !(a.y + a.height <= b.y || b.y + b.height <= a.y);
        if (overlapX && overlapY) {
          throw new Error(
            `Nodes "${a.label}" and "${b.label}" overlap at (${a.x},${a.y}) and (${b.x},${b.y})`
          );
        }
      }
    }
  });
});
