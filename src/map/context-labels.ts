// Context-label placement (step 4, part of layout). Produces a sparse,
// density-thinned ORIENTATION layer — water-body names + unreferenced notable
// country names — distinct from `region-labels`. PURE + SYNC + DETERMINISTIC.
//
// Design (tech-spec §map-context-labels): a deliberately LOW per-view label
// BUDGET is the primary noise lever; a span-derived TIER BAND orders candidates
// into it; each candidate is committed only if it survives COLLISION against
// every already-placed data/region/POI/route label (the `collides` closure) AND
// the other context labels. Context labels place DEAD LAST and never displace
// data — they only fill leftover space, degrading gracefully to zero. See
// Decisions 6 (budget), 7 (dead-last), 8 (viewport/projection guards).
import { mix } from '../palettes/color-utils';
import type { PaletteColors } from '../palettes/types';
import type { LabelRect } from '../label-layout';
import { measureLegendText } from '../utils/legend-constants';
import type { ProjectionFamily } from './resolved-types';
import type { WaterBodies, WaterKind } from './data/types';
import type { PlacedLabel } from './layout';

/** A view span band → priority ordering (NOT a hard zoom cutoff, Decision 6). */
export type TierBand = 'world' | 'continental' | 'regional' | 'local';

/** An unreferenced country, pre-projected by layout (geo work stays in layout;
 *  area-rank + name-fit + collision live here so the module is unit-testable). */
export interface CountryCandidate {
  readonly iso: string;
  readonly name: string;
  /** Projected screen bbox `[x0, y0, x1, y1]` (from `path.bounds`). */
  readonly bbox: readonly [number, number, number, number];
  /** Projected screen anchor `[x, y]` (mainland anchor or `path.centroid`), or
   *  null when the feature doesn't project to a finite point. */
  readonly anchor: readonly [number, number] | null;
}

export interface ContextLabelArgs {
  readonly projection: ProjectionFamily;
  readonly dLonSpan: number;
  readonly dLatSpan: number;
  readonly width: number;
  readonly height: number;
  readonly waterBodies?: WaterBodies | undefined;
  readonly countries: readonly CountryCandidate[];
  /** `region-labels` mode — context country names inherit `abbrev` (Decision 3). */
  readonly regionLabels: string;
  readonly palette: PaletteColors;
  readonly project: (lon: number, lat: number) => [number, number] | null;
  /** Collision test against every committed data/region/POI/route obstacle. */
  readonly collides: (rect: LabelRect) => boolean;
  /** True when the screen point sits over LAND (a country/state fill) rather than
   *  open water. WATER labels are rejected when their footprint touches land — an
   *  ocean name belongs over the ocean (they're optional orientation aids, so drop
   *  rather than misplace). Country labels are exempt (they label land). Optional
   *  for unit tests; absent ⇒ no land rejection. */
  readonly overLand?: (x: number, y: number) => boolean;
}

const FONT = 11; // matches layout's on-map label font
const PADX = 4; // half-padding around a context label rect
const PADY = 3;
const WATER_LETTER_SPACING = 1.5; // px — cartographic spread for water names
const CONTEXT_PAD = 4; // extra gap enforced between two context labels
const EDGE_CLAMP_MARGIN = 8; // px inset for edge-clamped ocean labels
const EDGE_CLAMP_OVERSHOOT = 0.35; // max off-frame overshoot (× dim) to still clamp

// Water-kind priority within a tier (oceans first, then seas, then the rest) so
// a thin budget always spends on the highest-orientation-value names.
const KIND_ORDER: Record<WaterKind, number> = {
  ocean: 0,
  sea: 1,
  gulf: 2,
  bay: 3,
  strait: 4,
  channel: 5,
  sound: 6,
};

/** Span band from the larger of the two view spans (Decision 6 — priority, not
 *  a hard gate). */
export function tierBand(maxSpanDeg: number): TierBand {
  if (maxSpanDeg >= 90) return 'world';
  if (maxSpanDeg >= 20) return 'continental';
  if (maxSpanDeg >= 5) return 'regional';
  return 'local';
}

/** Deliberately-LOW combined label budget = f(canvas area, band). Floors to ~1
 *  on a thumbnail and 0 on a tiny canvas (Decision 6, ADR-3; AC9). Caps the
 *  TOTAL context labels (water + country), so `relief`/data don't get extra
 *  headroom (Decision 13). */
export function labelBudget(
  width: number,
  height: number,
  band: TierBand
): number {
  const bandCap: Record<TierBand, number> = {
    world: 6,
    continental: 5,
    regional: 4,
    local: 3,
  };
  const area = Math.floor(Math.sqrt(Math.max(0, width * height)) / 150);
  return Math.max(0, Math.min(area, bandCap[band]));
}

/** Which water tiers/kinds are eligible at a band. World view is oceans + major
 *  seas ONLY (never bays/sounds/minor gulfs, AC3); broader views progressively
 *  admit smaller features by `scalerank` (AC4). */
function waterEligible(tier: number, kind: WaterKind, band: TierBand): boolean {
  switch (band) {
    case 'world':
      return tier <= 1 && (kind === 'ocean' || kind === 'sea');
    case 'continental':
      return tier <= 2;
    case 'regional':
      return tier <= 3;
    case 'local':
      return tier <= 4;
  }
}

function insideViewport(
  p: readonly [number, number] | null,
  width: number,
  height: number
): p is [number, number] {
  return (
    !!p &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= 0 &&
    p[0] <= width &&
    p[1] >= 0 &&
    p[1] <= height
  );
}

/** Rendered label width INCLUDING letter-spacing — `measureLegendText` ignores
 *  the per-gap `letter-spacing` the renderer applies to water names, so without
 *  this the fit/clamp math under-measures by ~`(len-1)*spacing` and the label
 *  clips at the canvas edge. */
export function labelWidth(text: string, letterSpacing: number): number {
  const spacing =
    letterSpacing > 0 ? Math.max(0, text.length - 1) * letterSpacing : 0;
  return measureLegendText(text, FONT) + spacing + 2 * PADX;
}

function rectAround(
  cx: number,
  cy: number,
  text: string,
  letterSpacing: number
): LabelRect {
  const w = labelWidth(text, letterSpacing);
  const h = FONT + 2 * PADY;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function rectFits(r: LabelRect, width: number, height: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height;
}

function overlapsPadded(a: LabelRect, b: LabelRect, pad: number): boolean {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

/** Place the orientation backdrop. Returns committed labels in priority order;
 *  caller pushes them onto `labels` LAST so they never displace data. */
export function placeContextLabels(args: ContextLabelArgs): PlacedLabel[] {
  const {
    projection,
    dLonSpan,
    dLatSpan,
    width,
    height,
    waterBodies,
    countries,
    regionLabels,
    palette,
    project,
    collides,
    overLand,
  } = args;

  // albers-usa is supported: the CONUS conic projects CONUS-area water (Gulf of
  // America, the Pacific/Atlantic margins) correctly, and the viewport-visibility
  // check below drops the off-frame anchors (Gulf of Alaska, mid-Pacific) that the
  // AK/HI inset relocation would otherwise mislabel. The caller additionally feeds
  // the AK/HI inset frames into `collides` so a label never lands on an inset box.
  // (Supersedes the original blanket albers-usa disable — the US map is the
  // flagship orientation case.)
  void projection;

  const band = tierBand(Math.max(dLonSpan, dLatSpan));
  const budget = labelBudget(width, height, band);
  if (budget <= 0) return [];

  // Subordinate cartographic colours (palette-derived, no hex; resvg-safe via
  // pre-computed mix()). Water = muted blue-gray italic; country = muted gray.
  const waterColor = mix(palette.colors.blue, palette.textMuted, 50);
  const countryColor = palette.textMuted;
  const haloColor = palette.bg;

  type Candidate = {
    text: string;
    cx: number;
    cy: number;
    italic: boolean;
    letterSpacing: number;
    color: string;
    sort: number; // priority key (lower first)
  };
  const candidates: Candidate[] = [];

  // -- Water candidates (priority core: oceans → seas → minor water) --
  const center: [number, number] = [width / 2, height / 2];
  for (const e of waterBodies?.entries ?? []) {
    const [lat, lon, name, tier, kind, alt] = e;
    if (!waterEligible(tier, kind, band)) continue;
    // Multi-anchor (Decision 5 / ADR-4): of the anchors that project inside the
    // viewport, pick the one nearest the viewport centre.
    const anchorsLngLat: Array<[number, number]> = [[lon, lat]];
    for (const a of alt ?? []) anchorsLngLat.push([a[1], a[0]]);
    let best: [number, number] | null = null;
    let bestD = Infinity;
    let nearestProj: [number, number] | null = null; // best finite proj (any side)
    let nearestProjD = Infinity;
    for (const [aLon, aLat] of anchorsLngLat) {
      const p = project(aLon, aLat);
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      const d = (p[0] - center[0]) ** 2 + (p[1] - center[1]) ** 2;
      if (d < nearestProjD) {
        nearestProjD = d;
        nearestProj = p;
      }
      if (!insideViewport(p, width, height)) continue;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    // Oceans (tier 0) are large enough that a frame-edge label still reads
    // correctly, so when their anchor falls off-screen on a zoomed-in view
    // (e.g. the mid-Atlantic/Pacific centroid on a US map) we CLAMP it to the
    // viewport margin rather than drop it — the standard cartographic "ocean
    // name hugs the edge" behaviour. Smaller basins keep the strict drop-if-
    // off-screen rule (AC10) to avoid mislabelling an adjacent basin.
    if (!best && tier === 0 && nearestProj) {
      // Only clamp an ocean ADJACENT to the frame: if its centroid overshoots
      // the viewport by more than ~half a dimension it's a distant ocean (e.g.
      // the South Atlantic / Arctic relative to a US view) and edge-clamping it
      // would mislabel that margin — drop instead. The surviving oceans are the
      // ones the frame actually borders (Pacific to the west, Atlantic east).
      const overX = Math.max(0, -nearestProj[0], nearestProj[0] - width);
      const overY = Math.max(0, -nearestProj[1], nearestProj[1] - height);
      if (
        overX <= width * EDGE_CLAMP_OVERSHOOT &&
        overY <= height * EDGE_CLAMP_OVERSHOOT
      ) {
        // Clamp the CENTRE inward by half the label so the whole (centre-
        // anchored) rect stays on-canvas — clamping to the bare margin would
        // overflow a wide name like "North Atlantic Ocean" off the edge.
        // letter-spacing IS counted (labelWidth) so the clamp matches render.
        const halfW = labelWidth(name, WATER_LETTER_SPACING) / 2;
        const halfH = (FONT + 2 * PADY) / 2;
        const m = EDGE_CLAMP_MARGIN;
        best = [
          Math.min(Math.max(nearestProj[0], halfW + m), width - halfW - m),
          Math.min(Math.max(nearestProj[1], halfH + m), height - halfH - m),
        ];
      }
    }
    if (!best) continue;
    candidates.push({
      text: name,
      cx: best[0],
      cy: best[1],
      italic: true,
      letterSpacing: WATER_LETTER_SPACING,
      color: waterColor,
      // Water before any country (×1000), then by tier, then kind, then name.
      sort: tier * 10 + KIND_ORDER[kind],
    });
  }

  // -- Country candidates (unreferenced; biggest projected area first) --
  // Rank by screen bbox area; keep only those whose name fits the footprint
  // (width-fit, like region-labels) and whose anchor projects inside the view.
  const ranked = countries
    .map((c) => {
      const [x0, y0, x1, y1] = c.bbox;
      const w = x1 - x0;
      const h = y1 - y0;
      return { c, w, h, area: w * h };
    })
    .filter((r) => Number.isFinite(r.area) && r.area > 0)
    .sort((a, b) => b.area - a.area);
  let ci = 0;
  for (const r of ranked) {
    const { c, w, h } = r;
    // F2: an antimeridian-crossing / global-smear country yields a near-full-
    // canvas bbox while its real landmass is split — the `path.centroid` anchor
    // is then unreliable (mid-map, wrong basin). Drop such over-wide candidates
    // rather than spend a top-priority slot on a mispositioned name.
    if (w > width * 0.66 || h > height * 0.66) continue;
    if (!insideViewport(c.anchor, width, height)) continue;
    const abbrev = regionLabels === 'abbrev';
    const text = abbrev ? c.iso : c.name;
    const tw = labelWidth(text, 0);
    // Approximate fit (Decision 4): name fits inside the footprint bbox. NOT
    // true point-in-polygon — cartographic labels routinely overrun coastlines.
    if (tw > w || FONT + 2 * PADY > h) continue;
    candidates.push({
      text,
      cx: c.anchor[0],
      cy: c.anchor[1],
      italic: false,
      letterSpacing: 0,
      color: countryColor,
      // Always after every water body (+1e6); larger area = earlier.
      sort: 1_000_000 + ci++,
    });
  }

  // -- Commit dead-last, highest-priority-first, into leftover space only --
  candidates.sort((a, b) => a.sort - b.sort);
  const placed: PlacedLabel[] = [];
  const placedRects: LabelRect[] = [];
  for (const cand of candidates) {
    if (placed.length >= budget) break;
    const rect = rectAround(cand.cx, cand.cy, cand.text, cand.letterSpacing);
    if (!rectFits(rect, width, height)) continue;
    // Water labels must sit over OPEN WATER, not land — sample the footprint's
    // centre + horizontal extremes; drop if any touches land (Decision: optional
    // orientation aids, so exclude rather than misplace over a coastline). Country
    // labels are exempt — they belong on their country.
    if (cand.italic && overLand) {
      const yMid = cand.cy;
      const inset = 2;
      if (
        overLand(rect.x + inset, yMid) ||
        overLand(cand.cx, yMid) ||
        overLand(rect.x + rect.w - inset, yMid)
      )
        continue;
    }
    if (collides(rect)) continue;
    if (placedRects.some((r) => overlapsPadded(rect, r, CONTEXT_PAD))) continue;
    placedRects.push(rect);
    placed.push({
      x: cand.cx,
      y: cand.cy,
      text: cand.text,
      anchor: 'middle',
      color: cand.color,
      halo: true,
      haloColor,
      italic: cand.italic,
      letterSpacing: cand.letterSpacing,
      lineNumber: 0,
    });
  }
  return placed;
}
