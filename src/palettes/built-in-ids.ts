// Plain data, in a module of its own so the light completion surface
// (`completion-registry.ts`) can offer the ids without the contrast maths
// `theme-file.ts` carries.

import { atlasPalette } from './atlas';
import { blueprintPalette } from './blueprint';
import { catppuccinPalette } from './catppuccin';
import { nordPalette } from './nord';
import { slatePalette } from './slate';
import { tidewaterPalette } from './tidewater';
import { tokyoNightPalette } from './tokyo-night';

/**
 * The built-in palette ids. A theme file may not take one: a share link
 * carries only the id, so a file named `slate` would draw the author's colors
 * on their screen and real Slate for every reader — and Slate is the palette
 * an export falls back to. Decided 2026-09-23 on diagrammo/diagrammo#785.
 */
export const BUILT_IN_PALETTE_IDS: ReadonlySet<string> = new Set(
  [
    atlasPalette,
    blueprintPalette,
    catppuccinPalette,
    nordPalette,
    slatePalette,
    tidewaterPalette,
    tokyoNightPalette,
  ].map((palette) => palette.id)
);
