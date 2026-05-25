/**
 * Renderer-level tests for collapsed-state p90 SLO color behavior.
 * Covers AC1–AC6 from tech-spec-infra-collapsed-p90-latency.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseInfra } from '../src/infra/parser';
import { computeInfra } from '../src/infra/compute';
import { layoutInfra } from '../src/infra/layout';
import { renderInfra } from '../src/infra/renderer';
import { getPalette } from '../src/palettes';

const COLOR_OVERLOADED = '#ef4444';
const COLOR_WARNING = '#eab308';
const COLOR_HEALTHY = '#22c55e';
const SLO_COLORS = new Set([COLOR_OVERLOADED, COLOR_WARNING, COLOR_HEALTHY]);

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

const palette = getPalette('nord');

function renderCollapsed(src: string): HTMLElement {
  const parsed = parseInfra(src);
  const computed = computeInfra(parsed);
  const laidOut = layoutInfra(computed, null);
  const container = document.createElement('div');
  renderInfra(
    container,
    laidOut,
    palette.light,
    false,
    null,
    null,
    [],
    null,
    false,
    null,
    null,
    true
  );
  return container;
}

function renderExpanded(src: string, selectedId: string): HTMLElement {
  const parsed = parseInfra(src);
  const computed = computeInfra(parsed);
  // Tests pass user-typed CamelCase ('API') for readability — normalize so
  // the value matches the parser's internal id form ('api').
  const expandedNodeIds = new Set([selectedId.toLowerCase()]);
  const laidOut = layoutInfra(computed, expandedNodeIds);
  const container = document.createElement('div');
  renderInfra(
    container,
    laidOut,
    palette.light,
    false,
    null,
    null,
    [],
    null,
    false,
    null,
    expandedNodeIds,
    true
  );
  return container;
}

/** Find all SVG text elements whose text content includes the given string. */
function findTexts(container: HTMLElement, text: string): Element[] {
  return Array.from(container.querySelectorAll('text')).filter((el) =>
    el.textContent?.includes(text)
  );
}

/**
 * Find the SLO indicator color for the 'p90' row.
 *
 * The renderer renders rows in two ways:
 * - Inverted pill (breach/warning): a colored rect + pill-text siblings in a <g>
 * - Non-inverted colored value (healthy): key text (mutedColor) + value text (SLO color) in a <g>
 *
 * Node background and border rects use palette-blended colors (not exact SLO constants),
 * so searching for exact SLO constants (#ef4444 / #eab308 / #22c55e) only finds pill rects
 * or colored value text elements.
 */
function findP90SloColor(container: HTMLElement): string | null {
  for (const textEl of Array.from(container.querySelectorAll('text'))) {
    // Key text is rendered as "p90: " (with colon+space)
    if (textEl.textContent !== 'p90: ') continue;
    const parent = textEl.parentElement;
    if (!parent) continue;
    // Case 1: inverted pill — a rect sibling with an SLO fill color
    for (const sibling of Array.from(parent.children)) {
      if (sibling.tagName.toLowerCase() !== 'rect') continue;
      const fill = sibling.getAttribute('fill');
      if (fill && SLO_COLORS.has(fill)) return fill;
    }
    // Case 2: non-inverted colored value — the next text sibling carries the SLO fill
    for (const sibling of Array.from(parent.children)) {
      if (sibling === textEl) continue;
      if (sibling.tagName.toLowerCase() !== 'text') continue;
      const fill = sibling.getAttribute('fill');
      if (fill && SLO_COLORS.has(fill)) return fill;
    }
  }
  return null;
}

// Use max-rps high enough to avoid RPS-overload (which would introduce additional colored rects)
const BASE_SRC = (latencyMs: number, sloLine = '') => `
infra
${sloLine}
edge
  rps: 1000
  -> API
API
  latency-ms: ${latencyMs}
  max-rps: 5000
`;

describe('p90 threshold display — "current / threshold" format', () => {
  it('TH1: breach collapsed → value shows "400ms / 200ms"', () => {
    const container = renderCollapsed(BASE_SRC(400, 'slo-p90-latency-ms 200'));
    expect(findTexts(container, '400ms / 200ms').length).toBeGreaterThan(0);
  });

  it('TH2: warning collapsed → value shows "197ms / 200ms"', () => {
    // threshold=200, p90=197 → warning zone (within default 10% margin)
    const container = renderCollapsed(BASE_SRC(197, 'slo-p90-latency-ms 200'));
    expect(findTexts(container, '197ms / 200ms').length).toBeGreaterThan(0);
  });

  it('TH3: healthy collapsed → no threshold suffix', () => {
    const container = renderCollapsed(BASE_SRC(50, 'slo-p90-latency-ms 200'));
    expect(findTexts(container, '50ms / 200ms').length).toBe(0);
    expect(findTexts(container, '50ms').length).toBeGreaterThan(0);
  });

  it('TH4: no SLO collapsed → no threshold suffix', () => {
    const container = renderCollapsed(BASE_SRC(200));
    expect(findTexts(container, '200ms / ').length).toBe(0);
    expect(findTexts(container, '200ms').length).toBeGreaterThan(0);
  });

  it('TH5: breach expanded → p90 shows "400ms / 200ms"; p50 and p99 still present', () => {
    const container = renderExpanded(
      BASE_SRC(400, 'slo-p90-latency-ms 200'),
      'API'
    );
    expect(findTexts(container, '400ms / 200ms').length).toBeGreaterThan(0);
    // p50 and p99 must still be rendered alongside the modified p90 row
    expect(findTexts(container, 'p50').length).toBeGreaterThan(0);
    expect(findTexts(container, 'p99').length).toBeGreaterThan(0);
  });

  it('TH6: healthy expanded → no threshold suffix', () => {
    const container = renderExpanded(
      BASE_SRC(50, 'slo-p90-latency-ms 200'),
      'API'
    );
    expect(findTexts(container, '50ms / 200ms').length).toBe(0);
    expect(findTexts(container, '50ms').length).toBeGreaterThan(0);
  });

  it('TH7: large threshold formatted as seconds — "1.5s / 1.0s"', () => {
    // latency-ms: 1500 → p90 ≈ 1500ms → formatMsShort → "1.5s"
    // slo-p90-latency-ms: 1000 → "1.0s"
    const container = renderCollapsed(
      BASE_SRC(1500, 'slo-p90-latency-ms 1000')
    );
    expect(findTexts(container, '1.5s / 1.0s').length).toBeGreaterThan(0);
  });
});

describe('collapsed p90 SLO colors (AC1–AC6)', () => {
  it('AC1: collapsed node without SLO shows p90 label; p99 is absent', () => {
    const container = renderCollapsed(BASE_SRC(100));
    expect(findTexts(container, 'p90').length).toBeGreaterThan(0);
    expect(findTexts(container, 'p99').length).toBe(0);
  });

  it('AC1: no SLO configured → no SLO color on p90 row', () => {
    const container = renderCollapsed(BASE_SRC(100));
    expect(findP90SloColor(container)).toBeNull();
  });

  it('AC2: SLO breach (p90 > threshold) → red pill on p90 row', () => {
    // p90 = 400ms > slo-p90-latency-ms: 200ms → overloaded
    const container = renderCollapsed(BASE_SRC(400, 'slo-p90-latency-ms 200'));
    expect(findP90SloColor(container)).toBe(COLOR_OVERLOADED);
  });

  it('AC3: SLO warning (p90 within 5% margin of threshold) → yellow pill', () => {
    // threshold=200, margin=5% → warning zone: 190–200ms. p90=197 → warning.
    const container = renderCollapsed(BASE_SRC(197, 'slo-p90-latency-ms 200'));
    expect(findP90SloColor(container)).toBe(COLOR_WARNING);
  });

  it('AC4: SLO healthy (p90 well under threshold) → green pill', () => {
    // p90=50ms << 200ms threshold → healthy
    const container = renderCollapsed(BASE_SRC(50, 'slo-p90-latency-ms 200'));
    expect(findP90SloColor(container)).toBe(COLOR_HEALTHY);
  });

  it('AC5: expanded node shows p50, p90, and p99 rows', () => {
    const src = BASE_SRC(100);
    const container = renderExpanded(src, 'API');
    expect(findTexts(container, 'p50').length).toBeGreaterThan(0);
    expect(findTexts(container, 'p90').length).toBeGreaterThan(0);
    expect(findTexts(container, 'p99').length).toBeGreaterThan(0);
  });

  it('AC6: collapsed node with no latency data shows neither p90 nor p99', () => {
    const src = `
infra
edge
  rps: 1000
  -> API
API
  max-rps: 5000
`;
    const container = renderCollapsed(src);
    expect(findTexts(container, 'p90').length).toBe(0);
    expect(findTexts(container, 'p99').length).toBe(0);
  });
});
