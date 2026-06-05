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
import {
  formatDuration,
  formatScheduleValue,
  formatSprintCell,
  formatSlackValue,
} from './internal';
import { measureText } from '../utils/text-measure';

// Textbook 3×3 PERT/CPM box: top row [ES | dur | EF], middle row
// [name spanning all three columns], bottom row [LS | slack | LF].
// Heights are fixed; widths are computed from cell content via
// `computeNodeSizing` so a non-date diagram (where ES/EF are short
// duration labels) renders narrower than a date-anchored diagram
// (where those cells hold a 10-char `YYYY-MM-DD`).
const DEFAULT_NODE_HEIGHT = 90;
const MILESTONE_NODE_HEIGHT = DEFAULT_NODE_HEIGHT;
const COLLAPSED_GROUP_HEIGHT = 90;
const DIAGRAM_PADDING = 20;
const GROUP_PADDING = 18;
// Top padding reserves space for the centered group label band — matches
// org's `CONTAINER_HEADER_HEIGHT`. See `docs/architecture/diagram-visual-
// conventions.md` §2 ("Reserved header band").
const GROUP_TOP_PADDING = 28;

// Swim-lane layout constants. When a diagram has groups, members are
// placed in horizontal (LR) or vertical (TB) bands so group rectangles
// never overlap, even when cross-group edges scatter members across ranks.
const SWIMLANE_SLOT_SEP = 40;
const SWIMLANE_GAP = 24;

// Cell-sizing constants — see `computeNodeSizing` below.
const NODE_CELL_FONT_SIZE = 11;
const NODE_NAME_FONT_SIZE = 13;
// Milestone name renders at 12pt with a leading `◆ ` glyph (see renderer).
const MILESTONE_NAME_FONT_SIZE = 12;
const CELL_PAD_X = 8;
const NAME_PAD_X = 6;
// Anchor icon + gap (renderer reserves space to the left of the name
// when the activity is the forward source / backward sink).
const NAME_PIN_WIDTH = 13 + 4;
const MIN_CELL_WIDTH = 30;
const MIN_NODE_WIDTH = 120;
const MAX_NODE_WIDTH = 280;
const MIN_MILESTONE_WIDTH = 80;
const MAX_MILESTONE_WIDTH = 160;

/**
 * Per-diagram node geometry. All non-milestone activity nodes (and any
 * collapsed-group cards) share `activityWidth` so the lane reads as a
 * uniform grid; `outerColW`/`midColW` distribute that width so the
 * outer cells (ES/EF/LS/LF) fit their longest displayed value and the
 * middle cells (dur/slack) fit theirs. Milestones get their own width.
 */
export interface NodeSizing {
  activityWidth: number;
  milestoneWidth: number;
  outerColW: number;
  midColW: number;
}

/**
 * Walk every resolved activity, format each cell with the same fn the
 * renderer uses, and return the column/node widths needed to hold the
 * longest cell text (plus the longest name, capped at MAX_NODE_WIDTH —
 * names beyond that truncate with ellipsis at draw time). Sprint /
 * date / duration modes each have a characteristic cell-width profile,
 * so the diagram tightens automatically when ES/EF only hold "5w" vs.
 * "2026-05-15".
 */
export function computeNodeSizing(resolved: ResolvedPert): NodeSizing {
  const unit = resolved.options.timeUnit;
  const sprintMode = resolved.options.sprintMode;
  const sprintNumber = resolved.options.sprintNumber ?? 1;
  const projectStart = resolved.projectStart;

  const fmtSchedule = (v: number | null, isTbd: boolean): string =>
    sprintMode
      ? formatSprintCell(v, sprintNumber, isTbd ? '?' : null)
      : formatScheduleValue(v, projectStart, unit, isTbd ? '?' : null);
  const fmtSlack = (v: number | null, isTbd: boolean): string =>
    formatSlackValue(v, projectStart, unit, isTbd ? '?' : null);
  const fmtDur = (v: number | null, isTbd: boolean): string =>
    formatDuration(v, unit, isTbd ? '?' : null);

  // Track the widest rendered pixel width per cell category — measured at
  // the exact font sizes the renderer draws with so reserved width
  // matches drawn text.
  let maxOuterW = 0;
  let maxMidW = 0;
  let maxNameW = 0;
  let maxMilestoneTopW = 0;
  let maxMilestoneSlackW = 0;
  let maxMilestoneNameW = 0;

  for (const r of resolved.activities) {
    const isTbd = r.es === null;
    if (r.activity.isMilestone) {
      const dateStr = fmtSchedule(r.es, isTbd);
      const slackStr = fmtSlack(r.slack, isTbd);
      const slackHidden = !isTbd && /^0[a-z]?$/.test(slackStr);
      maxMilestoneTopW = Math.max(
        maxMilestoneTopW,
        measureText(dateStr, NODE_CELL_FONT_SIZE)
      );
      if (!slackHidden) {
        maxMilestoneSlackW = Math.max(
          maxMilestoneSlackW,
          measureText(slackStr, NODE_CELL_FONT_SIZE)
        );
      }
      // The milestone glyph prefix `◆ ` precedes the name.
      maxMilestoneNameW = Math.max(
        maxMilestoneNameW,
        measureText(`◆ ${r.activity.name}`, MILESTONE_NAME_FONT_SIZE)
      );
      continue;
    }
    const esStr = fmtSchedule(r.es, isTbd);
    const efStr = fmtSchedule(r.ef, isTbd);
    const lsStr = fmtSchedule(r.ls, isTbd);
    const lfStr = fmtSchedule(r.lf, isTbd);
    const durStr = fmtDur(r.mu, isTbd);
    const slackStr = fmtSlack(r.slack, isTbd);
    maxOuterW = Math.max(
      maxOuterW,
      measureText(esStr, NODE_CELL_FONT_SIZE),
      measureText(efStr, NODE_CELL_FONT_SIZE),
      measureText(lsStr, NODE_CELL_FONT_SIZE),
      measureText(lfStr, NODE_CELL_FONT_SIZE)
    );
    maxMidW = Math.max(
      maxMidW,
      measureText(durStr, NODE_CELL_FONT_SIZE),
      measureText(slackStr, NODE_CELL_FONT_SIZE)
    );
    maxNameW = Math.max(
      maxNameW,
      measureText(r.activity.name, NODE_NAME_FONT_SIZE)
    );
  }

  // Also account for any collapsed-group rolled-up label width — the
  // renderer draws those with the same textbook-card chrome, so their
  // name needs to fit in the shared `activityWidth`.
  for (const rg of resolved.groups) {
    maxNameW = Math.max(
      maxNameW,
      measureText(rg.group.name, NODE_NAME_FONT_SIZE)
    );
  }

  const outerCell = Math.ceil(maxOuterW) + 2 * CELL_PAD_X;
  const midCell = Math.ceil(maxMidW) + 2 * CELL_PAD_X;
  const outerNeeded = Math.max(MIN_CELL_WIDTH, outerCell);
  const midNeeded = Math.max(MIN_CELL_WIDTH, midCell);
  const cellsTotalW = 2 * outerNeeded + midNeeded;

  // The name dictates a lower bound too — anchor-pinned cards reserve
  // a NAME_PIN_WIDTH on the left, so size for the worst case.
  const nameTextW = Math.ceil(maxNameW);
  const nameTotalW = nameTextW + NAME_PIN_WIDTH + 2 * NAME_PAD_X;

  const activityWidth = Math.max(
    MIN_NODE_WIDTH,
    Math.min(MAX_NODE_WIDTH, Math.max(cellsTotalW, nameTotalW))
  );

  // Distribute the chosen activityWidth across columns. The ES/EF/LS/LF
  // pillars must always be the same dimension, so any slack between
  // `cellsTotalW` and `activityWidth` (from MIN_NODE_WIDTH inflation or
  // a long name) goes to the outer columns. The middle stays at its
  // natural need so the dur/slack cells don't grow needlessly wide. If
  // mid's natural need ever exceeds the outer share, fall back to three
  // equal columns so the middle never reads as the widest cell.
  let midColW = midNeeded;
  let outerColW = (activityWidth - midColW) / 2;
  if (midColW > outerColW) {
    outerColW = activityWidth / 3;
    midColW = activityWidth - 2 * outerColW;
  }

  // Milestones are independent: a one-cell-tall date row, a name row,
  // and (optionally) a slack row. Width should fit whichever is widest.
  const mTop = Math.ceil(maxMilestoneTopW) + 2 * CELL_PAD_X;
  const mSlack =
    maxMilestoneSlackW > 0 ? Math.ceil(maxMilestoneSlackW) + 2 * CELL_PAD_X : 0;
  // Milestone name renders at 12pt with anchor-pin reserve.
  const mName = Math.ceil(maxMilestoneNameW) + NAME_PIN_WIDTH + 2 * NAME_PAD_X;
  const milestoneWidth = Math.max(
    MIN_MILESTONE_WIDTH,
    Math.min(MAX_MILESTONE_WIDTH, Math.max(mTop, mSlack, mName))
  );

  return { activityWidth, milestoneWidth, outerColW, midColW };
}

function nodeDimensions(
  resolved: ResolvedPert,
  id: string,
  sizing: NodeSizing,
  overrides?: LayoutOverrides
): { width: number; height: number } {
  if (overrides?.[id]) {
    return { width: overrides[id].width, height: overrides[id].height };
  }
  const r = resolved.activities.find((a) => a.activity.id === id);
  if (r?.activity.isMilestone) {
    return { width: sizing.milestoneWidth, height: MILESTONE_NODE_HEIGHT };
  }
  return { width: sizing.activityWidth, height: DEFAULT_NODE_HEIGHT };
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

  const sizing = computeNodeSizing(resolved);

  // Add real activity nodes (skipping members of collapsed groups).
  for (const r of resolved.activities) {
    if (memberToGroup.has(r.activity.id)) continue;
    const { width, height } = nodeDimensions(
      resolved,
      r.activity.id,
      sizing,
      overrides
    );
    g.setNode(r.activity.id, { width, height });
  }
  // Add one virtual node per collapsed group — uses the same shared
  // activity width so the rolled-up envelope lines up with siblings.
  for (const rg of resolved.groups) {
    if (collapsedGroupIds.has(rg.group.id)) {
      g.setNode(rg.group.id, {
        width: sizing.activityWidth,
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

  // When the diagram has any expanded group, switch to swim-lane layout:
  // ungrouped activities merge into the largest group's lane (the
  // "spine") so they share the same row as the spine's members, and any
  // additional groups get their own horizontal band below — guarantees
  // group rectangles never overlap and cross-group edges read as
  // explicit lane transitions. Falls back to per-rank criticality
  // centering when there are no groups (or all collapsed).
  const swimApplied = applySwimLanes(
    g,
    resolved,
    memberToGroup,
    collapsedGroupIds
  );
  if (!swimApplied) {
    // Pull critical-path activities toward the vertical center of each
    // rank. Dagre orders nodes within a rank to minimize edge crossings,
    // which is criticality-blind — so the dominant path drifts wherever
    // dagre chose. After layout, swap y-positions per rank so the
    // highest-criticality node sits in the middle and lower-criticality
    // ones fan out to the edges.
    centerByCriticality(g, resolved, memberToGroup, collapsedGroupIds);
    // Criticality centering is crossing-blind — it can undo dagre's
    // barycenter ordering and reintroduce edge crossings. Run a greedy
    // adjacent-swap sweep that keeps any swap that reduces total edge
    // crossings, preserving criticality-at-center where it doesn't
    // conflict.
    reduceCrossings(g, resolved.options.direction);
  }

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
    // In-bounds: `seenEdges` keys are always `source|target` (built via join).
    const [source, target] = k.split('|') as [string, string];
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
    // Group rectangle is a tight bounding box around its members plus
    // label-band + bottom padding. Swim-lane placement already guarantees
    // non-overlap by giving each group a distinct slot band, so we don't
    // need to extend the rect to the full lane height — that would just
    // bake in empty space when the spine lane absorbs ungrouped members
    // at ranks the spine doesn't span.
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
// Swim-lane layout (post-process pass)
// ============================================================
//
// When the diagram declares any group, dagre's rank-only layout will
// scatter group members across ranks that the OTHER group also occupies,
// causing post-hoc bounding rectangles to overlap (the classic "two
// groups crammed into the same column band" failure). To fix this, we
// reassign positions along the slot axis so each group gets its own
// contiguous band along the slot axis. Dagre's rank assignments (rank
// axis) are preserved so the diagram still reads as a topological flow.
//
// Lane order: the SPINE lane (the largest expanded group by member
// count) goes first, with all ungrouped activities + collapsed-group
// cards merged into it so they share the spine's primary row — wreck-
// located, dive-ops member, log-inventory all sit at the same y in LR.
// Other expanded groups stack below in source-declaration order. The
// spine group's rectangle remains tight around its own members (not the
// merged-in ungrouped ones), so ungrouped nodes sit at the spine row
// but outside the rect, in the columns the spine doesn't span.

function applySwimLanes(
  g: any,
  resolved: ResolvedPert,
  _memberToGroup: Map<string, string>,
  collapsedGroupIds: ReadonlySet<string>
): boolean {
  const expanded = resolved.groups.filter(
    (rg) => !collapsedGroupIds.has(rg.group.id)
  );
  if (expanded.length === 0) return false;

  const isLR = resolved.options.direction !== 'TB';
  const rankAxis = isLR ? 'x' : 'y';
  const slotAxis = isLR ? 'y' : 'x';

  // Spine = largest expanded group; ungrouped activities (and collapsed-
  // group cards) all merge into this lane so they ride the spine row.
  // Tiebreak by source-declaration order (first largest wins).
  let spineIdx = 1;
  let spineMembers = 0;
  expanded.forEach((rg, i) => {
    if (rg.group.activityIds.length > spineMembers) {
      spineMembers = rg.group.activityIds.length;
      spineIdx = i + 1;
    }
  });

  // Lane index per node. 1..N = expanded groups in declaration order;
  // ungrouped activities + collapsed-group cards get spineIdx so they
  // share the band with the spine's members.
  const laneOf = new Map<string, number>();
  expanded.forEach((rg, i) => {
    for (const aid of rg.group.activityIds) laneOf.set(aid, i + 1);
  });
  for (const id of g.nodes()) {
    if (!laneOf.has(id)) laneOf.set(id, spineIdx);
  }

  // Track which nodes are "spine members" — group members of the spine
  // (NOT the merged-in ungrouped nodes). This drives in-cell ordering:
  // spine members sit at the top slots so they form a continuous row.
  const spineMemberSet = new Set<string>(
    expanded[spineIdx - 1]?.group.activityIds ?? []
  );

  // Bucket every dagre node by rank, then by lane within each rank.
  const numLanes = expanded.length + 1; // index 0 unused (kept for clarity)
  const rankBuckets = new Map<number, Map<number, string[]>>();
  for (const id of g.nodes()) {
    const node = g.node(id);
    if (!node) continue;
    const rankKey = Math.round(node[rankAxis] as number);
    const laneIdx = laneOf.get(id) ?? spineIdx;
    let byLane = rankBuckets.get(rankKey);
    if (!byLane) {
      byLane = new Map();
      rankBuckets.set(rankKey, byLane);
    }
    if (!byLane.has(laneIdx)) byLane.set(laneIdx, []);
    byLane.get(laneIdx)!.push(id);
  }

  // Per-lane slot capacity = max members of that lane in any single rank.
  const laneSlots = new Array<number>(numLanes).fill(0);
  for (const byLane of rankBuckets.values()) {
    for (const [li, members] of byLane) {
      // In-bounds: laneSlots indexed by li from byLane which was keyed under numLanes.
      if (members.length > laneSlots[li]!) laneSlots[li] = members.length;
    }
  }

  // Slot size along the slot axis. All non-milestone activity / collapsed-
  // group nodes share DEFAULT_NODE_HEIGHT in LR; in TB we use the uniform
  // activityWidth (first node's width is representative).
  const slotSize = isLR
    ? DEFAULT_NODE_HEIGHT
    : (g.node(g.nodes()[0])?.width ?? DEFAULT_NODE_HEIGHT);

  // Lane sizes (along the slot axis) = LABEL_PAD + slot strip + BOTTOM_PAD
  // for any lane with at least one member; empty lanes contribute 0.
  const laneSize: number[] = new Array<number>(numLanes).fill(0);
  for (let i = 1; i < numLanes; i++) {
    // In-bounds by loop guard.
    const slots = laneSlots[i]!;
    if (slots === 0) {
      laneSize[i] = 0;
      continue;
    }
    const slotsExtent =
      slots * slotSize + Math.max(0, slots - 1) * SWIMLANE_SLOT_SEP;
    laneSize[i] = GROUP_TOP_PADDING + slotsExtent + GROUP_PADDING;
  }

  // Lane start offsets along the slot axis (cumulative). Spine goes first
  // so the spine row sits at the top of the diagram; other lanes stack
  // below in declaration order.
  const laneOrder: number[] = [
    spineIdx,
    ...Array.from({ length: expanded.length }, (_, i) => i + 1).filter(
      (i) => i !== spineIdx
    ),
  ];
  const laneStart: number[] = new Array<number>(numLanes).fill(0);
  let cursor = DIAGRAM_PADDING;
  for (const li of laneOrder) {
    laneStart[li] = cursor;
    // In-bounds: laneSize is sized numLanes; li drawn from laneOrder which contains valid indices.
    if (laneSize[li]! > 0) cursor += laneSize[li]! + SWIMLANE_GAP;
  }

  // Criticality lookup — used as a tie-breaker when ordering peers in
  // the same cell.
  const critOf = (id: string): number => {
    const r = resolved.activities.find((a) => a.activity.id === id);
    if (r) {
      return r.criticality !== null ? r.criticality : r.isCriticalPath ? 1 : 0;
    }
    const rg = resolved.groups.find((x) => x.group.id === id);
    if (!rg) return 0;
    let m = 0;
    for (const aid of rg.group.activityIds) {
      const ar = resolved.activities.find((a) => a.activity.id === aid);
      if (!ar) continue;
      const c =
        ar.criticality !== null ? ar.criticality : ar.isCriticalPath ? 1 : 0;
      if (c > m) m = c;
    }
    return m;
  };

  // Pre-shuffle slot positions for stable tie-breaking.
  const oldSlot = new Map<string, number>();
  for (const id of g.nodes()) {
    oldSlot.set(id, g.node(id)![slotAxis] as number);
  }

  // Reposition each node into its (lane, rank) cell — packed from the
  // band top so slot 1 stays at the same y across ranks (the "spine
  // row"). Spine members win the top slot; ungrouped tag along beneath.
  for (const byLane of rankBuckets.values()) {
    for (const [li, members] of byLane) {
      // In-bounds: laneStart sized numLanes; li drawn from the same lane-index domain.
      const slotStripStart = laneStart[li]! + GROUP_TOP_PADDING;

      const sorted = [...members].sort((a, b) => {
        // Spine members first (so they own slot 1 — the spine row).
        const aSpine = spineMemberSet.has(a) ? 0 : 1;
        const bSpine = spineMemberSet.has(b) ? 0 : 1;
        if (aSpine !== bSpine) return aSpine - bSpine;
        const ca = critOf(a);
        const cb = critOf(b);
        if (cb !== ca) return cb - ca;
        return (oldSlot.get(a) ?? 0) - (oldSlot.get(b) ?? 0);
      });

      sorted.forEach((id, idx) => {
        const node = g.node(id);
        node[slotAxis] =
          slotStripStart + slotSize / 2 + idx * (slotSize + SWIMLANE_SLOT_SEP);
      });
    }
  }

  // Re-route every edge with a clean S-curve — almost every node moved
  // along the slot axis, so dagre's original control points are now
  // routed through empty space at best, through other nodes at worst.
  const dir = resolved.options.direction;
  for (const e of g.edges()) {
    const src = g.node(e.v);
    const tgt = g.node(e.w);
    if (!src || !tgt) continue;
    const data = g.edge(e);
    if (!data) continue;
    data.points = smoothEdge(src, tgt, dir);
  }

  return true;
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
      // In-bounds: slots was built with same length as newOrder above.
      const newVal = slots[i]!;
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

// ============================================================
// Crossing reduction (post-process pass)
// ============================================================
//
// Greedy adjacent-swap sweep that runs after `centerByCriticality` so
// crossings introduced by criticality permutation can be reversed when
// the swap reduces total edge crossings. Edges are modeled as straight
// segments between node centers — geometrically exact for the polyline
// shape `smoothEdge` produces (the curve only deflects along the flow
// axis, not the slot axis, so two edges cross visually iff their slot-
// axis center segments cross). Caps iterations to bound cost.

function reduceCrossings(g: any, direction: PertDirection): void {
  const isLR = direction !== 'TB';
  const rankAxis = isLR ? 'x' : 'y';
  const slotAxis = isLR ? 'y' : 'x';

  // Bucket nodes by rank.
  const buckets = new Map<number, string[]>();
  for (const id of g.nodes()) {
    const node = g.node(id);
    if (!node) continue;
    const key = Math.round(node[rankAxis] as number);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(id);
  }

  // Collect edges once — each is a pair of node ids whose current
  // positions we read on every count.
  const edges: Array<{ v: string; w: string }> = g
    .edges()
    .map((e: { v: string; w: string }) => ({ v: e.v, w: e.w }));

  const countCrossings = (): number => {
    let total = 0;
    for (let i = 0; i < edges.length; i++) {
      // In-bounds by loop guard.
      const a = edges[i]!;
      const a1 = g.node(a.v);
      const a2 = g.node(a.w);
      if (!a1 || !a2) continue;
      for (let j = i + 1; j < edges.length; j++) {
        // In-bounds by loop guard.
        const b = edges[j]!;
        // Shared endpoint → segments meet at a node, not a crossing.
        if (a.v === b.v || a.v === b.w || a.w === b.v || a.w === b.w) continue;
        const b1 = g.node(b.v);
        const b2 = g.node(b.w);
        if (!b1 || !b2) continue;
        if (segmentsCross(a1, a2, b1, b2)) total++;
      }
    }
    return total;
  };

  // Cap iterations — bubble-style sweep converges fast on small DAGs,
  // but a pathological case shouldn't spend O(rank * pairs) per pass
  // indefinitely.
  const MAX_ITER = 8;
  let baseline = countCrossings();
  if (baseline === 0) return;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let improved = false;
    for (const ids of buckets.values()) {
      if (ids.length < 2) continue;
      const sorted = ids
        .slice()
        .sort(
          (a, b) =>
            (g.node(a)![slotAxis] as number) - (g.node(b)![slotAxis] as number)
        );
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        const an = g.node(a)!;
        const bn = g.node(b)!;
        const av = an[slotAxis] as number;
        const bv = bn[slotAxis] as number;
        an[slotAxis] = bv;
        bn[slotAxis] = av;
        const after = countCrossings();
        if (after < baseline) {
          baseline = after;
          improved = true;
        } else {
          an[slotAxis] = av;
          bn[slotAxis] = bv;
        }
      }
    }
    if (!improved || baseline === 0) break;
  }

  // Re-route every edge — node slot positions changed, so dagre's
  // original control points no longer connect cleanly.
  for (const e of g.edges()) {
    const src = g.node(e.v);
    const tgt = g.node(e.w);
    if (!src || !tgt) continue;
    const data = g.edge(e);
    if (!data) continue;
    data.points = smoothEdge(src, tgt, direction);
  }
}

// Standard CCW segment-intersection test. Returns true only for proper
// (non-collinear, non-endpoint-shared) crossings.
function segmentsCross(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number }
): boolean {
  const ccw = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number }
  ) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = ccw(b1, b2, a1);
  const d2 = ccw(b1, b2, a2);
  const d3 = ccw(a1, a2, b1);
  const d4 = ccw(a1, a2, b2);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}
