// Content-aware export dimensions for maps (§ export-content-aspect).
//
// Outside the app — CLI, MCP, SSG embeds (remark/astro/docusaurus/fumadocs), and
// Obsidian — maps were rendered into a fixed 1200×800 canvas. A world map is
// ~2.3:1, so the global stretch-fill distorted it vertically to fill the too-tall
// box. These helpers derive the canvas HEIGHT from the map's intrinsic projected
// aspect so the export matches the content's natural shape.
//
// dgmo emits the intrinsic aspect; the host context decides display fit (Obsidian
// sets the embedded <svg> to width:100% + aspect-ratio from the viewBox). Aspect
// is the invariant; `baseWidth` is just a resolution knob.
import { geoPath } from 'd3-geo';
import { TITLE_FONT_SIZE, TITLE_Y } from '../utils/title-constants';
import { buildMapProjection } from './layout';
import type { ResolvedMap } from './resolved-types';
import type { MapData } from './resolved-types';

// Mirror the layout constants so the chrome reserve matches what the renderer
// actually reserves (layout.ts FIT_PAD / TITLE_GAP).
const FIT_PAD = 24;
const TITLE_GAP = 16;

// Clamp guardrails (w/h). The clamp is for PATHOLOGICAL extents, not the common
// case — world/continent/country must land at their true projected aspect.
//   ASPECT_MAX = 3.0  → never wider/shorter than 3:1. The default world projection
//                       is EQUIRECTANGULAR (see resolver.ts ~L744); a full-world
//                       extent measures ~2.4:1 and a narrower-latitude world up to
//                       ~2.65:1 — all comfortably under 3.0, so any reasonable world
//                       renders at its true aspect (no letterbox). Only a genuinely
//                       extreme >3:1 band (e.g. a thin trans-global route) is clamped.
//   ASPECT_MIN = 0.9  → never taller than ~1:1.1, so a tall country embedded at
//                       width:100% in a narrow note column stays sane.
const ASPECT_MAX = 3.0;
const ASPECT_MIN = 0.9;
// Minimum px of actual map area (below the chrome band) — keeps a short canvas
// (very wide extent) from being crowded out by the title/caption.
const MIN_MAP_BAND = 200;
// Defensive fallback when the content aspect is non-finite (NaN/0/Infinity). The
// resolver always pads the extent to a non-degenerate box, so in practice this is
// not reached via the public pipeline — it guards a degenerate `fitTarget` directly.
const FALLBACK_ASPECT = 1.5; // 3:2
// Square reference box for aspect measurement. Uniform `fitSize` scaling makes the
// measured aspect invariant to this value — it MUST be square (a non-square box
// would leak into the ratio).
const REF = 1000;

/** The map's intrinsic projected aspect (width / height) for a resolved map.
 *
 *  Measured by fitting the projection + fit target (the SAME `buildMapProjection`
 *  output the renderer draws with) into a square reference box and reading the
 *  projected bounds of the fit target. `fitSize` scales uniformly, so the ratio is
 *  independent of the box size (see the reference-box invariance test).
 *
 *  Returns {@link FALLBACK_ASPECT} (3:2) if the result is non-finite or ≤ 0 — the
 *  helper never emits a NaN/0/Infinity aspect. */
export function mapContentAspect(
  resolved: ResolvedMap,
  data: MapData,
  /** Square reference box for the measurement. Uniform `fitSize` scaling makes the
   *  result invariant to this value; exposed only so tests can assert that. */
  ref = REF
): number {
  const { projection, fitTarget } = buildMapProjection(resolved, data);
  projection.fitSize([ref, ref], fitTarget as never);
  const b = geoPath(projection).bounds(fitTarget as never);
  const w = b[1][0] - b[0][0];
  const h = b[1][1] - b[0][1];
  const aspect = w / h;
  return Number.isFinite(aspect) && aspect > 0 ? aspect : FALLBACK_ASPECT;
}

/** Content-aware export dimensions for a map: `width` fixed at `baseWidth`,
 *  `height` derived from the clamped intrinsic aspect, with a minimum-map-band
 *  floor for very wide extents. `preferContain` is true when the clamp or floor
 *  forced the canvas off the content aspect — the renderer then contain-fits
 *  (letterbox) instead of stretching, so the off-aspect canvas doesn't re-distort. */
export interface MapExportDimensions {
  readonly width: number;
  readonly height: number;
  readonly preferContain: boolean;
}

export function mapExportDimensions(
  resolved: ResolvedMap,
  data: MapData,
  baseWidth = 1200,
  /** WYSIWYG override (app export): the live preview pane's displayed aspect
   *  (width / height). When provided, the canvas adopts it verbatim and
   *  stretch-fills (no clamp, no contain) so the PNG matches exactly what's on
   *  screen. Omitted by every headless consumer (CLI / MCP / SSG / Obsidian),
   *  which keep the intrinsic-aspect sizing below. */
  aspectOverride?: number
): MapExportDimensions {
  const useOverride =
    aspectOverride !== undefined &&
    Number.isFinite(aspectOverride) &&
    aspectOverride > 0;
  const raw = useOverride ? aspectOverride : mapContentAspect(resolved, data);
  // The override is the user's on-screen aspect — honour it as-is (no clamp);
  // only the intrinsic path guards against pathological extents.
  const clamped = useOverride
    ? raw
    : Math.max(ASPECT_MIN, Math.min(ASPECT_MAX, raw));
  const width = baseWidth;
  let height = Math.round(width / clamped);

  // Chrome reserve mirrors layout.ts `topPad` EXACTLY — the only chrome the layout
  // actually subtracts from the map's fit box. The top banner reserves space ONLY
  // when a title AND POIs are present (a POI-less choropleth lets the title overlay
  // the land). The legend (foreground, top-center) and the caption (drawn at
  // height-8, overlapping the bottom) reserve NO layout height in the renderer, so
  // they are deliberately excluded — adding them would over-reserve.
  let chromeReserve = 0;
  if (resolved.title && resolved.pois.length > 0) {
    const bannerBottom =
      (resolved.subtitle ? TITLE_Y + TITLE_FONT_SIZE : TITLE_Y) +
      TITLE_FONT_SIZE / 2;
    chromeReserve += Math.max(FIT_PAD, bannerBottom + TITLE_GAP) - FIT_PAD;
  }

  let floored = false;
  if (height - chromeReserve < MIN_MAP_BAND) {
    height = Math.round(chromeReserve + MIN_MAP_BAND);
    floored = true;
  }

  // The canvas was forced off the content aspect ⇒ tell the renderer to
  // contain-fit (letterbox) rather than stretch-distort. The WYSIWYG override is
  // exempt: it stretch-fills (mirroring the preview pane) unless the MIN_MAP_BAND
  // floor had to grow the canvas off-aspect.
  const preferContain = useOverride ? floored : clamped !== raw || floored;
  return { width, height, preferContain };
}
