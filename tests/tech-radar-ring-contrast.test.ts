import { describe, expect, it } from 'vitest';
import '../src/palettes';
import { getAvailablePalettes } from '../src/palettes/registry';
import { apcaContrast } from '../src/palettes/color-utils';
import { ringBandFill, ringLabelColor } from '../src/tech-radar/shared';

// Ring labels are bold: held to the repo hard floor (Lc 45, as in palette-contrast.test.ts).
const LABEL_FLOOR = 45;

describe('tech-radar ring label contrast', () => {
  for (const palette of getAvailablePalettes()) {
    for (const mode of ['light', 'dark'] as const) {
      const colors = palette[mode];
      it(`${palette.id} ${mode}: label reads on every band`, () => {
        for (const ri of [0, 1]) {
          const lc = Math.abs(
            apcaContrast(ringLabelColor(colors), ringBandFill(colors, ri))
          );
          expect(lc).toBeGreaterThanOrEqual(LABEL_FLOOR);
        }
      });
    }
  }
});
