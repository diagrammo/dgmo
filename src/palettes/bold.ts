import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Bold Palette Definition
// ============================================================

export const boldPalette: PaletteConfig = {
  id: 'bold',
  name: 'Bold',
  light: {
    bg: '#ffffff',
    surface: '#f0f0f0',
    overlay: '#f0f0f0',
    border: '#cccccc',
    text: '#000000',
    textMuted: '#666666',
    primary: '#0000ff',
    secondary: '#ff00ff',
    accent: '#00cccc',
    destructive: '#ff0000',
    colors: {
      red: '#ff0000',
      orange: '#ff8000',
      yellow: '#ffcc00',
      green: '#00cc00',
      blue: '#0000ff',
      purple: '#cc00cc',
      teal: '#008080',
      cyan: '#00cccc',
      gray: '#808080',
    },
  },
  dark: {
    bg: '#000000',
    surface: '#111111',
    overlay: '#1a1a1a',
    border: '#333333',
    text: '#ffffff',
    textMuted: '#aaaaaa',
    primary: '#00ccff',
    secondary: '#ff00ff',
    accent: '#ffff00',
    destructive: '#ff0000',
    colors: {
      red: '#ff0000',
      orange: '#ff8000',
      yellow: '#ffff00',
      green: '#00ff00',
      blue: '#0066ff',
      purple: '#ff00ff',
      teal: '#00cccc',
      cyan: '#00ffff',
      gray: '#808080',
    },
  },
};

registerPalette(boldPalette);
