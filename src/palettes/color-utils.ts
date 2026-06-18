import { CATEGORICAL_COLOR_ORDER } from '../colors';
import type { PaletteColors } from './types';

// ============================================================
// HSL Conversion
// ============================================================

/** Convert hex (#RRGGBB or #RGB) to { h, s, l } with h in degrees, s/l as percentages. */
export function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;

  const r = parseInt(full.substring(0, 2), 16) / 255;
  const g = parseInt(full.substring(2, 4), 16) / 255;
  const b = parseInt(full.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: Math.round(l * 100) };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/** Convert { h (degrees), s (%), l (%) } back to #RRGGBB hex string. */
export function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;

  if (sNorm === 0) {
    const v = Math.round(lNorm * 255);
    return `#${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}${v.toString(16).padStart(2, '0')}`;
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    let tNorm = t;
    if (tNorm < 0) tNorm += 1;
    if (tNorm > 1) tNorm -= 1;
    if (tNorm < 1 / 6) return p + (q - p) * 6 * tNorm;
    if (tNorm < 1 / 2) return q;
    if (tNorm < 2 / 3) return p + (q - p) * (2 / 3 - tNorm) * 6;
    return p;
  };

  const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
  const p = 2 * lNorm - q;
  const hNorm = h / 360;

  const r = Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, hNorm) * 255);
  const b = Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Convert hex to "H S% L%" string for CSS custom properties. */
export function hexToHSLString(hex: string): string {
  const { h, s, l } = hexToHSL(hex);
  return `${h} ${s}% ${l}%`;
}

// ============================================================
// Color Manipulation
// ============================================================

/**
 * Blend a color toward white (light mode quadrant fills).
 * amount: 0 = original, 1 = white
 */
export function tint(hex: string, amount: number): string {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;

  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);

  const tr = Math.round(r + (255 - r) * amount);
  const tg = Math.round(g + (255 - g) * amount);
  const tb = Math.round(b + (255 - b) * amount);

  return `#${tr.toString(16).padStart(2, '0')}${tg.toString(16).padStart(2, '0')}${tb.toString(16).padStart(2, '0')}`;
}

/**
 * Blend a color toward a dark base (dark mode quadrant fills).
 * amount: 0 = original, 1 = base
 */
export function shade(hex: string, base: string, amount: number): string {
  const parse = (h: string): [number, number, number] => {
    const raw = h.replace('#', '');
    const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
    return [
      parseInt(full.substring(0, 2), 16),
      parseInt(full.substring(2, 4), 16),
      parseInt(full.substring(4, 6), 16),
    ];
  };

  const [r, g, b] = parse(hex);
  const [br, bg, bb] = parse(base);

  const sr = Math.round(r + (br - r) * amount);
  const sg = Math.round(g + (bg - g) * amount);
  const sb = Math.round(b + (bb - b) * amount);

  return `#${sr.toString(16).padStart(2, '0')}${sg.toString(16).padStart(2, '0')}${sb.toString(16).padStart(2, '0')}`;
}

// ============================================================
// Color Mixing
// ============================================================

/**
 * Blend two hex colors by percentage.
 * `pct` = 0 → 100% of `b`, `pct` = 100 → 100% of `a`.
 *
 * Used by all renderers for tinted fills and strokes.
 */
export function mix(a: string, b: string, pct: number): string {
  const parse = (h: string): [number, number, number] => {
    const r = h.replace('#', '');
    const f = r.length === 3 ? [...r].map((c) => c + c).join('') : r;
    return [
      parseInt(f.substring(0, 2), 16),
      parseInt(f.substring(2, 4), 16),
      parseInt(f.substring(4, 6), 16),
    ];
  };
  const [ar, ag, ab] = parse(a),
    [br, bg, bb] = parse(b),
    t = pct / 100;
  const c = (x: number, y: number) =>
    Math.round(x * t + y * (1 - t))
      .toString(16)
      .padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

// ============================================================
// Value Ramp (the shared `<metric> <low?> <high?>` coloring convention)
// ============================================================
//
// Single source of truth for value-ramp fills across chart types (map
// `region-metric`, boxes-and-lines `box-metric`, and any future ramp). Callers
// resolve the two endpoint NAMES to palette hex, then ask for the fill at a
// normalized position `t∈[0,1]`. The helper owns ONLY the low→high blend; each
// caller keeps its own RAMP_FLOOR / base remap of `t`.
//
// The blend is a straight sRGB fade between the two true palette endpoints — no
// invented intermediate hue. `t=0` is exactly `low`, `t=1` is exactly `high`,
// and everything between is a direct interpolation of those two palette colours.
// (resvg has no `color-mix()`; `mix()` pre-computes the hex.)

/**
 * Value-ramp fill at normalized position `t`. PURE and order-respecting:
 * `t=0` → exactly `low`, `t=1` → exactly `high`, no sorting or intent
 * correction. `low`/`high` are resolved hex (the caller maps colour names →
 * palette hex). A straight sRGB fade between the two palette colours — no
 * synthetic midpoint hue. `_opts` is retained for call-site/theme compat.
 */
export function valueRampColor(
  low: string,
  high: string,
  t: number,
  _opts: { isDark: boolean }
): string {
  const tc = Math.max(0, Math.min(1, t));
  return mix(high, low, tc * 100);
}

/**
 * Gradient stops that reproduce `valueRampColor` for a legend
 * `<linearGradient>`. A direct two-endpoint fade needs only the two stops; the
 * gradient itself interpolates between the palette colours.
 */
export function valueRampStops(
  low: string,
  high: string,
  _opts: { isDark: boolean }
): ReadonlyArray<{ offset: number; color: string }> {
  return [
    { offset: 0, color: low },
    { offset: 1, color: high },
  ];
}

// ============================================================
// Contrast / Accessibility
// ============================================================

/** WCAG 2.1 relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;

  const [r, g, b] = [
    parseInt(full.substring(0, 2), 16) / 255,
    parseInt(full.substring(2, 4), 16) / 255,
    parseInt(full.substring(4, 6), 16) / 255,
  ].map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.1 contrast ratio between two colors. (L_lighter + 0.05) / (L_darker + 0.05).
 * Range: 1.0 (identical) to 21.0 (black on white). Internal helper used by
 * `contrastText`'s pastel branch.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Pick `lightText` or `darkText` for placement on top of `bg`.
 *
 * Three-tier decision:
 *  1. **High-luminance fill (luminance > 0.55)** → `darkText`. Yellows, peaches,
 *     light cyans — dark text reads better and a light cream on light yellow is
 *     unreadable.
 *  2. **Pastel fill (min RGB channel ≥ 100, luminance ≤ 0.55)** → defer to WCAG
 *     ratio. Pastels have no near-zero channel and tend to read as "soft" —
 *     dark text usually wins by ratio (catppuccin dark mauve `#cba6f7` min 166,
 *     ratio 9.35:1; tokyo-night dark red `#f7768e` min 118, ratio 7.86:1; and
 *     tokyo-night green `#9ece6a` min 106, ratio 11.4:1 all correctly pick dark).
 *  3. **Saturated fill (min RGB < 100, luminance ≤ 0.55)** → `lightText`. At least
 *     one channel near zero signals true saturation — gruvbox dark green
 *     `#b8bb26` (min 38), blueprint blue `#1f5e8c` (min 31), bold red/blue
 *     (min 0), solarized blue `#268bd2` (min 38). The user consistently
 *     prefers light text on these for visual punch.
 *
 * `min RGB` discriminates pastel-vs-saturated more reliably than `max-min`
 * (vibrance): tokyo-night and catppuccin dark are pastels with high max RGB,
 * so vibrance alone misclassifies them as "saturated."
 *
 * Tinted fills (luminance ~0.7+ in light themes / ~0.02–0.14 in dark themes)
 * are unambiguous in either branch; only solid-fill output shifts here.
 */
export function contrastText(
  bg: string,
  lightText: string,
  darkText: string
): string {
  const L = relativeLuminance(bg);
  if (L > 0.55) return darkText;
  const raw = bg.replace('#', '');
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);
  const minRgb = Math.min(r, g, b);
  if (minRgb >= 100) {
    // Pastel: defer to WCAG ratio (almost always picks dark for these).
    return contrastRatio(bg, darkText) > contrastRatio(bg, lightText)
      ? darkText
      : lightText;
  }
  // Truly saturated: prefer light text for visual punch.
  return lightText;
}

// ============================================================
// Shape Fill (canonical tinted fill)
// ============================================================

/**
 * Canonical tinted shape fill: 25% intent color + 75% surface.
 * Use for any "tinted intent shape" — graph nodes, kanban cards,
 * journey-map shapes, infra severity, ECharts pie/funnel/bar/etc.
 *
 * NOT for subtle-neutral shapes (use the existing 5-10% inline formula
 * for "recede when no intent" cases — infra normal-state, untagged
 * boxes, no-color sequence participants).
 *
 * Sankey is the only documented exception (75/45% custom desaturation).
 *
 * `opts.solid` (per `option solid-fill`): bypass the 25% tint and return
 * the raw intent. Opt-in only; default behavior unchanged.
 */
export function shapeFill(
  palette: PaletteColors,
  intent: string,
  isDark: boolean,
  opts?: { solid?: boolean }
): string {
  if (opts?.solid) return intent;
  return mix(intent, isDark ? palette.surface : palette.bg, 25);
}

// ============================================================
// Series Colors
// ============================================================

/**
 * Derive the 8-color series rotation from a palette's named colors, in the
 * shared {@link CATEGORICAL_COLOR_ORDER} (RGB-seeded, max-contrast). Tag
 * swatches and chart series colors thus share one canonical rotation.
 */
export function getSeriesColors(palette: PaletteColors): string[] {
  const c = palette.colors;
  return CATEGORICAL_COLOR_ORDER.map((name) => c[name]!);
}

/**
 * Generate `count` visually distinct colors for segment-based charts
 * (pie, doughnut, polar-area).
 *
 * Stays ON-PALETTE: the first pass is the palette's own series hues at full
 * strength. When a chart needs more segments than the palette has distinct
 * hues, additional passes reuse the SAME hues at shifted lightness — each a
 * tint (mixed toward `bg`) or shade (mixed toward `text`) of a true palette
 * colour. Hue is never rotated or invented; extra segments read as lighter /
 * darker variants of the palette, not as wheel-generated colours.
 *
 * (Several palettes have duplicate hex for different named colours — e.g.
 * teal===cyan — so the first pass is deduped before the lightness bands kick in.)
 */
export function getSegmentColors(
  palette: PaletteColors,
  count: number
): string[] {
  if (count <= 0) return [];
  const base = [...new Set(getSeriesColors(palette))];
  if (count <= base.length) return base.slice(0, count);

  // Lightness bands of the SAME hues — alternating tint/shade, progressively
  // stronger. Mixing toward the neutral bg/text keeps hue, varying only
  // lightness/saturation (a tint/fade). Symmetric across light & dark themes:
  // `bg` is light/dark and `text` is its inverse, so the two directions always
  // diverge.
  const { bg, text } = palette;
  const variants: ReadonlyArray<(c: string) => string> = [
    (c) => mix(c, bg, 55), // lighter
    (c) => mix(c, text, 55), // darker
    (c) => mix(c, bg, 35),
    (c) => mix(c, text, 35),
  ];

  const out = [...base];
  for (let w = 0; out.length < count; w++) {
    const variant = variants[w % variants.length]!;
    for (const c of base) {
      if (out.length >= count) break;
      out.push(variant(c));
    }
  }
  return out.slice(0, count);
}

// ============================================================
// Political map fills (map colorize, §24B)
// ============================================================

/** Mix-toward-surface bands (% of the raw swatch retained) for political fills,
 *  mode-aware. Colorize fills must stay ON-PALETTE — they're soft tints of the
 *  palette's OWN named hues, not wheel-generated colours. The retained-% is kept
 *  clear of the water backdrop's own blue tint (WATER_TINT_*), so a country fill
 *  never coincides with the ocean. The first band is the normal soft tint; later
 *  bands only come into play if a map needs more colours than the palette has
 *  distinct land hues (rare — first-fit coloring needs ≤6 on the shipped graphs). */
const POLITICAL_TINT_BANDS = {
  light: [32, 48, 64, 80],
  dark: [44, 58, 72, 86],
} as const;

/**
 * Generate `count` political-fill tints from the active palette's OWN hues
 * (§24B colorize). Each is a palette swatch softened toward the surface, so the
 * fills always read as that palette (Atlas tints look like Atlas, not neon wheel
 * samples). Hues are ordered LAND-FIRST — blue/cyan (the ocean-adjacent hues) go
 * last, so country fills never read as water; they are only reached if a map
 * needs >6 colours (it never does — first-fit needs ≤6, palettes ship ≥6 land
 * hues). `count` distinct colours come from walking the deduped hues; if more are
 * needed, additional lightness BANDS of the same hues are appended (still
 * on-palette). Deterministic; resvg-safe (hex out).
 */
export function politicalTints(
  palette: PaletteColors,
  count: number,
  isDark: boolean
): string[] {
  if (count <= 0) return [];
  const base = isDark ? palette.surface : palette.bg;
  const c = palette.colors;
  // Land-first: greens/earth tones lead; water-like blue & cyan trail.
  const swatches = [
    ...new Set([
      c.green,
      c.yellow,
      c.orange,
      c.purple,
      c.red,
      c.teal,
      c.cyan,
      c.blue,
    ]),
  ];
  const bands = isDark ? POLITICAL_TINT_BANDS.dark : POLITICAL_TINT_BANDS.light;
  const out: string[] = [];
  for (const pct of bands) {
    if (out.length >= count) break;
    for (const s of swatches) out.push(mix(s, base, pct));
  }
  return out.slice(0, count);
}
