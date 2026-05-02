import { describe, it, expect } from 'vitest';
import {
  contrastText,
  shapeFill,
  relativeLuminance,
} from '../src/palettes/color-utils';
import { boldPalette } from '../src/palettes/bold';
import { catppuccinPalette } from '../src/palettes/catppuccin';
import { draculaPalette } from '../src/palettes/dracula';
import { gruvboxPalette } from '../src/palettes/gruvbox';
import { monokaiPalette } from '../src/palettes/monokai';
import { nordPalette } from '../src/palettes/nord';
import { oneDarkPalette } from '../src/palettes/one-dark';
import { rosePinePalette } from '../src/palettes/rose-pine';
import { solarizedPalette } from '../src/palettes/solarized';
import { tokyoNightPalette } from '../src/palettes/tokyo-night';
import type { PaletteColors } from '../src/palettes/types';

// WCAG 2.1 contrast ratio between two colors.
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const PALETTES = [
  { name: 'bold', cfg: boldPalette },
  { name: 'catppuccin', cfg: catppuccinPalette },
  { name: 'dracula', cfg: draculaPalette },
  { name: 'gruvbox', cfg: gruvboxPalette },
  { name: 'monokai', cfg: monokaiPalette },
  { name: 'nord', cfg: nordPalette },
  { name: 'one-dark', cfg: oneDarkPalette },
  { name: 'rose-pine', cfg: rosePinePalette },
  { name: 'solarized', cfg: solarizedPalette },
  { name: 'tokyo-night', cfg: tokyoNightPalette },
];

const INTENTS: Array<keyof PaletteColors['colors']> = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'teal',
  'cyan',
];

describe('TD-5: per-palette WCAG audit for contrast tokens', () => {
  for (const { name, cfg } of PALETTES) {
    for (const themeKey of ['light', 'dark'] as const) {
      const palette = cfg[themeKey];
      const isDark = themeKey === 'dark';

      it(`${name} ${themeKey}: textOnFillLight luminance > 0.5`, () => {
        expect(relativeLuminance(palette.textOnFillLight)).toBeGreaterThan(0.5);
      });

      it(`${name} ${themeKey}: textOnFillDark luminance < 0.5`, () => {
        expect(relativeLuminance(palette.textOnFillDark)).toBeLessThan(0.5);
      });

      for (const intent of INTENTS) {
        it(`${name} ${themeKey}: contrastText vs shapeFill(${intent}) >= 4.5:1`, () => {
          const fill = shapeFill(palette, palette.colors[intent], isDark);
          const text = contrastText(
            fill,
            palette.textOnFillLight,
            palette.textOnFillDark
          );
          const ratio = contrastRatio(fill, text);
          expect(ratio).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});
