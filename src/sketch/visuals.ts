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
  TITLE_FONT_SIZE as SHARED_TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT as SHARED_TITLE_FONT_WEIGHT,
  TITLE_Y as SHARED_TITLE_Y,
} from '../utils/title-constants';
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
  // 🔴 SHARED, not a second answer. Sketch printed its title at 18/y-32 while
  // every other chart type used 20/y-30 from `utils/title-constants` — so two
  // diagrams of the same content, side by side, did not even agree on how big
  // their own name was (2026-08-27, #518).
  titleY: SHARED_TITLE_Y,
  titleFontSize: SHARED_TITLE_FONT_SIZE,
  titleFontWeight: Number(SHARED_TITLE_FONT_WEIGHT),
  // 🔴 SHARED, not overridden. These read 2 and 2 against the conventions'
  // 1.5, under a comment claiming "a bolder, less-washed look" — and the
  // boldness was the complaint: a sketch beside a boxes-and-lines or an org
  // chart of the same content did not look like the same product (2026-08-27).
  // Sketch is not in the deviation list `visual-conventions.ts` keeps, either,
  // so the override was drift rather than a decision anyone had recorded.
  nodeStrokeWidth: NODE_STROKE_WIDTH,
  edgeStrokeWidth: EDGE_STROKE_WIDTH,
  // 🔴 A FILLED polygon, not an open V — and sized in STROKE-WIDTHS, like every
  // other chart type. These read 18×12 in USER SPACE, which is 2.4× the ink
  // boxes-and-lines puts on the same 1.5px connector, and it was the loudest
  // single difference between the two pictures (#518). `markerUnits` defaults
  // to `strokeWidth`, so 5×4 here renders 7.5×6 — the same triangle
  // boxes-and-lines draws.
  arrowheadW: 5,
  arrowheadH: 4,
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
  // 🔴 SHARED, and it stays shared even though boxes-and-lines prints 14 here.
  // Going to 14 to match it was tried and reverted (#518): `sketch` keeps the
  // rule that a container's name is never LOUDER than the names inside it, and
  // one point is imperceptible next to the differences that actually made the
  // two pictures look like different products (footprint, arrowheads, title).
  // boxes-and-lines' 14 — and infra's — are the undocumented deviations here;
  // the fix is those two coming to 13, not a third chart type leaving.
  bandLabelFontSize: CONTAINER_LABEL_FONT_SIZE,
  bandLabelFontWeight: 600,
  bandLabelOpacity: 1,
  /** 11 — what boxes-and-lines prints. It was 12, the only edge label in the
   *  product at that size. */
  edgeLabelFontSize: 11,
  /** The `palette.bg` halo painted under an edge label so the connector cannot
   *  cross its glyphs. Stroke, with `paint-order: stroke`. */
  edgeLabelHaloWidth: 3,
  cardRadius: CARD_RADIUS,
  containerRadius: CONTAINER_RADIUS,
} as const;
