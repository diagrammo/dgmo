import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Rosé Pine Palette Definition
// ============================================================

// Official Rosé Pine colors: https://rosepinetheme.com/palette
//
// Dawn (light):
//   Base #faf4ed | Surface #fffaf3 | Overlay #f2e9e1
//   Muted #9893a5 | Subtle #797593 | Text #575279
//   Highlight Med #dfdad9
//
// Moon (dark):
//   Base #232136 | Surface #2a273f | Overlay #393552
//   Muted #6e6a86 | Subtle #908caa | Text #e0def4
//   Highlight Med #44415a
//
// Accents (Dawn / Moon):
//   Love   #b4637a / #eb6f92 | Gold   #ea9d34 / #f6c177
//   Rose   #d7827e / #ea9a97 | Pine   #286983 / #3e8fb0
//   Foam   #56949f / #9ccfd8 | Iris   #907aa9 / #c4a7e7

export const rosePinePalette: PaletteConfig = {
  id: 'rose-pine',
  name: 'Rosé Pine',
  light: {
    bg: '#faf4ed', // Dawn Base
    surface: '#fffaf3', // Dawn Surface
    overlay: '#f2e9e1', // Dawn Overlay
    border: '#dfdad9', // Dawn Highlight Med
    text: '#575279', // Dawn Text
    textMuted: '#9893a5', // Dawn Muted
    primary: '#286983', // Dawn Pine
    secondary: '#56949f', // Dawn Foam
    accent: '#907aa9', // Dawn Iris
    destructive: '#b4637a', // Dawn Love
    colors: {
      red: '#b4637a', // Love
      orange: '#d7827e', // Rose
      yellow: '#ea9d34', // Gold
      green: '#286983', // Pine
      blue: '#56949f', // Foam
      purple: '#907aa9', // Iris
      teal: '#286983', // Pine
      cyan: '#56949f', // Foam
      gray: '#9893a5', // Muted
    },
  },
  dark: {
    bg: '#232136', // Moon Base
    surface: '#2a273f', // Moon Surface
    overlay: '#393552', // Moon Overlay
    border: '#44415a', // Moon Highlight Med
    text: '#e0def4', // Moon Text
    textMuted: '#908caa', // Moon Subtle
    primary: '#3e8fb0', // Moon Pine
    secondary: '#9ccfd8', // Moon Foam
    accent: '#c4a7e7', // Moon Iris
    destructive: '#eb6f92', // Moon Love
    colors: {
      red: '#eb6f92', // Love
      orange: '#ea9a97', // Rose
      yellow: '#f6c177', // Gold
      green: '#3e8fb0', // Pine
      blue: '#9ccfd8', // Foam
      purple: '#c4a7e7', // Iris
      teal: '#3e8fb0', // Pine
      cyan: '#9ccfd8', // Foam
      gray: '#6e6a86', // Muted
    },
  },
};

registerPalette(rosePinePalette);
