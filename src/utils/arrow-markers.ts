// ============================================================
// Shared arrowhead <marker> defs
// ============================================================
// The flowchart and state renderers carried a byte-identical block
// that appends a base arrowhead marker plus one per edge color. This
// is the single source so they can't drift.

import type { BaseType, Selection } from 'd3-selection';

export interface ArrowheadMarkerOptions {
  /** Marker id prefix, e.g. 'fc' → `fc-arrow`, `fc-arrow-<hex>`. */
  idPrefix: string;
  /** Marker width (already scaled by the caller's ScaleContext). */
  width: number;
  /** Marker height. */
  height: number;
  /** Fill for the base (uncolored) arrowhead. */
  baseFill: string;
  /** Edge colors needing their own tinted marker (hex strings). */
  colors?: Iterable<string>;
}

/**
 * Append an arrowhead `<marker>` (id `${idPrefix}-arrow`) to `defs`, plus
 * one tinted marker per edge color (id `${idPrefix}-arrow-<hex-without-#>`).
 */
export function appendArrowheadMarkers<GElement extends BaseType>(
  defs: Selection<GElement, unknown, null, undefined>,
  opts: ArrowheadMarkerOptions
): void {
  const { idPrefix, width, height, baseFill, colors } = opts;
  const appendMarker = (id: string, fill: string): void => {
    defs
      .append('marker')
      .attr('id', id)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('refX', width)
      .attr('refY', height / 2)
      .attr('markerWidth', width)
      .attr('markerHeight', height)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', `0,0 ${width},${height / 2} 0,${height}`)
      .attr('fill', fill);
  };

  appendMarker(`${idPrefix}-arrow`, baseFill);
  for (const color of colors ?? []) {
    appendMarker(`${idPrefix}-arrow-${color.replace('#', '')}`, color);
  }
}

export interface ReverseArrowheadOptions extends ArrowheadMarkerOptions {
  /** Marker id prefix for the reversed head, e.g. 'bl' → `bl-arrow-rev`. */
  reverseSuffix?: string;
}

/**
 * Append a REVERSED arrowhead (`id` = `${idPrefix}-arrow-rev...`), pointing back
 * along the path so it can sit on the start of a bidirectional edge.
 *
 * Same box as {@link appendArrowheadMarkers}: `refX` is 0 rather than `width`,
 * and the polygon is mirrored. boxes-and-lines, class and sketch each carried
 * their own copy of this until 2026-08-28.
 */
export function appendReverseArrowheadMarkers<GElement extends BaseType>(
  defs: Selection<GElement, unknown, null, undefined>,
  opts: ReverseArrowheadOptions
): void {
  const {
    idPrefix,
    width,
    height,
    baseFill,
    colors,
    reverseSuffix = 'arrow-rev',
  } = opts;
  const appendMarker = (id: string, fill: string): void => {
    defs
      .append('marker')
      .attr('id', id)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('refX', 0)
      .attr('refY', height / 2)
      .attr('markerWidth', width)
      .attr('markerHeight', height)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', `${width},0 0,${height / 2} ${width},${height}`)
      .attr('fill', fill);
  };

  appendMarker(`${idPrefix}-${reverseSuffix}`, baseFill);
  for (const color of colors ?? []) {
    appendMarker(
      `${idPrefix}-${reverseSuffix}-${color.replace('#', '')}`,
      color
    );
  }
}
