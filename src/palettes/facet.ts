import type { PaletteConfig } from './types';
import { registerPalette } from './registry';

// ============================================================
// Facet Palette Definition
// ============================================================
//
// The vivid, high-chroma palette — saturated gemstone categoricals that
// pop on a bright ground. It fills a gap nothing else in the set covers:
// every other light-capable palette is restrained (Slate), muted-warm
// (Atlas, Tidewater), muted-cool (Nord), or soft-pastel (Catppuccin).
// Facet is the one you reach for when you want colour to *carry* — busy
// multi-series charts, infographics, dashboards, marketing graphics —
// while staying tasteful rather than neon. The name evokes the cut faces
// of a gem: many distinct, brilliant categorical hues.
//
// Light is the canonical mode (where most diagrams live). The same gems
// deepen onto a cool ink ground for a genuinely strong dark mode too — so
// it's dual-strength, not a derived afterthought.
//
// Hues spread cleanly around the wheel (red→orange→yellow→green→teal→cyan→
// blue→purple) so all nine categoricals stay mutually distinct — no slot
// reuse, the failure mode that retired the older borrowed themes.

export const facetPalette: PaletteConfig = {
  id: 'facet',
  name: 'Facet',
  light: {
    bg: '#f5f6fa', // cool off-white
    surface: '#ecedf3',
    overlay: '#e1e3ec',
    border: '#cdd1dd',
    text: '#1c2230', // deep ink
    textMuted: '#5a6478',
    textOnFillLight: '#f7f8fc', // light text for deep/saturated fills
    textOnFillDark: '#161922', // dark text for bright fills (citrine/aqua)
    primary: '#2f6fd0', // sapphire
    secondary: '#14897e', // tourmaline
    accent: '#8b50cf', // amethyst
    destructive: '#cf2f56', // ruby
    colors: {
      red: '#cf2f56', // ruby
      orange: '#c96a1e', // amber
      yellow: '#b08410', // citrine
      green: '#1f9d6a', // emerald
      blue: '#2f6fd0', // sapphire
      purple: '#8b50cf', // amethyst
      teal: '#14897e', // tourmaline
      cyan: '#1898b0', // aquamarine
      gray: '#6b7488', // slate
      black: '#1c2230',
      white: '#ecedf3',
    },
  },
  dark: {
    bg: '#0e1014', // cool ink (neutral near-black)
    surface: '#161922',
    overlay: '#1f2430',
    border: '#2b3140',
    text: '#e4e8f0', // cool off-white
    textMuted: '#9aa3b5',
    textOnFillLight: '#f5f7fb', // light text for deep/saturated fills
    textOnFillDark: '#0b0d10', // dark text for bright fills (citrine/aqua)
    primary: '#4d8df0', // sapphire
    secondary: '#2fb8a8', // tourmaline
    accent: '#b07cf0', // amethyst
    destructive: '#f0476b', // ruby
    colors: {
      red: '#f0476b', // ruby
      orange: '#f08c42', // amber
      yellow: '#ecc14a', // citrine
      green: '#3fce8f', // emerald
      blue: '#4d8df0', // sapphire
      purple: '#b07cf0', // amethyst
      teal: '#2fb8a8', // tourmaline
      cyan: '#46cfe0', // aquamarine
      gray: '#6b7488', // slate
      black: '#161922',
      white: '#e4e8f0',
    },
  },
};

registerPalette(facetPalette);
