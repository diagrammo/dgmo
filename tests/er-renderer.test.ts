import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseERDiagram } from '../src/er/parser';
import { layoutERDiagram } from '../src/er/layout';
import { renderERDiagram } from '../src/er/renderer';
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

const SAMPLE_ER = `chart: er
title: Blog Platform

users
  id: int [pk]
  name: varchar
  email: varchar [unique]

posts
  id: int [pk]
  author_id: int [fk]
  title: varchar

users 1--* posts: writes`;

function renderToContainer(content: string, isDark = false): HTMLDivElement {
  const parsed = parseERDiagram(content, testPalette);
  expect(parsed.error).toBeNull();
  const layout = layoutERDiagram(parsed);

  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 1200, configurable: true });
  Object.defineProperty(container, 'clientHeight', { value: 800, configurable: true });
  document.body.appendChild(container);

  renderERDiagram(container, parsed, layout, testPalette, isDark);
  return container;
}

describe('renderERDiagram', () => {
  describe('basic rendering', () => {
    it('renders SVG with expected structure', () => {
      const container = renderToContainer(SAMPLE_ER);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      document.body.removeChild(container);
    });

    it('renders table nodes with er-table class', () => {
      const container = renderToContainer(SAMPLE_ER);
      const nodes = container.querySelectorAll('.er-table');
      expect(nodes.length).toBe(2);
      document.body.removeChild(container);
    });

    it('renders data-line-number on table nodes', () => {
      const container = renderToContainer('users\n  id: int [pk]');
      const node = container.querySelector('.er-table');
      expect(node?.getAttribute('data-line-number')).toBe('1');
      document.body.removeChild(container);
    });

    it('renders data-node-id on table nodes', () => {
      const container = renderToContainer('users\n  id: int [pk]');
      const node = container.querySelector('.er-table');
      expect(node?.getAttribute('data-node-id')).toBe('users');
      document.body.removeChild(container);
    });
  });

  describe('edges', () => {
    it('renders edge groups with er-edge-group class', () => {
      const container = renderToContainer(SAMPLE_ER);
      const edges = container.querySelectorAll('.er-edge-group');
      expect(edges.length).toBe(1);
      document.body.removeChild(container);
    });

    it('renders data-line-number on edge groups', () => {
      const container = renderToContainer(SAMPLE_ER);
      const edge = container.querySelector('.er-edge-group');
      expect(edge?.getAttribute('data-line-number')).toBeTruthy();
      document.body.removeChild(container);
    });

    it('renders edge labels', () => {
      const container = renderToContainer(SAMPLE_ER);
      const label = container.querySelector('.er-edge-label');
      expect(label?.textContent).toBe('writes');
      document.body.removeChild(container);
    });
  });

  describe('notation modes', () => {
    it('renders crow foot markers by default (lines in edge group)', () => {
      const container = renderToContainer(SAMPLE_ER);
      const edgeGroup = container.querySelector('.er-edge-group');
      // Crow's foot draws line elements for cardinality markers
      const lines = edgeGroup?.querySelectorAll('line');
      expect(lines!.length).toBeGreaterThan(0);
      document.body.removeChild(container);
    });

    it('renders labels notation when specified', () => {
      const content = `chart: er\nnotation: labels\nusers\n  id: int [pk]\n\nposts\n  id: int [pk]\n\nusers 1--* posts`;
      const container = renderToContainer(content);
      const edgeGroup = container.querySelector('.er-edge-group');
      // Labels mode draws text elements instead of lines for cardinality
      const texts = edgeGroup?.querySelectorAll('text');
      expect(texts!.length).toBeGreaterThan(0);
      document.body.removeChild(container);
    });
  });

  describe('title', () => {
    it('renders title when present', () => {
      const container = renderToContainer(SAMPLE_ER);
      const title = container.querySelector('.chart-title');
      expect(title).toBeTruthy();
      expect(title?.textContent).toBe('Blog Platform');
      document.body.removeChild(container);
    });

    it('renders title with data-line-number', () => {
      const container = renderToContainer(SAMPLE_ER);
      const title = container.querySelector('.chart-title');
      expect(title?.getAttribute('data-line-number')).toBe('2');
      document.body.removeChild(container);
    });
  });

  describe('multiple tables', () => {
    it('renders all tables', () => {
      const content = 'users\n  id: int [pk]\n\nposts\n  id: int [pk]\n\ncomments\n  id: int [pk]';
      const container = renderToContainer(content);
      const nodes = container.querySelectorAll('.er-table');
      expect(nodes.length).toBe(3);
      document.body.removeChild(container);
    });
  });
});
