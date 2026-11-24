// A group's unlinked boxes fill the holes in its grid (#2062, rubric rule 4).
//
// Dagre ranks a group's linked boxes by their arrows and wraps its unlinked
// ones into rows of their own (`wrapChains` in layout-search.ts). The two
// lattices do not line up: an unlinked row can start a rank late, and a linked
// box alone at rank 0 leaves its column empty around it. An unlinked box has
// no arrow to keep anywhere, so this pass lifts every unlinked box out of the
// group and puts them back into the group's own lattice cells in reading
// order — line by line across the flow, each line from its start along the
// flow — skipping any cell an arrow or another box runs through. Holes then
// come only at a line's end, and the caller's frame tightening trims the
// emptied tail.
import type { BLLayoutResult } from './layout';
import type { BLGroup } from './types';

/** Box centres closer than this share a lattice line. Mirrors LATTICE_TOL in
 *  tests/stress/bl-rubric.ts. */
const LATTICE_TOL = 20;
/** Clearance a moved box keeps from another box. */
const BOX_GAP = 8;
/** Clearance a moved box keeps from an arrow. */
const EDGE_GAP = 6;

interface Pt {
  x: number;
  y: number;
}
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Cluster means of `vals` (sorted values within LATTICE_TOL of the previous
 *  one share a cluster), and each value's cluster index by position. */
function lattice(vals: readonly number[]): {
  means: number[];
  index: number[];
} {
  const order = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const index: number[] = new Array<number>(vals.length);
  const sums: number[][] = [];
  let prev = -Infinity;
  for (const [v, i] of order) {
    if (v - prev > LATTICE_TOL) sums.push([]);
    sums[sums.length - 1]!.push(v);
    index[i] = sums.length - 1;
    prev = v;
  }
  return {
    means: sums.map((s) => s.reduce((a, b) => a + b, 0) / s.length),
    index,
  };
}

function boxesTouch(a: Box, b: Box, gap: number): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + gap
  );
}

function segmentTouches(a: Pt, b: Pt, r: Box, gap: number): boolean {
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    if (
      Math.abs(x - r.x) < r.width / 2 + gap &&
      Math.abs(y - r.y) < r.height / 2 + gap
    )
      return true;
  }
  return false;
}

/**
 * Moves each group's unlinked boxes into the group's lattice holes, in
 * reading order. Only a group with an unlinked box sitting after a hole in
 * its line is touched, so a group already packed keeps its exact positions.
 * Skipped: groups holding other groups (expanded or folded), groups an arrow
 * ends on, and every box in `pinned` (named by a layout hint). Frames are left
 * as they were; the caller tightens them. Returns `layout` itself when no box
 * moved.
 */
export function packUnlinkedMembers(
  layout: BLLayoutResult,
  groups: readonly BLGroup[],
  flowX: boolean,
  pinned: ReadonlySet<string>
): BLLayoutResult {
  const linked = new Set(layout.edges.flatMap((e) => [e.source, e.target]));
  const nodes = layout.nodes.map((n) => ({ ...n }));
  const byLabel = new Map(nodes.map((n) => [n.label, n]));
  const along = (b: Box) => (flowX ? b.x : b.y);
  const across = (b: Box) => (flowX ? b.y : b.x);
  let moved = false;
  for (const g of groups) {
    const frame = layout.groups.find((f) => f.label === g.label);
    if (!frame || frame.collapsed) continue;
    if (groups.some((o) => o.parentGroup === g.label)) continue;
    if (layout.groups.some((f) => f.collapsed && g.children.includes(f.label)))
      continue;
    if (linked.has('__group_' + g.label) || linked.has(g.label)) continue;
    const members = g.children.flatMap((c) => byLabel.get(c) ?? []);
    if (members.length < 2) continue;
    const free = members.filter(
      (n) => !linked.has(n.label) && !pinned.has(n.label)
    );
    if (free.length === 0) continue;
    const la = lattice(members.map(along));
    const lc = lattice(members.map(across));
    const key = (a: number, c: number) => a * lc.means.length + c;
    const filled = new Set(
      members.map((_, i) => key(la.index[i]!, lc.index[i]!))
    );
    const holed = free.some((n) => {
      const i = members.indexOf(n);
      for (let a = 0; a < la.index[i]!; a++)
        if (!filled.has(key(a, lc.index[i]!))) return true;
      return false;
    });
    if (!holed) continue;

    // Reading order of the free boxes as they stand, so their relative order
    // survives the move.
    const queue = free
      .map((n) => ({ n, i: members.indexOf(n) }))
      .sort(
        (p, q) =>
          lc.index[p.i]! - lc.index[q.i]! || la.index[p.i]! - la.index[q.i]!
      )
      .map((p) => p.n);
    const freeSet = new Set(queue);
    const others = nodes.filter((n) => !freeSet.has(n));
    const placed: Box[] = [];
    const out = new Map<(typeof nodes)[number], Pt>();
    // Lines hold at most `cap` cells first, so the boxes fill a near-square
    // block rather than every column the lattice has; a chain of linked boxes
    // longer than that sets the width. Cells past `cap` take what is left.
    const linkedAlong = new Set(
      members.flatMap((n, i) => (freeSet.has(n) ? [] : [la.index[i]!]))
    );
    const cap = Math.max(
      Math.ceil(Math.sqrt(members.length)),
      linkedAlong.size
    );
    const tryCell = (a: number, c: number): void => {
      const n = queue[0]!;
      const cx = flowX ? la.means[a]! : lc.means[c]!;
      const cy = flowX ? lc.means[c]! : la.means[a]!;
      const r: Box = { x: cx, y: cy, width: n.width, height: n.height };
      if (others.some((o) => boxesTouch(o, r, BOX_GAP))) return;
      if (placed.some((o) => boxesTouch(o, r, BOX_GAP))) return;
      if (
        layout.edges.some((e) =>
          e.points.some(
            (p, k) => k > 0 && segmentTouches(e.points[k - 1]!, p, r, EDGE_GAP)
          )
        )
      )
        return;
      placed.push(r);
      out.set(n, { x: cx, y: cy });
      queue.shift();
    };
    for (const [lo, hi] of [
      [0, Math.min(cap, la.means.length)],
      [cap, la.means.length],
    ] as const)
      for (let c = 0; c < lc.means.length && queue.length > 0; c++)
        for (let a = lo; a < hi && queue.length > 0; a++) tryCell(a, c);
    // A box with no cell left keeps its place; nothing moves for this group
    // unless every free box found one.
    if (queue.length > 0) continue;
    for (const [n, p] of out) {
      if (Math.abs(n.x - p.x) > 0.5 || Math.abs(n.y - p.y) > 0.5) moved = true;
      n.x = p.x;
      n.y = p.y;
    }
  }
  if (!moved) return layout;
  return { ...layout, nodes, groups: layout.groups.map((g) => ({ ...g })) };
}
