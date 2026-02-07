import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Nord Palette Definition
// ============================================================

export const nordPalette: PaletteConfig = {
  id: 'nord',
  name: 'Nord',
  light: {
    bg: '#eceff4', // nord6
    surface: '#e5e9f0', // nord5
    overlay: '#d8dee9', // nord4 (muted/secondary backgrounds)
    border: '#d8dee9', // nord4
    text: '#2e3440', // nord0
    textMuted: '#4c566a', // nord3
    primary: '#5e81ac', // nord10
    secondary: '#81a1c1', // nord9
    accent: '#81a1c1', // nord9
    destructive: '#bf616a', // nord11
    colors: {
      red: '#bf616a', // nord11
      orange: '#d08770', // nord12
      yellow: '#ebcb8b', // nord13
      green: '#a3be8c', // nord14
      blue: '#5e81ac', // nord10
      purple: '#b48ead', // nord15
      teal: '#8fbcbb', // nord7
      cyan: '#88c0d0', // nord8
      gray: '#4c566a', // nord3
    },
  },
  dark: {
    bg: '#2e3440', // nord0
    surface: '#3b4252', // nord1
    overlay: '#434c5e', // nord2
    border: '#4c566a', // nord3
    text: '#eceff4', // nord6
    textMuted: '#d8dee9', // nord4
    primary: '#88c0d0', // nord8 (different from light's nord10)
    secondary: '#81a1c1', // nord9
    accent: '#81a1c1', // nord9
    destructive: '#bf616a', // nord11
    colors: {
      red: '#bf616a', // nord11
      orange: '#d08770', // nord12
      yellow: '#ebcb8b', // nord13
      green: '#a3be8c', // nord14
      blue: '#5e81ac', // nord10
      purple: '#b48ead', // nord15
      teal: '#8fbcbb', // nord7
      cyan: '#88c0d0', // nord8
      gray: '#4c566a', // nord3
    },
  },
};

registerPalette(nordPalette);
