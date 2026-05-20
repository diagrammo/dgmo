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
  textOnFillLight: '#eceff4',
  textOnFillDark: '#2e3440',
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
    black: '#2e3440',
    white: '#eceff4',
  },
};

const SAMPLE_ER = `er Blog Platform

users
  id int pk
  name varchar
  email varchar unique
  1-writes-* posts

posts
  id int pk
  author_id int fk
  title varchar`;

function renderToContainer(content: string, isDark = false): HTMLDivElement {
  const parsed = parseERDiagram(content, testPalette);
  expect(parsed.error).toBeNull();
  const layout = layoutERDiagram(parsed);

  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', {
    value: 1200,
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', {
    value: 800,
    configurable: true,
  });
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
      const content = `er\nnotation labels\nusers\n  id int pk\n  1-* posts\n\nposts\n  id int pk`;
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
      expect(title?.getAttribute('data-line-number')).toBe('1');
      document.body.removeChild(container);
    });
  });

  describe('multiple tables', () => {
    it('renders all tables', () => {
      const content =
        'users\n  id: int [pk]\n\nposts\n  id: int [pk]\n\ncomments\n  id: int [pk]';
      const container = renderToContainer(content);
      const nodes = container.querySelectorAll('.er-table');
      expect(nodes.length).toBe(3);
      document.body.removeChild(container);
    });
  });

  describe('tag groups', () => {
    const ER_WITH_TAGS = `er

tag Domain d
  Billing blue
  Shipping green

Users | d: Billing
  id int pk

Orders | d: Shipping
  id int pk`;

    it('sets data-tag-* attributes when activeTagGroup is set', () => {
      const parsed = parseERDiagram(ER_WITH_TAGS, testPalette);
      const layout = layoutERDiagram(parsed);
      const container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      document.body.appendChild(container);
      renderERDiagram(
        container,
        parsed,
        layout,
        testPalette,
        false,
        undefined,
        { width: 800, height: 600 },
        'domain'
      );
      const billingTable = container.querySelector(
        '.er-table[data-tag-domain="billing"]'
      );
      const shippingTable = container.querySelector(
        '.er-table[data-tag-domain="shipping"]'
      );
      expect(billingTable).toBeTruthy();
      expect(shippingTable).toBeTruthy();
      document.body.removeChild(container);
    });

    it('does not set data-tag-* when no activeTagGroup', () => {
      const parsed = parseERDiagram(ER_WITH_TAGS, testPalette);
      const layout = layoutERDiagram(parsed);
      const container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      document.body.appendChild(container);
      renderERDiagram(
        container,
        parsed,
        layout,
        testPalette,
        false,
        undefined,
        { width: 800, height: 600 }
      );
      const tagged = container.querySelector('[data-tag-domain]');
      expect(tagged).toBeNull();
      document.body.removeChild(container);
    });

    it('renders tag legend when tag groups exist', () => {
      const parsed = parseERDiagram(ER_WITH_TAGS, testPalette);
      const layout = layoutERDiagram(parsed);
      const container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      document.body.appendChild(container);
      renderERDiagram(
        container,
        parsed,
        layout,
        testPalette,
        false,
        undefined,
        { width: 800, height: 600 }
      );
      const legend = container.querySelector('.er-tag-legend');
      expect(legend).toBeTruthy();
      // Centralized legend shows group pills; entries visible when group is active
      const groups = legend!.querySelectorAll('[data-legend-group]');
      expect(groups.length).toBeGreaterThan(0);
      document.body.removeChild(container);
    });

    it('no legend when no tag groups', () => {
      const parsed = parseERDiagram('users\n  id int pk', testPalette);
      const layout = layoutERDiagram(parsed);
      const container = document.createElement('div');
      container.style.width = '800px';
      container.style.height = '600px';
      document.body.appendChild(container);
      renderERDiagram(
        container,
        parsed,
        layout,
        testPalette,
        false,
        undefined,
        { width: 800, height: 600 }
      );
      const legend = container.querySelector('.er-tag-legend');
      expect(legend).toBeNull();
      document.body.removeChild(container);
    });
  });

  describe('semantic entity coloring', () => {
    const PLAIN_ER = `er

users
  id int pk
  name varchar
  1-writes-* posts

posts
  id int pk
  author_id int fk
  title varchar`;

    const ER_WITH_TAGS = `er

tag Domain d
  Billing blue

users | d: Billing
  id int pk`;

    const ER_WITH_EXPLICIT_COLOR = `er

users blue
  id int pk

posts
  id int pk
  author_id int fk`;

    function renderWithDims(content: string, isDark = false): HTMLDivElement {
      const parsed = parseERDiagram(content, testPalette);
      const layout = layoutERDiagram(parsed);
      const container = document.createElement('div');
      Object.defineProperty(container, 'clientWidth', {
        value: 800,
        configurable: true,
      });
      Object.defineProperty(container, 'clientHeight', {
        value: 600,
        configurable: true,
      });
      document.body.appendChild(container);
      renderERDiagram(
        container,
        parsed,
        layout,
        testPalette,
        isDark,
        undefined,
        { width: 800, height: 600 }
      );
      return container;
    }

    it('gate off: no .er-semantic-legend when tag groups are present', () => {
      const container = renderWithDims(ER_WITH_TAGS);
      const legend = container.querySelector('.er-semantic-legend');
      expect(legend).toBeNull();
      document.body.removeChild(container);
    });

    it('gate off: no data-er-role attributes when tag groups are present', () => {
      const container = renderWithDims(ER_WITH_TAGS);
      const roles = container.querySelectorAll('[data-er-role]');
      expect(roles.length).toBe(0);
      document.body.removeChild(container);
    });

    it('gate off: no .er-semantic-legend when explicit color is present', () => {
      const container = renderWithDims(ER_WITH_EXPLICIT_COLOR);
      const legend = container.querySelector('.er-semantic-legend');
      expect(legend).toBeNull();
      document.body.removeChild(container);
    });

    it('gate off: no data-er-role when explicit color is present', () => {
      const container = renderWithDims(ER_WITH_EXPLICIT_COLOR);
      const roles = container.querySelectorAll('[data-er-role]');
      expect(roles.length).toBe(0);
      document.body.removeChild(container);
    });

    it('gate on: .er-semantic-legend exists for plain diagram', () => {
      const container = renderWithDims(PLAIN_ER);
      const legend = container.querySelector('.er-semantic-legend');
      expect(legend).toBeTruthy();
      document.body.removeChild(container);
    });

    it('gate on: all nodes have data-er-role for plain diagram', () => {
      const container = renderWithDims(PLAIN_ER);
      const nodes = container.querySelectorAll('.er-table');
      const roledNodes = container.querySelectorAll('[data-er-role]');
      expect(roledNodes.length).toBe(nodes.length);
      document.body.removeChild(container);
    });

    it('legend is dynamic: only shows roles present in the diagram', () => {
      const container = renderWithDims(PLAIN_ER);
      // users = core (no FK), posts = dependent (has author_id FK)
      // So only 2 distinct roles should appear in legend
      const entries = container.querySelectorAll(
        '.er-semantic-legend [data-legend-entry]'
      );
      expect(entries.length).toBe(2);
      document.body.removeChild(container);
    });

    it('core table gets green stroke on its rect', () => {
      const container = renderWithDims(PLAIN_ER);
      // users has no FK columns → core → green
      const usersNode = container.querySelector(
        '.er-table[data-node-id="users"]'
      );
      expect(usersNode).toBeTruthy();
      const rect = usersNode?.querySelector('rect');
      expect(rect?.getAttribute('stroke')).toBe(testPalette.colors.green);
      document.body.removeChild(container);
    });

    it('dependent table gets blue stroke on its rect', () => {
      const container = renderWithDims(PLAIN_ER);
      // posts has author_id FK → dependent → blue
      const postsNode = container.querySelector(
        '.er-table[data-node-id="posts"]'
      );
      expect(postsNode).toBeTruthy();
      const rect = postsNode?.querySelector('rect');
      expect(rect?.getAttribute('stroke')).toBe(testPalette.colors.blue);
      document.body.removeChild(container);
    });

    it('junction table gets red stroke on its rect', () => {
      const junctionER = `er

orders
  id int pk
  1-* order_items

products
  id int pk
  1-* order_items

order_items
  order_id int fk
  product_id int fk`;

      const container = renderWithDims(junctionER);
      // order_items: 2 FK / 2 cols = 1.0 ratio → junction → red
      const junctionNode = container.querySelector(
        '.er-table[data-node-id="order_items"]'
      );
      expect(junctionNode).toBeTruthy();
      const rect = junctionNode?.querySelector('rect');
      expect(rect?.getAttribute('stroke')).toBe(testPalette.colors.red);
      document.body.removeChild(container);
    });
  });
});
