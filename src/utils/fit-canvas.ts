// ============================================================
// Diagram → canvas fit
// ============================================================
// Shared by renderers that top-anchor a diagram and fit it to the
// canvas with the same scale model. Each renderer with a *different*
// model (legend-band reserves, vertical centering, content-padded
// scale) keeps its own math on purpose — this is only for the ones
// that were byte-identical.

export interface CanvasFit {
  scale: number;
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
  if (p.exportMode) {
    scale = Math.min(p.maxScale, scaleX);
    canvasHeight = p.titleHeight + p.diagramH * scale + p.padding * 2;
  } else {
    const availH = p.height - p.titleHeight;
    const scaleY = (availH - p.padding * 2) / p.diagramH;
    scale = Math.min(p.maxScale, scaleX, scaleY);
    canvasHeight = p.height;
  }
  const scaledW = p.diagramW * scale;
  return {
    scale,
    offsetX: (p.width - scaledW) / 2,
    offsetY: p.titleHeight + p.padding,
    canvasHeight,
  };
}
