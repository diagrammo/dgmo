import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';

// An untagged treemap parent is a container: the tag group's default value
// (its first entry) must not reach it, in any of the three layouts (#2384).

const palette = getPalette('nord').light;

const src = (order: 'alpha-first' | 'beta-first', layout: string) => {
  const entries =
    order === 'alpha-first'
      ? '  Alpha red\n  Beta blue\n'
      : '  Beta blue\n  Alpha red\n';
  return `treemap Kinds
${layout}
tag Kind as k
${entries}
Ships
  Sloop 30 k: Alpha
  Brig 20 k: Beta
Ports
  Nassau 25 k: Beta
  Tortuga 15 k: Alpha
`;
};

let parser: DOMParser;
beforeAll(() => {
  parser = new new JSDOM('').window.DOMParser();
});

async function parentFill(source: string, path: string): Promise<string> {
  const svg = await renderForExport(source, 'light', palette);
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const cell = doc.querySelector(`[data-node-path="${path}"]`);
  expect(cell, `cell ${path}`).not.toBeNull();
  const shape = cell!.querySelector('rect, path');
  return shape!.getAttribute('fill') ?? '';
}

describe('treemap — untagged parent takes the neutral fill (#2384)', () => {
  for (const layout of ['', 'icicle', 'sunburst']) {
    const name = layout || 'treemap';
    it(`${name}: untagged parent is neither entry colour, in either declaration order`, async () => {
      const a = await parentFill(src('alpha-first', layout), 'Ships');
      const b = await parentFill(src('beta-first', layout), 'Ships');
      expect(a).toBe(b);
      for (const c of [palette.colors.red, palette.colors.blue]) {
        expect(a.toLowerCase()).not.toBe(c.toLowerCase());
      }
    });
  }
});
