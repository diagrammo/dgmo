// exact-canvas-size.test.ts — `--width` with `--height` is the size you get
// (#1833, slice c).
//
// A chart type that lays out onto the requested canvas used to come back
// trimmed to its content and scaled up until ONE side matched: a pie asked
// for at 1000x600 was 978x600, a venn 518x600. With both sides requested the
// canvas is the frame. The PNG check rasterises at scale 1, so the pixel
// size is the canvas size the CLI's PNG and PDF are drawn from.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '../src/render';
import { fitSvgToContent } from '../src/utils/export-fit';
import { svgToPng } from '../src/svg-to-png';

const FIXTURES = join(__dirname, '../gallery/fixtures');

/** Lay out onto the canvas they are given; trimmed back before #1833. */
const CANVAS_TYPES = [
  'pie.dgmo',
  'polar-area.dgmo',
  'radar.dgmo',
  'funnel.dgmo',
  'venn.dgmo',
  'arc-chord.dgmo',
  'treemap-radial.dgmo',
];

function rootAttr(svg: string, name: string): string | undefined {
  const root = /<svg\b[^>]*>/.exec(svg)![0];
  return new RegExp(`\\s${name}="([^"]*)"`).exec(root)?.[1];
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(png: Uint8Array): [number, number] {
  const b = Buffer.from(png);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('--width with --height is the exact output size', () => {
  for (const file of CANVAS_TYPES) {
    it(`${file} at 1000x600 is 1000x600 in SVG and PNG`, async () => {
      const content = readFileSync(join(FIXTURES, file), 'utf8');
      const { svg } = await render(content, { width: 1000, height: 600 });
      expect(rootAttr(svg, 'width')).toBe('1000');
      expect(rootAttr(svg, 'height')).toBe('600');
      expect(rootAttr(svg, 'viewBox')).toBe('0 0 1000 600');
      expect(pngSize(svgToPng(svg, '#ffffff', 1))).toEqual([1000, 600]);
    });
  }
});

describe('fitSvgToContent keeps a canvas named on both sides', () => {
  const SHEET =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600">' +
    '<rect class="dgmo-canvas-bg" x="0" y="0" width="1000" height="600" fill="#eceff4"></rect>' +
    '<rect x="450" y="250" width="100" height="100"></rect>' +
    '</svg>';

  it('both sides requested and drawn onto: unchanged', () => {
    expect(fitSvgToContent(SHEET, { width: 1000, height: 600 })).toBe(SHEET);
  });

  it('only the width requested: still trimmed, the width still honoured', () => {
    const fitted = fitSvgToContent(SHEET, { width: 1000 });
    expect(fitted).not.toBe(SHEET);
    expect(rootAttr(fitted, 'width')).toBe('1000');
  });

  it('nothing requested: still trimmed to the content', () => {
    expect(rootAttr(fitSvgToContent(SHEET), 'viewBox')).not.toBe(
      '0 0 1000 600'
    );
  });

  it('both requested but drawn onto another canvas: trimmed as before', () => {
    expect(fitSvgToContent(SHEET, { width: 800, height: 500 })).not.toBe(SHEET);
  });
});
