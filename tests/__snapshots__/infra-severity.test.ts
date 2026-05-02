import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderForExport } from '../../src/d3';
import { nordPalette } from '../../src/palettes/nord';

// AC6 + TD-3: infra severity migration
// - overloaded/warning/healthy fills become 25% via shapeFill() (was 8-20%)
// - normal-state fills stay subtle-neutral (out of scope, F2)
// - 2x OVERLOAD_STROKE_WIDTH preserved as the sole pre-spec severity signal
// Snapshot the rendered SVG so any future drift in fill saturation or
// stroke-width selection trips this test.

describe('infra severity shapeFill snapshot (TD-3)', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`infra-overload (${theme}, nord) — stable SVG output`, async () => {
      const fixturePath = resolve(
        __dirname,
        '../../gallery/fixtures/infra-overload.dgmo'
      );
      const content = readFileSync(fixturePath, 'utf-8');
      const palette = theme === 'dark' ? nordPalette.dark : nordPalette.light;
      const svg = await renderForExport(content, theme, palette);
      expect(svg).toMatchSnapshot();
    });
  }
});
