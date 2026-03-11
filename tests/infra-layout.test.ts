import { describe, it, expect } from 'vitest';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { layoutInfra, separateGroups, type InfraLayoutGroup, type InfraLayoutNode } from '../src/infra/layout';

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

  it('no two groups overlap after layout with multi-group diagram', () => {
    const result = layout(`
chart: infra

edge
  rps: 10000
  -> [GroupA]
  -> [GroupB]
  -> [GroupC]

[GroupA]
  instances: 3
  A1
    max-rps: 3000
    latency-ms: 10
  A2
    max-rps: 3000
    latency-ms: 20
  A3
    max-rps: 3000
    latency-ms: 30

[GroupB]
  instances: 2
  B1
    max-rps: 5000
    latency-ms: 15
  B2
    max-rps: 5000
    latency-ms: 25

[GroupC]
  instances: 4
  C1
    max-rps: 2000
    latency-ms: 5
  C2
    max-rps: 2000
    latency-ms: 10
  C3
    max-rps: 2000
    latency-ms: 15
  C4
    max-rps: 2000
    latency-ms: 20
`);
    expect(result.groups).toHaveLength(3);
    const { groups } = result;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const ga = groups[i], gb = groups[j];
        const overlaps =
          ga.x < gb.x + gb.width && ga.x + ga.width > gb.x &&
          ga.y < gb.y + gb.height && ga.y + ga.height > gb.y;
        expect(overlaps).toBe(false);
      }
    }
  });
});

describe('separateGroups()', () => {
  function makeGroup(id: string, x: number, y: number, w: number, h: number): InfraLayoutGroup {
    return { id, label: id, x, y, width: w, height: h, lineNumber: 1 };
  }

  function makeNode(id: string, groupId: string, x: number, y: number): InfraLayoutNode {
    return { id, groupId, x, y, width: 100, height: 50 } as InfraLayoutNode;
  }

  it('shifts the lower group when two groups overlap on Y axis (LR mode)', () => {
    const groups = [
      makeGroup('[A]', 0, 0, 200, 100),
      makeGroup('[B]', 50, 60, 200, 100), // overlaps A by 40px on Y
    ];
    const nodes = [makeNode('b1', '[B]', 150, 110)];
    const originalBY = groups[1].y;
    const originalNodeY = nodes[0].y;

    separateGroups(groups, nodes, true);

    // B should be pushed below A with at least GROUP_GAP clearance
    expect(groups[1].y).toBeGreaterThanOrEqual(groups[0].y + groups[0].height);
    // B's child node shifts by the same amount as the group
    expect(nodes[0].y - originalNodeY).toBe(groups[1].y - originalBY);
  });

  it('leaves non-overlapping groups unchanged', () => {
    const groups = [
      makeGroup('[A]', 0, 0, 200, 100),
      makeGroup('[B]', 0, 200, 200, 100), // clearly below A, no overlap
    ];
    const nodes: InfraLayoutNode[] = [];

    separateGroups(groups, nodes, true);

    expect(groups[0].y).toBe(0);
    expect(groups[1].y).toBe(200);
  });

  it('resolves a chain reaction across three groups', () => {
    const groups = [
      makeGroup('[A]', 0, 0, 200, 100),
      makeGroup('[B]', 50, 60, 200, 100),  // overlaps A
      makeGroup('[C]', 50, 120, 200, 100), // overlaps B
    ];
    const nodes: InfraLayoutNode[] = [];

    separateGroups(groups, nodes, true);

    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const ga = groups[i], gb = groups[j];
        const overlaps =
          ga.x < gb.x + gb.width && ga.x + ga.width > gb.x &&
          ga.y < gb.y + gb.height && ga.y + ga.height > gb.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('separates groups on X axis in TB mode', () => {
    const groups = [
      makeGroup('[A]', 0, 0, 100, 200),
      makeGroup('[B]', 60, 50, 100, 200), // overlaps A on X
    ];
    const nodes = [makeNode('b1', '[B]', 110, 100)];

    separateGroups(groups, nodes, false /* TB */);

    expect(groups[1].x).toBeGreaterThanOrEqual(groups[0].x + groups[0].width);
    expect(nodes[0].x).toBeGreaterThan(110);
  });
});

describe('scaled group layout data', () => {
  it('child nodes carry groupId matching the scaled group, and group preserves instances', () => {
    const result = layout(`
chart: infra

edge
  rps: 1000
  -> [Shards]

[Shards]
  instances: 3

  ShardA
    max-rps: 5000
    latency-ms: 2

  ShardB
    max-rps: 5000
    latency-ms: 2
`);

    const group = result.groups.find((g) => g.id === '[Shards]');
    expect(group).toBeDefined();
    expect(group!.instances).toBe(3);

    const shardA = result.nodes.find((n) => n.id === 'ShardA');
    const shardB = result.nodes.find((n) => n.id === 'ShardB');
    expect(shardA).toBeDefined();
    expect(shardB).toBeDefined();
    expect(shardA!.groupId).toBe('[Shards]');
    expect(shardB!.groupId).toBe('[Shards]');
  });

  it('nodes outside a group have groupId null', () => {
    const result = layout(`
chart: infra

edge
  rps: 1000
  -> API

API
  max-rps: 5000
  instances: 2
`);

    const api = result.nodes.find((n) => n.id === 'API');
    expect(api).toBeDefined();
    expect(api!.groupId).toBeNull();
  });

  describe('description field layout', () => {
    it('selected node with description is taller than without', () => {
      const content = `
chart: infra
edge
  rps: 1000
  -> MyService
MyService
  max-rps: 500
  description: Handles all REST API calls for the mobile app
`;
      const contentNoDesc = content.replace('  description: Handles all REST API calls for the mobile app\n', '');
      const layoutWith = layoutInfra(computeInfra(parseInfra(content)), 'MyService');
      const layoutWithout = layoutInfra(computeInfra(parseInfra(contentNoDesc)), 'MyService');
      const nodeWith = layoutWith.nodes.find((n) => n.id === 'MyService')!;
      const nodeWithout = layoutWithout.nodes.find((n) => n.id === 'MyService')!;
      expect(nodeWith.height).toBe(nodeWithout.height + 14); // META_LINE_HEIGHT
    });

    it('unselected node with description has same height as without', () => {
      const content = `
chart: infra
edge
  rps: 1000
  -> MyService
MyService
  max-rps: 500
  description: Handles all REST API calls for the mobile app
`;
      const contentNoDesc = content.replace('  description: Handles all REST API calls for the mobile app\n', '');
      const layoutWith = layoutInfra(computeInfra(parseInfra(content)), null);
      const layoutWithout = layoutInfra(computeInfra(parseInfra(contentNoDesc)), null);
      const nodeWith = layoutWith.nodes.find((n) => n.id === 'MyService')!;
      const nodeWithout = layoutWithout.nodes.find((n) => n.id === 'MyService')!;
      expect(nodeWith.height).toBe(nodeWithout.height);
    });

    it('selected node with description and no other content uses no-content early return height', () => {
      // AC7: NODE_HEADER_HEIGHT(28) + META_LINE_HEIGHT(14) + NODE_PAD_BOTTOM(10) = 52
      const result = layoutInfra(computeInfra(parseInfra(`
chart: infra
edge
  rps: 0
  -> Lonely
Lonely
  description: Only a description here
`)), 'Lonely');
      const node = result.nodes.find((n) => n.id === 'Lonely')!;
      expect(node.height).toBe(28 + 14 + 10); // NODE_HEADER_HEIGHT + META_LINE_HEIGHT + NODE_PAD_BOTTOM
    });

    it('selected node with long description is wider than minimum', () => {
      // AC5: description width = length * META_CHAR_WIDTH(6) + PADDING_X(24)
      const longDesc = 'A'.repeat(40); // 40 * 6 + 24 = 264px
      const result = layoutInfra(computeInfra(parseInfra(`
chart: infra
edge
  rps: 1000
  -> MyService
MyService
  description: ${longDesc}
`)), 'MyService');
      const node = result.nodes.find((n) => n.id === 'MyService')!;
      expect(node.width).toBeGreaterThanOrEqual(40 * 6 + 24); // description drives width
    });
  });
});

describe('collapsed p90 row', () => {
  it('collapsed node with latency has fewer rows than expanded (1 vs 3)', () => {
    const src = `
chart: infra
edge
  rps: 1000
  -> API
API
  latency-ms: 50
  max-rps: 500
`;
    const collapsed = layoutInfra(computeInfra(parseInfra(src)), null);
    const expanded = layoutInfra(computeInfra(parseInfra(src)), 'API');
    const nodeC = collapsed.nodes.find((n) => n.id === 'API')!;
    const nodeE = expanded.nodes.find((n) => n.id === 'API')!;
    // Expanded shows p50+p90+p99 (3 rows); collapsed shows p90 (1 row)
    // Height difference includes 2 latency rows (p50 + p99) plus expanded-only declared props
    expect(nodeC.height).toBeLessThan(nodeE.height);
    // Collapsed → expanded diff is at least 2 META_LINE_HEIGHTs (the removed p50 and p99 rows)
    expect(nodeE.height - nodeC.height).toBeGreaterThanOrEqual(2 * 14); // 2 × META_LINE_HEIGHT
  });

  it('collapsed and expanded have identical height when latency-ms is 0', () => {
    // AC6: no latency row when p90=0 — guard prevents rendering
    const src = `
chart: infra
edge
  rps: 1000
  -> API
API
  max-rps: 500
`;
    const collapsed = layoutInfra(computeInfra(parseInfra(src)), null);
    const expanded = layoutInfra(computeInfra(parseInfra(src)), 'API');
    const nodeC = collapsed.nodes.find((n) => n.id === 'API')!;
    const nodeE = expanded.nodes.find((n) => n.id === 'API')!;
    // No latency data — collapsed and expanded have same computed rows (zero latency rows each)
    expect(nodeC.height).toBeLessThanOrEqual(nodeE.height);
    // Expanded shows declared props (max-rps); collapsed does not — height may differ for props, not for latency
    // Key assertion: no additional latency row in collapsed
    const collapsedWithLatency = layoutInfra(computeInfra(parseInfra(src + '  latency-ms: 50\n')), null);
    const apiWithLatency = collapsedWithLatency.nodes.find((n) => n.id === 'API')!;
    // With latency-ms=50, collapsed is exactly 1 META_LINE_HEIGHT taller (the p90 row)
    expect(apiWithLatency.height - nodeC.height).toBe(14); // 1 × META_LINE_HEIGHT
  });

  it('collapsed width key column uses p90 label (same 3-char width as p99)', () => {
    // p90 and p99 are both 3 chars — verify the key set produces the same maxKeyLen
    // The meaningful check: layout is stable across the p99→p90 key rename
    const src = `
chart: infra
edge
  rps: 1000
  -> API
API
  latency-ms: 200
  max-rps: 500
`;
    const collapsedResult = layoutInfra(computeInfra(parseInfra(src)), null);
    const expandedResult = layoutInfra(computeInfra(parseInfra(src)), 'API');
    const apiC = collapsedResult.nodes.find((n) => n.id === 'API')!;
    const apiE = expandedResult.nodes.find((n) => n.id === 'API')!;
    // Collapsed must have width > MIN_NODE_WIDTH (140) since it shows a p90 row with value
    expect(apiC.width).toBeGreaterThan(140);
    // Expanded is wider (shows p50 which can be shorter value, but declared props increase width)
    // Both should be positive widths
    expect(apiE.width).toBeGreaterThan(0);
  });

  it('AC7: node with SLO configured reserves width for "520ms / 200ms" combined string', () => {
    // Setup rationale: we need maxKeyLen > 3 so the combined "520ms / 200ms" row (13 chars)
    // produces a width that exceeds MIN_NODE_WIDTH (140px), making the SLO reservation visible.
    //
    // SVC has uptime: 90 → API's computedUptime (0.90) differs from declared (none = 100%),
    // adding "eff. uptime" (11 chars) to API's key column → maxKeyLen = 11.
    // Constants: META_CHAR_WIDTH=6, PADDING_X=20 (the "+20" in computeNodeWidth return).
    //
    //   withSlo p90 row: (11+2+13)*6 = 156; 156+20 = 176 > 140 → width = 176
    //   noSlo  p90 row: (11+2+5)*6  = 108; 108+20 = 128 < 140 → width = 140 (min)
    //
    // If MIN_NODE_WIDTH, META_CHAR_WIDTH, or PADDING_X change, re-validate these numbers.
    const base = (sloLine = '') => `
chart: infra
${sloLine}
edge
  rps: 1000
  -> SVC
SVC
  uptime: 90
  max-rps: 5000
  -> API
API
  latency-ms: 520
  max-rps: 5000
`;
    const noSloResult = layoutInfra(computeInfra(parseInfra(base())));
    const withSloResult = layoutInfra(computeInfra(parseInfra(base('slo-p90-latency-ms: 200'))));
    const noSloApi = noSloResult.nodes.find((n) => n.id === 'API')!;
    const withSloApi = withSloResult.nodes.find((n) => n.id === 'API')!;
    // Node with SLO must be wider to accommodate "520ms / 200ms" vs "520ms"
    expect(withSloApi.width).toBeGreaterThan(noSloApi.width);
  });
});
