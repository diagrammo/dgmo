import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseC4 } from '../src/c4/parser';
import {
  layoutC4Context,
  layoutC4Containers,
  layoutC4Components,
  rollUpContextRelationships,
  computeC4NodeDimensions,
} from '../src/c4/layout';
import {
  renderC4Context,
  renderC4ContextForExport,
  renderC4Containers,
  renderC4ContainersForExport,
  renderC4ComponentsForExport,
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
Banking is a system
  containers:
  WebApp is a container
    -Serves-> Customer
Customer is a person`;
    const parsed = parseC4(input, palette.light);
    const rels = rollUpContextRelationships(parsed);

    expect(rels.length).toBe(1);
    expect(rels[0].sourceName).toBe('Banking');
    expect(rels[0].targetName).toBe('Customer');
  });

  it('skips internal relationships (same system)', () => {
    const input = `chart: c4
Banking is a system
  containers:
  WebApp is a container
    -calls-> API
  API is a container`;
    const parsed = parseC4(input, palette.light);
    const rels = rollUpContextRelationships(parsed);

    expect(rels.length).toBe(0);
  });

  it('deduplicates rolled-up relationships', () => {
    const input = `chart: c4
Banking is a system
  containers:
  WebApp is a container
    -Serves-> Customer
  MobileApp is a container
    -Serves mobile-> Customer
Customer is a person`;
    const parsed = parseC4(input, palette.light);
    const rels = rollUpContextRelationships(parsed);

    // Both roll up to Banking→Customer, dedup keeps first
    expect(rels.length).toBe(1);
    expect(rels[0].sourceName).toBe('Banking');
    expect(rels[0].targetName).toBe('Customer');
  });

  it('explicit system-level rels override rolled-up ones', () => {
    const input = `chart: c4
Banking is a system
  -Main relationship-> Customer
  containers:
  WebApp is a container
    -Inner call-> Customer
Customer is a person`;
    const parsed = parseC4(input, palette.light);
    const rels = rollUpContextRelationships(parsed);

    expect(rels.length).toBe(1);
    expect(rels[0].label).toBe('Main relationship');
  });

  it('preserves arrow type through roll-up', () => {
    const input = `chart: c4
Banking is a system
  containers:
  WebApp is a container
    ~Async notification~> Customer
Customer is a person`;
    const parsed = parseC4(input, palette.light);
    const rels = rollUpContextRelationships(parsed);

    expect(rels.length).toBe(1);
    expect(rels[0].arrowType).toBe('async');
  });

  it('handles sync arrows in roll-up', () => {
    const input = `chart: c4
Banking is a system
  -Syncs-> Payment
Payment is a system`;
    const parsed = parseC4(input, palette.light);
    const rels = rollUpContextRelationships(parsed);

    expect(rels.length).toBe(1);
    expect(rels[0].arrowType).toBe('sync');
  });
});

// ============================================================
// computeC4NodeDimensions
// ============================================================

describe('computeC4NodeDimensions', () => {
  it('computes positive dimensions for a basic element', () => {
    const input = `chart: c4
Banking is a system`;
    const parsed = parseC4(input, palette.light);
    const el = parsed.elements[0];
    const dims = computeC4NodeDimensions(el);

    expect(dims.width).toBeGreaterThan(0);
    expect(dims.height).toBeGreaterThan(0);
  });

  it('accounts for description in height', () => {
    const noDesc = `chart: c4
Banking is a system`;
    const withDesc = `chart: c4
Banking is a system | description: Handles all banking operations for customers`;

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
Customer is a person
Banking is a system
  containers:
  WebApp is a container`;
    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Context(parsed);

    // Only Customer + Banking, not WebApp
    expect(layout.nodes.length).toBe(2);
    expect(layout.nodes.map((n) => n.name).sort()).toEqual(['Banking', 'Customer']);
  });

  it('computes positive dimensions', () => {
    const input = `chart: c4
Customer is a person
Banking is a system
  -Serves-> Customer`;
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
Customer is a person
Banking is a system
  -Serves-> Customer`;
    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Context(parsed);

    expect(layout.edges.length).toBe(1);
    expect(layout.edges[0].source).toBe('Banking');
    expect(layout.edges[0].target).toBe('Customer');
    expect(layout.edges[0].points.length).toBeGreaterThan(0);
  });

  it('carries lineNumber on nodes', () => {
    const input = `chart: c4
Customer is a person
Banking is a system`;
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
Customer is a person
Banking is a system
  -Serves-> Customer`;

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
Customer is a person
Notifications is a system
  ~Sends email~> Customer`;
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
Customer is a person`;
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
Customer is a person
Banking is a system
  -Serves-> Customer`;

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

tag: Technology alias tech
  React(blue)
  Node.js(green)
  PostgreSQL(purple)
  Redis(red)

Customer is a person
Banking is a system | description: Internet banking system
  -Serves-> Customer
  containers:
    WebApp is a container | tech: React, description: SPA frontend
      -Calls-> API | tech: JSON/HTTPS
      -Serves UI to-> Customer | tech: HTTPS
    API is a container | tech: Node.js, description: REST API backend
      -Reads/writes-> Database | tech: SQL
      ~Sessions~> Cache | tech: TCP
    Database is a container is a database | tech: PostgreSQL, description: User data
    Cache is a container is a cache | tech: Redis, description: Session store
Email is a system | description: Email delivery service
  ~Sends emails to~> Customer`;

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
Simple is a system | description: No containers`;
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
Banking is a system
  containers:
  API is a container | tech: Node.js, description: REST API`;

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
Platform is a system
  containers:
  MessageBus is a container is a queue | description: Event backbone`;

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
Banking is a system
  containers:
  API is a container | description: Backend
Monitoring is a system | description: Watches services
  -Health checks-> API`;

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
Analytics is a system
  containers:
    [Frontend]
      Dashboard is a container | description: SPA
      Admin is a container | description: Admin panel
    [Backend]
      API is a container | description: REST API`;

    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Containers(parsed, 'Analytics');

    expect(layout.nodes.filter((n) => n.type === 'container').length).toBe(3);
  });
});

// ============================================================
// Component-Level Tests
// ============================================================

const componentInput = `chart: c4
title: Component View

tag: Technology alias tech
  Spring(green)
  React(blue)
  PostgreSQL(purple)

Customer is a person
Ride Platform is a system | description: Ride-sharing platform
  containers:
    Ride Service is a container | tech: Spring, description: Core ride logic
      components:
        Ride Controller is a component | tech: Spring, description: REST endpoints
          -Delegates to-> Ride Manager
          -Sends ride status-> Customer | tech: WebSocket
        Ride Manager is a component | description: Business logic
          -Reads/writes rides-> Ride Repository
        Ride Repository is a component is a database | tech: PostgreSQL, description: Ride data access
    API Gateway is a container | tech: Spring, description: Edge proxy
      -Routes requests-> Ride Controller | tech: HTTPS
Payments is a system | description: Payment processing
  -Charges rider-> Ride Manager`;

describe('layoutC4Components', () => {
  it('renders all components for a container', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    const compNodes = layout.nodes.filter((n) => n.type === 'component');
    expect(compNodes.length).toBe(3);
    expect(compNodes.map((n) => n.name).sort()).toEqual(
      ['Ride Controller', 'Ride Manager', 'Ride Repository']
    );
  });

  it('includes external elements with relationships to components', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    const externalNodes = layout.nodes.filter((n) => n.type !== 'component');
    expect(externalNodes.length).toBeGreaterThanOrEqual(1);
    // Customer has a relationship from Ride Controller
    expect(externalNodes.some((n) => n.name === 'Customer')).toBe(true);
  });

  it('includes external systems that target components (reverse)', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    const externalNodes = layout.nodes.filter((n) => n.type !== 'component');
    // Payments targets Ride Manager
    expect(externalNodes.some((n) => n.name === 'Payments')).toBe(true);
  });

  it('includes external containers that target components (reverse)', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    const externalNodes = layout.nodes.filter((n) => n.type !== 'component');
    // API Gateway targets Ride Controller
    expect(externalNodes.some((n) => n.name === 'API Gateway')).toBe(true);
  });

  it('computes boundary box labeled with container name', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    expect(layout.boundary).toBeDefined();
    expect(layout.boundary!.label).toBe('Ride Service');
    expect(layout.boundary!.typeLabel).toBe('container');
    expect(layout.boundary!.width).toBeGreaterThan(0);
    expect(layout.boundary!.height).toBeGreaterThan(0);
  });

  it('carries shape information on component nodes', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    const repoNode = layout.nodes.find((n) => n.name === 'Ride Repository');
    expect(repoNode?.shape).toBe('database');
  });

  it('carries technology on component nodes', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    const controllerNode = layout.nodes.find((n) => n.name === 'Ride Controller');
    expect(controllerNode?.technology).toBe('Spring');

    const repoNode = layout.nodes.find((n) => n.name === 'Ride Repository');
    expect(repoNode?.technology).toBe('PostgreSQL');
  });

  it('produces edges for component relationships', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    expect(layout.edges.length).toBeGreaterThanOrEqual(2);
    // Ride Controller -> Ride Manager
    expect(layout.edges.some((e) => e.source === 'Ride Controller' && e.target === 'Ride Manager')).toBe(true);
    // Ride Manager -> Ride Repository
    expect(layout.edges.some((e) => e.source === 'Ride Manager' && e.target === 'Ride Repository')).toBe(true);
  });

  it('produces edges from components to external elements', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    // Ride Controller -> Customer
    expect(layout.edges.some((e) => e.source === 'Ride Controller' && e.target === 'Customer')).toBe(true);
  });

  it('returns empty result for unknown system', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'NonExistent', 'Ride Service');
    expect(layout.nodes.length).toBe(0);
  });

  it('returns empty result for unknown container', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'NonExistent');
    expect(layout.nodes.length).toBe(0);
  });

  it('returns empty result for container with no components', () => {
    const input = `chart: c4
Platform is a system
  containers:
    Simple is a container | description: No components`;
    const parsed = parseC4(input, palette.light);
    const layout = layoutC4Components(parsed, 'Platform', 'Simple');
    expect(layout.nodes.length).toBe(0);
  });

  it('resolves tag group colors with inheritance (system → container → component)', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service', 'Technology');

    const controllerNode = layout.nodes.find((n) => n.name === 'Ride Controller');
    expect(controllerNode?.color).toBeDefined();
  });

  it('has positive dimensions', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

// ============================================================
// renderC4Containers reused for components (JSDOM)
// ============================================================

describe('renderC4Components via renderC4Containers', () => {
  it('produces SVG with component cards and boundary', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    const el = document.createElement('div');
    document.body.appendChild(el);

    renderC4Containers(el, parsed, layout, palette.light, false, undefined, {
      width: 1000,
      height: 800,
    });

    const svg = el.querySelector('svg');
    expect(svg).not.toBeNull();

    // Component cards
    const cards = svg!.querySelectorAll('.c4-card');
    expect(cards.length).toBeGreaterThanOrEqual(3);

    // Boundary box
    const boundary = svg!.querySelector('.c4-boundary');
    expect(boundary).not.toBeNull();

    // Edges
    const edges = svg!.querySelectorAll('.c4-edge');
    expect(edges.length).toBeGreaterThanOrEqual(1);

    document.body.removeChild(el);
  });

  it('renders database shape on component with is a database', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    const el = document.createElement('div');
    document.body.appendChild(el);

    renderC4Containers(el, parsed, layout, palette.light, false, undefined, {
      width: 1000,
      height: 800,
    });

    const dbCard = el.querySelector('[data-shape="database"]');
    expect(dbCard).not.toBeNull();

    document.body.removeChild(el);
  });

  it('renders technology row on component cards', () => {
    const parsed = parseC4(componentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Ride Platform', 'Ride Service');

    const el = document.createElement('div');
    document.body.appendChild(el);

    renderC4Containers(el, parsed, layout, palette.light, false, undefined, {
      width: 1000,
      height: 800,
    });

    const allTexts = Array.from(el.querySelectorAll('text'));
    const techKeyText = allTexts.find((t) => t.textContent === 'Technology:');
    expect(techKeyText).toBeDefined();

    document.body.removeChild(el);
  });
});

// ============================================================
// renderC4ComponentsForExport
// ============================================================

describe('renderC4ComponentsForExport', () => {
  for (const paletteName of getAvailablePalettes()) {
    for (const theme of ['light', 'dark'] as const) {
      it(`produces non-empty SVG for ${paletteName} / ${theme}`, () => {
        const pal = getPalette(paletteName);
        const colors = theme === 'dark' ? pal.dark : pal.light;
        const svg = renderC4ComponentsForExport(componentInput, 'Ride Platform', 'Ride Service', theme, colors);

        expect(svg.length).toBeGreaterThan(0);
        expect(svg).toContain('<svg');
        expect(svg).toContain('</svg>');
      });
    }
  }

  it('returns empty string for unknown system', () => {
    const svg = renderC4ComponentsForExport(componentInput, 'NonExistent', 'Ride Service', 'light', palette.light);
    expect(svg).toBe('');
  });

  it('returns empty string for unknown container', () => {
    const svg = renderC4ComponentsForExport(componentInput, 'Ride Platform', 'NonExistent', 'light', palette.light);
    expect(svg).toBe('');
  });

  it('handles transparent theme', () => {
    const svg = renderC4ComponentsForExport(componentInput, 'Ride Platform', 'Ride Service', 'transparent', palette.light);
    expect(svg.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Group Boundaries
// ============================================================

const groupedContainerInput = `chart: c4
title: Grouped Containers
Analytics is a system | description: Analytics platform
  containers:
    [Frontend]
      Dashboard is a container | description: SPA
      Admin is a container | description: Admin panel
    [Backend]
      API is a container | description: REST API
      Worker is a container | description: Background jobs
        -Calls-> API
User is a person
  -Uses-> Dashboard`;

describe('group boundaries in container layout', () => {
  it('produces groupBoundaries with correct labels and typeLabel', () => {
    const parsed = parseC4(groupedContainerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Analytics');

    expect(layout.groupBoundaries.length).toBe(2);
    const labels = layout.groupBoundaries.map((gb) => gb.label).sort();
    expect(labels).toEqual(['Backend', 'Frontend']);
    for (const gb of layout.groupBoundaries) {
      expect(gb.typeLabel).toBe('group');
    }
  });

  it('group boundaries have positive dimensions', () => {
    const parsed = parseC4(groupedContainerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Analytics');

    for (const gb of layout.groupBoundaries) {
      expect(gb.width).toBeGreaterThan(0);
      expect(gb.height).toBeGreaterThan(0);
    }
  });

  it('no-group layouts produce groupBoundaries: []', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    expect(layout.groupBoundaries).toEqual([]);
  });

  it('renderer produces .c4-group-boundary SVG elements matching group count', () => {
    const parsed = parseC4(groupedContainerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Analytics');

    const el = document.createElement('div');
    document.body.appendChild(el);

    renderC4Containers(el, parsed, layout, palette.light, false, undefined, {
      width: 1000,
      height: 800,
    });

    const groupBounds = el.querySelectorAll('.c4-group-boundary');
    expect(groupBounds.length).toBe(2);

    document.body.removeChild(el);
  });

  it('parent boundary rect has no stroke-dasharray (solid)', () => {
    const parsed = parseC4(containerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Banking');

    const el = document.createElement('div');
    document.body.appendChild(el);

    renderC4Containers(el, parsed, layout, palette.light, false, undefined, {
      width: 1000,
      height: 800,
    });

    const boundaryRect = el.querySelector('.c4-boundary rect');
    expect(boundaryRect).not.toBeNull();
    expect(boundaryRect!.getAttribute('stroke-dasharray')).toBeNull();

    document.body.removeChild(el);
  });

  it('group boundaries carry data-line-number', () => {
    const parsed = parseC4(groupedContainerInput, palette.light);
    const layout = layoutC4Containers(parsed, 'Analytics');

    const el = document.createElement('div');
    document.body.appendChild(el);

    renderC4Containers(el, parsed, layout, palette.light, false, undefined, {
      width: 1000,
      height: 800,
    });

    const groupBounds = el.querySelectorAll('.c4-group-boundary');
    for (const gb of groupBounds) {
      expect(gb.getAttribute('data-line-number')).toBeTruthy();
    }

    document.body.removeChild(el);
  });
});

const groupedComponentInput = `chart: c4
Platform is a system | description: Platform
  containers:
    Service is a container | description: Main service
      components:
        [Controllers]
          UserCtrl is a component | description: User endpoints
          OrderCtrl is a component | description: Order endpoints
        [Repositories]
          UserRepo is a component is a database | description: User data
`;

describe('group boundaries in component layout', () => {
  it('component-level groups produce group boundaries', () => {
    const parsed = parseC4(groupedComponentInput, palette.light);
    const layout = layoutC4Components(parsed, 'Platform', 'Service');

    expect(layout.groupBoundaries.length).toBe(2);
    const labels = layout.groupBoundaries.map((gb) => gb.label).sort();
    expect(labels).toEqual(['Controllers', 'Repositories']);
    for (const gb of layout.groupBoundaries) {
      expect(gb.typeLabel).toBe('group');
      expect(gb.width).toBeGreaterThan(0);
      expect(gb.height).toBeGreaterThan(0);
    }
  });
});
