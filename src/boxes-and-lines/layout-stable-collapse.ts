// ============================================================
// Boxes and Lines — stable collapse layout (anchor + gap-close)
// ============================================================
//
// When a group collapses interactively, a full placement search moves every
// node (previous positions are only a soft stability term), so the diagram
// "teleports". This path instead:
//
//   1. Freezes every surviving node at its previous position.
//   2. Places the collapsed pill at the centre of its members' previous
//      bounding box (or at its own previous position when it was already
//      collapsed).
//   3. Runs a gap-close pass per newly collapsed group: rigid units (top-level
//      groups move as one) that sit entirely beyond the vacated span slide
//      back along each axis to reclaim it, clamped so nothing collides.
//   4. Rebuilds expanded-group container rects from their (frozen) members and
//      routes edges as straight border-to-border segments.
//
// Strictly opt-in (`stableCollapse`) and best-effort: any gap in coverage
// (unknown node, missing member positions, resulting overlap) returns null and
// the caller falls back to the normal placement search.

import type { ParsedBoxesAndLines, BLGroup } from './types';
import {
  NODE_WIDTH,
  NODE_HEIGHT,
  type BLLayoutResult,
  type BLLayoutEdge,
  type BLLayoutGroup,
  type BLLayoutNode,
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
  // centre of its members' previous bounding box (members approximated at node
  // size — their true sizes left the size map with the collapse transform).
  const newlyCollapsed: { label: string; memberBbox: Rect }[] = [];
  for (const label of collapsedGroupLabels) {
    const own = prev.get(gid(label));
    if (own) {
      rects.set(gid(label), {
        x: own.x,
        y: own.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
      continue;
    }
    const members = descendantNodes(label);
    if (members.length === 0) return null;
    const memberRects: Rect[] = [];
    for (const m of members) {
      const p = prev.get(m);
      if (!p) return null;
      memberRects.push({
        x: p.x,
        y: p.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    }
    const bbox = bboxOf(memberRects);
    rects.set(gid(label), {
      x: bbox.x,
      y: bbox.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
    newlyCollapsed.push({ label, memberBbox: bbox });
  }

  // ── Rigid units for the gap-close pass ──
  // A top-level expanded group slides as one unit (member nodes + pills of
  // collapsed sub-groups); ungrouped nodes and top-level pills slide alone.
  const groupByLabel = new Map(parsed.groups.map((g) => [g.label, g]));
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
  const units: string[][] = [];
  for (const g of parsed.groups) {
    if (g.parentGroup) continue;
    const keys = unitKeys(g.label);
    if (keys.length === 0) continue;
    for (const k of keys) inUnit.add(k);
    units.push(keys);
  }
  for (const key of rects.keys()) if (!inUnit.has(key)) units.push([key]);

  // ── Gap-close: slide far-side units back toward each vacated span ──
  const axes: ('x' | 'y')[] = ['x', 'y'];
  for (const { label, memberBbox } of newlyCollapsed) {
    const pill = rects.get(gid(label))!;
    for (const axis of axes) {
      const size = axis === 'x' ? 'width' : 'height';
      const perpMin = axis === 'x' ? top : left;
      const perpMax = axis === 'x' ? bottom : right;
      const axMin = axis === 'x' ? left : top;
      const axMax = axis === 'x' ? right : bottom;
      const reclaim = memberBbox[size] - pill[size];
      if (reclaim <= 0) continue;

      const unitBbox = (keys: string[]): Rect =>
        bboxOf(keys.map((k) => rects.get(k)!));
      const sliding: string[][] = [];
      const staticRects: Rect[] = [];
      for (const u of units) {
        const b = unitBbox(u);
        // A unit slides only when it sits entirely beyond the vacated centre.
        if (axMin(b) >= pill[axis] && !u.includes(gid(label))) sliding.push(u);
        else staticRects.push(...u.map((k) => rects.get(k)!));
      }
      if (sliding.length === 0) continue;

      // Clamp the slide so no sliding unit lands within MIN_GAP of static
      // content it overlaps on the perpendicular axis.
      let delta = reclaim;
      for (const u of sliding) {
        const b = unitBbox(u);
        for (const s of staticRects) {
          const overlaps =
            perpMin(b) < perpMax(s) - 4 && perpMax(b) > perpMin(s) + 4;
          if (!overlaps || axMax(s) > axMin(b)) continue;
          delta = Math.min(delta, axMin(b) - axMax(s) - MIN_GAP);
        }
      }
      if (delta <= 0) continue;
      for (const u of sliding)
        for (const k of u) {
          const r = rects.get(k)!;
          rects.set(k, { ...r, [axis]: r[axis] - delta });
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
    const b = bboxOf(memberRects);
    const rect: Rect = {
      x: b.x,
      y: b.y - GROUP_LABEL_ZONE / 2,
      width: b.width + 2 * GROUP_PAD,
      height: b.height + 2 * GROUP_PAD + GROUP_LABEL_ZONE,
    };
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
      lineNumber: 0,
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
