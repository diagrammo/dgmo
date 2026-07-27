// Signed bar values: domain [min(0, dataMin), max(0, dataMax)], bars grow
// either direction from the 0 baseline (diverging), both orientations.
// Edge case that motivated it: an all-negative dataset (chip-selloff chart)
// used to collapse the domain and overflow the plot.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';

const ALL_NEG_HORIZONTAL = `bar Chip Week
orientation-horizontal

Intel -8
Micron -7
AMD -3.3
Broadcom -2.7`;

const ALL_NEG_VERTICAL = `bar Chip Week

Intel -8
Micron -7
AMD -3.3
Broadcom -2.7`;

const MIXED_VERTICAL = `bar Weekly Moves

Intel -8
NVDA 1.2`;

const STACKED_MIXED = `bar Net Flows
stack
  Inflow
  Outflow

Q1 40 -25
Q2 30 -45`;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

function svgFrom(markup: string): SVGSVGElement {
  host.innerHTML = markup;
  const svg = host.querySelector('svg');
  expect(svg).toBeTruthy();
  return svg as SVGSVGElement;
}

function bars(svg: SVGSVGElement): SVGRectElement[] {
  return [...svg.querySelectorAll<SVGRectElement>('rect[data-line-number]')];
}

function num(el: Element, attr: string): number {
  return parseFloat(el.getAttribute(attr) ?? 'NaN');
}

/** The tick text elements, as trimmed strings. */
function tickTexts(svg: SVGSVGElement): string[] {
  return [...svg.querySelectorAll('text')].map((t) => t.textContent!.trim());
}

describe('bar charts with negative values', () => {
  it('all-negative horizontal: bars share a right-edge 0 baseline and grow left', async () => {
    const svg = svgFrom(await renderDataChartD3(ALL_NEG_HORIZONTAL, 'light'));
    const rects = bars(svg);
    expect(rects.length).toBe(4);

    // Every bar ends at the same 0 baseline (right edge of each bar aligned).
    const rightEdges = rects.map((r) => num(r, 'x') + num(r, 'width'));
    const base = rightEdges[0]!;
    for (const e of rightEdges) expect(Math.abs(e - base)).toBeLessThan(0.6);

    // Widths proportional to |value|: Intel(−8) widest, Broadcom(−2.7) narrowest.
    const widths = rects.map((r) => num(r, 'width'));
    expect(widths[0]).toBeGreaterThan(widths[1]!);
    expect(widths[1]).toBeGreaterThan(widths[2]!);
    expect(widths[2]).toBeGreaterThan(widths[3]!);
    // Nothing overflows the viewBox.
    for (const r of rects) expect(num(r, 'x')).toBeGreaterThanOrEqual(0);

    // Negative ticks are printed; every value label survives.
    const texts = tickTexts(svg);
    expect(texts).toContain('0');
    expect(texts.some((t) => /^-\d/.test(t))).toBe(true);
    for (const v of ['-8', '-7', '-3.3', '-2.7']) expect(texts).toContain(v);
  });

  it('all-negative vertical: bars hang from a shared 0 baseline', async () => {
    const svg = svgFrom(await renderDataChartD3(ALL_NEG_VERTICAL, 'light'));
    const rects = bars(svg);
    expect(rects.length).toBe(4);

    // Bars hang down from 0: tops aligned at the baseline.
    const tops = rects.map((r) => num(r, 'y'));
    const base = tops[0]!;
    for (const t of tops) expect(Math.abs(t - base)).toBeLessThan(0.6);

    // Heights proportional to |value|.
    const heights = rects.map((r) => num(r, 'height'));
    expect(heights[0]).toBeGreaterThan(heights[1]!);
    expect(heights[1]).toBeGreaterThan(heights[2]!);
    expect(heights[2]).toBeGreaterThan(heights[3]!);
  });

  it('mixed-sign vertical: positive bar sits above the baseline, negative below', async () => {
    const svg = svgFrom(await renderDataChartD3(MIXED_VERTICAL, 'light'));
    const rects = bars(svg);
    expect(rects.length).toBe(2);

    const [intel, nvda] = rects;
    // Shared baseline: Intel's top edge == NVDA's bottom edge (both at y(0)).
    const intelTop = num(intel!, 'y');
    const nvdaBottom = num(nvda!, 'y') + num(nvda!, 'height');
    expect(Math.abs(intelTop - nvdaBottom)).toBeLessThan(0.6);
    // Intel (−8) is much taller than NVDA (+1.2).
    expect(num(intel!, 'height')).toBeGreaterThan(num(nvda!, 'height') * 4);
  });

  it('stacked mixed-sign: positive and negative segments stack in separate runs', async () => {
    const svg = svgFrom(await renderDataChartD3(STACKED_MIXED, 'light'));
    const rects = bars(svg);
    expect(rects.length).toBe(4);

    // Per category: inflow above the baseline, outflow below, meeting at y(0).
    // Q1: 40 up, −25 down. Q2: 30 up, −45 down.
    const [q1in, q1out, q2in, q2out] = rects;
    const q1inBottom = num(q1in!, 'y') + num(q1in!, 'height');
    const q1outTop = num(q1out!, 'y');
    expect(Math.abs(q1inBottom - q1outTop)).toBeLessThan(0.6);
    const q2inBottom = num(q2in!, 'y') + num(q2in!, 'height');
    const q2outTop = num(q2out!, 'y');
    expect(Math.abs(q2inBottom - q2outTop)).toBeLessThan(0.6);
    // Q2's outflow (−45) is deeper than Q1's (−25).
    expect(num(q2out!, 'height')).toBeGreaterThan(num(q1out!, 'height'));
  });

  it('all-positive data keeps the plain 0-anchored domain (no regression)', async () => {
    const svg = svgFrom(
      await renderDataChartD3(`bar Sales\n\nA 10\nB 20`, 'light')
    );
    const rects = bars(svg);
    expect(rects.length).toBe(2);
    // No negative ticks appear.
    expect(tickTexts(svg).some((t) => /^-\d/.test(t))).toBe(false);
  });
});
