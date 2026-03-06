import { describe, it, expect } from 'vitest';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { layoutInfra } from '../src/infra/layout';

function layout(source: string) {
  const parsed = parseInfra(source);
  expect(parsed.error).toBeNull();
  const computed = computeInfra(parsed);
  return layoutInfra(computed);
}

describe('infra layout engine', () => {
  it('produces positioned nodes for a simple chain', () => {
    const result = layout(`
chart: infra

edge
  rps: 1000
  -> API

API
  latency-ms: 10
`);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);

    for (const node of result.nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.y).toBeGreaterThan(0);
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
    }
  });

  it('produces edge waypoints', () => {
    const result = layout(`
chart: infra

edge
  rps: 1000
  -> CDN

CDN
  cache-hit: 80%
  -> API

API
  latency-ms: 10
`);
    expect(result.edges).toHaveLength(2);
    for (const edge of result.edges) {
      expect(edge.points.length).toBeGreaterThan(0);
    }
  });

  it('computes group bounding boxes', () => {
    const result = layout(`
chart: infra

edge
  rps: 6000
  -> [Backend]

[Backend]
  API1
    max-rps: 3000
  API2
    max-rps: 3000
`);
    expect(result.groups).toHaveLength(1);
    const group = result.groups[0];
    expect(group.label).toBe('Backend');
    expect(group.width).toBeGreaterThan(0);
    expect(group.height).toBeGreaterThan(0);

    // Group should contain its children
    const children = result.nodes.filter((n) => n.groupId === '[Backend]');
    expect(children).toHaveLength(2);
    for (const child of children) {
      const childLeft = child.x - child.width / 2;
      const childRight = child.x + child.width / 2;
      const childTop = child.y - child.height / 2;
      const childBottom = child.y + child.height / 2;
      expect(childLeft).toBeGreaterThanOrEqual(group.x);
      expect(childRight).toBeLessThanOrEqual(group.x + group.width);
      expect(childTop).toBeGreaterThanOrEqual(group.y);
      expect(childBottom).toBeLessThanOrEqual(group.y + group.height);
    }
  });

  it('handles empty model gracefully', () => {
    const parsed = parseInfra('chart: infra\n');
    const computed = computeInfra(parsed);
    const result = layoutInfra(computed);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  it('respects TB direction', () => {
    const result = layout(`
chart: infra
direction: TB

edge
  rps: 1000
  -> API

API
  latency-ms: 10
`);
    // In TB layout, nodes should be stacked vertically
    const edgeNode = result.nodes.find((n) => n.id === 'edge')!;
    const apiNode = result.nodes.find((n) => n.id === 'API')!;
    expect(apiNode.y).toBeGreaterThan(edgeNode.y);
  });

  it('preserves line numbers on layout nodes', () => {
    const result = layout(`
chart: infra

edge
  rps: 1000
  -> API

API
  latency-ms: 10
`);
    for (const node of result.nodes) {
      expect(node.lineNumber).toBeGreaterThan(0);
    }
    for (const edge of result.edges) {
      expect(edge.lineNumber).toBeGreaterThan(0);
    }
  });
});
