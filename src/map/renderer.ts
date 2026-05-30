// Renderer (step 4, part 2): MapLayout → SVG, via d3-selection. THIN — all
// geometry/color/collision decisions are layout.ts; this only emits attributes.
// Layering regions → legs(edges/routes) → POIs → labels → legend (§24B.11).
// Mirrors every structured renderer's contract (container in, SVG appended,
// returns void). Legend uses renderLegendD3 — the d3-selection legend path —
// NOT the string renderLegendSvg (AR1).
import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { mix } from '../palettes/color-utils';
import { renderLegendD3 } from '../utils/legend-d3';
import type { LegendConfig, LegendState } from '../utils/legend-types';
import type { PaletteColors } from '../palettes/types';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { MapData, ResolvedMap } from './resolved-types';
import { layoutMap, type MapLayout, type PlacedLabel } from './layout';

const LABEL_FONT = 11;

/** Render a resolved map into `container` (d3-selection appends an `<svg>`). */
export function renderMap(
  container: HTMLDivElement,
  resolved: ResolvedMap,
  data: MapData,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const layout = layoutMap(
    resolved,
    data,
    { width, height },
    {
      palette,
      isDark,
    }
  );

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .style('font-family', FONT_FAMILY);

  svg
    .append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', layout.background);

  // Arrowhead marker for directed legs.
  const arrowColor = mix(palette.text, palette.bg, 50);
  const defs = svg.append('defs');
  defs
    .append('marker')
    .attr('id', 'dgmo-map-arrow')
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 9)
    .attr('refY', 5)
    .attr('markerWidth', 7)
    .attr('markerHeight', 7)
    .attr('orient', 'auto-start-reverse')
    .append('path')
    .attr('d', 'M0,0L10,5L0,10z')
    .attr('fill', arrowColor);

  // Neutral bg (not the water-tinted backdrop) so label halos read over both
  // land and ocean.
  const haloColor = palette.bg;

  // Title / subtitle / caption are rendered LAST (see end of function) so they
  // sit in the foreground above the basemap, POIs, and labels.

  // ── AK / HI inset cutouts (albers-usa) — framed cards drawn behind the
  // regions so the composited insets read as insets (and Hawaii doesn't vanish
  // into the ocean). Neutral bg fill separates them from the water tint. ──
  if (layout.insets.length) {
    const insetG = svg.append('g').attr('class', 'dgmo-map-insets');
    for (const box of layout.insets) {
      insetG
        .append('rect')
        .attr('x', box.x)
        .attr('y', box.y)
        .attr('width', box.w)
        .attr('height', box.h)
        .attr('rx', 4)
        .attr('fill', layout.background)
        .attr('stroke', mix(palette.text, palette.bg, 35))
        .attr('stroke-width', 1);
    }
  }

  // ── Regions ──
  const gRegions = svg.append('g').attr('class', 'dgmo-map-regions');
  for (const r of layout.regions) {
    const p = gRegions
      .append('path')
      .attr('d', r.d)
      .attr('fill', r.fill)
      .attr('stroke', r.stroke)
      .attr('stroke-width', 0.5);
    if (r.lineNumber >= 0) {
      p.attr('data-line-number', r.lineNumber);
      if (onClickItem) {
        p.style('cursor', 'pointer').on('click', () =>
          onClickItem(r.lineNumber)
        );
      }
    }
  }

  // ── Legs (edges + route legs) ──
  const gLegs = svg
    .append('g')
    .attr('class', 'dgmo-map-legs')
    .attr('fill', 'none');
  for (const leg of layout.legs) {
    const p = gLegs
      .append('path')
      .attr('d', leg.d)
      .attr('stroke', leg.color)
      .attr('stroke-width', leg.width)
      .attr('stroke-linecap', 'round');
    if (leg.arrow) p.attr('marker-end', 'url(#dgmo-map-arrow)');
    if (leg.label !== undefined && leg.labelX !== undefined) {
      emitText(
        gLegs,
        leg.labelX,
        leg.labelY ?? 0,
        leg.label,
        'middle',
        palette.textMuted,
        haloColor,
        true,
        LABEL_FONT - 1
      );
    }
  }

  // ── POIs ──
  const gPois = svg.append('g').attr('class', 'dgmo-map-pois');
  for (const poi of layout.pois) {
    if (poi.isOrigin) {
      gPois
        .append('circle')
        .attr('cx', poi.cx)
        .attr('cy', poi.cy)
        .attr('r', poi.r + 3)
        .attr('fill', 'none')
        .attr('stroke', poi.stroke)
        .attr('stroke-width', 1.5);
    }
    const c = gPois
      .append('circle')
      .attr('cx', poi.cx)
      .attr('cy', poi.cy)
      .attr('r', poi.r)
      .attr('fill', poi.fill)
      .attr('stroke', poi.stroke)
      .attr('stroke-width', 1)
      .attr('data-line-number', poi.lineNumber);
    if (onClickItem) {
      c.style('cursor', 'pointer').on('click', () =>
        onClickItem(poi.lineNumber)
      );
    }
    if (poi.routeNumber !== undefined) {
      emitText(
        gPois,
        poi.cx,
        poi.cy + 3,
        String(poi.routeNumber),
        'middle',
        palette.bg,
        poi.fill,
        false,
        LABEL_FONT - 2
      );
    }
  }

  // ── Labels (leaders, halo text, numbered pins) ──
  const gLabels = svg.append('g').attr('class', 'dgmo-map-labels');
  for (const lab of layout.labels) {
    if (lab.leader) {
      gLabels
        .append('line')
        .attr('x1', lab.leader.x1)
        .attr('y1', lab.leader.y1)
        .attr('x2', lab.leader.x2)
        .attr('y2', lab.leader.y2)
        .attr('stroke', mix(palette.textMuted, palette.bg, 60))
        .attr('stroke-width', 0.75);
    }
    if (lab.pin !== undefined) {
      gLabels
        .append('rect')
        .attr('x', lab.x - 1)
        .attr('y', lab.y - LABEL_FONT)
        .attr('width', LABEL_FONT * 1.3)
        .attr('height', LABEL_FONT * 1.3)
        .attr('rx', 2)
        .attr('fill', palette.surface)
        .attr('stroke', palette.border);
    }
    emitText(
      gLabels,
      lab.x,
      lab.y,
      lab.text,
      lab.anchor,
      lab.color,
      haloColor,
      lab.halo,
      LABEL_FONT
    );
  }

  // ── Pin legend list ──
  if (layout.pinList.length > 0) {
    const gPins = svg
      .append('g')
      .attr('class', 'dgmo-map-pin-list')
      .attr(
        'transform',
        `translate(12, ${height - layout.pinList.length * 14 - 8})`
      );
    layout.pinList.forEach((entry, i) => {
      gPins
        .append('text')
        .attr('x', 0)
        .attr('y', i * 14)
        .attr('font-size', LABEL_FONT - 1)
        .attr('fill', palette.textMuted)
        .text(`${entry.pin} — ${entry.label}`);
    });
  }

  // ── Legend (categorical via renderLegendD3 + ramp/size/weight blocks; AR1) ──
  if (layout.legend) {
    const legendY =
      (layout.title ? TITLE_Y + TITLE_FONT_SIZE : 0) +
      (layout.subtitle ? TITLE_FONT_SIZE : 0) +
      8;
    const legendG = svg
      .append('g')
      .attr('class', 'dgmo-map-legend')
      .attr('transform', `translate(0, ${legendY})`);
    const groups = layout.legend.tagGroups.filter((g) => g.entries.length > 0);
    if (groups.length > 0) {
      const config: LegendConfig = {
        groups: groups.map((g) => ({ name: g.name, entries: [...g.entries] })),
        position: { placement: 'top-center', titleRelation: 'below-title' },
        mode: exportDims ? 'export' : 'preview',
        showEmptyGroups: false,
      };
      const state: LegendState = { activeGroup: layout.legend.activeGroup };
      renderLegendD3(legendG, config, state, palette, isDark, undefined, width);
    }
    // Custom keys (ramp / size / weight), stacked above the pin list so they
    // never overlap it (#3).
    const pinGap = layout.pinList.length ? layout.pinList.length * 14 + 14 : 0;
    emitExtraLegend(svg, layout, palette, height, pinGap);
  }

  // ── Title / subtitle / caption (foreground — drawn last so they sit above the
  // basemap, POIs, and labels; layout reserves top padding so POIs clear them) ──
  if (layout.title) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .text(layout.title);
  }
  if (layout.subtitle) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', TITLE_Y + TITLE_FONT_SIZE)
      .attr('text-anchor', 'middle')
      .attr('font-size', LABEL_FONT + 1)
      .attr('fill', palette.textMuted)
      .text(layout.subtitle);
  }
  if (layout.caption) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', height - 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', LABEL_FONT)
      .attr('fill', palette.textMuted)
      .text(layout.caption);
  }
}

/** Export wrapper (no click handler) — matches the structured-renderer contract. */
export function renderMapForExport(
  container: HTMLDivElement,
  resolved: ResolvedMap,
  data: MapData,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  renderMap(container, resolved, data, palette, isDark, undefined, exportDims);
}

type Sel = d3Selection.Selection<SVGGElement, unknown, null, undefined>;
type SvgSel = d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;

function emitText(
  g: Sel,
  x: number,
  y: number,
  text: string,
  anchor: PlacedLabel['anchor'],
  color: string,
  halo: string,
  withHalo: boolean,
  fontSize: number
): void {
  const t = g
    .append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', anchor)
    .attr('font-size', fontSize)
    .attr('fill', color)
    .text(text);
  if (withHalo) {
    t.attr('paint-order', 'stroke fill')
      .attr('stroke', halo)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-opacity', 0.7);
  }
}

/** Ramp gradient bar + graduated size/weight keys (not legend swatch groups). */
function emitExtraLegend(
  svg: SvgSel,
  layout: MapLayout,
  palette: PaletteColors,
  height: number,
  bottomGap: number
): void {
  const { legend } = layout;
  if (!legend) return;
  // Nothing to draw if there are only categorical swatches (#4).
  if (!legend.ramp && !legend.size && !legend.weight) return;
  const blocks: Array<() => void> = [];
  const g = svg.append('g').attr('class', 'dgmo-map-legend-keys');
  let xCursor = 0;

  if (legend.ramp) {
    const ramp = legend.ramp;
    blocks.push(() => {
      const block = g.append('g').attr('transform', `translate(${xCursor},0)`);
      const gradId = 'dgmo-map-ramp';
      const grad = block
        .append('defs')
        .append('linearGradient')
        .attr('id', gradId)
        .attr('x1', '0%')
        .attr('x2', '100%');
      grad
        .append('stop')
        .attr('offset', '0%')
        .attr('stop-color', mix(ramp.hue, ramp.base, 15));
      grad.append('stop').attr('offset', '100%').attr('stop-color', ramp.hue);
      block
        .append('rect')
        .attr('width', 80)
        .attr('height', 8)
        .attr('fill', `url(#${gradId})`);
      block
        .append('text')
        .attr('x', 0)
        .attr('y', 22)
        .attr('font-size', 9)
        .attr('fill', palette.textMuted)
        .text(String(ramp.min));
      block
        .append('text')
        .attr('x', 80)
        .attr('y', 22)
        .attr('text-anchor', 'end')
        .attr('font-size', 9)
        .attr('fill', palette.textMuted)
        .text(String(ramp.max));
      if (ramp.metric) {
        block
          .append('text')
          .attr('x', 0)
          .attr('y', -4)
          .attr('font-size', 9)
          .attr('fill', palette.textMuted)
          .text(ramp.metric);
      }
      xCursor += 110;
    });
  }
  if (legend.size) {
    const sz = legend.size;
    blocks.push(() => {
      const block = g.append('g').attr('transform', `translate(${xCursor},0)`);
      [3, 6, 10].forEach((r, i) => {
        block
          .append('circle')
          .attr('cx', i * 26 + r)
          .attr('cy', 8)
          .attr('r', r)
          .attr('fill', 'none')
          .attr('stroke', palette.textMuted);
      });
      block
        .append('text')
        .attr('x', 0)
        .attr('y', -4)
        .attr('font-size', 9)
        .attr('fill', palette.textMuted)
        .text(sz.metric ?? 'size');
      xCursor += 110;
    });
  }
  if (legend.weight) {
    const wt = legend.weight;
    blocks.push(() => {
      const block = g.append('g').attr('transform', `translate(${xCursor},0)`);
      [1, 3, 6].forEach((w, i) => {
        block
          .append('line')
          .attr('x1', i * 26)
          .attr('y1', 8)
          .attr('x2', i * 26 + 20)
          .attr('y2', 8)
          .attr('stroke', palette.textMuted)
          .attr('stroke-width', w);
      });
      block
        .append('text')
        .attr('x', 0)
        .attr('y', -4)
        .attr('font-size', 9)
        .attr('fill', palette.textMuted)
        .text(wt.metric ?? 'weight');
      xCursor += 110;
    });
  }
  // Each block is ~110px wide. When AK/HI insets occupy the lower-left, push
  // the key strip to the lower-right so it doesn't sit on top of the insets.
  const totalW = blocks.length * 110;
  const x = layout.insets.length
    ? Math.max(12, layout.width - 12 - totalW)
    : 12;
  g.attr('transform', `translate(${x}, ${height - 56 - bottomGap})`);
  for (const draw of blocks) draw();
}
