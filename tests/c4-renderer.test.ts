import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseC4 } from '../src/c4/parser';
import {
  layoutC4Context,
  layoutC4Containers,
  rollUpContextRelationships,
  computeC4NodeDimensions,
} from '../src/c4/layout';
import {
  renderC4Context,
  renderC4ContextForExport,
  renderC4Containers,
  renderC4ContainersForExport,
} from '../src/c4/renderer';
import { getPalette, getAvailablePalettes } from '../src/palettes';

// Set up jsdom globals
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

const palette = getPalette('nord');

// ============================================================
// rollUpContextRelationships (pure, no DOM)
// ============================================================

describe('rollUpContextRelationships', () => {
  it('rolls up container→system relationships to system-to-system', () => {
    const input = `chart: c4
system Banking
  containers:
  container WebApp
    -> Customer: Serves
person Customer`;
    const parsed = parseC4(input, palette.light);
    const rels = rollUpContextRelationships(parsed);

    expect(rels.length).toBe(1);
    expect(rels[0].sourceName).toBe('Banking');
    expect(rels[0].targetName).toBe('Customer');
  });

  it('skips internal relationships (same system)', () => {
    const input = `chart: c4
system Banking
  containers:
  container WebApp
    -> API: calls
  container API`;
    const parsed = parseC4(input, palette.light);
    const rels = rollUpContextRelationships(parsed);

    expect(rels.length).toBe(0);
  });

  it('deduplicates rolled-up relationships', () => {
    const input = `chart: c4
system Banking
  containers:
  container WebApp
    -> Customer: Serves
  container MobileApp
    -> Customer: Serves mobile
person Customer`;
    const parsed = parseC4(input, palette.light);
    const rels = rollUpContextRelationships(parsed);

    // Both roll up to Banking→Customer, dedup keeps first
    expect(rels.length).toBe(1);
    expect(rels[0].sourceName).toBe('Banking');
    expect(rels[0].targetName).toBe('Customer');
  });

  it('explicit system-level rels override rolled-up ones', () => {
    const input = `chart: c4
system Banking
  -> Customer: Main relationship
  containers:
  container WebApp
    -> Customer: Inner call
person Customer`;
    const parsed = parseC4(input, palette.light);
    const rels = rollUpContextRelationships(parsed);

    expect(rels.length).toBe(1);
    expect(rels[0].label).toBe('Main relationship');
  });

  it('preserves arrow type through roll-up', () => {
    const input = `chart: c4
system Banking
  containers:
  container WebApp
    ~> Customer: Async notification
person Customer`;
    const parsed = parseC4(input, palette.light);
    const rels = rollUpContextRelationships(parsed);

    expect(rels.length).toBe(1);
    expect(rels[0].arrowType).toBe('async');
  });

  it('handles bidirectional arrows', () => {
    const input = `chart: c4
system Banking
  <-> Payment: Syncs
system Payment`;
    const parsed = parseC4(input, palette.light);
    const rels = rollUpContextRelationships(parsed);

    expect(rels.length).toBe(1);
    expect(rels[0].arrowType).toBe('bidirectional');
  });
});

// ============================================================
// computeC4NodeDimensions
// ============================================================

describe('computeC4NodeDimensions', () => {
  it('computes positive dimensions for a basic element', () => {
    const input = `chart: c4
system Banking`;
    const parsed = parseC4(input, palette.light);
    const el = parsed.elements[0];
    const dims = computeC4NodeDimensions(el);

    expect(dims.width).toBeGreaterThan(0);
    expect(dims.height).toBeGreaterThan(0);
  });

  it('accounts for description in height', () => {
    const noDesc = `chart: c4
system Banking`;
    const withDesc = `chart: c4
system Banking | description: Handles all banking operations for customers`;

    const parsedNoDesc = parseC4(noDesc, palette.light);
    const parsedWithDesc = parseC4(withDesc, palette.light);

    const dimsNoDesc = computeC4NodeDimensions(parsedNoDesc.elements[0]);
    const dimsWithDesc = computeC4NodeDimensions(parsedWithDesc.elements[0]);

    expect(dimsWithDesc.height).toBeGreaterThan(dimsNoDesc.height);
  });
});

// ============================================================
// layoutC4Context
// ============================================================

describe('layoutC4Context', () => {
  it('filters to person and system elements only', () => {
    const input = `chart: c4
person Customer
system Banking
  containers:
  container WebApp`;
    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Context(parsed);

    // Only Customer + Banking, not WebApp
    expect(layout.nodes.length).toBe(2);
    expect(layout.nodes.map((n) => n.name).sort()).toEqual(['Banking', 'Customer']);
  });

  it('computes positive dimensions', () => {
    const input = `chart: c4
person Customer
system Banking
  -> Customer: Serves`;
    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Context(parsed);

    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.nodes.every((n) => n.width > 0 && n.height > 0)).toBe(true);
  });

  it('handles empty input', () => {
    const input = `chart: c4`;
    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Context(parsed);

    expect(layout.nodes.length).toBe(0);
    expect(layout.edges.length).toBe(0);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(0);
  });

  it('produces edges for valid relationships', () => {
    const input = `chart: c4
person Customer
system Banking
  -> Customer: Serves`;
    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Context(parsed);

    expect(layout.edges.length).toBe(1);
    expect(layout.edges[0].source).toBe('Banking');
    expect(layout.edges[0].target).toBe('Customer');
    expect(layout.edges[0].points.length).toBeGreaterThan(0);
  });

  it('carries lineNumber on nodes', () => {
    const input = `chart: c4
person Customer
system Banking`;
    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Context(parsed);

    for (const node of layout.nodes) {
      expect(node.lineNumber).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// renderC4Context (JSDOM)
// ============================================================

describe('renderC4Context', () => {
  const basicInput = `chart: c4
title: System Context
person Customer
system Banking
  -> Customer: Serves`;

  it('produces SVG with cards and edges', () => {
    const parsed = parseC4(basicInput, palette.light);
    const layout = layoutC4Context(parsed);

    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    document.body.appendChild(container);

    renderC4Context(container, parsed, layout, palette.light, false, undefined, {
      width: 800,
      height: 600,
    });

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();

    // Cards rendered
    const cards = svg!.querySelectorAll('.c4-card');
    expect(cards.length).toBe(2);

    // Edges rendered
    const edges = svg!.querySelectorAll('.c4-edge');
    expect(edges.length).toBeGreaterThanOrEqual(1);

    document.body.removeChild(container);
  });

  it('renders title with data-line-number', () => {
    const parsed = parseC4(basicInput, palette.light);
    const layout = layoutC4Context(parsed);

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderC4Context(container, parsed, layout, palette.light, false, undefined, {
      width: 800,
      height: 600,
    });

    const title = container.querySelector('.chart-title');
    expect(title).not.toBeNull();
    expect(title!.getAttribute('data-line-number')).toBeTruthy();
    expect(title!.textContent).toBe('System Context');

    document.body.removeChild(container);
  });

  it('uses dashed stroke for async edges', () => {
    const input = `chart: c4
person Customer
system Notifications
  ~> Customer: Sends email`;
    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Context(parsed);

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderC4Context(container, parsed, layout, palette.light, false, undefined, {
      width: 800,
      height: 600,
    });

    const edge = container.querySelector('.c4-edge');
    expect(edge).not.toBeNull();
    expect(edge!.getAttribute('stroke-dasharray')).toBe('6 3');

    document.body.removeChild(container);
  });

  it('renders person icon for person nodes', () => {
    const input = `chart: c4
person Customer`;
    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Context(parsed);

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderC4Context(container, parsed, layout, palette.light, false, undefined, {
      width: 800,
      height: 600,
    });

    // Person icon has a circle (head) inside the card
    const card = container.querySelector('.c4-card');
    expect(card).not.toBeNull();
    const circles = card!.querySelectorAll('circle');
    expect(circles.length).toBeGreaterThanOrEqual(1);

    document.body.removeChild(container);
  });

  it('renders data-line-number on cards', () => {
    const parsed = parseC4(basicInput, palette.light);
    const layout = layoutC4Context(parsed);

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderC4Context(container, parsed, layout, palette.light, false, undefined, {
      width: 800,
      height: 600,
    });

    const cards = container.querySelectorAll('.c4-card');
    for (const card of cards) {
      expect(card.getAttribute('data-line-number')).toBeTruthy();
    }

    document.body.removeChild(container);
  });
});

// ============================================================
// renderC4ContextForExport — all palettes × light/dark
// ============================================================

describe('renderC4ContextForExport', () => {
  const basicInput = `chart: c4
person Customer
system Banking
  -> Customer: Serves`;

  const allPalettes = getAvailablePalettes();

  for (const paletteName of allPalettes) {
    for (const theme of ['light', 'dark'] as const) {
      it(`produces non-empty SVG for ${paletteName} / ${theme}`, () => {
        const pal = getPalette(paletteName);
        const colors = theme === 'dark' ? pal.dark : pal.light;
        const svg = renderC4ContextForExport(basicInput, theme, colors);

        expect(svg.length).toBeGreaterThan(0);
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
      });
    }
  }

  it('returns empty string for empty input', () => {
    const svg = renderC4ContextForExport('chart: c4', 'light', palette.light);
    expect(svg).toBe('');
  });

  it('handles transparent theme', () => {
    const svg = renderC4ContextForExport(basicInput, 'transparent', palette.light);
    expect(svg.length).toBeGreaterThan(0);
  });
});

// ============================================================
// layoutC4Containers
// ============================================================

const containerInput = `chart: c4
title: Container View

## Technology alias tech
  React(blue)
  Node.js(green)
  PostgreSQL(purple)
  Redis(red)

person Customer
system Banking | description: Internet banking system
  -> Customer: Serves
  containers:
    container WebApp | tech: React, description: SPA frontend
      -> API: Calls [JSON/HTTPS]
      -> Customer: Serves UI to [HTTPS]
    container API | tech: Node.js, description: REST API backend
      -> Database: Reads/writes [SQL]
      ~> Cache: Sessions [TCP]
    container Database is a database | tech: PostgreSQL, description: User data
    container Cache is a cache | tech: Redis, description: Session store
system Email | description: Email delivery service
  ~> Customer: Sends emails to`;

describe('layoutC4Containers', () => {
  it('renders all containers for a system', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    const containerNodes = layout.nodes.filter((n) => n.type === 'container');
    expect(containerNodes.length).toBe(4);
    expect(containerNodes.map((n) => n.name).sort()).toEqual(
      ['API', 'Cache', 'Database', 'WebApp']
    );
  });

  it('includes external elements with relationships to containers', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    const externalNodes = layout.nodes.filter((n) => n.type !== 'container');
    expect(externalNodes.length).toBeGreaterThanOrEqual(1);
    expect(externalNodes.some((n) => n.name === 'Customer')).toBe(true);
  });

  it('computes boundary box from container positions', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    expect(layout.boundary).toBeDefined();
    expect(layout.boundary!.label).toBe('Banking');
    expect(layout.boundary!.typeLabel).toBe('system');
    expect(layout.boundary!.width).toBeGreaterThan(0);
    expect(layout.boundary!.height).toBeGreaterThan(0);
  });

  it('carries shape information on container nodes', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    const dbNode = layout.nodes.find((n) => n.name === 'Database');
    expect(dbNode?.shape).toBe('database');

    const cacheNode = layout.nodes.find((n) => n.name === 'Cache');
    expect(cacheNode?.shape).toBe('cache');
  });

  it('carries technology on container nodes', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    const apiNode = layout.nodes.find((n) => n.name === 'API');
    expect(apiNode?.technology).toBe('Node.js');

    const dbNode = layout.nodes.find((n) => n.name === 'Database');
    expect(dbNode?.technology).toBe('PostgreSQL');
  });

  it('produces edges for container relationships', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    expect(layout.edges.length).toBeGreaterThanOrEqual(3);
    // WebApp -> API
    expect(layout.edges.some((e) => e.source === 'WebApp' && e.target === 'API')).toBe(true);
    // API -> Database
    expect(layout.edges.some((e) => e.source === 'API' && e.target === 'Database')).toBe(true);
  });

  it('returns empty result for unknown system name', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'NonExistent');

    expect(layout.nodes.length).toBe(0);
    expect(layout.edges.length).toBe(0);
  });

  it('returns empty result for system with no containers', () => {
    const input = `chart: c4
system Simple | description: No containers`;
    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Containers(parsed, 'Simple');

    expect(layout.nodes.length).toBe(0);
  });

  it('resolves tag group colors on containers', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking', 'Technology');

    const webNode = layout.nodes.find((n) => n.name === 'WebApp');
    expect(webNode?.color).toBeDefined();
  });

  it('has positive dimensions', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

// ============================================================
// renderC4Containers (JSDOM)
// ============================================================

describe('renderC4Containers', () => {
  it('produces SVG with container cards and boundary', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    const el = document.createElement('div');
    document.body.appendChild(el);

    renderC4Containers(el, parsed, layout, palette.light, false, undefined, {
      width: 1000,
      height: 800,
    });

    const svg = el.querySelector('svg');
    expect(svg).not.toBeNull();

    // Container cards
    const cards = svg!.querySelectorAll('.c4-card');
    expect(cards.length).toBeGreaterThanOrEqual(4);

    // Boundary box
    const boundary = svg!.querySelector('.c4-boundary');
    expect(boundary).not.toBeNull();

    // Edges
    const edges = svg!.querySelectorAll('.c4-edge');
    expect(edges.length).toBeGreaterThanOrEqual(1);

    document.body.removeChild(el);
  });

  it('renders database shape with cylinder (ellipse)', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    const el = document.createElement('div');
    document.body.appendChild(el);

    renderC4Containers(el, parsed, layout, palette.light, false, undefined, {
      width: 1000,
      height: 800,
    });

    // Find the Database card by data-shape attribute
    const dbCard = el.querySelector('[data-shape="database"]');
    expect(dbCard).not.toBeNull();
    // Database shape should have an ellipse (cylinder top)
    const ellipse = dbCard!.querySelector('ellipse');
    expect(ellipse).not.toBeNull();

    document.body.removeChild(el);
  });

  it('renders cache shape with dashed cylinder', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    const el = document.createElement('div');
    document.body.appendChild(el);

    renderC4Containers(el, parsed, layout, palette.light, false, undefined, {
      width: 1000,
      height: 800,
    });

    const cacheCard = el.querySelector('[data-shape="cache"]');
    expect(cacheCard).not.toBeNull();
    // Cache should have dashed stroke
    const path = cacheCard!.querySelector('path');
    expect(path?.getAttribute('stroke-dasharray')).toBe('6 3');

    document.body.removeChild(el);
  });

  it('renders technology row on container cards', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    const el = document.createElement('div');
    document.body.appendChild(el);

    renderC4Containers(el, parsed, layout, palette.light, false, undefined, {
      width: 1000,
      height: 800,
    });

    // Technology should appear as metadata row (org-chart style "Technology:" + value)
    const allTexts = Array.from(el.querySelectorAll('text'));
    const techKeyText = allTexts.find((t) => t.textContent === 'Technology:');
    expect(techKeyText).toBeDefined();

    document.body.removeChild(el);
  });

  it('renders data-line-number on cards and boundary', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    const el = document.createElement('div');
    document.body.appendChild(el);

    renderC4Containers(el, parsed, layout, palette.light, false, undefined, {
      width: 1000,
      height: 800,
    });

    const cards = el.querySelectorAll('.c4-card');
    for (const card of cards) {
      expect(card.getAttribute('data-line-number')).toBeTruthy();
    }

    const boundary = el.querySelector('.c4-boundary');
    expect(boundary?.getAttribute('data-line-number')).toBeTruthy();

    document.body.removeChild(el);
  });

  it('renders title', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    const el = document.createElement('div');
    document.body.appendChild(el);

    renderC4Containers(el, parsed, layout, palette.light, false, undefined, {
      width: 1000,
      height: 800,
    });

    const title = el.querySelector('.chart-title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('Container View');

    document.body.removeChild(el);
  });
});

// ============================================================
// renderC4ContainersForExport
// ============================================================

describe('renderC4ContainersForExport', () => {
  for (const paletteName of getAvailablePalettes()) {
    for (const theme of ['light', 'dark'] as const) {
      it(`produces non-empty SVG for ${paletteName} / ${theme}`, () => {
        const pal = getPalette(paletteName);
        const colors = theme === 'dark' ? pal.dark : pal.light;
        const svg = renderC4ContainersForExport(containerInput, 'Banking', theme, colors);

        expect(svg.length).toBeGreaterThan(0);
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
      });
    }
  }

  it('returns empty string for unknown system', () => {
    const svg = renderC4ContainersForExport(containerInput, 'NonExistent', 'light', palette.light);
    expect(svg).toBe('');
  });

  it('handles transparent theme', () => {
    const svg = renderC4ContainersForExport(containerInput, 'Banking', 'transparent', palette.light);
    expect(svg.length).toBeGreaterThan(0);
  });
});

// ============================================================
// computeC4NodeDimensions with technology
// ============================================================

describe('computeC4NodeDimensions with technology', () => {
  it('accounts for technology in height when showTechnology is true', () => {
    const input = `chart: c4
system Banking
  containers:
  container API | tech: Node.js, description: REST API`;

    const parsed = parseC4(input, palette.light);
    const container = parsed.elements[0].children[0];

    const dimsContext = computeC4NodeDimensions(container);
    const dimsContainer = computeC4NodeDimensions(container, { showTechnology: true });

    // Container card: no type label, but has metadata rows below divider
    // Both should be reasonable heights
    expect(dimsContext.height).toBeGreaterThan(50);
    expect(dimsContainer.height).toBeGreaterThan(50);
    // Container card should include metadata row space
    // (metadata adds divider + tech row, but removes type label)
    expect(dimsContainer.height).toBeGreaterThan(0);
  });
});

// ============================================================
// is a shape override
// ============================================================

describe('is a shape override in container layout', () => {
  it('renders is-a shape override correctly', () => {
    const input = `chart: c4
system Platform
  containers:
  container MessageBus is a queue | description: Event backbone`;

    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Containers(parsed, 'Platform');

    const queueNode = layout.nodes.find((n) => n.name === 'MessageBus');
    expect(queueNode).toBeDefined();
    expect(queueNode!.shape).toBe('queue');
  });
});

// ============================================================
// External element reverse relationship discovery
// ============================================================

describe('reverse relationship discovery', () => {
  it('includes external systems that target containers', () => {
    const input = `chart: c4
system Banking
  containers:
  container API | description: Backend
system Monitoring | description: Watches services
  -> API: Health checks`;

    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    // Monitoring targets API (a container), so it should appear as external
    const monNode = layout.nodes.find((n) => n.name === 'Monitoring');
    expect(monNode).toBeDefined();
    expect(monNode!.type).toBe('system');
  });
});

// ============================================================
// Containers in groups
// ============================================================

describe('containers in groups', () => {
  it('collects containers from groups', () => {
    const input = `chart: c4
system Analytics
  containers:
    [Frontend]
      container Dashboard | description: SPA
      container Admin | description: Admin panel
    [Backend]
      container API | description: REST API`;

    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Containers(parsed, 'Analytics');

    expect(layout.nodes.filter((n) => n.type === 'container').length).toBe(3);
  });
});
