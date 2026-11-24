import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderJourneyMapForExport } from '../src/journey-map/renderer';
import { getPalette } from '../src/palettes';
import { TITLE_FONT_SIZE, TITLE_Y } from '../src/utils/title-constants';

// #2305: a centred or right-aligned title must not sit under the persona
// panel, which lives in the top-right corner.

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  for (const k of ['document', 'window', 'navigator'] as const) {
    Object.defineProperty(globalThis, k, {
      value: k === 'window' ? dom.window : dom.window[k],
      configurable: true,
    });
  }
  for (const k of ['HTMLElement', 'SVGElement', 'DOMParser'] as const) {
    Object.defineProperty(globalThis, k, {
      value: dom.window[k],
      configurable: true,
    });
  }
});

const palette = getPalette('nord');

function source(align: string | null, persona: boolean): string {
  return [
    "journey-map A Cabin Boy's First Voyage",
    ...(align ? [`title-align ${align}`] : []),
    ...(persona
      ? [
          'persona Squidlips Sam color: blue',
          '  Greenhorn cabin boy, first time at sea',
          '  Sworn to the crew but quietly terrified',
        ]
      : []),
    '',
    '[Signing On]',
    '  Sign the articles score: 4, emotion: Hopeful',
    '[The Tempest]',
    '  Caught in a squall score: 1, emotion: Terrified',
    '    thought: Maybe the merchant fleet was better',
  ].join('\n');
}

function render(align: string | null, persona: boolean) {
  const svg = renderJourneyMapForExport(
    source(align, persona),
    'light',
    palette.light
  );
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const root = doc.querySelector('svg')!;
  const title = doc.querySelector('text.chart-title')!;
  const panel = doc.querySelector('.journey-persona > rect');
  const vb = (root.getAttribute('viewBox') ?? '').split(/\s+/).map(Number);
  return {
    vbWidth: vb[2],
    vbHeight: vb[3],
    titleX: Number(title.getAttribute('x')),
    titleY: Number(title.getAttribute('y')),
    anchor: title.getAttribute('text-anchor') ?? 'start',
    panelX: panel ? Number(panel.getAttribute('x')) : NaN,
    panelY: panel ? Number(panel.getAttribute('y')) : NaN,
  };
}

describe('journey-map title alignment with a persona (#2305)', () => {
  it('right: the title gets its own row above the persona panel', () => {
    const r = render('right', true);
    expect(r.anchor).toBe('end');
    // The title ends at the right edge, over the panel's column…
    expect(r.titleX).toBeGreaterThan(r.panelX);
    // …so the panel's top must clear the title's baseline (no overlap).
    expect(r.panelY).toBeGreaterThan(r.titleY);
  });

  it('center: the title gets its own row above the persona panel', () => {
    const r = render('center', true);
    expect(r.anchor).toBe('middle');
    expect(r.panelY).toBeGreaterThan(r.titleY);
  });

  it('left (default): title and panel share the top band as before', () => {
    for (const align of [null, 'left']) {
      const r = render(align, true);
      expect(r.anchor).toBe('start');
      expect(r.panelY).toBeLessThan(r.titleY);
      // The title is truncated to stop before the panel.
      expect(r.titleX).toBeLessThan(r.panelX);
    }
  });

  it('the stacked layout grows the chart by the title row', () => {
    const left = render('left', true);
    const right = render('right', true);
    const shift = right.panelY - left.panelY;
    expect(shift).toBeGreaterThan(TITLE_FONT_SIZE);
    expect(right.vbHeight).toBeCloseTo(left.vbHeight + shift, 0);
  });

  it('without a persona every alignment keeps the same height', () => {
    const heights = [null, 'left', 'center', 'right'].map(
      (a) => render(a, false).vbHeight
    );
    expect(new Set(heights).size).toBe(1);
    expect(render('right', false).titleY).toBe(TITLE_Y);
  });
});
