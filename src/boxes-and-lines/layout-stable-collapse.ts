// ============================================================
// Boxes and Lines — stable collapse layout (anchor + compaction)
// ============================================================
//
// When a group collapses interactively, a full placement search moves every
// node (previous positions are only a soft stability term), so the diagram
// "teleports". This path instead:
//
//   1. Freezes every surviving node at its previous position.
//   2. Places a newly collapsed TOP-LEVEL pill at the top-left of its group's
//      old frame — the group's slot — and a nested one at its members' old
//      bounding-box centre. An already-collapsed pill keeps its own previous
//      position.
//   3. Compacts per axis, keeping the ORDER rather than the coordinates: rigid
//      units (top-level groups move as one) that sat after a shrunken group
//      close up to their old spacing from it, and nothing passes anything
//      (#1784).
//   4. Rebuilds expanded-group container rects from their (frozen) members and
//      routes edges as straight border-to-border segments.
//
// Strictly opt-in (`stableCollapse`) and best-effort: any gap in coverage
// (unknown node, missing member positions, resulting overlap) returns null and
// the caller falls back to the normal placement search.

import type { ParsedBoxesAndLines, BLGroup } from './types';
import { NODE_WIDTH, NODE_HEIGHT } from './node-metrics';
import type {
  BLLayoutResult,
  BLLayoutEdge,
  BLLayoutGroup,
  BLLayoutNode,
} from './layout';

type Pt = { x: number; y: number };
/** Centre-based rect, matching layout coordinates. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GROUP_PAD = 16;
const GROUP_LABEL_ZONE = 32;
const MARGIN = 40;
/** Minimum clearance preserved between a sliding unit and static content. */
const MIN_GAP = 36;

const gid = (label: string): string => `__group_${label}`;

const left = (r: Rect): number => r.x - r.width / 2;
const right = (r: Rect): number => r.x + r.width / 2;
const top = (r: Rect): number => r.y - r.height / 2;
const bottom = (r: Rect): number => r.y + r.height / 2;

function bboxOf(rects: readonly Rect[]): Rect {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, left(r));
    y0 = Math.min(y0, top(r));
    x1 = Math.max(x1, right(r));
    y1 = Math.max(y1, bottom(r));
  }
  return {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    width: x1 - x0,
    height: y1 - y0,
  };
}

/** A group frame around its members' bounding box: padding plus label zone. */
function padFrame(b: Rect): Rect {
  return {
    x: b.x,
    y: b.y - GROUP_LABEL_ZONE / 2,
    width: b.width + 2 * GROUP_PAD,
    height: b.height + 2 * GROUP_PAD + GROUP_LABEL_ZONE,
  };
}

/** Point where the ray from `rect`'s centre toward `toward` exits the rect. */
function borderPoint(rect: Rect, toward: Pt): Pt {
  const dx = toward.x - rect.x;
  const dy = toward.y - rect.y;
  const sx = dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  if (!Number.isFinite(s)) return { x: rect.x, y: rect.y };
  return { x: rect.x + dx * s, y: rect.y + dy * s };
}

export interface StableCollapseInput {
  parsed: ParsedBoxesAndLines;
  collapseInfo: {
    collapsedChildCounts: Map<string, number>;
    originalGroups: readonly BLGroup[];
  };
  collapsedGroupLabels: ReadonlySet<string>;
  previousPositions: ReadonlyMap<string, Pt>;
  sizes: ReadonlyMap<string, { width: number; height: number }>;
  rankdir: 'LR' | 'TB';
}

export function tryStableCollapseLayout(
  input: StableCollapseInput
): BLLayoutResult | null {
  const {
    parsed,
    collapseInfo,
    collapsedGroupLabels,
    previousPositions,
    sizes,
  } = input;
  const prev = previousPositions;

  // ── Coverage: every surviving node must have a previous position ──
  const rects = new Map<string, Rect>(); // node label / pill gid → rect
  for (const n of parsed.nodes) {
    const p = prev.get(n.label);
    const s = sizes.get(n.label);
    if (!p || !s) return null;
    rects.set(n.label, { x: p.x, y: p.y, width: s.width, height: s.height });
  }

  // ── Original-group structure (pre-collapse) for member lookups ──
  const ogByLabel = new Map<string, BLGroup>();
  for (const g of collapseInfo.originalGroups) ogByLabel.set(g.label, g);
  /** Descendant labels of an original group that are NODES (not sub-groups). */
  const descendantNodes = (
    label: string,
    seen = new Set<string>()
  ): string[] => {
    if (seen.has(label)) return [];
    seen.add(label);
    const g = ogByLabel.get(label);
    if (!g) return [];
    const out: string[] = [];
    for (const c of g.children) {
      if (ogByLabel.has(c)) out.push(...descendantNodes(c, seen));
      else out.push(c);
    }
    return out;
  };

  // ── Pills: anchor each collapsed group ──
  // Previously collapsed → its own previous pill position. Newly collapsed →
  // members approximated at the largest surviving node size (their true sizes
  // left the size map with the collapse transform). A TOP-LEVEL pill takes its
  // group's slot: it sits at the top-left of the group's old frame, and the
  // compaction pass below closes the rest of the frame up (#1784). A pill
  // nested in an expanded group sits at its members' old bounding-box centre.
  let estW = NODE_WIDTH;
  let estH = NODE_HEIGHT;
  for (const s of sizes.values()) {
    estW = Math.max(estW, s.width);
    estH = Math.max(estH, s.height);
  }
  /** Each collapsed pill's extent BEFORE this collapse: the group's old frame
   *  when newly collapsed, else the pill itself. Read by the compaction pass. */
  const pillOrigin = new Map<string, Rect>();
  /** A node's rect before this collapse — its own, or estimated for a member. */
  const origNodeRect = (label: string): Rect | null => {
    const r = rects.get(label);
    if (r) return r;
    const p = prev.get(label);
    return p ? { x: p.x, y: p.y, width: estW, height: estH } : null;
  };
  /** An original group's frame before this collapse. */
  const origFrame = (label: string, seen = new Set<string>()): Rect | null => {
    if (seen.has(label)) return null;
    seen.add(label);
    if (collapsedGroupLabels.has(label) && prev.has(gid(label)))
      return rects.get(gid(label)) ?? null;
    const g = ogByLabel.get(label);
    if (!g) return null;
    const parts: Rect[] = [];
    for (const c of g.children) {
      const r = ogByLabel.has(c) ? origFrame(c, seen) : origNodeRect(c);
      if (r) parts.push(r);
    }
    return parts.length > 0 ? padFrame(bboxOf(parts)) : null;
  };
  // Previously collapsed pills first, so `origFrame` can read their rects.
  for (const label of collapsedGroupLabels) {
    const own = prev.get(gid(label));
    if (!own) continue;
    const r = { x: own.x, y: own.y, width: NODE_WIDTH, height: NODE_HEIGHT };
    rects.set(gid(label), r);
    pillOrigin.set(gid(label), r);
  }
  for (const label of collapsedGroupLabels) {
    if (rects.has(gid(label))) continue;
    const members = descendantNodes(label);
    if (members.length === 0) return null;
    if (members.some((m) => !prev.has(m))) return null;
    const frame = origFrame(label);
    if (!frame) return null;
    const topLevel = !ogByLabel.get(label)?.parentGroup;
    const at = topLevel
      ? { x: left(frame) + NODE_WIDTH / 2, y: top(frame) + NODE_HEIGHT / 2 }
      : bboxOf(members.map((m) => origNodeRect(m)!));
    rects.set(gid(label), {
      x: at.x,
      y: at.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
    pillOrigin.set(gid(label), topLevel ? frame : rects.get(gid(label))!);
  }

  // ── Rigid units for the compaction pass ──
  // A top-level expanded group moves as one unit (member nodes + pills of
  // collapsed sub-groups); ungrouped nodes and top-level pills move alone.
  const groupByLabel = new Map(parsed.groups.map((g) => [g.label, g]));
  /** Frame of a current expanded group, built from the current rects. */
  const currentFrame = (
    label: string,
    seen = new Set<string>()
  ): Rect | null => {
    if (seen.has(label)) return null;
    seen.add(label);
    const g = groupByLabel.get(label);
    if (!g) return null;
    const parts: Rect[] = [];
    for (const c of g.children) {
      const r = groupByLabel.has(c)
        ? currentFrame(c, seen)
        : (rects.get(c) ?? rects.get(gid(c)) ?? null);
      if (r) parts.push(r);
    }
    return parts.length > 0 ? padFrame(bboxOf(parts)) : null;
  };
  const inUnit = new Set<string>();
  const unitKeys = (label: string, seen = new Set<string>()): string[] => {
    if (seen.has(label)) return [];
    seen.add(label);
    const g = groupByLabel.get(label);
    if (!g) return [];
    const out: string[] = [];
    for (const c of g.children) {
      if (groupByLabel.has(c)) out.push(...unitKeys(c, seen));
      else if (rects.has(c)) out.push(c);
      else if (rects.has(gid(c))) out.push(gid(c));
    }
    return out;
  };
  interface Unit {
    keys: string[];
    /** Extent before this collapse — fixes the order and the spacing. */
    orig: Rect;
    /** Current extent; recomputed as the unit moves. */
    cur: () => Rect;
  }
  const units: Unit[] = [];
  for (const g of parsed.groups) {
    if (g.parentGroup) continue;
    const keys = unitKeys(g.label);
    if (keys.length === 0) continue;
    for (const k of keys) inUnit.add(k);
    const orig = origFrame(g.label);
    if (!orig) return null;
    const label = g.label;
    units.push({ keys, orig, cur: () => currentFrame(label)! });
  }
  for (const key of rects.keys()) {
    if (inUnit.has(key)) continue;
    units.push({
      keys: [key],
      orig: pillOrigin.get(key) ?? rects.get(key)!,
      cur: () => rects.get(key)!,
    });
  }

  // ── Compaction: keep the ORDER, not the coordinates (#1784) ──
  // Per axis, unit j must stay after unit i when i sat wholly before j and the
  // two overlapped on the other axis before the collapse. An adjacent pair
  // keeps its old spacing; a pair with another unit between them only has to
  // stay clear. A unit with no such predecessor stays put. Nothing therefore
  // moves away, nothing passes anything, and a gap closes only where space was
  // freed by a group shrinking to its pill. Pairs that overlap on the other
  // axis only NOW (after the first pass) are kept clear as well.
  for (const axis of ['x', 'y'] as const) {
    const perp = axis === 'x' ? 'y' : 'x';
    const lo = (r: Rect, a: 'x' | 'y'): number =>
      a === 'x' ? left(r) : top(r);
    const hi = (r: Rect, a: 'x' | 'y'): number =>
      a === 'x' ? right(r) : bottom(r);
    const perpOverlap = (a: Rect, b: Rect): boolean =>
      lo(a, perp) < hi(b, perp) - 4 && hi(a, perp) > lo(b, perp) + 4;
    const n = units.length;
    const cur = units.map((u) => u.cur());
    const before = (i: number, j: number): boolean =>
      i !== j &&
      hi(units[i]!.orig, axis) <= lo(units[j]!.orig, axis) + 0.5 &&
      perpOverlap(units[i]!.orig, units[j]!.orig);
    const preds: { i: number; gap: number }[][] = units.map(() => []);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        if (i === j) continue;
        if (before(i, j)) {
          const gap = lo(units[j]!.orig, axis) - hi(units[i]!.orig, axis);
          let between = false;
          for (let k = 0; k < n && !between; k++)
            between = before(i, k) && before(k, j);
          preds[j]!.push({ i, gap: between ? Math.min(gap, MIN_GAP) : gap });
        } else if (
          !before(j, i) &&
          perpOverlap(cur[i]!, cur[j]!) &&
          hi(cur[i]!, axis) <= lo(cur[j]!, axis) + 0.5
        ) {
          const gap = lo(cur[j]!, axis) - hi(cur[i]!, axis);
          preds[j]!.push({ i, gap: Math.min(gap, MIN_GAP) });
        }
      }
    // Topological order over the constraints; a cycle means the old layout
    // was not separable on this axis, so fall back to the placement search.
    const indeg = preds.map((p) => p.length);
    const succ: number[][] = units.map(() => []);
    for (let j = 0; j < n; j++) for (const { i } of preds[j]!) succ[i]!.push(j);
    const queue: number[] = [];
    for (let j = 0; j < n; j++) if (indeg[j] === 0) queue.push(j);
    const newLo: number[] = cur.map((r) => lo(r, axis));
    let done = 0;
    while (queue.length > 0) {
      const j = queue.shift()!;
      done++;
      if (preds[j]!.length > 0) {
        let at = -Infinity;
        for (const { i, gap } of preds[j]!)
          at = Math.max(
            at,
            newLo[i]! + (hi(cur[i]!, axis) - lo(cur[i]!, axis)) + gap
          );
        newLo[j] = at;
      }
      for (const k of succ[j]!) if (--indeg[k]! === 0) queue.push(k);
    }
    if (done < n) return null;
    for (let j = 0; j < n; j++) {
      const delta = newLo[j]! - lo(cur[j]!, axis);
      if (delta === 0) continue;
      for (const k of units[j]!.keys) {
        const r = rects.get(k)!;
        rects.set(k, { ...r, [axis]: r[axis] + delta });
      }
    }
  }

  // ── Expanded-group container rects from frozen members ──
  const groupRect = new Map<string, Rect>();
  const buildGroupRect = (
    label: string,
    seen = new Set<string>()
  ): Rect | null => {
    if (groupRect.has(label)) return groupRect.get(label)!;
    if (seen.has(label)) return null;
    seen.add(label);
    const g = groupByLabel.get(label);
    if (!g) return null;
    const memberRects: Rect[] = [];
    for (const c of g.children) {
      if (groupByLabel.has(c)) {
        const sub = buildGroupRect(c, seen);
        if (sub) memberRects.push(sub);
      } else if (rects.has(c)) memberRects.push(rects.get(c)!);
      else if (rects.has(gid(c))) memberRects.push(rects.get(gid(c))!);
    }
    if (memberRects.length === 0) return null;
    const rect = padFrame(bboxOf(memberRects));
    groupRect.set(label, rect);
    return rect;
  };
  for (const g of parsed.groups) if (!buildGroupRect(g.label)) return null;

  // ── Overlap guard: frozen/slid boxes must not intersect ──
  const boxes = [...rects.values()];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (
        Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 4 &&
        Math.abs(a.y - b.y) < (a.height + b.height) / 2 - 4
      )
        return null;
    }

  // ── Straight border-to-border edges ──
  const endpointRect = (key: string): Rect | null => {
    const direct = rects.get(key);
    if (direct) return direct;
    if (key.startsWith('__group_')) {
      const label = key.slice('__group_'.length);
      return groupRect.get(label) ?? null;
    }
    return groupRect.get(key) ?? null;
  };
  const edges: BLLayoutEdge[] = [];
  for (const e of parsed.edges) {
    const sr = endpointRect(e.source);
    const tr = endpointRect(e.target);
    if (!sr || !tr) return null;
    edges.push({
      source: e.source,
      target: e.target,
      ...(e.label !== undefined && { label: e.label }),
      bidirectional: e.bidirectional,
      lineNumber: e.lineNumber,
      points: [borderPoint(sr, tr), borderPoint(tr, sr)],
      yOffset: 0,
      parallelCount: 1,
      metadata: e.metadata,
    });
  }

  // ── Normalize into positive canvas coordinates ──
  const allRects = [...rects.values(), ...groupRect.values()];
  const total = bboxOf(allRects);
  const dx = MARGIN - left(total);
  const dy = MARGIN - top(total);
  const shift = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });

  const nodes: BLLayoutNode[] = parsed.nodes.map((n) => {
    const r = shift(rects.get(n.label)!);
    return { label: n.label, x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const groups: BLLayoutGroup[] = parsed.groups.map((g) => {
    const r = shift(groupRect.get(g.label)!);
    return {
      label: g.label,
      lineNumber: g.lineNumber,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      collapsed: false,
      childCount: g.children.length,
    };
  });
  for (const label of collapsedGroupLabels) {
    const r = shift(rects.get(gid(label))!);
    groups.push({
      label,
      // The `[Group]` header line, so the folded pill's toggle points at the
      // line the `collapsed` marker belongs on (#1741).
      lineNumber:
        collapseInfo.originalGroups.find((og) => og.label === label)
          ?.lineNumber ?? 0,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      collapsed: true,
      childCount: collapseInfo.collapsedChildCounts.get(label) ?? 0,
    });
  }
  const shiftedEdges = edges.map((e) => ({
    ...e,
    points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  }));
  const shiftedTotal = shift(total);

  return {
    nodes,
    edges: shiftedEdges,
    groups,
    width: right(shiftedTotal) + MARGIN,
    height: bottom(shiftedTotal) + MARGIN,
  };
}
