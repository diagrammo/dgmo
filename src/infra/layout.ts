// ============================================================
// Infra Chart Layout Engine
// ============================================================
//
// Uses dagre for LR/TB DAG layout. Groups are implemented as
// post-layout bounding box wrappers around their children.

import dagre from '@dagrejs/dagre';
import type { ComputedInfraModel, ComputedInfraNode } from './types';

// ============================================================
// Layout types
// ============================================================

export interface InfraLayoutNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  computedRps: number;
  overloaded: boolean;
  rateLimited: boolean;
  isEdge: boolean;
  groupId: string | null;
  computedLatencyMs: number;
  computedLatencyPercentiles: ComputedInfraNode['computedLatencyPercentiles'];
  computedUptime: number;
  computedAvailability: number;
  computedAvailabilityPercentiles: ComputedInfraNode['computedAvailabilityPercentiles'];
  computedInstances: number;
  computedConcurrentInvocations: number;
  computedCbState: ComputedInfraNode['computedCbState'];
  childHealthState?: ComputedInfraNode['childHealthState'];
  properties: ComputedInfraNode['properties'];
  queueMetrics?: ComputedInfraNode['queueMetrics'];
  tags: Record<string, string>;
  description?: string[];
  lineNumber: number;
}

export interface InfraLayoutEdge {
  sourceId: string;
  targetId: string;
  label: string;
  async: boolean;
  computedRps: number;
  split: number;
  fanout: number | null;
  points: { x: number; y: number }[];
  lineNumber: number;
}

export interface InfraLayoutGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  instances?: number | string;
  lineNumber: number;
}

export interface InfraLayoutResult {
  nodes: InfraLayoutNode[];
  edges: InfraLayoutEdge[];
  groups: InfraLayoutGroup[];
  /** Diagram-level options (e.g., default-latency-ms, default-uptime). */
  options: Record<string, string>;
  direction: 'LR' | 'TB';
  width: number;
  height: number;
}

// ============================================================
// Sizing constants
// ============================================================

const MIN_NODE_WIDTH = 140;
const NODE_HEADER_HEIGHT = 28;
const META_LINE_HEIGHT = 14;
const NODE_SEPARATOR_GAP = 4;
const NODE_PAD_BOTTOM = 10;
const ROLE_DOT_ROW = 12;
const COLLAPSE_BAR_HEIGHT = 6;
const CHAR_WIDTH = 7;
const META_CHAR_WIDTH = 6;
const PADDING_X = 24;
const GROUP_PADDING = 20;
const GROUP_HEADER_HEIGHT = 24;
const EDGE_MARGIN = 60;

// ============================================================
// Node sizing
// ============================================================

/** Display property keys shown as key: value rows. */
const DISPLAY_KEYS = new Set([
  'cache-hit',
  'firewall-block',
  'ratelimit-rps',
  'latency-ms',
  'uptime',
  'instances',
  'max-rps',
  'cb-error-threshold',
  'cb-latency-threshold-ms',
  'concurrency',
  'duration-ms',
  'cold-start-ms',
  'buffer',
  'drain-rate',
  'retention-hours',
  'partitions',
]);

/** Display names for width estimation. */
const DISPLAY_NAMES: Record<string, string> = {
  'cache-hit': 'cache hit',
  'firewall-block': 'firewall block',
  'ratelimit-rps': 'rate limit RPS',
  'latency-ms': 'latency',
  uptime: 'uptime',
  instances: 'instances',
  'max-rps': 'max RPS',
  'cb-error-threshold': 'CB error threshold',
  'cb-latency-threshold-ms': 'CB latency threshold',
  concurrency: 'concurrency',
  'duration-ms': 'duration',
  'cold-start-ms': 'cold start',
  buffer: 'buffer',
  'drain-rate': 'drain rate',
  'retention-hours': 'retention',
  partitions: 'partitions',
};

function countDisplayProps(
  node: ComputedInfraNode,
  expanded: boolean,
  options?: Record<string, string>
): number {
  // Declared properties are only shown when the node is selected (expanded)
  if (!expanded) return 0;
  let count = node.properties.filter((p) => DISPLAY_KEYS.has(p.key)).length;
  // Count diagram-level default rows for properties the node doesn't explicitly declare
  if (options) {
    const hasLatency = node.properties.some((p) => p.key === 'latency-ms');
    const hasUptime = node.properties.some((p) => p.key === 'uptime');
    const isServerless = node.properties.some((p) => p.key === 'concurrency');
    const defaultLatency = parseFloat(options['default-latency-ms'] ?? '') || 0;
    const defaultUptime = parseFloat(options['default-uptime'] ?? '') || 0;
    if (!hasLatency && !isServerless && defaultLatency > 0) count++;
    if (!hasUptime && defaultUptime > 0 && defaultUptime < 100) count++;
  }
  return count;
}

/** Count computed rows shown below declared props. When expanded, shows p50/p90/p99; otherwise just p90. */
function countComputedRows(node: ComputedInfraNode, expanded: boolean): number {
  let count = 0;
  // Serverless instances row
  if (node.computedConcurrentInvocations > 0) count += 1;
  const p = node.computedLatencyPercentiles;
  if (p.p50 > 0 || p.p90 > 0 || p.p99 > 0) count += expanded ? 3 : 1; // all percentiles or just p90
  if (node.computedUptime < 1) {
    const declaredUptime = node.properties.find((p) => p.key === 'uptime');
    const declaredVal = declaredUptime ? Number(declaredUptime.value) / 100 : 1;
    const differs = Math.abs(node.computedUptime - declaredVal) > 0.000001;
    if (differs || node.isEdge) count += 1;
  }
  if (node.computedAvailability < 1) count += 1;
  // CB state row when circuit breaker is open
  if (node.computedCbState === 'open') count += 1;
  // Queue computed rows: lag + overflow
  if (node.queueMetrics) {
    if (node.queueMetrics.fillRate > 0) count += 1; // lag row
    if (
      node.queueMetrics.fillRate > 0 &&
      node.queueMetrics.timeToOverflow < Infinity
    )
      count += 1; // overflow row
  }
  return count;
}

function hasRoles(node: ComputedInfraNode): boolean {
  if (node.isEdge) return false;
  return node.properties.some((p) => DISPLAY_KEYS.has(p.key));
}

function computeNodeWidth(
  node: ComputedInfraNode,
  expanded: boolean,
  options?: Record<string, string>
): number {
  // Account for badge text (e.g., "3x") in header width — serverless nodes no longer show a badge
  const badgeVal =
    node.computedConcurrentInvocations === 0 && node.computedInstances > 1
      ? node.computedInstances
      : 0;
  const badgeLen = badgeVal > 0 ? `${badgeVal}x`.length + 2 : 0;
  const labelWidth = (node.label.length + badgeLen) * CHAR_WIDTH + PADDING_X;

  // Collect all key names (including "RPS" and computed rows) to compute aligned value column
  const allKeys: string[] = [];
  if (node.computedRps > 0) allKeys.push('RPS');
  // Declared property keys only included when expanded
  if (expanded) {
    for (const p of node.properties) {
      const dk = DISPLAY_NAMES[p.key];
      if (dk) allKeys.push(dk);
    }
    // Default property keys
    if (options) {
      const hasLatency = node.properties.some((p) => p.key === 'latency-ms');
      const hasUptime = node.properties.some((p) => p.key === 'uptime');
      const isServerless = node.properties.some((p) => p.key === 'concurrency');
      if (
        !hasLatency &&
        !isServerless &&
        (parseFloat(options['default-latency-ms'] ?? '') || 0) > 0
      )
        allKeys.push('latency');
      if (
        !hasUptime &&
        (parseFloat(options['default-uptime'] ?? '') || 0) > 0 &&
        parseFloat(options['default-uptime'] ?? '') < 100
      )
        allKeys.push('uptime');
    }
  }
  // Computed rows
  const computedRows = countComputedRows(node, expanded);
  if (computedRows > 0) {
    if (node.computedConcurrentInvocations > 0) allKeys.push('instances');
    const perc = node.computedLatencyPercentiles;
    if (perc.p50 > 0 || perc.p90 > 0 || perc.p99 > 0) {
      if (expanded) {
        allKeys.push('p50', 'p90', 'p99');
      } else {
        allKeys.push('p90');
      }
    }
    if (node.computedUptime < 1) {
      const declaredUptime = node.properties.find((p) => p.key === 'uptime');
      const declaredVal = declaredUptime
        ? Number(declaredUptime.value) / 100
        : 1;
      if (
        Math.abs(node.computedUptime - declaredVal) > 0.000001 ||
        node.isEdge
      ) {
        allKeys.push('eff. uptime');
      }
    }
    if (node.computedAvailability < 1) allKeys.push('availability');
    if (node.computedCbState === 'open') allKeys.push('CB');
    if (node.queueMetrics) {
      if (node.queueMetrics.fillRate > 0) allKeys.push('lag');
      if (
        node.queueMetrics.fillRate > 0 &&
        node.queueMetrics.timeToOverflow < Infinity
      )
        allKeys.push('overflow');
    }
  }
  if (allKeys.length === 0) return Math.max(MIN_NODE_WIDTH, labelWidth);

  const maxKeyLen = Math.max(...allKeys.map((k) => k.length));
  // key + ": " + value
  let maxRowWidth = 0;
  if (node.computedRps > 0) {
    // RPS row may show "29.3k / 50k" when an effective cap exists
    const nodeMaxRps = getNumProp(node, 'max-rps', 0);
    const nodeRateLimit = getNumProp(node, 'ratelimit-rps', 0);
    const nodeConcurrency = getNumProp(node, 'concurrency', 0);
    const nodeDurationMs = getNumProp(node, 'duration-ms', 100);
    const serverlessCap =
      nodeConcurrency > 0 ? nodeConcurrency / (nodeDurationMs / 1000) : 0;
    const effectiveCap =
      serverlessCap > 0
        ? serverlessCap
        : nodeMaxRps > 0 && nodeRateLimit > 0
          ? Math.min(nodeMaxRps * node.computedInstances, nodeRateLimit)
          : nodeMaxRps > 0
            ? nodeMaxRps * node.computedInstances
            : nodeRateLimit > 0
              ? nodeRateLimit
              : 0;
    const rpsVal =
      effectiveCap > 0 && !node.isEdge
        ? `${formatRpsShort(node.computedRps)} / ${formatRpsShort(effectiveCap)}`
        : formatRps(node.computedRps);
    maxRowWidth = Math.max(
      maxRowWidth,
      (maxKeyLen + 2 + rpsVal.length) * META_CHAR_WIDTH
    );
  }
  // Declared property value widths only when expanded
  if (expanded) {
    for (const p of node.properties) {
      const dk = DISPLAY_NAMES[p.key];
      if (!dk) continue;
      const numVal =
        typeof p.value === 'number'
          ? p.value
          : parseFloat(String(p.value)) || 0;
      const PCT_KEYS = [
        'cache-hit',
        'firewall-block',
        'uptime',
        'cb-error-threshold',
      ];
      const valLen =
        p.key === 'max-rps' || p.key === 'ratelimit-rps'
          ? formatRpsShort(numVal).length
          : p.key === 'latency-ms' ||
              p.key === 'cb-latency-threshold-ms' ||
              p.key === 'duration-ms' ||
              p.key === 'cold-start-ms'
            ? formatMs(numVal).length
            : PCT_KEYS.includes(p.key)
              ? `${numVal}%`.length
              : String(p.value).length;
      maxRowWidth = Math.max(
        maxRowWidth,
        (maxKeyLen + 2 + valLen) * META_CHAR_WIDTH
      );
    }
  }
  // Computed row widths (e.g., "p90: 520ms" or "p90: 520ms / 500ms" when SLO configured)
  if (computedRows > 0) {
    const perc = node.computedLatencyPercentiles;
    const msValues = expanded ? [perc.p50, perc.p90, perc.p99] : [perc.p90];
    for (const ms of msValues) {
      if (ms > 0) {
        const valLen = formatMs(ms).length;
        maxRowWidth = Math.max(
          maxRowWidth,
          (maxKeyLen + 2 + valLen) * META_CHAR_WIDTH
        );
      }
    }
    // p90 may show "<current> / <threshold>" when non-green. Always reserve combined width
    // so node width doesn't reflow when SLO state transitions from green to warning/overloaded.
    if (perc.p90 > 0) {
      const rawThreshold =
        node.properties.find((p) => p.key === 'slo-p90-latency-ms')?.value ??
        options?.['slo-p90-latency-ms'];
      const threshold =
        rawThreshold != null ? parseFloat(String(rawThreshold)) : NaN;
      if (!isNaN(threshold) && threshold > 0) {
        // formatMs here must produce the same string as formatMsShort in renderer.ts — both are identical.
        // If either changes, the reserved width and the rendered text will diverge.
        const combinedVal = `${formatMs(perc.p90)} / ${formatMs(threshold)}`;
        maxRowWidth = Math.max(
          maxRowWidth,
          (maxKeyLen + 2 + combinedVal.length) * META_CHAR_WIDTH
        );
      }
    }
    if (node.computedUptime < 1) {
      const valLen = formatUptime(node.computedUptime).length;
      maxRowWidth = Math.max(
        maxRowWidth,
        (maxKeyLen + 2 + valLen) * META_CHAR_WIDTH
      );
    }
    if (node.computedAvailability < 1) {
      const valLen = formatUptime(node.computedAvailability).length;
      maxRowWidth = Math.max(
        maxRowWidth,
        (maxKeyLen + 2 + valLen) * META_CHAR_WIDTH
      );
    }
    // CB state row ("CB: OPEN") — inverted pill, use full text width
    if (node.computedCbState === 'open') {
      maxRowWidth = Math.max(
        maxRowWidth,
        'CB: OPEN'.length * META_CHAR_WIDTH + 8
      );
    }
  }

  const DESC_MAX_CHARS = 120;
  const descLines =
    expanded && node.description && !node.isEdge ? node.description : [];
  let descWidth = 0;
  for (const dl of descLines) {
    const truncated =
      dl.length > DESC_MAX_CHARS ? dl.slice(0, DESC_MAX_CHARS - 1) + '…' : dl;
    descWidth = Math.max(
      descWidth,
      truncated.length * META_CHAR_WIDTH + PADDING_X
    );
  }
  return Math.max(MIN_NODE_WIDTH, labelWidth, maxRowWidth + 20, descWidth);
}

function computeNodeHeight(
  node: ComputedInfraNode,
  expanded: boolean,
  options?: Record<string, string>
): number {
  const propCount = countDisplayProps(node, expanded, options);
  const computedCount = countComputedRows(node, expanded);
  const hasRps = node.computedRps > 0;
  const descLineCount =
    expanded && node.description && !node.isEdge ? node.description.length : 0;
  const descH = descLineCount * META_LINE_HEIGHT;
  if (propCount === 0 && computedCount === 0 && !hasRps)
    return NODE_HEADER_HEIGHT + descH + NODE_PAD_BOTTOM;

  let h = NODE_HEADER_HEIGHT + descH + NODE_SEPARATOR_GAP;
  // Computed section: RPS + computed rows
  const computedSectionCount = (hasRps ? 1 : 0) + computedCount;
  h += computedSectionCount * META_LINE_HEIGHT;
  // Separator between computed and declared sections
  if (computedSectionCount > 0 && propCount > 0) h += NODE_SEPARATOR_GAP;
  // Declared property rows
  h += propCount * META_LINE_HEIGHT;
  // Role dots row
  if (hasRoles(node)) h += ROLE_DOT_ROW;
  h += NODE_PAD_BOTTOM;
  // Collapsed group nodes have a collapse bar at the bottom — add space so dots aren't obscured
  if (node.id.startsWith('[')) h += COLLAPSE_BAR_HEIGHT;
  return h;
}

function formatRps(rps: number): string {
  if (rps >= 1000) return `${(rps / 1000).toFixed(1)}k rps`;
  return `${Math.round(rps)} rps`;
}

function formatRpsShort(rps: number): string {
  if (rps >= 1000) return `${(rps / 1000).toFixed(1)}k`;
  return `${Math.round(rps)}`;
}

function getNumProp(
  node: ComputedInfraNode,
  key: string,
  fallback: number
): number {
  const p = node.properties.find((pr) => pr.key === key);
  if (!p) return fallback;
  return typeof p.value === 'number'
    ? p.value
    : parseFloat(String(p.value)) || fallback;
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatUptime(fraction: number): string {
  const pct = fraction * 100;
  if (pct >= 99.99) return '99.99%';
  if (pct >= 99.9) return `${pct.toFixed(2)}%`;
  if (pct >= 99) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(1)}%`;
}

// ============================================================
// Group separation pass
// ============================================================

const GROUP_GAP = GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT; // min clear gap between group boxes

export function separateGroups(
  groups: InfraLayoutGroup[],
  nodes: InfraLayoutNode[],
  isLR: boolean,
  maxIterations = 20
): Map<string, { dx: number; dy: number }> {
  // Symmetric 2D rectangle intersection — no sorting needed, handles all
  // relative positions correctly, stable after mid-pass shifts.
  // Endpoint edge routing is not affected: renderer.ts recomputes border
  // connection points from node x/y at render time via nodeBorderPoint().
  const groupDeltas = new Map<string, { dx: number; dy: number }>();
  let converged = false;
  for (let iter = 0; iter < maxIterations; iter++) {
    let anyOverlap = false;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        // In-bounds by loop guard.
        const ga = groups[i]!;
        const gb = groups[j]!;

        // Symmetric primary-axis overlap (Y for LR, X for TB)
        const primaryOverlap = isLR
          ? Math.min(ga.y + ga.height, gb.y + gb.height) - Math.max(ga.y, gb.y)
          : Math.min(ga.x + ga.width, gb.x + gb.width) - Math.max(ga.x, gb.x);
        if (primaryOverlap <= 0) continue;

        // Symmetric cross-axis overlap — boxes must intersect in 2D
        const crossOverlap = isLR
          ? Math.min(ga.x + ga.width, gb.x + gb.width) - Math.max(ga.x, gb.x)
          : Math.min(ga.y + ga.height, gb.y + gb.height) - Math.max(ga.y, gb.y);
        if (crossOverlap <= 0) continue;

        anyOverlap = true;
        const shift = primaryOverlap + GROUP_GAP;

        // Shift the group with the larger primary-axis center (deterministic)
        const aCenter = isLR ? ga.y + ga.height / 2 : ga.x + ga.width / 2;
        const bCenter = isLR ? gb.y + gb.height / 2 : gb.x + gb.width / 2;
        const groupToShift = aCenter <= bCenter ? gb : ga;

        if (isLR) groupToShift.y += shift;
        else groupToShift.x += shift;

        // Accumulate the total delta for this group (used by fixEdgeWaypoints)
        const prev = groupDeltas.get(groupToShift.id) ?? { dx: 0, dy: 0 };
        if (isLR)
          groupDeltas.set(groupToShift.id, {
            dx: prev.dx,
            dy: prev.dy + shift,
          });
        else
          groupDeltas.set(groupToShift.id, {
            dx: prev.dx + shift,
            dy: prev.dy,
          });

        for (const node of nodes) {
          if (node.groupId === groupToShift.id) {
            if (isLR) node.y += shift;
            else node.x += shift;
          }
        }
      }
    }
    if (!anyOverlap) {
      converged = true;
      break;
    }
  }
  if (!converged && maxIterations > 0) {
    console.warn(
      `separateGroups: hit maxIterations (${maxIterations}) without fully resolving all group overlaps`
    );
  }
  return groupDeltas;
}

export function fixEdgeWaypoints(
  edges: InfraLayoutEdge[],
  nodes: InfraLayoutNode[],
  groupDeltas: Map<string, { dx: number; dy: number }>
): void {
  if (groupDeltas.size === 0) return;
  const nodeToGroup = new Map<string, string | null>();
  for (const node of nodes) nodeToGroup.set(node.id, node.groupId);

  for (const edge of edges) {
    const srcGroup = nodeToGroup.get(edge.sourceId) ?? null;
    // Group-targeting edges (targetId is a group ID, not a node) return undefined from the map → null →
    // treated as "ungrouped target", which is the correct approximation.
    const tgtGroup = nodeToGroup.get(edge.targetId) ?? null;
    const srcDelta = srcGroup ? groupDeltas.get(srcGroup) : undefined;
    const tgtDelta = tgtGroup ? groupDeltas.get(tgtGroup) : undefined;

    if (!srcDelta && !tgtDelta) continue; // neither side shifted

    if (srcDelta && tgtDelta && srcGroup !== tgtGroup) {
      // both sides in different shifted groups — discard, renderer draws a straight line
      edge.points = [];
      continue;
    }

    const delta = srcDelta ?? tgtDelta!;
    for (const pt of edge.points) {
      pt.x += delta.dx;
      pt.y += delta.dy;
    }
  }
}

// ============================================================
// Layout engine
// ============================================================

export function layoutInfra(
  computed: ComputedInfraModel,
  expandedNodeIds?: Set<string> | null,
  collapsedNodes?: Set<string> | null
): InfraLayoutResult {
  if (computed.nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      groups: [],
      options: {},
      direction: computed.direction,
      width: 0,
      height: 0,
    };
  }

  const isLR = computed.direction !== 'TB';
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: computed.direction === 'TB' ? 'TB' : 'LR',
    nodesep: isLR ? 70 : 60,
    ranksep: isLR ? 150 : 120,
    edgesep: 30,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Build set of grouped node IDs for inflating dimensions
  const groupedNodeIds = new Set<string>();
  for (const node of computed.nodes) {
    if (node.groupId) groupedNodeIds.add(node.id);
  }

  // Extra space dagre must reserve for the group bounding box
  const GROUP_INFLATE = GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT;

  // Add nodes — inflate grouped nodes so dagre accounts for group boxes
  const widthMap = new Map<string, number>();
  const heightMap = new Map<string, number>();
  for (const node of computed.nodes) {
    const isNodeCollapsed = collapsedNodes?.has(node.id) ?? false;
    const expanded =
      !isNodeCollapsed && (expandedNodeIds?.has(node.id) ?? false);
    const width = computeNodeWidth(node, expanded, computed.options);
    const height = isNodeCollapsed
      ? NODE_HEADER_HEIGHT + NODE_PAD_BOTTOM
      : computeNodeHeight(node, expanded, computed.options);
    widthMap.set(node.id, width);
    heightMap.set(node.id, height);
    const inGroup = groupedNodeIds.has(node.id);
    g.setNode(node.id, {
      label: node.label,
      width: inGroup && !isLR ? width + GROUP_INFLATE : width,
      height: inGroup && isLR ? height + GROUP_INFLATE : height,
    });
  }

  // Add edges — skip edges targeting groups (resolve to children instead)
  const groupChildIds = new Set<string>();
  for (const node of computed.nodes) {
    if (node.groupId) groupChildIds.add(node.id);
  }

  // Build group child lookup
  const groupChildren = new Map<string, string[]>();
  for (const node of computed.nodes) {
    if (node.groupId) {
      const list = groupChildren.get(node.groupId) ?? [];
      list.push(node.id);
      groupChildren.set(node.groupId, list);
    }
  }

  for (const edge of computed.edges) {
    // If target is a group, add edges to all children of that group
    const children = groupChildren.get(edge.targetId);
    if (children && children.length > 0) {
      for (const childId of children) {
        g.setEdge(edge.sourceId, childId, { label: edge.label });
      }
    } else {
      g.setEdge(edge.sourceId, edge.targetId, { label: edge.label });
    }
  }

  // Run layout
  dagre.layout(g);

  // Extract positioned nodes
  const layoutNodes: InfraLayoutNode[] = computed.nodes.map(
    (node): InfraLayoutNode => {
      const pos = g.node(node.id);
      return {
        id: node.id,
        label: node.label,
        x: pos.x,
        y: pos.y,
        width: widthMap.get(node.id) ?? MIN_NODE_WIDTH,
        height: heightMap.get(node.id) ?? NODE_HEADER_HEIGHT + NODE_PAD_BOTTOM,
        computedRps: node.computedRps,
        overloaded: node.overloaded,
        rateLimited: node.rateLimited,
        isEdge: node.isEdge,
        groupId: node.groupId,
        computedLatencyMs: node.computedLatencyMs,
        computedLatencyPercentiles: node.computedLatencyPercentiles,
        computedUptime: node.computedUptime,
        computedAvailability: node.computedAvailability,
        computedAvailabilityPercentiles: node.computedAvailabilityPercentiles,
        computedInstances: node.computedInstances,
        computedConcurrentInvocations: node.computedConcurrentInvocations,
        computedCbState: node.computedCbState,
        ...(node.childHealthState !== undefined && {
          childHealthState: node.childHealthState,
        }),
        ...(node.queueMetrics !== undefined && {
          queueMetrics: node.queueMetrics,
        }),
        properties: node.properties,
        tags: node.tags,
        ...(node.description !== undefined && {
          description: node.description,
        }),
        lineNumber: node.lineNumber,
      };
    }
  );

  // Extract edge waypoints
  const layoutEdges: InfraLayoutEdge[] = [];
  for (const edge of computed.edges) {
    const children = groupChildren.get(edge.targetId);
    if (children && children.length > 0) {
      // Use the first child's edge points as representative
      // In-bounds: children.length > 0 guarded above.
      const edgeData = g.edge(edge.sourceId, children[0]!);
      layoutEdges.push({
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        label: edge.label,
        async: edge.async,
        computedRps: edge.computedRps,
        split: edge.split,
        fanout: edge.fanout,
        points: edgeData?.points ?? [],
        lineNumber: edge.lineNumber,
      });
    } else {
      const edgeData = g.edge(edge.sourceId, edge.targetId);
      layoutEdges.push({
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        label: edge.label,
        async: edge.async,
        computedRps: edge.computedRps,
        split: edge.split,
        fanout: edge.fanout,
        points: edgeData?.points ?? [],
        lineNumber: edge.lineNumber,
      });
    }
  }

  // Compute group bounding boxes from children
  const layoutGroups: InfraLayoutGroup[] = computed.groups.map(
    (group): InfraLayoutGroup => {
      const childNodes = layoutNodes.filter((n) => n.groupId === group.id);
      if (childNodes.length === 0) {
        return {
          id: group.id,
          label: group.label,
          x: 0,
          y: 0,
          width: MIN_NODE_WIDTH,
          height: NODE_HEADER_HEIGHT + NODE_PAD_BOTTOM,
          ...(group.instances !== undefined && { instances: group.instances }),
          lineNumber: group.lineNumber,
        };
      }
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const child of childNodes) {
        const left = child.x - child.width / 2;
        const right = child.x + child.width / 2;
        const top = child.y - child.height / 2;
        const bottom = child.y + child.height / 2;
        if (left < minX) minX = left;
        if (right > maxX) maxX = right;
        if (top < minY) minY = top;
        if (bottom > maxY) maxY = bottom;
      }
      return {
        id: group.id,
        label: group.label,
        x: minX - GROUP_PADDING,
        y: minY - GROUP_PADDING - GROUP_HEADER_HEIGHT,
        width: maxX - minX + GROUP_PADDING * 2,
        height: maxY - minY + GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT,
        ...(group.instances !== undefined && { instances: group.instances }),
        lineNumber: group.lineNumber,
      };
    }
  );

  // Separate overlapping groups (post-layout pass) and fix stale edge waypoints
  const groupDeltas = separateGroups(layoutGroups, layoutNodes, isLR);
  fixEdgeWaypoints(layoutEdges, layoutNodes, groupDeltas);

  // Compute total dimensions
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const node of layoutNodes) {
    const left = node.x - node.width / 2;
    const right = node.x + node.width / 2;
    const top = node.y - node.height / 2;
    const bottom = node.y + node.height / 2;
    if (left < minX) minX = left;
    if (right > maxX) maxX = right;
    if (top < minY) minY = top;
    if (bottom > maxY) maxY = bottom;
  }
  for (const group of layoutGroups) {
    if (group.x < minX) minX = group.x;
    if (group.x + group.width > maxX) maxX = group.x + group.width;
    if (group.y < minY) minY = group.y;
    if (group.y + group.height > maxY) maxY = group.y + group.height;
  }
  for (const edge of layoutEdges) {
    for (const pt of edge.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    // Account for edge label width at midpoint
    if (edge.label) {
      const midIdx = Math.floor(edge.points.length / 2);
      const midPt = edge.points[midIdx];
      if (midPt) {
        const halfWidth = (edge.label.length * 6.5 + 8) / 2;
        if (midPt.x - halfWidth < minX) minX = midPt.x - halfWidth;
        if (midPt.x + halfWidth > maxX) maxX = midPt.x + halfWidth;
      }
    }
  }

  // Shift everything to start at EDGE_MARGIN
  const shiftX = -minX + EDGE_MARGIN;
  const shiftY = -minY + EDGE_MARGIN;
  for (const node of layoutNodes) {
    node.x += shiftX;
    node.y += shiftY;
  }
  for (const edge of layoutEdges) {
    for (const pt of edge.points) {
      pt.x += shiftX;
      pt.y += shiftY;
    }
  }
  for (const group of layoutGroups) {
    group.x += shiftX;
    group.y += shiftY;
  }

  const totalWidth = maxX + shiftX + EDGE_MARGIN;
  const totalHeight = maxY + shiftY + EDGE_MARGIN;

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    groups: layoutGroups,
    options: computed.options,
    direction: computed.direction,
    width: totalWidth,
    height: totalHeight,
  };
}
