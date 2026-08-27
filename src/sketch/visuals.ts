// ============================================================
// Sketch — the visual weights, in one exported place
// ============================================================
//
// 🔴 These were `const`s private to `renderer.ts`, which was fine while dgmo
// was the only thing drawing a sketch. The app's live canvas draws the same
// chart type and had its own set — so a sketch looked like one diagram while
// you edited it and a different one once it was exported: open-V arrowheads
// against filled ones, a 13px edge label against 12, a container at the same
// corner radius as a node, no title at all. Exported so there is one answer,
// and so the app cites it rather than restating the number (2026-08-27).
//
// `renderer.ts` imports these; it does not keep a second copy.

import {
  CARD_RADIUS,
  CONTAINER_LABEL_FONT_SIZE,
  CONTAINER_RADIUS,
  EDGE_STROKE_WIDTH,
  HEADER_HEIGHT,
  LABEL_FONT_SIZE,
  META_FONT_SIZE,
  NODE_STROKE_WIDTH,
} from '../utils/visual-conventions';

export const SKETCH_VISUALS = {
  /** Air round the whole diagram. */
  diagramPadding: 20,
  /** Title baseline, from the top of the drawing. */
  titleY: 32,
  titleFontSize: 18,
  titleFontWeight: 700,
  // 🔴 SHARED, not overridden. These read 2 and 2 against the conventions'
  // 1.5, under a comment claiming "a bolder, less-washed look" — and the
  // boldness was the complaint: a sketch beside a boxes-and-lines or an org
  // chart of the same content did not look like the same product (2026-08-27).
  // Sketch is not in the deviation list `visual-conventions.ts` keeps, either,
  // so the override was drift rather than a decision anyone had recorded.
  nodeStrokeWidth: NODE_STROKE_WIDTH,
  edgeStrokeWidth: EDGE_STROKE_WIDTH,
  /** Arrowhead marker box. It is a FILLED polygon, not an open V. */
  arrowheadW: 18,
  arrowheadH: 12,
  dash: '6 3',
  /** A card's name. Shared, and it fits DOWN to `nodeLabelFontSizeMin` before
   *  it wraps — it used to be allowed up to 30 on a card with no rows, which is
   *  more than twice what any other chart type prints. */
  nodeLabelFontSize: LABEL_FONT_SIZE,
  nodeLabelFontSizeMin: 11,
  /** A card's description rows. */
  cardMetaFontSize: META_FONT_SIZE,
  /** A card's header band. */
  cardHeaderHeight: HEADER_HEIGHT,
  // 🔴 A container's own name: shared size, and `600` is what boxes-and-lines
  // gives the same object (org gives it bold). It was 19 at weight 800 behind
  // 0.55 opacity — bigger than a node's name, and the only container label in
  // the product that was faded.
  bandLabelFontSize: CONTAINER_LABEL_FONT_SIZE,
  bandLabelFontWeight: 600,
  bandLabelOpacity: 1,
  edgeLabelFontSize: 12,
  /** The `palette.bg` halo painted under an edge label so the connector cannot
   *  cross its glyphs. Stroke, with `paint-order: stroke`. */
  edgeLabelHaloWidth: 3,
  cardRadius: CARD_RADIUS,
  containerRadius: CONTAINER_RADIUS,
} as const;
