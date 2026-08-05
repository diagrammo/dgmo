import { geoPath } from 'd3-geo';
import type { GeoProjection } from 'd3-geo';
// Type-only, so the cycle with layout.ts is erased at build time.
import type { MapLayoutInset, MapLayoutRegion, GeoFeature } from './layout';
import type { ResolvedMap, ResolvedRegion } from './resolved-types';

/** Seed for an AK/HI label — turned into a PlacedLabel by the labels stage so
 *  it shares the region-label styling. */
export interface InsetLabelSeed {
  x: number;
  y: number;
  iso: string;
  name: string;
  lineNumber: number;
}

export interface InsetLayout {
  readonly insets: MapLayoutInset[];
  readonly insetRegions: MapLayoutRegion[];
  readonly insetLabelSeeds: InsetLabelSeed[];
}

const PAD = 8;
const GAP = 12; // px the top edge rides below the coast
const BW = 8; // x-bucket width (px) for the coast profile

/**
 * Alaska & Hawaii insets — ours, replacing geoAlbersUsa's fixed boxes.
 *
 * The conus conic projects AK/HI to their real positions (far off-frame), so
 * they're culled from the main layer; instead each is drawn in its own framed
 * box in the lower-left with a dedicated projection fit to that box. Inset
 * region paths (computed here, in inset-projection screen coords) are appended
 * to `regions` by the caller so the renderer draws them like any other region.
 *
 * Reads the main `projection` only to sample the CONUS coast — it is never
 * refitted here. The two inset projections are constructed fresh by the caller
 * and fitted to their own boxes, which is why passing them in is safe.
 */
export function layoutInsets(args: {
  readonly resolved: ResolvedMap;
  /** The fitted main projection — sampled for the coast profile, never mutated. */
  readonly projection: GeoProjection;
  readonly usLayer: ReadonlyMap<string, GeoFeature>;
  readonly worldLayer: ReadonlyMap<string, GeoFeature>;
  readonly regionById: ReadonlyMap<string, ResolvedRegion>;
  readonly width: number;
  readonly height: number;
  /** Canvas edge padding — the lowest/leftmost a box may reach. */
  readonly fitPad: number;
  readonly pathDigits: number;
  /** Non-contiguous US ISO codes, excluded from the coast profile. */
  readonly nonConus: ReadonlySet<string>;
  readonly colorizeActive: boolean;
  readonly colorByIso: ReadonlyMap<string, string>;
  readonly neutralFill: string;
  readonly foreignFill: string;
  readonly regionStroke: string;
  readonly colorizeStroke: (fill: string) => string;
  readonly regionFill: (r: ResolvedRegion) => string;
  /** Fresh, unfitted projections for each inset — fitted to their box here. */
  readonly alaskaProjection: () => GeoProjection;
  readonly hawaiiProjection: () => GeoProjection;
  /** Whether each inset is referenced by the content (§24B.2). */
  readonly akRef: boolean;
  readonly hiRef: boolean;
}): InsetLayout {
  const {
    projection,
    usLayer,
    worldLayer,
    regionById,
    width,
    height,
    fitPad,
    pathDigits,
    nonConus,
    colorizeActive,
    colorByIso,
    neutralFill,
    foreignFill,
    regionStroke,
    colorizeStroke,
    regionFill,
    alaskaProjection,
    hawaiiProjection,
    akRef,
    hiRef,
  } = args;

  const insets: MapLayoutInset[] = [];
  const insetRegions: MapLayoutRegion[] = [];
  const insetLabelSeeds: InsetLabelSeed[] = [];

  const yB = height - fitPad; // lowest a box may reach (canvas bottom pad)
  // Southern-coast profile sampled from the conus polygon VERTICES: the lowest
  // (max-y) projected vertex per x-bucket. Accurate everywhere — including
  // Texas's diagonal Rio Grande border, which a bounding box would misread.
  // Open-ocean columns (no vertex) impose NO constraint, so a box may sit there
  // freely; that lets the insets live anywhere in the lower water (no need to
  // dodge Texas) and is what keeps both boxes placeable in any aspect ratio.
  const coast = new Map<number, number>();
  const addPt = (lon: number, lat: number): void => {
    const p = projection([lon, lat]);
    if (!p) return;
    const bi = Math.floor(p[0] / BW);
    const cur = coast.get(bi);
    if (cur === undefined || p[1] > cur) coast.set(bi, p[1]);
  };
  const walk = (co: unknown): void => {
    if (Array.isArray(co) && typeof co[0] === 'number')
      addPt(co[0] as number, co[1] as number);
    else if (Array.isArray(co)) for (const c of co) walk(c);
  };
  for (const [iso, f] of usLayer) {
    if (nonConus.has(iso)) continue;
    walk((f.geometry as { coordinates?: unknown }).coordinates);
  }
  // Coast y at x, or -Infinity over open ocean (no land above → no constraint).
  const at = (x: number): number => {
    const bi = Math.floor(x / BW);
    let y = -Infinity;
    for (let k = bi - 1; k <= bi + 1; k++) {
      const v = coast.get(k);
      if (v !== undefined && v > y) y = v;
    }
    return y;
  };
  // Lowest the coast reaches across [x0, xr], or -Infinity over open ocean.
  const coastFloor = (x0: number, xr: number): number => {
    const n = 24;
    let maxY = -Infinity;
    for (let i = 0; i <= n; i++) {
      const y = at(x0 + ((xr - x0) * i) / n);
      if (y > maxY) maxY = y;
    }
    return maxY;
  };
  // A snug floating box that just contains the state, tucked up under the coast
  // with a flat top sitting GAP below the lowest the coast reaches over its
  // span. `iwReq` is the requested inner width. Returns the box's right edge so
  // the next inset can sit beside it.
  const placeInset = (
    iso: string,
    proj: GeoProjection,
    boxX: number,
    iwReq: number
  ): number => {
    const f = usLayer.get(iso);
    if (!f) return boxX;
    const x0 = boxX;
    // Clamp the width to the remaining canvas so the box can't run off-frame.
    const iw = Math.min(iwReq, width - fitPad - x0 - 2 * PAD);
    if (iw < 24) return boxX; // canvas truly too narrow for another inset
    const xr = x0 + iw + 2 * PAD;
    const floor = coastFloor(x0, xr);
    // Flat top sits just under the coast (GAP below the lowest the coast reaches
    // over the box span) so the inset stays tucked close to CONUS — its SW corner,
    // not stranded at the far canvas bottom. Over open ocean (no coast) a soft
    // default keeps it in the lower band.
    const topGuess = floor > -Infinity ? floor + GAP : yB - height * 0.42;
    // Learn the state's height at this width, then size the box to just hold it.
    proj.fitWidth(iw, f as never);
    const bb = geoPath(proj).bounds(f as never);
    const sh = Number.isFinite(bb[0][0]) ? bb[1][1] - bb[0][1] : iw;
    // If the coast runs so low the state wouldn't fit above yB, raise the top (it
    // stays over ocean) — the box must never collapse and vanish.
    const needH = sh + 2 * PAD;
    let topFit = topGuess;
    const bottom = Math.min(topFit + needH, yB);
    if (bottom - topFit < needH) topFit = bottom - needH;
    proj.fitExtent(
      [
        [x0 + PAD, topFit + PAD],
        [xr - PAD, bottom - PAD],
      ],
      f as never
    );
    const insetPath = geoPath(proj).digits(pathDigits);
    const d = insetPath(f as never) ?? '';
    if (!d) return xr;
    // Neighbour land projected with this same fitted projection, clipped to the
    // box. Alaska's only land neighbour is Canada; drawing it behind AK turns
    // the eastern AK/Canada border into a land boundary so it grows no coastline
    // rings (and fills the box's upper-right corner with recessive context).
    let contextLand: { d: string; fill: string } | undefined;
    if (iso === 'US-AK') {
      const can = worldLayer.get('CA');
      const cd = can ? (insetPath(can as never) ?? '') : '';
      if (cd)
        contextLand = {
          d: cd,
          fill: colorizeActive
            ? (colorByIso.get('CA') ?? foreignFill)
            : foreignFill,
        };
    }
    const r = regionById.get(iso);
    // Inset land reads the SAME colorByIso as the main frame → AK/HI identical
    // to their main-frame colour (extent-independent; AC10/AC11).
    let fill = colorizeActive
      ? (colorByIso.get(iso) ?? neutralFill)
      : neutralFill;
    let lineNumber = -1;
    if (r?.layer === 'us-state') {
      fill = regionFill(r);
      lineNumber = r.lineNumber;
    }
    insets.push({
      x: x0,
      y: topFit,
      w: xr - x0,
      h: bottom - topFit,
      points: [
        [x0, topFit],
        [xr, topFit],
        [xr, bottom],
        [x0, bottom],
      ],
      // The FITTED inset projection (just fit to this box) — captured so the
      // geo-query can invert pixels inside the frame back to AK/HI coords.
      projection: proj,
      ...(contextLand && { contextLand }),
    });
    insetRegions.push({
      id: iso,
      d,
      fill,
      stroke: colorizeActive ? colorizeStroke(fill) : regionStroke,
      lineNumber,
      layer: 'us-state',
      ...(r?.value !== undefined && { value: r.value }),
      ...(r && Object.keys(r.tags).length > 0 && { tags: r.tags }),
    });
    const ctr = geoPath(proj).centroid(f as never);
    if (Number.isFinite(ctr[0])) {
      const name = (f.properties as { name?: string } | null)?.name ?? iso;
      insetLabelSeeds.push({ x: ctr[0], y: ctr[1], iso, name, lineNumber });
    }
    return xr;
  };

  // AK is the larger state; HI a small island group tucked to its right.
  // Each draws only when referenced; HI slides left to fitPad if AK is absent.
  let akRight = fitPad;
  if (akRef)
    akRight = placeInset('US-AK', alaskaProjection(), fitPad, width * 0.18);
  if (hiRef)
    placeInset(
      'US-HI',
      hawaiiProjection(),
      akRef ? akRight + 24 : fitPad,
      width * 0.12
    );

  return { insets, insetRegions, insetLabelSeeds };
}
