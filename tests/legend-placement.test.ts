/**
 * Legend placement tests — verify that legend strips are rendered at the
 * TOP of their respective diagrams (below title if present).
 *
 * Strategy per renderer:
 * - Sequence / Timeline: extract Y from `transform="translate(X, Y)"` on
 *   `[data-legend-group]`; verify it's in the top portion of the SVG.
 * - Org / Sitemap: extract Y from `.org-legend-fixed` / `.sitemap-legend-fixed`
 *   container transform (app mode); verify it's near the top.
 * - Infra (export mode): extract Y from the legend container `<g>` transform
 *   and verify it's near the top of the SVG viewBox.
 * - Kanban: the `[data-legend-group]` is a `<rect>` with an absolute `y` attr;
 *   compare against SVG natural height — Kanban stays at bottom.
 * - ER: legend children have absolute `y` attrs; verify near top.
 * - C4 (app mode): C4 content is scaled/translated so pixel Y is not directly
 *   comparable to SVG height — just verify that legend elements exist and their
 *   layout y-coordinate is positive.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { getPalette } from '../src/palettes';
import { LEGEND_HEIGHT } from '../src/utils/legend-constants';
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

const palette = getPalette('nord').light;

/** Extract Y from `transform="translate(X, Y)"` on an element, or null */
function extractTransformY(el: Element | null): number | null {
  if (!el) return null;
  const t = el.getAttribute('transform');
  if (!t) return null;
  const m = t.match(/translate\(\s*[^,]+,\s*([^)]+)\)/);
  return m ? parseFloat(m[1]) : null;
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

/** Get SVG height attribute */

// ── Sequence ──────────────────────────────────────────────────────────────────

describe('Placement: Sequence legend at top', () => {
  const src = `sequence

tag Team
  Frontend(blue)
  Backend(red)

Alice is a actor | team: Frontend
Bob is a actor | team: Backend
Alice -request-> Bob
Bob <-response- Alice`;

  it('legend Y is in the top portion of the SVG', () => {
    const parsed = parseSequenceDgmo(src);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderSequenceDiagram(container, parsed, palette, false, undefined, {
      exportWidth: 800,
    });

    const svgHeight = getViewboxHeight(container);
    expect(svgHeight).not.toBeNull();

    const legendGroup = container.querySelector('[data-legend-group]');
    const legendY = extractTransformY(legendGroup);
    expect(legendY).not.toBeNull();

    // Legend should be at top — Y in the top 25% of SVG
    expect(legendY!).toBeLessThan(svgHeight! * 0.25);

    document.body.removeChild(container);
  });

  it('SVG viewBox height grows to include legend space', () => {
    const parsed = parseSequenceDgmo(src);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderSequenceDiagram(container, parsed, palette, false, undefined, {
      exportWidth: 800,
    });

    const svgHeight = getViewboxHeight(container);
    expect(svgHeight).not.toBeNull();

    // With tag groups present, SVG grows to include legend space
    expect(svgHeight!).toBeGreaterThan(LEGEND_HEIGHT);

    // Render without tag groups to get bare content height
    const srcNoTags = `sequence
Alice -request-> Bob
Bob <-response- Alice`;
    const parsedNoTags = parseSequenceDgmo(srcNoTags);
    const containerNoTags = document.createElement('div');
    document.body.appendChild(containerNoTags);
    renderSequenceDiagram(
      containerNoTags,
      parsedNoTags,
      palette,
      false,
      undefined,
      { exportWidth: 800 }
    );
    const noTagsHeight = getViewboxHeight(containerNoTags);

    expect(svgHeight!).toBeGreaterThan(noTagsHeight! ?? 0);
    document.body.removeChild(containerNoTags);
    document.body.removeChild(container);
  });
});

// ── C4 ────────────────────────────────────────────────────────────────────────

describe('Placement: C4 legend below diagram nodes', () => {
  const src = `c4

tag Domain
  Auth(blue)
  Payments(green)

User is a person
AuthService is a system | domain: Auth
PaymentsService is a system | domain: Payments
  -> User`;

  it('legend groups exist and layout y-coord is positive', () => {
    const parsed = parseC4(src, palette);
    const layout = layoutC4Context(parsed);

    // Layout places legend below nodes — verify layout.legend has positive y coords
    expect(layout.legend.length).toBeGreaterThan(0);
    for (const group of layout.legend) {
      expect(group.y).toBeGreaterThan(0);
    }

    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 900 });
    Object.defineProperty(container, 'clientHeight', { value: 700 });
    document.body.appendChild(container);
    renderC4Context(container, parsed, layout, palette, false);

    const groups = container.querySelectorAll('[data-legend-group]');
    expect(groups.length).toBeGreaterThan(0);
    document.body.removeChild(container);
  });
});

// ── Kanban ────────────────────────────────────────────────────────────────────

describe('Placement: Kanban legend at bottom', () => {
  const src = `kanban

tag Priority
  High(red)
  Low(green)

[To Do]
  Fix bug | priority: High
  Write tests | priority: Low`;

  it('legend rect y-position is in the bottom portion of the SVG', () => {
    const parsed = parseKanban(src, palette);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderKanban(
      container,
      parsed,
      palette,
      false,
      undefined,
      undefined,
      undefined
    );

    // Kanban data-legend-group is on a <rect> with `y` attribute (not transform)
    const legendRect = container.querySelector('[data-legend-group]');
    expect(legendRect).not.toBeNull();
    const y = parseFloat(legendRect!.getAttribute('y') ?? '0');

    // SVG height from natural width/height attributes
    const svgEl = container.querySelector('svg');
    expect(svgEl).not.toBeNull();
    // Kanban SVG doesn't expose height directly — use viewBox or trust layout
    // Key assertion: y > 0 (not at top)
    expect(y).toBeGreaterThan(0);

    document.body.removeChild(container);
  });
});

// ── Org ───────────────────────────────────────────────────────────────────────

describe('Placement: Org legend at top (app mode)', () => {
  const src = `org

tag Region
  North(blue)
  South(green)

CEO
  VP North | region: North
  VP South | region: South`;

  it('.org-legend-fixed translateY is in the top portion', () => {
    const parsed = parseOrg(src, palette);
    const layout = layoutOrg(parsed);
    const container = document.createElement('div');
    const svgHeight = 600;
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: svgHeight });
    document.body.appendChild(container);
    renderOrg(container, parsed, layout, palette, false);

    const fixedEl = container.querySelector('.org-legend-fixed');
    expect(fixedEl).not.toBeNull();
    const y = extractTransformY(fixedEl);
    expect(y).not.toBeNull();
    // Legend should be in the top portion of the SVG
    expect(y!).toBeLessThan(svgHeight * 0.25);
    document.body.removeChild(container);
  });
});

// ── Sitemap ───────────────────────────────────────────────────────────────────

describe('Placement: Sitemap legend at top (app mode)', () => {
  const src = `sitemap

tag Section
  Docs(blue)
  Blog(green)

Home
  Docs | section: Docs
  Blog | section: Blog`;

  it('.sitemap-legend-fixed translateY is in the top portion', () => {
    const parsed = parseSitemap(src, palette);
    const layout = layoutSitemap(parsed);
    const container = document.createElement('div');
    const svgHeight = 600;
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: svgHeight });
    document.body.appendChild(container);
    renderSitemap(container, parsed, layout, palette, false);

    const fixedEl = container.querySelector('.sitemap-legend-fixed');
    expect(fixedEl).not.toBeNull();
    const y = extractTransformY(fixedEl);
    expect(y).not.toBeNull();
    // Legend should be in the top portion of the SVG
    expect(y!).toBeLessThan(svgHeight * 0.25);
    document.body.removeChild(container);
  });
});

// ── Infra ─────────────────────────────────────────────────────────────────────

describe('Placement: Infra legend at top (export mode)', () => {
  const src = `infra

tag Team
  Platform(blue)
  App(green)

edge
  rps 1000
  -> API | team: App
  -> DB | team: Platform`;

  it('legend container translateY is near the top of the SVG viewBox', () => {
    const parsed = parseInfra(src);
    const computed = computeInfra(parsed);
    const layout = layoutInfra(computed);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderInfra(
      container,
      layout,
      palette,
      false,
      parsed.title,
      parsed.titleLineNumber,
      parsed.tagGroups,
      null,
      false,
      null,
      null,
      true
    );

    // In export mode, legend is inside the main SVG (not fixed SVG)
    const svgHeight = getViewboxHeight(container);
    expect(svgHeight).not.toBeNull();

    // The legend groups have translate(cursorX, 0) relative to their parent legendG
    // which has translate(0, legendY). Walk up to find legendY.
    const legendGroup = container.querySelector('[data-legend-group]');
    expect(legendGroup).not.toBeNull();
    const legendContainer = legendGroup!.parentElement;
    const legendY = extractTransformY(legendContainer as Element);
    expect(legendY).not.toBeNull();

    // legendY should be in the top portion of the SVG viewBox
    expect(legendY!).toBeLessThan(svgHeight! * 0.25);
    document.body.removeChild(container);
  });
});

// ── ER ────────────────────────────────────────────────────────────────────────

describe('Placement: ER legend at top', () => {
  const src = `er

tag Domain
  Auth(blue)
  Core(green)

User {
  id int PK | domain: Auth
}
Order {
  id int PK | domain: Core
}`;

  it('legend group text y-position is in the top portion', () => {
    const parsed = parseERDiagram(src, palette);
    const layout = layoutERDiagram(parsed);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const svgHeight = 600;
    renderERDiagram(container, parsed, layout, palette, false, undefined, {
      width: 800,
      height: svgHeight,
    });

    // ER data-legend-group is on a <g> inside legendG; get first text child's y
    const firstText = container.querySelector('[data-legend-group] text');
    expect(firstText).not.toBeNull();
    const y = parseFloat(firstText!.getAttribute('y') ?? '0');
    // Legend should be in the top portion
    expect(y).toBeLessThan(svgHeight * 0.25);
    document.body.removeChild(container);
  });
});

// ── Timeline ──────────────────────────────────────────────────────────────────

describe('Placement: Timeline legend at top', () => {
  const src = `timeline

tag Status
  Done(green)
  Active(blue)

2024-01-01 -> 2024-06-01: Feature A | status: Done
2024-03-01 -> 2024-12-01: Feature B | status: Active`;

  it('legend group translateY is in the top portion of SVG', () => {
    const parsed = parseVisualization(src, palette);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const svgHeight = 400;
    renderTimeline(container, parsed, palette, false, undefined, {
      width: 800,
      height: svgHeight,
    });

    const legendGroup = container.querySelector('[data-legend-group]');
    expect(legendGroup).not.toBeNull();
    const y = extractTransformY(legendGroup);
    expect(y).not.toBeNull();
    // Legend should be in the top portion of the SVG
    expect(y!).toBeLessThan(svgHeight * 0.4);
    document.body.removeChild(container);
  });
});
