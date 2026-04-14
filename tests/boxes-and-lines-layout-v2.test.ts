import { describe, it, expect } from 'vitest';
import { layoutBoxesAndLinesV2 } from '../src/boxes-and-lines/layout-v2';
import type { ParsedBoxesAndLines } from '../src/boxes-and-lines/types';

function makeParsed(
  overrides: Partial<ParsedBoxesAndLines> = {}
): ParsedBoxesAndLines {
  return {
    type: 'boxes-and-lines',
    title: null,
    titleLineNumber: null,
    nodes: [],
    edges: [],
    groups: [],
    tagGroups: [],
    options: {},
    initialHiddenTagValues: new Map(),
    direction: 'LR',
    diagnostics: [],
    error: null,
    ...overrides,
  };
}

function node(label: string, lineNumber = 1) {
  return { label, lineNumber, metadata: {} };
}

function edge(
  source: string,
  target: string,
  opts: { label?: string; bidirectional?: boolean; lineNumber?: number } = {}
) {
  return {
    source,
    target,
    label: opts.label,
    bidirectional: opts.bidirectional ?? false,
    lineNumber: opts.lineNumber ?? 1,
    metadata: {},
  };
}

describe('layoutBoxesAndLinesV2', () => {
  describe('basic layout', () => {
    it('lays out a single node', () => {
      const parsed = makeParsed({ nodes: [node('A')] });
      const result = layoutBoxesAndLinesV2(parsed);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].label).toBe('A');
      expect(result.nodes[0].width).toBeGreaterThan(0);
      expect(result.nodes[0].height).toBeGreaterThan(0);
      expect(result.edges).toHaveLength(0);
    });

    it('lays out a simple chain A → B → C', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B'), node('C')],
        edges: [edge('A', 'B'), edge('B', 'C')],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      expect(result.nodes).toHaveLength(3);
      expect(result.edges).toHaveLength(2);
      expect(result.direction).toBe('LR');

      // In LR direction, ranks increase in X
      const nodeMap = new Map(result.nodes.map((n) => [n.label, n]));
      expect(nodeMap.get('A')!.rank).toBeLessThan(nodeMap.get('B')!.rank);
      expect(nodeMap.get('B')!.rank).toBeLessThan(nodeMap.get('C')!.rank);
    });

    it('supports TB direction', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B')],
        edges: [edge('A', 'B')],
        direction: 'TB',
      });
      const result = layoutBoxesAndLinesV2(parsed);

      expect(result.direction).toBe('TB');
      const nodeMap = new Map(result.nodes.map((n) => [n.label, n]));
      // In TB, lower rank → lower Y
      expect(nodeMap.get('A')!.y).toBeLessThan(nodeMap.get('B')!.y);
    });
  });

  describe('cycle breaking', () => {
    it('handles a simple cycle A → B → C → A', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B'), node('C')],
        edges: [edge('A', 'B'), edge('B', 'C'), edge('C', 'A')],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      expect(result.nodes).toHaveLength(3);
      // At least one edge should be marked reversed
      expect(result.reversedEdges.length).toBeGreaterThan(0);
    });

    it('handles self-referencing edges', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B')],
        edges: [edge('A', 'A'), edge('A', 'B')],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      const selfEdge = result.edges.find((e) => e.selfRef);
      expect(selfEdge).toBeDefined();
      expect(selfEdge!.source).toBe('A');
      expect(selfEdge!.target).toBe('A');
    });
  });

  describe('spine detection', () => {
    it('identifies spine in a chain', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B'), node('C'), node('D')],
        edges: [edge('A', 'B'), edge('B', 'C'), edge('C', 'D')],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      // All nodes in the chain should be on the spine
      expect(result.spineNodeLabels).toContain('A');
      expect(result.spineNodeLabels).toContain('D');
    });

    it('identifies spine in a diamond graph', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B'), node('C'), node('D')],
        edges: [edge('A', 'B'), edge('A', 'C'), edge('B', 'D'), edge('C', 'D')],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      // Spine should be the longest path: A → B → D or A → C → D
      expect(result.spineNodeLabels).toContain('A');
      expect(result.spineNodeLabels).toContain('D');
      expect(result.spineNodeLabels.length).toBe(3);
    });
  });

  describe('rank assignment', () => {
    it('assigns correct ranks for a chain', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B'), node('C')],
        edges: [edge('A', 'B'), edge('B', 'C')],
      });
      const result = layoutBoxesAndLinesV2(parsed);
      const nodeMap = new Map(result.nodes.map((n) => [n.label, n]));

      expect(nodeMap.get('A')!.rank).toBe(0);
      expect(nodeMap.get('B')!.rank).toBe(1);
      expect(nodeMap.get('C')!.rank).toBe(2);
    });

    it('assigns correct ranks for fan-out', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B'), node('C'), node('D')],
        edges: [edge('A', 'B'), edge('A', 'C'), edge('A', 'D')],
      });
      const result = layoutBoxesAndLinesV2(parsed);
      const nodeMap = new Map(result.nodes.map((n) => [n.label, n]));

      expect(nodeMap.get('A')!.rank).toBe(0);
      expect(nodeMap.get('B')!.rank).toBe(1);
      expect(nodeMap.get('C')!.rank).toBe(1);
      expect(nodeMap.get('D')!.rank).toBe(1);
    });

    it('assigns correct ranks for disconnected graph', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B'), node('C'), node('D')],
        edges: [edge('A', 'B'), edge('C', 'D')],
      });
      const result = layoutBoxesAndLinesV2(parsed);
      const nodeMap = new Map(result.nodes.map((n) => [n.label, n]));

      expect(nodeMap.get('A')!.rank).toBe(0);
      expect(nodeMap.get('B')!.rank).toBe(1);
      expect(nodeMap.get('C')!.rank).toBe(0);
      expect(nodeMap.get('D')!.rank).toBe(1);
    });
  });

  describe('node positioning — no overlaps', () => {
    it('nodes do not overlap within same rank', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B'), node('C'), node('D'), node('E')],
        edges: [edge('A', 'B'), edge('A', 'C'), edge('A', 'D'), edge('A', 'E')],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      // Check that no two nodes overlap
      for (let i = 0; i < result.nodes.length; i++) {
        for (let j = i + 1; j < result.nodes.length; j++) {
          const a = result.nodes[i];
          const b = result.nodes[j];
          const overlapX =
            Math.abs(a.x + a.width / 2 - (b.x + b.width / 2)) <
            (a.width + b.width) / 2;
          const overlapY =
            Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) <
            (a.height + b.height) / 2;
          expect(
            overlapX && overlapY,
            `Nodes ${a.label} and ${b.label} overlap`
          ).toBe(false);
        }
      }
    });
  });

  describe('port assignment', () => {
    it('assigns flow-aligned ports in LR direction', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B')],
        edges: [edge('A', 'B')],
      });
      const result = layoutBoxesAndLinesV2(parsed);
      const e = result.edges[0];

      // In LR: source exits right, target enters left
      expect(e.sourcePort.side).toBe('right');
      expect(e.targetPort.side).toBe('left');
    });

    it('assigns flow-aligned ports in TB direction', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B')],
        edges: [edge('A', 'B')],
        direction: 'TB',
      });
      const result = layoutBoxesAndLinesV2(parsed);
      const e = result.edges[0];

      // In TB: source exits bottom, target enters top
      expect(e.sourcePort.side).toBe('bottom');
      expect(e.targetPort.side).toBe('top');
    });
  });

  describe('groups', () => {
    it('positions groups around their children', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B'), node('C')],
        edges: [edge('A', 'B'), edge('B', 'C')],
        groups: [
          {
            label: 'G1',
            children: ['A', 'B'],
            lineNumber: 1,
            metadata: {},
          },
        ],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      expect(result.groups).toHaveLength(1);
      const g = result.groups[0];
      expect(g.label).toBe('G1');
      expect(g.collapsed).toBe(false);
      expect(g.width).toBeGreaterThan(0);
      expect(g.height).toBeGreaterThan(0);

      // Group should contain its children
      const nodeMap = new Map(result.nodes.map((n) => [n.label, n]));
      const nA = nodeMap.get('A')!;
      const nB = nodeMap.get('B')!;

      expect(nA.x).toBeGreaterThanOrEqual(g.x);
      expect(nA.y).toBeGreaterThanOrEqual(g.y);
      expect(nB.x).toBeGreaterThanOrEqual(g.x);
      expect(nB.y).toBeGreaterThanOrEqual(g.y);
    });

    it('handles nested groups', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B')],
        edges: [edge('A', 'B')],
        groups: [
          {
            label: 'Outer',
            children: ['Inner', 'A', 'B'],
            lineNumber: 1,
            metadata: {},
          },
          {
            label: 'Inner',
            children: ['A'],
            lineNumber: 2,
            metadata: {},
            parentGroup: 'Outer',
          },
        ],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      const outer = result.groups.find((g) => g.label === 'Outer');
      const inner = result.groups.find((g) => g.label === 'Inner');
      expect(outer).toBeDefined();
      expect(inner).toBeDefined();
      expect(inner!.nestingLevel).toBe(1);
      expect(outer!.nestingLevel).toBe(0);
    });
  });

  describe('dense mode', () => {
    it('activates for > 20 nodes', () => {
      const nodes = Array.from({ length: 25 }, (_, i) => node(`N${i}`));
      const edges = nodes
        .slice(0, -1)
        .map((n, i) => edge(n.label, nodes[i + 1].label));
      const parsed = makeParsed({ nodes, edges });
      const result = layoutBoxesAndLinesV2(parsed);

      expect(result.nodes).toHaveLength(25);
      // All nodes should be positioned
      for (const n of result.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('pathological topologies', () => {
    it('handles spider graph (1 → 10 fan-out)', () => {
      const targets = Array.from({ length: 10 }, (_, i) => node(`T${i}`));
      const parsed = makeParsed({
        nodes: [node('Hub'), ...targets],
        edges: targets.map((t) => edge('Hub', t.label)),
      });
      const result = layoutBoxesAndLinesV2(parsed);

      expect(result.nodes).toHaveLength(11);
      // No node overlaps
      for (let i = 0; i < result.nodes.length; i++) {
        for (let j = i + 1; j < result.nodes.length; j++) {
          const a = result.nodes[i];
          const b = result.nodes[j];
          const overlapX =
            Math.abs(a.x + a.width / 2 - (b.x + b.width / 2)) <
            (a.width + b.width) / 2;
          const overlapY =
            Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) <
            (a.height + b.height) / 2;
          expect(
            overlapX && overlapY,
            `Nodes ${a.label} and ${b.label} overlap in spider`
          ).toBe(false);
        }
      }
    });

    it('handles diamond (converge/diverge)', () => {
      const parsed = makeParsed({
        nodes: [node('Start'), node('A'), node('B'), node('C'), node('End')],
        edges: [
          edge('Start', 'A'),
          edge('Start', 'B'),
          edge('Start', 'C'),
          edge('A', 'End'),
          edge('B', 'End'),
          edge('C', 'End'),
        ],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      expect(result.nodes).toHaveLength(5);
      const nodeMap = new Map(result.nodes.map((n) => [n.label, n]));
      // Start and End should be on different ranks
      expect(nodeMap.get('Start')!.rank).toBeLessThan(nodeMap.get('End')!.rank);
    });

    it('handles disconnected islands', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B'), node('C'), node('D')],
        edges: [edge('A', 'B'), edge('C', 'D')],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      expect(result.nodes).toHaveLength(4);
      // All nodes positioned
      for (const n of result.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles long chain (skyscraper)', () => {
      const labels = Array.from({ length: 12 }, (_, i) => `N${i}`);
      const nodes = labels.map((l) => node(l));
      const edges = labels.slice(0, -1).map((l, i) => edge(l, labels[i + 1]));
      const parsed = makeParsed({ nodes, edges });
      const result = layoutBoxesAndLinesV2(parsed);

      expect(result.nodes).toHaveLength(12);
      // Each rank should be successive
      const nodeMap = new Map(result.nodes.map((n) => [n.label, n]));
      for (let i = 0; i < labels.length; i++) {
        expect(nodeMap.get(labels[i])!.rank).toBe(i);
      }
    });
  });

  describe('all nodes within bounds', () => {
    it('all nodes are within the diagram bounds', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B'), node('C'), node('D'), node('E')],
        edges: [edge('A', 'B'), edge('B', 'C'), edge('A', 'D'), edge('D', 'E')],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      for (const n of result.nodes) {
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.x + n.width).toBeLessThanOrEqual(result.width);
        expect(n.y + n.height).toBeLessThanOrEqual(result.height);
      }
    });
  });

  describe('bidirectional edges', () => {
    it('handles bidirectional edges', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B')],
        edges: [
          {
            source: 'A',
            target: 'B',
            bidirectional: true,
            lineNumber: 1,
            metadata: {},
          },
        ],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].bidirectional).toBe(true);
    });
  });

  describe('parallel edges', () => {
    it('assigns different yOffsets to parallel edges', () => {
      const parsed = makeParsed({
        nodes: [node('A'), node('B')],
        edges: [
          edge('A', 'B', { label: 'first', lineNumber: 1 }),
          edge('A', 'B', { label: 'second', lineNumber: 2 }),
          edge('A', 'B', { label: 'third', lineNumber: 3 }),
        ],
      });
      const result = layoutBoxesAndLinesV2(parsed);

      const offsets = result.edges.map((e) => e.yOffset);
      // Not all the same
      expect(new Set(offsets).size).toBeGreaterThan(1);
    });
  });
});
