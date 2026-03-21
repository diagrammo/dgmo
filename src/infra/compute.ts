// ============================================================
// Infra Chart Computation Engine
// ============================================================
//
// Pure function: computeInfra(parsed, params) → ComputedInfraModel
//
// Traverses the DAG from the edge entry point, computing downstream
// rps through behavior transformations (cache-hit, firewall-block,
// ratelimit-rps) and split distribution.

import type {
  ParsedInfra,
  InfraNode,
  InfraEdge,
  InfraComputeParams,
  ComputedInfraModel,
  ComputedInfraNode,
  ComputedInfraEdge,
  InfraDiagnostic,
  InfraCbState,
  InfraLatencyPercentiles,
  InfraAvailabilityPercentiles,
  InfraProperty,
} from './types';
// ============================================================
// Helpers
// ============================================================

/** Get a numeric property value from a node, or a default. */
function getNumProp(node: InfraNode, key: string, fallback: number): number {
  const prop = node.properties.find((p) => p.key === key);
  if (!prop) return fallback;
  if (typeof prop.value === 'number') return prop.value;
  // Try parsing string (e.g. "1-8" is not a simple number)
  const num = parseFloat(String(prop.value));
  return isNaN(num) ? fallback : num;
}

/** Parse instance range "N-M" → {min, max}, or fixed "N" → {min: N, max: N}. */
function getInstanceRange(node: InfraNode): { min: number; max: number } {
  const prop = node.properties.find((p) => p.key === 'instances');
  if (!prop) return { min: 1, max: 1 };
  if (typeof prop.value === 'number') return { min: prop.value, max: prop.value };
  const str = String(prop.value);
  const dash = str.indexOf('-');
  if (dash >= 0) {
    const min = parseInt(str.substring(0, dash), 10);
    const max = parseInt(str.substring(dash + 1), 10);
    return { min: isNaN(min) ? 1 : min, max: isNaN(max) ? min : max };
  }
  const num = parseInt(str, 10);
  return { min: isNaN(num) ? 1 : num, max: isNaN(num) ? 1 : num };
}

/** Check if a node is serverless (has concurrency property). */
function isServerless(node: InfraNode): boolean {
  return getNumProp(node, 'concurrency', 0) > 0;
}

/** Check if a node is a queue (has buffer property). */
function isQueue(node: InfraNode): boolean {
  return getNumProp(node, 'buffer', 0) > 0;
}

/** Compute serverless effective capacity: concurrency / (duration_ms / 1000). */
function serverlessCapacity(node: InfraNode): number {
  const concurrency = getNumProp(node, 'concurrency', 0);
  const durationMs = getNumProp(node, 'duration-ms', 100);
  return concurrency / (durationMs / 1000);
}

/** Compute dynamic instance count based on load and max-rps. */
function computeDynamicInstances(node: InfraNode, computedRps: number): number {
  const { min, max } = getInstanceRange(node);
  const maxRps = getNumProp(node, 'max-rps', 0);
  if (maxRps <= 0 || min === max) return min;
  const needed = Math.ceil(computedRps / maxRps);
  return Math.min(Math.max(needed, min), max);
}

/** Determine circuit breaker state from thresholds and current load. */
function computeCbState(node: InfraNode, computedRps: number, computedLatencyMs: number, instanceOverride?: number, groupMultiplier = 1): InfraCbState {
  const errorThreshold = getNumProp(node, 'cb-error-threshold', 0);
  const latencyThreshold = getNumProp(node, 'cb-latency-threshold-ms', 0);
  if (errorThreshold <= 0 && latencyThreshold <= 0) return 'closed';

  // Error-rate based: overloaded nodes have error rate proportional to excess
  let capacity: number;
  if (isServerless(node)) {
    capacity = serverlessCapacity(node);
  } else {
    const maxRps = getNumProp(node, 'max-rps', 0);
    const instances = instanceOverride ?? computeDynamicInstances(node, computedRps);
    capacity = maxRps > 0 ? maxRps * instances * groupMultiplier : 0;
  }

  if (errorThreshold > 0 && capacity > 0) {
    const errorRate = computedRps > capacity ? ((computedRps - capacity) / computedRps) * 100 : 0;
    if (errorRate >= errorThreshold) return 'open';
  }

  // Latency-based
  if (latencyThreshold > 0 && computedLatencyMs > latencyThreshold) return 'open';

  return 'closed';
}

/**
 * Compute local availability at a node (0-1).
 * Factors: uptime, overload shed (rps > capacity), rate-limit reject (rps > ratelimit).
 * Cache-hit and firewall-block are NOT availability reducers — they're
 * successful traffic reductions (cache serves, firewall correctly blocks).
 */
function computeLocalAvailability(node: InfraNode, inboundRps: number, instanceOverride?: number, groupMultiplier = 1, defaultUptime = 100): number {
  if (node.isEdge) return 1;

  let avail = 1;

  // Uptime factor
  const uptime = getNumProp(node, 'uptime', defaultUptime) / 100;
  avail *= uptime;

  // Queue nodes: availability = 1.0 when buffer has headroom, degrades on overflow
  // drain-rate scales with group instances (more consumers), buffer does NOT
  if (isQueue(node)) {
    const buffer = getNumProp(node, 'buffer', 0);
    const drainRate = getNumProp(node, 'drain-rate', 0) * groupMultiplier;
    if (drainRate > 0 && buffer > 0) {
      const fillRate = Math.max(0, inboundRps - drainRate);
      if (fillRate > 0) {
        const timeToOverflow = buffer / fillRate;
        // If overflow is imminent (< 60s sustained), availability degrades
        if (timeToOverflow < 60) {
          avail *= drainRate / inboundRps; // proportional to excess being dropped
        }
        // Otherwise buffer is absorbing — availability stays at 1.0
      }
    }
    return avail;
  }

  // Overload shed: if RPS exceeds total capacity, excess requests fail
  if (isServerless(node)) {
    const capacity = serverlessCapacity(node);
    if (capacity > 0 && inboundRps > capacity) {
      avail *= capacity / inboundRps;
    }
  } else {
    const maxRps = getNumProp(node, 'max-rps', 0);
    if (maxRps > 0 && inboundRps > 0) {
      const instances = instanceOverride ?? computeDynamicInstances(node, inboundRps);
      const capacity = maxRps * instances * groupMultiplier;
      if (inboundRps > capacity) {
        avail *= capacity / inboundRps;
      }
    }
  }

  // Rate-limit reject: requests above the rate limit are rejected
  // Pre-ratelimit RPS = after cache-hit, firewall-block but before ratelimit
  const rateLimit = getNumProp(node, 'ratelimit-rps', 0);
  if (rateLimit > 0 && inboundRps > 0) {
    let preRateLimitRps = inboundRps;
    const cacheHit = getNumProp(node, 'cache-hit', 0);
    if (cacheHit > 0) preRateLimitRps *= (100 - cacheHit) / 100;
    const fwBlock = getNumProp(node, 'firewall-block', 0);
    if (fwBlock > 0) preRateLimitRps *= (100 - fwBlock) / 100;

    if (preRateLimitRps > rateLimit) {
      avail *= rateLimit / preRateLimitRps;
    }
  }

  return avail;
}

/**
 * Compute the effective outbound rps after applying behavior transformations.
 * Each behavior reduces the traffic that flows downstream:
 * - cache-hit: N% → only (100 - N)% passes through
 * - firewall-block: N% → only (100 - N)% passes through
 * - ratelimit-rps: N → caps outbound at N rps
 */
function applyBehaviors(node: InfraNode, inboundRps: number, groupMultiplier = 1): number {
  let rps = inboundRps;

  const cacheHit = getNumProp(node, 'cache-hit', 0);
  if (cacheHit > 0) rps *= (100 - cacheHit) / 100;

  const fwBlock = getNumProp(node, 'firewall-block', 0);
  if (fwBlock > 0) rps *= (100 - fwBlock) / 100;

  const rateLimit = getNumProp(node, 'ratelimit-rps', 0);
  if (rateLimit > 0 && rps > rateLimit) rps = rateLimit;

  // Queue: cap outbound at drain-rate (scaled by group instances)
  if (isQueue(node)) {
    const drainRate = getNumProp(node, 'drain-rate', 0) * groupMultiplier;
    if (drainRate > 0 && rps > drainRate) rps = drainRate;
  }

  return rps;
}

// ============================================================
// Group Collapse — rewrite parsed model replacing collapsed groups with virtual nodes
// ============================================================

/**
 * Collapse specified groups into virtual nodes.
 * - Child nodes are removed
 * - Internal edges are removed
 * - A virtual node is created with aggregated properties
 * - External edges are re-routed to/from the virtual node
 */
interface CollapseResult {
  parsed: ParsedInfra;
  /** Per-group child capacities: each child's max-rps × child instances. */
  childCapacities: Map<string, number[]>;
  /** Per-group instance count. */
  groupInstances: Map<string, number>;
}

function collapseGroups(parsed: ParsedInfra, collapsedIds: Set<string>, defaultLatencyMs = 0, defaultUptime = 100): CollapseResult {
  if (collapsedIds.size === 0) return { parsed, childCapacities: new Map(), groupInstances: new Map() };

  // Build child sets per collapsed group
  const groupChildren = new Map<string, InfraNode[]>();
  for (const node of parsed.nodes) {
    if (node.groupId && collapsedIds.has(node.groupId)) {
      const list = groupChildren.get(node.groupId) ?? [];
      list.push(node);
      groupChildren.set(node.groupId, list);
    }
  }

  // All child node IDs across all collapsed groups
  const childIds = new Set<string>();
  for (const children of groupChildren.values()) {
    for (const c of children) childIds.add(c.id);
  }

  // Map child node → its collapsed group
  const nodeToGroup = new Map<string, string>();
  for (const node of parsed.nodes) {
    if (node.groupId && collapsedIds.has(node.groupId)) {
      nodeToGroup.set(node.id, node.groupId);
    }
  }

  // Classify edges
  const internalEdges = new Set<InfraEdge>();
  // External edges entering a collapsed group (target is a child)
  const inboundEdges: InfraEdge[] = [];
  // External edges leaving a collapsed group (source is a child)
  const outboundEdges: InfraEdge[] = [];
  // Cross-group edges (source in group A, target in group B)
  const crossGroupEdges: InfraEdge[] = [];
  const otherEdges: InfraEdge[] = [];

  for (const edge of parsed.edges) {
    const srcInside = childIds.has(edge.sourceId);
    const tgtInside = childIds.has(edge.targetId);
    if (srcInside && tgtInside) {
      const srcGroup = nodeToGroup.get(edge.sourceId);
      const tgtGroup = nodeToGroup.get(edge.targetId);
      if (srcGroup === tgtGroup) {
        internalEdges.add(edge);
      } else {
        // Different collapsed groups — re-route both ends
        crossGroupEdges.push(edge);
      }
    } else if (!srcInside && tgtInside) {
      inboundEdges.push(edge);
    } else if (srcInside && !tgtInside) {
      outboundEdges.push(edge);
    } else {
      otherEdges.push(edge);
    }
  }

  // Build virtual nodes for each collapsed group
  const virtualNodes: InfraNode[] = [];
  const childCapacities = new Map<string, number[]>();
  const groupInstancesMap = new Map<string, number>();
  for (const group of parsed.groups) {
    if (!collapsedIds.has(group.id)) continue;
    const children = groupChildren.get(group.id) ?? [];
    if (children.length === 0) continue;

    // Aggregate properties: bottleneck capacity, compose behaviors
    // Latency is computed separately below via critical-path analysis.
    let minEffectiveCapacity = Infinity;
    let hasMaxRps = false;
    let composedUptime = 1;
    const behaviorProps: InfraProperty[] = [];
    const perChildCapacities: number[] = [];

    // Collect per-child latency values for critical-path computation
    const childIdSet = new Set(children.map((c) => c.id));
    const childLatencies = new Map<string, number>();

    for (const child of children) {
      // Latency: use explicit value, or diagram default (matching BFS behavior)
      const latencyProp = child.properties.find((p) => p.key === 'latency-ms');
      const childIsServerless = child.properties.some((p) => p.key === 'concurrency');
      let childLat: number;
      if (childIsServerless) {
        // Serverless nodes use duration-ms as latency contribution
        const durationProp = child.properties.find((p) => p.key === 'duration-ms');
        childLat = durationProp
          ? (typeof durationProp.value === 'number' ? durationProp.value : parseFloat(String(durationProp.value)) || 100)
          : 100;
      } else if (latencyProp) {
        childLat = typeof latencyProp.value === 'number' ? latencyProp.value : parseFloat(String(latencyProp.value)) || 0;
      } else {
        childLat = defaultLatencyMs;
      }
      childLatencies.set(child.id, childLat);

      const maxRps = child.properties.find((p) => p.key === 'max-rps');
      if (maxRps) {
        hasMaxRps = true;
        const val = typeof maxRps.value === 'number' ? maxRps.value : parseFloat(String(maxRps.value)) || 0;
        // Effective capacity = max-rps × child instances
        const childInstProp = child.properties.find((p) => p.key === 'instances');
        const childInst = childInstProp && typeof childInstProp.value === 'number' ? childInstProp.value : 1;
        const effectiveCapacity = val * childInst;
        if (effectiveCapacity < minEffectiveCapacity) minEffectiveCapacity = effectiveCapacity;
        perChildCapacities.push(effectiveCapacity);
      }

      // Uptime: use explicit value, or diagram default (matching BFS behavior)
      const uptimeProp = child.properties.find((p) => p.key === 'uptime');
      const uptimeVal = uptimeProp
        ? (typeof uptimeProp.value === 'number' ? uptimeProp.value : parseFloat(String(uptimeProp.value)) || 100)
        : defaultUptime;
      composedUptime *= uptimeVal / 100;

      // Collect behavior keys (cache-hit, firewall-block, ratelimit-rps)
      // and queue/serverless properties
      for (const prop of child.properties) {
        if (['cache-hit', 'firewall-block', 'ratelimit-rps',
             'buffer', 'drain-rate', 'retention-hours', 'partitions',
             'concurrency', 'duration-ms', 'cold-start-ms'].includes(prop.key)) {
          behaviorProps.push(prop);
        }
      }
    }

    // ── Critical-path latency through the group ──────────────────────────────
    // totalLatency = max path length from external-inbound entry nodes to
    // external-outbound exit nodes, traversing only internal edges.
    // This prevents side-dependency latencies (nodes only reached via internal
    // edges with no external exit) from inflating the virtual node's latency.
    const entryIds = new Set<string>();
    const exitIds = new Set<string>();
    for (const edge of inboundEdges) {
      if (childIdSet.has(edge.targetId)) entryIds.add(edge.targetId);
    }
    for (const edge of outboundEdges) {
      if (childIdSet.has(edge.sourceId)) exitIds.add(edge.sourceId);
    }
    for (const edge of crossGroupEdges) {
      if (childIdSet.has(edge.sourceId)) exitIds.add(edge.sourceId);
      if (childIdSet.has(edge.targetId)) entryIds.add(edge.targetId);
    }

    // Build forward adjacency for internal edges scoped to this group
    const fwdAdj = new Map<string, string[]>();
    for (const edge of internalEdges) {
      if (!childIdSet.has(edge.sourceId) || !childIdSet.has(edge.targetId)) continue;
      const list = fwdAdj.get(edge.sourceId) ?? [];
      list.push(edge.targetId);
      fwdAdj.set(edge.sourceId, list);
    }

    // DAG longest-path from entry nodes (topological DFS + relaxation)
    const topoOrder: string[] = [];
    const tsVisited = new Set<string>();
    const dfsTopoSort = (id: string) => {
      if (tsVisited.has(id)) return;
      tsVisited.add(id);
      for (const next of fwdAdj.get(id) ?? []) dfsTopoSort(next);
      topoOrder.unshift(id);
    };
    for (const child of children) dfsTopoSort(child.id);

    const dist = new Map<string, number>();
    for (const child of children) {
      dist.set(child.id, entryIds.has(child.id) ? (childLatencies.get(child.id) ?? 0) : -Infinity);
    }
    for (const nodeId of topoOrder) {
      const curDist = dist.get(nodeId) ?? -Infinity;
      if (curDist === -Infinity) continue;
      for (const nextId of fwdAdj.get(nodeId) ?? []) {
        const newDist = curDist + (childLatencies.get(nextId) ?? 0);
        if (newDist > (dist.get(nextId) ?? -Infinity)) dist.set(nextId, newDist);
      }
    }

    let totalLatency = 0;
    if (exitIds.size > 0) {
      for (const id of exitIds) {
        const d = dist.get(id);
        if (d !== undefined && d > -Infinity && d > totalLatency) totalLatency = d;
      }
    } else if (entryIds.size > 0) {
      // No explicit exits — use max reachable distance from entry nodes
      for (const [, d] of dist) {
        if (d > 0 && d > totalLatency) totalLatency = d;
      }
    } else {
      // No external connections — fall back to summing all children
      for (const [, lat] of childLatencies) totalLatency += lat;
    }

    // Build virtual node properties
    const props: InfraProperty[] = [];
    if (totalLatency > 0) props.push({ key: 'latency-ms', value: totalLatency, lineNumber: group.lineNumber });

    // Apply group instances multiplier to bottleneck capacity
    // minEffectiveCapacity already includes child instances; multiply by group instances
    const groupInstances = typeof group.instances === 'number' ? group.instances : 1;
    if (hasMaxRps && minEffectiveCapacity < Infinity) {
      props.push({ key: 'max-rps', value: Math.round(minEffectiveCapacity * groupInstances), lineNumber: group.lineNumber });
    }
    if (composedUptime < 1) {
      props.push({ key: 'uptime', value: Math.round(composedUptime * 10000) / 100, lineNumber: group.lineNumber });
    }
    // Note: we do NOT push `instances` as a node property because max-rps is
    // already multiplied by groupInstances. Adding instances would double-count
    // in computeDynamicInstances which multiplies capacity = maxRps × instances.
    // drain-rate scales with group instances (more consumers), buffer does NOT.
    for (const bp of behaviorProps) {
      if (bp.key === 'drain-rate') {
        const val = typeof bp.value === 'number' ? bp.value : parseFloat(String(bp.value)) || 0;
        props.push({ ...bp, value: val * groupInstances, lineNumber: group.lineNumber });
      } else {
        props.push({ ...bp, lineNumber: group.lineNumber });
      }
    }

    // Merge tags from children (first non-empty wins per key)
    const tags: Record<string, string> = {};
    for (const child of children) {
      for (const [k, v] of Object.entries(child.tags)) {
        if (!(k in tags)) tags[k] = v;
      }
    }

    const gInst = typeof group.instances === 'number' ? group.instances : 1;
    groupInstancesMap.set(group.id, gInst);
    if (perChildCapacities.length > 0) {
      childCapacities.set(group.id, perChildCapacities);
    }

    virtualNodes.push({
      id: group.id,
      label: group.label,
      properties: props,
      groupId: null,
      tags,
      isEdge: false,
      lineNumber: group.lineNumber,
    });
  }

  // Re-route edges through virtual nodes
  const rewrittenEdges: InfraEdge[] = [...otherEdges];
  const seenEdgeKeys = new Set<string>();

  // Inbound: target was a child → re-target to group virtual node
  for (const edge of inboundEdges) {
    const groupId = nodeToGroup.get(edge.targetId)!;
    const key = `${edge.sourceId}->${groupId}`;
    if (seenEdgeKeys.has(key)) continue;
    seenEdgeKeys.add(key);
    rewrittenEdges.push({ ...edge, targetId: groupId });
  }

  // Outbound: source was a child → re-source from group virtual node
  for (const edge of outboundEdges) {
    const groupId = nodeToGroup.get(edge.sourceId)!;
    const key = `${groupId}->${edge.targetId}`;
    if (seenEdgeKeys.has(key)) continue;
    seenEdgeKeys.add(key);
    rewrittenEdges.push({ ...edge, sourceId: groupId });
  }

  // Cross-group: both source and target in different collapsed groups
  for (const edge of crossGroupEdges) {
    const srcGroupId = nodeToGroup.get(edge.sourceId)!;
    const tgtGroupId = nodeToGroup.get(edge.targetId)!;
    const key = `${srcGroupId}->${tgtGroupId}`;
    if (seenEdgeKeys.has(key)) continue;
    seenEdgeKeys.add(key);
    rewrittenEdges.push({ ...edge, sourceId: srcGroupId, targetId: tgtGroupId });
  }

  // Build new node list: non-child nodes + virtual nodes
  const newNodes = parsed.nodes.filter((n) => !childIds.has(n.id));
  newNodes.push(...virtualNodes);

  // Groups: keep non-collapsed groups
  const newGroups = parsed.groups.filter((g) => !collapsedIds.has(g.id));

  return {
    parsed: {
      ...parsed,
      nodes: newNodes,
      edges: rewrittenEdges,
      groups: newGroups,
    },
    childCapacities,
    groupInstances: groupInstancesMap,
  };
}

// ============================================================
// Split Resolution
// ============================================================

interface ResolvedSplit {
  edge: ParsedInfra['edges'][number];
  split: number; // 0-100
}

/**
 * Resolve splits for outbound edges of a node.
 * - All declared: validate sum = 100
 * - None declared: even distribution
 * - Some declared: remainder distributed evenly among undeclared
 */
function resolveSplits(
  outbound: ParsedInfra['edges'],
  diagnostics: InfraDiagnostic[],
): ResolvedSplit[] {
  if (outbound.length === 0) return [];
  if (outbound.length === 1) {
    return [{ edge: outbound[0], split: 100 }];
  }

  const declared = outbound.filter((e) => e.split !== null);
  const undeclared = outbound.filter((e) => e.split === null);

  if (declared.length === outbound.length) {
    // All declared — validate sum
    const sum = declared.reduce((s, e) => s + (e.split ?? 0), 0);
    if (Math.abs(sum - 100) > 0.01) {
      diagnostics.push({
        type: 'SPLIT_SUM',
        line: declared[0].lineNumber,
        message: `Split percentages sum to ${sum}%, expected 100%.`,
      });
    }
    return declared.map((e) => ({ edge: e, split: e.split! }));
  }

  if (declared.length === 0) {
    // None declared — even distribution
    const even = 100 / outbound.length;
    return outbound.map((e) => ({ edge: e, split: even }));
  }

  // Some declared, some not — distribute remainder
  const declaredSum = declared.reduce((s, e) => s + (e.split ?? 0), 0);
  const remainder = 100 - declaredSum;

  if (remainder < 0) {
    diagnostics.push({
      type: 'SPLIT_SUM',
      line: declared[0].lineNumber,
      message: `Declared splits sum to ${declaredSum}%, exceeding 100%.`,
    });
  }

  const evenRemainder = undeclared.length > 0 ? remainder / undeclared.length : 0;

  return outbound.map((e) => ({
    edge: e,
    split: e.split !== null ? e.split : Math.max(0, evenRemainder),
  }));
}

// ============================================================
// Main Computation
// ============================================================

export function computeInfra(
  parsed: ParsedInfra,
  params: InfraComputeParams = {},
): ComputedInfraModel {
  const diagnostics: InfraDiagnostic[] = [];

  // Chart-level defaults for latency and uptime
  const defaultLatencyMs = parseFloat(parsed.options['default-latency-ms'] ?? '') || 0;
  const defaultUptime = parseFloat(parsed.options['default-uptime'] ?? '') || 100;

  // Apply per-node property overrides (from interactive sliders)
  let effectiveNodes = parsed.nodes;
  if (params.propertyOverrides) {
    const propOv = params.propertyOverrides;
    effectiveNodes = effectiveNodes.map((node) => {
      const nodeOv = propOv[node.id];
      if (!nodeOv) return node;
      const props = node.properties.map((p) => {
        const ov = nodeOv[p.key];
        return ov != null ? { ...p, value: ov } : p;
      });
      // Add new properties from overrides that don't exist on the node
      for (const [key, val] of Object.entries(nodeOv)) {
        if (!props.some((p) => p.key === key)) {
          props.push({ key, value: val, lineNumber: node.lineNumber });
        }
      }
      return { ...node, properties: props };
    });
  }

  let effectiveParsed = effectiveNodes === parsed.nodes ? parsed : { ...parsed, nodes: effectiveNodes };

  // ── Collapse groups into virtual nodes ──
  const collapsedGroups = params.collapsedGroups ?? new Set(
    parsed.groups.filter((g) => g.collapsed).map((g) => g.id)
  );
  let collapseChildCaps = new Map<string, number[]>();
  let collapseGroupInst = new Map<string, number>();
  if (collapsedGroups.size > 0) {
    const cr = collapseGroups(effectiveParsed, collapsedGroups, defaultLatencyMs, defaultUptime);
    effectiveParsed = cr.parsed;
    collapseChildCaps = cr.childCapacities;
    collapseGroupInst = cr.groupInstances;
  }

  // Build lookup maps
  const nodeMap = new Map<string, InfraNode>();
  for (const node of effectiveParsed.nodes) {
    nodeMap.set(node.id, node);
  }

  // Group edges by source for resolving edges that target groups
  // If an edge targets a [Group], resolve to the first child node in that group
  const groupChildMap = new Map<string, string[]>();
  for (const node of effectiveParsed.nodes) {
    if (node.groupId) {
      const children = groupChildMap.get(node.groupId) ?? [];
      children.push(node.id);
      groupChildMap.set(node.groupId, children);
    }
  }

  // Build group instance multiplier: nodeId → parent group's instances
  // When a group has `instances: N`, each child's effective capacity is multiplied by N
  const groupInstMultiplier = new Map<string, number>();
  for (const group of effectiveParsed.groups) {
    const gi = typeof group.instances === 'number' ? group.instances :
      typeof group.instances === 'string' ? parseInt(group.instances, 10) || 1 : 1;
    if (gi > 1) {
      const children = groupChildMap.get(group.id) ?? [];
      for (const childId of children) {
        groupInstMultiplier.set(childId, gi);
      }
    }
  }

  // Build outbound edge map (sourceId -> edges[])
  const outboundMap = new Map<string, typeof effectiveParsed.edges>();
  for (const edge of effectiveParsed.edges) {
    const list = outboundMap.get(edge.sourceId) ?? [];
    list.push(edge);
    outboundMap.set(edge.sourceId, list);
  }

  // Computed rps per node
  const computedRps = new Map<string, number>();
  const computedEdgeRps = new Map<string, number>(); // key: `sourceId->targetId`
  // Latency: cumulative ms from edge to each node (max across incoming paths)
  const computedLatency = new Map<string, number>();
  // Uptime: product of uptimes along the path (min across incoming paths)
  const computedUptime = new Map<string, number>();
  // Per-node local availability (computed after RPS is known)
  const localAvailability = new Map<string, number>();

  // Find edge entry point
  const edgeNode = effectiveParsed.nodes.find((n) => n.isEdge);
  const baseRps = params.rps ?? (edgeNode ? getNumProp(edgeNode, 'rps', 0) : 0);

  // BFS traversal from edge
  if (edgeNode) {
    computedRps.set(edgeNode.id, baseRps);
    computedLatency.set(edgeNode.id, 0);
    computedUptime.set(edgeNode.id, 1);

    const queue: string[] = [edgeNode.id];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const currentNode = nodeMap.get(currentId);
      if (!currentNode) continue;

      const inbound = computedRps.get(currentId) ?? 0;
      const currentLatency = computedLatency.get(currentId) ?? 0;
      const currentUptime = computedUptime.get(currentId) ?? 1;

      // Add this node's latency and uptime
      // Serverless nodes use duration-ms as their latency contribution
      const nodeLatency = currentNode.isEdge ? 0
        : isServerless(currentNode) ? getNumProp(currentNode, 'duration-ms', 100)
        : getNumProp(currentNode, 'latency-ms', defaultLatencyMs);
      const nodeUptime = currentNode.isEdge ? 1 : getNumProp(currentNode, 'uptime', defaultUptime) / 100;
      const cumulativeLatency = currentLatency + nodeLatency;
      const cumulativeUptime = currentUptime * nodeUptime;

      // Apply behavior transformations to get outbound rps
      const gMul = groupInstMultiplier.get(currentId) ?? 1;
      const outboundRps = currentNode.isEdge ? inbound : applyBehaviors(currentNode, inbound, gMul);

      // Queue latency boundary: downstream latency starts from queue wait time, not cumulative
      let downstreamLatency = cumulativeLatency;
      if (isQueue(currentNode)) {
        const drainRate = getNumProp(currentNode, 'drain-rate', 0) * gMul;
        const fillRate = drainRate > 0 ? Math.max(0, inbound - drainRate) : 0;
        const waitTimeMs = fillRate > 0 && drainRate > 0 ? (fillRate / drainRate) * 1000 : 0;
        downstreamLatency = waitTimeMs; // reset: consumer-side starts fresh from queue wait
      }

      // Get outbound edges
      const outbound = outboundMap.get(currentId) ?? [];
      if (outbound.length === 0) continue;

      // Resolve splits
      const resolved = resolveSplits(outbound, diagnostics);

      for (const { edge, split } of resolved) {
        const edgeRps = outboundRps * (split / 100);
        const fanout = (edge.fanout != null && edge.fanout >= 1) ? edge.fanout : 1;
        const fanoutedRps = edgeRps * fanout;
        const edgeKey = `${edge.sourceId}->${edge.targetId}`;
        computedEdgeRps.set(edgeKey, fanoutedRps);

        // Resolve target — could be a group or a node
        let targetIds: string[];
        const groupChildren = groupChildMap.get(edge.targetId);
        if (groupChildren && groupChildren.length > 0) {
          targetIds = groupChildren;
        } else {
          targetIds = [edge.targetId];
        }

        for (const targetId of targetIds) {
          const perTarget = fanoutedRps / targetIds.length;
          const existing = computedRps.get(targetId) ?? 0;
          computedRps.set(targetId, existing + perTarget);

          // Latency: take max across incoming paths (worst case)
          const prevLatency = computedLatency.get(targetId) ?? 0;
          if (downstreamLatency > prevLatency) {
            computedLatency.set(targetId, downstreamLatency);
          }

          // Uptime: take min across incoming paths (most conservative)
          const prevUptime = computedUptime.get(targetId) ?? 1;
          if (cumulativeUptime < prevUptime) {
            computedUptime.set(targetId, cumulativeUptime);
          }

          if (!visited.has(targetId)) {
            queue.push(targetId);
          }
        }
      }
    }
  }

  // ── Per-node local & compound availability ──
  // Local availability depends on inbound RPS, so computed after BFS.
  // Compound availability = product of local availabilities from edge to this node.
  const instanceOverrides = params.instanceOverrides ?? {};
  for (const node of effectiveParsed.nodes) {
    const rps = computedRps.get(node.id) ?? 0;
    localAvailability.set(node.id, computeLocalAvailability(node, rps, instanceOverrides[node.id], groupInstMultiplier.get(node.id) ?? 1, defaultUptime));
  }

  // Propagate compound availability via second BFS
  const compoundAvailability = new Map<string, number>();
  if (edgeNode) {
    compoundAvailability.set(edgeNode.id, localAvailability.get(edgeNode.id) ?? 1);
    const queue2: string[] = [edgeNode.id];
    const visited2 = new Set<string>();
    while (queue2.length > 0) {
      const currentId = queue2.shift()!;
      if (visited2.has(currentId)) continue;
      visited2.add(currentId);
      const cumAvail = compoundAvailability.get(currentId) ?? 1;
      const currentNode = nodeMap.get(currentId);
      // Queue boundary: downstream availability starts fresh (producer-side decoupled)
      const propagatedAvail = currentNode && isQueue(currentNode) ? localAvailability.get(currentId) ?? 1 : cumAvail;
      const outbound = outboundMap.get(currentId) ?? [];
      for (const edge of outbound) {
        const groupChildren = groupChildMap.get(edge.targetId);
        const targetIds = (groupChildren && groupChildren.length > 0) ? groupChildren : [edge.targetId];
        for (const targetId of targetIds) {
          const targetLocal = localAvailability.get(targetId) ?? 1;
          const newCompound = propagatedAvail * targetLocal;
          // Take min (most conservative) across incoming paths
          const prev = compoundAvailability.get(targetId) ?? 1;
          if (newCompound < prev) {
            compoundAvailability.set(targetId, newCompound);
          }
          if (!visited2.has(targetId)) queue2.push(targetId);
        }
      }
    }
  }

  // ── Per-node latency percentiles ──
  // For each node, collect all downstream leaf paths (latency, weight) via DFS,
  // then derive p50/p90/p99 weighted by traffic.

  type LeafPath = { latency: number; uptime: number; availability: number; weight: number };
  const nodeLeafCache = new Map<string, LeafPath[]>();

  /** Collect leaf paths reachable from `nodeId` with accumulated extra latency/uptime. */
  function collectLeafPaths(nodeId: string, visited: Set<string>): LeafPath[] {
    if (nodeLeafCache.has(nodeId)) return nodeLeafCache.get(nodeId)!;
    if (visited.has(nodeId)) return []; // cycle guard
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) return [];

    // Node latency contribution depends on type:
    // - Queue: wait time (latency boundary — resets cumulative chain)
    // - Serverless: duration-ms
    // - Normal: latency-ms or default
    let nodeLatency: number;
    if (node.isEdge) {
      nodeLatency = 0;
    } else if (isQueue(node)) {
      const qGMul = groupInstMultiplier.get(nodeId) ?? 1;
      const drainRate = getNumProp(node, 'drain-rate', 0) * qGMul;
      const inbound = computedRps.get(nodeId) ?? 0;
      const fillRate = drainRate > 0 ? Math.max(0, inbound - drainRate) : 0;
      nodeLatency = fillRate > 0 && drainRate > 0 ? (fillRate / drainRate) * 1000 : 0;
    } else if (isServerless(node)) {
      nodeLatency = getNumProp(node, 'duration-ms', 100);
    } else {
      nodeLatency = getNumProp(node, 'latency-ms', defaultLatencyMs);
    }
    const nodeUptimeFrac = node.isEdge ? 1 : getNumProp(node, 'uptime', defaultUptime) / 100;
    const nodeAvail = localAvailability.get(nodeId) ?? 1;

    // Serverless cold-start latency: split into warm (95%) and cold (5%) paths
    const coldStartMs = isServerless(node) ? getNumProp(node, 'cold-start-ms', 0) : 0;
    const coldLatency = nodeLatency + coldStartMs;

    const outbound = outboundMap.get(nodeId) ?? [];
    if (outbound.length === 0) {
      // Leaf node — return self
      const rps = computedRps.get(nodeId) ?? 0;
      let result: LeafPath[];
      if (rps <= 0) {
        result = [];
      } else if (coldStartMs > 0) {
        // Split into warm/cold paths for percentile accuracy
        // 95/5 split: cold starts affect ~5% of requests, visible at p99
        result = [
          { latency: nodeLatency, uptime: nodeUptimeFrac, availability: nodeAvail, weight: rps * 0.95 },
          { latency: coldLatency, uptime: nodeUptimeFrac, availability: nodeAvail, weight: rps * 0.05 },
        ];
      } else {
        result = [{ latency: nodeLatency, uptime: nodeUptimeFrac, availability: nodeAvail, weight: rps }];
      }
      nodeLeafCache.set(nodeId, result);
      return result;
    }

    // Resolve splits for outbound edges
    const resolved = resolveSplits(outbound, []);
    const paths: LeafPath[] = [];

    for (const { edge, split } of resolved) {
      const fanout = (edge.fanout != null && edge.fanout >= 1) ? edge.fanout : 1;
      const groupChildren = groupChildMap.get(edge.targetId);
      const targetIds = (groupChildren && groupChildren.length > 0)
        ? groupChildren : [edge.targetId];

      for (const targetId of targetIds) {
        const childPaths = collectLeafPaths(targetId, new Set(visited));
        for (const cp of childPaths) {
          if (coldStartMs > 0) {
            // Warm path (95% of requests)
            paths.push({
              latency: nodeLatency + cp.latency,
              uptime: nodeUptimeFrac * cp.uptime,
              availability: nodeAvail * cp.availability,
              weight: cp.weight * (split / 100) / targetIds.length * fanout * 0.95,
            });
            // Cold path (5% of requests)
            paths.push({
              latency: coldLatency + cp.latency,
              uptime: nodeUptimeFrac * cp.uptime,
              availability: nodeAvail * cp.availability,
              weight: cp.weight * (split / 100) / targetIds.length * fanout * 0.05,
            });
          } else {
            paths.push({
              latency: nodeLatency + cp.latency,
              uptime: nodeUptimeFrac * cp.uptime,
              availability: nodeAvail * cp.availability,
              weight: cp.weight * (split / 100) / targetIds.length * fanout,
            });
          }
        }
      }
    }

    nodeLeafCache.set(nodeId, paths);
    return paths;
  }

  /** Compute percentiles from weighted leaf paths. */
  function percentilesFromPaths(paths: LeafPath[]): InfraLatencyPercentiles {
    if (paths.length === 0) return { p50: 0, p90: 0, p99: 0 };
    const sorted = [...paths].sort((a, b) => a.latency - b.latency);
    const totalWeight = sorted.reduce((s, p) => s + p.weight, 0);
    if (totalWeight <= 0) return { p50: 0, p90: 0, p99: 0 };

    const getP = (pct: number): number => {
      const target = totalWeight * (pct / 100);
      let cumulative = 0;
      for (const p of sorted) {
        cumulative += p.weight;
        if (cumulative >= target) return p.latency;
      }
      return sorted[sorted.length - 1].latency;
    };

    return { p50: getP(50), p90: getP(90), p99: getP(99) };
  }

  /** Compute availability percentiles from weighted leaf paths. */
  function availabilityPercentilesFromPaths(paths: LeafPath[]): InfraAvailabilityPercentiles {
    if (paths.length === 0) return { p50: 1, p90: 1, p99: 1 };
    // Sort ascending by availability (worst paths first)
    const sorted = [...paths].sort((a, b) => a.availability - b.availability);
    const totalWeight = sorted.reduce((s, p) => s + p.weight, 0);
    if (totalWeight <= 0) return { p50: 1, p90: 1, p99: 1 };

    const getP = (pct: number): number => {
      const target = totalWeight * (pct / 100);
      let cumulative = 0;
      for (const p of sorted) {
        cumulative += p.weight;
        if (cumulative >= target) return p.availability;
      }
      return sorted[sorted.length - 1].availability;
    };

    return { p50: getP(50), p90: getP(90), p99: getP(99) };
  }

  // Pre-compute leaf paths for all nodes
  for (const node of effectiveParsed.nodes) {
    collectLeafPaths(node.id, new Set());
  }

  // System-wide percentiles (from edge node)
  const edgeLeafPaths = edgeNode ? (nodeLeafCache.get(edgeNode.id) ?? []) : [];
  const edgeLatency = percentilesFromPaths(edgeLeafPaths);
  const systemUptime = edgeLeafPaths.length > 0
    ? (() => {
        const tw = edgeLeafPaths.reduce((s, p) => s + p.weight, 0);
        return tw > 0 ? edgeLeafPaths.reduce((s, p) => s + p.uptime * (p.weight / tw), 0) : 1;
      })()
    : 1;
  const systemAvailability = edgeLeafPaths.length > 0
    ? (() => {
        const tw = edgeLeafPaths.reduce((s, p) => s + p.weight, 0);
        return tw > 0 ? edgeLeafPaths.reduce((s, p) => s + p.availability * (p.weight / tw), 0) : 1;
      })()
    : 1;

  // Per-node percentiles + downstream availability map
  const nodePercentiles = new Map<string, InfraLatencyPercentiles>();
  const nodeAvailPercentiles = new Map<string, InfraAvailabilityPercentiles>();
  const downstreamAvailability = new Map<string, number>();
  for (const node of effectiveParsed.nodes) {
    const paths = nodeLeafCache.get(node.id) ?? [];
    nodePercentiles.set(node.id, percentilesFromPaths(paths));
    nodeAvailPercentiles.set(node.id, availabilityPercentilesFromPaths(paths));
    // Queue nodes decouple availability — use local availability only
    if (isQueue(node)) {
      downstreamAvailability.set(node.id, localAvailability.get(node.id) ?? 1);
    } else {
      // Weighted average of compound availability across all downstream leaf paths
      const tw = paths.reduce((s, p) => s + p.weight, 0);
      downstreamAvailability.set(node.id, tw > 0
        ? paths.reduce((s, p) => s + p.availability * (p.weight / tw), 0)
        : localAvailability.get(node.id) ?? 1);
    }
  }

  // Build computed nodes
  const computedNodes: ComputedInfraNode[] = effectiveParsed.nodes.map((node) => {
    const rps = computedRps.get(node.id) ?? 0;
    const gMul = groupInstMultiplier.get(node.id) ?? 1;
    let capacity: number;
    let dynInstances: number;

    if (isServerless(node)) {
      capacity = serverlessCapacity(node);
      dynInstances = 0; // serverless has no instances
    } else {
      const maxRps = getNumProp(node, 'max-rps', 0);
      dynInstances = instanceOverrides[node.id] ?? computeDynamicInstances(node, rps);
      capacity = maxRps > 0 ? maxRps * dynInstances * gMul : 0;
    }
    const overloaded = capacity > 0 && rps > capacity;

    // Rate-limit check: is inbound RPS (after cache/fw/bot) exceeding ratelimit-rps?
    let rateLimited = false;
    if (!node.isEdge) {
      const rl = getNumProp(node, 'ratelimit-rps', 0);
      if (rl > 0 && rps > 0) {
        let preRl = rps;
        const ch = getNumProp(node, 'cache-hit', 0);
        if (ch > 0) preRl *= (100 - ch) / 100;
        const fw = getNumProp(node, 'firewall-block', 0);
        if (fw > 0) preRl *= (100 - fw) / 100;
        rateLimited = preRl > rl;
      }
    }

    // Serverless nodes use duration-ms as their latency contribution
    const nodeLatency = node.isEdge ? 0
      : isServerless(node) ? getNumProp(node, 'duration-ms', 100)
      : getNumProp(node, 'latency-ms', defaultLatencyMs);
    const cumulativeLatency = (computedLatency.get(node.id) ?? 0) + nodeLatency;
    const nodeUptime = node.isEdge ? 1 : getNumProp(node, 'uptime', defaultUptime) / 100;
    const cumulativeUptime = (computedUptime.get(node.id) ?? 1) * nodeUptime;

    const cbState = computeCbState(node, rps, cumulativeLatency, instanceOverrides[node.id], gMul);

    if (overloaded) {
      const capDetail = isServerless(node)
        ? `concurrency ${getNumProp(node, 'concurrency', 0)} / ${getNumProp(node, 'duration-ms', 100)}ms`
        : `${getNumProp(node, 'max-rps', 0)} x ${dynInstances}${gMul > 1 ? ` x ${gMul} group` : ''}`;
      diagnostics.push({
        type: 'OVERLOAD',
        line: node.lineNumber,
        message: `${node.label} is overloaded: ${Math.round(rps)} rps exceeds capacity ${Math.round(capacity)} rps (${capDetail}).`,
      });
    }
    if (rateLimited) {
      diagnostics.push({
        type: 'RATE_LIMITED',
        line: node.lineNumber,
        message: `${node.label} is rate-limiting: inbound traffic exceeds ratelimit-rps.`,
      });
    }

    // For collapsed group nodes: compute worst child health state
    let childHealthState: 'normal' | 'warning' | 'overloaded' | undefined;
    const childCaps = collapseChildCaps.get(node.id);
    if (childCaps && childCaps.length > 0) {
      const gInst = collapseGroupInst.get(node.id) ?? 1;
      const perInstanceRps = rps / gInst;
      let worst: 'normal' | 'warning' | 'overloaded' = 'normal';
      for (const cap of childCaps) {
        if (cap > 0 && perInstanceRps > cap) worst = 'overloaded';
        else if (cap > 0 && perInstanceRps > cap * 0.7 && worst !== 'overloaded') worst = 'warning';
      }
      childHealthState = worst;
    }

    // Queue metrics — drain-rate scales with group instances, buffer does NOT
    let queueMetrics: ComputedInfraNode['queueMetrics'];
    if (isQueue(node)) {
      const buffer = getNumProp(node, 'buffer', 0);
      const drainRate = getNumProp(node, 'drain-rate', 0) * gMul;
      const fillRate = drainRate > 0 ? Math.max(0, rps - drainRate) : 0;
      const timeToOverflow = fillRate > 0 ? buffer / fillRate : Infinity;
      const waitTimeMs = fillRate > 0 && drainRate > 0 ? (fillRate / drainRate) * 1000 : 0;
      queueMetrics = { fillRate, timeToOverflow, waitTimeMs };
    }

    return {
      id: node.id,
      label: node.label,
      groupId: node.groupId,
      isEdge: node.isEdge,
      computedRps: rps,
      overloaded,
      rateLimited,
      computedLatencyMs: cumulativeLatency,
      computedLatencyPercentiles: nodePercentiles.get(node.id) ?? { p50: 0, p90: 0, p99: 0 },
      computedUptime: cumulativeUptime,
      computedAvailability: downstreamAvailability.get(node.id) ?? 1,
      computedAvailabilityPercentiles: nodeAvailPercentiles.get(node.id) ?? { p50: 1, p90: 1, p99: 1 },
      computedCbState: cbState,
      computedInstances: (collapseGroupInst.get(node.id) ?? dynInstances) * gMul,
      computedConcurrentInvocations: isServerless(node)
        ? Math.ceil(rps * getNumProp(node, 'duration-ms', 100) / 1000)
        : 0,
      childHealthState,
      queueMetrics,
      properties: node.properties,
      tags: node.tags,
      description: node.description,
      lineNumber: node.lineNumber,
    };
  });

  // Build computed edges with resolved splits and rps
  const computedEdges: ComputedInfraEdge[] = effectiveParsed.edges.map((edge) => {
    const edgeKey = `${edge.sourceId}->${edge.targetId}`;
    const rps = computedEdgeRps.get(edgeKey) ?? 0;

    // Get resolved split
    const outbound = outboundMap.get(edge.sourceId) ?? [];
    let resolvedSplit = edge.split ?? 100;
    if (outbound.length > 1 && edge.split === null) {
      // Was inferred
      const declared = outbound.filter((e) => e.split !== null);
      if (declared.length === 0) {
        resolvedSplit = 100 / outbound.length;
      } else {
        const declaredSum = declared.reduce((s, e) => s + (e.split ?? 0), 0);
        const undeclared = outbound.filter((e) => e.split === null);
        resolvedSplit = undeclared.length > 0 ? (100 - declaredSum) / undeclared.length : 0;
      }
    }

    return {
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      label: edge.label,
      computedRps: rps,
      split: resolvedSplit,
      fanout: edge.fanout,
      lineNumber: edge.lineNumber,
    };
  });

  return {
    nodes: computedNodes,
    edges: computedEdges,
    groups: effectiveParsed.groups,
    tagGroups: effectiveParsed.tagGroups,
    title: effectiveParsed.title,
    direction: effectiveParsed.direction,
    edgeLatency,
    systemUptime,
    systemAvailability,
    options: parsed.options,
    diagnostics,
  };
}
