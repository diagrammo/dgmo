import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Solarized Palette Definition
// ============================================================

// Official Solarized colors: https://ethanschoonover.com/solarized/
//
// Base tones:
//   base03 #002b36 | base02 #073642 | base01 #586e75 | base00 #657b83
//   base0  #839496 | base1  #93a1a1 | base2  #eee8d5 | base3  #fdf6e3
//
// Accent colors:
//   yellow #b58900 | orange #cb4b16 | red    #dc322f | magenta #d33682
//   violet #6c71c4 | blue   #268bd2 | cyan   #2aa198 | green   #859900

export const solarizedPalette: PaletteConfig = {
  id: 'solarized',
  name: 'Solarized',
  light: {
    bg: '#fdf6e3', // base3
    surface: '#eee8d5', // base2
    overlay: '#eee8d5', // base2 (muted/secondary backgrounds)
    border: '#93a1a1', // base1
    text: '#657b83', // base00
    textMuted: '#93a1a1', // base1
    primary: '#268bd2', // blue
    secondary: '#2aa198', // cyan
    accent: '#6c71c4', // violet
    destructive: '#dc322f', // red
    colors: {
      red: '#dc322f',
      orange: '#cb4b16',
      yellow: '#b58900',
      green: '#859900',
      blue: '#268bd2',
      purple: '#6c71c4',
      teal: '#2aa198',
      cyan: '#2aa198', // Solarized has no separate cyan — reuse teal
      gray: '#586e75', // base01
    },
  },
  dark: {
    bg: '#002b36', // base03
    surface: '#073642', // base02
    overlay: '#073642', // base02 (muted/secondary backgrounds)
    border: '#586e75', // base01
    text: '#839496', // base0
    textMuted: '#586e75', // base01
    primary: '#268bd2', // blue
    secondary: '#2aa198', // cyan
    accent: '#6c71c4', // violet
    destructive: '#dc322f', // red
    colors: {
      red: '#dc322f',
      orange: '#cb4b16',
      yellow: '#b58900',
      green: '#859900',
      blue: '#268bd2',
      purple: '#6c71c4',
      teal: '#2aa198',
      cyan: '#2aa198',
      gray: '#586e75', // base01
    },
  },
};

registerPalette(solarizedPalette);
