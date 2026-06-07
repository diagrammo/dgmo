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
import { measureText } from '../utils/text-measure';
import { renderLegendD3 } from '../utils/legend-d3';
import type { LegendConfig, LegendState } from '../utils/legend-types';
import { mapLegendConfig, mapLegendGroups } from './legend-band';
import type { PaletteColors } from '../palettes/types';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { MapData, ResolvedMap } from './resolved-types';
import {
  layoutMap,
  parsePathRings,
  type MapLayoutRegion,
  type MapLayoutCoastlineStyle,
  type PlacedLabel,
} from './layout';

const LABEL_FONT = 11;

// ── Coastline water-lines helpers (opt-in `coastline`, §24B.2) ──
// Geometry is derived from the already-drawn region paths: each outer ring is
// buffered as a symmetric SVG stroke band then eroded (flat-water overdraw) to a
// thin offshore ring; a luminance <mask> reveals only the water side. See the
// render block + ADR-1/6 in the tech-spec.

/** Even-odd point-in-ring test (screen space). */
function pointInRing(
  px: number,
  py: number,
  ring: ReadonlyArray<[number, number]>
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** Build an SVG subpath `d` (`M…L…Z`) from a ring's points. */
function ringToPath(ring: ReadonlyArray<[number, number]>): string {
  let d = '';
  for (let i = 0; i < ring.length; i++)
    d += (i ? 'L' : 'M') + ring[i]![0] + ',' + ring[i]![1];
  return d + 'Z';
}

/** Open SVG polyline (`M…L…`, no `Z`) from a run of points. */
function polylineToPath(pts: ReadonlyArray<[number, number]>): string {
  let d = '';
  for (let i = 0; i < pts.length; i++)
    d += (i ? 'L' : 'M') + pts[i]![0] + ',' + pts[i]![1];
  return d;
}

/** Coast subpaths for one ring, dropping any edge that runs ALONG a canvas edge.
 *  A region clipped to the viewport (the antimeridian on a world map, or a
 *  regional clipExtent cut) gains a synthetic straight edge collinear with the
 *  frame — that edge is NOT a real coast and must not be buffered into a coast
 *  band (which would ring the cut with water-lines short of the edge). Without a
 *  `frame` the ring is returned closed (`M…Z`) as before. With one, the ring is
 *  split at every frame-collinear edge into open coast arcs (`M…L…`), so the land
 *  runs cleanly to the edge and only true coastline gets a water-line. */
function ringToCoastPaths(
  ring: ReadonlyArray<[number, number]>,
  frame?: { w: number; h: number }
): string[] {
  if (!frame) return [ringToPath(ring)];
  const n = ring.length;
  const eps = 0.75;
  const onL = (x: number): boolean => Math.abs(x) <= eps;
  const onR = (x: number): boolean => Math.abs(x - frame.w) <= eps;
  const onT = (y: number): boolean => Math.abs(y) <= eps;
  const onB = (y: number): boolean => Math.abs(y - frame.h) <= eps;
  const isFrameEdge = (
    a: readonly [number, number],
    b: readonly [number, number]
  ): boolean =>
    (onL(a[0]) && onL(b[0])) ||
    (onR(a[0]) && onR(b[0])) ||
    (onT(a[1]) && onT(b[1])) ||
    (onB(a[1]) && onB(b[1]));
  // No frame-collinear edge anywhere → ordinary interior coastline (closed).
  let firstBreak = -1;
  for (let i = 0; i < n; i++)
    if (isFrameEdge(ring[i]!, ring[(i + 1) % n]!)) {
      firstBreak = i;
      break;
    }
  if (firstBreak === -1) return [ringToPath(ring)];
  // Walk the loop from just after the first cut, accumulating runs of real-coast
  // edges into open polylines and breaking at each frame-collinear edge.
  const paths: string[] = [];
  let cur: Array<[number, number]> = [];
  const start = (firstBreak + 1) % n;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    if (isFrameEdge(a, b)) {
      if (cur.length >= 2) paths.push(polylineToPath(cur));
      cur = [];
      continue;
    }
    if (cur.length === 0) cur.push(a);
    cur.push(b);
  }
  if (cur.length >= 2) paths.push(polylineToPath(cur));
  return paths;
}

/** Coast outlines to buffer: every region's OUTER rings whose bbox extent clears
 *  `minExtent`. Holes/enclaves are skipped via containment depth (even depth =
 *  outer landmass boundary, odd = a hole) so an enclave (Lesotho) or a lake-hole
 *  is never ringed as a fake coast on land (R11). `minExtent` is a bare
 *  degenerate-ring floor now — every island, however small, grows coast rings. */
function coastlineOuterRings(
  regions: readonly MapLayoutRegion[],
  minExtent: number,
  frame?: { w: number; h: number }
): string[] {
  const paths: string[] = [];
  for (const r of regions) {
    const rings = parsePathRings(r.d);
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i]!;
      if (ring.length < 3) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (Math.max(maxX - minX, maxY - minY) < minExtent) continue;
      const [fx, fy] = ring[0]!;
      let depth = 0;
      for (let j = 0; j < rings.length; j++)
        if (j !== i && pointInRing(fx, fy, rings[j]!)) depth++;
      if (depth % 2 === 1) continue; // hole/enclave — skip
      paths.push(...ringToCoastPaths(ring, frame));
    }
  }
  return paths;
}

/** Stroke the coast-parallel water-lines into a masked group. Per line, outer→
 *  inner so the inner ring draws on top: a colour pass (the symmetric buffer
 *  band) then a flat-water overdraw that erodes it to a thin offshore ring. The
 *  group's `<mask>` keeps only the water-side half of each band.
 *
 *  The outer→inner ordering protects a single ring (the inner band never reaches
 *  the outer ring because `d1+thickness < d2`, the layout invariant). It does NOT
 *  protect across regions: where two coasts sit closer than ~2·d1 (a tripoint, a
 *  narrow strait, an inset box edge), one region's flat-water overdraw can paint
 *  over a neighbour's inner ring — the same accepted "tripoint stub / narrow
 *  inlet fills solid" artifact the tech-spec calls out, bounded by small d.
 *
 *  Perf: every outer ring in a given (level, pass) shares identical stroke
 *  attributes, so they collapse into ONE multi-subpath `<path>` (each ring's
 *  `d` already starts with `M`, so joining is a valid compound path). A world
 *  map drops from ~6k coastline paths to 2 per ring-level (~10 total), which is
 *  ~87% of the whole map's path count — the dominant cost in any repaint. The
 *  only visible consequence: the colour-band pass strokes at `stroke-opacity`,
 *  and a single path's stroke rasterises as ONE coverage region, so adjacent
 *  bands that overlap (straits/tripoints) no longer double-darken — they read
 *  uniform, which is if anything cleaner. Draw order (all colour bands, then all
 *  flat-water, outer level first) is unchanged, so the single-ring invariant and
 *  the accepted cross-region overdraw artifact behave exactly as before. */
function appendWaterLines(
  g: Sel,
  defs: Sel,
  coastId: string,
  outerRings: readonly string[],
  style: MapLayoutCoastlineStyle,
  flatWater: string
): void {
  const d = outerRings.join(' ');
  if (!d) return;
  // The coast geometry is byte-for-byte identical across every line-level and
  // both passes (only stroke colour/width differ). On a world map that compound
  // path is ~200KB, so emitting it ~12× inline ballooned the SVG to multi-MB and
  // overflowed the SSG HTML reparse. Define it once and `<use>` it: same pixels,
  // a fraction of the bytes.
  defs.append('path').attr('id', coastId).attr('d', d).attr('fill', 'none');
  const ref = `#${coastId}`;
  const linesOuterFirst = [...style.lines].sort((a, b) => b.d - a.d);
  for (const line of linesOuterFirst) {
    g.append('use')
      .attr('href', ref)
      .attr('stroke', style.color)
      .attr('stroke-width', 2 * (line.d + line.thickness))
      .attr('stroke-opacity', line.opacity)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');
    g.append('use')
      .attr('href', ref)
      .attr('stroke', flatWater)
      .attr('stroke-width', 2 * line.d)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');
  }
}

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
      // Reserve the legend band for the mode actually drawn below (export shows
      // only the active group; preview keeps the inactive pills).
      legendMode: exportDims ? 'export' : 'preview',
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
    // Display name on EVERY region (authored + base/context) so the app can
    // surface it on hover — decorative metadata, no visible text drawn here.
    if (r.label) p.attr('data-region-name', r.label);
    // ISO id on EVERY political region (authored + base/context + inset states),
    // so the Inspect tool can resolve a reverse-geocoded `{iso}` to its drawn path
    // and outline it. Distinct from `data-region` (data-layer-only, legend hover):
    // this lands on base/context land too. Lakes carry no iso (not a place).
    if (r.id && r.id !== 'lake') p.attr('data-iso', r.id);
    // Area-weighted centroid (px) the app anchors the hover label to — robust to
    // antimeridian crossers where a bounding-box centre lands in open ocean.
    if (r.labelX !== undefined && r.labelY !== undefined) {
      p.attr('data-label-x', r.labelX).attr('data-label-y', r.labelY);
    }
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
      // Decorative texture — never a pointer target, so region hover (the app's
      // name-on-hover) always reaches the region path beneath. WebKit hit-tests
      // masked/clipped overlays unlike Chromium, so this must be explicit.
      .style('pointer-events', 'none')
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

  // ── Coastline water-lines (faint nautical-chart lines on the WATER side) ──
  // 2 discrete coast-parallel lines hugging the ocean shore + lake shores, fading
  // seaward. Each region's outer ring is buffered as a symmetric SVG stroke band
  // then eroded with a flat-water overdraw to a thin offshore ring; a luminance
  // <mask> (white canvas − black land + white lakes) reveals only the water side,
  // so land/land borders self-remove (their band falls on
  // the neighbour's land, which the mask hides — no topojson.mesh needed). NOT a
  // clipPath: sibling clip paths UNION (can't subtract land). Decorative — no data
  // attrs, plain strokes. Below rivers/POIs/legs/labels, above region/relief fills
  // (so with `relief` on, water-lines sit on water and relief on land — disjoint).
  // §24B.2, ADR-1/3/6.
  if (layout.coastlineStyle) {
    const cs = layout.coastlineStyle;
    const maskId = 'dgmo-map-water-mask';
    const mask = defs
      .append('mask')
      .attr('id', maskId)
      // userSpaceOnUse: the default objectBoundingBox clamps the mask region to
      // the group's own bbox and drops the canvas-edge reveal (round-2 #2).
      .attr('maskUnits', 'userSpaceOnUse')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height);
    mask
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'white');
    // All land fills are opaque black and all lake fills opaque white, so each
    // group collapses into ONE compound path (land first, lakes over it to
    // re-reveal their interiors). Identical pixels, ~hundreds of paths → 2.
    const landD = layout.regions
      .filter((r) => r.id !== 'lake')
      .map((r) => r.d)
      .join(' ');
    const lakeD = layout.regions
      .filter((r) => r.id === 'lake')
      .map((r) => r.d)
      .join(' ');
    if (landD) mask.append('path').attr('d', landD).attr('fill', 'black');
    if (lakeD) mask.append('path').attr('d', lakeD).attr('fill', 'white');
    // Moat around each AK/HI inset box: the opaque box is drawn in the FOREGROUND
    // over open ocean, so the main-map offshore rings get chopped by its border
    // and butt into it — sloppy. Paint each box quad black (interior, under the
    // box) with a black stroke whose half-width = the band's outer reach, so the
    // main rings also clear a margin OUTSIDE the border. The ring-ends then fall
    // in open water away from the frame instead of crashing into it.
    if (layout.insets.length) {
      const reach = Math.max(0, ...cs.lines.map((l) => l.d + l.thickness));
      for (const box of layout.insets) {
        const d =
          box.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('') +
          'Z';
        mask
          .append('path')
          .attr('d', d)
          .attr('fill', 'black')
          .attr('stroke', 'black')
          .attr('stroke-width', 2 * reach)
          .attr('stroke-linejoin', 'round');
      }
    }
    // NO frame band: a synthetic frame-cut edge (clipExtent/cullFeatureToView
    // trims region `d` to the view rect) has the region INTERIOR — land — on the
    // canvas-interior side, which the mask already paints black, so its band is
    // hidden anyway. A border band here only suppressed REAL coastal rings near
    // the canvas edge, leaving an empty top/bottom strip — so the water-lines now
    // carry through to every edge of the visible map.
    const gWater = svg
      .append('g')
      .attr('class', 'dgmo-map-water-lines')
      .attr('fill', 'none')
      // Decorative nautical lines — never a pointer target. Without this the wide
      // pre-mask coastal ring bands swallow region hover over coastal countries in
      // WebKit (which hit-tests masked content unlike Chromium); e.g. Portugal.
      .style('pointer-events', 'none')
      .attr('mask', `url(#${maskId})`);
    appendWaterLines(
      gWater,
      defs,
      'dgmo-map-coast',
      // Pass the canvas frame so edges collinear with it (the antimeridian on a
      // world map, regional clipExtent cuts) don't get ringed as fake coast —
      // land runs cleanly to the render-area edge.
      coastlineOuterRings(layout.regions, cs.minExtent, {
        w: width,
        h: height,
      }),
      cs,
      layout.background
    );
    // Restore the seaward half of the coast stroke: the rings' flat-water erosion
    // overdraws repaint the water out to d_max, which paints over the water-side
    // half of each region's coast outline and makes coastlines read faded. Re-
    // stroke every region inside the SAME masked group (so it only repaints the
    // water side — the land side was never touched, and interior land/land borders
    // stay hidden), on top of the rings. The strokes sit at the coast (offset 0),
    // well inside d0, so they never cover the offshore rings.
    // Group the restroke by stroke colour (base borders share one colour; the
    // occasional data region may differ) so same-coloured coasts collapse into a
    // single compound path instead of one path per region.
    const byStroke = new Map<string, string[]>();
    for (const r of layout.regions) {
      const arr = byStroke.get(r.stroke);
      if (arr) arr.push(r.d);
      else byStroke.set(r.stroke, [r.d]);
    }
    for (const [stroke, ds] of byStroke)
      gWater
        .append('path')
        .attr('d', ds.join(' '))
        .attr('stroke', stroke)
        .attr('stroke-width', 0.5)
        .attr('stroke-linejoin', 'round');
  }

  // ── Rivers (thin water centerlines over the land, under POIs/edges) ──
  if (layout.rivers.length) {
    const gRivers = svg
      .append('g')
      .attr('class', 'dgmo-map-rivers')
      .attr('fill', 'none')
      .style('pointer-events', 'none'); // decorative — pass hover to regions below
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

  // ── Label clarity patch — repaint the clean region FILL under each POI label
  // so the basemap line work beneath it (region borders, relief hachure, coast +
  // river lines) dissolves where it would clutter the text. Crucially this is NOT
  // a halo: the patch IS the same fill that already surrounds the label, so over
  // plain land it is invisible and ONLY the crossing lines disappear — no white
  // pad over flat colour. A blurred-blob mask feathers each patch into the map
  // (soft edges, no hard rectangle). Sits above all basemap line work, below the
  // dots / legs / labels. POI labels only; context/water labels keep their lines
  // (they read as cartographic texture, not clutter). Applies to preview AND
  // export so the static image matches what's on screen.
  const patchLabels = layout.labels.filter(
    (l) => l.poiId !== undefined && !l.hidden
  );
  if (patchLabels.length) {
    const patchMaskId = 'dgmo-map-label-patch';
    const patchBlurId = 'dgmo-map-label-patch-blur';
    // Soft falloff so the patch dissolves into the surrounding basemap instead of
    // ending on a hard edge. Tuned at the 11px label font.
    defs
      .append('filter')
      .attr('id', patchBlurId)
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%')
      .append('feGaussianBlur')
      .attr('in', 'SourceGraphic')
      .attr('stdDeviation', 2.5);
    const patchMask = defs
      .append('mask')
      .attr('id', patchMaskId)
      // userSpaceOnUse: the patch group's bbox is the whole basemap, but keep the
      // mask region pinned to the canvas (parity with the water masks).
      .attr('maskUnits', 'userSpaceOnUse')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height);
    // White blobs = where the patch shows; the surrounding black hides it. Each
    // blob is a SOLID rounded rect sized to the text bbox so the core fully hides
    // the line work behind the glyphs; the blur (above) only feathers the outer
    // edge into a gentle reveal. Solid core → if an engine drops the in-mask blur
    // (some WebKit builds), it degrades to a clean stadium patch, never a halo.
    const blobs = patchMask.append('g').attr('filter', `url(#${patchBlurId})`);
    // Padded rects (incl. the blur reach) drive both the mask AND the region
    // cull below, so the two never disagree.
    const PAD = 8; // ≳ blur reach so culled regions can't lose a fringe
    const blobRects: Array<{ x0: number; y0: number; x1: number; y1: number }> =
      [];
    for (const l of patchLabels) {
      const multi = l.lines && l.lines.length > 1;
      const tw = multi
        ? Math.max(...l.lines!.map((s) => measureText(s, LABEL_FONT)))
        : measureText(l.text, LABEL_FONT);
      const th = multi ? l.lines!.length * (LABEL_FONT + 2) : LABEL_FONT;
      // Anchor → blob centre x; cy nudged up from the text baseline to the glyph
      // visual centre.
      const cx =
        l.anchor === 'start'
          ? l.x + tw / 2
          : l.anchor === 'end'
            ? l.x - tw / 2
            : l.x;
      const cy = l.y - LABEL_FONT * 0.3;
      const w = tw + 8;
      const h = th + 6;
      blobs
        .append('rect')
        .attr('x', cx - w / 2)
        .attr('y', cy - h / 2)
        .attr('width', w)
        .attr('height', h)
        .attr('rx', h / 2)
        .attr('fill', 'white');
      blobRects.push({
        x0: cx - w / 2 - PAD,
        y0: cy - h / 2 - PAD,
        x1: cx + w / 2 + PAD,
        y1: cy + h / 2 + PAD,
      });
    }
    const gPatch = svg
      .append('g')
      .attr('class', 'dgmo-map-label-patch')
      .attr('mask', `url(#${patchMaskId})`)
      // Decorative cover — never a pointer target so region hover / name-on-hover
      // reaches the real region paths beneath (WebKit hit-tests masked content).
      .style('pointer-events', 'none');
    // Redraw fills only (no stroke), in document order, but ONLY for regions
    // whose bbox overlaps a label blob — the mask already hides everything else,
    // so emitting the rest is pure SVG weight (matters on dense world maps). The
    // kept regions reproduce the exact composite colour under each label, so the
    // patch is seamless and the only visible change is the vanished line work.
    for (const r of layout.regions) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const ring of parsePathRings(r.d))
        for (const [px, py] of ring) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
      const hit = blobRects.some(
        (b) => minX <= b.x1 && maxX >= b.x0 && minY <= b.y1 && maxY >= b.y0
      );
      if (hit) gPatch.append('path').attr('d', r.d).attr('fill', r.fill);
    }
  }

  // ── AK / HI insets (albers-usa) — drawn in the FOREGROUND so the opaque ocean
  // box hides the main-map neighbour land (Mexico's Baja) behind it; the state
  // then draws on top, framed by the box border. ──
  if (layout.insets.length) {
    const insetG = svg.append('g').attr('class', 'dgmo-map-insets');
    layout.insets.forEach((box, bi) => {
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
      // Neighbour land (Canada beside Alaska) clipped to this box, behind the
      // state — so a land border reads as land rather than sprouting coast rings.
      if (box.contextLand) {
        const clipId = `dgmo-map-inset-clip-${bi}`;
        defs.append('clipPath').attr('id', clipId).append('path').attr('d', d);
        insetG
          .append('path')
          .attr('d', box.contextLand.d)
          .attr('fill', box.contextLand.fill)
          .attr('clip-path', `url(#${clipId})`);
      }
    });
    for (const r of layout.insetRegions) drawRegion(insetG, r, 0.5);

    // Inset coastline water-lines (AK/HI box interiors) for visual parity with
    // the main map. Mask = the inset box quads (white reveal) − inset regions
    // (black land / white lake); buffer+erode the inset region outer rings the
    // same way. Inside the inset group so it composites over the box fills.
    if (layout.coastlineStyle) {
      const cs = layout.coastlineStyle;
      const maskId = 'dgmo-map-inset-water-mask';
      const mask = defs
        .append('mask')
        .attr('id', maskId)
        .attr('maskUnits', 'userSpaceOnUse')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', width)
        .attr('height', height);
      // White reveal = the box interior, but eroded inward by `reach` (a black
      // border stroke) so the seaward rings fade out before the frame instead of
      // being hard-clipped at it — clipped ring fragments otherwise read as
      // artifacts bumping into the crisp 1px border. Mirrors the main-map moat,
      // applied inward.
      const reach = Math.max(0, ...cs.lines.map((l) => l.d + l.thickness));
      for (const box of layout.insets) {
        const d =
          box.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('') +
          'Z';
        mask
          .append('path')
          .attr('d', d)
          .attr('fill', 'white')
          .attr('stroke', 'black')
          .attr('stroke-width', 2 * reach)
          .attr('stroke-linejoin', 'round');
      }
      // Neighbour land masks as land too — clipped to its box so it can't darken
      // an adjacent inset — keeping the AK/Canada land border free of rings.
      layout.insets.forEach((box, bi) => {
        if (box.contextLand)
          mask
            .append('path')
            .attr('d', box.contextLand.d)
            .attr('fill', 'black')
            .attr('clip-path', `url(#dgmo-map-inset-clip-${bi})`);
      });
      for (const r of layout.insetRegions)
        if (r.id !== 'lake')
          mask.append('path').attr('d', r.d).attr('fill', 'black');
      for (const r of layout.insetRegions)
        if (r.id === 'lake')
          mask.append('path').attr('d', r.d).attr('fill', 'white');
      // Clip the water-line strokes to the inset box quads — the mask controls
      // which side reads as water, but SVG strokes still extend stroke-width/2
      // past their path, so without this the seaward rings bleed over the box
      // border. Union of all inset quads = one clipPath shared by the group.
      const clipId = 'dgmo-map-inset-water-clip';
      const clip = defs.append('clipPath').attr('id', clipId);
      for (const box of layout.insets) {
        const d =
          box.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('') +
          'Z';
        clip.append('path').attr('d', d);
      }
      // Nest clip (outer) + mask (inner) rather than both on one element —
      // WebKit (Tauri) renders the combined attributes inconsistently; the
      // nested form is honored by every engine.
      const gInsetWater = insetG
        .append('g')
        .attr('clip-path', `url(#${clipId})`)
        .append('g')
        .attr('class', 'dgmo-map-inset-water-lines')
        .attr('fill', 'none')
        .style('pointer-events', 'none') // decorative — pass hover to inset regions
        .attr('mask', `url(#${maskId})`);
      appendWaterLines(
        gInsetWater,
        defs,
        'dgmo-map-inset-coast',
        coastlineOuterRings(layout.insetRegions, cs.minExtent),
        cs,
        layout.background
      );
      // Restore the seaward half of the inset coast strokes (see main pass).
      for (const r of layout.insetRegions)
        gInsetWater
          .append('path')
          .attr('d', r.d)
          .attr('stroke', r.stroke)
          .attr('stroke-width', 0.5)
          .attr('stroke-linejoin', 'round');
    }

    // Re-stroke each inset frame ON TOP (stroke-only, no fill) as the final
    // inset layer — the early border path sits under the contextLand fill,
    // region fills, and water-lines, so its inner half gets covered near the
    // top/right edges and the frame reads as thin/fuzzy. This overlay keeps a
    // crisp full-width border on every side.
    for (const box of layout.insets) {
      const d =
        box.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('') +
        'Z';
      insetG
        .append('path')
        .attr('d', d)
        .attr('fill', 'none')
        .attr('stroke', mix(palette.text, palette.bg, 55))
        .attr('stroke-width', 1)
        .attr('stroke-linejoin', 'round')
        .style('pointer-events', 'none');
    }
  }

  // Code↔diagram sync: tag a synced element with its 1-based source line and,
  // in preview, make it jump the editor cursor on click. Source-derived elements
  // (regions, POIs, legs, labels) all carry `lineNumber`; generated context
  // labels use 0 as a "no source line" sentinel, so guard on `>= 1`.
  const wireSync = <E extends Element>(
    sel: d3Selection.Selection<E, unknown, null, undefined>,
    lineNumber: number
  ): void => {
    if (lineNumber < 1) return;
    sel.attr('data-line-number', lineNumber);
    if (onClickItem)
      sel.style('cursor', 'pointer').on('click', () => onClickItem(lineNumber));
  };

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
    // A 0-width invisible leg path is hard to hit; pointer-events on the visible
    // stroke is enough for the line widths legs use.
    wireSync(p, leg.lineNumber);
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
      const lt = emitText(
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
      wireSync(lt, leg.lineNumber);
    }
  });

  // ── Coincident-stack spider legs + hub (under the dots) ──
  // Legs + hub are DECORATIVE (`data-cluster-deco`, pointer-events none) — the app
  // toggles only their opacity. Drawn VISIBLE so export + the no-JS default show
  // the expanded fan. An invisible hit-area circle (interactive only) owns all
  // pointer interaction so hover/click drives the spiderfy controller robustly.
  // `no-cluster-pois` (or any export) keeps the fan permanently expanded: draw
  // the legs/hub/members visible but emit NO hit-area + NO badge, so there is
  // nothing for the app's spiderfy controller to collapse — the map reads the
  // same on screen as on paper.
  const clusterUi = !exportDims && !resolved.directives.noClusterPois;
  const gSpider = svg.append('g').attr('class', 'dgmo-map-spider');
  for (const cl of layout.clusters) {
    // Pointer hit-area — bottom of the stack so member dots still take their own
    // clicks (line-jump); clicks on the empty centre fall through to here.
    if (clusterUi) {
      gSpider
        .append('circle')
        .attr('cx', cl.cx)
        .attr('cy', cl.cy)
        .attr('r', cl.hitR)
        .attr('fill', 'transparent')
        .attr('data-cluster-hit', cl.id)
        .style('cursor', 'pointer');
    }
    for (const leg of cl.legs) {
      gSpider
        .append('line')
        .attr('x1', cl.cx)
        .attr('y1', cl.cy)
        .attr('x2', leg.x2)
        .attr('y2', leg.y2)
        .attr('stroke', leg.color)
        .attr('stroke-width', 1)
        .attr('data-cluster-deco', cl.id)
        .style('pointer-events', 'none');
    }
    // Faint neutral hub anchoring the legs (RQ3).
    gSpider
      .append('circle')
      .attr('cx', cl.cx)
      .attr('cy', cl.cy)
      .attr('r', 2)
      .attr('fill', mix(palette.textMuted, palette.bg, 40))
      .attr('data-cluster-deco', cl.id)
      .style('pointer-events', 'none');
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
      .attr('fill-opacity', poi.fillOpacity)
      .attr('stroke', poi.stroke)
      .attr('stroke-width', 1)
      .attr('data-line-number', poi.lineNumber)
      .attr('data-poi', poi.id);
    // Coincident-stack member: tag so the app hides it when collapsing the stack.
    if (poi.clusterId !== undefined)
      c.attr('data-cluster-member', poi.clusterId);
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
    // Hover-only labels: OMIT entirely from static export (export = the
    // hover-less default view); in preview emit invisible + flagged so the app
    // can reveal them on hover. They carry no leader, so the leader block below
    // is skipped naturally.
    if (lab.hidden) {
      if (exportDims) continue;
      emitText(
        gLabels,
        lab.x,
        lab.y,
        lab.text,
        lab.anchor,
        lab.color,
        lab.haloColor,
        lab.halo,
        LABEL_FONT,
        lab.italic,
        lab.letterSpacing
      )
        .attr('data-poi', lab.poiId ?? null)
        .attr('data-poi-hidden', '')
        .style('opacity', 0)
        .style('pointer-events', 'none');
      continue;
    }
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
      // Spiderfy member leader: toggle it with the badge (same as its text).
      if (lab.clusterMember !== undefined)
        line.attr('data-cluster-member', lab.clusterMember);
      wireSync(line, lab.lineNumber);
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
      LABEL_FONT,
      lab.italic,
      lab.letterSpacing,
      lab.lines
    );
    // POI labels are spotlightable: tag with the POI id and make the text the
    // hover target (the app dims the other dots/labels on enter).
    if (lab.poiId !== undefined) {
      t.attr('data-poi', lab.poiId).style('cursor', 'default');
    }
    // Coincident-stack member label: hidden by the app when its stack collapses.
    if (lab.clusterMember !== undefined) {
      t.attr('data-cluster-member', lab.clusterMember);
    }
    // Click a region/POI label to jump to its source line (sets cursor:pointer,
    // overriding the default above for POI labels).
    wireSync(t, lab.lineNumber);
  }

  // ── Coincident-stack badges (collapsed view). Interactive ONLY — a static
  // export keeps the expanded fan (every label visible), so no badge there. A
  // neutral dot ringed with the bare member count, emitted hidden; the app shows
  // it at rest and hides it (revealing the spider) on click. ──
  if (clusterUi && layout.clusters.length) {
    const gBadge = svg.append('g').attr('class', 'dgmo-map-cluster-badges');
    for (const cl of layout.clusters) {
      // Decorative: the hit-area (drawn under the dots) owns hover + click; the
      // badge just shows the count, so it never intercepts pointer events.
      const g = gBadge
        .append('g')
        .attr('data-cluster', cl.id)
        .style('opacity', 0)
        .style('pointer-events', 'none');
      const R = 9;
      // Inner neutral disc + outer ring → reads as "more than one here" (RQ2).
      g.append('circle')
        .attr('cx', cl.cx)
        .attr('cy', cl.cy)
        .attr('r', R)
        .attr('fill', mix(palette.textMuted, palette.bg, 35))
        .attr('stroke', palette.textMuted)
        .attr('stroke-width', 1);
      g.append('circle')
        .attr('cx', cl.cx)
        .attr('cy', cl.cy)
        .attr('r', R + 2.5)
        .attr('fill', 'none')
        .attr('stroke', palette.textMuted)
        .attr('stroke-width', 1);
      // Directional colour beads: one small dot threaded on the outer ring per
      // member, placed at the ANGLE of that member's spider leg (centroid → its
      // expanded position) and filled with the member's own marker colour. So the
      // collapsed badge previews WHAT is stacked here and roughly WHERE each item
      // will fan out, before the spider opens. A bg-coloured halo keeps adjacent
      // beads + the ring line legible.
      const beadR = R + 2.5;
      for (const leg of cl.legs) {
        const a = Math.atan2(leg.y2 - cl.cy, leg.x2 - cl.cx);
        g.append('circle')
          .attr('class', 'dgmo-map-cluster-bead')
          .attr('cx', cl.cx + beadR * Math.cos(a))
          .attr('cy', cl.cy + beadR * Math.sin(a))
          .attr('r', 1.8)
          .attr('fill', leg.color)
          .attr('stroke', palette.bg)
          .attr('stroke-width', 0.5);
      }
      // Bare count (RQ1).
      emitText(
        g,
        cl.cx,
        cl.cy + 3,
        String(cl.count),
        'middle',
        palette.text,
        palette.bg,
        false,
        LABEL_FONT
      );
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
    // Built from the shared helper so the drawn legend matches the band the
    // layout reserved for it (see legend-band.ts).
    const groups = mapLegendGroups(layout.legend);
    if (groups.length > 0) {
      const config: LegendConfig = mapLegendConfig(
        groups,
        exportDims ? 'export' : 'preview'
      );
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
  fontSize: number,
  italic?: boolean,
  letterSpacing?: number,
  lines?: readonly string[]
): d3Selection.Selection<SVGTextElement, unknown, null, undefined> {
  const t = g
    .append('text')
    .attr('x', x)
    .attr('y', y)
    .attr('text-anchor', anchor)
    .attr('font-size', fontSize)
    .attr('fill', color);
  // Multi-line context labels (water names): stack centred tspans around `y` so
  // the block's vertical centre matches the placement rect. Single-line keeps the
  // bare `.text()` form so every other call site stays byte-identical.
  if (lines && lines.length > 1) {
    const lineHeight = fontSize + 2; // MUST match context-labels LINE_HEIGHT
    const startDy = -((lines.length - 1) / 2) * lineHeight;
    lines.forEach((ln, i) => {
      t.append('tspan')
        .attr('x', x)
        .attr('dy', i === 0 ? startDy : lineHeight)
        .text(ln);
    });
  } else {
    t.text(text);
  }
  // Cartographic styling for context labels; absent on every other call site so
  // existing output stays byte-identical (only emitted when explicitly set).
  if (italic) t.attr('font-style', 'italic');
  if (letterSpacing) t.attr('letter-spacing', letterSpacing);
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
