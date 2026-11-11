import { describe, expect, it } from 'vitest';
import '../src/palettes';
import { getAvailablePalettes } from '../src/palettes/registry';
import { apcaContrast } from '../src/palettes/color-utils';
import { severityPillStyle } from '../src/infra/renderer';

// Same floor as tests/palette-contrast.test.ts (Lc 45).
const HARD_FLOOR = 45;
const SEVERITY = {
  overloaded: '#ef4444',
  warning: '#eab308',
  healthy: '#22c55e',
};

describe('infra severity pill contrast', () => {
  for (const palette of getAvailablePalettes()) {
    for (const [mode, colors, isDark] of [
      ['light', palette.light, false],
      ['dark', palette.dark, true],
    ] as const) {
      for (const [name, intent] of Object.entries(SEVERITY)) {
        it(`${palette.id} ${mode} ${name}: text clears the floor`, () => {
          const { fill, text } = severityPillStyle(colors, isDark, intent);
          expect(Math.abs(apcaContrast(text, fill))).toBeGreaterThanOrEqual(
            HARD_FLOOR
          );
        });
      }
    }
  }
});
