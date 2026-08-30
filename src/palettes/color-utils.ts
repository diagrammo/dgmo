import { CATEGORICAL_COLOR_ORDER } from '../colors';
import type { PaletteColors } from './types';

// ============================================================
// HSL Conversion
// ============================================================

// Hex parsing is pure and hit repeatedly with a tiny distinct-input set
// (palette swatches); memoize. Capped so pathological inputs can't grow it
// unbounded. Cached entries are copied on the way out so callers can never
// mutate the cache.
const HEX_TO_HSL_CACHE = new Map<string, { h: number; s: number; l: number }>();
const HEX_TO_HSL_CACHE_MAX = 5000;

/** Convert hex (#RRGGBB or #RGB) to { h, s, l } with h in degrees, s/l as percentages. */
export function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const cached = HEX_TO_HSL_CACHE.get(hex);
  if (cached) return { ...cached };

  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;

  const r = parseInt(full.substring(0, 2), 16) / 255;
  const g = parseInt(full.substring(2, 4), 16) / 255;
  const b = parseInt(full.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let result: { h: number; s: number; l: number };
  if (max === min) {
    result = { h: 0, s: 0, l: Math.round(l * 100) };
  } else {
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

    result = {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    };
  }

  if (HEX_TO_HSL_CACHE.size >= HEX_TO_HSL_CACHE_MAX) HEX_TO_HSL_CACHE.clear();
  HEX_TO_HSL_CACHE.set(hex, result);
  return { ...result };
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

// `mix` is the hottest color primitive (~all renderers, tinted fills and
// strokes) and string-parses both operands per call, over a tiny distinct
// argument set. Memoize on the full argument tuple; capped so it can't grow
// unbounded on pathological input.
const MIX_CACHE = new Map<string, string>();
const MIX_CACHE_MAX = 5000;

/**
 * Blend two hex colors by percentage.
 * `pct` = 0 → 100% of `b`, `pct` = 100 → 100% of `a`.
 *
 * Used by all renderers for tinted fills and strokes.
 */
export function mix(a: string, b: string, pct: number): string {
  const key = `${a}|${b}|${pct}`;
  const cached = MIX_CACHE.get(key);
  if (cached !== undefined) return cached;
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
  const out = `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
  if (MIX_CACHE.size >= MIX_CACHE_MAX) MIX_CACHE.clear();
  MIX_CACHE.set(key, out);
  return out;
}

// ============================================================
// Value Ramp (the shared `<metric> <low?> <high?>` coloring convention)
// ============================================================
//
// Single source of truth for value-ramp fills across chart types (map
// `region-heat`, boxes-and-lines `heat`, and any future ramp). Callers
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

// ------------------------------------------------------------
// APCA (Accessible Perceptual Contrast Algorithm)
// ------------------------------------------------------------
// Vendored from apca-w3 0.1.9 — SAPC-APCA, 0.0.98G series, "G-4g"
// constants — © 2019–2022 Andrew Somers / Myndex Research, W3 license,
// https://github.com/Myndex/apca-w3. Forward sRGB path only; constants
// copied verbatim from the package source.

const APCA = {
  mainTRC: 2.4,
  sRco: 0.2126729,
  sGco: 0.7151522,
  sBco: 0.072175,
  normBG: 0.56,
  normTXT: 0.57,
  revTXT: 0.62,
  revBG: 0.65,
  blkThrs: 0.022,
  blkClmp: 1.414,
  scale: 1.14,
  loOffset: 0.027,
  deltaYmin: 0.0005,
  loClip: 0.1,
} as const;

/** APCA screen luminance Y (simple 2.4-exponent linearization, not WCAG's). */
function apcaY(hex: string): number {
  const raw = hex.replace('#', '');
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
  const [r, g, b] = [0, 2, 4].map(
    (i) => (parseInt(full.substring(i, i + 2), 16) / 255) ** APCA.mainTRC
  ) as [number, number, number];
  return APCA.sRco * r + APCA.sGco * g + APCA.sBco * b;
}

/**
 * APCA lightness contrast (Lc) of `text` over `bg`. Signed: positive for
 * dark-on-light, negative for light-on-dark; magnitude is what matters for
 * ranking. |Lc| 60 ≈ fluent reading for bold ~12px text; |Lc| 45 is the
 * floor for large headline weights; 0 is returned for near-identical pairs.
 */
export function apcaContrast(text: string, bg: string): number {
  const clamp = (y: number) =>
    y > APCA.blkThrs ? y : y + (APCA.blkThrs - y) ** APCA.blkClmp;
  const txtY = clamp(apcaY(text));
  const bgY = clamp(apcaY(bg));
  if (Math.abs(bgY - txtY) < APCA.deltaYmin) return 0;
  if (bgY > txtY) {
    const sapc = (bgY ** APCA.normBG - txtY ** APCA.normTXT) * APCA.scale;
    return sapc < APCA.loClip ? 0 : (sapc - APCA.loOffset) * 100;
  }
  const sapc = (bgY ** APCA.revBG - txtY ** APCA.revTXT) * APCA.scale;
  return sapc > -APCA.loClip ? 0 : (sapc + APCA.loOffset) * 100;
}

/**
 * Pick `lightText` or `darkText` for placement on top of `bg`: whichever
 * scores the higher |Lc| under APCA.
 *
 * This replaced a WCAG-ratio three-tier heuristic on 2026-08-11. The WCAG
 * 2.1 ratio formula has a known blind spot on mid-tone fills, preferring
 * dark ink where every eye wants light text — slate light gray `#7e8a97`
 * scores 4.19:1 dark vs 3.35:1 light on WCAG, but Lc 37 dark vs Lc 68
 * light on APCA. 30 of the 154 palette solid fills (7 palettes × 2 modes
 * × 11 intents) got the perceptually weaker token from the old picker.
 *
 * `tests/palette-contrast.test.ts` guards the whole registry: the picker
 * must return the stronger token for every fill, and a fill whose best
 * |Lc| falls under 45 is a palette defect the test names.
 */
export function contrastText(
  bg: string,
  lightText: string,
  darkText: string
): string {
  return Math.abs(apcaContrast(darkText, bg)) >=
    Math.abs(apcaContrast(lightText, bg))
    ? darkText
    : lightText;
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
 * `opts.mode` (spec §1.9 fill family): `'solid'` (`fill-solid`) bypasses the
 * 25% tint and returns the raw intent; `'outline'` (`fill-outline`) returns
 * the theme base background so the intent color rides on the stroke alone.
 * Absent ⇒ the canonical tint.
 */
/**
 * The theme-aware base background a diagram's tinted shapes blend toward:
 * `surface` in dark, page `bg` in light. Concentrates the
 * `isDark ? palette.surface : palette.bg` pick repeated across ~20 renderers
 * (Story 111.3).
 */
export function themeBaseBg(palette: PaletteColors, isDark: boolean): string {
  return isDark ? palette.surface : palette.bg;
}

/**
 * The fill for a GROUP FRAME — the persistent rect wrapping a set of nodes
 * (org containers, boxes-and-lines groups, c4 boundaries, infra groups, pert
 * groups, kanban column headers). `docs/architecture/diagram-visual-conventions.md`
 * §2 states the two branches; this is them, in one place.
 *
 * A frame with no color of its own is neutral grey; a colored one is a 10%
 * tint of that color over the theme base. It lived only in `org/renderer.ts`
 * until 2026-08-30, which is exactly why four charts implemented the first
 * branch and none of them the second (diagrammo/diagrammo#585).
 */
export function groupFill(
  palette: PaletteColors,
  isDark: boolean,
  color?: string
): string {
  if (color) return mix(color, themeBaseBg(palette, isDark), 10);
  return mix(palette.surface, palette.bg, 40);
}

/** The stroke paired with {@link groupFill} — the group's own color, or muted. */
export function groupStroke(palette: PaletteColors, color?: string): string {
  return color ?? palette.textMuted;
}

export function shapeFill(
  palette: PaletteColors,
  intent: string,
  isDark: boolean,
  opts?: { mode?: 'solid' | 'outline' | undefined }
): string {
  if (opts?.mode === 'solid') return intent;
  if (opts?.mode === 'outline') return themeBaseBg(palette, isDark);
  return mix(intent, themeBaseBg(palette, isDark), 25);
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
  const base = themeBaseBg(palette, isDark);
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

/**
 * Era band colours — the five-hue ramp behind a gantt or timeline era.
 *
 * gantt carried its own `ERA_COLORS` array of five raw hexes and timeline used
 * these tokens with the same hexes as a no-palette fallback, so the two charts
 * agreed only under the palette those hexes were sampled from. One function,
 * palette slots, no literals (2026-08-28).
 */
export function getEraColors(palette: PaletteColors): string[] {
  return [
    palette.colors.blue,
    palette.colors.green,
    palette.colors.yellow,
    palette.colors.orange,
    palette.colors.purple,
  ];
}
