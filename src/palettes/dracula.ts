import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Dracula Palette Definition
// https://draculatheme.com/contribute
// ============================================================

export const draculaPalette: PaletteConfig = {
  id: 'dracula',
  name: 'Dracula',
  light: {
    bg: '#f8f8f2', // foreground as light bg
    surface: '#f0f0ec',
    overlay: '#e8e8e2',
    border: '#d8d8d2',
    text: '#282a36', // background as light text
    textMuted: '#44475a', // current line
    primary: '#6272a4', // comment
    secondary: '#bd93f9', // purple
    accent: '#bd93f9', // purple
    destructive: '#ff5555', // red
    colors: {
      red: '#ff5555',
      orange: '#ffb86c',
      yellow: '#f1fa8c',
      green: '#50fa7b',
      blue: '#6272a4', // comment blue
      purple: '#bd93f9',
      teal: '#5ac8b8', // muted cyan toward green
      cyan: '#8be9fd',
      gray: '#6272a4',
      black: '#282a36',
      white: '#f0f0ec',
    },
  },
  dark: {
    bg: '#282a36', // background
    surface: '#343746', // between bg and current line
    overlay: '#44475a', // current line
    border: '#6272a4', // comment
    text: '#f8f8f2', // foreground
    textMuted: '#bcc2d4', // muted foreground
    primary: '#bd93f9', // purple (Dracula's signature)
    secondary: '#8be9fd', // cyan
    accent: '#ff79c6', // pink
    destructive: '#ff5555', // red
    colors: {
      red: '#ff5555',
      orange: '#ffb86c',
      yellow: '#f1fa8c',
      green: '#50fa7b',
      blue: '#6272a4', // comment blue
      purple: '#bd93f9',
      teal: '#5ac8b8', // muted cyan toward green
      cyan: '#8be9fd',
      gray: '#6272a4',
      black: '#343746',
      white: '#f8f8f2',
    },
  },
};

registerPalette(draculaPalette);
