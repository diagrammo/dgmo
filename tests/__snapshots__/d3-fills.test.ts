import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderForExport } from '../../src/d3';
import { nordPalette } from '../../src/palettes/nord';

const FIXTURES = ['timeline', 'arc', 'quadrant'] as const;

describe('d3 shapeFill snapshots (TD-7 high-risk)', () => {
  for (const name of FIXTURES) {
    it(`${name} (nord light) — stable SVG output`, async () => {
      const fixturePath = resolve(
        __dirname,
        '../../gallery/fixtures',
        `${name}.dgmo`
      );
      const content = readFileSync(fixturePath, 'utf-8');
      const svg = await renderForExport(content, 'light', nordPalette.light);
      expect(svg).toMatchSnapshot();
    });
  }
});
