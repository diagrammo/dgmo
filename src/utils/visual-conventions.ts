// ============================================================
// Visual conventions — shared card/group/collapse constants (Story 111.1)
// ============================================================
//
// Single source of truth for the structured-diagram visual constants described
// in docs/architecture/diagram-visual-conventions.md. Before this module these
// values were re-declared in every renderer (NODE_STROKE_WIDTH in 13 files,
// HEADER_HEIGHT in 12, ...), so a convention change meant editing N files and
// hoping the snapshots agreed.
//
// Two tiers, because the renderers do NOT all agree:
//
//   1. UNIVERSAL — identical at every call site. Import these everywhere; never
//      re-declare. Changing one of these is a deliberate cross-chart change.
//
//   2. CONVENTION DEFAULTS — the org/sitemap baseline from the convention. Most
//      card-shaped renderers match these and should import them. A few have a
//      DOCUMENTED intentional deviation and keep a local override (with a
//      comment saying why):
//        - infra: META_FONT_SIZE 10 / META_LINE_HEIGHT 14 (denser meta rows)
//        - boxes-and-lines: COLLAPSE_BAR_HEIGHT 4 / SEPARATOR_GAP 4
//        - cycle, raci: HEADER_HEIGHT 36 (not label+meta cards)
//      Those overrides are the exception that proves the rule — they stay local
//      and visible, not hidden inside a re-declared full constant set.

// ── Universal (same value at every site) ──

/** Node card + group border stroke width. */
export const NODE_STROKE_WIDTH = 1.5;
/** Edge / connector stroke width. */
export const EDGE_STROKE_WIDTH = 1.5;
/** Node card corner radius. */
export const CARD_RADIUS = 6;
/** Group / container corner radius. */
export const CONTAINER_RADIUS = 8;
/** Collapse accent bar horizontal inset from the card edges. */
export const COLLAPSE_BAR_INSET = 0;
/**
 * Opacity of the `palette.bg` rect knocked out behind an edge label that sits
 * on its own connector.
 *
 * It is not fully opaque because the label may lie over a tinted group
 * container, and a hard patch of page background there reads as a hole. What it
 * must NOT do is leave enough of the connector showing to cross the glyphs:
 * boxes-and-lines used 0.72 and the line landed on the baseline band, so every
 * edge label rendered looking struck through. Flowchart, infra and
 * boxes-and-lines each carried a different guess (0.85 / 0.9 / 0.72); this is
 * the one value, taken from the strongest of the three.
 */
export const EDGE_LABEL_KNOCKOUT_OPACITY = 0.9;

// ── Convention defaults (org/sitemap baseline; see deviations above) ──

/** Node card header band height. */
export const HEADER_HEIGHT = 28;
/** Node card label font size. */
export const LABEL_FONT_SIZE = 13;
/** Node card metadata-row font size. */
export const META_FONT_SIZE = 11;
/** Node card metadata-row line height. */
export const META_LINE_HEIGHT = 16;
/** Gap between the header separator and the first metadata row. */
export const SEPARATOR_GAP = 6;
/** Collapse accent bar height. */
export const COLLAPSE_BAR_HEIGHT = 6;

/** Group / container reserved header band height. */
export const CONTAINER_HEADER_HEIGHT = 28;
/** Group / container label font size. */
export const CONTAINER_LABEL_FONT_SIZE = 13;
/** Group / container metadata-row font size. */
export const CONTAINER_META_FONT_SIZE = 11;
/** Group / container metadata-row line height. */
export const CONTAINER_META_LINE_HEIGHT = 16;
