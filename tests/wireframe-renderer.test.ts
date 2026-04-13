import { describe, it, expect, beforeEach } from 'vitest';
import { parseWireframe, resetWireframeIds } from '../src/wireframe/parser';
import { layoutWireframe } from '../src/wireframe/layout';
import { renderWireframe } from '../src/wireframe/renderer';
import { JSDOM } from 'jsdom';

// Use bold palette for tests (well-defined colors)
const testPalette = {
  bg: '#ffffff',
  surface: '#f5f5f5',
  overlay: '#eeeeee',
  border: '#cccccc',
  text: '#333333',
  textMuted: '#888888',
  primary: '#2563eb',
  secondary: '#7c3aed',
  accent: '#06b6d4',
  destructive: '#dc2626',
  colors: {
    red: '#ef4444',
    orange: '#f97316',
    yellow: '#eab308',
    green: '#22c55e',
    blue: '#3b82f6',
    purple: '#a855f7',
    teal: '#14b8a6',
    cyan: '#06b6d4',
    gray: '#6b7280',
    black: '#000000',
    white: '#ffffff',
  },
};

function renderToSvg(
  src: string,
  theme = 'light'
): { container: HTMLDivElement; svg: SVGSVGElement } {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const container = dom.window.document.createElement('div');
  container.style.width = '1200px';
  container.style.height = '800px';
  dom.window.document.body.appendChild(container);

  const parsed = parseWireframe(src);
  const layout = layoutWireframe(parsed);

  renderWireframe(
    container,
    parsed,
    layout,
    testPalette,
    theme === 'dark',
    undefined,
    { width: layout.width, height: layout.height },
    theme
  );

  const svg = container.querySelector('svg')!;
  return { container, svg };
}

beforeEach(() => {
  resetWireframeIds();
});

describe('wireframe renderer', () => {
  describe('SVG structure', () => {
    it('renders an SVG element', () => {
      const { svg } = renderToSvg('wireframe Test\nHello');
      expect(svg).toBeTruthy();
      expect(svg.tagName).toBe('svg');
    });

    it('renders title text', () => {
      const { svg } = renderToSvg('wireframe My Page\nHello');
      const texts = svg.querySelectorAll('text');
      const titleText = Array.from(texts).find(
        (t) => t.textContent === 'My Page'
      );
      expect(titleText).toBeTruthy();
    });
  });

  describe('groups', () => {
    it('renders group with dashed border', () => {
      const { svg } = renderToSvg('wireframe Test\n[Sidebar]\n  Content');
      const rects = svg.querySelectorAll('rect[stroke-dasharray]');
      expect(rects.length).toBeGreaterThan(0);
    });

    it('renders group label', () => {
      const { svg } = renderToSvg('wireframe Test\n[Sidebar]\n  Content');
      const texts = svg.querySelectorAll('text');
      const label = Array.from(texts).find((t) => t.textContent === 'SIDEBAR');
      expect(label).toBeTruthy();
    });
  });

  describe('buttons', () => {
    it('renders button with rounded rectangle', () => {
      const { svg } = renderToSvg('wireframe Test\n(Click Me)');
      const rects = svg.querySelectorAll('rect[rx]');
      expect(rects.length).toBeGreaterThan(0);
      const texts = svg.querySelectorAll('text');
      const btnText = Array.from(texts).find(
        (t) => t.textContent === 'Click Me'
      );
      expect(btnText).toBeTruthy();
    });
  });

  describe('text inputs', () => {
    it('renders text input with border', () => {
      const { svg } = renderToSvg(
        'wireframe Test\n[Sidebar]\n  [Email address]'
      );
      // Should have an input rect with stroke
      const rects = svg.querySelectorAll('rect[stroke]');
      expect(rects.length).toBeGreaterThan(0);
    });
  });

  describe('transparent theme', () => {
    it('renders groups with border instead of fill in transparent mode', () => {
      const { svg } = renderToSvg(
        'wireframe Test\n[Sidebar]\n  Content',
        'transparent'
      );
      const dashedRects = svg.querySelectorAll('rect[stroke-dasharray]');
      expect(dashedRects.length).toBeGreaterThan(0);
      // All dashed rects should have fill=none in transparent mode
      for (const rect of dashedRects) {
        expect(rect.getAttribute('fill')).toBe('none');
      }
    });
  });

  describe('data attributes', () => {
    it('sets data-line-number on elements', () => {
      const { svg } = renderToSvg('wireframe Test\n(Button)');
      const g = svg.querySelector('g[data-line-number]');
      expect(g).toBeTruthy();
    });
  });
});
