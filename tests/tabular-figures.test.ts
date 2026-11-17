// Tabular figures for chart number labels (#2035): every digit in an axis
// tick or value label sits in one uniform cell, laid out as `<tspan x>` so
// SVG, PNG and PDF agree (resvg ignores `tabular-nums`).
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';
import { rasterize } from '../src/svg-to-png';
import {
  TABULAR_DIGIT_EM,
  measureTabular,
  tabularCells,
} from '../src/utils/tabular-figures';
import { INTER_REGULAR_W } from '../src/utils/inter-metrics';
import { FONT_FAMILY } from '../src/fonts';

const palette = getPalette('nord').light;

const parse = (svg: string) =>
  new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;

describe('tabular cells', () => {
  it('the cell is the widest Inter digit, read from the generated table', () => {
    const widest = Math.max(
      ...'0123456789'.split('').map((d) => INTER_REGULAR_W[d]!)
    );
    expect(TABULAR_DIGIT_EM).toBe(widest);
  });

  it('every digit string of one length measures the same', () => {
    expect(measureTabular('1111.11', 12)).toBeCloseTo(
      measureTabular('8888.88', 12),
      9
    );
    expect(measureTabular('0', 12)).toBeCloseTo(TABULAR_DIGIT_EM * 12, 9);
  });

  it('keeps a run of other characters as one cell', () => {
    const { cells } = tabularCells('$1.2K', 0, 12);
    expect(cells.map((c) => c.ch)).toEqual(['$', '1', '.', '2', 'K']);
    const { cells: unit } = tabularCells('3 ms', 0, 12);
    expect(unit.map((c) => c.ch)).toEqual(['3', ' ms']);
  });
});

describe('tabular figures in chart SVG', () => {
  it('y ticks are right-aligned digit cells: the last digit sits in one column', async () => {
    const svg = await renderDataChartD3(
      'line Crew Paid\nformat currency USD 2\nno-value\nA 1111.11\nB 888.88\nC 404.04',
      'light',
      palette
    );
    const doc = parse(svg);
    const ticks = [...doc.querySelectorAll('text.dgmo-tick')].filter((t) =>
      /^\$[\d,]+\.\d\d$/.test(t.textContent ?? '')
    );
    expect(ticks.length).toBeGreaterThan(3);
    const lastX = ticks.map((t) => {
      const spans = [...t.querySelectorAll('tspan')];
      expect(spans.length).toBeGreaterThan(1);
      return Number(spans.at(-1)!.getAttribute('x'));
    });
    expect(new Set(lastX).size).toBe(1);
    // The element's own x is the label's centre, so a box reader agrees.
    for (const t of ticks) {
      expect(t.getAttribute('text-anchor')).toBe('middle');
      const w = measureTabular(t.textContent!, 12);
      expect(Number(t.getAttribute('x')) + w / 2).toBeCloseTo(
        lastX[0]! + (TABULAR_DIGIT_EM * 12) / 2,
        1
      );
    }
  });

  it('value labels keep their text and draw one tspan per digit', async () => {
    const svg = await renderDataChartD3(
      'bar Sales\nA 1200\nB 800',
      'light',
      palette
    );
    const doc = parse(svg);
    const label = [...doc.querySelectorAll('text')].find(
      (t) => t.textContent === '1,200'
    )!;
    expect(label).toBeTruthy();
    expect(
      [...label.querySelectorAll('tspan')].map((s) => s.textContent)
    ).toEqual(['1', ',', '2', '0', '0']);
  });

  it('text with no digit stays a plain text node', async () => {
    const svg = await renderDataChartD3(
      'bar Sales\nAlpha 1200\nBeta 800',
      'light',
      palette
    );
    const doc = parse(svg);
    const name = [...doc.querySelectorAll('text')].find(
      (t) => t.textContent === 'Alpha'
    )!;
    expect(name.querySelector('tspan')).toBeNull();
  });
});

describe('tabular figures in the PNG path', () => {
  // Ink centre of the dark pixels in one row band.
  const inkCentre = (svg: string): number => {
    const img = rasterize(svg, '#ffffff', 1);
    const px = img.pixels;
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        if (px[i]! < 128) {
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
        }
      }
    return (lo + hi) / 2;
  };
  const one = (text: string, tabular: boolean): string => {
    const fs = 40;
    const right = 380;
    const body = tabular
      ? (() => {
          const w = measureTabular(text, fs);
          return tabularCells(text, right - w, fs)
            .cells.map((c) => `<tspan x="${c.x}">${c.ch}</tspan>`)
            .join('');
        })()
      : text;
    const anchor = tabular ? 'middle' : 'end';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60"><text x="${right}" y="45" text-anchor="${anchor}" font-family="${FONT_FAMILY}" font-size="${fs}" fill="#000">${body}</text></svg>`;
  };

  it('right-aligned 1111 and 8888 rasterise to the same width under resvg', () => {
    // Proportional digits: a 1 is ~0.41 em, an 8 ~0.62 em, so the strings
    // differ by ~34 px at 40 px and their ink centres by ~17 px.
    const prop = Math.abs(
      inkCentre(one('1111', false)) - inkCentre(one('8888', false))
    );
    expect(prop).toBeGreaterThan(8);
    const tab = Math.abs(
      inkCentre(one('1111', true)) - inkCentre(one('8888', true))
    );
    expect(tab).toBeLessThan(3);
  });
});
