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
 * The canonical order in which the categorical (non-neutral) color names are
 * auto-assigned: tag/group swatches (`autoTagColorCycle`) and data-chart
 * series colors (`getSeriesColors`) both derive their rotation from this list.
 *
 * Seeded with the RGB primaries (`red, green, blue`) for an unmistakable first
 * three, then each subsequent hue is chosen to fill the widest remaining gap on
 * the color wheel — maximizing contrast between adjacent swatches. Neutrals
 * (`gray`/`black`/`white`) are intentionally excluded so auto-picked colors
 * always read as distinct legend swatches.
 */
export const CATEGORICAL_COLOR_ORDER = Object.freeze([
  'red',
  'green',
  'blue',
  'yellow',
  'teal',
  'purple',
  'orange',
  'cyan',
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
  return colorNames[lower] ?? null;
}

import type { DgmoError } from './diagnostics';
import { makeDgmoError, suggest } from './diagnostics';

/**
 * Stable diagnostic code for "this token is not one of the 11 named palette
 * colors" — covers both hex/CSS literals (emitted as `error`) and unrecognized
 * bare words like `crimson` (emitted as `warning`). Consumers that want to
 * HARD-BLOCK invalid colors regardless of severity (e.g. the MCP render gate)
 * filter on this code rather than re-deriving the rule.
 */
export const INVALID_COLOR_CODE = 'E_INVALID_COLOR';

/**
 * CSS / X11 color names that are NOT one of DGMO's 11 — mapped to their hex so
 * a "nearest valid color" hint can be computed. This is the blocklist that lets
 * the trailing-token rule tell an *intended-but-invalid* color (`pink`,
 * `crimson`, `navy`) apart from an ordinary label word (`Zinfandel`, `Blanc`):
 * a lowercase trailing token found here is flagged, anything else stays label
 * text. Our 11 valid names are deliberately excluded. Extend freely — it only
 * sharpens detection. (Case-sensitive lowercase, matching the §1.5 color rule.)
 */
export const INVALID_CSS_COLOR_HEX: Readonly<Record<string, string>> =
  Object.freeze({
    pink: '#ffc0cb',
    hotpink: '#ff69b4',
    deeppink: '#ff1493',
    lightpink: '#ffb6c1',
    palevioletred: '#db7093',
    crimson: '#dc143c',
    scarlet: '#ff2400',
    firebrick: '#b22222',
    darkred: '#8b0000',
    maroon: '#800000',
    salmon: '#fa8072',
    lightsalmon: '#ffa07a',
    darksalmon: '#e9967a',
    coral: '#ff7f50',
    lightcoral: '#f08080',
    tomato: '#ff6347',
    orangered: '#ff4500',
    darkorange: '#ff8c00',
    gold: '#ffd700',
    goldenrod: '#daa520',
    darkgoldenrod: '#b8860b',
    khaki: '#f0e68c',
    darkkhaki: '#bdb76b',
    amber: '#ffbf00',
    lavender: '#e6e6fa',
    violet: '#ee82ee',
    magenta: '#ff00ff',
    fuchsia: '#ff00ff',
    orchid: '#da70d6',
    plum: '#dda0dd',
    indigo: '#4b0082',
    navy: '#000080',
    midnightblue: '#191970',
    darkblue: '#00008b',
    mediumblue: '#0000cd',
    royalblue: '#4169e1',
    cornflowerblue: '#6495ed',
    dodgerblue: '#1e90ff',
    deepskyblue: '#00bfff',
    skyblue: '#87ceeb',
    lightskyblue: '#87cefa',
    lightblue: '#add8e6',
    powderblue: '#b0e0e6',
    steelblue: '#4682b4',
    slateblue: '#6a5acd',
    cadetblue: '#5f9ea0',
    turquoise: '#40e0d0',
    aqua: '#00ffff',
    aquamarine: '#7fffd4',
    lime: '#00ff00',
    limegreen: '#32cd32',
    lightgreen: '#90ee90',
    palegreen: '#98fb98',
    seagreen: '#2e8b57',
    mediumseagreen: '#3cb371',
    forestgreen: '#228b22',
    darkgreen: '#006400',
    olive: '#808000',
    olivedrab: '#6b8e23',
    darkolivegreen: '#556b2f',
    chartreuse: '#7fff00',
    lawngreen: '#7cfc00',
    springgreen: '#00ff7f',
    greenyellow: '#adff2f',
    brown: '#a52a2a',
    sienna: '#a0522d',
    chocolate: '#d2691e',
    peru: '#cd853f',
    tan: '#d2b48c',
    beige: '#f5f5dc',
    wheat: '#f5deb3',
    ivory: '#fffff0',
    silver: '#c0c0c0',
    lightgray: '#d3d3d3',
    lightgrey: '#d3d3d3',
    darkgray: '#a9a9a9',
    darkgrey: '#a9a9a9',
    dimgray: '#696969',
    dimgrey: '#696969',
    slategray: '#708090',
    slategrey: '#708090',
    gainsboro: '#dcdcdc',
    grey: '#808080',
  });

/**
 * Best-effort nearest recognized color NAME for an unsupported hex value.
 * Matches by HUE (with a low-saturation cutoff routing to black/white/gray),
 * NOT raw RGB distance to the muted palette hexes — vivid LLM colors like a
 * `#3cb44b` green would otherwise snap to `gray` against a desaturated sage.
 * Returns null for non-hex input (CSS function/keyword colors, no RGB to read).
 * Used ONLY to enrich a diagnostic — never to silently accept the value.
 */
export function nearestNamedColor(input: string): string | null {
  // CSS color name → resolve to its hex first so hue-matching works on it too.
  const cssHex = INVALID_CSS_COLOR_HEX[input.trim().toLowerCase()];
  if (cssHex) input = cssHex;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  // Low chroma → a neutral; pick by lightness.
  if (s < 0.15) {
    if (l < 0.2) return 'black';
    if (l > 0.85) return 'white';
    return 'gray';
  }
  let hue: number;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  // Canonical hue anchors for the 8 chromatic names (red appears at both 0 and
  // 360 so wrap-around resolves correctly).
  const anchors: readonly [string, number][] = [
    ['red', 0],
    ['orange', 30],
    ['yellow', 55],
    ['green', 120],
    ['teal', 170],
    ['cyan', 190],
    ['blue', 225],
    ['purple', 285],
    ['red', 360],
  ];
  let best = 'red';
  let bestD = Infinity;
  for (const [name, deg] of anchors) {
    const d = Math.abs(hue - deg);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/**
 * True iff `token` is an INTENDED-but-invalid color: a hex/`rgb()`/`hsl()`
 * literal, or a known CSS color name that isn't one of DGMO's 11. Lets the
 * trailing-token rule flag `Rosé pink` / `Foo #e6194b` while leaving genuine
 * label words (`Zinfandel`) untouched.
 */
export function isInvalidColorToken(token: string): boolean {
  if (/^(#|rgba?\(|hsla?\()/i.test(token)) return true;
  const lower = token.toLowerCase();
  return (
    INVALID_CSS_COLOR_HEX[lower] !== undefined && !isRecognizedColorName(lower)
  );
}

/**
 * Build an `E_INVALID_COLOR` diagnostic for an intended-but-invalid trailing
 * color token, or return null if `token` isn't color-like (so it stays label
 * text). Severity is `warning` so the library degrades gracefully (the value
 * just keeps the word); the MCP render gate blocks on the code regardless.
 * Used by `extractColor` to close the trailing-token "silent swallow" gap.
 */
export function invalidColorDiagnostic(
  token: string,
  line: number
): DgmoError | null {
  if (!isInvalidColorToken(token)) return null;
  const nearest = nearestNamedColor(token);
  const near = nearest ? ` Nearest: ${nearest}.` : '';
  return makeDgmoError(
    line,
    `Color "${token}" is not a valid DGMO color — DGMO accepts only these 11 named colors: ${RECOGNIZED_COLOR_NAMES.join(', ')} (no hex, no CSS color names).${near}`,
    'warning',
    INVALID_COLOR_CODE
  );
}

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
  // Literal color values (hex `#e6194b`, `rgb(...)`, `hsl(...)`) are NOT part
  // of the DGMO language — only the 11 named palette colors are accepted, so
  // that a single source recolors correctly across every palette and theme.
  // Flag these with a precise error rather than a typo suggestion.
  if (/^(#|rgba?\(|hsla?\()/i.test(color)) {
    const nearest = nearestNamedColor(color);
    const near = nearest ? ` Nearest: ${nearest}.` : '';
    diagnostics.push(
      makeDgmoError(
        line,
        `Color "${color}" is not supported — DGMO does not accept hex or CSS color values. Use a named palette color: ${RECOGNIZED_COLOR_NAMES.join(', ')}.${near}`,
        'error',
        INVALID_COLOR_CODE
      )
    );
    return undefined;
  }
  const hint = suggest(color, RECOGNIZED_COLOR_NAMES as readonly string[]);
  const suggestion = hint ? ` ${hint}` : '';
  diagnostics.push(
    makeDgmoError(
      line,
      `Unknown color "${color}". DGMO accepts only these 11 named colors: ${RECOGNIZED_COLOR_NAMES.join(', ')} (no hex, no CSS color names).${suggestion}`,
      'warning',
      INVALID_COLOR_CODE
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
