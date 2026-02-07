import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Gruvbox Palette Definition
// ============================================================

// Official Gruvbox colors: https://github.com/morhetz/gruvbox
//
// Neutrals:
//   dark0 #282828 | dark1 #3c3836 | dark2 #504945 | dark3 #665c54
//   light0 #fbf1c7 | light1 #ebdbb2 | light2 #d5c4a1 | light3 #bdae93
//   gray #928374
//
// Accents (bright / neutral / faded):
//   Red     #fb4934 / #cc241d / #9d0006
//   Green   #b8bb26 / #98971a / #79740e
//   Yellow  #fabd2f / #d79921 / #b57614
//   Blue    #83a598 / #458588 / #076678
//   Purple  #d3869b / #b16286 / #8f3f71
//   Aqua    #8ec07c / #689d6a / #427b58
//   Orange  #fe8019 / #d65d0e / #af3a03
//
// Light mode uses faded accents, dark mode uses bright accents.

export const gruvboxPalette: PaletteConfig = {
  id: 'gruvbox',
  name: 'Gruvbox',
  light: {
    bg: '#fbf1c7', // light0
    surface: '#ebdbb2', // light1
    overlay: '#d5c4a1', // light2
    border: '#bdae93', // light3
    text: '#3c3836', // dark1
    textMuted: '#7c6f64', // dark4
    primary: '#076678', // faded blue
    secondary: '#427b58', // faded aqua
    accent: '#8f3f71', // faded purple
    destructive: '#9d0006', // faded red
    colors: {
      red: '#9d0006', // faded
      orange: '#af3a03', // faded
      yellow: '#b57614', // faded
      green: '#79740e', // faded
      blue: '#076678', // faded
      purple: '#8f3f71', // faded
      teal: '#427b58', // faded aqua
      cyan: '#427b58', // faded aqua
      gray: '#928374',
    },
  },
  dark: {
    bg: '#282828', // dark0
    surface: '#3c3836', // dark1
    overlay: '#504945', // dark2
    border: '#665c54', // dark3
    text: '#ebdbb2', // light1
    textMuted: '#a89984', // light4
    primary: '#83a598', // bright blue
    secondary: '#8ec07c', // bright aqua
    accent: '#d3869b', // bright purple
    destructive: '#fb4934', // bright red
    colors: {
      red: '#fb4934', // bright
      orange: '#fe8019', // bright
      yellow: '#fabd2f', // bright
      green: '#b8bb26', // bright
      blue: '#83a598', // bright
      purple: '#d3869b', // bright
      teal: '#8ec07c', // bright aqua
      cyan: '#8ec07c', // bright aqua
      gray: '#928374',
    },
  },
};

registerPalette(gruvboxPalette);
