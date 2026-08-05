import { mix } from '../palettes/color-utils';
import { tagAttrKey } from '../utils/tag-groups';
import type { PaletteColors } from '../palettes/types';
import type { ResolvedMap, ResolvedEdge } from './resolved-types';
import type { OnFillStyle } from './edge-labels';
// Type-only, so the cycle with layout.ts is erased at build time.
import type { MapLayoutLeg } from './layout';

/** A POI as this module sees it: a screen position and a rim radius. */
export interface ScreenPoi {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** Minimum edge stroke width — also the ride-on threshold for an edge label. */
export const W_MIN = 1.25;
const W_MAX = 8;
const FAN_STEP = 16; // px perpendicular offset between parallel edges
const ARC_CURVE_FRAC = 0.18; // default arc bow as a fraction of leg length
/** Gap between a leg's endpoint and the POI rim, so the line/arrow touches the
 *  circle edge rather than burying its tip at the centre dot. */
const RIM_GAP = 1.5;

const LEG_SAMPLES = 25;
const POI_CLEARANCE = 10; // px beyond a POI's radius an arc must keep
const LEG_CLEARANCE = 7; // px between two legs before they read as one line
const SHARED_END_RADIUS = 36; // px around a shared endpoint where converging is inevitable

/**
 * Signed bow amount along the chord normal (nx,ny). A fanned edge keeps its
 * explicit offset (sign separates parallels). A lone arc bows by the default
 * fraction; when an `away` point is given (a route's centroid), the sign is
 * flipped so the control point lands on the FAR side of that point — i.e. the
 * arc bulges OUTWARD relative to the polygon the route traces, never inward
 * across its interior.
 */
export function bowMagnitude(
  mx: number,
  my: number,
  nx: number,
  ny: number,
  offset: number,
  len: number,
  away?: { x: number; y: number }
): number {
  if (offset !== 0) return offset;
  const base = len * ARC_CURVE_FRAC;
  if (!away) return base;
  const dot = nx * (mx - away.x) + ny * (my - away.y);
  return dot < 0 ? -base : base;
}

/** The drawn `d` for one leg — `M…L…` when straight, `M…Q…` when bowed. */
export function legPath(
  a: ScreenPoi,
  b: ScreenPoi,
  curved: boolean,
  offset: number,
  away?: { x: number; y: number }
): string {
  const mx = (a.cx + b.cx) / 2;
  const my = (a.cy + b.cy) / 2;
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const len = Math.hypot(dx, dy) || 1;
  // Trim each end back to its POI rim, but never cross past the midpoint when
  // the circles nearly touch (keeps a hair of line rather than inverting).
  const trimA = Math.min(a.r + RIM_GAP, len * 0.45);
  const trimB = Math.min(b.r + RIM_GAP, len * 0.45);
  if (!curved && offset === 0) {
    const ux = dx / len;
    const uy = dy / len;
    const ax = a.cx + ux * trimA;
    const ay = a.cy + uy * trimA;
    const bx = b.cx - ux * trimB;
    const by = b.cy - uy * trimB;
    return `M${ax},${ay}L${bx},${by}`;
  }
  const nx = -dy / len;
  const ny = dx / len;
  const bow = bowMagnitude(mx, my, nx, ny, offset, len, away);
  const px = mx + nx * bow;
  const py = my + ny * bow;
  // Tangent at each end of the quadratic Q is toward/from the control point.
  const ta = Math.hypot(px - a.cx, py - a.cy) || 1;
  const tb = Math.hypot(b.cx - px, b.cy - py) || 1;
  const ax = a.cx + ((px - a.cx) / ta) * trimA;
  const ay = a.cy + ((py - a.cy) / ta) * trimA;
  const bx = b.cx - ((b.cx - px) / tb) * trimB;
  const by = b.cy - ((b.cy - py) / tb) * trimB;
  return `M${ax},${ay}Q${px},${py} ${bx},${by}`;
}

/**
 * Where a leg's label sits: the MIDPOINT OF THE DRAWN PATH, nudged a few px to
 * the bow side so the text rides just off the line. A straight leg's midpoint is
 * the chord midpoint; an arc is a quadratic Q whose t=0.5 point is
 * chord-mid + ½·normal·bow — so a long bowed arc (a trans-Atlantic route) must
 * follow the CURVE, else the label floats in open space far below the line.
 */
export function legLabelPoint(
  a: ScreenPoi,
  b: ScreenPoi,
  curved: boolean,
  offset: number,
  away?: { x: number; y: number }
): { x: number; y: number } {
  const mx = (a.cx + b.cx) / 2;
  const my = (a.cy + b.cy) / 2;
  if (!curved && offset === 0) return { x: mx, y: my - 4 };
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = bowMagnitude(mx, my, nx, ny, offset, len, away);
  // arc apex (½·bow) + a small lift further out so the text clears the stroke.
  const off = bow * 0.5 + Math.sign(bow || 1) * 8;
  return { x: mx + nx * off, y: my + ny * off };
}

/**
 * Build every drawn connector — routes first, then edges — choosing each lone
 * arc's bow so it dodges what is already on the canvas.
 *
 * A lone arc's default left-normal bow can run straight through an unrelated
 * POI or ride on top of another leg (a DEN dot sitting on the LGA→LAX chord).
 * Before emitting each arc, try a small candidate set of bows — default side,
 * flipped side, and wider versions of each — and keep the first with the
 * lowest penalty. Penalty = passing within clearance of a non-endpoint POI,
 * hugging an already-placed leg, or leaving the canvas. Greedy in emit order
 * (routes then edges, source order), so later legs dodge earlier ones; every
 * leg (straight or fanned too) registers as an obstacle. The default bow is
 * candidate 0 and wins ties, so an uncontested map renders exactly as before.
 *
 * The greedy order is the reason this is one function rather than two: an edge's
 * chosen bow depends on every route leg already emitted.
 */
export function buildConnectorLegs(args: {
  readonly resolved: ResolvedMap;
  readonly poiScreen: ReadonlyMap<string, ScreenPoi>;
  readonly palette: PaletteColors;
  readonly width: number;
  readonly height: number;
  readonly fillAt: (x: number, y: number) => string;
  readonly labelOnFill: (fill: string) => OnFillStyle;
}): MapLayoutLeg[] {
  const { resolved, poiScreen, palette, width, height, fillAt, labelOnFill } =
    args;

  const legs: MapLayoutLeg[] = [];

  /** A tag-group colour for this connector, when one of its tags carries one. */
  const lineColor = (tags: Readonly<Record<string, string>>): string | null => {
    for (const group of resolved.tagGroups) {
      const val = tags[tagAttrKey(group.name)];
      if (!val) continue;
      const entry = group.entries.find(
        (e) => e.value.toLowerCase() === val.toLowerCase()
      );
      if (entry?.color) return entry.color; // already hex (parser-resolved)
    }
    return null;
  };

  const placedLegSamples: Array<{
    fromId: string;
    toId: string;
    pts: Array<{ x: number; y: number }>;
  }> = [];

  const sampleLeg = (
    a: ScreenPoi,
    b: ScreenPoi,
    curved: boolean,
    bow: number
  ): Array<{ x: number; y: number }> => {
    const pts: Array<{ x: number; y: number }> = [];
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const px = (a.cx + b.cx) / 2 + (-dy / len) * bow;
    const py = (a.cy + b.cy) / 2 + (dx / len) * bow;
    for (let i = 0; i < LEG_SAMPLES; i++) {
      const t = i / (LEG_SAMPLES - 1);
      if (!curved && bow === 0) {
        pts.push({ x: a.cx + dx * t, y: a.cy + dy * t });
      } else {
        const u = 1 - t;
        pts.push({
          x: u * u * a.cx + 2 * u * t * px + t * t * b.cx,
          y: u * u * a.cy + 2 * u * t * py + t * t * b.cy,
        });
      }
    }
    return pts;
  };

  const legPenalty = (
    pts: Array<{ x: number; y: number }>,
    fromId: string,
    toId: string
  ): number => {
    let pen = 0;
    for (const [id, p] of poiScreen) {
      if (id === fromId || id === toId) continue;
      let dmin = Infinity;
      for (const s of pts) {
        const d = Math.hypot(s.x - p.cx, s.y - p.cy);
        if (d < dmin) dmin = d;
      }
      const clear = p.r + POI_CLEARANCE;
      if (dmin < clear) pen += (clear - dmin) * 12;
    }
    for (const other of placedLegSamples) {
      const shared = [fromId, toId]
        .filter((id) => id === other.fromId || id === other.toId)
        .map((id) => poiScreen.get(id))
        .filter((p): p is NonNullable<typeof p> => !!p);
      for (const s of pts) {
        if (
          shared.some(
            (sp) => Math.hypot(s.x - sp.cx, s.y - sp.cy) < SHARED_END_RADIUS
          )
        ) {
          continue;
        }
        let dmin = Infinity;
        for (const o of other.pts) {
          const d = Math.hypot(s.x - o.x, s.y - o.y);
          if (d < dmin) dmin = d;
        }
        if (dmin < LEG_CLEARANCE) pen += 6;
      }
    }
    for (const s of pts) {
      if (s.x < 0 || s.x > width || s.y < 0 || s.y > height) pen += 20;
    }
    return pen;
  };

  const chooseArcBow = (
    a: ScreenPoi,
    b: ScreenPoi,
    fromId: string,
    toId: string,
    away?: { x: number; y: number }
  ): number => {
    const mx = (a.cx + b.cx) / 2;
    const my = (a.cy + b.cy) / 2;
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const def = bowMagnitude(mx, my, nx, ny, 0, len, away);
    const candidates = [
      def,
      -def,
      def * 1.6,
      -def * 1.6,
      def * 2.2,
      -def * 2.2,
    ];
    let best = def;
    let bestPen = Infinity;
    for (const c of candidates) {
      const pen = legPenalty(sampleLeg(a, b, true, c), fromId, toId);
      if (pen < bestPen - 1e-6) {
        best = c;
        bestPen = pen;
      }
      if (bestPen === 0) break;
    }
    return best;
  };

  // Routes: each leg is an edge (fromId → toId) carrying its own label,
  // value→thickness, and arc shape. Loop-closing legs are explicit in `rt.legs`;
  // the origin is never double-marked because `stopIds` is unique.
  const routeLegVals = resolved.routes
    .flatMap((rt) => rt.legs)
    .map((l) => Number(l.value))
    .filter((n) => Number.isFinite(n) && n > 0);
  const rlMin = routeLegVals.length ? Math.min(...routeLegVals) : 0;
  const rlMax = routeLegVals.length ? Math.max(...routeLegVals) : 0;
  const routeWidthFor = (v: number): number => {
    if (!Number.isFinite(v) || v <= 0 || rlMax <= 0) return W_MIN;
    const t = rlMax > rlMin ? (v - rlMin) / (rlMax - rlMin) : 1;
    return W_MIN + t * (W_MAX - W_MIN);
  };
  for (const rt of resolved.routes) {
    // Centroid of the route's stops — the "inside" of the polygon it traces.
    // Arc legs bow AWAY from this so a multi-stop loop reads as a rounded ring
    // (arcs bulging outward) instead of crossing chords through the middle. A
    // route needs ≥3 distinct stops to enclose anything; below that there's no
    // interior and the default (consistent left-normal) bow is kept.
    const stopPts = rt.stopIds
      .map((id) => poiScreen.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p);
    const center =
      stopPts.length >= 3
        ? {
            x: stopPts.reduce((s, p) => s + p.cx, 0) / stopPts.length,
            y: stopPts.reduce((s, p) => s + p.cy, 0) / stopPts.length,
          }
        : undefined;
    for (const leg of rt.legs) {
      const a = poiScreen.get(leg.fromId);
      const b = poiScreen.get(leg.toId);
      if (!a || !b) continue;
      const curvedLeg = leg.style === 'arc';
      // Avoidance-chosen bow rides the explicit-offset channel (bowMagnitude
      // returns a non-zero offset verbatim), so path + label stay in sync.
      const chosenBow = curvedLeg
        ? chooseArcBow(a, b, leg.fromId, leg.toId, center)
        : 0;
      const lp = legLabelPoint(a, b, curvedLeg, chosenBow, center);
      const bow = {
        curved: curvedLeg,
        offset: chosenBow,
        center,
        labelX: lp.x,
        labelY: lp.y,
      };
      placedLegSamples.push({
        fromId: leg.fromId,
        toId: leg.toId,
        pts: sampleLeg(a, b, curvedLeg, chosenBow),
      });
      const routeLabelStyle =
        leg.label !== undefined
          ? labelOnFill(fillAt(bow.labelX, bow.labelY))
          : undefined;
      const routeVal = Number(leg.value);
      legs.push({
        d: legPath(a, b, bow.curved, bow.offset, bow.center),
        width: routeWidthFor(routeVal),
        color: lineColor(leg.tags) ?? mix(palette.text, palette.bg, 72),
        arrow: true,
        fromId: leg.fromId,
        toId: leg.toId,
        ...(Number.isFinite(routeVal) && routeVal > 0 && { value: routeVal }),
        ...(Object.keys(leg.tags).length > 0 && { tags: leg.tags }),
        lineNumber: leg.lineNumber,
        ...(leg.label !== undefined && {
          label: leg.label,
          labelX: bow.labelX,
          labelY: bow.labelY,
          labelColor: routeLabelStyle!.color,
          labelHalo: routeLabelStyle!.halo,
          labelHaloColor: routeLabelStyle!.haloColor,
        }),
      });
    }
  }

  // Edges: group by unordered endpoint pair for deterministic fan-out (AR9).
  // Edge thickness rides on the `width:` channel (§24B.6).
  const weightVals = resolved.edges
    .map((e) => Number(e.meta['width']))
    .filter((n) => Number.isFinite(n) && n > 0);
  const wMin = weightVals.length ? Math.min(...weightVals) : 0;
  const wMax = weightVals.length ? Math.max(...weightVals) : 0;
  const widthFor = (e: ResolvedEdge): number => {
    const v = Number(e.meta['width']);
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
      const fanOffset = n > 1 ? (i - (n - 1) / 2) * FAN_STEP : 0;
      const curved = e.style === 'arc' || n > 1;
      // Lone arcs get avoidance; fanned parallels keep their fixed offsets
      // (the fan itself is the separation) and straight edges stay straight.
      const edgeBow =
        curved && n === 1 ? chooseArcBow(a, b, e.fromId, e.toId) : fanOffset;
      const lp = legLabelPoint(a, b, curved, edgeBow);
      const bow = {
        curved,
        offset: edgeBow,
        labelX: lp.x,
        labelY: lp.y,
      };
      placedLegSamples.push({
        fromId: e.fromId,
        toId: e.toId,
        pts: sampleLeg(a, b, curved, edgeBow),
      });
      const edgeLabelStyle =
        e.label !== undefined
          ? labelOnFill(fillAt(bow.labelX, bow.labelY))
          : undefined;
      const edgeVal = Number(e.meta['width']);
      legs.push({
        d: legPath(a, b, bow.curved, bow.offset),
        width: widthFor(e),
        color: lineColor(e.tags) ?? mix(palette.text, palette.bg, 66),
        arrow: e.directed,
        fromId: e.fromId,
        toId: e.toId,
        ...(Number.isFinite(edgeVal) && edgeVal > 0 && { value: edgeVal }),
        ...(Object.keys(e.tags).length > 0 && { tags: e.tags }),
        lineNumber: e.lineNumber,
        ...(e.label !== undefined && {
          label: e.label,
          labelX: bow.labelX,
          labelY: bow.labelY,
          labelColor: edgeLabelStyle!.color,
          labelHalo: edgeLabelStyle!.halo,
          labelHaloColor: edgeLabelStyle!.haloColor,
        }),
      });
    });
  }

  return legs;
}
