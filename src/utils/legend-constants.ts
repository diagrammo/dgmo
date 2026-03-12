// ============================================================
// Shared legend rendering constants
// All renderers import from here to stay in sync.
// ============================================================

export const LEGEND_HEIGHT = 28;
export const LEGEND_PILL_PAD = 16;
export const LEGEND_PILL_FONT_SIZE = 11;
export const LEGEND_PILL_FONT_W = LEGEND_PILL_FONT_SIZE * 0.6;
export const LEGEND_CAPSULE_PAD = 4;
export const LEGEND_DOT_R = 4;
export const LEGEND_ENTRY_FONT_SIZE = 10;
export const LEGEND_ENTRY_FONT_W = LEGEND_ENTRY_FONT_SIZE * 0.6;
export const LEGEND_ENTRY_DOT_GAP = 4;
export const LEGEND_ENTRY_TRAIL = 8;
export const LEGEND_GROUP_GAP = 12;
export const LEGEND_EYE_SIZE = 14;
export const LEGEND_EYE_GAP = 6;

// Eye icon SVG paths (14×14 viewBox)
// Present only in org and sitemap legends (metadata visibility toggle)
export const EYE_OPEN_PATH =
  'M1 7s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z M7 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z';
export const EYE_CLOSED_PATH =
  'M2.5 2.5l9 9 M1.5 7s2.2-4 5.5-4c1.2 0 2.2.5 3 1.1 M12.5 7s-2.2 4-5.5 4c-1.2 0-2.2-.5-3-1.1';
