import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Tokyo Night Palette Definition
// ============================================================

// Official Tokyo Night colors: https://github.com/folke/tokyonight.nvim
//
// Night (dark):
//   bg #1a1b26 | bg_highlight #292e42 | terminal_black #414868
//   fg_gutter #3b4261 | fg #c0caf5 | fg_dark #a9b1d6
//   comment #565f89
//
// Day (light):
//   bg #e1e2e7 | bg_float #d0d5e3 | bg_highlight #c4c8da
//   fg_gutter #a8aecb | fg #3760bf | fg_dark #6172b0
//   dark3 #8990b3
//
// Accents (Day / Night):
//   Red     #f52a65 / #f7768e | Orange  #b15c00 / #ff9e64
//   Yellow  #8c6c3e / #e0af68 | Green   #587539 / #9ece6a
//   Blue    #2e7de9 / #7aa2f7 | Purple  #7847bd / #bb9af7
//   Teal    #118c74 / #1abc9c | Cyan    #007197 / #7dcfff
//   Magenta #9854f1 / #bb9af7

export const tokyoNightPalette: PaletteConfig = {
  id: 'tokyo-night',
  name: 'Tokyo Night',
  light: {
    bg: '#e1e2e7', // Day bg
    surface: '#d0d5e3', // Day bg_float
    overlay: '#c4c8da', // Day bg_highlight
    border: '#a8aecb', // Day fg_gutter
    text: '#3760bf', // Day fg
    textMuted: '#6172b0', // Day fg_dark
    primary: '#2e7de9', // Day blue
    secondary: '#007197', // Day cyan
    accent: '#9854f1', // Day magenta
    destructive: '#f52a65', // Day red
    colors: {
      red: '#f52a65',
      orange: '#b15c00',
      yellow: '#8c6c3e',
      green: '#587539',
      blue: '#2e7de9',
      purple: '#7847bd',
      teal: '#118c74',
      cyan: '#007197',
      gray: '#8990b3', // Day dark3
    },
  },
  dark: {
    bg: '#1a1b26', // Night bg
    surface: '#292e42', // Night bg_highlight
    overlay: '#414868', // Night terminal_black
    border: '#3b4261', // Night fg_gutter
    text: '#c0caf5', // Night fg
    textMuted: '#a9b1d6', // Night fg_dark
    primary: '#7aa2f7', // Night blue
    secondary: '#7dcfff', // Night cyan
    accent: '#bb9af7', // Night magenta
    destructive: '#f7768e', // Night red
    colors: {
      red: '#f7768e',
      orange: '#ff9e64',
      yellow: '#e0af68',
      green: '#9ece6a',
      blue: '#7aa2f7',
      purple: '#bb9af7',
      teal: '#1abc9c',
      cyan: '#7dcfff',
      gray: '#565f89', // Night comment
    },
  },
};

registerPalette(tokyoNightPalette);
