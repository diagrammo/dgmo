import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { layoutGraph } from '../src/graph/layout';
import { renderFlowchart, renderFlowchartForExport } from '../src/graph/flowchart-renderer';
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
  const parsed = parseFlowchart(content, testPalette);
  expect(parsed.error).toBeUndefined();
  const layout = layoutGraph(parsed);

  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 1200, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
  document.body.appendChild(container);

  renderFlowchart(container, parsed, layout, testPalette, isDark);
  return container;
}

describe('renderFlowchart', () => {
  describe('basic rendering', () => {
    it('renders SVG with expected structure', () => {
      const container = renderToContainer('(Start) -> [Process] -> (End)');
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      document.body.removeChild(container);
    });

    it('renders correct number of node groups', () => {
      const container = renderToContainer('(Start) -> [Process] -> (End)');
      const nodeGroups = container.querySelectorAll('g.fc-node');
      expect(nodeGroups.length).toBe(3);
      document.body.removeChild(container);
    });
  });

  describe('shape rendering', () => {
    it('renders terminal as rounded rect', () => {
      const container = renderToContainer('(Start)');
      const rects = container.querySelectorAll('g.fc-node rect');
      expect(rects.length).toBeGreaterThanOrEqual(1);
      // Terminal has rx = height/2 for stadium shape
      const rx = rects[0].getAttribute('rx');
      expect(Number(rx)).toBeGreaterThanOrEqual(20);
      document.body.removeChild(container);
    });

    it('renders process as rect with small rx', () => {
      const container = renderToContainer('[Do Thing]');
      const rects = container.querySelectorAll('g.fc-node rect');
      expect(rects.length).toBeGreaterThanOrEqual(1);
      const rx = rects[0].getAttribute('rx');
      expect(Number(rx)).toBeLessThan(10);
      document.body.removeChild(container);
    });

    it('renders decision as polygon (diamond)', () => {
      const container = renderToContainer('<Valid?>');
      const polygons = container.querySelectorAll('g.fc-node polygon');
      expect(polygons.length).toBe(1);
      const points = polygons[0].getAttribute('points');
      expect(points).toBeTruthy();
      // Diamond has 4 points
      expect(points!.split(' ').length).toBe(4);
      document.body.removeChild(container);
    });

    it('renders I/O as polygon (parallelogram)', () => {
      const container = renderToContainer('/Read Input/');
      const polygons = container.querySelectorAll('g.fc-node polygon');
      expect(polygons.length).toBe(1);
      document.body.removeChild(container);
    });

    it('renders subroutine with inner border lines', () => {
      const container = renderToContainer('[[Validate]]');
      const lines = container.querySelectorAll('g.fc-node line');
      expect(lines.length).toBe(2); // left + right inner borders
      document.body.removeChild(container);
    });

    it('renders document with path (wavy bottom)', () => {
      const container = renderToContainer('[Report~]');
      const paths = container.querySelectorAll('g.fc-node path');
      expect(paths.length).toBe(1);
      const d = paths[0].getAttribute('d');
      expect(d).toContain('C'); // cubic bezier curve
      document.body.removeChild(container);
    });
  });

  describe('edge rendering', () => {
    it('renders edges as paths with marker-end', () => {
      const container = renderToContainer('[A] -> [B]');
      const edgePaths = container.querySelectorAll('path.fc-edge');
      expect(edgePaths.length).toBe(1);
      const markerEnd = edgePaths[0].getAttribute('marker-end');
      expect(markerEnd).toContain('url(#');
      document.body.removeChild(container);
    });

    it('renders edge labels at midpoint', () => {
      const container = renderToContainer('[A] -yes-> [B]');
      const edgeLabels = container.querySelectorAll('text.fc-edge-label');
      expect(edgeLabels.length).toBe(1);
      expect(edgeLabels[0].textContent).toBe('yes');
      document.body.removeChild(container);
    });
  });

  describe('group rendering', () => {
    it('renders group box and label', () => {
      const container = renderToContainer('## API(blue)\n  [Auth] -> [Route]');
      const groupRects = container.querySelectorAll('rect.fc-group');
      expect(groupRects.length).toBe(1);
      const groupLabels = container.querySelectorAll('text.fc-group-label');
      expect(groupLabels.length).toBe(1);
      expect(groupLabels[0].textContent).toBe('API');
      document.body.removeChild(container);
    });
  });

  describe('title rendering', () => {
    it('renders title text element', () => {
      const container = renderToContainer('title: My Flow\n(Start) -> (End)');
      const titles = container.querySelectorAll('text.fc-title');
      expect(titles.length).toBe(1);
      expect(titles[0].textContent).toBe('My Flow');
      document.body.removeChild(container);
    });
  });

  describe('colors', () => {
    it('applies node color when specified', () => {
      const container = renderToContainer('[Process(blue)]');
      const rects = container.querySelectorAll('g.fc-node rect');
      expect(rects.length).toBeGreaterThanOrEqual(1);
      const stroke = rects[0].getAttribute('stroke');
      expect(stroke).toBeTruthy();
      document.body.removeChild(container);
    });

    it('applies edge color when specified', () => {
      const container = renderToContainer('[A] -(blue)-> [B]');
      const edgePaths = container.querySelectorAll('path.fc-edge');
      expect(edgePaths.length).toBe(1);
      const stroke = edgePaths[0].getAttribute('stroke');
      expect(stroke).toBeTruthy();
      expect(stroke).not.toBe(testPalette.textMuted);
      document.body.removeChild(container);
    });
  });

  describe('data attributes', () => {
    it('adds data-line-number to node groups', () => {
      const container = renderToContainer('[A] -> [B]');
      const nodeGroups = container.querySelectorAll('g.fc-node[data-line-number]');
      expect(nodeGroups.length).toBe(2);
      document.body.removeChild(container);
    });

    it('adds data-line-number to edge groups', () => {
      const container = renderToContainer('[A] -> [B]');
      const edgeGroups = container.querySelectorAll('g.fc-edge-group[data-line-number]');
      expect(edgeGroups.length).toBe(1);
      document.body.removeChild(container);
    });
  });

  describe('palette theming', () => {
    it('applies background from palette', () => {
      const container = renderToContainer('(Start) -> (End)');
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      // jsdom normalizes hex (#eceff4) to rgb(236, 239, 244)
      const bg = svg!.style.background;
      expect(bg).toBeTruthy();
      expect(bg).toContain('236'); // R channel of #eceff4
      document.body.removeChild(container);
    });

    it('applies text fill from palette', () => {
      const container = renderToContainer('(Start)');
      const texts = container.querySelectorAll('g.fc-node text');
      expect(texts.length).toBeGreaterThanOrEqual(1);
      const fill = texts[0].getAttribute('fill');
      expect(fill).toBe(testPalette.text);
      document.body.removeChild(container);
    });
  });

  describe('export function', () => {
    it('renderFlowchartForExport produces valid SVG string', () => {
      const svg = renderFlowchartForExport(
        '(Start) -> [Process] -> (End)',
        'light',
        testPalette
      );
      expect(svg).toContain('<svg');
      expect(svg).toContain('xmlns');
      expect(svg).toContain('</svg>');
    });

    it('renderFlowchartForExport returns empty on parse error', () => {
      const svg = renderFlowchartForExport('chart: flowchart\n', 'light', testPalette);
      expect(svg).toBe('');
    });

    it('renderFlowchartForExport handles transparent theme', () => {
      const svg = renderFlowchartForExport(
        '(Start) -> (End)',
        'transparent',
        testPalette
      );
      expect(svg).toContain('<svg');
    });
  });
});
