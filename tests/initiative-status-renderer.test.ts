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

  it('compresses spacing when many parallel edges would exceed node bounds', () => {
    // 7 parallel edges: effectiveSpacing = min(16, 48/6) = 8 (compressed)
    const lines = Array.from({ length: 7 }, (_, i) => `  -E${i}-> Bar | wip`).join('\n');
    const parsed = parseInitiativeStatus(`chart: initiative-status\nFoo | wip\n${lines}\nBar | wip`);
    const layout = layoutInitiativeStatus(parsed);
    // All edges must have parallelCount=7
    expect(layout.edges.every((e) => e.parallelCount === 7)).toBe(true);
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
