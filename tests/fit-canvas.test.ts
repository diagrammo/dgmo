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
import { fitDiagramToCanvas, MIN_CANVAS_WIDTH } from '../src/utils/fit-canvas';

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

  it('the preview still fits a small diagram to its pane', () => {
    const fit = fitDiagramToCanvas({ ...NARROW, exportMode: false });
    expect(fit.scale).toBeGreaterThan(1);
    expect(fit.canvasHeight).toBe(800);
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
