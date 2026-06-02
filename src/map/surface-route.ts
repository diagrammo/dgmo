// Surface-route avoidance (§24B.6): given a route leg / weighted edge with a
// best-effort `surface: water|land` constraint, choose a single quadratic bow
// (direction + magnitude) so the drawn arc stays over the requested surface.
//
// PURE — no projection construction, no data-asset access, no `invert()`. All
// geo machinery is injected (the layout `project` closure + the decoded land
// features). Implements ADR-3 (tech-spec-map-route-surface-avoidance): one
// geo-space chord pass classifies land/water, a bounded bidirectional probe at
// the deepest incursion picks the side, then a magnitude sweep verifies the
// chosen geo arc. The result is a SINGLE screen-space `offset` that `legPath`
// (layout.ts) consumes as the absolute bow — keeping `legPath` itself pure
// (Amelia rule 1). The opposite side is swept only if the preferred side never
// clears (ADR-3). Deterministic: fixed sample/step/magnitude schedules, no RNG
// (F10).
import { pointInGeometry } from './geo';
import type { DecodedFeature } from './geo';

/** A screen point (POI centre) — `legPath` endpoints carry a radius too, but the
 *  bow geometry only needs the centre. */
export interface ScreenPoint {
  readonly cx: number;
  readonly cy: number;
}

export interface SurfaceBowArgs {
  /** Screen endpoints (POI centres) of the leg. */
  readonly a: ScreenPoint;
  readonly b: ScreenPoint;
  /** Geographic endpoints `[lon, lat]` — the chord is sampled here (F6). */
  readonly lonLatA: readonly [number, number];
  readonly lonLatB: readonly [number, number];
  readonly surface: 'water' | 'land';
  /** Layout `project` closure (layout.ts:704) — stretch-aware forward map, NOT
   *  the raw projection (F1). Geo→screen only; never inverted (F2). */
  readonly project: (lon: number, lat: number) => [number, number] | null;
  /** Decoded country features; a sample is "land" iff inside any of them. */
  readonly landFeatures: readonly DecodedFeature[];
  /** Pre-existing fan-out offset for parallel edges; composed into the returned
   *  bow with the same sign so parallels stay spread without flipping side (F12). */
  readonly fanDelta: number;
  /** 1-based source line for any emitted diagnostic. */
  readonly lineNumber: number;
}

export interface SurfaceBowResult {
  readonly curved: boolean;
  /** Absolute signed bow for `legPath` (surface magnitude + fan delta, F12). */
  readonly offset: number;
  /** Curve apex in screen space, for label anchoring (F11). */
  readonly apex: [number, number];
  /** Set when the constraint could not be honoured / was skipped (ADR-5/P1). */
  readonly diagnostic?: { line: number; message: string; code: string };
}

// ── Budget constants (starting values — tune in review). ──
// Chord sample count scales with pixel length, clamped (F4/AC10).
const SAMPLE_MIN = 8;
const SAMPLE_MAX = 48;
const PX_PER_SAMPLE = 24;
// Magnitude sweep: bow ranges MIN_BOW_FRAC..MAG_CAP_FRAC of the GEO chord length,
// in NUDGE_STEPS increments (F5 — hard cap stops a half-map loop).
const MIN_BOW_FRAC = 0.1;
const MAG_CAP_FRAC = 0.6;
const NUDGE_STEPS = 6;
// Water-mode rim exclusion (F1/P4): endpoints are land cities, so the rim
// approach near each POI must not count as a violation. Exclude a fraction of
// the span at each end (a pixel floor dominates on short legs), but require a
// minimum testable interior or skip with a diagnostic (P4).
const RIM_FRAC_MIN = 0.12;
const RIM_PX = 14;
const RIM_FRAC_MAX = 0.45;
const FLOOR_FRAC = 0.35;
// Smallest visible screen bow (px) — `surface:` implies an arc (F9), so never
// return a flat line even when the cleared geo bow projects tiny.
const MIN_SCREEN_BOW = 6;

type Vec2 = readonly [number, number];

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/** Quadratic Bézier point at parameter t (planar). */
const quad = (p0: Vec2, c: Vec2, p1: Vec2, t: number): Vec2 => {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
    u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1],
  ];
};

/**
 * Resolve a leg's surface-avoidance bow. Returns the `curved`/`offset` for
 * `legPath` plus the curve apex; a `diagnostic` rides along when the constraint
 * is unsatisfiable, skipped (sub-floor), or projection-degenerate.
 */
export function resolveSurfaceBow(args: SurfaceBowArgs): SurfaceBowResult {
  const { a, b, lonLatA, lonLatB, surface, project, landFeatures, fanDelta } =
    args;

  // Screen chord geometry (must match legPath's normal: n = (-dy, dx) / len).
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const lenPx = Math.hypot(dx, dy);
  const midScreen: Vec2 = [(a.cx + b.cx) / 2, (a.cy + b.cy) / 2];
  // Geo chord. Antimeridian-correct (F6): reconstruct the far endpoint along the
  // SHORTEST longitude delta so a trans-Pacific leg samples the near side, not the
  // long way around the globe. The extended `B` lon may fall outside [-180,180];
  // sample lons are wrapped back at classification/projection time (`wrapLon`).
  const A: Vec2 = [lonLatA[0], lonLatA[1]];
  const gdx = wrapLon(lonLatB[0] - lonLatA[0]);
  const gdy = lonLatB[1] - lonLatA[1];
  const B: Vec2 = [A[0] + gdx, A[1] + gdy];
  const geoLen = Math.hypot(gdx, gdy);

  // Degenerate legs: nothing meaningful to bow around.
  if (lenPx < 1 || geoLen < 1e-9) {
    return {
      curved: true,
      offset: fanDelta,
      apex: apexOf(midScreen, screenNormal(dx, dy, lenPx), fanDelta),
    };
  }

  const nUnit = screenNormal(dx, dy, lenPx);
  // Geo perpendicular (planar lon/lat — anisotropy is fine for a heuristic
  // probe; the final screen offset comes from projecting the geo control point).
  const gpLen = geoLen;
  const geoPerp: Vec2 = [-gdy / gpLen, gdx / gpLen];

  // Mode-aware interior span (F1). Land mode tests the full span (endpoints are
  // already land); water mode excludes the land-anchored rim near each POI.
  const rimFrac =
    surface === 'water'
      ? clamp(Math.max(RIM_FRAC_MIN, RIM_PX / lenPx), 0, RIM_FRAC_MAX)
      : 0;
  const interiorFrac = 1 - 2 * rimFrac;
  if (surface === 'water' && interiorFrac < FLOOR_FRAC) {
    // No meaningful interior to test (P4): short coastal leg, almost all rim.
    return {
      curved: true,
      offset: fanDelta,
      apex: apexOf(midScreen, nUnit, fanDelta),
      diagnostic: {
        line: args.lineNumber,
        message:
          'surface: water leg too short to test (mostly coastal approach) — drawn as a plain arc.',
        code: 'W_MAP_SURFACE_UNSATISFIED',
      },
    };
  }

  const samples = clamp(
    Math.round(lenPx / PX_PER_SAMPLE),
    SAMPLE_MIN,
    SAMPLE_MAX
  );
  const tAt = (i: number): number => rimFrac + interiorFrac * (i / samples);

  // Precompute each feature's lon/lat bbox ONCE per leg (O(total verts)) so the
  // per-sample classification can cheaply reject non-overlapping features before
  // the O(verts) ray-cast — open ocean (no hit) would otherwise scan every ring
  // of every feature, every sample (F6 / perf review).
  const bboxes = landFeatures.map((f) => featureBbox(f.geometry));
  const isLand = (p: Vec2): boolean => {
    const lon = wrapLon(p[0]); // extended-chord lons wrap back into [-180,180]
    const lat = p[1];
    for (let i = 0; i < landFeatures.length; i++) {
      const bb = bboxes[i]!;
      if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue;
      if (pointInGeometry(landFeatures[i]!.geometry, lon, lat)) return true;
    }
    return false;
  };
  const violates = (p: Vec2): boolean =>
    surface === 'water' ? isLand(p) : !isLand(p);

  // ── Pass 1: classify the straight chord interior (geo space, F6). ──
  const chordViol: boolean[] = [];
  for (let i = 0; i <= samples; i++)
    chordViol.push(violates(lerp(A, B, tAt(i))));
  const hadViolation = chordViol.some(Boolean);

  // ── Side selection: bounded bidirectional probe at the deepest incursion. ──
  const stepGeo = geoLen / samples;
  const capSteps = Math.max(1, Math.ceil((MAG_CAP_FRAC * geoLen) / stepGeo));
  let sideFirst = 1;
  if (hadViolation) {
    const deep = deepestSample(chordViol);
    const pStar = lerp(A, B, tAt(deep));
    const stepsToClear = (side: number): number => {
      for (let k = 1; k <= capSteps; k++) {
        const p: Vec2 = [
          pStar[0] + geoPerp[0] * stepGeo * k * side,
          pStar[1] + geoPerp[1] * stepGeo * k * side,
        ];
        if (!violates(p)) return k;
      }
      return Infinity;
    };
    const plus = stepsToClear(1);
    const minus = stepsToClear(-1);
    // Tie / both-inconclusive → +1 (deterministic left/CW, F10).
    sideFirst = plus <= minus ? 1 : -1;
  }

  // ── Pass 2: magnitude sweep on the preferred side, then the opposite. ──
  const minBow = MIN_BOW_FRAC * geoLen;
  const maxBow = MAG_CAP_FRAC * geoLen;
  const mags: number[] = [];
  for (let s = 0; s <= NUDGE_STEPS; s++)
    mags.push(minBow + ((maxBow - minBow) * s) / NUDGE_STEPS);

  const countArcViol = (side: number, bowGeo: number): number => {
    const ctrl: Vec2 = [
      midGeo(A, B)[0] + geoPerp[0] * bowGeo * side,
      midGeo(A, B)[1] + geoPerp[1] * bowGeo * side,
    ];
    let v = 0;
    for (let i = 0; i <= samples; i++)
      if (violates(quad(A, ctrl, B, tAt(i)))) v++;
    return v;
  };

  let best: { side: number; bow: number; viol: number } | null = null;
  for (const side of [sideFirst, -sideFirst]) {
    for (const bow of mags) {
      const v = countArcViol(side, bow);
      if (best === null || v < best.viol || (v === best.viol && bow < best.bow))
        best = { side, bow, viol: v };
      if (v === 0) {
        return successResult(side, bow);
      }
    }
    // Preferred side exhausted with no clear arc → try the opposite (ADR-3).
  }

  // Nothing cleared within budget → smallest-deviation candidate + diagnostic
  // (ADR-5 / P2: tightest arc beats an ugly-but-clean half-map loop).
  const chosen = best ?? { side: sideFirst, bow: minBow, viol: 0 };
  const result = successResult(chosen.side, chosen.bow);
  if (hadViolation && chosen.viol > 0) {
    return {
      ...result,
      diagnostic: {
        line: args.lineNumber,
        message: `surface: ${surface} could not be fully honoured for this leg — drawn as the closest arc (a single bow can't clear this geometry).`,
        code: 'W_MAP_SURFACE_UNSATISFIED',
      },
    };
  }
  return result;

  // ── helpers closing over args ──
  function successResult(side: number, bowGeo: number): SurfaceBowResult {
    const m = midGeo(A, B);
    const ctrlGeo: Vec2 = [
      m[0] + geoPerp[0] * bowGeo * side,
      m[1] + geoPerp[1] * bowGeo * side,
    ];
    const cs = project(wrapLon(ctrlGeo[0]), ctrlGeo[1]);
    // Signed perpendicular displacement of the control point in SCREEN space —
    // exactly the `bow` legPath applies (control = mid + nUnit * offset).
    let offsetSigned: number;
    if (cs) {
      offsetSigned =
        (cs[0] - midScreen[0]) * nUnit[0] + (cs[1] - midScreen[1]) * nUnit[1];
    } else {
      // Projection returned null (off-map) — approximate from the geo ratio.
      offsetSigned = side * (bowGeo / geoLen) * lenPx;
    }
    // F9: never collapse to a flat line; keep the sign the search chose.
    if (Math.abs(offsetSigned) < MIN_SCREEN_BOW) {
      const sgn = offsetSigned < 0 ? -1 : 1;
      offsetSigned = sgn * MIN_SCREEN_BOW;
    }
    // F12: compose the fan delta with the SAME sign — spread parallels apart,
    // never flip side or shrink below the clearing magnitude.
    const sgn = offsetSigned < 0 ? -1 : 1;
    const offset = offsetSigned + sgn * Math.abs(fanDelta);
    return { curved: true, offset, apex: apexOf(midScreen, nUnit, offset) };
  }
}

const screenNormal = (dx: number, dy: number, len: number): Vec2 =>
  len > 0 ? [-dy / len, dx / len] : [0, 0];

const midGeo = (a: Vec2, b: Vec2): Vec2 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
];

/** legPath's quadratic apex (t=0.5) = mid + nUnit * bow * 0.5. */
const apexOf = (mid: Vec2, nUnit: Vec2, bow: number): [number, number] => [
  mid[0] + nUnit[0] * bow * 0.5,
  mid[1] + nUnit[1] * bow * 0.5,
];

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** Wrap a longitude (or longitude delta) into [-180, 180]. */
const wrapLon = (lon: number): number => {
  const m = (((lon + 180) % 360) + 360) % 360;
  return m - 180;
};

/** Lon/lat bbox `[west, south, east, north]` of a Polygon/MultiPolygon geometry
 *  (no antimeridian unwrapping — a seam-spanning feature just gets a wide box,
 *  which over-includes rather than false-rejects). */
function featureBbox(geometry: unknown): [number, number, number, number] {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const scanRing = (ring: number[][]): void => {
    for (const pt of ring) {
      const lon = pt[0]!;
      const lat = pt[1]!;
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  };
  if (!g) return [Infinity, Infinity, -Infinity, -Infinity];
  if (g.type === 'Polygon') {
    for (const ring of g.coordinates as number[][][]) scanRing(ring);
  } else if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates as number[][][][])
      for (const ring of poly) scanRing(ring);
  }
  return [w, s, e, n];
}

/** Middle index of the longest run of `true` — the deepest incursion proxy. */
function deepestSample(viol: boolean[]): number {
  let bestStart = 0;
  let bestLen = 0;
  let i = 0;
  while (i < viol.length) {
    if (!viol[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < viol.length && viol[j]) j++;
    if (j - i > bestLen) {
      bestLen = j - i;
      bestStart = i;
    }
    i = j;
  }
  return bestStart + Math.floor(bestLen / 2);
}
