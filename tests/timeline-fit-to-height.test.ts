/**
 * Timeline interactive fit-to-height tests.
 *
 * On-screen (no exportDims) a horizontal time-sort timeline with more events
 * than fit the host pane scales the whole SVG down to the container height
 * (via a clamped height attr + a taller viewBox) instead of overflowing it.
 * The export path (exportDims provided) must keep the full natural height.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { getPalette } from '../src/palettes';
import { parseVisualization, renderTimeline } from '../src/d3';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [k, value] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, k, { value, configurable: true });
  }
});

const palette = getPalette('nord').light;

function makeContainer(w: number, h: number): HTMLDivElement {
  const container = document.createElement('div') as HTMLDivElement;
  document.body.appendChild(container);
  Object.defineProperty(container, 'clientWidth', {
    value: w,
    configurable: true,
  });
  Object.defineProperty(container, 'clientHeight', {
    value: h,
    configurable: true,
  });
  return container;
}

// 30 single-date events — tall enough to overflow a short pane.
const TALL_SRC =
  'timeline\n' +
  Array.from(
    { length: 30 },
    (_, i) => `2026-${String((i % 12) + 1).padStart(2, '0')}-15 Event ${i}`
  ).join('\n');

function svgOf(container: HTMLDivElement): SVGSVGElement {
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('no svg rendered');
  return svg as unknown as SVGSVGElement;
}

describe('timeline interactive fit-to-height', () => {
  it('clamps the rendered height to the container while keeping a taller viewBox', () => {
    const PANE_H = 600;
    const container = makeContainer(1200, PANE_H);
    const parsed = parseVisualization(TALL_SRC, palette);
    renderTimeline(container, parsed, palette, false);

    const svg = svgOf(container);
    const renderedH = Number(svg.getAttribute('height'));
    const viewBox = (svg.getAttribute('viewBox') ?? '')
      .split(/\s+/)
      .map(Number);
    const vbH = viewBox[3]!;

    // Rendered height clamped to the pane; viewBox keeps the full content height.
    expect(renderedH).toBe(PANE_H);
    expect(vbH).toBeGreaterThan(PANE_H);
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMin meet');
  });

  it('does not shrink when the pane is taller than the content', () => {
    const container = makeContainer(1200, 4000);
    const parsed = parseVisualization(TALL_SRC, palette);
    renderTimeline(container, parsed, palette, false);

    const svg = svgOf(container);
    const renderedH = Number(svg.getAttribute('height'));
    const vbH = Number((svg.getAttribute('viewBox') ?? '').split(/\s+/)[3]);
    // Natural height: SVG matches its own content, below the 4000px pane.
    expect(renderedH).toBe(vbH);
    expect(renderedH).toBeLessThan(4000);
  });

  it('keeps the full natural height on the export path', () => {
    const container = makeContainer(1200, 600);
    const parsed = parseVisualization(TALL_SRC, palette);
    renderTimeline(container, parsed, palette, false, undefined, {
      width: 1200,
      height: 600,
    });

    const svg = svgOf(container);
    const renderedH = Number(svg.getAttribute('height'));
    const vbH = Number((svg.getAttribute('viewBox') ?? '').split(/\s+/)[3]);
    // Export is never compressed: rendered height equals the content height.
    expect(renderedH).toBe(vbH);
    expect(renderedH).toBeGreaterThan(600);
  });
});
