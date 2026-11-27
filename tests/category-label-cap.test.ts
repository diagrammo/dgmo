// category-label-cap.test.ts — long category names never take the chart
// (#2450). Every planLabelsFitLeft caller caps the rotated label band: names
// wrap to two lines first, and what still does not fit ends in `…`, with the
// whole name in data-full-text.

import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';
import {
  planLabelsFitLeft,
  LABEL_REGION_SHARE,
  LABEL_BREAK,
  LABEL_ROTATE_DEG,
  TICK_FONT,
} from '../src/charts-d3/shared';
import { measureText } from '../src/utils/text-measure';

const LONG = (i: number) =>
  `Category ${i} — ` +
  'a very long axis name that goes on and on about the quarterly figures '
    .repeat(2)
    .slice(0, 135);
const W = 800;
const H = 500;
const SIN = Math.sin((LABEL_ROTATE_DEG * Math.PI) / 180);
const COS = Math.cos((LABEL_ROTATE_DEG * Math.PI) / 180);

async function mount(src: string): Promise<SVGSVGElement> {
  const host = document.createElement('div');
  host.innerHTML = await renderDataChartD3(src, 'light', undefined, {
    width: W,
    height: H,
  });
  return host.querySelector('svg')!;
}

/** Tick texts that draw one of the long names, rotated or flat. */
function longTicks(svg: SVGSVGElement): SVGTextElement[] {
  return [...svg.querySelectorAll<SVGTextElement>('text.dgmo-tick')].filter(
    (t) => (t.textContent ?? '').startsWith('Category ')
  );
}

/** How far a drawn tick reaches below its anchor. */
function drop(t: SVGTextElement): number {
  const spans = [...t.querySelectorAll('tspan')];
  const lines = spans.length
    ? spans.map((s) => s.textContent ?? '')
    : [t.textContent ?? ''];
  const rotated = (t.getAttribute('transform') ?? '').includes('rotate');
  return Math.max(
    ...lines.map((l, k) =>
      rotated
        ? measureText(l, TICK_FONT) * SIN + k * TICK_FONT * 1.25 * COS
        : (k + 1) * TICK_FONT * 1.25
    )
  );
}

function expectCapped(svg: SVGSVGElement, cap: number, n: number) {
  const ticks = longTicks(svg);
  expect(ticks.length).toBe(n);
  for (const [i, t] of ticks.entries()) {
    expect(drop(t)).toBeLessThanOrEqual(cap);
    expect(t.textContent).toMatch(/…$/);
    expect(t.getAttribute('data-full-text')).toBe(LONG(i));
    expect(t.querySelector('title')).toBeNull();
  }
}

describe('long category names are capped (#2450)', () => {
  it('a line chart wraps and cuts 150-character names within the cap', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => `${LONG(i)} ${i + 2}`);
    const svg = await mount(['line Long names', ...rows].join('\n'));
    const cap = Math.floor(H * LABEL_REGION_SHARE);
    expectCapped(svg, cap, 6);
    // Wrapped to two lines rather than one cut line.
    expect(longTicks(svg)[0]!.querySelectorAll('tspan').length).toBe(2);
  });

  it('a box plot caps its rotated group names', async () => {
    const groups = Array.from(
      { length: 6 },
      (_, i) =>
        `[${LONG(i)}]\n${Array.from({ length: 8 }, (_, k) => 10 + i + k).join(' ')}`
    );
    const svg = await mount(['boxplot Long names', ...groups].join('\n'));
    expectCapped(svg, Math.floor(H * LABEL_REGION_SHARE), 6);
  });

  it('the shared fit keeps every caller under its cap', () => {
    const labels = Array.from({ length: 20 }, (_, i) => LONG(i));
    for (const cap of [80, 120, 175]) {
      const fit = planLabelsFitLeft(
        labels,
        40,
        (ml) => W - ml - 32,
        (pw) => pw / labels.length,
        (pw) => pw / labels.length / 2,
        TICK_FONT,
        cap
      );
      expect(fit.plan.rotate).toBe(true);
      expect(fit.plan.height).toBeLessThanOrEqual(cap);
      for (const s of fit.shown) {
        expect(s).toMatch(/…$/);
        for (const line of s.split(LABEL_BREAK))
          expect(measureText(line, TICK_FONT) * SIN).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('short names are planned exactly as before', () => {
    const labels = ['Jan', 'Feb', 'Mar', 'Apr'];
    const fit = planLabelsFitLeft(
      labels,
      40,
      () => 700,
      (pw) => pw / 4,
      (pw) => pw / 8,
      TICK_FONT,
      100
    );
    expect(fit.shown).toEqual(labels);
    expect(fit.plan.rotate).toBe(false);
  });
});
