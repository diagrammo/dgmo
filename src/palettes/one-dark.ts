import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// One Dark Palette Definition
// Based on Atom's One Dark theme
// ============================================================

export const oneDarkPalette: PaletteConfig = {
  id: 'one-dark',
  name: 'One Dark',
  light: {
    // One Light variant (Atom's light counterpart)
    bg: '#fafafa',
    surface: '#f0f0f0',
    overlay: '#e5e5e5',
    border: '#d0d0d0',
    text: '#383a42',
    textMuted: '#696c77',
    textOnFillLight: '#fafafa',
    textOnFillDark: '#181a1f', // Tightened from #383a42 — the light Text token fails 3:1 on saturated blue/teal
    primary: '#4078f2',
    secondary: '#a626a4',
    accent: '#0184bc',
    destructive: '#e45649',
    colors: {
      red: '#e45649',
      orange: '#c18401',
      yellow: '#c18401',
      green: '#50a14f',
      blue: '#4078f2',
      purple: '#a626a4',
      teal: '#0184bc',
      cyan: '#0997b3',
      gray: '#696c77',
      black: '#383a42',
      white: '#f0f0f0',
    },
  },
  dark: {
    // One Dark (Atom's dark theme)
    bg: '#282c34',
    surface: '#21252b',
    overlay: '#2c313a',
    border: '#3e4451',
    text: '#abb2bf',
    textMuted: '#5c6370',
    textOnFillLight: '#fafafa',
    textOnFillDark: '#21252b',
    primary: '#61afef',
    secondary: '#c678dd',
    accent: '#56b6c2',
    destructive: '#e06c75',
    colors: {
      red: '#e06c75',
      orange: '#d19a66',
      yellow: '#e5c07b',
      green: '#98c379',
      blue: '#61afef',
      purple: '#c678dd',
      teal: '#56b6c2',
      cyan: '#56b6c2',
      gray: '#5c6370',
      black: '#21252b',
      white: '#abb2bf',
    },
  },
};

registerPalette(oneDarkPalette);
