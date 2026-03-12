// ============================================================
// C4 Context Diagram Layout Engine (dagre)
// ============================================================

import dagre from '@dagrejs/dagre';
import type { ParsedC4, C4Element, C4Relationship, C4ArrowType, C4Shape, C4DeploymentNode } from './types';
import type { OrgTagGroup } from '../org/parser';

// ============================================================
// Types
// ============================================================

export interface C4LayoutNode {
  id: string;
  name: string;
  type: 'person' | 'system' | 'container' | 'component';
  description?: string;
  metadata: Record<string, string>;
  lineNumber: number;
  color?: string;
  shape?: C4Shape;
  technology?: string;
  drillable?: boolean;
  importPath?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface C4LayoutEdge {
  source: string;
  target: string;
  arrowType: C4ArrowType;
  label?: string;
  technology?: string;
  lineNumber: number;
  points: { x: number; y: number }[];
}

export interface C4LegendEntry {
  value: string;
  color: string;
}

export interface C4LegendGroup {
  name: string;
  entries: C4LegendEntry[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface C4LayoutBoundary {
  label: string;
  typeLabel: string;
  lineNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface C4LayoutResult {
  nodes: C4LayoutNode[];
  edges: C4LayoutEdge[];
  legend: C4LegendGroup[];
  boundary?: C4LayoutBoundary;
  groupBoundaries: C4LayoutBoundary[];
  width: number;
  height: number;
}

// ============================================================
// Constants
// ============================================================

const CHAR_WIDTH = 8;
const MIN_NODE_WIDTH = 160;
const MAX_NODE_WIDTH = 260;
const TYPE_LABEL_HEIGHT = 18;
const DIVIDER_GAP = 6;
const NAME_HEIGHT = 20;
const DESC_LINE_HEIGHT = 16;
const DESC_CHAR_WIDTH = 6.5;
const CARD_V_PAD = 14;
const CARD_H_PAD = 20;
const TECH_LINE_HEIGHT = 16;
const META_LINE_HEIGHT = 16;
const META_CHAR_WIDTH = 6.5;
const MARGIN = 40;
const BOUNDARY_PAD = 40;
const GROUP_BOUNDARY_PAD = 24;

// Legend constants (match org)
const LEGEND_HEIGHT = 28;
const LEGEND_PILL_FONT_SIZE = 11;
const LEGEND_PILL_FONT_W = LEGEND_PILL_FONT_SIZE * 0.6;
const LEGEND_PILL_PAD = 16;
const LEGEND_DOT_R = 4;
const LEGEND_ENTRY_FONT_SIZE = 10;
const LEGEND_ENTRY_FONT_W = LEGEND_ENTRY_FONT_SIZE * 0.6;
const LEGEND_ENTRY_DOT_GAP = 4;
const LEGEND_ENTRY_TRAIL = 8;
const LEGEND_CAPSULE_PAD = 4;

// ============================================================
// Post-Layout Crossing Reduction
// ============================================================

/**
 * Compute penalty for an edge ordering. Uses degree-weighted edge distance:
 * long edges to high-degree nodes are penalized more than to low-degree nodes.
 * This places shared/important nodes closer to their neighbors, reducing
 * visual edge congestion.
 *
 */
function computeEdgePenalty(
  edgeList: { source: string; target: string }[],
  nodePositions: Map<string, number>,
  degrees: Map<string, number>
): number {
  let penalty = 0;

  // Degree-weighted edge distance: longer edges to higher-degree nodes
  // are penalized more, pulling "important" (shared) nodes closer to
  // their neighbors.
  for (const edge of edgeList) {
    const sx = nodePositions.get(edge.source);
    const tx = nodePositions.get(edge.target);
    if (sx == null || tx == null) continue;
    const dist = Math.abs(sx - tx);
    const weight = Math.min(degrees.get(edge.source) ?? 1, degrees.get(edge.target) ?? 1);
    penalty += dist * weight;
  }

  return penalty;
}

/**
 * Post-dagre crossing reduction via permutation search.
 *
 * For each rank, tries all permutations (up to rank size 8) to find the
 * node ordering that minimizes degree-weighted edge distance. Nodes with
 * more connections (like a database shared by multiple services) get placed
 * closer to their neighbors, producing cleaner visual layouts.
 */
function reduceCrossings(
  g: dagre.graphlib.Graph,
  edgeList: { source: string; target: string }[],
  nodeGroupMap?: Map<string, string>
): void {
  if (edgeList.length < 2) return;

  // Compute degree (number of edges) for each node
  const degrees = new Map<string, number>();
  for (const edge of edgeList) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }

  // Group nodes by rank
  const rankMap = new Map<number, string[]>();
  for (const name of g.nodes()) {
    const pos = g.node(name);
    if (!pos) continue;
    const rankY = Math.round(pos.y);
    if (!rankMap.has(rankY)) rankMap.set(rankY, []);
    rankMap.get(rankY)!.push(name);
  }

  // Sort each rank by current x position
  for (const [, rankNodes] of rankMap) {
    rankNodes.sort((a, b) => g.node(a).x - g.node(b).x);
  }

  let anyMoved = false;

  for (const [, rankNodes] of rankMap) {
    if (rankNodes.length < 2) continue;

    // When groups exist, partition rank nodes by group and only permute within groups
    const partitions: string[][] = [];
    if (nodeGroupMap && nodeGroupMap.size > 0) {
      const groupBuckets = new Map<string, string[]>();
      const ungrouped: string[] = [];
      for (const name of rankNodes) {
        const grp = nodeGroupMap.get(name);
        if (grp) {
          if (!groupBuckets.has(grp)) groupBuckets.set(grp, []);
          groupBuckets.get(grp)!.push(name);
        } else {
          ungrouped.push(name);
        }
      }
      for (const bucket of groupBuckets.values()) {
        if (bucket.length >= 2) partitions.push(bucket);
      }
      if (ungrouped.length >= 2) partitions.push(ungrouped);
    } else {
      partitions.push(rankNodes);
    }

    for (const partition of partitions) {
      if (partition.length < 2) continue;

      // Collect the x-slots for this partition (sorted)
      const xSlots = partition.map((name) => g.node(name).x).sort((a, b) => a - b);

      // Build position map snapshot
      const basePositions = new Map<string, number>();
      for (const name of g.nodes()) {
        const pos = g.node(name);
        if (pos) basePositions.set(name, pos.x);
      }

      // Current penalty
      const currentPenalty = computeEdgePenalty(edgeList, basePositions, degrees);

      // Try permutations (feasible for partition sizes ≤ 8)
      let bestPerm = [...partition];
      let bestPenalty = currentPenalty;

      if (partition.length <= 8) {
        const perms = permutations(partition);
        for (const perm of perms) {
          const testPositions = new Map(basePositions);
          for (let i = 0; i < perm.length; i++) {
            testPositions.set(perm[i]!, xSlots[i]!);
          }
          const penalty = computeEdgePenalty(edgeList, testPositions, degrees);
          if (penalty < bestPenalty) {
            bestPenalty = penalty;
            bestPerm = [...perm];
          }
        }
      } else {
        // For large partitions, use adjacent swap
        const workingOrder = [...partition];
        let improved = true;
        let passes = 0;
        while (improved && passes < 10) {
          improved = false;
          passes++;
          for (let i = 0; i < workingOrder.length - 1; i++) {
            const testPositions = new Map(basePositions);
            for (let k = 0; k < workingOrder.length; k++) {
              testPositions.set(workingOrder[k]!, xSlots[k]!);
            }
            const before = computeEdgePenalty(edgeList, testPositions, degrees);

            [workingOrder[i], workingOrder[i + 1]] = [workingOrder[i + 1]!, workingOrder[i]!];
            const testPositions2 = new Map(basePositions);
            for (let k = 0; k < workingOrder.length; k++) {
              testPositions2.set(workingOrder[k]!, xSlots[k]!);
            }
            const after = computeEdgePenalty(edgeList, testPositions2, degrees);

            if (after < before) {
              improved = true;
              if (after < bestPenalty) {
                bestPenalty = after;
                bestPerm = [...workingOrder];
              }
            } else {
              [workingOrder[i], workingOrder[i + 1]] = [workingOrder[i + 1]!, workingOrder[i]!];
            }
          }
        }
      }

      // Apply best permutation if it differs from current
      if (bestPerm.some((name, i) => name !== partition[i])) {
        for (let i = 0; i < bestPerm.length; i++) {
          g.node(bestPerm[i]!).x = xSlots[i]!;
          // Update in the original rankNodes too
          const rankIdx = rankNodes.indexOf(partition[i]!);
          if (rankIdx >= 0) rankNodes[rankIdx] = bestPerm[i]!;
        }
        anyMoved = true;
      }
    }
  }

  // Recompute edge waypoints if any positions changed
  if (anyMoved) {
    for (const edge of edgeList) {
      const edgeData = g.edge(edge.source, edge.target);
      if (!edgeData) continue;
      const srcPos = g.node(edge.source);
      const tgtPos = g.node(edge.target);
      if (!srcPos || !tgtPos) continue;

      const srcBottom = { x: srcPos.x, y: srcPos.y + srcPos.height / 2 };
      const tgtTop = { x: tgtPos.x, y: tgtPos.y - tgtPos.height / 2 };
      const midY = (srcBottom.y + tgtTop.y) / 2;

      edgeData.points = [
        srcBottom,
        { x: srcBottom.x, y: midY },
        { x: tgtTop.x, y: midY },
        tgtTop,
      ];
    }
  }
}

/** Generate all permutations of an array (Heap's algorithm). */
function permutations<T>(arr: T[]): T[][] {
  const result: T[][] = [];
  const a = [...arr];
  const n = a.length;
  const c = new Array(n).fill(0) as number[];

  result.push([...a]);

  let i = 0;
  while (i < n) {
    if (c[i]! < i) {
      if (i % 2 === 0) {
        [a[0], a[i]] = [a[i]!, a[0]!];
      } else {
        [a[c[i]!], a[i]] = [a[i]!, a[c[i]!]!];
      }
      result.push([...a]);
      c[i]!++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }

  return result;
}

// ============================================================
// Roll-Up Logic
// ============================================================

export interface ContextRelationship {
  sourceName: string;
  targetName: string;
  label?: string;
  technology?: string;
  arrowType: C4ArrowType;
  lineNumber: number;
}

/**
 * Build a map from element name → top-level ancestor name.
 * Top-level elements map to themselves.
 */
function buildOwnershipMap(elements: C4Element[]): Map<string, string> {
  const map = new Map<string, string>();

  function walk(el: C4Element, ancestor: string): void {
    map.set(el.name, ancestor);
    for (const child of el.children) {
      walk(child, ancestor);
    }
    for (const group of el.groups) {
      for (const child of group.children) {
        walk(child, ancestor);
      }
    }
  }

  for (const el of elements) {
    walk(el, el.name);
  }

  return map;
}

/**
 * Collect all relationships from the entire element tree.
 */
function collectAllRelationships(
  elements: C4Element[],
  ownerMap: Map<string, string>
): { sourceName: string; rel: C4Relationship }[] {
  const result: { sourceName: string; rel: C4Relationship }[] = [];

  function walk(el: C4Element): void {
    for (const rel of el.relationships) {
      result.push({ sourceName: el.name, rel });
    }
    for (const child of el.children) {
      walk(child);
    }
    for (const group of el.groups) {
      for (const child of group.children) {
        walk(child);
      }
    }
  }

  for (const el of elements) {
    walk(el);
  }

  return result;
}

/**
 * Roll up container/component-level relationships to system-to-system edges.
 * - Skips internal relationships (same top-level ancestor).
 * - Deduplicates: same source→target pair keeps only one (first seen).
 * - Explicit system-level relationships override rolled-up ones.
 */
export function rollUpContextRelationships(parsed: ParsedC4): ContextRelationship[] {
  const ownerMap = buildOwnershipMap(parsed.elements);
  const allRels = collectAllRelationships(parsed.elements, ownerMap);

  // Also include orphan relationships
  for (const rel of parsed.relationships) {
    // Orphan rels have no source element name — skip them for context roll-up
  }

  // Separate system-level (explicit) from nested (rolled-up)
  const topLevelNames = new Set(parsed.elements.map((e) => e.name));
  const explicitKeys = new Set<string>();
  const explicit: ContextRelationship[] = [];
  const nested: ContextRelationship[] = [];

  for (const { sourceName, rel } of allRels) {
    const sourceAncestor = ownerMap.get(sourceName) ?? sourceName;
    const targetAncestor = ownerMap.get(rel.target) ?? rel.target;

    // Skip internal relationships (both in same system)
    if (sourceAncestor === targetAncestor) continue;

    const entry: ContextRelationship = {
      sourceName: sourceAncestor,
      targetName: targetAncestor,
      label: rel.label,
      technology: rel.technology,
      arrowType: rel.arrowType,
      lineNumber: rel.lineNumber,
    };

    // Check if source is a top-level element (explicit system-level rel)
    if (topLevelNames.has(sourceName) && sourceName === sourceAncestor) {
      const key = `${sourceAncestor}→${targetAncestor}`;
      explicitKeys.add(key);
      explicit.push(entry);
    } else {
      nested.push(entry);
    }
  }

  // Deduplicate: explicit overrides rolled-up
  const result = [...explicit];
  const seenKeys = new Set(explicitKeys);

  for (const rel of nested) {
    const key = `${rel.sourceName}→${rel.targetName}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      result.push(rel);
    }
  }

  return result;
}

// ============================================================
// Tag Group Color Resolution
// ============================================================

function resolveNodeColor(
  el: C4Element,
  tagGroups: OrgTagGroup[],
  activeGroupName: string | null,
  ancestors?: C4Element[]
): string | undefined {
  // Check metadata for explicit color
  const colorMeta = el.metadata['color'];
  if (colorMeta) return colorMeta;
  if (!activeGroupName) return undefined;

  const group = tagGroups.find(
    (g) => g.name.toLowerCase() === activeGroupName.toLowerCase()
  );
  if (!group) return undefined;
  const key = group.name.toLowerCase();
  // Walk inheritance chain: element → ancestors (container → system)
  let metaValue: string | undefined = el.metadata[key];
  if (!metaValue && ancestors) {
    for (const ancestor of ancestors) {
      metaValue = ancestor.metadata[key];
      if (metaValue) break;
    }
  }
  const resolvedValue = metaValue ?? group.defaultValue;
  if (!resolvedValue) return '#999999';
  return (
    group.entries.find(
      (e) => e.value.toLowerCase() === resolvedValue.toLowerCase()
    )?.color ?? '#999999'
  );
}

// ============================================================
// Node Sizing
// ============================================================

function wrapText(text: string, maxWidth: number, charWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length * charWidth > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Keys to exclude from the below-divider metadata display. */
const META_EXCLUDE_KEYS = new Set(['description', 'tech', 'technology', 'is a']);

/** Collect displayable metadata entries for a container card. */
export function collectCardMetadata(
  metadata: Record<string, string>
): { key: string; value: string }[] {
  const entries: { key: string; value: string }[] = [];
  // Technology first
  const tech = metadata['tech'] ?? metadata['technology'];
  if (tech) entries.push({ key: 'Technology', value: tech });
  // Then other metadata (tag groups, etc.)
  for (const [k, v] of Object.entries(metadata)) {
    if (META_EXCLUDE_KEYS.has(k.toLowerCase())) continue;
    // Capitalize key for display
    const displayKey = k.charAt(0).toUpperCase() + k.slice(1);
    entries.push({ key: displayKey, value: v });
  }
  return entries;
}

export function computeC4NodeDimensions(
  el: C4Element,
  options?: { showTechnology?: boolean }
): { width: number; height: number } {
  // Width: based on name length, clamped
  const nameWidth = el.name.length * CHAR_WIDTH + CARD_H_PAD * 2;
  let width = Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, nameWidth));

  if (options?.showTechnology) {
    // Container card layout: name + description | divider | metadata rows
    // (no type label — containers are the default in container view)
    let height = CARD_V_PAD + NAME_HEIGHT;

    const desc = el.metadata['description'];
    if (desc) {
      const contentWidth = width - CARD_H_PAD * 2;
      const lines = wrapText(desc, contentWidth, DESC_CHAR_WIDTH);
      height += lines.length * DESC_LINE_HEIGHT;
    }

    // Metadata rows below divider
    const metaEntries = collectCardMetadata(el.metadata);
    if (metaEntries.length > 0) {
      height += DIVIDER_GAP; // divider
      height += metaEntries.length * META_LINE_HEIGHT;
      // Widen card if metadata rows need more space
      const maxMetaWidth = Math.max(
        ...metaEntries.map(
          (e) => (e.key.length + 2 + e.value.length) * META_CHAR_WIDTH + CARD_H_PAD * 2
        )
      );
      if (maxMetaWidth > width) width = Math.min(MAX_NODE_WIDTH, maxMetaWidth);
    }

    height += CARD_V_PAD;
    return { width, height };
  }

  // Context card layout: type + name | divider | description
  let height = CARD_V_PAD + TYPE_LABEL_HEIGHT + DIVIDER_GAP + NAME_HEIGHT;

  const desc = el.metadata['description'];
  if (desc) {
    const contentWidth = width - CARD_H_PAD * 2;
    const lines = wrapText(desc, contentWidth, DESC_CHAR_WIDTH);
    height += lines.length * DESC_LINE_HEIGHT;
  }

  height += CARD_V_PAD;

  return { width, height };
}

// ============================================================
// Legend Helpers
// ============================================================

function computeLegendGroups(tagGroups: OrgTagGroup[]): C4LegendGroup[] {
  const result: C4LegendGroup[] = [];

  for (const group of tagGroups) {
    const entries: C4LegendEntry[] = [];
    for (const entry of group.entries) {
      entries.push({ value: entry.value, color: entry.color });
    }
    if (entries.length === 0) continue;

    // Compute pill width: group name + entries
    const nameW = group.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD * 2;
    let capsuleW = LEGEND_CAPSULE_PAD;
    for (const e of entries) {
      capsuleW +=
        LEGEND_DOT_R * 2 +
        LEGEND_ENTRY_DOT_GAP +
        e.value.length * LEGEND_ENTRY_FONT_W +
        LEGEND_ENTRY_TRAIL;
    }
    capsuleW += LEGEND_CAPSULE_PAD;

    result.push({
      name: group.name,
      entries,
      x: 0,
      y: 0,
      width: nameW + capsuleW,
      height: LEGEND_HEIGHT,
    });
  }

  return result;
}

// ============================================================
// Adaptive Spacing
// ============================================================

/**
 * Compute dagre graph spacing based on edge density.
 * Nodes with high fan-out (many labeled edges) need more inter-rank
 * space so labels don't overlap. Returns ranksep and edgesep.
 */
function computeAdaptiveSpacing(
  edges: { sourceName: string; label?: string; technology?: string }[]
): { nodesep: number; ranksep: number; edgesep: number } {
  // Count max labeled out-degree for any single source node
  const outDegree = new Map<string, number>();
  for (const edge of edges) {
    if (edge.label || edge.technology) {
      outDegree.set(edge.sourceName, (outDegree.get(edge.sourceName) ?? 0) + 1);
    }
  }
  const maxFanOut = Math.max(0, ...outDegree.values());

  // Scale spacing: each additional fan-out edge needs more room for its label.
  // nodesep: wider horizontal gaps give fan-out edges distinct angles,
  // making it clear which label belongs to which line.
  const nodesep = Math.max(80, 60 + maxFanOut * 20);
  const ranksep = Math.max(140, 100 + maxFanOut * 35);
  const edgesep = Math.max(30, 20 + maxFanOut * 8);

  return { nodesep, ranksep, edgesep };
}

// ============================================================
// Main Layout
// ============================================================

export function layoutC4Context(
  parsed: ParsedC4,
  activeTagGroup?: string | null
): C4LayoutResult {
  // Filter to person + system elements only
  const contextElements = parsed.elements.filter(
    (el) => el.type === 'person' || el.type === 'system'
  );

  if (contextElements.length === 0) {
    return { nodes: [], edges: [], legend: [], groupBoundaries: [], width: 0, height: 0 };
  }

  // Roll up relationships
  const contextRels = rollUpContextRelationships(parsed);

  // Compute adaptive spacing based on edge density
  const spacing = computeAdaptiveSpacing(contextRels);

  // Create dagre graph
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'TB',
    nodesep: spacing.nodesep,
    ranksep: spacing.ranksep,
    edgesep: spacing.edgesep,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes
  const nameToElement = new Map<string, C4Element>();
  for (const el of contextElements) {
    nameToElement.set(el.name, el);
    const dims = computeC4NodeDimensions(el);
    g.setNode(el.name, { width: dims.width, height: dims.height });
  }

  // Add edges — only between known nodes
  const validRels: ContextRelationship[] = [];
  for (const rel of contextRels) {
    if (nameToElement.has(rel.sourceName) && nameToElement.has(rel.targetName)) {
      validRels.push(rel);
      g.setEdge(rel.sourceName, rel.targetName, { label: rel.label ?? '' });
    }
  }

  // Run layout
  dagre.layout(g);

  // Post-dagre crossing reduction
  reduceCrossings(
    g,
    validRels.map((r) => ({ source: r.sourceName, target: r.targetName }))
  );

  // Extract positioned nodes
  const nodes: C4LayoutNode[] = contextElements.map((el) => {
    const pos = g.node(el.name);
    const color = resolveNodeColor(el, parsed.tagGroups, activeTagGroup ?? null);
    const hasContainers =
      el.children.some((c) => c.type === 'container') ||
      el.groups.some((g) => g.children.some((c) => c.type === 'container'));
    return {
      id: el.name,
      name: el.name,
      type: el.type as 'person' | 'system',
      description: el.metadata['description'],
      metadata: el.metadata,
      lineNumber: el.lineNumber,
      color,
      drillable: hasContainers || el.importPath ? true : undefined,
      importPath: el.importPath,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    };
  });

  // Extract edges with waypoints
  const edges: C4LayoutEdge[] = validRels.map((rel) => {
    const edgeData = g.edge(rel.sourceName, rel.targetName);
    return {
      source: rel.sourceName,
      target: rel.targetName,
      arrowType: rel.arrowType,
      label: rel.label,
      technology: rel.technology,
      lineNumber: rel.lineNumber,
      points: edgeData?.points ?? [],
    };
  });

  // Compute bounding box of all content (nodes + edge points)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const left = node.x - node.width / 2;
    const top = node.y - node.height / 2;
    const right = node.x + node.width / 2;
    const bottom = node.y + node.height / 2;
    if (left < minX) minX = left;
    if (top < minY) minY = top;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  for (const edge of edges) {
    for (const pt of edge.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  // Shift everything so content starts at (MARGIN, MARGIN)
  if (nodes.length > 0) {
    const shiftX = MARGIN - minX;
    const shiftY = MARGIN - minY;
    for (const node of nodes) {
      node.x += shiftX;
      node.y += shiftY;
    }
    for (const edge of edges) {
      for (const pt of edge.points) {
        pt.x += shiftX;
        pt.y += shiftY;
      }
    }
  }

  let totalWidth = nodes.length > 0 ? maxX - minX + MARGIN * 2 : 0;
  let totalHeight = nodes.length > 0 ? maxY - minY + MARGIN * 2 : 0;

  // Legend: show all defined tag groups and entries so users see the full
  // tag vocabulary regardless of which elements are visible at this view level.
  const legendGroups = computeLegendGroups(parsed.tagGroups);

  // Position legend below diagram
  if (legendGroups.length > 0) {
    const legendY = totalHeight + MARGIN;
    let legendX = MARGIN;
    for (const lg of legendGroups) {
      lg.x = legendX;
      lg.y = legendY;
      legendX += lg.width + 12;
    }
    const legendRight = legendX;
    const legendBottom = legendY + LEGEND_HEIGHT;
    if (legendRight > totalWidth) totalWidth = legendRight;
    if (legendBottom > totalHeight) totalHeight = legendBottom;
  }

  return { nodes, edges, legend: legendGroups, groupBoundaries: [], width: totalWidth, height: totalHeight };
}

// ============================================================
// Container-Level Layout
// ============================================================

/**
 * Layout containers within a specific system, plus external elements
 * that have relationships with those containers.
 */
export function layoutC4Containers(
  parsed: ParsedC4,
  systemName: string,
  activeTagGroup?: string | null
): C4LayoutResult {
  // Find the system element by name
  const system = parsed.elements.find(
    (el) => el.name.toLowerCase() === systemName.toLowerCase()
  );
  if (!system) {
    return { nodes: [], edges: [], legend: [], groupBoundaries: [], width: 0, height: 0 };
  }

  // Collect all containers: direct children + group children
  const containers: C4Element[] = [];
  for (const child of system.children) {
    if (child.type === 'container') containers.push(child);
  }
  for (const group of system.groups) {
    for (const child of group.children) {
      if (child.type === 'container') containers.push(child);
    }
  }

  if (containers.length === 0) {
    return { nodes: [], edges: [], legend: [], groupBoundaries: [], width: 0, height: 0 };
  }

  const containerNames = new Set(containers.map((c) => c.name.toLowerCase()));

  // Build name → element map for all top-level elements
  const topElementsByName = new Map<string, C4Element>();
  for (const el of parsed.elements) {
    topElementsByName.set(el.name.toLowerCase(), el);
  }

  // Identify external elements: targets of container relationships that aren't
  // in this system, OR top-level elements that target containers in this system
  const externalNames = new Set<string>();

  // Forward: container → target outside this system
  for (const container of containers) {
    for (const rel of container.relationships) {
      const targetLower = rel.target.toLowerCase();
      if (!containerNames.has(targetLower)) {
        externalNames.add(targetLower);
      }
    }
  }

  // Reverse: top-level elements (and their children) that target containers in this system
  const ownerMap = buildOwnershipMap(parsed.elements);
  const allRels = collectAllRelationships(parsed.elements, ownerMap);
  for (const { sourceName, rel } of allRels) {
    const sourceAncestor = ownerMap.get(sourceName) ?? sourceName;
    // Skip relationships from within this system
    if (sourceAncestor.toLowerCase() === system.name.toLowerCase()) continue;
    // Check if target is a container in this system
    if (containerNames.has(rel.target.toLowerCase())) {
      externalNames.add(sourceAncestor.toLowerCase());
    }
  }

  // Resolve external elements
  const externals: C4Element[] = [];
  for (const name of externalNames) {
    const el = topElementsByName.get(name);
    if (el) externals.push(el);
  }

  // Build element-to-group mapping for compound graph
  const elementToGroup = new Map<string, { name: string; lineNumber: number }>();
  for (const group of system.groups) {
    for (const child of group.children) {
      if (child.type === 'container') {
        elementToGroup.set(child.name, { name: group.name, lineNumber: group.lineNumber });
      }
    }
  }
  const hasGroups = elementToGroup.size > 0;

  // Create dagre graph — use compound when groups exist
  const g = hasGroups
    ? new dagre.graphlib.Graph({ compound: true })
    : new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));

  // Add virtual group parent nodes
  if (hasGroups) {
    const seenGroups = new Set<string>();
    for (const { name } of elementToGroup.values()) {
      if (!seenGroups.has(name)) {
        seenGroups.add(name);
        g.setNode('__group_' + name, {});
      }
    }
  }

  // Add container nodes
  const nameToElement = new Map<string, C4Element>();
  for (const el of containers) {
    nameToElement.set(el.name, el);
    const dims = computeC4NodeDimensions(el, { showTechnology: true });
    g.setNode(el.name, { width: dims.width, height: dims.height });
    // Set group parent
    const grp = elementToGroup.get(el.name);
    if (grp) {
      g.setParent(el.name, '__group_' + grp.name);
    }
  }

  // Add external nodes
  for (const el of externals) {
    nameToElement.set(el.name, el);
    const dims = computeC4NodeDimensions(el);
    g.setNode(el.name, { width: dims.width, height: dims.height });
  }

  // Collect container-level relationships (not rolled up)
  interface ContainerRel {
    sourceName: string;
    targetName: string;
    label?: string;
    technology?: string;
    arrowType: C4ArrowType;
    lineNumber: number;
  }

  const containerRels: ContainerRel[] = [];
  const seenEdgeKeys = new Set<string>();

  // Forward: container → target
  for (const container of containers) {
    for (const rel of container.relationships) {
      const targetEl = nameToElement.get(rel.target);
      if (!targetEl) continue;
      const key = `${container.name}→${rel.target}`;
      if (!seenEdgeKeys.has(key)) {
        seenEdgeKeys.add(key);
        containerRels.push({
          sourceName: container.name,
          targetName: rel.target,
          label: rel.label,
          technology: rel.technology,
          arrowType: rel.arrowType,
          lineNumber: rel.lineNumber,
        });
      }
    }
  }

  // Reverse: external → container (find specific container-level relationships)
  for (const { sourceName, rel } of allRels) {
    const sourceAncestor = ownerMap.get(sourceName) ?? sourceName;
    if (sourceAncestor.toLowerCase() === system.name.toLowerCase()) continue;
    if (containerNames.has(rel.target.toLowerCase())) {
      const externalEl = nameToElement.get(sourceAncestor);
      if (!externalEl) continue;
      const key = `${sourceAncestor}→${rel.target}`;
      if (!seenEdgeKeys.has(key)) {
        seenEdgeKeys.add(key);
        containerRels.push({
          sourceName: sourceAncestor,
          targetName: rel.target,
          label: rel.label,
          technology: rel.technology,
          arrowType: rel.arrowType,
          lineNumber: rel.lineNumber,
        });
      }
    }
  }

  // Compute adaptive spacing based on edge fan-out
  const spacing = computeAdaptiveSpacing(containerRels);
  g.setGraph({
    rankdir: 'TB',
    nodesep: spacing.nodesep,
    ranksep: spacing.ranksep,
    edgesep: spacing.edgesep,
  });

  // Add edges to dagre
  for (const rel of containerRels) {
    if (nameToElement.has(rel.sourceName) && nameToElement.has(rel.targetName)) {
      g.setEdge(rel.sourceName, rel.targetName, { label: rel.label ?? '' });
    }
  }

  // Run layout
  dagre.layout(g);

  // Post-dagre crossing reduction (with group-aware partitioning)
  const nodeGroupMap = hasGroups
    ? new Map([...elementToGroup.entries()].map(([k, v]) => [k, v.name]))
    : undefined;
  reduceCrossings(
    g,
    containerRels
      .filter((r) => nameToElement.has(r.sourceName) && nameToElement.has(r.targetName))
      .map((r) => ({ source: r.sourceName, target: r.targetName })),
    nodeGroupMap
  );

  // Extract positioned nodes
  const nodes: C4LayoutNode[] = [];
  for (const el of containers) {
    const pos = g.node(el.name);
    const color = resolveNodeColor(el, parsed.tagGroups, activeTagGroup ?? null);
    const tech = el.metadata['tech'] ?? el.metadata['technology'];
    const hasComponents =
      el.children.some((c) => c.type === 'component') ||
      el.groups.some((grp) => grp.children.some((c) => c.type === 'component'));
    nodes.push({
      id: el.name,
      name: el.name,
      type: 'container',
      description: el.metadata['description'],
      metadata: el.metadata,
      lineNumber: el.lineNumber,
      color,
      shape: el.shape,
      technology: tech,
      drillable: hasComponents || el.importPath ? true : undefined,
      importPath: el.importPath,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    });
  }

  for (const el of externals) {
    const pos = g.node(el.name);
    const color = resolveNodeColor(el, parsed.tagGroups, activeTagGroup ?? null);
    nodes.push({
      id: el.name,
      name: el.name,
      type: el.type as 'person' | 'system',
      description: el.metadata['description'],
      metadata: el.metadata,
      lineNumber: el.lineNumber,
      color,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    });
  }

  // Extract edges
  const edges: C4LayoutEdge[] = containerRels
    .filter((rel) => nameToElement.has(rel.sourceName) && nameToElement.has(rel.targetName))
    .map((rel) => {
      const edgeData = g.edge(rel.sourceName, rel.targetName);
      return {
        source: rel.sourceName,
        target: rel.targetName,
        arrowType: rel.arrowType,
        label: rel.label,
        technology: rel.technology,
        lineNumber: rel.lineNumber,
        points: edgeData?.points ?? [],
      };
    });

  // Compute boundary box from container nodes only
  const containerNodes = nodes.filter((n) => n.type === 'container');
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (const n of containerNodes) {
    const left = n.x - n.width / 2;
    const top = n.y - n.height / 2;
    const right = n.x + n.width / 2;
    const bottom = n.y + n.height / 2;
    if (left < bMinX) bMinX = left;
    if (top < bMinY) bMinY = top;
    if (right > bMaxX) bMaxX = right;
    if (bottom > bMaxY) bMaxY = bottom;
  }

  const boundary: C4LayoutBoundary = {
    label: system.name,
    typeLabel: 'system',
    lineNumber: system.lineNumber,
    x: bMinX - BOUNDARY_PAD,
    y: bMinY - BOUNDARY_PAD,
    width: (bMaxX - bMinX) + BOUNDARY_PAD * 2,
    height: (bMaxY - bMinY) + BOUNDARY_PAD * 2,
  };

  // Compute group boundaries from member node positions
  const groupBoundaries: C4LayoutBoundary[] = [];
  if (hasGroups) {
    const nodeMap = new Map(containerNodes.map((n) => [n.name, n]));
    const seenGroups = new Map<string, { lineNumber: number; members: C4LayoutNode[] }>();
    for (const [elName, grp] of elementToGroup) {
      const node = nodeMap.get(elName);
      if (!node) continue;
      if (!seenGroups.has(grp.name)) {
        seenGroups.set(grp.name, { lineNumber: grp.lineNumber, members: [] });
      }
      seenGroups.get(grp.name)!.members.push(node);
    }
    for (const [groupName, { lineNumber, members }] of seenGroups) {
      if (members.length === 0) continue;
      let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
      for (const m of members) {
        const left = m.x - m.width / 2;
        const top = m.y - m.height / 2;
        const right = m.x + m.width / 2;
        const bottom = m.y + m.height / 2;
        if (left < gMinX) gMinX = left;
        if (top < gMinY) gMinY = top;
        if (right > gMaxX) gMaxX = right;
        if (bottom > gMaxY) gMaxY = bottom;
      }
      groupBoundaries.push({
        label: groupName,
        typeLabel: 'group',
        lineNumber,
        x: gMinX - GROUP_BOUNDARY_PAD,
        y: gMinY - GROUP_BOUNDARY_PAD,
        width: (gMaxX - gMinX) + GROUP_BOUNDARY_PAD * 2,
        height: (gMaxY - gMinY) + GROUP_BOUNDARY_PAD * 2,
      });
    }
  }

  // Compute bounding box of all content (nodes + boundary + group boundaries + edge points)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const left = node.x - node.width / 2;
    const top = node.y - node.height / 2;
    const right = node.x + node.width / 2;
    const bottom = node.y + node.height / 2;
    if (left < minX) minX = left;
    if (top < minY) minY = top;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  if (boundary.x < minX) minX = boundary.x;
  if (boundary.y < minY) minY = boundary.y;
  if (boundary.x + boundary.width > maxX) maxX = boundary.x + boundary.width;
  if (boundary.y + boundary.height > maxY) maxY = boundary.y + boundary.height;
  for (const gb of groupBoundaries) {
    if (gb.x < minX) minX = gb.x;
    if (gb.y < minY) minY = gb.y;
    if (gb.x + gb.width > maxX) maxX = gb.x + gb.width;
    if (gb.y + gb.height > maxY) maxY = gb.y + gb.height;
  }
  for (const edge of edges) {
    for (const pt of edge.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  // Shift everything so content starts at (MARGIN, MARGIN)
  const shiftX = MARGIN - minX;
  const shiftY = MARGIN - minY;
  for (const node of nodes) {
    node.x += shiftX;
    node.y += shiftY;
  }
  boundary.x += shiftX;
  boundary.y += shiftY;
  for (const gb of groupBoundaries) {
    gb.x += shiftX;
    gb.y += shiftY;
  }
  for (const edge of edges) {
    for (const pt of edge.points) {
      pt.x += shiftX;
      pt.y += shiftY;
    }
  }

  let totalWidth = maxX - minX + MARGIN * 2;
  let totalHeight = maxY - minY + MARGIN * 2;

  const legendGroups = computeLegendGroups(parsed.tagGroups);

  // Position legend below diagram
  if (legendGroups.length > 0) {
    const legendY = totalHeight + MARGIN;
    let legendX = MARGIN;
    for (const lg of legendGroups) {
      lg.x = legendX;
      lg.y = legendY;
      legendX += lg.width + 12;
    }
    const legendRight = legendX;
    const legendBottom = legendY + LEGEND_HEIGHT;
    if (legendRight > totalWidth) totalWidth = legendRight;
    if (legendBottom > totalHeight) totalHeight = legendBottom;
  }

  return { nodes, edges, legend: legendGroups, boundary, groupBoundaries, width: totalWidth, height: totalHeight };
}

// ============================================================
// Component-Level Layout
// ============================================================

/**
 * Layout components within a specific container, plus external elements
 * that have relationships with those components.
 */
export function layoutC4Components(
  parsed: ParsedC4,
  systemName: string,
  containerName: string,
  activeTagGroup?: string | null
): C4LayoutResult {
  // Find the system element by name
  const system = parsed.elements.find(
    (el) => el.name.toLowerCase() === systemName.toLowerCase()
  );
  if (!system) {
    return { nodes: [], edges: [], legend: [], groupBoundaries: [], width: 0, height: 0 };
  }

  // Find the container within the system (direct children + group children)
  let targetContainer: C4Element | undefined;
  for (const child of system.children) {
    if (child.type === 'container' && child.name.toLowerCase() === containerName.toLowerCase()) {
      targetContainer = child;
      break;
    }
  }
  if (!targetContainer) {
    for (const group of system.groups) {
      for (const child of group.children) {
        if (child.type === 'container' && child.name.toLowerCase() === containerName.toLowerCase()) {
          targetContainer = child;
          break;
        }
      }
      if (targetContainer) break;
    }
  }
  if (!targetContainer) {
    return { nodes: [], edges: [], legend: [], groupBoundaries: [], width: 0, height: 0 };
  }

  // Collect all components: direct children + group children
  const components: C4Element[] = [];
  for (const child of targetContainer.children) {
    if (child.type === 'component') components.push(child);
  }
  for (const group of targetContainer.groups) {
    for (const child of group.children) {
      if (child.type === 'component') components.push(child);
    }
  }

  if (components.length === 0) {
    return { nodes: [], edges: [], legend: [], groupBoundaries: [], width: 0, height: 0 };
  }

  const componentNames = new Set(components.map((c) => c.name.toLowerCase()));

  // Build name → element map for all top-level elements and containers in this system
  const topElementsByName = new Map<string, C4Element>();
  for (const el of parsed.elements) {
    topElementsByName.set(el.name.toLowerCase(), el);
    // Also index containers in every system for external container resolution
    for (const child of el.children) {
      if (child.type === 'container') {
        topElementsByName.set(child.name.toLowerCase(), child);
      }
    }
    for (const group of el.groups) {
      for (const child of group.children) {
        if (child.type === 'container') {
          topElementsByName.set(child.name.toLowerCase(), child);
        }
      }
    }
  }

  // Identify external elements: targets of component relationships not in this container,
  // or elements whose relationships target components in this container
  const externalNames = new Set<string>();

  // Forward: component → target outside this container
  for (const component of components) {
    for (const rel of component.relationships) {
      const targetLower = rel.target.toLowerCase();
      if (!componentNames.has(targetLower)) {
        externalNames.add(targetLower);
      }
    }
  }

  // Reverse: any element that targets a component in this container
  const ownerMap = buildOwnershipMap(parsed.elements);
  const allRels = collectAllRelationships(parsed.elements, ownerMap);
  for (const { sourceName, rel } of allRels) {
    // Skip relationships from within this container
    if (componentNames.has(sourceName.toLowerCase())) continue;
    // Check if target is a component in this container
    if (componentNames.has(rel.target.toLowerCase())) {
      // Resolve to the most specific known element: if source is a container, use it;
      // otherwise roll up to system ancestor
      const sourceAncestor = ownerMap.get(sourceName) ?? sourceName;
      // If source is inside the same container, skip
      if (sourceAncestor.toLowerCase() === targetContainer.name.toLowerCase()) continue;
      if (sourceAncestor.toLowerCase() === system.name.toLowerCase()) {
        // Source is in same system — try to resolve to container level
        const sourceLower = sourceName.toLowerCase();
        if (topElementsByName.has(sourceLower)) {
          externalNames.add(sourceLower);
        } else {
          externalNames.add(sourceAncestor.toLowerCase());
        }
      } else {
        externalNames.add(sourceAncestor.toLowerCase());
      }
    }
  }

  // Resolve external elements
  const externals: C4Element[] = [];
  for (const name of externalNames) {
    const el = topElementsByName.get(name);
    if (el) externals.push(el);
  }

  // Build element-to-group mapping for compound graph
  const elementToGroup = new Map<string, { name: string; lineNumber: number }>();
  for (const group of targetContainer.groups) {
    for (const child of group.children) {
      if (child.type === 'component') {
        elementToGroup.set(child.name, { name: group.name, lineNumber: group.lineNumber });
      }
    }
  }
  const hasGroups = elementToGroup.size > 0;

  // Create dagre graph — use compound when groups exist
  const g = hasGroups
    ? new dagre.graphlib.Graph({ compound: true })
    : new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));

  // Add virtual group parent nodes
  if (hasGroups) {
    const seenGroups = new Set<string>();
    for (const { name } of elementToGroup.values()) {
      if (!seenGroups.has(name)) {
        seenGroups.add(name);
        g.setNode('__group_' + name, {});
      }
    }
  }

  // Add component nodes
  const nameToElement = new Map<string, C4Element>();
  for (const el of components) {
    nameToElement.set(el.name, el);
    const dims = computeC4NodeDimensions(el, { showTechnology: true });
    g.setNode(el.name, { width: dims.width, height: dims.height });
    // Set group parent
    const grp = elementToGroup.get(el.name);
    if (grp) {
      g.setParent(el.name, '__group_' + grp.name);
    }
  }

  // Add external nodes
  for (const el of externals) {
    nameToElement.set(el.name, el);
    const dims = computeC4NodeDimensions(el);
    g.setNode(el.name, { width: dims.width, height: dims.height });
  }

  // Collect component-level relationships
  interface ComponentRel {
    sourceName: string;
    targetName: string;
    label?: string;
    technology?: string;
    arrowType: C4ArrowType;
    lineNumber: number;
  }

  const componentRels: ComponentRel[] = [];
  const seenEdgeKeys = new Set<string>();

  // Forward: component → target
  for (const component of components) {
    for (const rel of component.relationships) {
      const targetEl = nameToElement.get(rel.target);
      if (!targetEl) continue;
      const key = `${component.name}→${rel.target}`;
      if (!seenEdgeKeys.has(key)) {
        seenEdgeKeys.add(key);
        componentRels.push({
          sourceName: component.name,
          targetName: rel.target,
          label: rel.label,
          technology: rel.technology,
          arrowType: rel.arrowType,
          lineNumber: rel.lineNumber,
        });
      }
    }
  }

  // Reverse: external → component
  for (const { sourceName, rel } of allRels) {
    if (componentNames.has(sourceName.toLowerCase())) continue;
    if (!componentNames.has(rel.target.toLowerCase())) continue;

    const sourceAncestor = ownerMap.get(sourceName) ?? sourceName;
    if (sourceAncestor.toLowerCase() === targetContainer.name.toLowerCase()) continue;

    // Resolve source to the external element we added
    let resolvedSource: string | undefined;
    if (nameToElement.has(sourceName)) {
      resolvedSource = sourceName;
    } else if (nameToElement.has(sourceAncestor)) {
      resolvedSource = sourceAncestor;
    }
    if (!resolvedSource) continue;

    const key = `${resolvedSource}→${rel.target}`;
    if (!seenEdgeKeys.has(key)) {
      seenEdgeKeys.add(key);
      componentRels.push({
        sourceName: resolvedSource,
        targetName: rel.target,
        label: rel.label,
        technology: rel.technology,
        arrowType: rel.arrowType,
        lineNumber: rel.lineNumber,
      });
    }
  }

  // Compute adaptive spacing based on edge fan-out
  const spacing = computeAdaptiveSpacing(componentRels);
  g.setGraph({
    rankdir: 'TB',
    nodesep: spacing.nodesep,
    ranksep: spacing.ranksep,
    edgesep: spacing.edgesep,
  });

  // Add edges to dagre
  for (const rel of componentRels) {
    if (nameToElement.has(rel.sourceName) && nameToElement.has(rel.targetName)) {
      g.setEdge(rel.sourceName, rel.targetName, { label: rel.label ?? '' });
    }
  }

  // Run layout
  dagre.layout(g);

  // Post-dagre crossing reduction (with group-aware partitioning)
  const nodeGroupMap = hasGroups
    ? new Map([...elementToGroup.entries()].map(([k, v]) => [k, v.name]))
    : undefined;
  reduceCrossings(
    g,
    componentRels
      .filter((r) => nameToElement.has(r.sourceName) && nameToElement.has(r.targetName))
      .map((r) => ({ source: r.sourceName, target: r.targetName })),
    nodeGroupMap
  );

  // Tag inheritance ancestors: container → system
  const ancestors = [targetContainer, system];

  // Extract positioned nodes
  const nodes: C4LayoutNode[] = [];
  for (const el of components) {
    const pos = g.node(el.name);
    const color = resolveNodeColor(el, parsed.tagGroups, activeTagGroup ?? null, ancestors);
    const tech = el.metadata['tech'] ?? el.metadata['technology'];
    const hasComponents =
      el.children.some((c) => c.type === 'component') ||
      el.groups.some((grp) => grp.children.some((c) => c.type === 'component'));
    nodes.push({
      id: el.name,
      name: el.name,
      type: 'component',
      description: el.metadata['description'],
      metadata: el.metadata,
      lineNumber: el.lineNumber,
      color,
      shape: el.shape,
      technology: tech,
      drillable: hasComponents || el.importPath ? true : undefined,
      importPath: el.importPath,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    });
  }

  for (const el of externals) {
    const pos = g.node(el.name);
    const color = resolveNodeColor(el, parsed.tagGroups, activeTagGroup ?? null);
    nodes.push({
      id: el.name,
      name: el.name,
      type: el.type as 'person' | 'system' | 'container',
      description: el.metadata['description'],
      metadata: el.metadata,
      lineNumber: el.lineNumber,
      color,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    });
  }

  // Extract edges
  const edges: C4LayoutEdge[] = componentRels
    .filter((rel) => nameToElement.has(rel.sourceName) && nameToElement.has(rel.targetName))
    .map((rel) => {
      const edgeData = g.edge(rel.sourceName, rel.targetName);
      return {
        source: rel.sourceName,
        target: rel.targetName,
        arrowType: rel.arrowType,
        label: rel.label,
        technology: rel.technology,
        lineNumber: rel.lineNumber,
        points: edgeData?.points ?? [],
      };
    });

  // Compute boundary box from component nodes only
  const componentNodes = nodes.filter((n) => n.type === 'component');
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (const n of componentNodes) {
    const left = n.x - n.width / 2;
    const top = n.y - n.height / 2;
    const right = n.x + n.width / 2;
    const bottom = n.y + n.height / 2;
    if (left < bMinX) bMinX = left;
    if (top < bMinY) bMinY = top;
    if (right > bMaxX) bMaxX = right;
    if (bottom > bMaxY) bMaxY = bottom;
  }

  const boundary: C4LayoutBoundary = {
    label: targetContainer.name,
    typeLabel: 'container',
    lineNumber: targetContainer.lineNumber,
    x: bMinX - BOUNDARY_PAD,
    y: bMinY - BOUNDARY_PAD,
    width: (bMaxX - bMinX) + BOUNDARY_PAD * 2,
    height: (bMaxY - bMinY) + BOUNDARY_PAD * 2,
  };

  // Compute group boundaries from member node positions
  const groupBoundaries: C4LayoutBoundary[] = [];
  if (hasGroups) {
    const nodeMap = new Map(componentNodes.map((n) => [n.name, n]));
    const seenGroups = new Map<string, { lineNumber: number; members: C4LayoutNode[] }>();
    for (const [elName, grp] of elementToGroup) {
      const node = nodeMap.get(elName);
      if (!node) continue;
      if (!seenGroups.has(grp.name)) {
        seenGroups.set(grp.name, { lineNumber: grp.lineNumber, members: [] });
      }
      seenGroups.get(grp.name)!.members.push(node);
    }
    for (const [groupName, { lineNumber, members }] of seenGroups) {
      if (members.length === 0) continue;
      let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
      for (const m of members) {
        const left = m.x - m.width / 2;
        const top = m.y - m.height / 2;
        const right = m.x + m.width / 2;
        const bottom = m.y + m.height / 2;
        if (left < gMinX) gMinX = left;
        if (top < gMinY) gMinY = top;
        if (right > gMaxX) gMaxX = right;
        if (bottom > gMaxY) gMaxY = bottom;
      }
      groupBoundaries.push({
        label: groupName,
        typeLabel: 'group',
        lineNumber,
        x: gMinX - GROUP_BOUNDARY_PAD,
        y: gMinY - GROUP_BOUNDARY_PAD,
        width: (gMaxX - gMinX) + GROUP_BOUNDARY_PAD * 2,
        height: (gMaxY - gMinY) + GROUP_BOUNDARY_PAD * 2,
      });
    }
  }

  // Compute bounding box of all content (nodes + boundary + group boundaries + edge points)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const left = node.x - node.width / 2;
    const top = node.y - node.height / 2;
    const right = node.x + node.width / 2;
    const bottom = node.y + node.height / 2;
    if (left < minX) minX = left;
    if (top < minY) minY = top;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  if (boundary.x < minX) minX = boundary.x;
  if (boundary.y < minY) minY = boundary.y;
  if (boundary.x + boundary.width > maxX) maxX = boundary.x + boundary.width;
  if (boundary.y + boundary.height > maxY) maxY = boundary.y + boundary.height;
  for (const gb of groupBoundaries) {
    if (gb.x < minX) minX = gb.x;
    if (gb.y < minY) minY = gb.y;
    if (gb.x + gb.width > maxX) maxX = gb.x + gb.width;
    if (gb.y + gb.height > maxY) maxY = gb.y + gb.height;
  }
  for (const edge of edges) {
    for (const pt of edge.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  // Shift everything so content starts at (MARGIN, MARGIN)
  const shiftX = MARGIN - minX;
  const shiftY = MARGIN - minY;
  for (const node of nodes) {
    node.x += shiftX;
    node.y += shiftY;
  }
  boundary.x += shiftX;
  boundary.y += shiftY;
  for (const gb of groupBoundaries) {
    gb.x += shiftX;
    gb.y += shiftY;
  }
  for (const edge of edges) {
    for (const pt of edge.points) {
      pt.x += shiftX;
      pt.y += shiftY;
    }
  }

  let totalWidth = maxX - minX + MARGIN * 2;
  let totalHeight = maxY - minY + MARGIN * 2;


  const legendGroups = computeLegendGroups(parsed.tagGroups);

  // Position legend below diagram
  if (legendGroups.length > 0) {
    const legendY = totalHeight + MARGIN;
    let legendX = MARGIN;
    for (const lg of legendGroups) {
      lg.x = legendX;
      lg.y = legendY;
      legendX += lg.width + 12;
    }
    const legendRight = legendX;
    const legendBottom = legendY + LEGEND_HEIGHT;
    if (legendRight > totalWidth) totalWidth = legendRight;
    if (legendBottom > totalHeight) totalHeight = legendBottom;
  }

  return { nodes, edges, legend: legendGroups, boundary, groupBoundaries, width: totalWidth, height: totalHeight };
}

// ============================================================
// Deployment Diagram Layout
// ============================================================

/**
 * Resolve a container reference name to its C4Element by walking the parsed
 * element tree. Matches container names case-insensitively.
 */
function resolveContainerRef(parsed: ParsedC4, refName: string): C4Element | undefined {
  const lower = refName.toLowerCase();
  for (const el of parsed.elements) {
    for (const child of el.children) {
      if (child.type === 'container' && child.name.toLowerCase() === lower) return child;
    }
    for (const group of el.groups) {
      for (const child of group.children) {
        if (child.type === 'container' && child.name.toLowerCase() === lower) return child;
      }
    }
  }
  return undefined;
}

/**
 * Collect all container ref nodes from the deployment tree, flattened with
 * their parent infra node ID for compound graph assignment.
 */
interface DeploymentRefEntry {
  refName: string;
  element: C4Element;
  infraId: string;
  /** Line number of the infra node containing this ref. */
  deployLineNumber: number;
}

function collectDeploymentRefs(
  nodes: C4DeploymentNode[],
  parsed: ParsedC4,
  parentId: string | null,
  refs: DeploymentRefEntry[],
  infraIds: Map<string, C4DeploymentNode>,
  infraParents: Map<string, string | null>,
): void {
  for (const node of nodes) {
    const infraId = `__infra_${node.name}`;
    infraIds.set(infraId, node);
    infraParents.set(infraId, parentId);

    for (const ref of node.containerRefs) {
      const el = resolveContainerRef(parsed, ref);
      if (el) {
        refs.push({ refName: ref, element: el, infraId, deployLineNumber: node.lineNumber });
      }
    }

    collectDeploymentRefs(node.children, parsed, infraId, refs, infraIds, infraParents);
  }
}

/**
 * Layout a C4 deployment diagram.
 *
 * Infrastructure nodes become boundary boxes (nested).
 * Container refs inside them become cards.
 * Edges are drawn between referenced containers that have relationships.
 */
export function layoutC4Deployment(
  parsed: ParsedC4,
  activeTagGroup?: string | null,
): C4LayoutResult {
  if (parsed.deployment.length === 0) {
    return { nodes: [], edges: [], legend: [], groupBoundaries: [], width: 0, height: 0 };
  }

  // Collect all refs and infra node info
  const refs: DeploymentRefEntry[] = [];
  const infraIds = new Map<string, C4DeploymentNode>();
  const infraParents = new Map<string, string | null>();
  collectDeploymentRefs(parsed.deployment, parsed, null, refs, infraIds, infraParents);

  if (refs.length === 0) {
    return { nodes: [], edges: [], legend: [], groupBoundaries: [], width: 0, height: 0 };
  }

  // Deduplicate refs by element name (a container can appear in multiple infra
  // nodes — keep first occurrence). Track which container names are in scope.
  const seenRefs = new Map<string, DeploymentRefEntry>();
  for (const ref of refs) {
    const key = ref.element.name.toLowerCase();
    if (!seenRefs.has(key)) seenRefs.set(key, ref);
  }
  const refEntries = [...seenRefs.values()];
  const refNames = new Set(refEntries.map((r) => r.element.name.toLowerCase()));

  // Build a name→element map for resolved containers
  const nameToElement = new Map<string, C4Element>();
  for (const r of refEntries) {
    nameToElement.set(r.element.name, r.element);
  }

  // Build compound dagre graph: infra nodes as parents, container refs as leaf nodes
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setDefaultEdgeLabel(() => ({}));

  // Add virtual parent nodes for each infra node
  for (const [infraId] of infraIds) {
    g.setNode(infraId, {});
    const parentId = infraParents.get(infraId);
    if (parentId) g.setParent(infraId, parentId);
  }

  // Add container ref nodes
  for (const r of refEntries) {
    const dims = computeC4NodeDimensions(r.element, { showTechnology: true });
    g.setNode(r.element.name, { width: dims.width, height: dims.height });
    g.setParent(r.element.name, r.infraId);
  }

  // Collect relationships between referenced containers
  interface DeployRel {
    sourceName: string;
    targetName: string;
    label?: string;
    technology?: string;
    arrowType: C4ArrowType;
    lineNumber: number;
  }
  const deployRels: DeployRel[] = [];
  const seenEdgeKeys = new Set<string>();

  for (const r of refEntries) {
    for (const rel of r.element.relationships) {
      if (refNames.has(rel.target.toLowerCase())) {
        const key = `${r.element.name}\u2192${rel.target}`;
        if (!seenEdgeKeys.has(key)) {
          seenEdgeKeys.add(key);
          deployRels.push({
            sourceName: r.element.name,
            targetName: rel.target,
            label: rel.label,
            technology: rel.technology,
            arrowType: rel.arrowType,
            lineNumber: rel.lineNumber,
          });
        }
      }
    }
  }

  // Adaptive spacing and graph config
  const spacing = computeAdaptiveSpacing(deployRels);
  g.setGraph({
    rankdir: 'TB',
    nodesep: spacing.nodesep,
    ranksep: spacing.ranksep,
    edgesep: spacing.edgesep,
  });

  // Add edges to dagre
  for (const rel of deployRels) {
    if (nameToElement.has(rel.sourceName) && nameToElement.has(rel.targetName)) {
      g.setEdge(rel.sourceName, rel.targetName, { label: rel.label ?? '' });
    }
  }

  // Run layout
  dagre.layout(g);

  // Post-dagre crossing reduction
  const nodeInfraMap = new Map<string, string>();
  for (const r of refEntries) nodeInfraMap.set(r.element.name, r.infraId);
  reduceCrossings(
    g,
    deployRels
      .filter((r) => nameToElement.has(r.sourceName) && nameToElement.has(r.targetName))
      .map((r) => ({ source: r.sourceName, target: r.targetName })),
    nodeInfraMap,
  );

  // Extract positioned nodes
  const nodes: C4LayoutNode[] = [];
  for (const r of refEntries) {
    const pos = g.node(r.element.name);
    const color = resolveNodeColor(r.element, parsed.tagGroups, activeTagGroup ?? null);
    const tech = r.element.metadata['tech'] ?? r.element.metadata['technology'];
    nodes.push({
      id: r.element.name,
      name: r.element.name,
      type: 'container',
      description: r.element.metadata['description'],
      metadata: r.element.metadata,
      lineNumber: r.element.lineNumber,
      color,
      shape: r.element.shape,
      technology: tech,
      x: pos.x,
      y: pos.y,
      width: pos.width,
      height: pos.height,
    });
  }

  // Extract edges
  const edges: C4LayoutEdge[] = deployRels
    .filter((rel) => nameToElement.has(rel.sourceName) && nameToElement.has(rel.targetName))
    .map((rel) => {
      const edgeData = g.edge(rel.sourceName, rel.targetName);
      return {
        source: rel.sourceName,
        target: rel.targetName,
        arrowType: rel.arrowType,
        label: rel.label,
        technology: rel.technology,
        lineNumber: rel.lineNumber,
        points: edgeData?.points ?? [],
      };
    });

  // Compute infrastructure boundary boxes from member node positions
  const groupBoundaries: C4LayoutBoundary[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.name, n]));

  // Collect members for each infra node (containers directly inside it)
  const infraMembers = new Map<string, C4LayoutNode[]>();
  for (const r of refEntries) {
    const members = infraMembers.get(r.infraId) ?? [];
    const node = nodeMap.get(r.element.name);
    if (node) members.push(node);
    infraMembers.set(r.infraId, members);
  }

  // Compute boundaries bottom-up: leaf infra nodes first, then parents.
  const infraBounds = new Map<string, { x: number; y: number; width: number; height: number }>();

  function computeInfraBounds(infraId: string): { x: number; y: number; width: number; height: number } | null {
    if (infraBounds.has(infraId)) return infraBounds.get(infraId)!;

    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    let hasContent = false;

    // Direct container ref members
    const members = infraMembers.get(infraId) ?? [];
    for (const m of members) {
      hasContent = true;
      const left = m.x - m.width / 2;
      const top = m.y - m.height / 2;
      const right = m.x + m.width / 2;
      const bottom = m.y + m.height / 2;
      if (left < bMinX) bMinX = left;
      if (top < bMinY) bMinY = top;
      if (right > bMaxX) bMaxX = right;
      if (bottom > bMaxY) bMaxY = bottom;
    }

    // Child infra node boundaries
    for (const [childId, parentId] of infraParents) {
      if (parentId === infraId) {
        const childBounds = computeInfraBounds(childId);
        if (childBounds) {
          hasContent = true;
          if (childBounds.x < bMinX) bMinX = childBounds.x;
          if (childBounds.y < bMinY) bMinY = childBounds.y;
          if (childBounds.x + childBounds.width > bMaxX) bMaxX = childBounds.x + childBounds.width;
          if (childBounds.y + childBounds.height > bMaxY) bMaxY = childBounds.y + childBounds.height;
        }
      }
    }

    if (!hasContent) return null;

    const bounds = {
      x: bMinX - BOUNDARY_PAD,
      y: bMinY - BOUNDARY_PAD,
      width: (bMaxX - bMinX) + BOUNDARY_PAD * 2,
      height: (bMaxY - bMinY) + BOUNDARY_PAD * 2,
    };
    infraBounds.set(infraId, bounds);
    return bounds;
  }

  // Process all infra nodes (recursion handles ordering)
  for (const [infraId, node] of infraIds) {
    const bounds = computeInfraBounds(infraId);
    if (bounds) {
      const shapeLabel = node.shape !== 'default' ? node.shape : 'node';
      groupBoundaries.push({
        label: node.name,
        typeLabel: shapeLabel,
        lineNumber: node.lineNumber,
        ...bounds,
      });
    }
  }

  // Sort boundaries so outermost (largest area) are first — rendered bottom to top
  groupBoundaries.sort((a, b) => (b.width * b.height) - (a.width * a.height));

  // Compute total bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const left = node.x - node.width / 2;
    const top = node.y - node.height / 2;
    const right = node.x + node.width / 2;
    const bottom = node.y + node.height / 2;
    if (left < minX) minX = left;
    if (top < minY) minY = top;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }
  for (const gb of groupBoundaries) {
    if (gb.x < minX) minX = gb.x;
    if (gb.y < minY) minY = gb.y;
    if (gb.x + gb.width > maxX) maxX = gb.x + gb.width;
    if (gb.y + gb.height > maxY) maxY = gb.y + gb.height;
  }
  for (const edge of edges) {
    for (const pt of edge.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  // Shift everything so content starts at (MARGIN, MARGIN)
  const shiftX = MARGIN - minX;
  const shiftY = MARGIN - minY;
  for (const node of nodes) {
    node.x += shiftX;
    node.y += shiftY;
  }
  for (const gb of groupBoundaries) {
    gb.x += shiftX;
    gb.y += shiftY;
  }
  for (const edge of edges) {
    for (const pt of edge.points) {
      pt.x += shiftX;
      pt.y += shiftY;
    }
  }

  let totalWidth = maxX - minX + MARGIN * 2;
  let totalHeight = maxY - minY + MARGIN * 2;

  const legendGroups = computeLegendGroups(parsed.tagGroups);

  if (legendGroups.length > 0) {
    const legendY = totalHeight + MARGIN;
    let legendX = MARGIN;
    for (const lg of legendGroups) {
      lg.x = legendX;
      lg.y = legendY;
      legendX += lg.width + 12;
    }
    const legendRight = legendX;
    const legendBottom = legendY + LEGEND_HEIGHT;
    if (legendRight > totalWidth) totalWidth = legendRight;
    if (legendBottom > totalHeight) totalHeight = legendBottom;
  }

  return { nodes, edges, legend: legendGroups, groupBoundaries, width: totalWidth, height: totalHeight };
}
