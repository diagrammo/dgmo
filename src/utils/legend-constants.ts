// ============================================================
// Shared legend rendering constants
// All renderers import from here to stay in sync.
// ============================================================

export const LEGEND_HEIGHT = 28;
export const LEGEND_PILL_PAD = 16;
export const LEGEND_PILL_FONT_SIZE = 11;
export const LEGEND_CAPSULE_PAD = 4;
export const LEGEND_DOT_R = 4;
export const LEGEND_ENTRY_FONT_SIZE = 10;
export const LEGEND_ENTRY_DOT_GAP = 4;
export const LEGEND_ENTRY_TRAIL = 8;
export const LEGEND_GROUP_GAP = 12;
export const LEGEND_EYE_SIZE = 14;
export const LEGEND_EYE_GAP = 6;
export const LEGEND_ICON_W = 20;

export const LEGEND_MAX_ENTRY_ROWS = 3;

// ── Chrome colors ────────────────────────────────────────────
// Capsule/pill background + border used by BOTH legend emitters
// (legend-d3.ts DOM view and legend-svg.ts string view). Single source
// so the two paths can't drift: light palettes have surface ≈ bg, so
// blending toward bg yields no visible container — darken past surface
// toward the muted neutral (guaranteed darker in every palette) so the
// tag group reads as a contained area.
import { mix } from '../palettes/color-utils';

export function legendChromeColors(
  palette: { bg: string; surface: string; textMuted: string },
  isDark: boolean
): { groupBg: string; pillBorder: string } {
  return {
    groupBg: isDark
      ? mix(palette.surface, palette.bg, 50)
      : mix(palette.surface, palette.textMuted, 98),
    pillBorder: mix(palette.textMuted, palette.bg, 50),
  };
}

// ── Proportional text measurement ────────────────────────────
// The canonical glyph-table measurer now lives in `./text-measure`.
// Re-exported here under the legacy names so existing legend call
// sites keep working; new code should import from `./text-measure`.
import { measureText, truncateText } from './text-measure';

/** @deprecated import `measureText` from `./text-measure`. */
export const measureLegendText = measureText;
/** @deprecated import `truncateText` from `./text-measure`. */
export const truncateLegendText = truncateText;

// Eye icon SVG paths (14×14 viewBox)
// Present only in org and sitemap legends (metadata visibility toggle)
export const EYE_OPEN_PATH =
  'M1 7s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z M7 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z';
export const EYE_CLOSED_PATH =
  'M2.5 2.5l9 9 M1.5 7s2.2-4 5.5-4c1.2 0 2.2.5 3 1.1 M12.5 7s-2.2 4-5.5 4c-1.2 0-2.2-.5-3-1.1';

// ── Controls group constants ────────────────────────────────
// Gear/cog icon (14×14 viewBox) — 6 flat teeth with center hole
// Computed from polar coordinates: outerR=5.5, innerR=3.5, holeR=2, center=(7,7)
// Uses evenodd fill-rule for the center hole
export const CONTROLS_ICON_PATH =
  'M5.6 1.7L8.4 1.7L7.9 3.6L9.5 4.5L10.9 3.1L12.3 5.6L10.4 6.1L10.4 7.9L12.3 8.4L10.9 10.9L9.5 9.5L7.9 10.4L8.4 12.3L5.6 12.3L6.1 10.4L4.5 9.5L3.1 10.9L1.7 8.4L3.6 7.9L3.6 6.1L1.7 5.6L3.1 3.1L4.5 4.5L6.1 3.6Z' +
  'M5 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0Z';
export const LEGEND_TOGGLE_DOT_R = LEGEND_DOT_R;
export const LEGEND_TOGGLE_OFF_OPACITY = 0.4;
export const LEGEND_GEAR_PILL_W = 14 + LEGEND_PILL_PAD; // gear icon (14) + padding
