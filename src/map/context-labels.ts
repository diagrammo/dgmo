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
  readonly name: string;
  /** Projected screen bbox `[x0, y0, x1, y1]` (from `path.bounds`). */
  readonly bbox: readonly [number, number, number, number];
  /** Projected screen anchor `[x, y]` (mainland anchor or `path.centroid`), or
   *  null when the feature doesn't project to a finite point. */
  readonly anchor: readonly [number, number] | null;
  /** True when `anchor` came from a curated WORLD_LABEL_ANCHORS entry (a trusted
   *  mainland point) rather than the area-weighted centroid. Such a country
   *  bypasses the both-axes smear gate (its full-canvas bbox is an antimeridian
   *  artifact, not a real footprint, so the unreliable-centroid concern is moot). */
  readonly curatedAnchor?: boolean;
}

export interface ContextLabelArgs {
  readonly projection: ProjectionFamily;
  readonly dLonSpan: number;
  readonly dLatSpan: number;
  readonly width: number;
  readonly height: number;
  readonly waterBodies?: WaterBodies | undefined;
  readonly countries: readonly CountryCandidate[];
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
const LINE_HEIGHT = FONT + 2; // px per wrapped line — MUST match the renderer's
const PADX = 4; // half-padding around a context label rect
const PADY = 3;
const WATER_LETTER_SPACING = 1.5; // px — cartographic spread for water names
const CONTEXT_PAD = 4; // extra gap enforced between two context labels
const EDGE_CLAMP_MARGIN = 8; // px inset for edge-clamped ocean labels
const EDGE_CLAMP_OVERSHOOT = 0.35; // max off-frame overshoot (× dim) to still clamp

// Country labels scale with their projected footprint: a big landmass (Canada,
// Mexico on a US view) reads as a large, FADED backdrop name; a small one stays
// at the base font, fully muted. Size metric is the footprint's linear extent
// (√bbox-area) as a fraction of the canvas's linear extent (√canvas-area), so
// the ramp is resolution-independent. Below MIN ⇒ base font / no extra fade;
// at/above MAX ⇒ max font / max fade; linear between.
const COUNTRY_FONT_MAX = 22; // px ceiling for the largest footprint
const COUNTRY_SIZE_FRAC_MIN = 0.06; // footprint linear-frac at base font
const COUNTRY_SIZE_FRAC_MAX = 0.32; // footprint linear-frac at max font
const COUNTRY_FADE_MAX = 45; // % blend toward bg at max font (subdue big names)

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
    world: 7,
    continental: 6,
    regional: 5,
    local: 4,
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
export function labelWidth(
  text: string,
  letterSpacing: number,
  font: number = FONT
): number {
  const spacing =
    letterSpacing > 0 ? Math.max(0, text.length - 1) * letterSpacing : 0;
  return measureLegendText(text, font) + spacing + 2 * PADX;
}

/** Wrap a multi-word name into balanced lines, biased to wrap READILY — water
 *  names ("North Pacific Ocean") read better stacked, and a narrower footprint
 *  is far likelier to clear surrounding land (the hard rule below). Of every
 *  contiguous split into ≤`maxLines`, picks the one minimising the widest line
 *  (so it shrinks horizontally whenever a break helps); ties break to fewer
 *  lines, then top-heavy ("North Pacific" / "Ocean", not "North" / "Pacific
 *  Ocean"). Single-word names pass through unwrapped. */
export function wrapLabel(text: string, letterSpacing: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [text];
  const maxLines = words.length >= 4 ? 3 : 2;
  const n = words.length;
  type Split = { lines: string[]; cost: number; head: number };
  let best: Split | null = null;
  for (let mask = 0; mask < 1 << (n - 1); mask++) {
    const lines: string[] = [];
    let cur = [words[0]!];
    for (let i = 1; i < n; i++) {
      if (mask & (1 << (i - 1))) {
        lines.push(cur.join(' '));
        cur = [words[i]!];
      } else cur.push(words[i]!);
    }
    lines.push(cur.join(' '));
    if (lines.length > maxLines) continue;
    const cost = Math.round(
      Math.max(...lines.map((l) => labelWidth(l, letterSpacing)))
    );
    const head = labelWidth(lines[0]!, letterSpacing);
    if (
      !best ||
      cost < best.cost ||
      (cost === best.cost && lines.length < best.lines.length) ||
      (cost === best.cost &&
        lines.length === best.lines.length &&
        head > best.head)
    )
      best = { lines, cost, head };
  }
  return best?.lines ?? [text];
}

function rectAround(
  cx: number,
  cy: number,
  lines: readonly string[],
  letterSpacing: number,
  font: number = FONT
): LabelRect {
  const lineHeight = font + 2; // MUST match the renderer's per-line stride
  const w = Math.max(...lines.map((l) => labelWidth(l, letterSpacing, font)));
  const h = (lines.length - 1) * lineHeight + font + 2 * PADY;
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
    lines: string[];
    cx: number;
    cy: number;
    italic: boolean;
    letterSpacing: number;
    color: string;
    fontSize: number;
    sort: number; // priority key (lower first)
  };
  const candidates: Candidate[] = [];

  // -- Water candidates (priority core: oceans → seas → minor water) --
  const center: [number, number] = [width / 2, height / 2];
  for (const e of waterBodies?.entries ?? []) {
    const [lat, lon, name, tier, kind, alt] = e;
    if (!waterEligible(tier, kind, band)) continue;
    // Wrap eagerly (Decision: water names stack readily) so the clamp/fit math
    // below sees the real, narrower wrapped footprint, not the one-line width.
    const wlines = wrapLabel(name, WATER_LETTER_SPACING);
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
        const halfW =
          Math.max(...wlines.map((l) => labelWidth(l, WATER_LETTER_SPACING))) /
          2;
        const halfH = ((wlines.length - 1) * LINE_HEIGHT + FONT + 2 * PADY) / 2;
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
      lines: wlines,
      cx: best[0],
      cy: best[1],
      italic: true,
      letterSpacing: WATER_LETTER_SPACING,
      color: waterColor,
      fontSize: FONT, // water names keep the base font (no footprint to scale on)
      // Orientation-value bands (lower = earlier): MAJOR water (oceans + major
      // seas, tier ≤ 1) leads at `tier*10+kind` (0..~16); MINOR water (tier ≥ 2:
      // smaller seas, bays, gulfs, straits) drops to band 2 (2000+) — BELOW the
      // country band (1000+), so a big country outranks a minor basin.
      sort: (tier <= 1 ? 0 : 2000) + tier * 10 + KIND_ORDER[kind],
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
  // Canvas linear extent — the denominator for the footprint size ramp below.
  const canvasLinear = Math.sqrt(Math.max(1, width * height));
  let ci = 0;
  for (const r of ranked) {
    const { c, w, h, area } = r;
    // F2: an antimeridian-crossing / global-smear country fills the canvas in
    // BOTH dimensions while its real landmass is split — the `path.centroid`
    // anchor is then unreliable (mid-map, wrong basin). Reject only that
    // both-axes canvas-smear: a country that is merely wide-but-short (Canada
    // hugging the top of a US frame) or tall-but-narrow (Chile) is a legitimate
    // landmass whose clipExtent-clipped centroid still lands over its own ground,
    // so it must NOT be dropped for footprint shape alone. A `curatedAnchor`
    // (WORLD_LABEL_ANCHORS, e.g. Russia → European Russia) is trustworthy by
    // construction — the smear concern is moot, so it bypasses this gate (the
    // `insideViewport` check below still drops an anchor that projects off-frame).
    if (!c.curatedAnchor && w > width * 0.66 && h > height * 0.66) continue;
    if (!insideViewport(c.anchor, width, height)) continue;
    // Footprint-driven scale (Decision: big landmass = large, faded backdrop
    // name). t∈[0,1] over the [MIN,MAX] linear-fraction band; font ramps up and
    // ink rises in lockstep, so a bigger name reads as a large, softly-inked
    // backdrop. A curated-anchor giant (Russia) keeps the standard big-country
    // styling — its full-canvas bbox lands at the top of the ramp (font/ink like
    // any large in-frame country), which is the intended subdued-backdrop look.
    const sizeFrac = Math.sqrt(area) / canvasLinear;
    const t = Math.min(
      1,
      Math.max(
        0,
        (sizeFrac - COUNTRY_SIZE_FRAC_MIN) /
          (COUNTRY_SIZE_FRAC_MAX - COUNTRY_SIZE_FRAC_MIN)
      )
    );
    const fontSize = Math.round(FONT + t * (COUNTRY_FONT_MAX - FONT));
    const fade = Math.round(t * COUNTRY_FADE_MAX);
    const color = fade > 0 ? mix(countryColor, palette.bg, fade) : countryColor;
    // Always the full country name — never an ISO abbreviation. If the name
    // doesn't fit the footprint, drop the label rather than abbreviate.
    const text = c.name;
    const tw = labelWidth(text, 0, fontSize);
    // Approximate fit (Decision 4): the (scaled) name fits inside the footprint
    // bbox. NOT true point-in-polygon — cartographic labels routinely overrun
    // coastlines. The bigger the font, the bigger the box it must clear.
    if (tw > w || fontSize + 2 * PADY > h) continue;
    candidates.push({
      text,
      lines: [text],
      cx: c.anchor[0],
      cy: c.anchor[1],
      italic: false,
      letterSpacing: 0,
      color,
      fontSize,
      // Band 1 (orientation-value ranking): above MINOR water (band 2, 2000+) but
      // below MAJOR water — oceans + major seas (band 0, ≤~16). So a big country
      // (US, Canada, Russia) outranks a minor sea/bay (Sargasso, Bahía de
      // Campeche) yet never displaces an ocean. Larger area = earlier within the
      // band (`ci` is the area-desc rank index).
      sort: 1000 + ci++,
    });
  }

  // -- Commit dead-last, highest-priority-first, into leftover space only --
  candidates.sort((a, b) => a.sort - b.sort);
  const placed: PlacedLabel[] = [];
  const placedRects: LabelRect[] = [];
  // Guarantee country/state room: water can otherwise monopolise a small budget
  // (a coastal view borders many oceans/seas), so reserve up to 2 slots for
  // countries whenever any country candidate exists. No effect on pure-water
  // views (`countryCount` 0 ⇒ cap = budget). Major water still leads by sort, so
  // this only trims the LAST water bodies that would have crowded out a country.
  const countryCount = candidates.reduce((n, c) => n + (c.italic ? 0 : 1), 0);
  const waterCap = budget - Math.min(2, countryCount);
  let waterPlaced = 0;
  for (const cand of candidates) {
    if (placed.length >= budget) break;
    if (cand.italic && waterPlaced >= waterCap) continue;
    const rect = rectAround(
      cand.cx,
      cand.cy,
      cand.lines,
      cand.letterSpacing,
      cand.fontSize
    );
    if (!rectFits(rect, width, height)) continue;
    // Water labels must sit over OPEN WATER and NEVER touch land — sample a grid
    // over every wrapped line (each line's own horizontal extent at five points);
    // drop the whole label if ANY sample hits land (Decision: optional orientation
    // aids, so exclude rather than misplace over a coastline). Country labels are
    // exempt — they belong on their country.
    if (cand.italic && overLand) {
      const inset = 2;
      const top = cand.cy - ((cand.lines.length - 1) / 2) * LINE_HEIGHT;
      const touchesLand = cand.lines.some((line, li) => {
        const lw = labelWidth(line, cand.letterSpacing);
        const x0 = cand.cx - lw / 2 + inset;
        const x1 = cand.cx + lw / 2 - inset;
        const xs = [x0, (x0 + cand.cx) / 2, cand.cx, (cand.cx + x1) / 2, x1];
        const base = top + li * LINE_HEIGHT;
        // Sample the glyph body top→baseline (text rises above the baseline) so a
        // label whose ascenders clip a coastline is rejected, not just one whose
        // baseline sits on land.
        return [base, base - FONT * 0.4, base - FONT * 0.8].some((y) =>
          xs.some((x) => overLand(x, y))
        );
      });
      if (touchesLand) continue;
    }
    if (collides(rect)) continue;
    if (placedRects.some((r) => overlapsPadded(rect, r, CONTEXT_PAD))) continue;
    placedRects.push(rect);
    if (cand.italic) waterPlaced++;
    placed.push({
      x: cand.cx,
      y: cand.cy,
      text: cand.text,
      anchor: 'middle',
      color: cand.color,
      // No halo: the bg-coloured outline reads as a ghost box behind the text
      // over the tinted water/land. Context labels are muted enough to sit
      // cleanly on the basemap without one.
      halo: false,
      haloColor,
      fontSize: cand.fontSize,
      italic: cand.italic,
      letterSpacing: cand.letterSpacing,
      ...(cand.lines.length > 1 ? { lines: cand.lines } : {}),
      lineNumber: 0,
    });
  }
  return placed;
}
