import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { mix } from '../src/palettes/color-utils';
import { parseState } from '../src/graph/state-parser';
import { layoutGraph } from '../src/graph/layout';
import { renderState, renderStateForExport } from '../src/graph/state-renderer';
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

function renderToContainer(content: string, isDark = false): HTMLDivElement {
  const parsed = parseState(content, testPalette);
  expect(parsed.error).toBeNull();
  const layout = layoutGraph(parsed);

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

  renderState(container, parsed, layout, testPalette, isDark);
  return container;
}

describe('renderState', () => {
  describe('basic rendering', () => {
    it('renders SVG with expected structure', () => {
      const container = renderToContainer('[*] -> Idle -> Active -> [*]');
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      document.body.removeChild(container);
    });

    it('renders correct number of node groups', () => {
      const container = renderToContainer('[*] -> Idle -> Active -> [*]');
      const nodeGroups = container.querySelectorAll('g.st-node');
      // [*] (1 pseudostate), Idle, Active = 3 nodes
      expect(nodeGroups.length).toBe(3);
      document.body.removeChild(container);
    });
  });

  describe('node rendering', () => {
    it('renders states as rounded rects with rx=10', () => {
      const container = renderToContainer('Idle -> Active');
      const rects = container.querySelectorAll('g.st-node rect');
      expect(rects.length).toBeGreaterThanOrEqual(1);
      const rx = rects[0].getAttribute('rx');
      expect(Number(rx)).toBe(10);
      document.body.removeChild(container);
    });

    it('renders pseudostates as circles with r=10', () => {
      const container = renderToContainer('[*] -> Idle');
      const circles = container.querySelectorAll('g.st-node circle');
      expect(circles.length).toBe(1);
      const r = circles[0].getAttribute('r');
      expect(Number(r)).toBe(10);
      document.body.removeChild(container);
    });

    it('renders state labels', () => {
      const container = renderToContainer('Idle -> Active');
      const texts = container.querySelectorAll('g.st-node text');
      const labels = Array.from(texts).map((t) => t.textContent);
      expect(labels).toContain('Idle');
      expect(labels).toContain('Active');
      document.body.removeChild(container);
    });
  });

  describe('edge rendering', () => {
    it('renders edges as paths with marker-end', () => {
      const container = renderToContainer('A -> B');
      const edgePaths = container.querySelectorAll('path.st-edge');
      expect(edgePaths.length).toBe(1);
      const markerEnd = edgePaths[0].getAttribute('marker-end');
      expect(markerEnd).toContain('url(#');
      document.body.removeChild(container);
    });

    it('renders edge labels', () => {
      const container = renderToContainer('Idle -start-> Running');
      const edgeLabels = container.querySelectorAll('text.st-edge-label');
      expect(edgeLabels.length).toBe(1);
      expect(edgeLabels[0].textContent).toBe('start');
      document.body.removeChild(container);
    });

    it('renders label backgrounds', () => {
      const container = renderToContainer('A -go-> B');
      const labelBgs = container.querySelectorAll('rect.st-edge-label-bg');
      expect(labelBgs.length).toBe(1);
      document.body.removeChild(container);
    });

    it('renders self-loop edges', () => {
      const container = renderToContainer('Running -retry-> Running');
      const edgePaths = container.querySelectorAll('path.st-edge');
      expect(edgePaths.length).toBe(1);
      const d = edgePaths[0].getAttribute('d');
      expect(d).toContain('C'); // cubic bezier for self-loop
      document.body.removeChild(container);
    });
  });

  describe('group rendering', () => {
    it('renders group box rect', () => {
      const container = renderToContainer(
        '[Processing] blue\n  Validating -> Approved'
      );
      const groupRects = container.querySelectorAll('rect.st-group');
      expect(groupRects.length).toBe(1);
      document.body.removeChild(container);
    });

    it('renders group label text', () => {
      const container = renderToContainer('[Processing]\n  A -> B');
      const groupLabels = container.querySelectorAll('text.st-group-label');
      expect(groupLabels.length).toBe(1);
      expect(groupLabels[0].textContent).toBe('Processing');
      document.body.removeChild(container);
    });
  });

  describe('title rendering', () => {
    it('renders title text element', () => {
      const container = renderToContainer('state My States\nIdle -> Active');
      const titles = container.querySelectorAll('text.chart-title');
      expect(titles.length).toBe(1);
      expect(titles[0].textContent).toBe('My States');
      document.body.removeChild(container);
    });

    it('adds data-line-number to title', () => {
      const container = renderToContainer('state Test\n[*] -> Idle');
      const title = container.querySelector('text.chart-title');
      expect(title).toBeTruthy();
      expect(title!.getAttribute('data-line-number')).toBe('1');
      document.body.removeChild(container);
    });
  });

  describe('data attributes', () => {
    it('adds data-line-number to node groups', () => {
      const container = renderToContainer('A -> B');
      const nodeGroups = container.querySelectorAll(
        'g.st-node[data-line-number]'
      );
      expect(nodeGroups.length).toBe(2);
      document.body.removeChild(container);
    });

    it('adds data-line-number to edge groups', () => {
      const container = renderToContainer('A -> B');
      const edgeGroups = container.querySelectorAll(
        'g.st-edge-group[data-line-number]'
      );
      expect(edgeGroups.length).toBe(1);
      document.body.removeChild(container);
    });
  });

  describe('dark theme', () => {
    it('renders without error in dark mode', () => {
      const container = renderToContainer('[*] -> Idle -> Active -> [*]', true);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      document.body.removeChild(container);
    });
  });

  describe('fill-solid option', () => {
    it('state fill equals raw intent when fill-solid is on', () => {
      const container = renderToContainer('fill-solid\nIdle -> Active');
      const rect = container.querySelector('g.st-node rect');
      expect(rect).toBeTruthy();
      // Default state color is blue; fill-solid returns the raw intent
      expect(rect!.getAttribute('fill')).toBe(testPalette.colors.blue);
      document.body.removeChild(container);
    });

    it('state fill is the 25% mix when fill-solid is absent', () => {
      const container = renderToContainer('Idle -> Active');
      const rect = container.querySelector('g.st-node rect');
      expect(rect).toBeTruthy();
      const expected = mix(testPalette.colors.blue, testPalette.bg, 25);
      expect(rect!.getAttribute('fill')).toBe(expected);
      document.body.removeChild(container);
    });

    it('collapsed-group fill equals raw group color when fill-solid is on', () => {
      const parsed = parseState(
        'fill-solid\n[Processing] red\n  Validating -> Approved',
        testPalette
      );
      expect(parsed.error).toBeNull();
      const originalGroups = parsed.groups ?? [];
      const collapsedChildCounts = new Map<string, number>();
      for (const g of originalGroups) collapsedChildCounts.set(g.id, 2);
      const layout = layoutGraph(parsed, {
        collapsedChildCounts,
        originalGroups,
      });
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
      renderState(container, parsed, layout, testPalette, false);

      // Collapsed-group wrapper carries both st-group-wrapper and st-node;
      // the regular (un-collapsed) group rect carries only st-group-wrapper.
      const wrapper = container.querySelector('g.st-group-wrapper.st-node');
      expect(wrapper).toBeTruthy();
      const mainRect = wrapper!.querySelector('rect');
      expect(mainRect).toBeTruthy();
      expect(mainRect!.getAttribute('fill')).toBe(testPalette.colors.red);
      document.body.removeChild(container);
    });

    it('collapsed-group fill is the 25% mix when fill-solid is absent', () => {
      const parsed = parseState(
        '[Processing] red\n  Validating -> Approved',
        testPalette
      );
      expect(parsed.error).toBeNull();
      const originalGroups = parsed.groups ?? [];
      const collapsedChildCounts = new Map<string, number>();
      for (const g of originalGroups) collapsedChildCounts.set(g.id, 2);
      const layout = layoutGraph(parsed, {
        collapsedChildCounts,
        originalGroups,
      });
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
      renderState(container, parsed, layout, testPalette, false);

      const wrapper = container.querySelector('g.st-group-wrapper.st-node');
      expect(wrapper).toBeTruthy();
      const mainRect = wrapper!.querySelector('rect');
      expect(mainRect).toBeTruthy();
      // Migrated to canonical 25% shapeFill (was 15% inline mix pre-spike)
      const expected = mix(testPalette.colors.red, testPalette.bg, 25);
      expect(mainRect!.getAttribute('fill')).toBe(expected);
      document.body.removeChild(container);
    });
  });

  describe('export function', () => {
    it('renderStateForExport produces valid SVG string', () => {
      const svg = renderStateForExport(
        '[*] -> Idle -> Active -> [*]',
        'light',
        testPalette
      );
      expect(svg).toContain('<svg');
      expect(svg).toContain('xmlns');
      expect(svg).toContain('</svg>');
    });

    it('renderStateForExport returns empty on parse error', () => {
      const svg = renderStateForExport('state\n', 'light', testPalette);
      expect(svg).toBe('');
    });

    it('renderStateForExport handles transparent theme', () => {
      const svg = renderStateForExport(
        '[*] -> Idle -> [*]',
        'transparent',
        testPalette
      );
      expect(svg).toContain('<svg');
    });
  });

  // ============================================================
  // Tag system (decision #48 — spec §5.7 "Tags")
  // ============================================================

  describe('tag colouring', () => {
    const HEAD = [
      'state Order',
      'tag Phase as ph',
      '  Intake blue',
      '  Fulfil green',
      '  Done purple',
      '',
    ];
    const doc = (...body: string[]) => [...HEAD, ...body].join('\n');

    /** The `<rect>` of the named state's node group. */
    const stateRect = (container: HTMLDivElement, label: string) => {
      const g = container.querySelector(
        `g.st-node[data-node-id="state:${label.toLowerCase()}"]`
      );
      expect(g).toBeTruthy();
      return g!.querySelector('rect')!;
    };

    it('tints the fill and strokes the outline with the tag colour', () => {
      const container = renderToContainer(
        doc('[*] -> Draft', 'Draft ph: Done', 'Draft -> Review')
      );
      const rect = stateRect(container, 'Draft');
      expect(rect.getAttribute('fill')).toBe(
        mix(testPalette.colors.purple, testPalette.bg, 25)
      );
      expect(rect.getAttribute('stroke')).toBe(testPalette.colors.purple);
      document.body.removeChild(container);
    });

    it('untagged states take the group default (first value)', () => {
      const container = renderToContainer(
        doc('[*] -> Draft', 'Draft ph: Done', 'Draft -> Review')
      );
      const rect = stateRect(container, 'Review');
      // `Intake blue` is the first entry → the default.
      expect(rect.getAttribute('stroke')).toBe(testPalette.colors.blue);
      document.body.removeChild(container);
    });

    it('exposes data-tag-<group> for legend hover dimming', () => {
      const container = renderToContainer(
        doc('[*] -> Draft', 'Draft ph: Fulfil', 'Draft -> Review')
      );
      const g = container.querySelector(
        'g.st-node[data-node-id="state:draft"]'
      );
      expect(g!.getAttribute('data-tag-phase')).toBe('fulfil');
      document.body.removeChild(container);
    });

    it('does not tag the pseudostate', () => {
      const container = renderToContainer(doc('[*] -> Draft'));
      const g = container.querySelector(
        'g.st-node[data-node-id="pseudostate:[*]"]'
      );
      expect(g!.getAttribute('data-tag-phase')).toBeNull();
      document.body.removeChild(container);
    });

    it('renders the standard legend when tag groups are declared', () => {
      const container = renderToContainer(doc('[*] -> Draft'));
      const legendGroups = container.querySelectorAll('.st-legend-group');
      expect(legendGroups.length).toBeGreaterThanOrEqual(1);
      expect(container.textContent).toContain('Phase');
      document.body.removeChild(container);
    });

    it('renders no legend when no tag groups are declared', () => {
      const container = renderToContainer('[*] -> Idle -> Active');
      expect(container.querySelectorAll('.st-legend-group').length).toBe(0);
      document.body.removeChild(container);
    });

    it('active-tag switches the colouring dimension', () => {
      const body = [
        'state Order',
        'tag Phase as ph',
        '  Intake blue',
        'tag Owner as ow',
        '  Ops teal',
        '  Eng red',
        'active-tag Owner',
        '',
        '[*] -> Draft',
        'Draft ow: Eng',
      ].join('\n');
      const container = renderToContainer(body);
      expect(stateRect(container, 'Draft').getAttribute('stroke')).toBe(
        testPalette.colors.red
      );
      document.body.removeChild(container);
    });

    it('defaults to the FIRST declared group when active-tag is absent', () => {
      const body = [
        'state Order',
        'tag Phase as ph',
        '  Intake blue',
        'tag Owner as ow',
        '  Ops teal',
        '',
        '[*] -> Draft',
        'Draft ow: Ops',
      ].join('\n');
      const container = renderToContainer(body);
      // Phase is active → Draft falls back to Phase's default (blue),
      // not the Owner value it carries.
      expect(stateRect(container, 'Draft').getAttribute('stroke')).toBe(
        testPalette.colors.blue
      );
      document.body.removeChild(container);
    });

    it('active-tag none suppresses tag colouring', () => {
      const container = renderToContainer(
        doc('active-tag none', '', '[*] -> Draft', 'Draft ph: Done')
      );
      // Falls back to the default state blue, not purple.
      expect(stateRect(container, 'Draft').getAttribute('stroke')).toBe(
        testPalette.colors.blue
      );
      document.body.removeChild(container);
    });

    it('fill-solid uses the raw tag colour as the fill', () => {
      const container = renderToContainer(
        doc('fill-solid', '', '[*] -> Draft', 'Draft ph: Done')
      );
      expect(stateRect(container, 'Draft').getAttribute('fill')).toBe(
        testPalette.colors.purple
      );
      document.body.removeChild(container);
    });

    it('fill-outline drops the wash but keeps the tag stroke', () => {
      const container = renderToContainer(
        doc('fill-outline', '', '[*] -> Draft', 'Draft ph: Done')
      );
      const rect = stateRect(container, 'Draft');
      expect(rect.getAttribute('fill')).not.toBe(
        mix(testPalette.colors.purple, testPalette.bg, 25)
      );
      expect(rect.getAttribute('stroke')).toBe(testPalette.colors.purple);
      document.body.removeChild(container);
    });

    it('collapsed groups keep the group colour, tagged states unaffected', () => {
      const parsed = parseState(
        [
          'state Order',
          'tag Phase as ph',
          '  Intake blue',
          '  Done purple',
          '',
          '[Processing] red collapsed',
          '  Validating -> Approved',
          '  Validating ph: Done',
        ].join('\n'),
        testPalette
      );
      expect(parsed.error).toBeNull();
      const group = parsed.groups![0]!;
      expect(group.collapsed).toBe(true);
      const layout = layoutGraph(parsed, {
        collapsedChildCounts: new Map([[group.id, group.nodeIds.length]]),
        originalGroups: parsed.groups!,
      });
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
      renderState(container, parsed, layout, testPalette, false);

      const collapsed = container.querySelector(
        `g.st-node[data-node-id="${group.id}"] rect`
      );
      expect(collapsed).toBeTruthy();
      // The collapsed stand-in keeps its explicit group colour — the tag
      // channel never overrides an explicit colour.
      expect(collapsed!.getAttribute('stroke')).toBe(testPalette.colors.red);
      document.body.removeChild(container);
    });
  });
});
