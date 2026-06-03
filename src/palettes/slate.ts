import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Slate Palette Definition
// ============================================================
//
// A restrained, presentation-grade palette for professional decks and
// reports — the "not very stylistic" option done tastefully. Clean white
// (or deep slate) ground, one confident corporate blue, neutral cool-gray
// surfaces, and a categorical rotation tuned to a single perceived weight
// so no series shouts. Replaces the harsh primary-RGB feel of "bold".

export const slatePalette: PaletteConfig = {
  id: 'slate',
  name: 'Slate',
  light: {
    bg: '#ffffff', // clean slide white
    surface: '#f3f5f8', // light cool-gray panel
    overlay: '#eaeef3', // popovers, dropdowns
    border: '#d4dae1', // hairline rule
    text: '#1f2933', // near-black slate (softer than pure black)
    textMuted: '#5b6672', // secondary label
    textOnFillLight: '#ffffff', // light text on dark fills
    textOnFillDark: '#1f2933', // dark text on light fills
    primary: '#3b6ea5', // confident corporate blue
    secondary: '#5b6672', // slate gray
    accent: '#3a9188', // muted teal accent
    destructive: '#c0504d', // brick red
    colors: {
      red: '#c0504d', // brick
      orange: '#cc7a33', // muted amber
      yellow: '#c9a227', // gold (not neon)
      green: '#5b9357', // forest / sage
      blue: '#3b6ea5', // corporate blue
      purple: '#7d5ba6', // muted violet
      teal: '#3a9188', // teal
      cyan: '#4f96c4', // steel cyan
      gray: '#7e8a97', // cool gray
      black: '#1f2933', // slate ink
      white: '#f3f5f8', // panel
    },
  },
  dark: {
    bg: '#161b22', // deep slate (keynote dark)
    surface: '#202833', // raised panel
    overlay: '#29323e', // popovers, dropdowns
    border: '#38424f', // divider
    text: '#e6eaef', // off-white
    textMuted: '#9aa5b1', // secondary label
    textOnFillLight: '#ffffff', // light text on dark fills
    textOnFillDark: '#161b22', // dark text on light fills
    primary: '#5b9bd5', // lifted corporate blue
    secondary: '#8593a3', // slate gray, lifted
    accent: '#45b3a3', // teal, lifted
    destructive: '#e07b6e', // brick, lifted
    colors: {
      red: '#e07b6e', // brick
      orange: '#e0975a', // amber
      yellow: '#d9bd5a', // gold
      green: '#74b56e', // forest / sage
      blue: '#5b9bd5', // corporate blue
      purple: '#a585c9', // violet
      teal: '#45b3a3', // teal
      cyan: '#62b0d9', // steel cyan
      gray: '#95a1ae', // cool gray
      black: '#202833', // raised panel
      white: '#e6eaef', // off-white
    },
  },
};

registerPalette(slatePalette);
