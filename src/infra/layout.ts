// ============================================================
// Infra Chart Layout Engine
// ============================================================
//
// Uses dagre for LR/TB DAG layout. Groups are implemented as
// post-layout bounding box wrappers around their children.

import dagre from '@dagrejs/dagre';
import type {
  ComputedInfraModel,
  ComputedInfraNode,
  ComputedInfraEdge,
  InfraGroup,
} from './types';

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
  isEdge: boolean;
  groupId: string | null;
  computedLatencyMs: number;
  computedLatencyPercentiles: ComputedInfraNode['computedLatencyPercentiles'];
  computedUptime: number;
  computedAvailability: number;
  computedAvailabilityPercentiles: ComputedInfraNode['computedAvailabilityPercentiles'];
  computedInstances: number;
  computedCbState: ComputedInfraNode['computedCbState'];
  childHealthState?: ComputedInfraNode['childHealthState'];
  properties: ComputedInfraNode['properties'];
  tags: Record<string, string>;
  lineNumber: number;
}

export interface InfraLayoutEdge {
  sourceId: string;
  targetId: string;
  label: string;
  computedRps: number;
  split: number;
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
  'cache-hit', 'firewall-block', 'bot-filter', 'ratelimit-rps',
  'latency-ms', 'uptime', 'instances', 'max-rps',
  'cb-error-threshold', 'cb-latency-threshold-ms',
]);

/** Display names for width estimation. */
const DISPLAY_NAMES: Record<string, string> = {
  'cache-hit': 'cache hit', 'firewall-block': 'fw block', 'bot-filter': 'bot filter',
  'ratelimit-rps': 'rate limit', 'latency-ms': 'latency', 'uptime': 'uptime',
  'instances': 'instances', 'max-rps': 'max rps',
  'cb-error-threshold': 'CB err %', 'cb-latency-threshold-ms': 'CB latency',
};

function countDisplayProps(node: ComputedInfraNode): number {
  return node.properties.filter((p) => DISPLAY_KEYS.has(p.key)).length;
}

/** Count computed rows shown below declared props. When expanded, shows p50/p90/p99; otherwise just p99. */
function countComputedRows(node: ComputedInfraNode, expanded: boolean): number {
  let count = 0;
  const p = node.computedLatencyPercentiles;
  if (p.p50 > 0 || p.p90 > 0 || p.p99 > 0) count += expanded ? 3 : 1; // all percentiles or just p99
  if (node.computedUptime < 1) count += 1;
  if (node.computedAvailability < 1) count += 1;
  return count;
}

function hasRoles(node: ComputedInfraNode): boolean {
  if (node.isEdge) return false;
  return node.properties.some((p) => DISPLAY_KEYS.has(p.key));
}

function computeNodeWidth(node: ComputedInfraNode, expanded: boolean): number {
  const labelWidth = node.label.length * CHAR_WIDTH + PADDING_X;

  // Collect all key names (including "RPS" and computed rows) to compute aligned value column
  const allKeys: string[] = [];
  if (node.computedRps > 0) allKeys.push('RPS');
  for (const p of node.properties) {
    const dk = DISPLAY_NAMES[p.key];
    if (dk) allKeys.push(dk);
  }
  // Computed rows
  const computedRows = countComputedRows(node, expanded);
  if (computedRows > 0) {
    const perc = node.computedLatencyPercentiles;
    if (perc.p50 > 0 || perc.p90 > 0 || perc.p99 > 0) {
      if (expanded) {
        allKeys.push('p50', 'p90', 'p99');
      } else {
        allKeys.push('p99');
      }
    }
    if (node.computedUptime < 1) allKeys.push('uptime');
    if (node.computedAvailability < 1) allKeys.push('avail');
  }
  if (allKeys.length === 0) return Math.max(MIN_NODE_WIDTH, labelWidth);

  const maxKeyLen = Math.max(...allKeys.map((k) => k.length));
  // key + ": " + value
  let maxRowWidth = 0;
  if (node.computedRps > 0) {
    const valLen = formatRps(node.computedRps).length;
    maxRowWidth = Math.max(maxRowWidth, (maxKeyLen + 2 + valLen) * META_CHAR_WIDTH);
  }
  for (const p of node.properties) {
    const dk = DISPLAY_NAMES[p.key];
    if (!dk) continue;
    const valLen = String(p.value).length;
    maxRowWidth = Math.max(maxRowWidth, (maxKeyLen + 2 + valLen) * META_CHAR_WIDTH);
  }
  // Computed row widths (e.g., "p99: 120ms")
  if (computedRows > 0) {
    const perc = node.computedLatencyPercentiles;
    const msValues = expanded ? [perc.p50, perc.p90, perc.p99] : [perc.p99];
    for (const ms of msValues) {
      if (ms > 0) {
        const valLen = formatMs(ms).length;
        maxRowWidth = Math.max(maxRowWidth, (maxKeyLen + 2 + valLen) * META_CHAR_WIDTH);
      }
    }
    if (node.computedUptime < 1) {
      const valLen = formatUptime(node.computedUptime).length;
      maxRowWidth = Math.max(maxRowWidth, (maxKeyLen + 2 + valLen) * META_CHAR_WIDTH);
    }
    if (node.computedAvailability < 1) {
      const valLen = formatUptime(node.computedAvailability).length;
      maxRowWidth = Math.max(maxRowWidth, (maxKeyLen + 2 + valLen) * META_CHAR_WIDTH);
    }
  }

  return Math.max(MIN_NODE_WIDTH, labelWidth, maxRowWidth + 20);
}

function computeNodeHeight(node: ComputedInfraNode, expanded: boolean): number {
  const propCount = countDisplayProps(node);
  const computedCount = countComputedRows(node, expanded);
  const hasRps = node.computedRps > 0;
  if (propCount === 0 && computedCount === 0 && !hasRps) return NODE_HEADER_HEIGHT + NODE_PAD_BOTTOM;

  let h = NODE_HEADER_HEIGHT + NODE_SEPARATOR_GAP;
  // RPS row
  if (hasRps) h += META_LINE_HEIGHT;
  // Key-value rows
  h += propCount * META_LINE_HEIGHT;
  // Computed rows (p50/p90/p99, uptime)
  h += computedCount * META_LINE_HEIGHT;
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
// Layout engine
// ============================================================

export function layoutInfra(computed: ComputedInfraModel, selectedNodeId?: string | null): InfraLayoutResult {
  if (computed.nodes.length === 0) {
    return { nodes: [], edges: [], groups: [], width: 0, height: 0 };
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: computed.direction === 'TB' ? 'TB' : 'LR',
    nodesep: 50,
    ranksep: 100,
    edgesep: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Build set of grouped node IDs for inflating dimensions
  const groupedNodeIds = new Set<string>();
  for (const node of computed.nodes) {
    if (node.groupId) groupedNodeIds.add(node.id);
  }

  // Extra space dagre must reserve for the group bounding box
  const GROUP_INFLATE = GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT;
  const isLR = computed.direction !== 'TB';

  // Add nodes — inflate grouped nodes so dagre accounts for group boxes
  const widthMap = new Map<string, number>();
  const heightMap = new Map<string, number>();
  for (const node of computed.nodes) {
    const expanded = node.id === selectedNodeId;
    const width = computeNodeWidth(node, expanded);
    const height = computeNodeHeight(node, expanded);
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
  const layoutNodes: InfraLayoutNode[] = computed.nodes.map((node) => {
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
      isEdge: node.isEdge,
      groupId: node.groupId,
      computedLatencyMs: node.computedLatencyMs,
      computedLatencyPercentiles: node.computedLatencyPercentiles,
      computedUptime: node.computedUptime,
      computedAvailability: node.computedAvailability,
      computedAvailabilityPercentiles: node.computedAvailabilityPercentiles,
      computedInstances: node.computedInstances,
      computedCbState: node.computedCbState,
      childHealthState: node.childHealthState,
      properties: node.properties,
      tags: node.tags,
      lineNumber: node.lineNumber,
    };
  });

  // Extract edge waypoints
  const layoutEdges: InfraLayoutEdge[] = [];
  for (const edge of computed.edges) {
    const children = groupChildren.get(edge.targetId);
    if (children && children.length > 0) {
      // Use the first child's edge points as representative
      const edgeData = g.edge(edge.sourceId, children[0]);
      layoutEdges.push({
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        label: edge.label,
        computedRps: edge.computedRps,
        split: edge.split,
        points: edgeData?.points ?? [],
        lineNumber: edge.lineNumber,
      });
    } else {
      const edgeData = g.edge(edge.sourceId, edge.targetId);
      layoutEdges.push({
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        label: edge.label,
        computedRps: edge.computedRps,
        split: edge.split,
        points: edgeData?.points ?? [],
        lineNumber: edge.lineNumber,
      });
    }
  }

  // Compute group bounding boxes from children
  const layoutGroups: InfraLayoutGroup[] = computed.groups.map((group) => {
    const childNodes = layoutNodes.filter((n) => n.groupId === group.id);
    if (childNodes.length === 0) {
      return {
        id: group.id,
        label: group.label,
        x: 0,
        y: 0,
        width: MIN_NODE_WIDTH,
        height: NODE_HEADER_HEIGHT + NODE_PAD_BOTTOM,
        instances: group.instances,
        lineNumber: group.lineNumber,
      };
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
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
      instances: group.instances,
      lineNumber: group.lineNumber,
    };
  });

  // Compute total dimensions
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
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

  const totalWidth = (maxX + shiftX) + EDGE_MARGIN;
  const totalHeight = (maxY + shiftY) + EDGE_MARGIN;

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    groups: layoutGroups,
    width: totalWidth,
    height: totalHeight,
  };
}
