import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Tidewater Palette Definition
// ============================================================
//
// A nautical, maritime-chart palette — on-brand with Diagrammo's seafaring
// voice. Weathered sea-mist paper with deep ship's-log navy ink, rope/manila
// tan, brass, signal-flag red, and sea-glass greens (light). Dark mode dives
// to a night-harbor deep-sea ground with the same rigging lifted to read on
// the dark water.

export const tidewaterPalette: PaletteConfig = {
  id: 'tidewater',
  name: 'Tidewater',
  light: {
    bg: '#eceff0', // weathered sea-mist paper
    surface: '#e0e4e3', // worn deck panel
    overlay: '#dadfdf', // popovers, dropdowns
    border: '#a9b2b3', // muted slate rule
    text: '#18313f', // ship's-log navy ink
    textMuted: '#51636b', // faded log entry
    textOnFillLight: '#f3f5f3', // weathered white
    textOnFillDark: '#162c38', // deep navy
    primary: '#1f4e6b', // deep-sea navy
    secondary: '#b08a4f', // rope / manila tan
    accent: '#c69a3e', // brass
    destructive: '#c1433a', // signal-flag red
    colors: {
      red: '#c1433a', // signal-flag red
      orange: '#cc7a38', // weathered amber
      yellow: '#d6bf5a', // brass gold
      green: '#4f8a6b', // sea-glass green
      blue: '#1f4e6b', // deep-sea navy
      purple: '#6a5a8c', // twilight harbor
      teal: '#3d8c8c', // sea-glass teal
      cyan: '#4f9bb5', // shallow water
      gray: '#8a8d86', // driftwood gray
      black: '#18313f', // navy ink
      white: '#e0e4e3', // deck panel
    },
  },
  dark: {
    bg: '#0f2230', // night-harbor deep sea
    surface: '#16303f', // raised hull
    overlay: '#1d3a4a', // popovers, dropdowns
    border: '#2c4856', // rigging line
    text: '#e6ebe8', // weathered white
    textMuted: '#9aaab0', // faded label
    textOnFillLight: '#f3f5f3', // weathered white
    textOnFillDark: '#0f2230', // deep sea
    primary: '#4f9bc4', // lifted sea blue
    secondary: '#c9a46a', // rope tan, lifted
    accent: '#d9b25a', // brass, lifted
    destructive: '#e06a5e', // signal red, lifted
    colors: {
      red: '#e06a5e', // signal-flag red
      orange: '#df9a52', // amber
      yellow: '#e0c662', // brass gold
      green: '#6fb58c', // sea-glass green
      blue: '#4f9bc4', // sea blue
      purple: '#9486bf', // twilight harbor
      teal: '#5cb0ac', // sea-glass teal
      cyan: '#62b4cf', // shallow water
      gray: '#9aa39c', // driftwood gray
      black: '#16303f', // raised hull
      white: '#e6ebe8', // weathered white
    },
  },
};

registerPalette(tidewaterPalette);
