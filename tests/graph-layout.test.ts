import { describe, it, expect } from 'vitest';
import { layoutGraph } from '../src/graph/layout';
import type { ParsedGraph } from '../src/graph/types';

function makeGraph(overrides: Partial<ParsedGraph> = {}): ParsedGraph {
  return {
    type: 'flowchart',
    direction: 'TB',
    nodes: [],
    edges: [],
    ...overrides,
  };
}

describe('layoutGraph', () => {
  it('produces positions for all nodes in a simple linear graph', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'n1', label: 'Start', shape: 'terminal', lineNumber: 1 },
        { id: 'n2', label: 'Process', shape: 'process', lineNumber: 2 },
        { id: 'n3', label: 'End', shape: 'terminal', lineNumber: 3 },
      ],
      edges: [
        { source: 'n1', target: 'n2', lineNumber: 4 },
        { source: 'n2', target: 'n3', lineNumber: 5 },
      ],
    });

    const result = layoutGraph(graph);

    expect(result.nodes).toHaveLength(3);
    for (const node of result.nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.y).toBeGreaterThan(0);
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
    }

    expect(result.edges).toHaveLength(2);
    for (const edge of result.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
    }

    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it('direction TB — y-coordinates increase top-to-bottom', () => {
    const graph = makeGraph({
      direction: 'TB',
      nodes: [
        { id: 'a', label: 'A', shape: 'process', lineNumber: 1 },
        { id: 'b', label: 'B', shape: 'process', lineNumber: 2 },
        { id: 'c', label: 'C', shape: 'process', lineNumber: 3 },
      ],
      edges: [
        { source: 'a', target: 'b', lineNumber: 4 },
        { source: 'b', target: 'c', lineNumber: 5 },
      ],
    });

    const result = layoutGraph(graph);
    const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));

    expect(nodeMap.get('a')!.y).toBeLessThan(nodeMap.get('b')!.y);
    expect(nodeMap.get('b')!.y).toBeLessThan(nodeMap.get('c')!.y);
  });

  it('direction LR — x-coordinates increase left-to-right', () => {
    const graph = makeGraph({
      direction: 'LR',
      nodes: [
        { id: 'a', label: 'A', shape: 'process', lineNumber: 1 },
        { id: 'b', label: 'B', shape: 'process', lineNumber: 2 },
        { id: 'c', label: 'C', shape: 'process', lineNumber: 3 },
      ],
      edges: [
        { source: 'a', target: 'b', lineNumber: 4 },
        { source: 'b', target: 'c', lineNumber: 5 },
      ],
    });

    const result = layoutGraph(graph);
    const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));

    expect(nodeMap.get('a')!.x).toBeLessThan(nodeMap.get('b')!.x);
    expect(nodeMap.get('b')!.x).toBeLessThan(nodeMap.get('c')!.x);
  });

  it('groups cluster their member nodes together', () => {
    const graph = makeGraph({
      nodes: [
        {
          id: 'n1',
          label: 'A',
          shape: 'process',
          group: 'g1',
          lineNumber: 1,
        },
        {
          id: 'n2',
          label: 'B',
          shape: 'process',
          group: 'g1',
          lineNumber: 2,
        },
        { id: 'n3', label: 'C', shape: 'process', lineNumber: 3 },
      ],
      edges: [
        { source: 'n1', target: 'n2', lineNumber: 4 },
        { source: 'n2', target: 'n3', lineNumber: 5 },
      ],
      groups: [
        {
          id: 'g1',
          label: 'Group 1',
          color: 'blue',
          nodeIds: ['n1', 'n2'],
          lineNumber: 6,
        },
      ],
    });

    const result = layoutGraph(graph);

    expect(result.groups).toHaveLength(1);
    const group = result.groups[0];
    expect(group.x).toBeGreaterThan(0);
    expect(group.y).toBeGreaterThan(0);
    expect(group.width).toBeGreaterThan(0);
    expect(group.height).toBeGreaterThan(0);

    // Member nodes should be within group bounding box (with some tolerance for padding)
    const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));
    const n1 = nodeMap.get('n1')!;
    const n2 = nodeMap.get('n2')!;
    const tolerance = 30;
    expect(n1.x).toBeGreaterThanOrEqual(group.x - tolerance);
    expect(n1.x).toBeLessThanOrEqual(group.x + group.width + tolerance);
    expect(n2.x).toBeGreaterThanOrEqual(group.x - tolerance);
    expect(n2.x).toBeLessThanOrEqual(group.x + group.width + tolerance);
  });

  it('handles cycles (back-edges) gracefully — no crash', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'a', label: 'Start', shape: 'terminal', lineNumber: 1 },
        { id: 'b', label: 'Check', shape: 'decision', lineNumber: 2 },
        { id: 'c', label: 'Process', shape: 'process', lineNumber: 3 },
      ],
      edges: [
        { source: 'a', target: 'b', lineNumber: 4 },
        { source: 'b', target: 'c', label: 'yes', lineNumber: 5 },
        { source: 'c', target: 'b', label: 'retry', lineNumber: 6 }, // back-edge
      ],
    });

    const result = layoutGraph(graph);

    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(3);
    for (const node of result.nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.y).toBeGreaterThan(0);
    }
  });

  it('decision branching produces nodes at different positions', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'd', label: 'Check?', shape: 'decision', lineNumber: 1 },
        { id: 'yes', label: 'Yes Path', shape: 'process', lineNumber: 2 },
        { id: 'no', label: 'No Path', shape: 'process', lineNumber: 3 },
      ],
      edges: [
        { source: 'd', target: 'yes', label: 'yes', lineNumber: 4 },
        { source: 'd', target: 'no', label: 'no', lineNumber: 5 },
      ],
    });

    const result = layoutGraph(graph);
    const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));

    const yesNode = nodeMap.get('yes')!;
    const noNode = nodeMap.get('no')!;

    // Branch nodes should be at different x-positions (TB layout)
    expect(yesNode.x).not.toEqual(noNode.x);
  });

  it('preserves edge labels and colors in layout result', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'a', label: 'A', shape: 'process', lineNumber: 1 },
        { id: 'b', label: 'B', shape: 'process', lineNumber: 2 },
      ],
      edges: [
        {
          source: 'a',
          target: 'b',
          label: 'next',
          color: 'green',
          lineNumber: 3,
        },
      ],
    });

    const result = layoutGraph(graph);
    expect(result.edges[0].label).toBe('next');
    expect(result.edges[0].color).toBe('green');
  });

  it('preserves node shape, label, and lineNumber in layout result', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'n1', label: 'Start', shape: 'terminal', lineNumber: 7 },
      ],
      edges: [],
    });

    const result = layoutGraph(graph);
    expect(result.nodes[0].id).toBe('n1');
    expect(result.nodes[0].label).toBe('Start');
    expect(result.nodes[0].shape).toBe('terminal');
    expect(result.nodes[0].lineNumber).toBe(7);
  });

  it('computes wider dimensions for nodes with long labels', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'short', label: 'Hi', shape: 'process', lineNumber: 1 },
        {
          id: 'long',
          label: 'This is a very long label text',
          shape: 'process',
          lineNumber: 2,
        },
      ],
      edges: [],
    });

    const result = layoutGraph(graph);
    const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));
    expect(nodeMap.get('long')!.width).toBeGreaterThan(
      nodeMap.get('short')!.width
    );
  });

  it('decision nodes get extra height', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'p', label: 'Step', shape: 'process', lineNumber: 1 },
        { id: 'd', label: 'Check', shape: 'decision', lineNumber: 2 },
      ],
      edges: [],
    });

    const result = layoutGraph(graph);
    const nodeMap = new Map(result.nodes.map((n) => [n.id, n]));
    expect(nodeMap.get('d')!.height).toBeGreaterThan(
      nodeMap.get('p')!.height
    );
  });

  it('handles empty graph', () => {
    const graph = makeGraph({ nodes: [], edges: [] });
    const result = layoutGraph(graph);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.groups).toHaveLength(0);
  });
});
