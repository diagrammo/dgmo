// Re-export types
export type { PaletteConfig, PaletteColors } from './types';

// Re-export registry
export {
  getPalette,
  getAvailablePalettes,
  registerPalette,
  isValidHex,
} from './registry';

// Re-export utilities
export {
  hexToHSL,
  hslToHex,
  hexToHSLString,
  tint,
  shade,
  getSeriesColors,
  getSegmentColors,
  contrastText,
  shapeFill,
} from './color-utils';

// Re-export palette definitions (alphabetical)
export { atlasPalette } from './atlas';
export { blueprintPalette } from './blueprint';
export { catppuccinPalette } from './catppuccin';
export { gruvboxPalette } from './gruvbox';
export { nordPalette } from './nord';
export { oneDarkPalette } from './one-dark';
export { rosePinePalette } from './rose-pine';
export { slatePalette } from './slate';
export { solarizedPalette } from './solarized';
export { tidewaterPalette } from './tidewater';
export { tokyoNightPalette } from './tokyo-night';

export { draculaPalette } from './dracula';
export { monokaiPalette } from './monokai';

// ============================================================
// Public namespace — `palettes` for use with render()
// ============================================================

import { atlasPalette } from './atlas';
import { blueprintPalette } from './blueprint';
import { catppuccinPalette } from './catppuccin';
import { draculaPalette } from './dracula';
import { gruvboxPalette } from './gruvbox';
import { monokaiPalette } from './monokai';
import { nordPalette } from './nord';
import { oneDarkPalette } from './one-dark';
import { rosePinePalette } from './rose-pine';
import { slatePalette } from './slate';
import { solarizedPalette } from './solarized';
import { tidewaterPalette } from './tidewater';
import { tokyoNightPalette } from './tokyo-night';

import type { PaletteConfig } from './types';

/**
 * All built-in palettes, keyed by camelCase id. Use directly with render():
 *
 *   await render(text, { palette: palettes.catppuccin });
 *
 * For preference/settings storage, the `.id` field of each entry is the
 * canonical string (e.g. `'tokyo-night'`, `'nord'`) — that's the wire format
 * used by share URLs and the CLI `--palette` flag.
 */
export const palettes = {
  atlas: atlasPalette,
  blueprint: blueprintPalette,
  slate: slatePalette,
  tidewater: tidewaterPalette,
  nord: nordPalette,
  catppuccin: catppuccinPalette,
  solarized: solarizedPalette,
  gruvbox: gruvboxPalette,
  tokyoNight: tokyoNightPalette,
  oneDark: oneDarkPalette,
  rosePine: rosePinePalette,
  dracula: draculaPalette,
  monokai: monokaiPalette,
} as const satisfies Record<string, PaletteConfig>;
