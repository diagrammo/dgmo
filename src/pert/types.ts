// ============================================================
// PERT Diagram — public types
// ============================================================
//
// Activity-on-Node project network with three-point estimates.
// See `docs/dgmo-language-spec.md` § PERT for the grammar; see
// `_bmad-output/implementation-artifacts/tech-spec-pert.md` for the
// design decisions captured here.

import type { DgmoError } from '../diagnostics';
import type { Duration } from '../gantt/types';
import type { DurationEstimate } from './internal';

// ── Directives ──────────────────────────────────────────────

/** Layout direction. `LR` is the default; `TB` for tall chains. */
export type PertDirection = 'LR' | 'TB';

/** `node-detail` directive value. */
export type NodeDetail = 'compact' | 'full';

/** Diagram-level options collected by the parser. */
export interface PertOptions {
  /** Time unit for μ/σ/ES/EF formatting and M-only heuristics. */
  timeUnit: Duration['unit'];
  /** `direction` directive. Defaults to `LR`. */
  direction: PertDirection;
  /** `node-detail` directive. Defaults to `compact`. */
  nodeDetail: NodeDetail;
  /**
   * Global confidence used to fill O/P from M-only durations.
   * Stored verbatim — analyzer applies `resolveConfidence()` to expand
   * named levels (`high`/`medium`/`low`) or `O/P` factor pairs.
   */
  confidence: string;
  /**
   * `analysis monte-carlo` directive. Phase 1 ignores this; Phase 2 wires
   * it into the analyzer to populate `monteCarloResult`.
   */
  analysis: 'none' | 'monte-carlo';
  /** Monte-Carlo trials for the canonical run (default 10000). */
  trials: number;
  /** Monte-Carlo seed; deterministic across machines via mulberry32. */
  seed: number;
  /** Fast-MC trials for the live duration scrubber (default 300, floor 100). */
  scrubberTrials: number;
}

// ── Parsed elements ─────────────────────────────────────────

/**
 * A PERT activity (node). Activities have either a three-point estimate,
 * an M-only estimate (parser fills O/P from confidence factors), or no
 * estimate at all (TBD — analyzer null-poisons descendants).
 */
export interface PertActivity {
  /** Stable id — alias if `as` was given, otherwise normalized name. */
  id: string;
  /** Human-readable label as written in source. */
  name: string;
  /** Optional alias from `<name> <durs> as <id>`. */
  alias?: string;
  /**
   * Activity duration estimate.
   * - `null` → TBD (no estimate); analyzer poisons descendants with `null`.
   */
  duration: DurationEstimate | null;
  /**
   * Per-activity confidence override from pipe metadata (`| confidence: low`).
   * When unset, analyzer uses `options.confidence`.
   */
  confidence?: string;
  /** Group id this activity belongs to (post-resolve). */
  groupId?: string;
  /** Source line of the declaration site (1-based). */
  lineNumber: number;
  /** True for `milestone <name>` primitives (zero-duration, diamond shape). */
  isMilestone: boolean;
}

/**
 * Forward-style milestone shorthand. Stored as a `PertActivity` with
 * `isMilestone: true` and a zero-duration estimate, but kept here as a
 * distinct exported alias for callers that want to filter by kind.
 */
export type PertMilestone = PertActivity & { isMilestone: true };

/** Directed dependency edge from `source` activity to `target`. */
export interface PertEdge {
  source: string;
  target: string;
  lineNumber: number;
}

/** Group declared via `[group-name] | metadata`. */
export interface PertGroup {
  id: string;
  name: string;
  /** Activity ids belonging to this group, populated in Pass 2. */
  activityIds: string[];
  /** Whether the user authored `| collapsed: true`. */
  collapsed: boolean;
  /** Source line of the `[group-name]` header (1-based). */
  lineNumber: number;
  /**
   * Auto-detected group topology (Pass 2 result).
   * - `hammock`: single entry + single exit — collapses to a super-edge.
   * - `cluster`: multi-entry or multi-exit — collapses to a bounding rect.
   */
  classification?: 'hammock' | 'cluster';
}

/** Output of `parsePert(content)`. */
export interface ParsedPert {
  /** Optional title parsed from `pert <title>`. */
  title: string | null;
  options: PertOptions;
  activities: PertActivity[];
  edges: PertEdge[];
  groups: PertGroup[];
  /**
   * Map alias-or-name → canonical activity id. Useful for the analyzer
   * and for editor autocomplete; also populated in Pass 2.
   */
  idMap: Record<string, string>;
  diagnostics: DgmoError[];
  /** First fatal error message; `null` when parse succeeded. */
  error: string | null;
}

// ── Resolved (post-analyzer) ────────────────────────────────

/**
 * Fully-resolved per-activity analysis output. ES/EF/LS/LF/slack are
 * `null` for any activity downstream of a TBD (poison-propagation per
 * AC2.3).
 */
export interface ResolvedActivity {
  activity: PertActivity;
  /** Earliest start (forward pass). `null` if upstream TBD. */
  es: number | null;
  /** Earliest finish. */
  ef: number | null;
  /** Latest start (backward pass). */
  ls: number | null;
  /** Latest finish. */
  lf: number | null;
  /** Slack = LS − ES (or LF − EF). 0 = on critical path. `null` if poisoned. */
  slack: number | null;
  /** True iff the M-world critical path passes through this activity. */
  isCriticalPath: boolean;
  /** Resolved μ in `options.timeUnit` (numeric mean of o/m/p). */
  mu: number | null;
  /** Resolved σ in `options.timeUnit` (Beta-PERT std dev). */
  sigma: number | null;
  /**
   * Criticality index from Monte Carlo (0–1). `null` when MC is off or
   * when this activity is downstream of a TBD.
   */
  criticality: number | null;
}

/** Resolved hammock/cluster group. */
export interface ResolvedGroup {
  group: PertGroup;
  /** Aggregate μ/σ along the group's internal critical path. */
  rolledMu: number | null;
  rolledSigma: number | null;
  /** Group entry/exit ids derived in Pass 2. */
  entries: string[];
  exits: string[];
}

/**
 * Bare shape for a Monte-Carlo simulation result; Phase 2 fills it.
 * Keeping the shape exported in v1 means analyzer consumers don't break
 * when MC support lands.
 */
export interface MonteCarloResult {
  /** Trials run (canonical or fast). */
  trials: number;
  /** Seed used for deterministic reproduction. */
  seed: number;
  /** Project-completion percentiles. */
  p50: number;
  p80: number;
  p95: number;
  /** Per-activity criticality index, keyed by activity id. */
  criticalityByActivity: Record<string, number>;
  /** Modal-longest-path tuple (activity ids). */
  modalCriticalPath: string[];
}

/**
 * Per-activity (O, M, P) in canonical days — the analyzer's
 * expanded-estimate cache, populated for every activity that has an
 * estimate (TBDs are omitted). Workers re-running Monte Carlo on an
 * already-resolved PERT can read this directly instead of re-parsing
 * + re-expanding from source.
 */
export interface PertExpandedActivity {
  id: string;
  o: number;
  m: number;
  p: number;
}

export interface ResolvedPert {
  options: PertOptions;
  activities: ResolvedActivity[];
  edges: PertEdge[];
  groups: ResolvedGroup[];
  /** μ along the M-world critical path (max EF over all activities). */
  projectMu: number | null;
  /** σ along the M-world critical path (sqrt of variance sum). */
  projectSigma: number | null;
  /** Critical-path activity ids in topological order. */
  criticalPath: string[];
  /** Phase 2: populated when `options.analysis === 'monte-carlo'`. */
  monteCarloResult: MonteCarloResult | null;
  /**
   * Per-activity (O, M, P) in canonical days. Always populated; used
   * by Phase 3b Worker / scrubber so the simulator can re-run on a
   * postMessage-cloned ResolvedPert without needing the original
   * ParsedPert or analyzer state.
   */
  expandedActivities: PertExpandedActivity[];
  diagnostics: DgmoError[];
  error: string | null;
}

// ── Layout result ───────────────────────────────────────────

export interface PertLayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PertLayoutEdge {
  source: string;
  target: string;
  points: { x: number; y: number }[];
}

export interface PertLayoutGroup {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  classification: 'hammock' | 'cluster';
}

export interface LayoutResult {
  nodes: PertLayoutNode[];
  edges: PertLayoutEdge[];
  groups: PertLayoutGroup[];
  width: number;
  height: number;
}
