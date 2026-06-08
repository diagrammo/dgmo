// ============================================================
// Generic diagram note — canvas shift
// ============================================================
//
// A note floated above/left of its node can land at negative coordinates.
// After a chart computes its content bbox (INCLUDING note rects), it passes
// the bbox min corner here to learn how much to translate every node, edge,
// and group so nothing clips on export. Charts with no off-canvas note get
// `{shiftX:0, shiftY:0}` and stay byte-for-byte unchanged.

export interface NoteCanvasShift {
  readonly shiftX: number;
  readonly shiftY: number;
}

/**
 * Translation needed to bring content that ran off the top/left back into
 * the canvas with a `margin` gutter. Only shifts when a min coord is
 * negative; otherwise returns 0 on that axis.
 */
export function noteCanvasShift(
  minX: number,
  minY: number,
  margin = 20
): NoteCanvasShift {
  return {
    shiftX: minX < 0 ? margin - minX : 0,
    shiftY: minY < 0 ? margin - minY : 0,
  };
}
