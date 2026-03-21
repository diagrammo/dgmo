import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseInitiativeStatus } from '../src/initiative-status/parser';
import { layoutInitiativeStatus } from '../src/initiative-status/layout';
import { renderInitiativeStatus } from '../src/initiative-status/renderer';
import type { PaletteColors } from '../src/palettes/types';

// Set up jsdom globals for D3
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: win.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: win.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    value: win.SVGElement,
    configurable: true,
  });
});

// Minimal Nord light palette for testing
const testPalette: PaletteColors = {
  bg: '#eceff4',
  surface: '#e5e9f0',
  overlay: '#e5e9f0',
  border: '#d8dee9',
  text: '#2e3440',
  textMuted: '#4c566a',
  primary: '#5e81ac',
  secondary: '#81a1c1',
  accent: '#88c0d0',
  destructive: '#bf616a',
  colors: {
    red: '#bf616a',
    orange: '#d08770',
    yellow: '#ebcb8b',
    green: '#a3be8c',
    blue: '#5e81ac',
    purple: '#b48ead',
    teal: '#8fbcbb',
    cyan: '#88c0d0',
    gray: '#4c566a',
  },
};

const SAMPLE = `chart: initiative-status
title: Project Phoenix

Mobile | done
Back End | wip
Database | done

Mobile -> Back End: getUser | done
Back End -> Database: query | done`;

const SAMPLE_WITH_GROUPS = `chart: initiative-status
title: Grouped

User | na
Mobile | done
Back End | wip
[External]
  Identity Service | na
  Vendor | na

Mobile -> Back End: getUser | done
Back End -> Identity Service: auth | done`;

describe('layoutInitiativeStatus', () => {
  it('positions nodes for a simple diagram', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);

    expect(layout.nodes).toHaveLength(3);
    expect(layout.edges).toHaveLength(2);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);

    // All nodes should have positions
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.y).toBeGreaterThan(0);
      expect(node.width).toBeGreaterThan(0);
    }
  });

  it('handles empty diagram', () => {
    const parsed = parseInitiativeStatus('chart: initiative-status');
    const layout = layoutInitiativeStatus(parsed);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
    expect(layout.groups).toHaveLength(0);
  });

  it('computes group bounding boxes', () => {
    const parsed = parseInitiativeStatus(SAMPLE_WITH_GROUPS);
    const layout = layoutInitiativeStatus(parsed);

    expect(layout.groups).toHaveLength(1);
    const group = layout.groups[0];
    expect(group.label).toBe('External');
    expect(group.width).toBeGreaterThan(0);
    expect(group.height).toBeGreaterThan(0);
    expect(group.lineNumber).toBe(7);
  });

  it('rolls up group status from children (worst wins)', () => {
    // Both children are na → group rolls up to na
    const parsed = parseInitiativeStatus(SAMPLE_WITH_GROUPS);
    const layout = layoutInitiativeStatus(parsed);
    expect(layout.groups[0].status).toBe('na');

    // Mixed: todo > wip > done > na
    const mixed = parseInitiativeStatus(`[Mixed]
  A | done
  B | todo
  C | wip`);
    const mixedLayout = layoutInitiativeStatus(mixed);
    expect(mixedLayout.groups[0].status).toBe('todo');

    // All done
    const allDone = parseInitiativeStatus(`[Complete]
  X | done
  Y | done`);
    const doneLayout = layoutInitiativeStatus(allDone);
    expect(doneLayout.groups[0].status).toBe('done');
  });

  it('includes group bounds in total dimensions', () => {
    const parsed = parseInitiativeStatus(SAMPLE_WITH_GROUPS);
    const layout = layoutInitiativeStatus(parsed);

    const group = layout.groups[0];
    const groupRight = group.x + group.width;
    const groupBottom = group.y + group.height;

    // Total dimensions should encompass group bounds (plus margin)
    expect(layout.width).toBeGreaterThanOrEqual(groupRight);
    expect(layout.height).toBeGreaterThanOrEqual(groupBottom);
  });

  it('routes back-edge via bottom arc (arrowhead at tgt bottom-center, not left side)', () => {
    // Bar→Foo is a back-edge: Bar is at rank 1 (higher X), Foo at rank 0 (lower X) in LR layout
    const parsed = parseInitiativeStatus(`chart: initiative-status
Foo | wip
  -> Bar | wip
Bar | done
  -D-> Foo | wip`);
    const layout = layoutInitiativeStatus(parsed);
    const backEdge = layout.edges.find((e) => e.source === 'Bar' && e.target === 'Foo')!;
    expect(backEdge).toBeDefined();
    expect(backEdge.points).toHaveLength(5);
    // First point: bottom-center of source (Bar)
    const srcNode = layout.nodes.find((n) => n.label === 'Bar')!;
    expect(backEdge.points[0].x).toBeCloseTo(srcNode.x, 0);
    expect(backEdge.points[0].y).toBeCloseTo(srcNode.y + srcNode.height / 2, 0);
    // Last point: bottom-center of target (Foo)
    const tgtNode = layout.nodes.find((n) => n.label === 'Foo')!;
    expect(backEdge.points[4].x).toBeCloseTo(tgtNode.x, 0);
    expect(backEdge.points[4].y).toBeCloseTo(tgtNode.y + tgtNode.height / 2, 0);
    // Arc control point (index 2) is below both node bottoms
    const maxBottom = Math.max(srcNode.y + srcNode.height / 2, tgtNode.y + tgtNode.height / 2);
    expect(backEdge.points[2].y).toBeGreaterThan(maxBottom);
    // X values must be monotone-decreasing across all 5 points (curveMonotoneX contract)
    for (let i = 0; i < backEdge.points.length - 1; i++) {
      expect(backEdge.points[i].x).toBeGreaterThanOrEqual(backEdge.points[i + 1].x);
    }
  });

  it('routes back-edge arc control point outside node bounds (routeAbove or routeBelow)', () => {
    // Root→A→B is a 3-rank chain. B→A is a geometric back-edge (B.x > A.x in LR layout).
    // Linear chain nodes share the same Y so routeBelow fires (both at avgNodeY, not above it).
    // The test asserts the universal property: control point exits node bounds regardless of direction.
    const parsed = parseInitiativeStatus(`chart: initiative-status
Root | done
  -> A | done
A | done
  -> B | wip
B | wip
  -back-> A | done`);
    const layout = layoutInitiativeStatus(parsed);
    const backEdge = layout.edges.find((e) => e.source === 'B' && e.target === 'A');
    expect(backEdge).toBeDefined();
    expect(backEdge!.points).toHaveLength(5);
    const srcNode = layout.nodes.find((n) => n.label === 'B')!;
    const tgtNode = layout.nodes.find((n) => n.label === 'A')!;
    const minTop = Math.min(srcNode.y - srcNode.height / 2, tgtNode.y - tgtNode.height / 2);
    const maxBottom = Math.max(srcNode.y + srcNode.height / 2, tgtNode.y + tgtNode.height / 2);
    const ctrlY = backEdge!.points[2].y;
    // Arc control point must be outside node bounds — arrowhead is never buried
    expect(ctrlY < minTop || ctrlY > maxBottom).toBe(true);
    // Conditional direction check based on actual avgNodeY (exercises both branch paths)
    const avgY = layout.nodes.reduce((s, n) => s + n.y, 0) / layout.nodes.length;
    if (Math.min(srcNode.y, tgtNode.y) > avgY) {
      expect(ctrlY).toBeLessThan(minTop); // routed above
    } else {
      expect(ctrlY).toBeGreaterThan(maxBottom); // routed below (this fixture always takes this path)
    }
  });

  it('routes Y-displaced forward edge via bottom-exit elbow (4 points)', () => {
    // Fan from Src to 4 targets forces dagre to spread them vertically.
    // At least one target will be > NODESEP (80px) below Src → triggers isBottomExit.
    const parsed = parseInitiativeStatus(`chart: initiative-status
Src | wip
  -> A | done
  -> B | wip
  -> C | wip
  -> D | todo
A | done
B | wip
C | wip
D | todo`);
    const layout = layoutInitiativeStatus(parsed);
    const srcNode = layout.nodes.find((n) => n.label === 'Src')!;
    // Find any forward edge from Src where target is > NODESEP below
    const displaced = layout.edges.find((e) => {
      if (e.source !== 'Src') return false;
      const tgt = layout.nodes.find((n) => n.label === e.target)!;
      return tgt.y > srcNode.y + 80; // NODESEP = 80
    });
    expect(displaced).toBeDefined(); // fan layout guarantees at least one displaced target
    expect(displaced!.points).toHaveLength(4);
    // Exit point: center-X of source, bottom Y
    expect(displaced!.points[0].x).toBeCloseTo(srcNode.x, 0);
    expect(displaced!.points[0].y).toBeCloseTo(srcNode.y + srcNode.height / 2, 0);
    // Entry point: left side of target, center Y
    const tgtNode = layout.nodes.find((n) => n.label === displaced!.target)!;
    expect(displaced!.points[3].x).toBeCloseTo(tgtNode.x - tgtNode.width / 2, 0);
    expect(displaced!.points[3].y).toBeCloseTo(tgtNode.y, 0);
    // X must be monotone-increasing across all 4 points
    for (let i = 0; i < displaced!.points.length - 1; i++) {
      expect(displaced!.points[i].x).toBeLessThanOrEqual(displaced!.points[i + 1].x);
    }
  });

  it('routes Y-displaced forward edge via top-exit elbow (4 points, isTopExit)', () => {
    // Fan from Src to 4 targets: with NODESEP=80, topmost target is ~120px above Src → triggers isTopExit.
    const parsed = parseInitiativeStatus(`chart: initiative-status
Src | wip
  -> A | done
  -> B | wip
  -> C | wip
  -> D | todo
A | done
B | wip
C | wip
D | todo`);
    const layout = layoutInitiativeStatus(parsed);
    const srcNode = layout.nodes.find((n) => n.label === 'Src')!;
    // Find any forward edge from Src where target is > NODESEP above
    const topDisplaced = layout.edges.find((e) => {
      if (e.source !== 'Src') return false;
      const tgt = layout.nodes.find((n) => n.label === e.target)!;
      return tgt.y < srcNode.y - 80; // NODESEP = 80
    });
    expect(topDisplaced).toBeDefined(); // fan layout guarantees at least one displaced target above
    expect(topDisplaced!.points).toHaveLength(4);
    // Exit point: center-X of source, top Y
    expect(topDisplaced!.points[0].x).toBeCloseTo(srcNode.x, 0);
    expect(topDisplaced!.points[0].y).toBeCloseTo(srcNode.y - srcNode.height / 2, 0);
    // Entry point: left side of target, center Y
    const tgtNode = layout.nodes.find((n) => n.label === topDisplaced!.target)!;
    expect(topDisplaced!.points[3].x).toBeCloseTo(tgtNode.x - tgtNode.width / 2, 0);
    expect(topDisplaced!.points[3].y).toBeCloseTo(tgtNode.y, 0);
    // X must be monotone-increasing across all 4 points
    for (let i = 0; i < topDisplaced!.points.length - 1; i++) {
      expect(topDisplaced!.points[i].x).toBeLessThanOrEqual(topDisplaced!.points[i + 1].x);
    }
  });

  it('all forward-edge routing branches produce monotone-increasing X', () => {
    // Hub fans to 4 targets — with NODESEP=80 and 4 targets, extremes are ~120px above/below Hub,
    // exercising isTopExit (A above), isBottomExit (D below), and 4-point elbow (B, C near center).
    const parsed = parseInitiativeStatus(`chart: initiative-status
Hub | wip
  -> Right | done
  -> A | done
  -> B | wip
  -> C | wip
Right | done
A | done
B | wip
C | wip`);
    const layout = layoutInitiativeStatus(parsed);
    for (const edge of layout.edges) {
      // Back-edges have monotone-decreasing X — skip them
      const src = layout.nodes.find((n) => n.label === edge.source)!;
      const tgt = layout.nodes.find((n) => n.label === edge.target)!;
      if (tgt.x < src.x - 5) continue; // back-edge
      for (let i = 0; i < edge.points.length - 1; i++) {
        expect(edge.points[i].x).toBeLessThanOrEqual(edge.points[i + 1].x);
      }
    }
  });

  it('lays out Operation Blackbeard fixture without errors or undefined points', () => {
    // Smoke test for the full Blackbeard diagram (mirrors tests/fixtures/initiative-status-blackbeard.dgmo).
    // Validates port-routing logic on a realistic multi-rank diagram with groups and back-edges.
    const content = `chart: initiative-status
title: Operation Blackbeard

Captain | na
  -issueOrders-> CrewApp | na
  -viewCharts-> ShipDashboard | na
CrewApp | done
  -getCrewRoster-> Quartermaster | done
  -assignWatch-> Quartermaster | todo
ShipDashboard | todo
  -API-> Quartermaster | todo
Quartermaster | wip
  -dockRequest-> PortAuthority | done
  -plotCourse-> NavigationService | todo
  -recordVoyage-> ShipLog | done
  -logMutiny-> ShipLog | done
  -tradeGoods-> TradingPost | wip
  -fenceBooty-> TradingPost | todo
NavigationService | wip
ShipLog | done
CargoService | wip
  -inventoryUpdate-> Quartermaster | wip
[Royal Navy]
  PortAuthority | na
  TradingPost | na`;
    const parsed = parseInitiativeStatus(content);
    const layout = layoutInitiativeStatus(parsed);
    expect(layout.nodes.length).toBeGreaterThan(0);
    expect(layout.edges.length).toBeGreaterThan(0);
    // All edge points must be finite numbers — catches NaN/undefined from routing bugs
    for (const edge of layout.edges) {
      for (const pt of edge.points) {
        expect(Number.isFinite(pt.x)).toBe(true);
        expect(Number.isFinite(pt.y)).toBe(true);
      }
    }
  });
});

describe('renderInitiativeStatus', () => {
  it('renders without errors', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      false,
      undefined,
      { width: 800, height: 600 }
    );

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('creates node elements with data-line-number', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      false,
      undefined,
      { width: 800, height: 600 }
    );

    const nodes = container.querySelectorAll('.is-node');
    expect(nodes.length).toBe(3);

    // Each node should have a data-line-number
    nodes.forEach((node) => {
      expect(node.getAttribute('data-line-number')).toBeTruthy();
    });
  });

  it('creates edge elements', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      false,
      undefined,
      { width: 800, height: 600 }
    );

    const edges = container.querySelectorAll('.is-edge');
    expect(edges.length).toBe(2);
  });

  it('renders title', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      false,
      undefined,
      { width: 800, height: 600 }
    );

    const title = container.querySelector('.chart-title');
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe('Project Phoenix');
  });

  it('renders edge labels', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      false,
      undefined,
      { width: 800, height: 600 }
    );

    const labels = container.querySelectorAll('.is-edge-label');
    expect(labels.length).toBe(2);
    const texts = Array.from(labels).map((l) => l.textContent);
    expect(texts).toContain('getUser');
    expect(texts).toContain('query');
  });

  it('renders groups as background rects with labels', () => {
    const parsed = parseInitiativeStatus(SAMPLE_WITH_GROUPS);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      false,
      undefined,
      { width: 800, height: 600 }
    );

    const groups = container.querySelectorAll('.is-group');
    expect(groups.length).toBe(1);
    expect(groups[0].getAttribute('data-line-number')).toBe('7');

    const label = container.querySelector('.is-group-label');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('External');
  });

  it('spreads parallel edges with Y offset on interior control points', () => {
    const parsed = parseInitiativeStatus(`chart: initiative-status
Foo | wip
  -A-> Bar | wip
  -B-> Bar | wip
Bar | wip`);
    const layout = layoutInitiativeStatus(parsed);
    const [edgeA, edgeB] = layout.edges;
    // Exit points (first) and entry points (last) share same Y (node center)
    expect(edgeA.points[0].y).toBe(edgeB.points[0].y);
    expect(edgeA.points[edgeA.points.length - 1].y).toBe(edgeB.points[edgeB.points.length - 1].y);
    // Interior control points are offset from each other
    expect(edgeA.points[1].y).not.toBe(edgeB.points[1].y);
    // parallelCount is 2 for both
    expect(edgeA.parallelCount).toBe(2);
    expect(edgeB.parallelCount).toBe(2);
  });

  it('leaves single edges unaffected (parallelCount=1, no interior offset)', () => {
    // This fixture has only two nodes with no intermediate ranks, so dagre always
    // uses the 4-point elbow path — interior points are at src.y (offset=0).
    const parsed = parseInitiativeStatus(`chart: initiative-status
Foo | wip
  -> Bar | wip
Bar | wip`);
    const layout = layoutInitiativeStatus(parsed);
    expect(layout.edges[0].parallelCount).toBe(1);
    // Interior points share same Y as exit point (no offset applied)
    expect(layout.edges[0].points[1].y).toBe(layout.edges[0].points[0].y);
  });

  it('narrows hit-area stroke-width for parallel edges and keeps full 16px for single edges', () => {
    // 2 parallel edges → stroke-width = max(6, round(16/2)) = 8
    const parsed2 = parseInitiativeStatus(`chart: initiative-status
Foo | wip
  -A-> Bar | wip
  -B-> Bar | wip
Bar | wip`);
    const layout2 = layoutInitiativeStatus(parsed2);
    const container2 = document.createElement('div') as unknown as HTMLDivElement;
    renderInitiativeStatus(container2, parsed2, layout2, testPalette, false, undefined, { width: 800, height: 600 });
    const hitPaths2 = container2.querySelectorAll('.is-edge-group path[stroke="transparent"]');
    expect(hitPaths2.length).toBe(2);
    for (const p of hitPaths2) {
      expect(Number(p.getAttribute('stroke-width'))).toBe(8);
    }

    // Single edge → stroke-width = max(6, round(16/1)) = 16
    const parsed1 = parseInitiativeStatus(`chart: initiative-status
Foo | wip
  -> Bar | wip
Bar | wip`);
    const layout1 = layoutInitiativeStatus(parsed1);
    const container1 = document.createElement('div') as unknown as HTMLDivElement;
    renderInitiativeStatus(container1, parsed1, layout1, testPalette, false, undefined, { width: 800, height: 600 });
    const hitPaths1 = container1.querySelectorAll('.is-edge-group path[stroke="transparent"]');
    expect(hitPaths1.length).toBe(1);
    expect(Number(hitPaths1[0].getAttribute('stroke-width'))).toBe(16);
  });

  it('caps parallel edges at MAX_PARALLEL_EDGES (5) and compresses spacing to fit node bounds', () => {
    // 7 authored edges → only 5 rendered (MAX_PARALLEL_EDGES cap)
    // effectiveSpacing for 5 edges: min(16, 48/(5-1)) = min(16, 12) = 12
    const lines = Array.from({ length: 7 }, (_, i) => `  -E${i}-> Bar | wip`).join('\n');
    const parsed = parseInitiativeStatus(`chart: initiative-status\nFoo | wip\n${lines}\nBar | wip`);
    const layout = layoutInitiativeStatus(parsed);
    // Capped at 5 rendered edges
    expect(layout.edges).toHaveLength(5);
    // All rendered edges have parallelCount=5
    expect(layout.edges.every((e) => e.parallelCount === 5)).toBe(true);
    // Outermost interior Y offsets must be within node half-height (30px) of src.y
    const interiorYs = layout.edges.map((e) => e.points[1].y);
    const srcY = layout.edges[0].points[0].y;
    const maxDeviation = Math.max(...interiorYs.map((y) => Math.abs(y - srcY)));
    expect(maxDeviation).toBeLessThanOrEqual(30); // NODE_HEIGHT / 2
  });

  it('renders in dark mode without errors', () => {
    const parsed = parseInitiativeStatus(SAMPLE);
    const layout = layoutInitiativeStatus(parsed);
    const container = document.createElement('div') as unknown as HTMLDivElement;

    renderInitiativeStatus(
      container,
      parsed,
      layout,
      testPalette,
      true,
      undefined,
      { width: 800, height: 600 }
    );

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});
