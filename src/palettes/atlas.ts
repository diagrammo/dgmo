import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Atlas Palette Definition
// ============================================================
//
// Inspired by vintage classroom pull-down maps and school atlases:
// soft, slightly-aged political fills on warm manila paper, sepia ink
// borders, and a muted steel-blue "pull-down map ocean". The accent
// rotation is the classic set of pastels cartographers use to keep
// adjacent regions distinct without shouting.
//
// Light mode is the star (paper-and-ink). Dark mode shifts the ground to
// deep-ocean navy — the "map at night / globe" register — and brightens
// the same pastels so they read on the darker field.

export const atlasPalette: PaletteConfig = {
  id: 'atlas',
  name: 'Atlas',
  light: {
    bg: '#f3ead3', // warm manila / parchment
    surface: '#ece0c0', // deeper paper (cards, panels)
    overlay: '#e8dab8', // popovers, dropdowns
    border: '#bcaa86', // muted sepia rule line
    text: '#463a26', // aged sepia-brown ink
    textMuted: '#7a6a4f', // faded annotation ink
    textOnFillLight: '#f7f1de', // parchment (light text on dark fills)
    textOnFillDark: '#3a2e1c', // deep ink (dark text on light fills)
    primary: '#5b7a99', // pull-down map ocean (steel-blue)
    secondary: '#7e9a6f', // lowland sage / celadon
    accent: '#b07f7c', // dusty rose
    destructive: '#b25a45', // brick / terracotta
    colors: {
      red: '#bf6a52', // terracotta brick
      orange: '#cf9a5c', // map tan / ochre
      yellow: '#cdb35e', // straw / muted lemon
      green: '#7e9a6f', // sage / celadon lowland
      blue: '#5b7a99', // steel-blue ocean
      purple: '#9a7fa6', // dusty lilac / mauve
      teal: '#6fa094', // muted seafoam
      cyan: '#79a7b5', // shallow-water blue
      gray: '#8a7d68', // warm taupe
      black: '#463a26', // ink
      white: '#ece0c0', // paper
    },
  },
  dark: {
    bg: '#1e2a33', // deep map ocean (night globe)
    surface: '#27353f', // raised ocean
    overlay: '#2e3d48', // popovers, dropdowns
    border: '#3d4f5c', // depth-contour line
    text: '#e8dcc0', // parchment ink, inverted
    textMuted: '#a89a7d', // faded label
    textOnFillLight: '#f7f1de', // parchment
    textOnFillDark: '#1a242c', // deep ocean ink
    primary: '#7ba0bf', // brighter ocean
    secondary: '#9bb588', // sage, lifted
    accent: '#cf9a96', // dusty rose, lifted
    destructive: '#c9745c', // brick, lifted
    colors: {
      red: '#cf7a60', // terracotta
      orange: '#d9a96a', // tan / ochre
      yellow: '#d8c074', // straw
      green: '#9bb588', // sage lowland
      blue: '#7ba0bf', // ocean
      purple: '#b59ac0', // lilac / mauve
      teal: '#85b3a6', // seafoam
      cyan: '#92bccb', // shallow-water blue
      gray: '#9a8d76', // warm taupe
      black: '#27353f', // raised ocean
      white: '#e8dcc0', // parchment
    },
  },
};

registerPalette(atlasPalette);
