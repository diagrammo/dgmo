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
 * Derive a muted (desaturated, darkened) variant of a color.
 * Used by the Mermaid theme generator for dark-mode fills.
 *
 * Algorithm: cap saturation at 35% and lightness at 36%.
 */
export function mute(hex: string): string {
  const { h, s, l } = hexToHSL(hex);
  return hslToHex(h, Math.min(s, 35), Math.min(l, 36));
}

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
 * Pick a text color that contrasts against `bg`.
 * Returns `darkText` when background is light (luminance > 0.179),
 * `lightText` when background is dark.
 * Threshold 0.179 is the standard WCAG midpoint for the contrast flip.
 */
export function contrastText(
  bg: string,
  lightText: string,
  darkText: string
): string {
  return relativeLuminance(bg) > 0.179 ? darkText : lightText;
}

// ============================================================
// Series Colors
// ============================================================

/** Derive the 8-color series rotation from a palette's named colors. */
export function getSeriesColors(palette: PaletteColors): string[] {
  const c = palette.colors;
  return [c.blue, c.green, c.yellow, c.orange, c.purple, c.red, c.teal, c.cyan];
}
