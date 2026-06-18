// ============================================================
// Node-card door (Story 111.1)
// ============================================================
//
// The node card described in docs/architecture/diagram-visual-conventions.md §1
// (rect → label → header separator → metadata rows) and the collapse accent bar
// (§3) were hand-rolled inline in every structured-diagram renderer. This module
// owns that drawing behind one interface, mirroring the `renderIntegratedLegend`
// door (utils/legend-integration.ts): the renderer creates its wrapper `<g>` and
// resolves geometry + colors (scaling and palette stay the renderer's job — see
// ScaleContext / 111.3), then makes one call.
//
// Output is byte-identical to the prior inline code: same element order, same
// attributes, same values. Scaled numbers are passed IN (the door never calls
// ScaleContext), so rounding order is unchanged.

import type { D3Sel } from './legend-types';
import { measureText } from './text-measure';

/** One resolved metadata row: a display key (already mapped) and its value. */
export type CardMetaRow = readonly [displayKey: string, value: string];

export interface CardMetaOptions {
  /** Rows in display order. */
  rows: readonly CardMetaRow[];
  /** Scaled metadata font size. */
  fontSize: number;
  /** Scaled metadata line height. */
  lineHeight: number;
  /** Scaled gap between the header separator and the first row baseline. */
  separatorGap: number;
  /** Header separator stroke color (callers pass `solid ? labelColor : stroke`). */
  separatorColor: string;
  /** Fill for both key and value text (node cards use the label color for both). */
  textColor: string;
  /** Left inset for the key column (defaults to 10, the convention value). */
  keyX?: number;
}

export interface NodeCardOptions {
  /** Card width (already laid out). */
  width: number;
  /** Card height (already laid out). */
  height: number;
  /** Scaled corner radius. */
  rx: number;
  /** Resolved card fill. */
  fill: string;
  /** Resolved card stroke. */
  stroke: string;
  /** Scaled stroke width. */
  strokeWidth: number;
  /** Dashed border (e.g. org `isContainer`); uses the `'6 3'` convention pattern. */
  dashed?: boolean;
  /** Label text. */
  label: string;
  /** Resolved label color (also used for metadata text). */
  labelColor: string;
  /** Scaled label font size. */
  labelFontSize: number;
  /** Scaled header band height (positions the label and the separator). */
  headerHeight: number;
  /** Metadata block; omit (or pass empty rows) for a card with no separator/meta. */
  meta?: CardMetaOptions;
}

/**
 * Draw a node card (rect → label → optional separator + metadata rows) into
 * `container` (the renderer's wrapper `<g>`). Reproduces conventions §1 exactly.
 */
export function renderNodeCard(container: D3Sel, opts: NodeCardOptions): void {
  const rect = container
    .append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', opts.width)
    .attr('height', opts.height)
    .attr('rx', opts.rx)
    .attr('fill', opts.fill)
    .attr('stroke', opts.stroke)
    .attr('stroke-width', opts.strokeWidth);

  if (opts.dashed) {
    rect.attr('stroke-dasharray', '6 3');
  }

  container
    .append('text')
    .attr('x', opts.width / 2)
    .attr('y', opts.headerHeight / 2 + opts.labelFontSize / 2 - 2)
    .attr('text-anchor', 'middle')
    .attr('fill', opts.labelColor)
    .attr('font-size', opts.labelFontSize)
    .attr('font-weight', 'bold')
    .text(opts.label);

  const meta = opts.meta;
  if (!meta || meta.rows.length === 0) return;

  container
    .append('line')
    .attr('x1', 0)
    .attr('y1', opts.headerHeight)
    .attr('x2', opts.width)
    .attr('y2', opts.headerHeight)
    .attr('stroke', meta.separatorColor)
    .attr('stroke-opacity', 0.3)
    .attr('stroke-width', 1);

  const keyX = meta.keyX ?? 10;
  const maxKeyWidth = Math.max(
    ...meta.rows.map(([key]) => measureText(`${key}: `, meta.fontSize))
  );
  const valueX = keyX + maxKeyWidth;
  const metaStartY = opts.headerHeight + meta.separatorGap + meta.fontSize;

  for (let i = 0; i < meta.rows.length; i++) {
    const [displayKey, value] = meta.rows[i]!;
    const rowY = metaStartY + i * meta.lineHeight;

    container
      .append('text')
      .attr('x', keyX)
      .attr('y', rowY)
      .attr('fill', meta.textColor)
      .attr('font-size', meta.fontSize)
      .text(`${displayKey}: `);

    container
      .append('text')
      .attr('x', valueX)
      .attr('y', rowY)
      .attr('fill', meta.textColor)
      .attr('font-size', meta.fontSize)
      .text(value);
  }
}

export interface CollapseBarOptions {
  /** Card width. */
  width: number;
  /** Card height (the bar sits at the bottom). */
  height: number;
  /** Scaled bar height. */
  barHeight: number;
  /** Scaled horizontal inset from each edge (usually 0). */
  inset: number;
  /** Scaled corner radius for the clip rect (matches the card). */
  rx: number;
  /** Bar fill (callers pass `solid ? labelColor : stroke`). */
  fill: string;
  /** Unique clip-path id (kept renderer-local to avoid collisions). */
  clipId: string;
  /** Wrapper class for the bar rect (e.g. `org-collapse-bar`). */
  className: string;
}

/**
 * Draw the collapse accent bar (conventions §3) at the bottom of a card,
 * clipped to the card's rounded corners. Reproduces the prior inline code.
 */
export function renderCollapseBar(
  container: D3Sel,
  opts: CollapseBarOptions
): void {
  container
    .append('clipPath')
    .attr('id', opts.clipId)
    .append('rect')
    .attr('width', opts.width)
    .attr('height', opts.height)
    .attr('rx', opts.rx);

  container
    .append('rect')
    .attr('x', opts.inset)
    .attr('y', opts.height - opts.barHeight)
    .attr('width', opts.width - opts.inset * 2)
    .attr('height', opts.barHeight)
    .attr('fill', opts.fill)
    .attr('clip-path', `url(#${opts.clipId})`)
    .attr('class', opts.className);
}
