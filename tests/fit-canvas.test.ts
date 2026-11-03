/**
 * An export never enlarges a diagram to fill the canvas (#532, #1046).
 *
 * `fitDiagramToCanvas` used to scale an export to width, capped only at
 * `maxScale` (3). `flowchart-basic` — four nodes in a vertical stack — came out
 * at scale 3 on a 1200x1670 sheet, so its 13 px node text rendered at 39.
 * Export mode now caps the scale at 1 and sizes the canvas to the content,
 * floored at `MIN_CANVAS_WIDTH`. The preview still fits to the pane.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '../src/render';
import {
  fitDiagramToCanvas,
  MIN_CANVAS_WIDTH,
  MIN_DRAWN_TEXT_PX,
} from '../src/utils/fit-canvas';
import { MIN_FONT_PX, lintSvg } from './stress/lint';

const FLOWCHART_BASIC = readFileSync(
  join(__dirname, '../gallery/fixtures/flowchart-basic.dgmo'),
  'utf8'
);
const NARROW_STATE =
  'state Small\n\n[*] -> Open\nOpen -> Closed\nClosed -> [*]\n';

/** A small diagram on the default export sheet: maxScale 3 would triple it. */
const NARROW = {
  width: 1200,
  height: 800,
  diagramW: 150,
  diagramH: 500,
  padding: 20,
  titleHeight: 40,
  maxScale: 3,
};

describe('fitDiagramToCanvas', () => {
  it('export never scales a narrow diagram up, and floors the canvas at MIN_CANVAS_WIDTH', () => {
    const fit = fitDiagramToCanvas({ ...NARROW, exportMode: true });
    expect(fit.scale).toBeLessThanOrEqual(1);
    expect(fit.canvasWidth).toBe(MIN_CANVAS_WIDTH);
    expect(fit.canvasHeight).toBe(40 + 500 + 20 * 2);
  });

  it('export sizes the canvas to the content plus padding when that is above the floor', () => {
    const fit = fitDiagramToCanvas({
      ...NARROW,
      diagramW: 600,
      exportMode: true,
    });
    expect(fit.scale).toBe(1);
    expect(fit.canvasWidth).toBe(600 + 20 * 2);
  });

  it('export keeps the smallest text at the floor and grows past the asked width', () => {
    const fit = fitDiagramToCanvas({
      ...NARROW,
      diagramW: 2000,
      smallestTextPx: 10,
      exportMode: true,
    });
    expect(fit.scale * 10).toBeCloseTo(MIN_DRAWN_TEXT_PX, 10);
    expect(fit.canvasWidth).toBe(Math.round(2000 * fit.scale + 20 * 2));
    expect(fit.canvasWidth).toBeGreaterThan(NARROW.width);
    expect(fit.offsetX).toBeCloseTo(20, 0);
  });

  it('export above the floor still fits the asked width', () => {
    const fit = fitDiagramToCanvas({
      ...NARROW,
      diagramW: 1400,
      smallestTextPx: 11,
      exportMode: true,
    });
    expect(fit.scale).toBeCloseTo((1200 - 20 * 2) / 1400, 10);
    expect(fit.canvasWidth).toBe(1200);
  });

  it('the preview is not held at the floor: it still fits its pane', () => {
    const fit = fitDiagramToCanvas({
      ...NARROW,
      diagramW: 4000,
      smallestTextPx: 11,
      exportMode: false,
    });
    expect(fit.scale * 11).toBeLessThan(MIN_DRAWN_TEXT_PX);
    expect(fit.canvasWidth).toBe(1200);
  });

  it('the floor is the one the stress lint measures', () => {
    expect(MIN_DRAWN_TEXT_PX).toBe(MIN_FONT_PX);
  });

  it('the preview still fits a small diagram to its pane', () => {
    const fit = fitDiagramToCanvas({ ...NARROW, exportMode: false });
    expect(fit.scale).toBeGreaterThan(1);
    expect(fit.canvasHeight).toBe(800);
  });
});

/** A flowchart whose rank is wider than the sheet can fit at 7px text. */
function fanOut(lines: (i: number) => string): string {
  const rows = Array.from({ length: 24 }, (_, i) => lines(i + 1));
  return `flowchart Fan\n\n${rows.join('\n')}\n`;
}

describe('an exported wide flowchart keeps its smallest text at the floor (#1688)', () => {
  it.each([
    ['nodes alone', (i: number) => `[Start] -> [Validator ${i}]`, 13],
    ['edge labels', (i: number) => `[Start] -yes-> [Validator ${i}]`, 11],
    [
      'an open note',
      (i: number) =>
        `[Start] -> [Validator ${i}]${i === 1 ? '\nnote Start check the queue' : ''}`,
      10,
    ],
  ])('%s', async (_name, row, smallest) => {
    const { svg } = await render(fanOut(row), { width: 1200 });
    const m = measure(svg);
    expect(m.scale * smallest).toBeCloseTo(MIN_DRAWN_TEXT_PX, 6);
    expect(m.canvasWidth).toBeGreaterThan(1200);
    expect(lintSvg(svg).filter((f) => f.rule === 'text-tiny')).toEqual([]);
  });
});

/** The root canvas width and the content group's scale, read off the SVG. */
function measure(svg: string): { canvasWidth: number; scale: number } {
  const vb = /<svg[^>]*viewBox="[-\d.]+ [-\d.]+ ([\d.]+) /.exec(svg);
  const sc = /transform="translate\([^)]*\) scale\(([\d.]+)\)"/.exec(svg);
  return {
    canvasWidth: vb ? Number(vb[1]) : NaN,
    scale: sc ? Number(sc[1]) : NaN,
  };
}

describe('an exported narrow diagram keeps its size', () => {
  it.each([
    ['flowchart-basic', FLOWCHART_BASIC],
    ['a two-state state diagram', NARROW_STATE],
  ])('%s is not enlarged to the 1200 px sheet', async (_name, source) => {
    const { svg } = await render(source, { width: 1200 });
    const m = measure(svg);
    expect(m.canvasWidth).toBeLessThan(700);
    // Scale 1 or less: node text renders at its declared size, not 3x.
    expect(m.scale).toBeLessThanOrEqual(1);
  });

  it('flowchart-basic reads the same whatever width is asked for', async () => {
    const at1200 = measure(
      (await render(FLOWCHART_BASIC, { width: 1200 })).svg
    );
    const at700 = measure((await render(FLOWCHART_BASIC, { width: 700 })).svg);
    expect(at700.scale).toBe(at1200.scale);
    expect(at700.canvasWidth).toBe(at1200.canvasWidth);
  });
});
