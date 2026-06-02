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
import { layoutMap, type MapLayoutRegion, type PlacedLabel } from './layout';

const LABEL_FONT = 11;

/** Render a resolved map into `container` (d3-selection appends an `<svg>`). */
export function renderMap(
  container: HTMLDivElement,
  resolved: ResolvedMap,
  data: MapData,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions,
  /** Live override of the active colouring group (interactive legend flip). */
  activeGroupOverride?: string | null
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
      // Export-only: forward the contain-fit request from mapExportDimensions so a
      // clamped/floored (off-aspect) export canvas letterboxes instead of
      // stretch-distorting. The in-app preview pane passes no exportDims → unset →
      // keeps the global stretch-fill.
      preferContain: exportDims?.preferContain ?? false,
      ...(activeGroupOverride !== undefined && {
        activeGroup: activeGroupOverride,
      }),
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
    .style('font-family', FONT_FAMILY)
    // Match the SVG element background to the water rect so any letterboxing
    // (when the host container's aspect differs from the viewBox) shows water,
    // not the gray palette bg that finalizeSvgExport would otherwise apply —
    // i.e. no stray band above/below the map.
    .style('background', layout.background);

  svg
    .append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', layout.background);

  // Arrowhead markers for directed legs. Sized in user-space (NOT the SVG
  // default of stroke-width units) so a heavy weighted line doesn't blow the
  // arrowhead up to a giant wedge. The size grows gently with the line width —
  // enough to stay distinct from the stroke — but is firmly capped.
  const defs = svg.append('defs');
  // Dampened: ~8px at the thinnest leg, easing toward a 15px cap as legs widen.
  const arrowSize = (w: number): number => Math.min(15, 7 + w * 0.95);

  // Neutral bg (not the water-tinted backdrop) so label halos read over both
  // land and ocean.
  const haloColor = palette.bg;

  // Title / subtitle / caption are rendered LAST (see end of function) so they
  // sit in the foreground above the basemap, POIs, and labels.

  // ── Regions ──
  const gRegions = svg.append('g').attr('class', 'dgmo-map-regions');
  const drawRegion = (
    g: Sel,
    r: MapLayoutRegion,
    strokeWidth: number
  ): void => {
    const p = g
      .append('path')
      .attr('d', r.d)
      .attr('fill', r.fill)
      .attr('stroke', r.stroke)
      .attr('stroke-width', strokeWidth);
    // Data layer? Tag it so the app can highlight on legend hover / gradient
    // scrub. `data-value` for ramp-proximity, `data-tag-<group>` per tag value
    // (both lowercased to match the lowercased legend-entry attributes).
    if (r.layer !== 'base') {
      p.classed('dgmo-map-region', true).attr('data-region', r.id);
      if (r.value !== undefined) p.attr('data-value', r.value);
      if (r.tags) {
        for (const [group, value] of Object.entries(r.tags)) {
          p.attr(`data-tag-${group.toLowerCase()}`, value.toLowerCase());
        }
      }
    }
    if (r.lineNumber >= 0) {
      p.attr('data-line-number', r.lineNumber);
      if (onClickItem) {
        p.style('cursor', 'pointer').on('click', () =>
          onClickItem(r.lineNumber)
        );
      }
    }
  };
  for (const r of layout.regions) drawRegion(gRegions, r, 0.5);

  // ── Relief (mountain-range hachure over ALL land, under rivers/POIs/labels) ──
  // Rule horizontal lines across the whole canvas, clipped to the INTERSECTION
  // of (a) the union of range polygons and (b) the land — nested clipPaths, so
  // the hachure never bleeds onto water (coarse range polygons overrun the
  // coast, and horizontal lines on the sea read as the water convention). The
  // land clip is every drawn region except lakes — INCLUDING value-/tag-coloured
  // regions, so the relief texture sits ATOP the choropleth/tag fills (a range
  // crossing a valued state still reads as mountains there). It stays below
  // rivers, POIs, and labels. Explicit <line>s in a <clipPath> (not a tiled
  // <pattern>) dodge WKWebView/resvg pattern quirks. A non-scaling stroke keeps
  // the width constant in device px at any zoom/DPR (uniform, no moire); kept
  // sub-pixel + low-contrast so the texture stays faint. Decorative — no data attrs.
  if (layout.relief.length && layout.reliefHatch) {
    const h = layout.reliefHatch;
    const rangeClipId = 'dgmo-relief-clip';
    const landClipId = 'dgmo-relief-land';
    const rangeClip = defs.append('clipPath').attr('id', rangeClipId);
    for (const s of layout.relief) rangeClip.append('path').attr('d', s.d);
    const landClip = defs.append('clipPath').attr('id', landClipId);
    for (const r of layout.regions)
      if (r.id !== 'lake') landClip.append('path').attr('d', r.d);
    const gRelief = svg
      .append('g')
      .attr('clip-path', `url(#${landClipId})`) // outer: land only
      .append('g')
      .attr('class', 'dgmo-map-relief')
      .attr('clip-path', `url(#${rangeClipId})`) // inner: ∩ ranges
      .attr('stroke', h.color)
      .attr('stroke-width', h.width)
      // Non-scaling stroke = constant device width at any zoom/DPR (uniform,
      // no moire). NOT crispEdges — that snaps to a solid ~1px in WebKit and
      // reads far too heavy; plain AA keeps the sub-pixel lines whisper-thin.
      .attr('vector-effect', 'non-scaling-stroke');
    for (let y = h.spacing; y < height; y += h.spacing) {
      gRelief
        .append('line')
        .attr('x1', 0)
        .attr('y1', y)
        .attr('x2', width)
        .attr('y2', y);
    }
  }

  // ── Rivers (thin water centerlines over the land, under POIs/edges) ──
  if (layout.rivers.length) {
    const gRivers = svg
      .append('g')
      .attr('class', 'dgmo-map-rivers')
      .attr('fill', 'none');
    for (const r of layout.rivers) {
      gRivers
        .append('path')
        .attr('d', r.d)
        .attr('stroke', r.color)
        .attr('stroke-width', r.width)
        .attr('stroke-linecap', 'round')
        .attr('stroke-linejoin', 'round');
    }
  }

  // ── AK / HI insets (albers-usa) — drawn in the FOREGROUND so the opaque ocean
  // box hides the main-map neighbour land (Mexico's Baja) behind it; the state
  // then draws on top, framed by the box border. ──
  if (layout.insets.length) {
    const insetG = svg.append('g').attr('class', 'dgmo-map-insets');
    for (const box of layout.insets) {
      // Angled-top quad frame — rides under the conus coast so it never covers
      // neighbouring states. Closed path from the four corners.
      const d =
        box.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('') +
        'Z';
      insetG
        .append('path')
        .attr('d', d)
        .attr('fill', layout.background)
        .attr('stroke', mix(palette.text, palette.bg, 55))
        .attr('stroke-width', 1)
        .attr('stroke-linejoin', 'round');
    }
    for (const r of layout.insetRegions) drawRegion(insetG, r, 0.5);
  }

  // ── Legs (edges + route legs) ──
  const gLegs = svg
    .append('g')
    .attr('class', 'dgmo-map-legs')
    .attr('fill', 'none');
  layout.legs.forEach((leg, i) => {
    const p = gLegs
      .append('path')
      .attr('d', leg.d)
      .attr('stroke', leg.color)
      .attr('stroke-width', leg.width)
      .attr('stroke-linecap', 'round');
    if (leg.arrow) {
      const id = `dgmo-map-arrow-${i}`;
      const s = arrowSize(leg.width);
      defs
        .append('marker')
        .attr('id', id)
        .attr('viewBox', '0 0 10 10')
        .attr('refX', 10)
        .attr('refY', 5)
        .attr('markerUnits', 'userSpaceOnUse')
        .attr('markerWidth', s)
        .attr('markerHeight', s)
        .attr('orient', 'auto-start-reverse')
        .append('path')
        .attr('d', 'M0,0L10,5L0,10z')
        .attr('fill', leg.color);
      p.attr('marker-end', `url(#${id})`);
    }
    if (leg.label !== undefined && leg.labelX !== undefined) {
      // Text shade is contrast-picked in layout against the fill under the label
      // (dark scored country ⇒ light text, pale land ⇒ dark), with the ghost halo
      // only when that contrast is marginal. Fall back to the muted default for
      // legs that predate the computed style.
      emitText(
        gLegs,
        leg.labelX,
        leg.labelY ?? 0,
        leg.label,
        'middle',
        leg.labelColor ?? palette.textMuted,
        leg.labelHaloColor ?? haloColor,
        leg.labelHalo ?? true,
        LABEL_FONT - 1
      );
    }
  });

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
      .attr('data-line-number', poi.lineNumber)
      .attr('data-poi', poi.id);
    // Tag the marker per tag value (lowercased, matching the lowercased
    // legend-entry attributes) so the app can spotlight it on legend hover.
    if (poi.tags) {
      for (const [group, value] of Object.entries(poi.tags)) {
        c.attr(`data-tag-${group.toLowerCase()}`, value.toLowerCase());
      }
    }
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

  // ── Labels (leaders + halo text) ──
  const gLabels = svg.append('g').attr('class', 'dgmo-map-labels');
  for (const lab of layout.labels) {
    if (lab.leader) {
      const line = gLabels
        .append('line')
        .attr('x1', lab.leader.x1)
        .attr('y1', lab.leader.y1)
        .attr('x2', lab.leader.x2)
        .attr('y2', lab.leader.y2)
        // Tie the leader to its dot by colour; neutral grey when it has none.
        .attr(
          'stroke',
          lab.leaderColor ?? mix(palette.textMuted, palette.bg, 60)
        )
        .attr('stroke-width', lab.leaderColor ? 1 : 0.75);
      if (lab.poiId !== undefined) line.attr('data-poi', lab.poiId);
    }
    const t = emitText(
      gLabels,
      lab.x,
      lab.y,
      lab.text,
      lab.anchor,
      lab.color,
      lab.haloColor,
      lab.halo,
      LABEL_FONT
    );
    // POI labels are spotlightable: tag with the POI id and make the text the
    // hover target (the app dims the other dots/labels on enter).
    if (lab.poiId !== undefined) {
      t.attr('data-poi', lab.poiId).style('cursor', 'default');
    }
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
    // The value ramp is a selectable colouring group alongside the tag groups
    // (the user flips between them); its capsule renders the gradient inline.
    // Reserved name "Value" when no region-metric label is set — must match
    // VALUE_NAME in layout.ts so the resolved activeGroup selects it.
    const ramp = layout.legend.ramp;
    const scoreGroup = ramp
      ? {
          name: ramp.metric?.trim() || 'Value',
          entries: [],
          gradient: {
            min: ramp.min,
            max: ramp.max,
            hue: ramp.hue,
            base: ramp.base,
          },
        }
      : null;
    const tagGroups = layout.legend.tagGroups
      .filter((g) => g.entries.length > 0)
      .map((g) => ({ name: g.name, entries: [...g.entries] }));
    const groups = [...(scoreGroup ? [scoreGroup] : []), ...tagGroups];
    if (groups.length > 0) {
      const config: LegendConfig = {
        groups,
        position: { placement: 'top-center', titleRelation: 'below-title' },
        mode: exportDims ? 'export' : 'preview',
        showEmptyGroups: false,
        // Keep inactive siblings visible as pills so the user can click to flip
        // the active colouring dimension (preview only — export shows just the
        // active group).
        showInactivePills: true,
      };
      const state: LegendState = { activeGroup: layout.legend.activeGroup };
      renderLegendD3(legendG, config, state, palette, isDark, undefined, width);
    }
  }

  // ── Title / subtitle / caption (foreground — drawn last so they sit above the
  // basemap, POIs, and labels; layout reserves top padding so POIs clear them) ──
  // Soft bg halo so the banner stays legible over busy land/water (the muted
  // subtitle/caption otherwise wash out on mid-toned palettes like gruvbox).
  if (layout.title) {
    svg
      .append('text')
      .attr('class', 'dgmo-map-title')
      .attr('x', width / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .attr('paint-order', 'stroke fill')
      .attr('stroke', palette.bg)
      .attr('stroke-width', 4)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-opacity', 0.7)
      .text(layout.title);
  }
  if (layout.subtitle) {
    svg
      .append('text')
      .attr('class', 'dgmo-map-subtitle')
      .attr('x', width / 2)
      .attr('y', TITLE_Y + TITLE_FONT_SIZE)
      .attr('text-anchor', 'middle')
      .attr('font-size', LABEL_FONT + 1)
      .attr('fill', palette.textMuted)
      .attr('paint-order', 'stroke fill')
      .attr('stroke', palette.bg)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-opacity', 0.7)
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
      .attr('paint-order', 'stroke fill')
      .attr('stroke', palette.bg)
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-opacity', 0.7)
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
): d3Selection.Selection<SVGTextElement, unknown, null, undefined> {
  const t = g
    .append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', anchor)
    .attr('font-size', fontSize)
    .attr('fill', color)
    .text(text);
  if (withHalo) {
    // Thin, even outline (2px / 1px-per-side at the 11px label font — 3px read
    // top-heavy as adjacent glyph tops merged their strokes). Round join + cap
    // keep the edge uniform around every glyph.
    t.attr('paint-order', 'stroke fill')
      .attr('stroke', halo)
      .attr('stroke-width', 2)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .attr('stroke-opacity', 0.55);
  }
  return t;
}
