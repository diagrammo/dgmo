// ============================================================
// Boxes and Lines — Focus (1-hop neighborhood) Transform
// ============================================================
//
// Pure transform that filters a parsed boxes-and-lines diagram down to a single
// focused element plus its direct (1-hop) graph neighbours, mirroring the shape
// of `org/collapse.ts#focusOrgTree` but for a general graph instead of a tree.
//
// Unlike the org tree (subtree extraction), boxes-and-lines is a general graph,
// so "focus" = the focused element + everything one edge away. Neighbour groups
// come back COLLAPSED (reusing `collapseBoxesAndLines`'s edge-redirect + dedup),
// the focused group comes back EXPANDED, and everything else is hidden.
//
// Composition: this owns ALL collapse decisions for the focused view, so it is
// fed the un-(manually-)collapsed parsed model — focus supersedes the user's
// manual collapse selection for its duration (Decision 12). It runs after
// tag-hide in the app pipeline (FM10).

import type { ParsedBoxesAndLines, BLGroup, BLEdge } from './types';
import { collapseBoxesAndLines } from './collapse';

const GROUP_PREFIX = '__group_';
const groupKey = (label: string): string => `${GROUP_PREFIX}${label}`;
const isGroupKey = (k: string): boolean => k.startsWith(GROUP_PREFIX);
const groupLabelOf = (k: string): string => k.slice(GROUP_PREFIX.length);

export interface FocusTarget {
  readonly kind: 'box' | 'group';
  /** Canonical endpoint key the parser uses for edges: a node label for a box,
   *  or `__group_<label>` for a group. */
  readonly id: string;
}

export interface FocusResult {
  /** Filtered model to lay out + render (neighbour groups already collapsed via
   *  `collapseBoxesAndLines`). */
  readonly parsed: ParsedBoxesAndLines;
  /** Canonical keys of the 1-hop neighbours kept in view (box labels +
   *  `__group_<label>` for neighbour groups). */
  readonly neighborIds: Set<string>;
  /** Group LABELS of neighbours rendered collapsed. */
  readonly collapsedNeighborGroupIds: Set<string>;
  /** GLOBAL value-ramp domain computed from the ORIGINAL model before filtering
   *  (Decision 20 / FM1); null when the diagram has no `heat:` data. */
  readonly rampDomain: { min: number; max: number } | null;
  /** Collapse metadata for `layoutBoxesAndLines` so neighbour groups materialise
   *  as collapsed boxes — mirrors the manual-collapse path's `collapseInfo`. */
  readonly collapseInfo: {
    collapsedChildCounts: Map<string, number>;
    originalGroups: readonly BLGroup[];
  };
}

/**
 * Filter `parsed` to the focused element + its 1-hop neighbours.
 *
 * Pure, synchronous, no I/O. Tolerant of dangling/alias endpoints (skips them,
 * never throws). For an edge-less target it returns the lone element (the app
 * decides the "no connections" affordance, Decision 19).
 */
export function focusBoxesAndLines(
  parsed: ParsedBoxesAndLines,
  target: FocusTarget
): FocusResult {
  // ── Step 1: GLOBAL ramp domain, computed BEFORE any filtering (Dec 20/FM1) ──
  const allValues = parsed.nodes
    .filter((n) => n.value !== undefined)
    .map((n) => n.value!);
  const rampDomain =
    allValues.length > 0
      ? { min: Math.min(...allValues), max: Math.max(...allValues) }
      : null;

  // ── Lookups ──
  const nodeLabelSet = new Set(parsed.nodes.map((n) => n.label));
  const groupByLabel = new Map<string, BLGroup>();
  for (const g of parsed.groups) groupByLabel.set(g.label, g);
  // child label (node or sub-group) → its direct parent group label
  const parentOf = new Map<string, string>();
  for (const g of parsed.groups)
    for (const child of g.children) parentOf.set(child, g.label);

  /** Top-most ancestor group of a node/group label (undefined if top-level). */
  const topAncestor = (label: string): string | undefined => {
    let p = parentOf.get(label);
    if (p === undefined) return undefined;
    for (;;) {
      const up = parentOf.get(p);
      if (up === undefined) return p;
      p = up;
    }
  };

  /** All descendant node + sub-group labels of a group (recursive, cycle-safe). */
  const descendantsOf = (
    groupLabel: string
  ): { nodes: Set<string>; groups: Set<string> } => {
    const nodes = new Set<string>();
    const groups = new Set<string>();
    const seen = new Set<string>([groupLabel]);
    const stack = [groupLabel];
    while (stack.length) {
      const cur = stack.pop()!;
      const g = groupByLabel.get(cur);
      if (!g) continue;
      for (const child of g.children) {
        if (groupByLabel.has(child)) {
          if (!seen.has(child)) {
            seen.add(child);
            groups.add(child);
            stack.push(child);
          }
        } else {
          nodes.add(child);
        }
      }
    }
    return { nodes, groups };
  };

  // ── Step 2: resolve the focused element ──
  // focusNodeLabels  — focus boxes shown standalone (focused box, or a group's members)
  // focusGroupLabels — groups kept EXPANDED (focused group + its sub-groups)
  // focusEndpointSet — canonical keys that count as "the focus" for edge adjacency
  const focusNodeLabels = new Set<string>();
  const focusGroupLabels = new Set<string>();
  const focusEndpointSet = new Set<string>();

  if (target.kind === 'group') {
    const gl = isGroupKey(target.id) ? groupLabelOf(target.id) : target.id;
    if (groupByLabel.has(gl)) {
      focusGroupLabels.add(gl);
      focusEndpointSet.add(groupKey(gl));
      const desc = descendantsOf(gl);
      for (const n of desc.nodes) {
        focusNodeLabels.add(n);
        focusEndpointSet.add(n);
      }
      for (const sg of desc.groups) {
        focusGroupLabels.add(sg);
        focusEndpointSet.add(groupKey(sg));
      }
    }
  } else {
    // box — shown standalone even if it belongs to a group (framing stripped).
    if (nodeLabelSet.has(target.id)) {
      focusNodeLabels.add(target.id);
      focusEndpointSet.add(target.id);
    }
  }

  // ── Step 3: walk edges → neighbours + kept (focus-incident / internal) edges ──
  const neighborIds = new Set<string>();
  const collapsedNeighborGroupIds = new Set<string>();
  const neighborBoxes = new Set<string>();
  const keepGroupLabels = new Set<string>(focusGroupLabels);
  const keptEdges: BLEdge[] = [];
  const selfLoops: BLEdge[] = [];

  const keepGroupAndSubgroups = (gl: string): void => {
    keepGroupLabels.add(gl);
    for (const sg of descendantsOf(gl).groups) keepGroupLabels.add(sg);
  };

  /** Classify a neighbour endpoint; returns whether the incident edge survives. */
  const classifyNeighbor = (key: string): boolean => {
    if (isGroupKey(key)) {
      const gl = groupLabelOf(key);
      if (!groupByLabel.has(gl)) return false; // dangling group ref (FM7)
      if (focusGroupLabels.has(gl)) return true; // part of focus (internal)
      neighborIds.add(key);
      collapsedNeighborGroupIds.add(gl);
      keepGroupAndSubgroups(gl);
      return true;
    }
    if (focusNodeLabels.has(key)) return true; // part of focus
    if (!nodeLabelSet.has(key)) return false; // dangling box endpoint (FM7)
    // A neighbour box inside a group → collapse that group so the edge redirects
    // to a single collapsed box (AC3 / Dec 11); never expand the group (FM4).
    const top = topAncestor(key);
    if (top !== undefined && !focusGroupLabels.has(top)) {
      neighborIds.add(groupKey(top));
      collapsedNeighborGroupIds.add(top);
      keepGroupAndSubgroups(top);
      return true;
    }
    // Standalone neighbour box (no group, or already inside the focused group).
    neighborIds.add(key);
    neighborBoxes.add(key);
    return true;
  };

  for (const edge of parsed.edges) {
    const inS = focusEndpointSet.has(edge.source);
    const inT = focusEndpointSet.has(edge.target);
    if (edge.source === edge.target) {
      // Self-loop: kept iff incident to focus, re-added after the collapse pass
      // (which drops src===tgt) — FM5.
      if (inS) selfLoops.push(edge);
      continue;
    }
    if (inS && inT) {
      keptEdges.push(edge); // internal (member↔member inside focused group) — FM3
      continue;
    }
    if (!inS && !inT) continue; // unrelated to focus
    const other = inS ? edge.target : edge.source;
    if (classifyNeighbor(other)) keptEdges.push(edge);
  }

  // ── Step 4: build the filtered model ──
  const keepNodeLabels = new Set<string>([
    ...focusNodeLabels,
    ...neighborBoxes,
  ]);
  const nodes = parsed.nodes.filter((n) => keepNodeLabels.has(n.label));
  const groups = parsed.groups.filter((g) => keepGroupLabels.has(g.label));
  // Notes follow their owner: kept iff the owning box survives (FM9).
  const notes = parsed.notes?.filter((note) => keepNodeLabels.has(note.ref));

  const filtered: ParsedBoxesAndLines = {
    ...parsed,
    nodes,
    edges: keptEdges,
    groups,
    ...(notes !== undefined && { notes }),
  };

  // ── Step 5: collapse neighbour groups via the shared redirect+dedup (ADR-3) ──
  const collapsed = collapseBoxesAndLines(filtered, collapsedNeighborGroupIds);

  // ── Step 6: re-add self-loops the collapse pass dropped (FM5) ──
  let resultParsed = collapsed.parsed;
  if (selfLoops.length > 0) {
    const visible = new Set(resultParsed.nodes.map((n) => n.label));
    const survivors = selfLoops.filter((e) => visible.has(e.source));
    if (survivors.length > 0)
      resultParsed = {
        ...resultParsed,
        edges: [...resultParsed.edges, ...survivors],
      };
  }

  return {
    parsed: resultParsed,
    neighborIds,
    collapsedNeighborGroupIds,
    rampDomain,
    collapseInfo: {
      collapsedChildCounts: collapsed.collapsedChildCounts,
      originalGroups: collapsed.originalGroups,
    },
  };
}
