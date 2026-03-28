import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Monokai Palette Definition
// Based on Monokai / Monokai Pro color scheme
// ============================================================

const monokaiPalette: PaletteConfig = {
  id: 'monokai',
  name: 'Monokai',
  light: {
    bg: '#fafaf8',
    surface: '#f0efe8',
    overlay: '#e6e5de',
    border: '#d4d3cc',
    text: '#272822', // classic Monokai bg as text
    textMuted: '#75715e', // comment
    primary: '#49483e', // line highlight
    secondary: '#f92672', // pink
    accent: '#a6e22e', // green
    destructive: '#f92672', // pink/red
    colors: {
      red: '#f92672', // Monokai pink-red
      orange: '#fd971f',
      yellow: '#e6db74',
      green: '#a6e22e',
      blue: '#5c7eab', // derived true blue
      purple: '#ae81ff',
      teal: '#4ea8a6', // muted from cyan
      cyan: '#66d9ef',
      gray: '#75715e', // comment
    },
  },
  dark: {
    bg: '#272822', // classic background
    surface: '#2d2e27',
    overlay: '#3e3d32', // line highlight
    border: '#49483e',
    text: '#f8f8f2', // foreground
    textMuted: '#a6a28c', // brightened comment
    primary: '#a6e22e', // green
    secondary: '#66d9ef', // cyan
    accent: '#f92672', // pink
    destructive: '#f92672', // pink/red
    colors: {
      red: '#f92672',
      orange: '#fd971f',
      yellow: '#e6db74',
      green: '#a6e22e',
      blue: '#5c7eab', // derived true blue
      purple: '#ae81ff',
      teal: '#4ea8a6', // muted from cyan
      cyan: '#66d9ef',
      gray: '#75715e', // comment
    },
  },
};

registerPalette(monokaiPalette);
