/**
 * Legend baseline tests — post-refactor safety net.
 *
 * These tests verify that legend elements exist across all 8 diagram types
 * after the Legend Standardization refactor moved legends to the bottom.
 * They guard against regressions that would remove or misplace legend elements.
 *
 * For precise placement assertions see legend-placement.test.ts.
 * For data-attribute correctness see legend-data-attrs.test.ts.
 * For the no-legend case see legend-no-groups.test.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { LEGEND_HEIGHT } from '../src/utils/legend-constants';
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

/** Extract Y from `transform="translate(X, Y)"` or return null */
function extractTransformY(el: Element): number | null {
  const t = el.getAttribute('transform');
  if (!t) return null;
  const m = t.match(/translate\(\s*[^,]+,\s*([^)]+)\)/);
  return m ? parseFloat(m[1]) : null;
}

/** Collect all data-legend-group elements and their y-coords */
function collectLegendYs(container: Element): number[] {
  const groups = container.querySelectorAll('[data-legend-group]');
  const ys: number[] = [];
  groups.forEach((g) => {
    const y = extractTransformY(g);
    if (y !== null) ys.push(y);
  });
  return ys;
}

/** Get SVG viewBox height (4th token) */
function getViewboxHeight(container: Element): number | null {
  const svg = container.querySelector('svg');
  if (!svg) return null;
  const vb = svg.getAttribute('viewBox');
  if (!vb) return null;
  const parts = vb.trim().split(/[\s,]+/);
  return parts.length >= 4 ? parseFloat(parts[3]) : null;
}

// ── Sequence ──────────────────────────────────────────────────────────────────

describe('Baseline: Sequence legend position', () => {
  const src = `chart: sequence

tag: Team
  Frontend(blue)
  Backend(red)

Alice is a actor | team: Frontend
Bob is a actor | team: Backend
Alice -request-> Bob
Bob <-response- Alice`;

  it('renders legend group elements at top of SVG', () => {
    const parsed = parseSequenceDgmo(src);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderSequenceDiagram(container, parsed, palette, false, undefined, { exportWidth: 800 });
    const ys = collectLegendYs(container);
    expect(ys.length).toBeGreaterThan(0);
    // Legend is at top — y should be in the top portion of the SVG
    const svgHeight = getViewboxHeight(container);
    expect(svgHeight).not.toBeNull();
    expect(ys[0]).toBeLessThan(svgHeight! * 0.25);
    document.body.removeChild(container);
  });
});

// ── C4 ────────────────────────────────────────────────────────────────────────

describe('Baseline: C4 legend position', () => {
  const src = `chart: c4

tag: Domain
  Auth(blue)
  Payments(green)

person User
system AuthService | domain: Auth
system PaymentsService | domain: Payments
User -> AuthService`;

  it('renders legend as fixed overlay at SVG bottom', () => {
    const parsed = parseC4(src, palette);
    const layout = layoutC4Context(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 900 });
    Object.defineProperty(container, 'clientHeight', { value: 700 });
    document.body.appendChild(container);
    // C4 legend only renders in app mode (no exportDims)
    renderC4Context(container, parsed, layout, palette, false);
    // Fixed overlay: a .c4-legend-fixed <g> exists at bottom of SVG
    const fixedG = container.querySelector('.c4-legend-fixed');
    expect(fixedG).not.toBeNull();
    // It contains legend group entries
    const groups = fixedG!.querySelectorAll('[data-legend-group]');
    expect(groups.length).toBeGreaterThan(0);
    document.body.removeChild(container);
  });
});

// ── Kanban ────────────────────────────────────────────────────────────────────

describe('Baseline: Kanban legend position', () => {
  const src = `chart: kanban

## Priority
  High(#bf616a)
  Low(#a3be8c)

[To Do]
  Fix bug | priority: High
  Write tests | priority: Low`;

  it('renders legend group elements', () => {
    const parsed = parseKanban(src, palette);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderKanban(container, parsed, palette, false, undefined, undefined, undefined);
    // Legend pill rects use data-legend-group
    const groups = container.querySelectorAll('[data-legend-group]');
    expect(groups.length).toBeGreaterThan(0);
    document.body.removeChild(container);
  });
});

// ── Org ───────────────────────────────────────────────────────────────────────

describe('Baseline: Org legend position', () => {
  const src = `chart: org

tag: Region
  North(blue)
  South(green)

CEO
  VP North | region: North
  VP South | region: South`;

  it('renders legend group elements with .org-legend-fixed at bottom (app mode)', () => {
    const parsed = parseOrg(src, palette);
    const layout = layoutOrg(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    document.body.appendChild(container);
    renderOrg(container, parsed, layout, palette, false);
    const groups = container.querySelectorAll('[data-legend-group]');
    expect(groups.length).toBeGreaterThan(0);
    // Post-refactor: legend container (.org-legend-fixed) is at bottom
    const fixedEl = container.querySelector('.org-legend-fixed');
    expect(fixedEl).not.toBeNull();
    document.body.removeChild(container);
  });
});

// ── Sitemap ───────────────────────────────────────────────────────────────────

describe('Baseline: Sitemap legend position', () => {
  const src = `chart: sitemap

tag: Section
  Docs(blue)
  Blog(green)

Home
  Docs | section: Docs
  Blog | section: Blog`;

  it('renders legend group elements with .sitemap-legend-fixed at bottom (app mode)', () => {
    const parsed = parseSitemap(src, palette);
    const layout = layoutSitemap(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    document.body.appendChild(container);
    renderSitemap(container, parsed, layout, palette, false);
    const groups = container.querySelectorAll('[data-legend-group]');
    expect(groups.length).toBeGreaterThan(0);
    // Post-refactor: legend container (.sitemap-legend-fixed) is at bottom
    const fixedEl = container.querySelector('.sitemap-legend-fixed');
    expect(fixedEl).not.toBeNull();
    document.body.removeChild(container);
  });
});

// ── Infra ─────────────────────────────────────────────────────────────────────

describe('Baseline: Infra legend position', () => {
  const src = `chart: infra

tag: Team
  Platform(blue)
  App(green)

edge
  rps: 1000
  -> API | team: App
  -> DB | team: Platform`;

  it('renders legend group elements', () => {
    const parsed = parseInfra(src);
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderInfra(container, layout, palette, false, parsed.title, parsed.titleLineNumber, parsed.tagGroups, null, false, null, null, true);
    const groups = container.querySelectorAll('[data-legend-group]');
    expect(groups.length).toBeGreaterThan(0);
    document.body.removeChild(container);
  });
});

// ── ER ────────────────────────────────────────────────────────────────────────

describe('Baseline: ER legend position', () => {
  const src = `chart: er

tag: Domain
  Auth(blue)
  Core(green)

User {
  id int PK | domain: Auth
}
Order {
  id int PK | domain: Core
}`;

  it('renders legend group elements', () => {
    const parsed = parseERDiagram(src, palette);
    const layout = layoutERDiagram(parsed);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderERDiagram(container, parsed, layout, palette, false, undefined, { width: 800, height: 600 });
    const groups = container.querySelectorAll('[data-legend-group]');
    expect(groups.length).toBeGreaterThan(0);
    document.body.removeChild(container);
  });
});

// ── Timeline ──────────────────────────────────────────────────────────────────

describe('Baseline: Timeline legend position', () => {
  const src = `chart: timeline

tag: Status
  Done(green)
  Active(blue)

2024-01-01 -> 2024-06-01: Feature A | status: Done
2024-03-01 -> 2024-12-01: Feature B | status: Active`;

  it('renders legend group elements', () => {
    const parsed = parseVisualization(src, palette);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderTimeline(container, parsed, palette, false, undefined, { width: 800, height: 400 });
    // Timeline tag legend uses data-legend-group
    const groups = container.querySelectorAll('[data-legend-group]');
    expect(groups.length).toBeGreaterThan(0);
    document.body.removeChild(container);
  });
});
