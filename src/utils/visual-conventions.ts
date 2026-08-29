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

/**
 * Arrowhead marker box, in the marker's own units.
 *
 * `markerUnits` is left at the SVG default (`strokeWidth`) everywhere, so the
 * head a reader sees is these numbers times the edge's stroke width — 15 x 10.5
 * at the conventional 1.5. Eleven chart types each declared their own box
 * until 2026-08-28 (5x4 sketch, 8x8 sequence, 9x6.4 swimlane, 12x8 class, a
 * computed float in cycle), so a head was between 7.5 and 18 units wide
 * depending on which chart you were looking at.
 */
export const ARROWHEAD_WIDTH = 10;
export const ARROWHEAD_HEIGHT = 7;

// ── Dash patterns ──
//
// Three roles, three patterns, one separator. The corpus carried NINE
// patterns before 2026-08-28 — `6 3`, `6 4`, `4 4`, `3 3`, `5 4`, `5 5`,
// `3 4`, `2 3`, `1 4`, `2 6`, `3 2`, `2 4` — plus `4,4`, `4,3` and `4,2`
// written with a comma where every other site used a space. Nothing
// distinguished them; they were each a fresh guess at the same three jobs.

/**
 * A connector that is not a hard link: async, implements, depends,
 * reference, a back edge, a divorced union, a not-yet-scheduled card.
 */
export const EDGE_DASH = '6 3';
/** Background rules — grid lines, axis guides, reference lines, era edges. */
export const GRID_DASH = '4 4';
/** Fine dotted trails: tick guides, leader lines, activation gaps. */
export const HAIRLINE_DASH = '2 3';

/**
 * Scale a dash pattern with a ScaleContext-style factor, keeping the SPACE
 * separator. `arc`, `slope` and `timeline` each built theirs by hand as
 * `${a},${b}` — legal SVG, but the only three comma-separated patterns in the
 * product, so a sweep for a dash pattern missed them.
 */
export function scaleDash(
  pattern: string,
  scale: (n: number) => number
): string {
  return pattern
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((n) => scale(Number(n)))
    .join(' ');
}

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
