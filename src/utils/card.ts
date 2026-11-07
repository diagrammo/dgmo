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

import { COLLAPSE_BAR_HEIGHT, EDGE_DASH } from './visual-conventions';
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
  /** Label text (single line). Used when `labelLines` is not supplied. */
  label: string;
  /** Pre-wrapped label lines. When supplied with 2+ entries the header label is
   *  drawn multi-line (centered in the header band); a single entry / omitted
   *  falls back to the one-line `label` path. */
  labelLines?: readonly string[];
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
    rect.attr('stroke-dasharray', EDGE_DASH);
  }

  const labelLines = opts.labelLines;
  if (labelLines && labelLines.length > 1) {
    // Multi-line title: stack lines centered on the header band's mid-line.
    const lineH = opts.labelFontSize * 1.2;
    const midY = opts.headerHeight / 2;
    const startY = midY - ((labelLines.length - 1) * lineH) / 2;
    for (let li = 0; li < labelLines.length; li++) {
      container
        .append('text')
        .attr('x', opts.width / 2)
        .attr('y', startY + li * lineH)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', opts.labelColor)
        .attr('font-size', opts.labelFontSize)
        .attr('font-weight', 'bold')
        // In-bounds by loop guard.
        .text(labelLines[li]!);
    }
  } else {
    container
      .append('text')
      .attr('x', opts.width / 2)
      .attr('y', opts.headerHeight / 2)
      .attr('dominant-baseline', 'central')
      .attr('text-anchor', 'middle')
      .attr('fill', opts.labelColor)
      .attr('font-size', opts.labelFontSize)
      .attr('font-weight', 'bold')
      .text(labelLines?.[0] ?? opts.label);
  }

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
  /** Card origin x in the container's coordinates (default 0). */
  x?: number;
  /** Card origin y in the container's coordinates (default 0). */
  y?: number;
  /** Card width (the bar spans all of it — inset 0). */
  width: number;
  /** Card height (the bar sits at the bottom edge). */
  height: number;
  /** Scaled corner radius for the clip rect (matches the card). */
  rx: number;
  /** Bar fill: the card's own stroke/outline colour. */
  fill: string;
  /** Unique clip-path id (kept renderer-local to avoid collisions). */
  clipId: string;
  /** Chart prefix; the bar gets `<prefix>-collapse-bar dgmo-collapse-bar`. */
  prefix: string;
  /**
   * The chart's structural scale (a ScaleContext, or a plain factor). The bar
   * height is `COLLAPSE_BAR_HEIGHT` through it. Omitted = unscaled.
   */
  scale?: { structural(value: number): number } | number;
  /**
   * The foldable thing is EXPANDED: draw the bar's hover preview instead of
   * the solid bar — same geometry, class `<prefix>-collapse-bar-preview
   * dgmo-collapse-bar-preview`, `opacity="0"` at rest. The baked toggle cue
   * (`toggleCueCss`) fades it in while the toggle is hovered. The preview
   * must be a direct child of the toggle element for that rule to reach it.
   */
  expanded?: boolean;
}

/** The scaled collapse-bar height — for layout code that reserves room for it. */
export function collapseBarHeight(scale?: CollapseBarOptions['scale']): number {
  if (scale === undefined) return COLLAPSE_BAR_HEIGHT;
  if (typeof scale === 'number') return COLLAPSE_BAR_HEIGHT * scale;
  return scale.structural(COLLAPSE_BAR_HEIGHT);
}

/**
 * Draw THE collapse bar (conventions §3) — the one mark every chart type uses
 * for "this is folded". Full card width, at the card's bottom edge, clipped to
 * its rounded corners, full opacity, `COLLAPSE_BAR_HEIGHT` through the chart's
 * structural scale. Drawn in every render mode. No renderer draws its own: the
 * conformance test (tests/collapse-bar-conformance.test.ts) fails one that does.
 */
export function renderCollapseBar(
  container: D3Sel,
  opts: CollapseBarOptions
): D3Sel {
  const x = opts.x ?? 0;
  const y = opts.y ?? 0;
  const barHeight = collapseBarHeight(opts.scale);
  container
    .append('clipPath')
    .attr('id', opts.clipId)
    .append('rect')
    .attr('x', x)
    .attr('y', y)
    .attr('width', opts.width)
    .attr('height', opts.height)
    .attr('rx', opts.rx);

  const bar = container
    .append('rect')
    .attr('x', x)
    .attr('y', y + opts.height - barHeight)
    .attr('width', opts.width)
    .attr('height', barHeight)
    .attr('fill', opts.fill)
    .attr('clip-path', `url(#${opts.clipId})`);
  if (!opts.expanded) {
    return bar.attr('class', `${opts.prefix}-collapse-bar dgmo-collapse-bar`);
  }
  return bar
    .attr(
      'class',
      `${opts.prefix}-collapse-bar-preview dgmo-collapse-bar-preview`
    )
    .attr('opacity', 0)
    .attr('pointer-events', 'none');
}

/** Every toggle attribute the fold contract defines (#1741). */
export const TOGGLE_ATTRS = [
  'data-node-toggle',
  'data-group-toggle',
  'data-section-toggle',
  'data-note-toggle',
] as const;

/** Opacity the expanded-state bar preview fades to while its toggle is hovered. */
export const COLLAPSE_PREVIEW_HOVER_OPACITY = 0.35;

/**
 * The fold cue every static host gets baked in (#1741, decided 2026-11-07):
 * a pointer cursor on every toggle; on hover the toggle's card (its first
 * `rect`/`path` child) brightens a step and an expanded thing's bar preview
 * fades in at its bottom edge; a focus ring for hosts that add `tabindex`.
 * Nothing is drawn at rest. Light themes darken a step (the app's own
 * `brightness(0.95)`), dark themes lighten one, so the step reads on both. A
 * transparent hit rect as the first child takes a faint tint instead, since a
 * filter on a transparent fill shows nothing.
 */
export function toggleCueCss(theme: string = 'light'): string {
  const t = TOGGLE_ATTRS.map((a) => `[${a}]`);
  const on = (suffix: string): string => t.map((s) => s + suffix).join(',');
  const step = theme === 'dark' ? 1.2 : 0.95;
  return (
    `${t.join(',')}{cursor:pointer}` +
    `${on(':hover>rect:first-child')},${on(':hover>path:first-child')}{filter:brightness(${step})}` +
    // A toggle whose first child is a transparent hit rect (gantt and timeline
    // lanes, whose band is drawn outside the toggle) tints that rect instead.
    `${on(':hover>rect[fill=transparent]:first-child')}{fill:${theme === 'dark' ? '#fff' : '#000'};fill-opacity:${theme === 'dark' ? 0.08 : 0.05}}` +
    `.dgmo-collapse-bar-preview{transition:opacity 120ms ease-out}` +
    `${on(':hover>.dgmo-collapse-bar-preview')}{opacity:${COLLAPSE_PREVIEW_HOVER_OPACITY}}` +
    `${on(':focus-visible')}{outline:2px solid currentColor;outline-offset:2px}` +
    `@media (prefers-reduced-motion:reduce){.dgmo-collapse-bar-preview{transition:none}}`
  );
}

/**
 * Splice {@link toggleCueCss} into a rendered SVG string as its own `<style>`,
 * right after the opening `<svg …>` tag. No-op when the SVG has no toggle.
 */
export function injectToggleCue(svg: string, theme?: string): string {
  if (!svg || !TOGGLE_ATTRS.some((a) => svg.includes(`${a}=`))) return svg;
  const open = svg.match(/<svg\b[^>]*>/);
  if (open?.index == null) return svg;
  const at = open.index + open[0].length;
  const css = toggleCueCss(theme);
  // One `<style>` per SVG: join the baked hover block when it is already there.
  if (svg.startsWith('<style>', at)) {
    const end = svg.indexOf('</style>', at);
    if (end !== -1) return `${svg.slice(0, end)}${css}${svg.slice(end)}`;
  }
  return `${svg.slice(0, at)}<style>${css}</style>${svg.slice(at)}`;
}
