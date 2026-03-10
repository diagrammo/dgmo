// ============================================================
// Infra Chart Types
// ============================================================

import type { DgmoError } from '../diagnostics';

/** Namespaced behavior property keys recognized by the parser. */
export type InfraBehaviorKey =
  | 'cache-hit'
  | 'firewall-block'
  | 'ratelimit-rps'
  | 'latency-ms'
  | 'uptime'
  | 'instances'
  | 'max-rps'
  | 'cb-error-threshold'
  | 'cb-latency-threshold-ms'
  | 'concurrency'
  | 'duration-ms'
  | 'cold-start-ms'
  | 'buffer'
  | 'drain-rate'
  | 'retention-hours'
  | 'partitions';

/** All recognized property keys (behavior + structural). */
export const INFRA_BEHAVIOR_KEYS = new Set<string>([
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
  'slo-availability',
  'slo-p90-latency-ms',
  'slo-warning-margin',
]);

/** The `rps` key is only valid on the `edge` component. */
export const EDGE_ONLY_KEYS = new Set<string>(['rps']);

export interface InfraProperty {
  key: string;
  value: string | number;
  lineNumber: number;
}

export interface InfraNode {
  id: string;
  label: string;
  properties: InfraProperty[];
  groupId: string | null;
  tags: Record<string, string>; // tagGroup -> tagValue
  isEdge: boolean; // true for the `edge` entry-point component
  description?: string;
  lineNumber: number;
}

export interface InfraEdge {
  sourceId: string;
  targetId: string;
  label: string;
  split: number | null; // percentage 0-100, or null if not declared
  fanout: number | null; // request multiplier: target receives inbound * (split/100) * fanout RPS
  lineNumber: number;
}

export interface InfraGroup {
  id: string;
  label: string;
  /** Number of instances (or auto-scaling range "N-M") of this group as a unit. */
  instances?: number | string;
  /** Whether this group should be collapsed by default in the source. */
  collapsed?: boolean;
  lineNumber: number;
}

export interface InfraTagValue {
  name: string;
  color?: string;
}

export interface InfraTagGroup {
  name: string;
  alias: string | null;
  values: InfraTagValue[];
  /** Value of the entry marked `default` (nodes without this tag get it automatically). */
  defaultValue?: string;
  lineNumber: number;
}

export interface InfraScenario {
  name: string;
  /** Node property overrides: nodeId -> { key: value } */
  overrides: Record<string, Record<string, string | number>>;
  lineNumber: number;
}

export interface ParsedInfra {
  type: 'infra';
  title: string | null;
  titleLineNumber: number | null;
  direction: 'LR' | 'TB';
  nodes: InfraNode[];
  edges: InfraEdge[];
  groups: InfraGroup[];
  tagGroups: InfraTagGroup[];
  scenarios: InfraScenario[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}

// ============================================================
// Computed Model Types
// ============================================================

export interface InfraComputeParams {
  rps?: number; // override edge rps (for slider)
  instanceOverrides?: Record<string, number>; // nodeId -> instance count override
  scenario?: InfraScenario | null; // apply a named scenario's overrides
  /** Per-node property overrides: nodeId -> { propertyKey: numericValue }.
   *  Applied after scenario overrides. Lets sliders adjust cache-hit, etc. */
  propertyOverrides?: Record<string, Record<string, number>>;
  /** Set of group IDs that should be treated as collapsed (virtual nodes). */
  collapsedGroups?: Set<string>;
}

export type InfraCbState = 'closed' | 'open' | 'half-open';

export interface ComputedInfraNode {
  id: string;
  label: string;
  groupId: string | null;
  isEdge: boolean;
  computedRps: number;
  overloaded: boolean;
  /** True when inbound RPS exceeds the node's ratelimit-rps and traffic is being shed. */
  rateLimited: boolean;
  /** Cumulative latency from edge to this node (ms). */
  computedLatencyMs: number;
  /** Latency percentiles from this node through all downstream paths (ms). */
  computedLatencyPercentiles: InfraLatencyPercentiles;
  /** Component uptime (product of uptimes along path, 0-1). */
  computedUptime: number;
  /** Local availability at this node (0-1), factoring in uptime, overload shed, and rate-limit reject. */
  computedAvailability: number;
  /** Availability percentiles through all downstream paths from this node (0-1 fractions). */
  computedAvailabilityPercentiles: InfraAvailabilityPercentiles;
  /** Circuit breaker state. */
  computedCbState: InfraCbState;
  /** Computed instance count for auto-scaling (min-max) ranges. */
  computedInstances: number;
  /** For serverless nodes: estimated concurrent invocations (Little's Law: RPS × duration_ms / 1000). */
  computedConcurrentInvocations: number;
  /** For collapsed group virtual nodes: worst health state of any child.
   *  'overloaded' > 'warning' > 'normal'. Undefined for regular nodes. */
  childHealthState?: 'normal' | 'warning' | 'overloaded';
  /** Queue metrics — only present when buffer property exists. */
  queueMetrics?: {
    /** Messages per second filling the buffer (inbound - drain-rate, clamped to 0). */
    fillRate: number;
    /** Seconds until buffer overflow at sustained fill rate. Infinity if not filling. */
    timeToOverflow: number;
    /** Queue wait time in ms (pending_messages / drain_rate * 1000). */
    waitTimeMs: number;
  };
  properties: InfraProperty[];
  tags: Record<string, string>;
  description?: string;
  lineNumber: number;
}

export interface ComputedInfraEdge {
  sourceId: string;
  targetId: string;
  label: string;
  computedRps: number;
  split: number; // resolved split (always 0-100)
  fanout: number | null;
  lineNumber: number;
}

export interface InfraDiagnostic {
  type: 'SPLIT_SUM' | 'CYCLE' | 'OVERLOAD' | 'RATE_LIMITED' | 'ORPHAN' | 'SYNTAX' | 'UPTIME';
  line: number;
  message: string;
}

export interface InfraLatencyPercentiles {
  p50: number;
  p90: number;
  p99: number;
}

export interface InfraAvailabilityPercentiles {
  p50: number;
  p90: number;
  p99: number;
}

export interface ComputedInfraModel {
  nodes: ComputedInfraNode[];
  edges: ComputedInfraEdge[];
  groups: InfraGroup[];
  tagGroups: InfraTagGroup[];
  title: string | null;
  direction: 'LR' | 'TB';
  /** Diagram-level options (e.g., default-latency-ms, default-uptime). */
  options: Record<string, string>;
  /** Latency percentiles at the edge entry point (weighted by traffic probability). */
  edgeLatency: InfraLatencyPercentiles;
  /** System uptime at edge (weighted average across all paths). */
  systemUptime: number;
  /** System availability at edge (weighted average of compound availability across all paths). */
  systemAvailability: number;
  diagnostics: InfraDiagnostic[];
}
