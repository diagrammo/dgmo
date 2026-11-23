// Boxes and Lines — per-group direction as a compound sub-layout (#2001).
//
// A group carrying its own `direction-tb` / `direction-lr` is laid out on its
// own, on that axis, and the result is placed inside the outer layout as one
// fixed-size placeholder box. The outer layout never sees the group's members:
// every line to or from one of them is drawn to the placeholder, and the merge
// redraws its last stretch to the member it really meets.
//
// Pure: `splitSubLayout` builds the two diagrams, `mergeSubLayout` puts the
// two layouts back together. layout.ts runs the layouts between them.

import type { BLLayoutEdge, BLLayoutNode, BLLayoutResult } from './layout';
import type { BLEdge, BLGroup, ParsedBoxesAndLines } from './types';

type Pt = { x: number; y: number };

/** A copy of `o` without `keys` — optional fields this module rebuilds. */
function without<T extends object, K extends keyof T>(
  o: T,
  keys: readonly K[]
): Omit<T, K> {
  const out = { ...o };
  for (const k of keys) Reflect.deleteProperty(out, k);
  return out;
}
type CollapseInfo = {
  collapsedChildCounts: Map<string, number>;
  originalGroups: readonly BLGroup[];
};

/**
 * The groups to lay out on their own: an expanded group whose `direction`
 * differs from the axis around it, outermost first. A directed group inside
 * one of them is the inner layout's to find, so it is not listed here.
 */
export function subLayoutGroups(parsed: ParsedBoxesAndLines): BLGroup[] {
  const byLabel = new Map(parsed.groups.map((g) => [g.label, g]));
  const axisAround = (g: BLGroup): 'LR' | 'TB' => {
    let cur = g.parentGroup ? byLabel.get(g.parentGroup) : undefined;
    while (cur) {
      if (cur.direction) return cur.direction;
      cur = cur.parentGroup ? byLabel.get(cur.parentGroup) : undefined;
    }
    return parsed.direction;
  };
  const picked = parsed.groups.filter(
    (g) => g.direction !== undefined && g.direction !== axisAround(g)
  );
  const pickedSet = new Set(picked.map((g) => g.label));
  const insidePicked = (g: BLGroup): boolean => {
    let cur = g.parentGroup ? byLabel.get(g.parentGroup) : undefined;
    while (cur) {
      if (pickedSet.has(cur.label)) return true;
      cur = cur.parentGroup ? byLabel.get(cur.parentGroup) : undefined;
    }
    return false;
  };
  return picked.filter((g) => !insidePicked(g));
}

/** What the merge needs to know about one line the split redirected. */
interface Redirect {
  readonly lineNumber: number;
  readonly source: string; // as the outer layout knows it
  readonly target: string;
  readonly origSource: string;
  readonly origTarget: string;
}

export interface SubLayoutSplit {
  readonly group: BLGroup;
  /** The label of the box standing in for the group in the outer layout. */
  readonly placeholder: string;
  readonly inner: ParsedBoxesAndLines;
  readonly innerCollapse?: CollapseInfo;
  readonly outer: ParsedBoxesAndLines;
  readonly outerCollapse?: CollapseInfo;
  readonly redirects: readonly Redirect[];
}

/** Split `parsed` into the group's own diagram and the diagram around it. */
export function splitSubLayout(
  parsed: ParsedBoxesAndLines,
  group: BLGroup,
  collapseInfo?: CollapseInfo
): SubLayoutSplit {
  const byLabel = new Map(parsed.groups.map((g) => [g.label, g]));
  // Everything inside the group: nodes, expanded sub-groups, and folded
  // sub-groups (which the layout draws as `__group_<label>` pills).
  const memberNodes = new Set<string>();
  const memberGroups = new Set<string>();
  const walk = (g: BLGroup) => {
    for (const c of g.children) {
      const sub = byLabel.get(c);
      if (sub) {
        memberGroups.add(sub.label);
        walk(sub);
      } else memberNodes.add(c);
    }
  };
  walk(group);
  const isDescendant = (g: BLGroup, all: readonly BLGroup[]): boolean => {
    let parent = g.parentGroup;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      if (parent === group.label) return true;
      seen.add(parent);
      parent = all.find((o) => o.label === parent)?.parentGroup;
    }
    return false;
  };
  const folded = new Set(
    (collapseInfo?.originalGroups ?? [])
      .filter(
        (og) =>
          !byLabel.has(og.label) &&
          isDescendant(og, collapseInfo!.originalGroups)
      )
      .map((og) => og.label)
  );
  const placeholder = `__sub_${group.label}`;
  const inside = (endpoint: string): boolean =>
    memberNodes.has(endpoint) ||
    (endpoint.startsWith('__group_') &&
      (memberGroups.has(endpoint.slice(8)) || folded.has(endpoint.slice(8))));
  const mapEnd = (endpoint: string) =>
    inside(endpoint) ? placeholder : endpoint;

  // ── The group's own diagram ──
  const innerEdges: BLEdge[] = [];
  const outerEdges: BLEdge[] = [];
  const redirects: Redirect[] = [];
  for (const e of parsed.edges) {
    const s = inside(e.source);
    const t = inside(e.target);
    if (s && t) innerEdges.push(e);
    else if (s || t) {
      const source = mapEnd(e.source);
      const target = mapEnd(e.target);
      outerEdges.push({ ...e, source, target });
      redirects.push({
        lineNumber: e.lineNumber,
        source,
        target,
        origSource: e.source,
        origTarget: e.target,
      });
    } else outerEdges.push(e);
  }
  const innerGroups = parsed.groups
    .filter((g) => memberGroups.has(g.label))
    .map((g) => {
      if (g.parentGroup !== group.label) return g;
      return without(g, ['parentGroup']);
    });
  const keepSets = (
    sets: readonly (readonly string[])[] | undefined,
    pick: (label: string) => string | null
  ): (readonly string[])[] | undefined => {
    if (!sets) return undefined;
    const out = sets
      .map((set) => [
        ...new Set(set.map(pick).filter((l): l is string => l !== null)),
      ])
      .filter((set) => set.length > 1);
    return out.length > 0 ? out : undefined;
  };
  const innerSameRank = keepSets(parsed.sameRank, (l) =>
    memberNodes.has(l) ? l : null
  );
  const innerOrder = keepSets(parsed.rankOrder, (l) =>
    memberNodes.has(l) ? l : null
  );
  const innerInvisible = parsed.invisibleEdges?.filter(
    (e) => inside(e.source) && inside(e.target)
  );
  const base = without(parsed, [
    'notes',
    'sameRank',
    'rankOrder',
    'invisibleEdges',
  ]);
  const inner: ParsedBoxesAndLines = {
    ...base,
    title: null,
    titleLineNumber: null,
    // Regex-validated `LR | TB` on a group the caller picked for its direction.
    direction: group.direction!,
    nodes: parsed.nodes.filter((n) => memberNodes.has(n.label)),
    edges: innerEdges,
    groups: innerGroups,
    ...(innerSameRank && { sameRank: innerSameRank }),
    ...(innerOrder && { rankOrder: innerOrder }),
    ...(innerInvisible &&
      innerInvisible.length > 0 && { invisibleEdges: innerInvisible }),
  };

  // ── The diagram around it ──
  const outerSameRank = keepSets(parsed.sameRank, (l) =>
    memberNodes.has(l) ? placeholder : l
  );
  const outerOrder = keepSets(parsed.rankOrder, (l) =>
    memberNodes.has(l) ? null : l
  );
  const outerInvisible = parsed.invisibleEdges
    ?.filter((e) => !(inside(e.source) && inside(e.target)))
    .map((e) => ({ source: mapEnd(e.source), target: mapEnd(e.target) }));
  const outer: ParsedBoxesAndLines = {
    ...base,
    nodes: [
      ...parsed.nodes.filter((n) => !memberNodes.has(n.label)),
      { label: placeholder, lineNumber: group.lineNumber, metadata: {} },
    ],
    edges: outerEdges,
    groups: parsed.groups
      .filter((g) => !memberGroups.has(g.label))
      .map((g) =>
        g.label === group.label ? { ...g, children: [placeholder] } : g
      ),
    ...(outerSameRank && { sameRank: outerSameRank }),
    ...(outerOrder && { rankOrder: outerOrder }),
    ...(outerInvisible &&
      outerInvisible.length > 0 && { invisibleEdges: outerInvisible }),
  };

  const split = (keep: (og: BLGroup) => boolean): CollapseInfo | undefined =>
    collapseInfo && {
      collapsedChildCounts: collapseInfo.collapsedChildCounts,
      originalGroups: collapseInfo.originalGroups.filter(keep),
    };
  const descendantOf = (og: BLGroup) =>
    isDescendant(og, collapseInfo?.originalGroups ?? []);
  const innerCollapse = split(descendantOf);
  const outerCollapse = split((og) => !descendantOf(og));
  return {
    group,
    placeholder,
    inner,
    outer,
    redirects,
    ...(innerCollapse && { innerCollapse }),
    ...(outerCollapse && { outerCollapse }),
  };
}

/** The box everything the layout drew fits in. */
export function contentBounds(layout: BLLayoutResult): {
  minX: number;
  minY: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  for (const r of [...layout.nodes, ...layout.groups])
    take(
      r.x - r.width / 2,
      r.y - r.height / 2,
      r.x + r.width / 2,
      r.y + r.height / 2
    );
  for (const e of layout.edges) {
    for (const p of e.points) take(p.x, p.y, p.x, p.y);
    if (
      e.labelX !== undefined &&
      e.labelY !== undefined &&
      e.labelWidth !== undefined &&
      e.labelHeight !== undefined
    )
      take(
        e.labelX - e.labelWidth / 2,
        e.labelY - e.labelHeight / 2,
        e.labelX + e.labelWidth / 2,
        e.labelY + e.labelHeight / 2
      );
  }
  if (minX === Infinity) return { minX: 0, minY: 0, width: 0, height: 0 };
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Redraw the end of a line that met the placeholder so it meets `to` instead.
 * The line keeps its route up to the last point outside the group's frame,
 * turns in the corridor between that point and the frame, runs along it to
 * `to`'s row (or column), and goes straight in to `to`'s facing side. `pts`
 * runs toward the end being redrawn.
 */
function reroute(pts: readonly Pt[], box: Rect, frame: Rect, to: Rect): Pt[] {
  const last = pts[pts.length - 1];
  if (!last) return [...pts];
  const sides = [
    Math.abs(last.x - (box.x - box.width / 2)),
    Math.abs(last.x - (box.x + box.width / 2)),
    Math.abs(last.y - (box.y - box.height / 2)),
    Math.abs(last.y - (box.y + box.height / 2)),
  ];
  const side = sides.indexOf(Math.min(...sides));
  const fl = frame.x - frame.width / 2;
  const fr = frame.x + frame.width / 2;
  const ft = frame.y - frame.height / 2;
  const fb = frame.y + frame.height / 2;
  const outside = (p: Pt) =>
    p.x < fl - 0.5 || p.x > fr + 0.5 || p.y < ft - 0.5 || p.y > fb + 0.5;
  let k = pts.length - 1;
  while (k >= 0 && !outside(pts[k]!)) k--;
  const out: Pt[] = k >= 0 ? pts.slice(0, k + 1) : [pts[0]!];
  const from = out[out.length - 1]!;
  if (side < 2) {
    const wall = side === 0 ? fl : fr;
    const cx = k >= 0 ? (from.x + wall) / 2 : from.x;
    out.push({ x: cx, y: from.y }, { x: cx, y: to.y });
    out.push({
      x: side === 0 ? to.x - to.width / 2 : to.x + to.width / 2,
      y: to.y,
    });
  } else {
    const wall = side === 2 ? ft : fb;
    const cy = k >= 0 ? (from.y + wall) / 2 : from.y;
    out.push({ x: from.x, y: cy }, { x: to.x, y: cy });
    out.push({
      x: to.x,
      y: side === 2 ? to.y - to.height / 2 : to.y + to.height / 2,
    });
  }
  // Drop repeats, where the turn falls on a point the route already has.
  return out.filter(
    (p, i) =>
      i === 0 ||
      Math.abs(p.x - out[i - 1]!.x) > 0.5 ||
      Math.abs(p.y - out[i - 1]!.y) > 0.5
  );
}

/** Put the group's own layout into the outer one, at its placeholder. */
export function mergeSubLayout(
  outerLayout: BLLayoutResult,
  innerLayout: BLLayoutResult,
  split: SubLayoutSplit
): BLLayoutResult {
  const box = outerLayout.nodes.find((n) => n.label === split.placeholder);
  if (!box) return outerLayout;
  const b = contentBounds(innerLayout);
  const dx = box.x - box.width / 2 - b.minX;
  const dy = box.y - box.height / 2 - b.minY;
  const move = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  const innerNodes: BLLayoutNode[] = innerLayout.nodes.map((n) => ({
    ...n,
    x: n.x + dx,
    y: n.y + dy,
  }));
  const innerGroups = innerLayout.groups.map((g) => ({
    ...g,
    x: g.x + dx,
    y: g.y + dy,
  }));
  const innerEdges: BLLayoutEdge[] = innerLayout.edges.map((e) => ({
    ...e,
    points: e.points.map(move),
    ...(e.labelX !== undefined && { labelX: e.labelX + dx }),
    ...(e.labelY !== undefined && { labelY: e.labelY + dy }),
  }));
  const rectOf = (endpoint: string): Rect | undefined =>
    innerNodes.find((n) => n.label === endpoint) ??
    (endpoint.startsWith('__group_')
      ? innerGroups.find((g) => g.label === endpoint.slice(8))
      : undefined);

  const frame: Rect =
    outerLayout.groups.find((g) => g.label === split.group.label) ?? box;
  const unused = [...split.redirects];
  const outerEdges = outerLayout.edges.map((e) => {
    if (e.source !== split.placeholder && e.target !== split.placeholder)
      return e;
    const at = unused.findIndex(
      (r) =>
        r.lineNumber === e.lineNumber &&
        r.source === e.source &&
        r.target === e.target
    );
    if (at < 0) return e;
    const r = unused.splice(at, 1)[0]!;
    let points = [...e.points];
    if (e.target === split.placeholder) {
      const to = rectOf(r.origTarget);
      if (to) points = reroute(points, box, frame, to);
    }
    if (e.source === split.placeholder) {
      const from = rectOf(r.origSource);
      if (from)
        points = reroute([...points].reverse(), box, frame, from).reverse();
    }
    return { ...e, source: r.origSource, target: r.origTarget, points };
  });

  const childCount = split.group.children.length;
  return {
    ...outerLayout,
    nodes: [
      ...outerLayout.nodes.filter((n) => n.label !== split.placeholder),
      ...innerNodes,
    ],
    groups: [
      ...outerLayout.groups.map((g) =>
        g.label === split.group.label ? { ...g, childCount } : g
      ),
      ...innerGroups,
    ],
    edges: [...outerEdges, ...innerEdges],
  };
}
