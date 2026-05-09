// ============================================================
// PERT Layout — dagre wrapper
// ============================================================
//
// Pure functions; no UI state. The diagrammo-app holds expansion state
// in its own store and feeds an override map into `relayoutPert`.

import dagre from '@dagrejs/dagre';
import type {
  ResolvedPert,
  LayoutResult,
  PertLayoutNode,
  PertLayoutGroup,
  PertDirection,
} from './types';
import type { LayoutOverrides } from './internal';

// Textbook 3×3 PERT/CPM box: top row [ES | dur | EF], middle row
// [name spanning all three columns], bottom row [LS | slack | LF].
const DEFAULT_NODE_WIDTH = 210;
const DEFAULT_NODE_HEIGHT = 90;
// Collapsed groups use the same shape so the rolled-up envelope reads
// identically to a regular activity card.
const COLLAPSED_GROUP_WIDTH = 210;
const COLLAPSED_GROUP_HEIGHT = 90;
const DIAGRAM_PADDING = 20;
const GROUP_PADDING = 18;
// Top padding reserves space for the centered group label band — matches
// org's `CONTAINER_HEADER_HEIGHT`. See `docs/architecture/diagram-visual-
// conventions.md` §2 ("Reserved header band").
const GROUP_TOP_PADDING = 28;

function nodeDimensions(
  _resolved: ResolvedPert,
  id: string,
  overrides?: LayoutOverrides
): { width: number; height: number } {
  if (overrides && overrides[id]) {
    return { width: overrides[id].width, height: overrides[id].height };
  }
  // Milestones use the same dimensions as activities so they style
  // consistently with the rest of the network. The semantic
  // distinction (zero duration, sync point) shows in the body — no
  // μ row, just a centered name.
  return { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
}

export function layoutPert(resolved: ResolvedPert): LayoutResult {
  return relayoutPert(resolved, {});
}

export function relayoutPert(
  resolved: ResolvedPert,
  overrides: LayoutOverrides,
  collapsedGroupIds: ReadonlySet<string> = new Set()
): LayoutResult {
  if (resolved.activities.length === 0) {
    return { nodes: [], edges: [], groups: [], width: 0, height: 0 };
  }

  // Build member-activity → collapsed-group lookup so we can replace
  // member activities with a single virtual dagre node per group.
  const memberToGroup = new Map<string, string>();
  for (const rg of resolved.groups) {
    if (collapsedGroupIds.has(rg.group.id)) {
      for (const aid of rg.group.activityIds) {
        memberToGroup.set(aid, rg.group.id);
      }
    }
  }
  const dagreId = (id: string): string => memberToGroup.get(id) ?? id;

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: resolved.options.direction,
    nodesep: 50,
    ranksep: 60,
    edgesep: 18,
    marginx: DIAGRAM_PADDING,
    marginy: DIAGRAM_PADDING,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add real activity nodes (skipping members of collapsed groups).
  for (const r of resolved.activities) {
    if (memberToGroup.has(r.activity.id)) continue;
    const { width, height } = nodeDimensions(
      resolved,
      r.activity.id,
      overrides
    );
    g.setNode(r.activity.id, { width, height });
  }
  // Add one virtual node per collapsed group at a fixed compact size.
  for (const rg of resolved.groups) {
    if (collapsedGroupIds.has(rg.group.id)) {
      g.setNode(rg.group.id, {
        width: COLLAPSED_GROUP_WIDTH,
        height: COLLAPSED_GROUP_HEIGHT,
      });
    }
  }

  // Add edges; rewrite endpoints that land on collapsed members,
  // dedupe, and drop edges that fold to a self-loop (internal-only
  // edges of a collapsed group).
  const seenEdges = new Set<string>();
  for (const e of resolved.edges) {
    const src = dagreId(e.source);
    const tgt = dagreId(e.target);
    if (src === tgt) continue;
    const k = `${src}|${tgt}`;
    if (seenEdges.has(k)) continue;
    seenEdges.add(k);
    g.setEdge(src, tgt, {});
  }

  dagre.layout(g);

  // Pull critical-path activities toward the vertical center of each
  // rank. Dagre orders nodes within a rank to minimize edge crossings,
  // which is criticality-blind — so the dominant path drifts wherever
  // dagre chose. After layout, swap y-positions per rank so the
  // highest-criticality node sits in the middle and lower-criticality
  // ones fan out to the edges.
  centerByCriticality(g, resolved, memberToGroup, collapsedGroupIds);

  // Output nodes — only un-collapsed activities (virtual group nodes
  // are rendered through the `groups` channel, not here).
  const nodes: PertLayoutNode[] = resolved.activities
    .filter((r) => !memberToGroup.has(r.activity.id))
    .map((r) => {
      const pos = g.node(r.activity.id);
      return {
        id: r.activity.id,
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: pos.height,
      };
    });

  // Output edges — one per dedup'd dagre edge. Endpoints already point
  // at virtual group ids when a side is collapsed, which the renderer
  // uses verbatim for `data-source` / `data-target`.
  const edges = Array.from(seenEdges).map((k) => {
    const [source, target] = k.split('|');
    const data = g.edge(source, target);
    return { source, target, points: data?.points ?? [] };
  });

  // Pool of every laid-out rect (real activities + virtual group nodes)
  // for both diagram-bounds and group-rect math.
  const nodeMap = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  for (const n of nodes) nodeMap.set(n.id, n);
  for (const rg of resolved.groups) {
    if (collapsedGroupIds.has(rg.group.id)) {
      const vn = g.node(rg.group.id);
      nodeMap.set(rg.group.id, {
        x: vn.x,
        y: vn.y,
        width: vn.width,
        height: vn.height,
      });
    }
  }

  const groups: PertLayoutGroup[] = resolved.groups.map((rg) => {
    const classification = rg.group.classification ?? 'cluster';
    if (collapsedGroupIds.has(rg.group.id)) {
      const vn = nodeMap.get(rg.group.id);
      if (!vn) {
        return {
          id: rg.group.id,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          classification,
          collapsed: true,
        };
      }
      return {
        id: rg.group.id,
        x: vn.x - vn.width / 2,
        y: vn.y - vn.height / 2,
        width: vn.width,
        height: vn.height,
        classification,
        collapsed: true,
      };
    }

    const members = rg.group.activityIds
      .map((id) => nodeMap.get(id))
      .filter(
        (n): n is { x: number; y: number; width: number; height: number } =>
          n !== undefined
      );

    if (members.length === 0) {
      return {
        id: rg.group.id,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        classification,
      };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of members) {
      const left = m.x - m.width / 2;
      const right = m.x + m.width / 2;
      const top = m.y - m.height / 2;
      const bottom = m.y + m.height / 2;
      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      if (top < minY) minY = top;
      if (bottom > maxY) maxY = bottom;
    }
    return {
      id: rg.group.id,
      x: minX - GROUP_PADDING,
      y: minY - GROUP_TOP_PADDING,
      width: maxX - minX + GROUP_PADDING * 2,
      height: maxY - minY + GROUP_TOP_PADDING + GROUP_PADDING,
      classification,
    };
  });

  // Diagram bounds — include both nodes and group rects (collapsed
  // groups contribute their virtual-node bounds via `groups`).
  let totalW = 0;
  let totalH = 0;
  for (const n of nodes) {
    const right = n.x + n.width / 2;
    const bottom = n.y + n.height / 2;
    if (right > totalW) totalW = right;
    if (bottom > totalH) totalH = bottom;
  }
  for (const grp of groups) {
    if (grp.x + grp.width > totalW) totalW = grp.x + grp.width;
    if (grp.y + grp.height > totalH) totalH = grp.y + grp.height;
  }

  return {
    nodes,
    edges,
    groups,
    width: totalW + DIAGRAM_PADDING,
    height: totalH + DIAGRAM_PADDING,
  };
}

// ============================================================
// Criticality-aware vertical centering (post-process pass)
// ============================================================
//
// For each dagre rank (column in LR / row in TB), reorder nodes so the
// highest-criticality node occupies the middle slot and lower ones
// fan out symmetrically. Edges are kept in shape but their first/last
// y-coordinates shift to match the new endpoints, with a linear
// interpolation across the polyline so the curve still terminates on
// the new node centers.

// `@dagrejs/dagre` ships no type definitions, so `g` is typed as `any`
// here — every prop access (`nodes()`, `node(id)`, `edges()`, etc.) is
// untyped within this function.

function centerByCriticality(
  g: any,
  resolved: ResolvedPert,
  memberToGroup: Map<string, string>,
  collapsedGroupIds: ReadonlySet<string>
): void {
  // Look up criticality per laid-out node. For activities we use the
  // MC criticality index when present, falling back to binary critical-
  // path membership in analytical mode. Collapsed groups inherit the
  // max-of-members so they sort with their internal hottest path.
  const critById = new Map<string, number>();
  for (const r of resolved.activities) {
    if (memberToGroup.has(r.activity.id)) continue;
    const c = r.criticality !== null ? r.criticality : r.isCriticalPath ? 1 : 0;
    critById.set(r.activity.id, c);
  }
  for (const rg of resolved.groups) {
    if (!collapsedGroupIds.has(rg.group.id)) continue;
    let maxC = 0;
    for (const aid of rg.group.activityIds) {
      const r = resolved.activities.find((x) => x.activity.id === aid);
      if (!r) continue;
      const c =
        r.criticality !== null ? r.criticality : r.isCriticalPath ? 1 : 0;
      if (c > maxC) maxC = c;
    }
    critById.set(rg.group.id, maxC);
  }

  // Bucket nodes by rank. dagre gives every node in a rank an identical
  // x (LR) or y (TB) coordinate, so a single rounded key per axis is
  // sufficient.
  const rankAxis = resolved.options.direction === 'TB' ? 'y' : 'x';
  const slotAxis = resolved.options.direction === 'TB' ? 'x' : 'y';

  const buckets = new Map<number, string[]>();
  for (const id of g.nodes()) {
    const node = g.node(id);
    if (!node) continue;
    const key = Math.round(node[rankAxis] as number);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(id);
  }

  // For each rank with > 1 member, recompute slot assignments.
  // `shifts` records the delta between the old slot value (along
  // `slotAxis`) and the new one, so edges can be translated to match.
  const shifts = new Map<string, number>();

  for (const ids of buckets.values()) {
    if (ids.length < 2) continue;

    // Existing slot positions (sorted ascending = top→bottom in LR).
    const slots = ids
      .map((id) => g.node(id)![slotAxis] as number)
      .sort((a, b) => a - b);

    // Sort ids by criticality descending; tie-break by current slot
    // so deterministic & stable when criticalities are equal.
    const currentSlot = new Map<string, number>();
    for (const id of ids) currentSlot.set(id, g.node(id)![slotAxis] as number);
    const sortedDesc = [...ids].sort((a, b) => {
      const ca = critById.get(a) ?? 0;
      const cb = critById.get(b) ?? 0;
      if (cb !== ca) return cb - ca;
      return (currentSlot.get(a) ?? 0) - (currentSlot.get(b) ?? 0);
    });

    // Middle-out arrangement: highest goes to the middle, then alternate
    // above/below for the next-ranked, so the lowest-criticality ends
    // up at the outermost edges.
    const top: string[] = [];
    const bottom: string[] = [];
    let middle: string | null = null;
    sortedDesc.forEach((id, i) => {
      if (i === 0) middle = id;
      else if (i % 2 === 1) top.unshift(id);
      else bottom.push(id);
    });
    const newOrder: string[] = middle
      ? [...top, middle, ...bottom]
      : [...top, ...bottom];

    newOrder.forEach((id, i) => {
      const node = g.node(id);
      const oldVal = node[slotAxis] as number;
      const newVal = slots[i];
      shifts.set(id, newVal - oldVal);
      (node as Record<string, unknown>)[slotAxis] = newVal;
    });
  }

  // Re-route every edge whose endpoints moved. Dagre routes edges
  // through gaps between same-rank nodes; once we permute nodes within
  // a rank those gaps no longer exist where the polyline expected, and
  // a linear-shift hack would push control points through other nodes.
  // Replace the polyline with a clean 4-control-point smooth curve
  // (entry/exit are pulled along the flow axis so `curveBasis` gives a
  // gentle horizontal-leaning S, matching dagre's typical edge shape).
  if (shifts.size > 0) {
    const dir = resolved.options.direction;
    for (const e of g.edges()) {
      // Only regenerate edges where at least one endpoint moved, OR
      // an edge between two ranks where any node moved (so that
      // unaffected edges keep dagre's nicer multi-rank routing).
      if (!shifts.has(e.v) && !shifts.has(e.w)) continue;
      const src = g.node(e.v);
      const tgt = g.node(e.w);
      if (!src || !tgt) continue;
      const data = g.edge(e);
      if (!data) continue;
      data.points = smoothEdge(src, tgt, dir);
    }
  }
}

/**
 * Build a 4-control-point polyline that exits the source rectangle
 * along the flow axis, enters the target rectangle the same way, and
 * smooths under `curveBasis` into a gentle S-curve. Falls back to a
 * straight line when source and target are colinear along the flow.
 */
function smoothEdge(
  src: { x: number; y: number; width: number; height: number },
  tgt: { x: number; y: number; width: number; height: number },
  direction: PertDirection
): { x: number; y: number }[] {
  if (direction === 'TB') {
    const sy = src.y + src.height / 2;
    const ty = tgt.y - tgt.height / 2;
    const span = ty - sy;
    const pad = Math.max(20, Math.abs(span) * 0.3);
    return [
      { x: src.x, y: sy },
      { x: src.x, y: sy + Math.sign(span || 1) * pad },
      { x: tgt.x, y: ty - Math.sign(span || 1) * pad },
      { x: tgt.x, y: ty },
    ];
  }
  // LR
  const sx = src.x + src.width / 2;
  const tx = tgt.x - tgt.width / 2;
  const span = tx - sx;
  const pad = Math.max(20, Math.abs(span) * 0.3);
  return [
    { x: sx, y: src.y },
    { x: sx + Math.sign(span || 1) * pad, y: src.y },
    { x: tx - Math.sign(span || 1) * pad, y: tgt.y },
    { x: tx, y: tgt.y },
  ];
}
