import type { PaletteColors } from './types';

// ============================================================
// HSL Conversion
// ============================================================

/** Convert hex (#RRGGBB or #RGB) to { h, s, l } with h in degrees, s/l as percentages. */
export function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const raw = hex.replace('#', '');
  const full =
    raw.length === 3
      ? raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2]
      : raw;

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
  const full =
    raw.length === 3
      ? raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2]
      : raw;

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
    const full =
      raw.length === 3
        ? raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2]
        : raw;
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
  const parse = (h: string) => {
    const r = h.replace('#', '');
    const f = r.length === 3 ? r[0] + r[0] + r[1] + r[1] + r[2] + r[2] : r;
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
// Contrast / Accessibility
// ============================================================

/** WCAG 2.1 relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const raw = hex.replace('#', '');
  const full =
    raw.length === 3
      ? raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2]
      : raw;

  const srgb = [
    parseInt(full.substring(0, 2), 16) / 255,
    parseInt(full.substring(2, 4), 16) / 255,
    parseInt(full.substring(4, 6), 16) / 255,
  ].map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/**
 * WCAG 2.1 contrast ratio between two colors. (L_lighter + 0.05) / (L_darker + 0.05).
 * Range: 1.0 (identical) to 21.0 (black on white). Internal helper used by
 * `contrastText`'s pastel branch.
 */
function contrastRatio(a: string, b: string): number {
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
 *     `#b8bb26` (min 38), one-dark blue `#4078f2` (min 64), bold red/blue
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
  const full =
    raw.length === 3
      ? raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2]
      : raw;
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

/** Derive the 8-color series rotation from a palette's named colors. */
export function getSeriesColors(palette: PaletteColors): string[] {
  const c = palette.colors;
  return [c.blue, c.green, c.yellow, c.orange, c.purple, c.red, c.teal, c.cyan];
}

/**
 * Generate `count` visually distinct colors for segment-based charts
 * (pie, doughnut, polar-area).
 *
 * Problem: several palettes have duplicate hex values for different named
 * colors (e.g. Solarized teal===cyan, One Dark orange===yellow), and the
 * 8-color modulo cycle repeats when there are more than 8 segments.
 *
 * Solution: generate evenly-spaced hues using the palette's characteristic
 * saturation and lightness, guaranteeing every segment gets a unique,
 * perceptually distinct color regardless of segment count.
 */
export function getSegmentColors(
  palette: PaletteColors,
  count: number
): string[] {
  const base = getSeriesColors(palette);
  const unique = [...new Set(base)];
  const hsls = unique.map(hexToHSL);

  const avgS = Math.round(hsls.reduce((s, c) => s + c.s, 0) / hsls.length);
  const avgL = Math.round(hsls.reduce((s, c) => s + c.l, 0) / hsls.length);

  // Start from the palette's blue hue (first in series) for consistency
  const startHue = hsls[0].h;
  const step = 360 / count;

  return Array.from({ length: count }, (_, i) =>
    hslToHex(Math.round((startHue + i * step) % 360), avgS, avgL)
  );
}
