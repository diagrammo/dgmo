// The preview is ONE Tab stop (#1090, option 1; #1434). The arrow / j / k
// selection reaches every element that carries a data-line-number, and Enter
// operates the selected line's collapse toggle, found by role="button". So a
// toggle the selection reaches takes no Tab stop of its own, or Tab walks
// every node of a big chart before it leaves the preview. It keeps its role,
// aria-expanded and aria-label: the role is how the app finds it.
//
// The two sequence group toggles joined them by their `[Name]` line (#1435).
// The toggles the selection cannot reach (no data-line-number) keep their
// Tab stop, since it is the keyboard's only way in: the legend pills and the
// swimlane icons.
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { select } from 'd3-selection';
import { render } from '../src/render';
import { getPalette } from '../src/palettes';
import { parseVisualization, renderTimeline } from '../src/d3';
import { renderLegendD3 } from '../src/utils/legend-d3';
import { renderNoteBadge, renderNoteBox } from '../src/utils/note-box/svg';

let win: JSDOM['window'];

beforeAll(() => {
  win = new JSDOM('<!DOCTYPE html><html><body></body></html>').window;
  for (const key of [
    'document',
    'window',
    'navigator',
    'HTMLElement',
    'SVGElement',
  ] as const) {
    Object.defineProperty(globalThis, key, {
      value: key === 'window' ? win : win[key],
      configurable: true,
    });
  }
});

async function svgOf(
  source: string,
  viewState?: Parameters<typeof render>[1] extends infer O
    ? O extends { viewState?: infer V }
      ? V
      : never
    : never
): Promise<Document> {
  const { svg, diagnostics } = await render(source, {
    theme: 'light',
    viewState,
  });
  expect(
    diagnostics.filter((d) => d.severity === 'error'),
    source
  ).toEqual([]);
  expect(svg, source).not.toBe('');
  return new win.DOMParser().parseFromString(svg, 'image/svg+xml');
}

function only(doc: ParentNode, selector: string): Element {
  const found = doc.querySelectorAll(selector);
  expect(found.length, selector).toBeGreaterThan(0);
  return found[0]!;
}

/** A reached toggle: no Tab stop, still a button the app can find. */
function expectNoTabStop(el: Element): void {
  expect(el.hasAttribute('tabindex')).toBe(false);
  expect(el.getAttribute('role')).toBe('button');
  expect(el.hasAttribute('aria-expanded')).toBe(true);
}

function expectTabStop(el: Element): void {
  expect(el.getAttribute('tabindex')).toBe('0');
  expect(el.getAttribute('role')).toBe('button');
}

const ORG = `org
[Engineering]
  Alice
    Bob`;

const SITEMAP = `sitemap
[Marketing]
  Landing
Home
  About`;

const MINDMAP = `mindmap
Root
  Child`;

const STATE = `state
[Checkout]
  Cart -> Paid
Idle -> Cart`;

const SEQUENCE = `sequence
[Backend]
  API
  DB
App -request-> API
== Billing ==
API -query-> DB`;

describe('toggles the selection reaches take no Tab stop (#1434)', () => {
  it('org — the container toggle and the node toggle', async () => {
    const doc = await svgOf(ORG);
    const container = only(doc, '.org-container[data-node-toggle]');
    const node = only(doc, '.org-node[data-node-toggle]');
    for (const el of [container, node]) {
      expectNoTabStop(el);
      expect(el.hasAttribute('aria-label')).toBe(true);
    }
  });

  it('state — the expanded group wrapper', async () => {
    const doc = await svgOf(STATE);
    const el = only(doc, '[data-group-toggle]');
    expectNoTabStop(el);
    expect(el.getAttribute('aria-expanded')).toBe('true');
    expect(el.hasAttribute('aria-label')).toBe(true);
  });

  it('state — the collapsed group node', async () => {
    const id = only(await svgOf(STATE), '[data-group-toggle]').getAttribute(
      'data-group-toggle'
    )!;
    const doc = await svgOf(STATE, { cg: [id] });
    const el = only(doc, '[data-group-toggle]');
    expectNoTabStop(el);
    expect(el.getAttribute('aria-expanded')).toBe('false');
    expect(el.hasAttribute('aria-label')).toBe(true);
  });

  it('mindmap — the node toggle', async () => {
    const doc = await svgOf(MINDMAP);
    const el = only(doc, '.mindmap-node[data-node-toggle]');
    expectNoTabStop(el);
    expect(el.hasAttribute('aria-label')).toBe(true);
  });

  it('sitemap — the container toggle and the node toggle', async () => {
    const doc = await svgOf(SITEMAP);
    expectNoTabStop(only(doc, '.sitemap-container[data-node-toggle]'));
    expectNoTabStop(only(doc, '.sitemap-node[data-node-toggle]'));
  });

  it('sequence — the section toggle', async () => {
    const doc = await svgOf(SEQUENCE);
    expectNoTabStop(only(doc, '[data-section-toggle]'));
  });

  it('sequence — the expanded group box and the collapsed group participant (#1435)', async () => {
    const GROUP_LINE = '2'; // `[Backend]`
    const expanded = only(
      await svgOf(SEQUENCE),
      '.group-box-wrapper[data-group-toggle]'
    );
    const collapsed = only(
      await svgOf(SEQUENCE, { cg: [GROUP_LINE] }),
      '.participant[data-group-toggle]'
    );
    for (const el of [expanded, collapsed]) {
      expect(el.getAttribute('data-line-number')).toBe(GROUP_LINE);
      expect(el.getAttribute('data-group-line')).toBe(GROUP_LINE);
      expectNoTabStop(el);
      expect(el.hasAttribute('aria-label')).toBe(true);
      // Only the toggle carries the line: a child with one would take the
      // click as line navigation before it reached data-group-toggle.
      expect(el.querySelector('[data-line-number]')).toBeNull();
    }
    expect(expanded.getAttribute('aria-expanded')).toBe('true');
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');
  });

  it('note box — the expanded box and the collapsed badge', () => {
    const palette = getPalette('nord').light;
    const svg = select(document.body).append('svg');
    const box = renderNoteBox(
      svg.append('g'),
      { x: 0, y: 0, width: 120, height: 40 },
      [],
      palette,
      { isDark: false, lineNumber: 3, interactive: true }
    ).node()!;
    const badge = renderNoteBadge(svg.append('g'), { x: 10, y: 10 }, palette, {
      isDark: false,
      lineNumber: 3,
    }).node()!;
    for (const el of [box, badge]) {
      expectNoTabStop(el);
      expect(el.hasAttribute('aria-label')).toBe(true);
    }
  });
});

describe('toggles the selection cannot reach keep their Tab stop (#1434)', () => {
  it('legend — the tag-group pill', () => {
    const svg = select(document.body).append('svg');
    const g = svg.append('g');
    renderLegendD3(
      g,
      {
        groups: [
          { name: 'Status', entries: [{ value: 'Done', color: '#888' }] },
        ],
        position: { placement: 'top-center', titleRelation: 'below-title' },
        mode: 'preview',
      },
      { activeGroup: 'Status' },
      { bg: '#fff', surface: '#eee', text: '#333', textMuted: '#888' },
      false,
      { onGroupToggle: () => {} }
    );
    expectTabStop(only(g.node()!, '[role="button"][aria-label="Status"]'));
  });

  it('timeline — the swimlane icon', () => {
    const palette = getPalette('nord').light;
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 800 });
    Object.defineProperty(host, 'clientHeight', { value: 500 });
    document.body.appendChild(host);
    renderTimeline(
      host,
      parseVisualization(
        `timeline

tag Status
  Done green

2024-01-01 -> 2024-06-01: Feature A | status: Done`,
        palette
      ),
      palette,
      false,
      undefined,
      undefined,
      'Status',
      undefined,
      () => {}
    );
    expectTabStop(only(host, '.tl-swimlane-icon'));
  });
});
