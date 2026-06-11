// ============================================================
// Infra Chart Types
// ============================================================

import type { DgmoError } from '../diagnostics';
import {
  INFRA_BEHAVIOR_KEY_SET,
  INFRA_EDGE_ONLY_KEY_SET,
} from '../directives-registry';

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

/**
 * All recognized property keys (behavior + structural). Derived from the
 * single-source directives registry — do NOT re-list literals here.
 */
export const INFRA_BEHAVIOR_KEYS: ReadonlySet<string> = INFRA_BEHAVIOR_KEY_SET;

/** The `rps` key is only valid on the `edge` component. */
export const EDGE_ONLY_KEYS: ReadonlySet<string> = INFRA_EDGE_ONLY_KEY_SET;

export interface InfraProperty {
  readonly key: string;
  readonly value: string | number;
  readonly lineNumber: number;
}

export interface InfraNode {
  readonly id: string;
  readonly label: string;
  readonly properties: readonly InfraProperty[];
  readonly groupId: string | null;
  readonly tags: Readonly<Record<string, string>>; // tagGroup -> tagValue
  readonly isEdge: boolean; // true for the `edge` entry-point component
  readonly description?: readonly string[];
  readonly lineNumber: number;
}

export interface InfraEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly label: string;
  readonly async: boolean;
  readonly split: number | null; // percentage 0-100, or null if not declared
  readonly fanout: number | null; // request multiplier: target receives inbound * (split/100) * fanout RPS
  readonly lineNumber: number;
}

export interface InfraGroup {
  readonly id: string;
  readonly label: string;
  /** Number of instances (or auto-scaling range "N-M") of this group as a unit. */
  readonly instances?: number | string;
  /** Whether this group should be collapsed by default in the source. */
  readonly collapsed?: boolean;
  /** Pipe metadata on the group header, cascaded to children. */
  readonly metadata?: Readonly<Record<string, string>>;
  readonly lineNumber: number;
}

export interface InfraTagValue {
  readonly name: string;
  readonly color?: string;
}

export interface InfraTagGroup {
  readonly name: string;
  readonly alias: string | null;
  readonly values: readonly InfraTagValue[];
  /** Value of the entry marked `default` (nodes without this tag get it automatically). */
  readonly defaultValue?: string;
  readonly lineNumber: number;
}

export interface ParsedInfra {
  readonly type: 'infra';
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly direction: 'LR' | 'TB';
  readonly nodes: readonly InfraNode[];
  readonly edges: readonly InfraEdge[];
  readonly groups: readonly InfraGroup[];
  readonly tagGroups: readonly InfraTagGroup[];
  readonly options: Readonly<Record<string, string>>;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}

// ============================================================
// Computed Model Types
// ============================================================

export interface InfraComputeParams {
  rps?: number; // override edge rps (for slider)
  instanceOverrides?: Record<string, number>; // nodeId -> instance count override
  /** Per-node property overrides: nodeId -> { propertyKey: numericValue }. */
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
  description?: string[];
  lineNumber: number;
}

export interface ComputedInfraEdge {
  sourceId: string;
  targetId: string;
  label: string;
  async: boolean;
  computedRps: number;
  split: number; // resolved split (always 0-100)
  fanout: number | null;
  lineNumber: number;
}

export interface InfraDiagnostic {
  type:
    | 'SPLIT_SUM'
    | 'CYCLE'
    | 'OVERLOAD'
    | 'RATE_LIMITED'
    | 'ORPHAN'
    | 'SYNTAX'
    | 'UPTIME';
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
