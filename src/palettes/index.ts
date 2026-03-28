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
  mute,
  tint,
  shade,
  getSeriesColors,
  getSegmentColors,
  contrastText,
} from './color-utils';

// Re-export palette definitions (alphabetical)
export { boldPalette } from './bold';
export { catppuccinPalette } from './catppuccin';
export { gruvboxPalette } from './gruvbox';
export { nordPalette } from './nord';
export { oneDarkPalette } from './one-dark';
export { rosePinePalette } from './rose-pine';
export { solarizedPalette } from './solarized';
export { tokyoNightPalette } from './tokyo-night';

// Side-effect imports — register palettes without re-exporting
import './dracula';
import './monokai';

// Re-export Mermaid bridge
export { buildMermaidThemeVars, buildThemeCSS } from './mermaid-bridge';
