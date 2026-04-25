/**
 * Timeline era domain tests — eras whose endpoints fall outside the event
 * date range must still render within the chart's drawing area.
 *
 * Background: the x scale domain was previously derived only from event
 * dates, so out-of-range era endpoints extrapolated to coordinates outside
 * the chart bounds (or, in degenerate cases, NaN). Eras now anchor the
 * time axis alongside events.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { getPalette } from '../src/palettes';
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

const WIDTH = 800;
const HEIGHT = 400;

function renderToContainer(src: string): HTMLDivElement {
  const parsed = parseVisualization(src, palette);
  const container = document.createElement('div') as HTMLDivElement;
  document.body.appendChild(container);
  renderTimeline(container, parsed, palette, false, undefined, {
    width: WIDTH,
    height: HEIGHT,
  });
  return container;
}

function rectAttrs(rect: Element): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const get = (attr: string) => Number(rect.getAttribute(attr));
  return {
    x: get('x'),
    y: get('y'),
    width: get('width'),
    height: get('height'),
  };
}

function assertFinite(rect: Element): void {
  const r = rectAttrs(rect);
  for (const [k, v] of Object.entries(r)) {
    expect(Number.isFinite(v), `rect ${k}=${v} should be finite`).toBe(true);
  }
}

describe('Timeline era domain', () => {
  it('era extending before earliest event lands within chart width', () => {
    const src = `timeline
era 1900->1950 Pre-history
2000 First event
2010 Second event`;
    const container = renderToContainer(src);
    const eras = container.querySelectorAll('.tl-era');
    expect(eras.length).toBe(1);
    const rect = eras[0].querySelector('rect')!;
    assertFinite(rect);
    const { x, width } = rectAttrs(rect);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(WIDTH);
    expect(width).toBeGreaterThan(0);
    document.body.removeChild(container);
  });

  it('era extending past latest event lands within chart width', () => {
    const src = `timeline
2000 First event
2010 Second event
era 2005->2100 Future`;
    const container = renderToContainer(src);
    const rect = container.querySelector('.tl-era rect')!;
    assertFinite(rect);
    const { x, width } = rectAttrs(rect);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(WIDTH);
    expect(width).toBeGreaterThan(0);
    document.body.removeChild(container);
  });

  it('era entirely outside event range still anchors the axis', () => {
    const src = `timeline
2000 Only event
era 1800->1900 Way before`;
    const container = renderToContainer(src);
    const rect = container.querySelector('.tl-era rect')!;
    assertFinite(rect);
    const { x, width } = rectAttrs(rect);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(WIDTH);
    expect(width).toBeGreaterThan(0);
    document.body.removeChild(container);
  });

  it('era straddling the event range fits the full chart width', () => {
    const src = `timeline
2000 First event
2010 Second event
era 1950->2050 Wide span`;
    const container = renderToContainer(src);
    const rect = container.querySelector('.tl-era rect')!;
    assertFinite(rect);
    const { x, width } = rectAttrs(rect);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x + width).toBeLessThanOrEqual(WIDTH);
    expect(width).toBeGreaterThan(0);
    document.body.removeChild(container);
  });

  it('marker before earliest event lands within chart width', () => {
    const src = `timeline
marker 1900 Pre-history (orange)
2000 First event
2010 Second event`;
    const container = renderToContainer(src);
    const markers = container.querySelectorAll('.tl-marker');
    expect(markers.length).toBe(1);
    const date = Number(markers[0].getAttribute('data-marker-date'));
    expect(Number.isFinite(date)).toBe(true);
    const text = markers[0].querySelector('text')!;
    const tx = Number(text.getAttribute('x'));
    expect(Number.isFinite(tx)).toBe(true);
    expect(tx).toBeGreaterThanOrEqual(0);
    expect(tx).toBeLessThanOrEqual(WIDTH);
    document.body.removeChild(container);
  });

  it('marker past latest event lands within chart width', () => {
    const src = `timeline
2000 First event
2010 Second event
marker 2100 Future`;
    const container = renderToContainer(src);
    const text = container.querySelector('.tl-marker text')!;
    const tx = Number(text.getAttribute('x'));
    expect(Number.isFinite(tx)).toBe(true);
    expect(tx).toBeGreaterThanOrEqual(0);
    expect(tx).toBeLessThanOrEqual(WIDTH);
    document.body.removeChild(container);
  });
});
