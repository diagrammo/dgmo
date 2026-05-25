/**
 * Legend data-attribute tests — verify SVG attribute consistency across
 * all diagram types.
 *
 * Assertions:
 * 1. `data-legend-group` values are always lowercase (even if tag names are UPPERCASE)
 * 2. `data-legend-entry` values are always lowercase
 * 3. `[data-legend-active]` is present when `activeTagGroup` is passed
 * 4. `[data-legend-active]` is absent when no `activeTagGroup` is passed
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

/** Assert all data-legend-group and data-legend-entry values are lowercase */
function assertAllLowercase(container: Element): void {
  container.querySelectorAll('[data-legend-group]').forEach((el) => {
    const val = el.getAttribute('data-legend-group')!;
    expect(val, `data-legend-group "${val}" should be lowercase`).toBe(
      val.toLowerCase()
    );
  });
  container.querySelectorAll('[data-legend-entry]').forEach((el) => {
    const val = el.getAttribute('data-legend-entry')!;
    expect(val, `data-legend-entry "${val}" should be lowercase`).toBe(
      val.toLowerCase()
    );
  });
}

/** Assert [data-legend-active] is present and lowercase */
function assertLegendActive(container: Element, expectedGroup: string): void {
  const el = container.querySelector('[data-legend-active]');
  expect(el, '[data-legend-active] element should exist').not.toBeNull();
  const val = el!.getAttribute('data-legend-active')!;
  expect(val).toBe(expectedGroup.toLowerCase());
}

/** Assert [data-legend-active] is absent */
function assertNoLegendActive(container: Element): void {
  const el = container.querySelector('[data-legend-active]');
  expect(
    el,
    '[data-legend-active] should not exist when no activeTagGroup'
  ).toBeNull();
}

// ── Sequence ──────────────────────────────────────────────────────────────────

describe('Data attrs: Sequence', () => {
  const src = `sequence

tag REGION
  North blue
  South red

Alice is a actor | region: North
Bob is a actor | region: South
Alice -hello-> Bob`;

  it('has lowercase data-legend-group and data-legend-entry', () => {
    const parsed = parseSequenceDgmo(src);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderSequenceDiagram(container, parsed, palette, false, undefined, {
      exportWidth: 800,
    });
    assertAllLowercase(container);
    document.body.removeChild(container);
  });

  it('sets data-legend-active when activeTagGroup is passed', () => {
    const parsed = parseSequenceDgmo(src);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderSequenceDiagram(container, parsed, palette, false, undefined, {
      exportWidth: 800,
      activeTagGroup: 'REGION',
    });
    assertLegendActive(container, 'REGION');
    document.body.removeChild(container);
  });

  it('auto-activates first tag group when activeTagGroup is omitted', () => {
    const parsed = parseSequenceDgmo(src);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderSequenceDiagram(container, parsed, palette, false, undefined, {
      exportWidth: 800,
    });
    // First declared group becomes active when no explicit override
    // or `active-tag` directive is provided.
    assertLegendActive(container, 'REGION');
    document.body.removeChild(container);
  });
});

// ── C4 ────────────────────────────────────────────────────────────────────────

describe('Data attrs: C4', () => {
  const src = `c4

tag DOMAIN
  Auth blue
  Core green

User is a person
AuthSvc is a system | domain: Auth
  -> User
CoreSvc is a system | domain: Core`;

  it('has lowercase data-legend-group and data-legend-entry', () => {
    const parsed = parseC4(src, palette);
    const layout = layoutC4Context(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 900 });
    Object.defineProperty(container, 'clientHeight', { value: 700 });
    document.body.appendChild(container);
    renderC4Context(container, parsed, layout, palette, false);
    assertAllLowercase(container);
    document.body.removeChild(container);
  });

  it('sets data-legend-active when activeTagGroup is passed', () => {
    const parsed = parseC4(src, palette);
    const layout = layoutC4Context(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 900 });
    Object.defineProperty(container, 'clientHeight', { value: 700 });
    document.body.appendChild(container);
    renderC4Context(
      container,
      parsed,
      layout,
      palette,
      false,
      undefined,
      undefined,
      'DOMAIN'
    );
    assertLegendActive(container, 'DOMAIN');
    document.body.removeChild(container);
  });

  it('omits data-legend-active when no activeTagGroup', () => {
    const parsed = parseC4(src, palette);
    const layout = layoutC4Context(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 900 });
    Object.defineProperty(container, 'clientHeight', { value: 700 });
    document.body.appendChild(container);
    renderC4Context(container, parsed, layout, palette, false);
    assertNoLegendActive(container);
    document.body.removeChild(container);
  });
});

// ── Kanban ────────────────────────────────────────────────────────────────────

describe('Data attrs: Kanban', () => {
  const src = `kanban

tag PRIORITY
  High red
  Low green

[To Do]
  Fix bug | priority: High
  Write tests | priority: Low`;

  it('has lowercase data-legend-group and data-legend-entry', () => {
    const parsed = parseKanban(src, palette);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderKanban(container, parsed, palette, false);
    assertAllLowercase(container);
    document.body.removeChild(container);
  });

  it('sets data-legend-active when activeTagGroup is passed', () => {
    const parsed = parseKanban(src, palette);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderKanban(container, parsed, palette, false, {
      activeTagGroup: 'PRIORITY',
    });
    assertLegendActive(container, 'PRIORITY');
    document.body.removeChild(container);
  });

  it('omits data-legend-active when no activeTagGroup', () => {
    const parsed = parseKanban(src, palette);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderKanban(container, parsed, palette, false);
    assertNoLegendActive(container);
    document.body.removeChild(container);
  });
});

// ── Org ───────────────────────────────────────────────────────────────────────
// Org data-legend-active is only set in app mode (fixedLegend = !exportDims)

describe('Data attrs: Org', () => {
  const src = `org

tag REGION
  North blue
  South green

CEO
  VP North | region: North
  VP South | region: South`;

  it('has lowercase data-legend-group and data-legend-entry', () => {
    const parsed = parseOrg(src, palette);
    const layout = layoutOrg(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    document.body.appendChild(container);
    renderOrg(container, parsed, layout, palette, false);
    assertAllLowercase(container);
    document.body.removeChild(container);
  });

  it('sets data-legend-active in app mode when activeTagGroup is passed', () => {
    const parsed = parseOrg(src, palette);
    const layout = layoutOrg(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    document.body.appendChild(container);
    // No exportDims → fixedLegend=true → data-legend-active is set
    renderOrg(
      container,
      parsed,
      layout,
      palette,
      false,
      undefined,
      undefined,
      'REGION'
    );
    assertLegendActive(container, 'REGION');
    document.body.removeChild(container);
  });

  it('omits data-legend-active when no activeTagGroup', () => {
    const parsed = parseOrg(src, palette);
    const layout = layoutOrg(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    document.body.appendChild(container);
    renderOrg(container, parsed, layout, palette, false);
    assertNoLegendActive(container);
    document.body.removeChild(container);
  });
});

// ── Sitemap ───────────────────────────────────────────────────────────────────
// Sitemap data-legend-active is only set in app mode (fixedLegend = !exportDims)

describe('Data attrs: Sitemap', () => {
  const src = `sitemap

tag SECTION
  Docs blue
  Blog green

Home
  Docs | section: Docs
  Blog | section: Blog`;

  it('has lowercase data-legend-group and data-legend-entry', () => {
    const parsed = parseSitemap(src, palette);
    const layout = layoutSitemap(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    document.body.appendChild(container);
    renderSitemap(container, parsed, layout, palette, false);
    assertAllLowercase(container);
    document.body.removeChild(container);
  });

  it('sets data-legend-active in app mode when activeTagGroup is passed', () => {
    const parsed = parseSitemap(src, palette);
    const layout = layoutSitemap(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    document.body.appendChild(container);
    // No exportDims → fixedLegend=true → data-legend-active is set
    renderSitemap(
      container,
      parsed,
      layout,
      palette,
      false,
      undefined,
      undefined,
      'SECTION'
    );
    assertLegendActive(container, 'SECTION');
    document.body.removeChild(container);
  });

  it('omits data-legend-active when no activeTagGroup', () => {
    const parsed = parseSitemap(src, palette);
    const layout = layoutSitemap(parsed);
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 800 });
    Object.defineProperty(container, 'clientHeight', { value: 600 });
    document.body.appendChild(container);
    renderSitemap(container, parsed, layout, palette, false);
    assertNoLegendActive(container);
    document.body.removeChild(container);
  });
});

// ── Infra ─────────────────────────────────────────────────────────────────────

describe('Data attrs: Infra', () => {
  const src = `infra

tag TEAM
  Platform blue
  App green

edge
  rps: 1000
  -> API | team: App
  -> DB | team: Platform`;

  it('has lowercase data-legend-group and data-legend-entry', () => {
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
    assertAllLowercase(container);
    document.body.removeChild(container);
  });

  it('sets data-legend-active when activeGroup is passed (export mode)', () => {
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
      'TEAM',
      false,
      null,
      null,
      true
    );
    assertLegendActive(container, 'TEAM');
    document.body.removeChild(container);
  });

  it('omits data-legend-active when no activeGroup', () => {
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
    assertNoLegendActive(container);
    document.body.removeChild(container);
  });
});

// ── ER ────────────────────────────────────────────────────────────────────────

describe('Data attrs: ER', () => {
  const src = `er

tag DOMAIN
  Auth blue
  Core green

User {
  id int PK | domain: Auth
}
Order {
  id int PK | domain: Core
}`;

  it('has lowercase data-legend-group and data-legend-entry', () => {
    const parsed = parseERDiagram(src, palette);
    const layout = layoutERDiagram(parsed);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderERDiagram(container, parsed, layout, palette, false, undefined, {
      width: 800,
      height: 600,
    });
    assertAllLowercase(container);
    document.body.removeChild(container);
  });

  it('sets data-legend-active when activeTagGroup is passed', () => {
    const parsed = parseERDiagram(src, palette);
    const layout = layoutERDiagram(parsed);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderERDiagram(
      container,
      parsed,
      layout,
      palette,
      false,
      undefined,
      { width: 800, height: 600 },
      'DOMAIN'
    );
    assertLegendActive(container, 'DOMAIN');
    document.body.removeChild(container);
  });

  it('omits data-legend-active when no activeTagGroup', () => {
    const parsed = parseERDiagram(src, palette);
    const layout = layoutERDiagram(parsed);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderERDiagram(container, parsed, layout, palette, false, undefined, {
      width: 800,
      height: 600,
    });
    assertNoLegendActive(container);
    document.body.removeChild(container);
  });
});

// ── Timeline ──────────────────────────────────────────────────────────────────

describe('Data attrs: Timeline', () => {
  const src = `timeline

tag STATUS
  Done green
  Active blue

2024-01-01 -> 2024-06-01: Feature A | status: Done
2024-03-01 -> 2024-12-01: Feature B | status: Active`;

  it('has lowercase data-legend-group and data-legend-entry', () => {
    const parsed = parseVisualization(src, palette);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderTimeline(container, parsed, palette, false, undefined, {
      width: 800,
      height: 400,
    });
    assertAllLowercase(container);
    document.body.removeChild(container);
  });

  it('sets data-legend-active when activeTagGroup is passed', () => {
    const parsed = parseVisualization(src, palette);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderTimeline(
      container,
      parsed,
      palette,
      false,
      undefined,
      { width: 800, height: 400 },
      'STATUS'
    );
    assertLegendActive(container, 'STATUS');
    document.body.removeChild(container);
  });

  it('omits data-legend-active when no activeTagGroup', () => {
    const parsed = parseVisualization(src, palette);
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderTimeline(container, parsed, palette, false, undefined, {
      width: 800,
      height: 400,
    });
    assertNoLegendActive(container);
    document.body.removeChild(container);
  });
});
