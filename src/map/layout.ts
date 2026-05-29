// Layout (step 4, part 1): ResolvedMap + MapData -> MapLayout. PURE + SYNC +
// DETERMINISTIC -- no DOM, no Math.random/Date. Decodes the basemap topology,
// builds the d3-geo projection chosen by the resolver, fits it to the screen,
// projects POIs/routes/edges, computes choropleth + categorical fills, scales
// POI radii + edge widths, and places labels with per-cluster collision
// escalation. The SVG emission is renderer.ts (it only draws what we compute).
// See spec section 24B.3-.7/.11 + the tech-spec Adversarial Review Resolutions AR1-AR9.
import {
  geoPath,
  geoNaturalEarth1,
  geoAlbersUsa,
  geoMercator,
  type GeoProjection,
  type GeoPath,
} from 'd3-geo';
import { feature } from 'topojson-client';
import { mix, shapeFill, contrastText } from '../palettes/color-utils';
import type { PaletteColors } from '../palettes/types';
import { resolveActiveTagGroup } from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import { rectsOverlap, rectCircleOverlap } from '../label-layout';
import type { LabelRect, PointCircle } from '../label-layout';
import { measureLegendText } from '../utils/legend-constants';
import type { BoundaryTopology } from './data/types';
import type {
  MapData,
  ResolvedMap,
  ResolvedPoi,
  ResolvedEdge,
  ProjectionFamily,
} from './resolved-types';

// Minimal GeoJSON shapes (avoid a hard @types/geojson dep; cast at d3 calls).
interface GeoFeature {
  type: 'Feature';
  id?: string | number;
  properties: unknown;
  geometry: unknown;
}
interface GeoFC {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

// -- Tunable constants (deterministic; no magic at call sites) --
const FIT_PAD = 24; // px padding inside the viewport
const RAMP_FLOOR = 15; // % tint floor so min still reads as "low, present" (24B.3)
const R_DEFAULT = 6; // POI radius without size:
const R_MIN = 4;
const R_MAX = 22;
const W_MIN = 1.25; // edge stroke width
const W_MAX = 8;
const FONT = 11; // on-map label font px
const LEADER_STEP = 14; // px ring radius step for label escalation
const COLO_EPS = 1.5; // px: POIs closer than this are "co-located"
const COLO_R = 9; // spiderfy radius
const GOLDEN_ANGLE = 2.399963229728653; // rad (137.5deg) -- even spiral, no random
const FAN_STEP = 16; // px perpendicular offset between parallel edges
const TINY_REGION_AREA = 600; // px^2: region label auto-hidden below this
const ARC_CURVE_FRAC = 0.18; // default arc bow as a fraction of leg length

// Fixed candidate ring for label escalation (E, S, W, N, then diagonals).
const RING_DIRS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

export interface MapLayoutRegion {
  readonly id: string; // iso
  readonly d: string; // SVG path data
  readonly fill: string;
  readonly stroke: string;
  readonly label?: string;
  readonly lineNumber: number;
  readonly layer: 'base' | 'country' | 'us-state';
}

export interface MapLayoutPoi {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly fill: string;
  readonly stroke: string;
  readonly lineNumber: number;
  readonly implicit: boolean;
  readonly isOrigin: boolean; // route origin -> distinct marker
  readonly routeNumber?: number; // route stop badge
}

/** A drawn connector -- an edge or a route leg (same geometry contract). */
export interface MapLayoutLeg {
  readonly d: string;
  readonly width: number;
  readonly color: string;
  readonly arrow: boolean;
  readonly label?: string;
  readonly labelX?: number;
  readonly labelY?: number;
  readonly lineNumber: number;
}

export interface PlacedLabel {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly color: string;
  readonly halo: boolean;
  readonly leader?: { x1: number; y1: number; x2: number; y2: number };
  readonly pin?: number; // numbered-pin fallback
  readonly lineNumber: number;
}

export interface MapLayoutLegend {
  readonly tagGroups: ReadonlyArray<{
    name: string;
    entries: ReadonlyArray<{ value: string; color: string }>;
  }>;
  readonly activeGroup: string | null;
  readonly ramp?: { metric?: string; min: number; max: number; hue: string };
  readonly size?: { metric?: string; min: number; max: number };
  readonly weight?: { metric?: string; min: number; max: number };
}

export interface MapLayout {
  readonly width: number;
  readonly height: number;
  readonly background: string;
  readonly title: string | null;
  readonly subtitle?: string;
  readonly caption?: string;
  readonly regions: readonly MapLayoutRegion[];
  readonly legs: readonly MapLayoutLeg[];
  readonly pois: readonly MapLayoutPoi[];
  readonly labels: readonly PlacedLabel[];
  /** Numbered-pin fallback legend list (pin -> label). */
  readonly pinList: ReadonlyArray<{ pin: number; label: string }>;
  readonly legend: MapLayoutLegend | null;
}

export interface LayoutOptions {
  readonly palette: PaletteColors;
  readonly isDark: boolean;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/** The single geometry object of a step-1 topology (`countries` | `states`). */
function geomObject(topo: BoundaryTopology): {
  geometries: BoundaryTopology['objects'][string]['geometries'];
} {
  const key = Object.keys(topo.objects)[0]!;
  return topo.objects[key]!;
}

/** Decode every feature of a topology into GeoJSON, keyed by ISO id. */
function decodeLayer(topo: BoundaryTopology): Map<string, GeoFeature> {
  const out = new Map<string, GeoFeature>();
  for (const g of geomObject(topo).geometries) {
    const f = feature(topo as never, g as never) as unknown as GeoFeature;
    out.set(g.id, { ...f, id: g.id });
  }
  return out;
}

function projectionFor(family: ProjectionFamily): GeoProjection {
  switch (family) {
    case 'albers-usa':
      return geoAlbersUsa();
    case 'mercator':
      return geoMercator();
    case 'natural-earth':
    default:
      return geoNaturalEarth1();
  }
}

export function layoutMap(
  resolved: ResolvedMap,
  data: MapData,
  size: Size,
  opts: LayoutOptions
): MapLayout {
  const { palette, isDark } = opts;
  const { width, height } = size;

  // -- Basemap decode --
  const worldTopo =
    resolved.basemaps.world === 'detail' ? data.worldDetail : data.worldCoarse;
  const worldLayer = decodeLayer(worldTopo);
  const usLayer = resolved.basemaps.subdivisions.includes('us-states')
    ? decodeLayer(data.usStates)
    : null;

  const neutralFill = mix(palette.border, palette.bg, 32);
  const regionStroke = mix(palette.border, palette.bg, 70);

  // -- Region fill model (choropleth + categorical; AR4/AR6) --
  const scores = resolved.regions
    .filter((r) => r.score !== undefined)
    .map((r) => r.score!);
  const scaleOverride = resolved.directives.scale;
  const rampMin = scaleOverride ? scaleOverride.min : Math.min(...scores);
  const rampMax = scaleOverride ? scaleOverride.max : Math.max(...scores);
  const rampHue = palette.primary;
  const hasRamp = scores.length > 0;

  const activeGroup = resolveActiveTagGroup(
    resolved.tagGroups as TagGroup[],
    resolved.directives.activeTag
  );

  const fillForScore = (s: number): string => {
    const t = rampMax > rampMin ? (s - rampMin) / (rampMax - rampMin) : 1;
    const pct = RAMP_FLOOR + Math.max(0, Math.min(1, t)) * (100 - RAMP_FLOOR);
    return mix(rampHue, isDark ? palette.surface : palette.bg, pct);
  };

  /** Resolve a tag value (name) -> tinted hex via a declared group, or null. */
  const tagFill = (
    tags: Readonly<Record<string, string>>,
    groupName: string | null
  ): string | null => {
    if (!groupName) return null;
    const group = resolved.tagGroups.find(
      (g) => g.name.toLowerCase() === groupName.toLowerCase()
    );
    if (!group) return null;
    const val = tags[group.name.toLowerCase()] ?? group.defaultValue;
    if (!val) return null;
    const entry = group.entries.find(
      (e) => e.value.toLowerCase() === val.toLowerCase()
    );
    // The map parser pre-resolves tag colors to hex at parse time
    // (extractColor); entry.color is already a hex string, NOT a name — so it
    // is used directly (do NOT run it through resolveColor, which rejects `#`).
    // An unknown tag VALUE (no matching entry) falls back to neutral (AR4/AC25).
    if (!entry?.color) return null;
    return shapeFill(palette, entry.color, isDark); // 25% tint, never solid by default
  };

  const regionById = new Map(resolved.regions.map((r) => [r.iso, r]));

  // -- Projection + fit (AR2, refined) --
  // The drawn region polygons drive an albers fit; for world projections we fit
  // to the resolver's (padded, never-degenerate) extent box — fitting to raw
  // drawn points would collapse to a zero-size target (single/coincident POIs →
  // Infinity scale → NaN). albers-usa is US-only with AK/HI insets, so a
  // geographic bbox is wrong there — fit to the actual US features instead, and
  // fall back to the whole-US base when only POIs are present.
  const regionFeatures: GeoFeature[] = [];
  for (const r of resolved.regions) {
    const f =
      r.layer === 'us-state' ? usLayer?.get(r.iso) : worldLayer.get(r.iso);
    if (f) regionFeatures.push(f);
  }
  // The extent's four CORNERS as a MultiPoint — NOT a Polygon. A hand-built
  // lat/lon rectangle's spherical winding is ambiguous to d3-geo, which can
  // read it as the whole-globe complement (→ tiny content framed on a world
  // map). Corner points have no interior/winding ambiguity, so fitExtent frames
  // exactly the extent box.
  const extentCorners = (): GeoFeature => {
    const [[w, s], [e, n]] = resolved.extent;
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
        ],
      },
    };
  };

  let fitFeatures: GeoFeature[];
  if (resolved.projection === 'albers-usa') {
    if (regionFeatures.length > 0) fitFeatures = regionFeatures;
    else if (usLayer) fitFeatures = [...usLayer.values()];
    else {
      const us = worldLayer.get('US');
      fitFeatures = us ? [us] : [...worldLayer.values()];
    }
  } else {
    fitFeatures = [extentCorners()];
  }
  const fitTarget: GeoFC = { type: 'FeatureCollection', features: fitFeatures };

  const projection = projectionFor(resolved.projection);
  // mercator / natural-earth: rotate to the extent's center longitude BEFORE
  // fitting (rotate changes the bounds fitExtent measures). albers-usa is a
  // US-only composite with NO .rotate -- never call it (AR2).
  if (resolved.projection !== 'albers-usa') {
    let centerLon = (resolved.extent[0][0] + resolved.extent[1][0]) / 2;
    if (centerLon > 180) centerLon -= 360;
    projection.rotate([-centerLon, 0]);
  }
  projection.fitExtent(
    [
      [FIT_PAD, FIT_PAD],
      [
        Math.max(FIT_PAD + 1, width - FIT_PAD),
        Math.max(FIT_PAD + 1, height - FIT_PAD),
      ],
    ],
    fitTarget as never
  );
  const path: GeoPath = geoPath(projection);
  const project = (lon: number, lat: number): [number, number] | null =>
    projection([lon, lat]) ?? null;

  // -- Regions: base layer (neutral) then resolved fills on top --
  const regions: MapLayoutRegion[] = [];
  const pushRegionLayer = (
    layerFeatures: Map<string, GeoFeature>,
    layerKind: 'country' | 'us-state'
  ): void => {
    for (const [iso, f] of layerFeatures) {
      const d = path(f as never) ?? '';
      if (!d) continue;
      const r = regionById.get(iso);
      const isThisLayer = r?.layer === layerKind;
      let fill = neutralFill;
      let label: string | undefined;
      let lineNumber = -1;
      let layer: MapLayoutRegion['layer'] = 'base';
      if (isThisLayer) {
        // score wins over tag (24B.4 / AR4)
        if (r.score !== undefined) fill = fillForScore(r.score);
        else fill = tagFill(r.tags, activeGroup) ?? neutralFill;
        lineNumber = r.lineNumber;
        layer = layerKind;
        label = r.name;
      }
      regions.push({
        id: iso,
        d,
        fill,
        stroke: regionStroke,
        lineNumber,
        layer,
        ...(label !== undefined && { label }),
      });
    }
  };
  pushRegionLayer(worldLayer, 'country');
  if (usLayer) pushRegionLayer(usLayer, 'us-state');

  // -- POIs: project, size-scale, co-located spiderfy --
  const sizeVals = resolved.pois
    .map((p) => Number(p.meta['size']))
    .filter((n) => Number.isFinite(n) && n > 0);
  const sizeMin = sizeVals.length ? Math.min(...sizeVals) : 0;
  const sizeMax = sizeVals.length ? Math.max(...sizeVals) : 0;
  const radiusFor = (p: ResolvedPoi): number => {
    const v = Number(p.meta['size']);
    if (!Number.isFinite(v) || v <= 0 || sizeMax <= 0) return R_DEFAULT;
    // sqrt so AREA encodes the value
    const t =
      sizeMax > sizeMin
        ? (Math.sqrt(v) - Math.sqrt(sizeMin)) /
          (Math.sqrt(sizeMax) - Math.sqrt(sizeMin))
        : 1;
    return R_MIN + Math.max(0, Math.min(1, t)) * (R_MAX - R_MIN);
  };

  // POI tag color: FIRST declared group for which the POI has a value (AR4).
  const poiFill = (p: ResolvedPoi): { fill: string; stroke: string } => {
    for (const group of resolved.tagGroups) {
      const val = p.tags[group.name.toLowerCase()];
      if (!val) continue;
      const entry = group.entries.find(
        (e) => e.value.toLowerCase() === val.toLowerCase()
      );
      const hex = entry?.color; // already hex (parser-resolved)
      if (hex) return { fill: hex, stroke: mix(hex, palette.text, 18) };
    }
    return {
      fill: palette.accent,
      stroke: mix(palette.accent, palette.text, 18),
    };
  };

  // Route metadata first so POIs know origin/number.
  const routeNumberById = new Map<string, number>();
  const originIds = new Set<string>();
  for (const rt of resolved.routes) {
    rt.stopIds.forEach((id, i) => {
      if (i === 0) originIds.add(id);
      if (!routeNumberById.has(id)) routeNumberById.set(id, i + 1);
    });
  }

  const poiScreen = new Map<string, { cx: number; cy: number }>();
  const pois: MapLayoutPoi[] = [];
  // Stable order for deterministic co-location indices (AR9).
  const orderedPois = [...resolved.pois].sort(
    (a, b) => a.lineNumber - b.lineNumber || (a.id < b.id ? -1 : 1)
  );
  interface Proj {
    p: ResolvedPoi;
    xy: [number, number];
  }
  const projected: Proj[] = [];
  for (const p of orderedPois) {
    const xy = project(p.lon, p.lat);
    if (xy) projected.push({ p, xy });
  }
  const coloGroups = new Map<string, Proj[]>();
  for (const e of projected) {
    const key = `${Math.round(e.xy[0] / COLO_EPS)},${Math.round(e.xy[1] / COLO_EPS)}`;
    const arr = coloGroups.get(key);
    if (arr) arr.push(e);
    else coloGroups.set(key, [e]);
  }
  for (const group of coloGroups.values()) {
    group.forEach((e, i) => {
      let cx = e.xy[0];
      let cy = e.xy[1];
      if (group.length > 1) {
        const ang = i * GOLDEN_ANGLE;
        cx += Math.cos(ang) * COLO_R;
        cy += Math.sin(ang) * COLO_R;
      }
      const { fill, stroke } = poiFill(e.p);
      poiScreen.set(e.p.id, { cx, cy });
      const num = routeNumberById.get(e.p.id);
      pois.push({
        id: e.p.id,
        cx,
        cy,
        r: radiusFor(e.p),
        fill,
        stroke,
        lineNumber: e.p.lineNumber,
        implicit: !!e.p.implicit,
        isOrigin: originIds.has(e.p.id),
        ...(num !== undefined && { routeNumber: num }),
      });
    });
  }

  // -- Connectors: routes + edges (with parallel fan-out) --
  const legs: MapLayoutLeg[] = [];
  const legPath = (
    a: { cx: number; cy: number },
    b: { cx: number; cy: number },
    curved: boolean,
    offset: number
  ): string => {
    if (!curved && offset === 0) return `M${a.cx},${a.cy}L${b.cx},${b.cy}`;
    const mx = (a.cx + b.cx) / 2;
    const my = (a.cy + b.cy) / 2;
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const bow = offset !== 0 ? offset : len * ARC_CURVE_FRAC;
    return `M${a.cx},${a.cy}Q${mx + nx * bow},${my + ny * bow} ${b.cx},${b.cy}`;
  };

  // Routes: legs between consecutive stops (loop closing leg included).
  for (const rt of resolved.routes) {
    const curved = rt.meta['style'] === 'arc';
    for (let i = 1; i < rt.stopIds.length; i++) {
      const a = poiScreen.get(rt.stopIds[i - 1]!);
      const b = poiScreen.get(rt.stopIds[i]!);
      if (!a || !b) continue;
      legs.push({
        d: legPath(a, b, curved, 0),
        width: W_MIN,
        color: mix(palette.text, palette.bg, 55),
        arrow: true,
        lineNumber: rt.lineNumber,
      });
    }
  }

  // Edges: group by unordered endpoint pair for deterministic fan-out (AR9).
  const weightVals = resolved.edges
    .map((e) => Number(e.meta['weight']))
    .filter((n) => Number.isFinite(n) && n > 0);
  const wMin = weightVals.length ? Math.min(...weightVals) : 0;
  const wMax = weightVals.length ? Math.max(...weightVals) : 0;
  const widthFor = (e: ResolvedEdge): number => {
    const v = Number(e.meta['weight']);
    if (!Number.isFinite(v) || v <= 0 || wMax <= 0) return W_MIN;
    const t = wMax > wMin ? (v - wMin) / (wMax - wMin) : 1;
    return W_MIN + t * (W_MAX - W_MIN);
  };
  const pairGroups = new Map<string, ResolvedEdge[]>();
  for (const e of resolved.edges) {
    const key = [e.fromId, e.toId].sort().join(' ');
    const arr = pairGroups.get(key);
    if (arr) arr.push(e);
    else pairGroups.set(key, [e]);
  }
  for (const groupEdges of pairGroups.values()) {
    const ordered = [...groupEdges].sort((a, b) => a.lineNumber - b.lineNumber);
    const n = ordered.length;
    ordered.forEach((e, i) => {
      const a = poiScreen.get(e.fromId);
      const b = poiScreen.get(e.toId);
      if (!a || !b) return;
      const curved = e.style === 'arc' || n > 1;
      const offset = n > 1 ? (i - (n - 1) / 2) * FAN_STEP : 0;
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy + b.cy) / 2;
      legs.push({
        d: legPath(a, b, curved, offset),
        width: widthFor(e),
        color: mix(palette.text, palette.bg, 45),
        arrow: e.directed,
        lineNumber: e.lineNumber,
        ...(e.label !== undefined && {
          label: e.label,
          labelX: mx,
          labelY: my - 4,
        }),
      });
    });
  }

  // -- Labels: regions + POIs with escalation (AR5) --
  const labels: PlacedLabel[] = [];
  const pinList: { pin: number; label: string }[] = [];
  const obstacles: LabelRect[] = [];
  const markers: PointCircle[] = pois.map((p) => ({
    cx: p.cx,
    cy: p.cy,
    r: p.r,
  }));
  const collides = (rect: LabelRect): boolean =>
    markers.some((m) => rectCircleOverlap(rect, m)) ||
    obstacles.some((o) => rectsOverlap(rect, o));

  // Region labels (default off; auto-hide tiny).
  const regionLabelMode = resolved.directives.regionLabels ?? 'off';
  if (regionLabelMode === 'full' || regionLabelMode === 'abbrev') {
    for (const r of regions) {
      if (r.layer === 'base' || r.label === undefined) continue;
      const f =
        r.layer === 'us-state' ? usLayer?.get(r.id) : worldLayer.get(r.id);
      if (!f) continue;
      const [[x0, y0], [x1, y1]] = path.bounds(f as never);
      if ((x1 - x0) * (y1 - y0) < TINY_REGION_AREA) continue; // auto-hide
      const c = path.centroid(f as never);
      if (!Number.isFinite(c[0])) continue;
      const text =
        regionLabelMode === 'abbrev' ? r.id.replace(/^US-/, '') : r.label;
      labels.push({
        x: c[0],
        y: c[1],
        text,
        anchor: 'middle',
        color: contrastText(
          r.fill,
          palette.textOnFillLight,
          palette.textOnFillDark
        ),
        halo: true,
        lineNumber: r.lineNumber,
      });
    }
  }

  // POI labels (default auto; off -> none; all -> every POI).
  const poiLabelMode = resolved.directives.poiLabels ?? 'auto';
  if (poiLabelMode !== 'off') {
    const ordered = [...pois].sort(
      (a, b) => a.lineNumber - b.lineNumber || (a.id < b.id ? -1 : 1)
    );
    const poiById = new Map(resolved.pois.map((q) => [q.id, q]));
    const labelText = (p: MapLayoutPoi): string => {
      const src = poiById.get(p.id);
      return src?.label ?? src?.name ?? p.id;
    };
    let pinCounter = 0;
    for (const p of ordered) {
      const text = labelText(p);
      const w = measureLegendText(text, FONT);
      const h = FONT * 1.25;
      const inline: LabelRect = { x: p.cx + p.r + 3, y: p.cy - h / 2, w, h };
      if (!collides(inline)) {
        obstacles.push(inline);
        labels.push({
          x: inline.x,
          y: p.cy + FONT / 3,
          text,
          anchor: 'start',
          color: palette.text,
          halo: true,
          lineNumber: p.lineNumber,
        });
        continue;
      }
      // Escalate: fixed candidate ring -> leader line to first free slot.
      let placed = false;
      for (let k = 1; k <= 2 && !placed; k++) {
        for (const [dx, dy] of RING_DIRS) {
          const cx = p.cx + dx * LEADER_STEP * k;
          const cy = p.cy + dy * LEADER_STEP * k;
          const rect: LabelRect = {
            x: dx >= 0 ? cx : cx - w,
            y: cy - h / 2,
            w,
            h,
          };
          // Keep escalated labels on-canvas (#8) and collision-free.
          if (
            rect.x < 0 ||
            rect.x + rect.w > width ||
            rect.y < 0 ||
            rect.y + rect.h > height
          ) {
            continue;
          }
          if (collides(rect)) continue;
          obstacles.push(rect);
          labels.push({
            x: cx,
            y: cy + FONT / 3,
            text,
            anchor: dx >= 0 ? 'start' : 'end',
            color: palette.text,
            halo: true,
            leader: { x1: p.cx, y1: p.cy, x2: cx, y2: cy },
            lineNumber: p.lineNumber,
          });
          placed = true;
          break;
        }
      }
      if (placed) continue;
      // Final fallback: numbered pin + legend list entry.
      pinCounter += 1;
      pinList.push({ pin: pinCounter, label: text });
      labels.push({
        x: p.cx + p.r + 2,
        y: p.cy - p.r,
        text: String(pinCounter),
        anchor: 'start',
        color: palette.text,
        halo: true,
        pin: pinCounter,
        lineNumber: p.lineNumber,
      });
    }
  }

  // -- Legend model (AR1: categorical via renderer's renderLegendD3) --
  let legend: MapLayoutLegend | null = null;
  if (!resolved.directives.noLegend) {
    const tagGroups = resolved.tagGroups.map((g) => ({
      name: g.name,
      entries: g.entries.map((e) => ({ value: e.value, color: e.color })),
    }));
    const hasAnything =
      tagGroups.length > 0 ||
      hasRamp ||
      sizeVals.length > 0 ||
      weightVals.length > 0;
    if (hasAnything) {
      legend = {
        tagGroups,
        activeGroup,
        ...(hasRamp && {
          ramp: {
            ...(resolved.directives.metric !== undefined && {
              metric: resolved.directives.metric,
            }),
            min: rampMin,
            max: rampMax,
            hue: rampHue,
          },
        }),
        ...(sizeVals.length > 0 && {
          size: {
            ...(resolved.directives.sizeMetric !== undefined && {
              metric: resolved.directives.sizeMetric,
            }),
            min: sizeMin,
            max: sizeMax,
          },
        }),
        ...(weightVals.length > 0 && {
          weight: { min: wMin, max: wMax },
        }),
      };
    }
  }

  return {
    width,
    height,
    background: palette.bg,
    title: resolved.title,
    ...(resolved.subtitle !== undefined && { subtitle: resolved.subtitle }),
    ...(resolved.caption !== undefined && { caption: resolved.caption }),
    regions,
    legs,
    pois,
    labels,
    pinList,
    legend,
  };
}
