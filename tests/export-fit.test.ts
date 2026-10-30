// export-fit.test.ts — an exported SVG is framed to what it draws (#1638).
//
// The fit may only shrink a frame when its measurement is complete, and must
// never hide ink. The ink check here is independent of the measurer: it
// rasterises the fitted SVG with a much larger window, background removed,
// and asserts every painted pixel falls inside the fitted frame.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';
import { DIAGRAM_EXPORT_HANDLERS, renderForExport } from '../src/d3';
import { parseDgmoChartType } from '../src/dgmo-router';
import { render } from '../src/render';
import { EXPORT_HEIGHT, EXPORT_WIDTH } from '../src/utils/d3-helpers';
import {
  EXPORT_FIT_PAD,
  fitSvgToContent,
  measureSvgContent,
} from '../src/utils/export-fit';
import { normalizeSvgForEmbed } from '../src/utils/svg-embed';

const FIXTURES = join(__dirname, '../gallery/fixtures');
const fixture = (rel: string) => readFileSync(join(FIXTURES, rel), 'utf8');

const SEQUENCE_3 = [
  'sequence Three participants',
  '',
  'User -open-> App',
  'App -read-> Store',
  'Store -rows-> App',
  'App -shown-> User',
].join('\n');

function viewBox(svg: string): [number, number, number, number] {
  const m = /<svg\b[^>]*?\bviewBox="([^"]+)"/.exec(svg);
  return m![1]!.split(/[\s,]+/).map(Number) as [number, number, number, number];
}

function rootAttr(svg: string, name: string): number {
  const root = /<svg\b[^>]*>/.exec(svg)![0];
  return Number(new RegExp(`\\s${name}="([^"]*)"`).exec(root)![1]);
}

/** The renderer's own output, before renderForExport frames it. */
async function unfitted(content: string): Promise<string> {
  const type = parseDgmoChartType(content)!;
  const handler = DIAGRAM_EXPORT_HANDLERS[type]!;
  return handler({
    content,
    theme: 'light',
    palette: undefined,
    viewState: undefined,
    options: undefined,
    exportMode: false,
    isDark: false,
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    requestedWidth: undefined,
    requestedHeight: undefined,
  });
}

/**
 * Painted pixels outside the frame, rasterising a window MARGIN px larger on
 * every side with the background stripped. 0 means nothing was clipped.
 */
function inkOutsideFrame(svg: string): number {
  const MARGIN = 300;
  const [x, y, w, h] = viewBox(svg);
  const wide = svg
    .replace(/<rect\b[^>]*\bdgmo-canvas-bg\b[^>]*>(?:<\/rect>)?/g, '')
    .replace(/background:[^;"]*;?/, '')
    .replace(
      /(<svg\b[^>]*?\bviewBox=)"[^"]*"/,
      `$1"${x - MARGIN} ${y - MARGIN} ${w + 2 * MARGIN} ${h + 2 * MARGIN}"`
    )
    .replace(/(<svg\b[^>]*?\swidth=)"[^"]*"/, `$1"${w + 2 * MARGIN}"`)
    .replace(/(<svg\b[^>]*?\sheight=)"[^"]*"/, `$1"${h + 2 * MARGIN}"`);
  const img = new Resvg(wide, {
    fitTo: { mode: 'original' },
    font: { loadSystemFonts: true },
  }).render();
  const W = img.width;
  const H = img.height;
  const px = img.pixels;
  let outside = 0;
  for (let py = 0; py < H; py++) {
    for (let pxl = 0; pxl < W; pxl++) {
      if (px[(py * W + pxl) * 4 + 3]! < 16) continue;
      // One px of slack for anti-aliasing at the frame edge.
      const inside =
        pxl >= MARGIN - 1 &&
        pxl <= MARGIN + w + 1 &&
        py >= MARGIN - 1 &&
        py <= MARGIN + h + 1;
      if (!inside) outside++;
    }
  }
  return outside;
}

function bgRectCoversViewBox(svg: string): boolean {
  const rect = /<rect\b[^>]*\bdgmo-canvas-bg\b[^>]*>/.exec(svg)?.[0];
  if (!rect) return false;
  const n = (k: string) =>
    Number(new RegExp(`\\s${k}="([^"]*)"`).exec(rect)![1]);
  const [x, y, w, h] = viewBox(svg);
  return n('x') === x && n('y') === y && n('width') === w && n('height') === h;
}

describe('export fit — content-sized charts are left alone', () => {
  for (const name of [
    'flowchart-basic.dgmo',
    'class-basic.dgmo',
    'state.dgmo',
    'kanban.dgmo',
  ]) {
    it(`${name} exports byte-for-byte as its renderer drew it`, async () => {
      const content = fixture(name);
      expect(await renderForExport(content, 'light')).toBe(
        await unfitted(content)
      );
    });
  }
});

describe('export fit — canvas-centred charts are trimmed, never clipped', () => {
  const cases: [string, string][] = [
    ['sequence, three participants', SEQUENCE_3],
    ['ring', fixture('ring/minimal.dgmo')],
    ['pyramid', fixture('pyramid/minimal.dgmo')],
    ['cycle', fixture('cycle/pdca-minimal.dgmo')],
  ];
  for (const [label, content] of cases) {
    it(`${label}: narrower than the sheet, all ink inside, background repainted`, async () => {
      const svg = await renderForExport(content, 'light');
      const [, , w] = viewBox(svg);
      expect(w).toBeLessThan(EXPORT_WIDTH - 4 * EXPORT_FIT_PAD);
      expect(rootAttr(svg, 'width')).toBe(w);
      expect(bgRectCoversViewBox(svg)).toBe(true);
      expect(inkOutsideFrame(svg)).toBe(0);
    });
  }

  it('the ink check catches a frame that is too tight (control)', async () => {
    const svg = await renderForExport(SEQUENCE_3, 'light');
    const [x, y, w, h] = viewBox(svg);
    const tight = svg.replace(
      /(<svg\b[^>]*?\bviewBox=)"[^"]*"/,
      `$1"${x + w / 4} ${y} ${w / 2} ${h}"`
    );
    expect(inkOutsideFrame(tight)).toBeGreaterThan(0);
  });

  it('the fitted frame is idempotent', async () => {
    const svg = await renderForExport(SEQUENCE_3, 'light');
    expect(fitSvgToContent(svg)).toBe(svg);
  });
});

describe('export fit — the two blind spots of the embed tightener', () => {
  it('words placed by transform are measured where they are drawn (word-cloud under-shoot)', () => {
    // The embed measurer cannot see these words, measures only the title and
    // would collapse the frame onto it.
    const words = [
      [300, 300],
      [700, 360],
      [500, 520],
    ]
      .map(
        ([x, y]) =>
          `<text transform="translate(${x},${y}) rotate(0)" text-anchor="middle" font-size="40">harbour</text>`
      )
      .join('');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">' +
      '<rect class="dgmo-canvas-bg" x="0" y="0" width="1200" height="800" fill="#eceff4"></rect>' +
      '<text x="600" y="40" text-anchor="middle" font-size="20">Title</text>' +
      words +
      '</svg>';
    const { box, complete } = measureSvgContent(svg);
    expect(complete).toBe(true);
    // Every word's baseline is inside the box: x 300±, y down to 520.
    expect(box!.y1).toBeGreaterThan(520);
    expect(box!.x0).toBeLessThan(300 - 60);
    expect(box!.x1).toBeGreaterThan(700 + 60);
    const fitted = fitSvgToContent(svg);
    expect(inkOutsideFrame(fitted)).toBe(0);
    expect(bgRectCoversViewBox(fitted)).toBe(true);
  });

  it('an arc is measured by its circle, so it never under-shoots (arc over-shoot)', () => {
    // Read as coordinate pairs, "A 150 150 0 0 1 …" yields (150,150) (0,0)
    // (1,…) — a box pulled to the origin. The arc's bulge rises to y≈150.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">' +
      '<path d="M 450 400 A 150 150 0 0 1 750 400 Z" fill="#88c0d0"></path>' +
      '</svg>';
    const { box, complete } = measureSvgContent(svg);
    expect(complete).toBe(true);
    expect(box!.x0).toBeGreaterThanOrEqual(449);
    expect(box!.y0).toBeLessThanOrEqual(250);
    const fitted = fitSvgToContent(svg);
    const [x, y, w, h] = viewBox(fitted);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(1200);
    expect(y + h).toBeLessThanOrEqual(800);
    expect(inkOutsideFrame(fitted)).toBe(0);
  });

  it('a drawing it cannot place keeps the canvas, unchanged', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">' +
      '<defs><path id="p" d="M0 0 L 900 700"></path></defs>' +
      '<rect x="500" y="300" width="100" height="100"></rect>' +
      '<use href="#p"></use>' +
      '</svg>';
    expect(measureSvgContent(svg).complete).toBe(false);
    expect(fitSvgToContent(svg)).toBe(svg);
  });
});

describe('export fit — callers that ask for a size', () => {
  it('a requested width is honoured after the fit, with no new warning', async () => {
    const { svg, diagnostics } = await render(SEQUENCE_3, { width: 800 });
    expect(rootAttr(svg, 'width')).toBe(800);
    expect(viewBox(svg)[2]).toBeLessThan(800);
    expect(diagnostics.map((d) => d.code)).not.toContain(
      'W_CANVAS_WIDTH_IGNORED'
    );
  });

  it('render() without a size frames the CLI path too', async () => {
    const { svg } = await render(SEQUENCE_3);
    expect(rootAttr(svg, 'width')).toBeLessThan(EXPORT_WIDTH);
  });

  it('an embed still strips the repainted background', async () => {
    const { svg } = await render(SEQUENCE_3);
    const embed = normalizeSvgForEmbed(svg);
    expect(embed).not.toContain('dgmo-canvas-bg');
    expect(embed).not.toMatch(/background:/);
  });
});
