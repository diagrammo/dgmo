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

import { CARD_RADIUS, CONTAINER_RADIUS } from '../utils/visual-conventions';

export const SKETCH_VISUALS = {
  /** Air round the whole diagram. */
  diagramPadding: 20,
  /** Title baseline, from the top of the drawing. */
  titleY: 32,
  titleFontSize: 18,
  titleFontWeight: 700,
  /** Sketch overrides the shared weights for a bolder, less-washed look. */
  nodeStrokeWidth: 2,
  edgeStrokeWidth: 2,
  /** Arrowhead marker box. It is a FILLED polygon, not an open V. */
  arrowheadW: 18,
  arrowheadH: 12,
  dash: '6 3',
  bandLabelFontSize: 19,
  bandLabelOpacity: 0.55,
  edgeLabelFontSize: 12,
  /** The `palette.bg` halo painted under an edge label so the connector cannot
   *  cross its glyphs. Stroke, with `paint-order: stroke`. */
  edgeLabelHaloWidth: 3,
  cardRadius: CARD_RADIUS,
  containerRadius: CONTAINER_RADIUS,
} as const;
