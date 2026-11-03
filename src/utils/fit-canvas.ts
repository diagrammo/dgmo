// ============================================================
// Diagram → canvas fit
// ============================================================
// Shared by renderers that top-anchor a diagram and fit it to the
// canvas with the same scale model. Each renderer with a *different*
// model (legend-band reserves, vertical centering, content-padded
// scale) keeps its own math on purpose — this is only for the ones
// that were byte-identical.

/**
 * Narrowest canvas an export will produce. A diagram whose content is thinner
 * than this keeps the dead margin rather than becoming a sliver — and its type
 * stays in the band the other sparse chart types occupy (class 420, block 428).
 * Shared with `charts-d3/natural-size.ts`, which floors its own widths here.
 */
export const MIN_CANVAS_WIDTH = 480;

/**
 * The smallest size text may draw at in an export, after scaling. Below it a
 * label is unreadable at the export's own size, so the canvas grows instead.
 * `MIN_FONT_PX` in `tests/stress/lint.ts` measures the same floor.
 */
export const MIN_DRAWN_TEXT_PX = 7;

export interface CanvasFit {
  scale: number;
  /**
   * Canvas width — the scaled content plus padding. Wider than asked only when
   * `smallestTextPx` holds the scale above what the width would fit.
   */
  canvasWidth: number;
  offsetX: number;
  offsetY: number;
  canvasHeight: number;
}

export interface FitDiagramParams {
  /** Canvas width. */
  width: number;
  /** Canvas height (interactive pane height; ignored for canvasHeight in export mode). */
  height: number;
  /** Laid-out diagram width / height. */
  diagramW: number;
  diagramH: number;
  /** Scaled padding around the diagram. */
  padding: number;
  /** Reserved height above the diagram (title band), 0 if none. */
  titleHeight: number;
  /** Upper bound on scale. */
  maxScale: number;
  /**
   * Smallest font size drawn inside the scaled content. In export mode the scale
   * never takes it below `MIN_DRAWN_TEXT_PX`. Omit to fit to the width alone.
   */
  smallestTextPx?: number;
  /** True when rendering to a fixed export canvas. */
  exportMode: boolean;
}

/**
 * Fit a top-anchored diagram into the canvas.
 *
 * Export renders a fixed canvas (e.g. 1200×800); fitting a small graph into it
 * and top-anchoring leaves a tall dead band below. In export mode we scale to
 * width (capped by maxScale) and size the canvas to the scaled content height.
 * The interactive preview keeps fit-to-pane (min of width/height scale) so a
 * small graph still fills its pane.
 */
export function fitDiagramToCanvas(p: FitDiagramParams): CanvasFit {
  const scaleX = (p.width - p.padding * 2) / p.diagramW;
  let scale: number;
  let canvasHeight: number;
  let canvasWidth: number;
  if (p.exportMode) {
    // Never enlarge on export. It used to scale to width capped at `maxScale`,
    // which for a narrow diagram meant inflating it to fill a canvas it had no
    // business filling — `flowchart-basic` is four nodes in a vertical stack,
    // and it came out at scale 3 on a 1200x1670 sheet, so a declared
    // `font-size: 13` rendered at 39 and the apparent size of its text moved
    // with the canvas instead of with the diagram (#532).
    //
    // Never shrink text under the floor either. Twelve nodes on one rank fitted
    // to 1200 drew every label under 7px and left the sheet half empty (#1688).
    // The width gives way instead: the viewer scrolls and zooms.
    const minScale = p.smallestTextPx
      ? MIN_DRAWN_TEXT_PX / p.smallestTextPx
      : 0;
    scale = Math.max(Math.min(p.maxScale, scaleX, 1), minScale);
    canvasHeight = p.titleHeight + p.diagramH * scale + p.padding * 2;
    canvasWidth = Math.round(
      Math.min(
        scale > scaleX ? Infinity : p.width,
        Math.max(MIN_CANVAS_WIDTH, p.diagramW * scale + p.padding * 2)
      )
    );
  } else {
    const availH = p.height - p.titleHeight;
    const scaleY = (availH - p.padding * 2) / p.diagramH;
    scale = Math.min(p.maxScale, scaleX, scaleY);
    canvasHeight = p.height;
    canvasWidth = p.width;
  }
  const scaledW = p.diagramW * scale;
  return {
    scale,
    offsetX: (canvasWidth - scaledW) / 2,
    offsetY: p.titleHeight + p.padding,
    canvasHeight,
    canvasWidth,
  };
}
