import type { PaletteConfig } from './types';

// ============================================================
// Broadsheet Palette Definition
// ============================================================
//
// A newspaper-chart palette: warm salmon paper, warm-grey ink, and a deep
// blue / claret / teal lead. Light-mode hues are taken from the Financial
// Times' MIT-licensed o-colors library (@financial-times/o-colors 6.7.1,
// src/scss/_palette.scss); the name in each comment is the o-colors name.
// Yellow, orange and cyan are darkened from their o-colors values so every
// series reaches 3:1 against the paper. The dark mode has no upstream source
// and is derived here on a slate ground.
//
// 🔴 Never name or describe this palette after the FT in the id, name, docs or
// marketing, and never add o-colors' ft-pink / ft-grey (its logo colours).
// Trademark read: diagrammo/diagrammo#1977, 2026-11-13.

export const broadsheetPalette: PaletteConfig = {
  id: 'broadsheet',
  name: 'Broadsheet',
  light: {
    bg: '#fff1e5', // paper
    surface: '#f2dfce', // wheat
    overlay: '#f7e8db', // paper/wheat mix
    border: '#ccc1b7', // black-20 on paper
    text: '#33302e', // black-80 on paper
    textMuted: '#66605c', // black-60 on paper
    textOnFillLight: '#fff1e5', // paper
    textOnFillDark: '#33302e', // black-80
    primary: '#0f5499', // oxford
    secondary: '#990f3d', // claret
    accent: '#0d7680', // teal
    destructive: '#cc0000', // crimson
    colors: {
      red: '#990f3d', // claret
      orange: '#d9661a', // mandarin, darkened to 3.2:1
      yellow: '#a87d00', // ochre, lemon darkened to 3.4:1
      green: '#00994d', // jade
      blue: '#0f5499', // oxford
      purple: '#593380', // velvet
      teal: '#0d7680', // teal
      cyan: '#2a87c8', // org-b2c, darkened to 3.5:1
      gray: '#8a8179', // warm grey
      black: '#33302e', // black-80
      white: '#f2dfce', // wheat
    },
  },
  dark: {
    bg: '#1f2228', // below slate
    surface: '#262a33', // slate
    overlay: '#2e333d', // raised slate
    border: '#434956', // slate rule
    text: '#f2e9e1', // paper-ward ink
    textMuted: '#b0a79f', // faded ink
    textOnFillLight: '#fff1e5', // paper
    textOnFillDark: '#1f2228', // ground
    primary: '#5b9be6', // oxford, lifted
    secondary: '#e3628d', // claret, lifted
    accent: '#33b0bb', // teal, lifted
    destructive: '#ff5c5c', // crimson, lifted
    colors: {
      red: '#e3628d', // claret, lifted
      orange: '#ff9a52', // mandarin, lifted
      yellow: '#f2cf3c', // lemon, toned
      green: '#3ec47d', // jade, lifted
      blue: '#5b9be6', // oxford, lifted
      purple: '#a587d6', // velvet, lifted
      teal: '#33b0bb', // teal, lifted
      cyan: '#8cc2ff', // sky-ward blue
      gray: '#7d7670', // warm grey
      black: '#262a33', // slate
      white: '#f2e9e1', // paper-ward ink
    },
  },
};
