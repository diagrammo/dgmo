import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Blueprint Palette Definition
// ============================================================
//
// A cyanotype engineering-drawing palette — the technical register the set
// was missing. Dark mode is the iconic one: chalk-pastel "colored-pencil"
// accents drafted on a deep blueprint-blue ground (reads unmistakably as a
// technical drawing — ideal for infra, C4, ER, flowcharts). Light mode is
// the reversed draft: blueprint-blue ink and lines on pale drafting white.

export const blueprintPalette: PaletteConfig = {
  id: 'blueprint',
  name: 'Blueprint',
  light: {
    bg: '#f4f8fb', // pale drafting white (faint cyan)
    surface: '#e6eef4', // drafting panel
    overlay: '#dde9f1', // popovers, dropdowns
    border: '#aac3d6', // pale blue grid line
    text: '#123a5e', // blueprint navy ink
    textMuted: '#4f7390', // faint draft note
    textOnFillLight: '#f4f8fb', // drafting white
    textOnFillDark: '#0c2f4d', // deep blueprint navy
    primary: '#1f5e8c', // blueprint blue
    secondary: '#5b7d96', // steel
    accent: '#b08a3e', // draftsman's ochre highlight
    destructive: '#c0504d', // correction red
    colors: {
      red: '#c25a4e', // correction red
      orange: '#c2823e', // ochre
      yellow: '#c2a843', // pencil gold
      green: '#4f8a6b', // drafting green
      blue: '#1f5e8c', // blueprint blue
      purple: '#6f5e96', // indigo pencil
      teal: '#3a8a8a', // teal
      cyan: '#3f8fb5', // cyan
      gray: '#7e8e98', // graphite
      black: '#123a5e', // navy ink
      white: '#e6eef4', // panel
    },
  },
  dark: {
    bg: '#103a5e', // deep blueprint blue (cyanotype ground)
    surface: '#16466e', // raised sheet
    overlay: '#1c5180', // popovers, dropdowns
    border: '#3a6f96', // grid line
    text: '#eaf2f8', // chalk white
    textMuted: '#9fc0d6', // faint chalk note
    textOnFillLight: '#eaf2f8', // chalk white
    textOnFillDark: '#0c2f4d', // deep blueprint navy
    primary: '#7fb8d8', // chalk cyan
    secondary: '#9fb8c8', // pale steel
    accent: '#d8c27a', // chalk amber
    destructive: '#e08a7a', // chalk correction red
    colors: {
      red: '#e0907e', // chalk red
      orange: '#e0ab78', // chalk amber
      yellow: '#e3d089', // chalk gold
      green: '#93c79e', // chalk green
      blue: '#8ec3e0', // chalk cyan-blue
      purple: '#b6a6d8', // chalk indigo
      teal: '#84c7c2', // chalk teal
      cyan: '#9fd6e0', // chalk cyan
      gray: '#aebecb', // chalk graphite
      black: '#16466e', // raised sheet
      white: '#eaf2f8', // chalk white
    },
  },
};

registerPalette(blueprintPalette);
