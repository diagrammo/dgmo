// ============================================================
// Retry elbow — a back edge between adjacent ranks (#2034)
// ============================================================
//
// dagre reverses a back edge, routes it as a forward one, then flips it. When
// its two nodes sit in adjacent ranks, that route and the forward edge between
// the same pair share one short column: in `[Pay] -> <OK?>` with
// `<OK?> -no-> [Pay]` the two lines run a few pixels apart, cross, and the
// "no" label sits between them. The loop is usually the point of a flowchart.
//
// Such an edge is redrawn as an elbow beside the column: out of the lower
// node's side, along the column, and back into the upper node's same side.
// The label anchors on the middle waypoint (`flowchart-renderer.ts`), which
// here is the middle of the elbow's leg. Under `LR` the same elbow hangs below
// the row. An elbow is kept only where its corridor is clear of every other
// node and it adds no crossing; otherwise dagre's route stays. Long back edges
// (more than one rank apart) are not touched here (#1891).

import type { GraphDirection } from './types';

type Pt = { readonly x: number; readonly y: number };

/** A node box, centred on (x, y). */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How far the elbow's leg runs outside the wider of its two nodes. */
const ELBOW_GAP = 16;
/** Space between two elbows that leave the same column on the same side. */
const ELBOW_STEP = 14;
/**
 * Room kept clear beyond the leg for the label, which the renderer offsets
 * to the outside of the leg.
 */
const LABEL_ROOM = 30;
/** Two rank centres closer than this are one rank. */
const RANK_EPS = 1;

/** A point in flow terms: `r` along the ranks, `c` across them. */
interface Flow {
  readonly r: number;
  readonly c: number;
}

/**
 * `routes` with every adjacent-rank back edge drawn as an elbow beside its
 * column. `crossings` scores a full set of routes; an elbow that raises the
 * score is dropped.
 */
export function elbowRetryEdges(
  edges: readonly { readonly source: string; readonly target: string }[],
  routes: readonly (readonly Pt[])[],
  boxes: ReadonlyMap<string, Box>,
  direction: GraphDirection,
  crossings: (rs: readonly (readonly Pt[])[]) => number
): readonly (readonly Pt[])[] {
  const lr = direction === 'LR';
  const toFlow = (p: Pt): Flow =>
    lr ? { r: p.x, c: p.y } : { r: p.y, c: p.x };
  const fromFlow = (f: Flow): Pt =>
    lr ? { x: f.r, y: f.c } : { x: f.c, y: f.r };
  // A box's half extents along and across the ranks.
  const halfR = (b: Box): number => (lr ? b.width : b.height) / 2;
  const halfC = (b: Box): number => (lr ? b.height : b.width) / 2;

  const rankCentres = [...boxes.values()]
    .map((b) => toFlow(b).r)
    .sort((a, b) => a - b);
  const adjacent = (a: number, b: number): boolean => {
    const lo = Math.min(a, b) + RANK_EPS;
    const hi = Math.max(a, b) - RANK_EPS;
    return hi > lo && !rankCentres.some((r) => r > lo && r < hi);
  };

  let out = routes;
  // Legs already placed, so a second elbow on one side of a column steps out.
  const legs: { c: number; lo: number; hi: number; side: 1 | -1 }[] = [];

  edges.forEach((edge, i) => {
    if (edge.source === edge.target) return;
    const src = boxes.get(edge.source);
    const tgt = boxes.get(edge.target);
    if (!src || !tgt) return;
    const s = toFlow(src);
    const t = toFlow(tgt);
    // A back edge runs against the flow: its target ranks before its source.
    if (!(t.r < s.r - RANK_EPS) || !adjacent(s.r, t.r)) return;

    for (const side of [1, -1] as const) {
      // The outer face on this side of the wider node, then the leg.
      const face = (b: Box): number => toFlow(b).c + side * halfC(b);
      const outer =
        side === 1
          ? Math.max(face(src), face(tgt))
          : Math.min(face(src), face(tgt));
      let leg = outer + side * ELBOW_GAP;
      const lo = t.r;
      const hi = s.r;
      for (const l of legs) {
        if (l.side !== side || l.hi < lo || l.lo > hi) continue;
        if (side * (l.c - leg) >= 0) leg = l.c + side * ELBOW_STEP;
      }

      // The corridor from the nearer face out past the label must hold no
      // other node.
      const inner =
        side === 1
          ? Math.min(face(src), face(tgt))
          : Math.max(face(src), face(tgt));
      const cMin = Math.min(inner, leg + side * LABEL_ROOM);
      const cMax = Math.max(inner, leg + side * LABEL_ROOM);
      const blocked = [...boxes.entries()].some(([id, b]) => {
        if (id === edge.source || id === edge.target) return false;
        const f = toFlow(b);
        return (
          f.c + halfC(b) > cMin &&
          f.c - halfC(b) < cMax &&
          f.r + halfR(b) > lo - halfR(tgt) &&
          f.r - halfR(b) < hi + halfR(src)
        );
      });
      if (blocked) continue;

      // Out of the source's side, along the leg, into the target's side.
      // The leg carries five waypoints so the middle one — the label's
      // anchor — is its midpoint, and the basis curve runs straight there.
      const span = s.r - t.r;
      const elbow: Pt[] = [
        { r: s.r, c: face(src) },
        { r: s.r, c: leg },
        { r: s.r - span / 4, c: leg },
        { r: s.r - span / 2, c: leg },
        { r: t.r + span / 4, c: leg },
        { r: t.r, c: leg },
        { r: t.r, c: face(tgt) },
      ].map(fromFlow);

      const next = out.map((r, j) => (j === i ? elbow : r));
      if (crossings(next) > crossings(out)) continue;
      out = next;
      legs.push({ c: leg, lo, hi, side });
      return;
    }
  });

  return out;
}
