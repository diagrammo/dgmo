// ============================================================
// Shared Nord Color Palette
// ============================================================

/** Complete 16-entry Nord palette. */
export const nord = {
  // Polar Night (dark)
  nord0: '#2e3440',
  nord1: '#3b4252',
  nord2: '#434c5e',
  nord3: '#4c566a',
  // Snow Storm (light)
  nord4: '#d8dee9',
  nord5: '#e5e9f0',
  nord6: '#eceff4',
  // Frost (accent blues)
  nord7: '#8fbcbb',
  nord8: '#88c0d0',
  nord9: '#81a1c1',
  nord10: '#5e81ac',
  // Aurora (colors)
  nord11: '#bf616a', // red
  nord12: '#d08770', // orange
  nord13: '#ebcb8b', // yellow
  nord14: '#a3be8c', // green
  nord15: '#b48ead', // purple
};

/** Color name → Nord hex for inline `(color)` annotations. */
export const colorNames: Record<string, string> = {
  red: nord.nord11,
  orange: nord.nord12,
  yellow: nord.nord13,
  green: nord.nord14,
  blue: nord.nord10,
  purple: nord.nord15,
  teal: nord.nord7,
  cyan: nord.nord8,
  lightblue: nord.nord8,
  gray: nord.nord3,
};

/**
 * Resolves a color name or hex code to a valid CSS color.
 * When a palette is provided, named colors resolve against its color map first.
 * Hex codes (e.g. "#ff0000") are passed through regardless of palette (FR8).
 * Unknown names are returned as-is.
 */
export function resolveColor(
  color: string,
  palette?: { colors: Record<string, string> }
): string {
  const lower = color.toLowerCase();
  if (lower.startsWith('#')) return lower;

  if (palette) {
    const named = palette.colors[lower];
    if (named) return named;
  }

  if (colorNames[lower]) return colorNames[lower];
  return color;
}

/** @deprecated Use getSeriesColors(palette) from '@/lib/palettes' instead. */
export const seriesColors = [
  nord.nord10, // blue
  nord.nord14, // green
  nord.nord13, // yellow
  nord.nord12, // orange
  nord.nord15, // purple
  nord.nord11, // red
  nord.nord7, // teal
  nord.nord8, // light blue
];
