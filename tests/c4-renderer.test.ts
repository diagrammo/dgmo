import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseC4 } from '../src/c4/parser';
import {
  layoutC4Context,
  rollUpContextRelationships,
  computeC4NodeDimensions,
} from '../src/c4/layout';
import { renderC4Context, renderC4ContextForExport } from '../src/c4/renderer';
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
