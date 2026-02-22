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

// Re-export palette definitions
export { nordPalette } from './nord';
export { solarizedPalette } from './solarized';
export { catppuccinPalette } from './catppuccin';
export { rosePinePalette } from './rose-pine';
export { gruvboxPalette } from './gruvbox';
export { tokyoNightPalette } from './tokyo-night';
export { oneDarkPalette } from './one-dark';
export { boldPalette } from './bold';

// Re-export Mermaid bridge
export { buildMermaidThemeVars, buildThemeCSS } from './mermaid-bridge';
