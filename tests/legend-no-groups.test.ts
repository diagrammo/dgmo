/**
 * Legend no-groups tests — verify no legend strip is rendered when the
 * diagram has zero tag groups defined.
 *
 * When there are no tag groups, no `<g data-legend-group>` elements should
 * exist and the SVG height should not include any legend padding.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { getPalette } from '../src/palettes';
import { parseSequenceDgmo } from '../src/sequence/parser';
import { renderSequenceDiagram } from '../src/sequence/renderer';
import { parseC4 } from '../src/c4/parser';
import { layoutC4Context } from '../src/c4/layout';
import { renderC4Context } from '../src/c4/renderer';
import { parseKanban } from '../src/kanban/parser';
import { renderKanban } from '../src/kanban/renderer';
import { parseOrg } from '../src/org/parser';
import { layoutOrg } from '../src/org/layout';
import { renderOrg } from '../src/org/renderer';
import { parseSitemap } from '../src/sitemap/parser';
import { layoutSitemap } from '../src/sitemap/layout';
import { renderSitemap } from '../src/sitemap/renderer';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { layoutInfra } from '../src/infra/layout';
import { renderInfra } from '../src/infra/renderer';
import { parseERDiagram } from '../src/er/parser';
import { layoutERDiagram } from '../src/er/layout';
import { renderERDiagram } from '../src/er/renderer';
import { parseVisualization, renderTimeline } from '../src/d3';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', { value: win.document, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: win.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, 'SVGElement', { value: win.SVGElement, configurable: true });
});

const palette = getPalette('nord').light;

function assertNoLegend(container: Element): void {
  const groups = container.querySelectorAll('[data-legend-group]');
  expect(groups.length).toBe(0);
  const activeEls = container.querySelectorAll('[data-legend-active]');
  expect(activeEls.length).toBe(0);
}

// ── Sequence ──────────────────────────────────────────────────────────────────

describe('No-groups: Sequence', () => {
  it('renders no legend elements when no tag groups defined', () => {
    const src = `chart: sequence
Alice -hello-> Bob
Bob <-ok- Alice`;
    const parsed = parseSequenceDgmo(src);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderSequenceDiagram(container, parsed, palette, false, undefined, { exportWidth: 800 });
    assertNoLegend(container);
    document.body.removeChild(container);
  });
});

// ── C4 ────────────────────────────────────────────────────────────────────────

describe('No-groups: C4', () => {
  it('renders no legend elements when no tag groups defined', () => {
    const src = `c4
User is a person
API is a system
  -> User`;
    const parsed = parseC4(src, palette);
    const layout = layoutC4Context(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 900 });
    Object.defineProperty(container, 'clientHeight', { value: 700 });
    document.body.appendChild(container);
    renderC4Context(container, parsed, layout, palette, false);
    assertNoLegend(container);
    document.body.removeChild(container);
  });
});

// ── Kanban ────────────────────────────────────────────────────────────────────

describe('No-groups: Kanban', () => {
  it('renders no legend elements when no tag groups defined', () => {
    const src = `kanban
[To Do]
  Fix bug
  Write tests`;
    const parsed = parseKanban(src, palette);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderKanban(container, parsed, palette, false);
    assertNoLegend(container);
    document.body.removeChild(container);
  });
});

// ── Org ───────────────────────────────────────────────────────────────────────

describe('No-groups: Org', () => {
  it('renders no legend elements when no tag groups defined', () => {
    const src = `org
CEO
  VP Sales
  VP Engineering`;
    const parsed = parseOrg(src, palette);
    const layout = layoutOrg(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    document.body.appendChild(container);
    renderOrg(container, parsed, layout, palette, false);
    assertNoLegend(container);
    document.body.removeChild(container);
  });
});

// ── Sitemap ───────────────────────────────────────────────────────────────────

describe('No-groups: Sitemap', () => {
  it('renders no legend elements when no tag groups defined', () => {
    const src = `sitemap
Home
  About
  Blog`;
    const parsed = parseSitemap(src, palette);
    const layout = layoutSitemap(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    document.body.appendChild(container);
    renderSitemap(container, parsed, layout, palette, false);
    assertNoLegend(container);
    document.body.removeChild(container);
  });
});

// ── Infra ─────────────────────────────────────────────────────────────────────

describe('No-groups: Infra', () => {
  it('renders no legend elements when no tag groups defined', () => {
    const src = `infra
edge
  rps 1000
  -> API
  -> DB`;
    const parsed = parseInfra(src);
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderInfra(
      container, layout, palette, false,
      parsed.title, parsed.titleLineNumber,
      parsed.tagGroups, null, false, null, null, true
    );
    assertNoLegend(container);
    document.body.removeChild(container);
  });
});

// ── ER ────────────────────────────────────────────────────────────────────────

describe('No-groups: ER', () => {
  it('renders no legend elements when no tag groups defined', () => {
    const src = `chart: er
User {
  id int PK
}
Order {
  id int PK
}`;
    const parsed = parseERDiagram(src, palette);
    const layout = layoutERDiagram(parsed);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderERDiagram(container, parsed, layout, palette, false, undefined, { width: 800, height: 600 });
    assertNoLegend(container);
    document.body.removeChild(container);
  });
});

// ── Timeline ──────────────────────────────────────────────────────────────────

describe('No-groups: Timeline', () => {
  it('renders no legend elements when no tag groups defined', () => {
    const src = `chart: timeline
2024-01-01 -> 2024-06-01: Feature A
2024-03-01 -> 2024-12-01: Feature B`;
    const parsed = parseVisualization(src, palette);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderTimeline(container, parsed, palette, false, undefined, { width: 800, height: 400 });
    assertNoLegend(container);
    document.body.removeChild(container);
  });
});
