import { rectsOverlap, rectCircleOverlap } from '../label-layout';
import type { LabelRect, PointCircle } from '../label-layout';
// Type-only, so the cycle with layout.ts is erased at build time.
import type { MapLayoutLeg } from './layout';

/** Contrast-picked text styling for a label sitting on a given fill. */
export interface OnFillStyle {
  readonly color: string;
  readonly halo: boolean;
  readonly haloColor: string;
}

/** The t-values walked along a leg's drawn path, midpoint outward. */
const T_LIST = [0.5, 0.42, 0.58, 0.34, 0.66, 0.28, 0.72];

/** `M…L…` or `M…Q…` — the two shapes a leg's `d` ever takes. */
const LEG_PATH_RE =
  /^M(-?[\d.]+),(-?[\d.]+)(?:L(-?[\d.]+),(-?[\d.]+)|Q(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+))$/;

/**
 * Place each connector's label clear of the POI dots and the labels already
 * committed.
 *
 * A connector's label (a freight weight, a pact name) rides its line midpoint by
 * default. Nudge it ALONG the chord — then a small perpendicular hop — to the
 * first slot that clears every POI dot and every committed region/POI label, so a
 * label crossing a busy port stops sitting on top of it. The line itself is NOT
 * an obstacle (a label is meant to ride its own line); falls back to the midpoint
 * if no slot is clean. Runs on the settled layout (after the POI-clearance
 * re-fit has converged), so dot/label positions are final.
 *
 * MUTATES `legs` in place — each labelled entry is replaced with a copy carrying
 * its resolved label position and colours (MapLayoutLeg fields are readonly).
 * Returns the chosen rects so the caller can feed them to the context-label
 * pass, which must dodge them too.
 */
export function layoutEdgeLabels(args: {
  /** MUTATED: labelled entries are replaced with positioned copies. */
  readonly legs: MapLayoutLeg[];
  /** Labels already committed this pass (region + POI). Hidden ones are ignored. */
  readonly committed: readonly {
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly anchor: string;
    readonly hidden?: boolean;
  }[];
  readonly poiScreen: ReadonlyMap<
    string,
    { readonly cx: number; readonly cy: number; readonly r: number }
  >;
  readonly markers: readonly PointCircle[];
  readonly labelW: (text: string) => number;
  readonly labelH: number;
  /** Minimum leg stroke width — the ride-on default applies below 4px. */
  readonly minStroke: number;
  readonly fillAt: (x: number, y: number) => string;
  readonly labelOnFill: (fill: string) => OnFillStyle;
  readonly width: number;
  readonly height: number;
}): LabelRect[] {
  const {
    legs,
    committed,
    poiScreen,
    markers,
    labelW,
    labelH,
    minStroke,
    fillAt,
    labelOnFill,
    width,
    height,
  } = args;

  const chosen: LabelRect[] = [];
  if (!legs.some((lg) => lg.label !== undefined)) return chosen;

  const committedBoxes: LabelRect[] = committed
    .filter((l) => !l.hidden)
    .map((l) => {
      const w = labelW(l.text);
      const x =
        l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - w : l.x - w / 2;
      return { x, y: l.y - labelH / 2, w, h: labelH };
    });

  const placedEdge: LabelRect[] = [];
  for (let i = 0; i < legs.length; i++) {
    const lg = legs[i]!;
    if (lg.label === undefined) continue;
    const a = poiScreen.get(lg.fromId);
    const b = poiScreen.get(lg.toId);
    if (!a || !b) continue;
    const w = labelW(lg.label);
    const dx = b.cx - a.cx;
    const dy = b.cy - a.cy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len; // unit normal to the chord
    const perp = labelH + 2;
    // A label rides ON its line by default (off=0 first) — a hairline under
    // the text reads fine and looks intentional. But a HEAVY weighted leg
    // (value→width up to W_MAX) draws a thick dark stroke, and text centred on
    // it is unreadable (dark-on-dark, no contrast). For those, lead with a
    // perpendicular hop that clears the stroke's half-width + the label's own
    // half-height + a gap, so the text sits just BESIDE the line on open
    // ground (both sides tried; the first clean one — typically the open-water
    // side — wins). Thin legs keep the ride-on default untouched.
    const stroke = lg.width ?? minStroke;
    const clearW = stroke / 2 + labelH / 2 + 3;
    const offList =
      stroke >= 4
        ? [clearW, -clearW, clearW + perp, -(clearW + perp), 0]
        : [0, perp, -perp, 2 * perp, -2 * perp];
    // Walk the ACTUAL DRAWN PATH, not the chord: parse the leg's `d` (the
    // trimmed `M…Q…` arc or `M…L…` line) and sample the curve at each t, so a
    // label rides its own bowed line instead of floating at the chord midpoint
    // out in open space (the trans-Atlantic arc case). The perpendicular hop
    // uses the chord normal, which is close enough to nudge a label clear.
    const pm = LEG_PATH_RE.exec(lg.d);
    const pointAt = (t: number): [number, number] => {
      if (pm?.[5] !== undefined) {
        const u = 1 - t;
        return [
          u * u * +pm[1]! + 2 * u * t * +pm[5]! + t * t * +pm[7]!,
          u * u * +pm[2]! + 2 * u * t * +pm[6]! + t * t * +pm[8]!,
        ];
      }
      if (pm?.[3] !== undefined)
        return [
          +pm[1]! + (+pm[3]! - +pm[1]!) * t,
          +pm[2]! + (+pm[4]! - +pm[2]!) * t,
        ];
      return [a.cx + dx * t, a.cy + dy * t];
    };
    // Stay ON the line first (slide along it), then escalate to a perpendicular
    // hop — growing — so a label on a SHORT leg between two close dots (where
    // every on-line slot straddles an endpoint) can still escape above or below.
    const candidates: Array<[number, number]> = [];
    for (const off of offList)
      for (const t of T_LIST) {
        const [bx, by] = pointAt(t);
        candidates.push([bx + nx * off, by + ny * off - 4]);
      }
    const clean = ([cx, cy]: [number, number]): boolean => {
      const rect = { x: cx - w / 2, y: cy - labelH / 2, w, h: labelH };
      if (
        rect.x < 0 ||
        rect.x + w > width ||
        rect.y < 0 ||
        rect.y + rect.h > height
      )
        return false;
      if (markers.some((m) => rectCircleOverlap(rect, m))) return false;
      if (committedBoxes.some((o) => rectsOverlap(o, rect))) return false;
      if (placedEdge.some((o) => rectsOverlap(o, rect))) return false;
      return true;
    };
    const mid = pointAt(0.5);
    const [cx, cy] = candidates.find(clean) ?? [mid[0], mid[1] - 4];
    const style = labelOnFill(fillAt(cx, cy));
    // MapLayoutLeg fields are readonly — replace the entry with an updated copy.
    legs[i] = {
      ...lg,
      labelX: cx,
      labelY: cy,
      labelColor: style.color,
      labelHalo: style.halo,
      labelHaloColor: style.haloColor,
    };
    const rect = { x: cx - w / 2, y: cy - labelH / 2, w, h: labelH };
    placedEdge.push(rect);
    chosen.push(rect);
  }

  return chosen;
}
