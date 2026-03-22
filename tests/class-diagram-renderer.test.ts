import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseClassDiagram } from '../src/class/parser';
import { layoutClassDiagram } from '../src/class/layout';
import { renderClassDiagram } from '../src/class/renderer';
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

function renderToContainer(content: string, isDark = false): HTMLDivElement {
  const parsed = parseClassDiagram(content, testPalette);
  expect(parsed.error).toBeNull();
  const layout = layoutClassDiagram(parsed);

  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 1200, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
  document.body.appendChild(container);

  renderClassDiagram(container, parsed, layout, testPalette, isDark);
  return container;
}

describe('renderClassDiagram', () => {
  describe('basic rendering', () => {
    it('renders SVG with expected structure', () => {
      const container = renderToContainer('Animal\n  name: string\n  speak(): void');
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      document.body.removeChild(container);
    });

    it('renders class nodes with cd-class class', () => {
      const container = renderToContainer('Animal\n  name: string');
      const nodes = container.querySelectorAll('.cd-class');
      expect(nodes.length).toBe(1);
      document.body.removeChild(container);
    });

    it('renders data-line-number on class nodes', () => {
      const container = renderToContainer('Animal\n  name: string');
      const node = container.querySelector('.cd-class');
      expect(node?.getAttribute('data-line-number')).toBe('1');
      document.body.removeChild(container);
    });

    it('renders data-node-id on class nodes', () => {
      const container = renderToContainer('Animal\n  name: string');
      const node = container.querySelector('.cd-class');
      expect(node?.getAttribute('data-node-id')).toBe('animal');
      document.body.removeChild(container);
    });
  });

  describe('marker defs', () => {
    it('creates marker definitions for edge types', () => {
      const container = renderToContainer('Animal\n  name: string\n\nDog extends Animal');
      const markers = container.querySelectorAll('marker');
      expect(markers.length).toBeGreaterThan(0);

      const markerIds = Array.from(markers).map(m => m.getAttribute('id'));
      expect(markerIds).toContain('cd-arrow-inherit');
      expect(markerIds).toContain('cd-arrow-implement');
      expect(markerIds).toContain('cd-arrow-compose');
      expect(markerIds).toContain('cd-arrow-aggregate');
      expect(markerIds).toContain('cd-arrow-depend');
      expect(markerIds).toContain('cd-arrow-assoc');
      document.body.removeChild(container);
    });
  });

  describe('edges', () => {
    it('renders edge groups with cd-edge-group class', () => {
      const container = renderToContainer('Animal\n  name: string\n\nDog extends Animal');
      const edges = container.querySelectorAll('.cd-edge-group');
      expect(edges.length).toBe(1);
      document.body.removeChild(container);
    });

    it('renders data-line-number on edge groups', () => {
      const container = renderToContainer('Animal\n  name: string\n\nDog extends Animal');
      const edge = container.querySelector('.cd-edge-group');
      expect(edge?.getAttribute('data-line-number')).toBe('4');
      document.body.removeChild(container);
    });

    it('renders dashed edges for implements', () => {
      const container = renderToContainer('Drawable [interface]\n  draw(): void\n\nCircle ..|> Drawable');
      const edgePath = container.querySelector('.cd-edge');
      expect(edgePath?.getAttribute('stroke-dasharray')).toBe('6 3');
      document.body.removeChild(container);
    });

    it('renders solid edges for extends', () => {
      const container = renderToContainer('Animal\n  name: string\n\nDog --|> Animal');
      const edgePath = container.querySelector('.cd-edge');
      expect(edgePath?.getAttribute('stroke-dasharray')).toBeNull();
      document.body.removeChild(container);
    });
  });

  describe('compartments', () => {
    it('renders separator lines for fields and methods', () => {
      const container = renderToContainer('Animal\n  name: string\n  speak(): void');
      const lines = container.querySelectorAll('.cd-class line');
      // Should have at least 2 separators (header/fields, fields/methods)
      expect(lines.length).toBeGreaterThanOrEqual(2);
      document.body.removeChild(container);
    });
  });

  describe('modifier badges', () => {
    it('renders interface badge text', () => {
      const container = renderToContainer('Drawable [interface]\n  draw(): void');
      const svg = container.querySelector('svg');
      const texts = svg?.querySelectorAll('text');
      const badgeTexts = Array.from(texts ?? []).map(t => t.textContent);
      expect(badgeTexts.some(t => t?.includes('interface'))).toBe(true);
      document.body.removeChild(container);
    });

    it('renders abstract badge text', () => {
      const container = renderToContainer('Shape [abstract]\n  area(): number');
      const svg = container.querySelector('svg');
      const texts = svg?.querySelectorAll('text');
      const badgeTexts = Array.from(texts ?? []).map(t => t.textContent);
      expect(badgeTexts.some(t => t?.includes('abstract'))).toBe(true);
      document.body.removeChild(container);
    });

    it('renders enum badge text', () => {
      const container = renderToContainer('Color [enum]\n  Red\n  Green\n  Blue');
      const svg = container.querySelector('svg');
      const texts = svg?.querySelectorAll('text');
      const badgeTexts = Array.from(texts ?? []).map(t => t.textContent);
      expect(badgeTexts.some(t => t?.includes('enum'))).toBe(true);
      document.body.removeChild(container);
    });
  });

  describe('title', () => {
    it('renders title when present', () => {
      const container = renderToContainer('chart: class\ntitle: My Diagram\nAnimal\n  name: string');
      const title = container.querySelector('.chart-title');
      expect(title).toBeTruthy();
      expect(title?.textContent).toBe('My Diagram');
      document.body.removeChild(container);
    });

    it('renders title with data-line-number', () => {
      const container = renderToContainer('chart: class\ntitle: My Diagram\nAnimal\n  name: string');
      const title = container.querySelector('.chart-title');
      expect(title?.getAttribute('data-line-number')).toBe('2');
      document.body.removeChild(container);
    });
  });

  describe('multiple classes', () => {
    it('renders all classes', () => {
      const container = renderToContainer('Animal\n  name: string\n\nDog\n  breed: string\n\nCat\n  indoor: boolean');
      const nodes = container.querySelectorAll('.cd-class');
      expect(nodes.length).toBe(3);
      document.body.removeChild(container);
    });
  });

  describe('legend', () => {
    it('renders legend with pill and entries when multiple class types are present', () => {
      const container = renderToContainer(
        'Drawable [interface]\n  draw(): void\n\nShape [abstract]\n  area(): number\n\nCircle extends Shape'
      );
      const legend = container.querySelector('.cd-legend');
      expect(legend).toBeTruthy();
      expect(legend!.getAttribute('data-legend-group')).toBe('type');

      // Pill text + 3 entry labels
      const allTexts = Array.from(legend!.querySelectorAll('text')).map(t => t.textContent);
      expect(allTexts).toContain('Type');
      expect(allTexts).toContain('Class');
      expect(allTexts).toContain('Abstract');
      expect(allTexts).toContain('Interface');

      // Entry groups with data-legend-entry
      const entries = legend!.querySelectorAll('[data-legend-entry]');
      expect(entries.length).toBe(3);
      const entryValues = Array.from(entries).map(e => e.getAttribute('data-legend-entry'));
      expect(entryValues).toContain('class');
      expect(entryValues).toContain('abstract');
      expect(entryValues).toContain('interface');
      document.body.removeChild(container);
    });

    it('does not render legend when only one class type is present', () => {
      const container = renderToContainer('Animal\n  name: string\n\nDog\n  breed: string');
      const legend = container.querySelector('.cd-legend');
      expect(legend).toBeNull();
      document.body.removeChild(container);
    });

    it('does not render legend when color: off', () => {
      const container = renderToContainer(
        'color: off\nDrawable [interface]\n  draw(): void\n\nShape [abstract]\n  area(): number'
      );
      const legend = container.querySelector('.cd-legend');
      expect(legend).toBeNull();
      document.body.removeChild(container);
    });

    it('does not render legend when all classes have explicit colors', () => {
      const container = renderToContainer(
        'Animal (red)\n  name: string\n\nDrawable [interface] (green)\n  draw(): void'
      );
      const legend = container.querySelector('.cd-legend');
      expect(legend).toBeNull();
      document.body.removeChild(container);
    });

    it('shows only types present in diagram', () => {
      const container = renderToContainer(
        'Color [enum]\n  Red\n  Green\n\nShape\n  area(): number'
      );
      const legend = container.querySelector('.cd-legend');
      expect(legend).toBeTruthy();

      const entries = legend!.querySelectorAll('[data-legend-entry]');
      const entryValues = Array.from(entries).map(e => e.getAttribute('data-legend-entry'));
      expect(entryValues).toContain('class');
      expect(entryValues).toContain('enum');
      expect(entryValues).not.toContain('abstract');
      expect(entryValues).not.toContain('interface');
      document.body.removeChild(container);
    });

    it('includes all four types when all are present', () => {
      const container = renderToContainer(
        'Drawable [interface]\n  draw(): void\n\nShape [abstract]\n  area(): number\n\nColor [enum]\n  Red\n\nCircle extends Shape'
      );
      const legend = container.querySelector('.cd-legend');
      expect(legend).toBeTruthy();

      const entries = legend!.querySelectorAll('[data-legend-entry]');
      const entryValues = Array.from(entries).map(e => e.getAttribute('data-legend-entry'));
      expect(entryValues).toEqual(['class', 'abstract', 'interface', 'enum']);
      document.body.removeChild(container);
    });

    it('adds data-cd-type attribute on class nodes', () => {
      const container = renderToContainer(
        'Drawable [interface]\n  draw(): void\n\nAnimal\n  name: string'
      );
      const nodes = container.querySelectorAll('.cd-class');
      const types = Array.from(nodes).map(n => n.getAttribute('data-cd-type'));
      expect(types).toContain('interface');
      expect(types).toContain('class');
      document.body.removeChild(container);
    });
  });
});
