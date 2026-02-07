import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Catppuccin Palette Definition
// ============================================================

// Official Catppuccin colors: https://catppuccin.com/palette
//
// Latte (light):
//   Base #eff1f5 | Mantle #e6e9ef | Crust #dce0e8
//   Surface0 #ccd0da | Text #4c4f69 | Subtext1 #5c5f77 | Overlay0 #9ca0b0
//
// Mocha (dark):
//   Base #1e1e2e | Mantle #181825 | Surface0 #313244
//   Surface1 #45475a | Overlay0 #6c7086 | Text #cdd6f4 | Subtext1 #bac2de
//
// Accents (Latte / Mocha):
//   Red     #d20f39 / #f38ba8 | Peach   #fe640b / #fab387
//   Yellow  #df8e1d / #f9e2af | Green   #40a02b / #a6e3a1
//   Blue    #1e66f5 / #89b4fa | Mauve   #8839ef / #cba6f7
//   Teal    #179299 / #94e2d5 | Sapphire #209fb5 / #74c7ec
//   Lavender #7287fd / #b4befe

export const catppuccinPalette: PaletteConfig = {
  id: 'catppuccin',
  name: 'Catppuccin',
  light: {
    bg: '#eff1f5', // Latte Base
    surface: '#e6e9ef', // Latte Mantle
    overlay: '#ccd0da', // Latte Surface0
    border: '#dce0e8', // Latte Crust
    text: '#4c4f69', // Latte Text
    textMuted: '#5c5f77', // Latte Subtext1
    primary: '#1e66f5', // Latte Blue
    secondary: '#7287fd', // Latte Lavender
    accent: '#8839ef', // Latte Mauve
    destructive: '#d20f39', // Latte Red
    colors: {
      red: '#d20f39',
      orange: '#fe640b',
      yellow: '#df8e1d',
      green: '#40a02b',
      blue: '#1e66f5',
      purple: '#8839ef',
      teal: '#179299',
      cyan: '#209fb5',
      gray: '#9ca0b0', // Latte Overlay0
    },
  },
  dark: {
    bg: '#1e1e2e', // Mocha Base
    surface: '#313244', // Mocha Surface0
    overlay: '#45475a', // Mocha Surface1
    border: '#6c7086', // Mocha Overlay0
    text: '#cdd6f4', // Mocha Text
    textMuted: '#bac2de', // Mocha Subtext1
    primary: '#89b4fa', // Mocha Blue
    secondary: '#b4befe', // Mocha Lavender
    accent: '#cba6f7', // Mocha Mauve
    destructive: '#f38ba8', // Mocha Red
    colors: {
      red: '#f38ba8',
      orange: '#fab387',
      yellow: '#f9e2af',
      green: '#a6e3a1',
      blue: '#89b4fa',
      purple: '#cba6f7',
      teal: '#94e2d5',
      cyan: '#74c7ec',
      gray: '#6c7086', // Mocha Overlay0
    },
  },
};

registerPalette(catppuccinPalette);
