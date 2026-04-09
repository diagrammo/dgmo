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
  gray: nord.nord3,
  black: nord.nord0,
  white: nord.nord6,
};

/**
 * The canonical, closed set of color names accepted by the DGMO language.
 * See `docs/dgmo-language-spec.md` §1.5. Users cannot extend this list —
 * palettes only provide the per-theme hex values for these names.
 */
export const RECOGNIZED_COLOR_NAMES = Object.freeze([
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'teal',
  'cyan',
  'gray',
  'black',
  'white',
] as const);

/**
 * Returns true iff `name` is one of the 11 recognized DGMO color names.
 */
export function isRecognizedColorName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(colorNames, name.toLowerCase());
}

/**
 * Resolves a recognized color name to its hex value for the active palette
 * (falling back to the built-in Nord defaults). Returns `null` for any
 * unrecognized input — including hex codes, CSS keywords like `pink`,
 * and typos. Callers MUST treat `null` as a parse error and emit a
 * diagnostic; do not silently fall back to the raw input.
 */
export function resolveColor(
  color: string,
  palette?: { colors: Record<string, string> }
): string | null {
  if (!color) return null;
  // Reject hex color codes — only named colors are supported
  if (color.startsWith('#')) return null;

  const lower = color.toLowerCase();
  if (!isRecognizedColorName(lower)) return null;

  if (palette) {
    const named = palette.colors[lower];
    if (named) return named;
  }
  return colorNames[lower];
}

import type { DgmoError } from './diagnostics';
import { makeDgmoError, suggest } from './diagnostics';

/**
 * Resolves a color name and pushes a warning diagnostic on failure.
 * Returns the hex string for valid names, or `undefined` for unknown
 * input (after pushing a diagnostic). Use this from parsers that have
 * a diagnostics array and a line number in scope.
 */
export function resolveColorWithDiagnostic(
  color: string,
  line: number,
  diagnostics: DgmoError[],
  palette?: { colors: Record<string, string> }
): string | undefined {
  const resolved = resolveColor(color, palette);
  if (resolved !== null) return resolved;
  const hint = suggest(color, RECOGNIZED_COLOR_NAMES as readonly string[]);
  const suggestion = hint ? ` ${hint}` : '';
  diagnostics.push(
    makeDgmoError(
      line,
      `Unknown color "${color}". Allowed: ${RECOGNIZED_COLOR_NAMES.join(', ')}.${suggestion}`,
      'warning'
    )
  );
  return undefined;
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
