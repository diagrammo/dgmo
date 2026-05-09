// ============================================================
// PERT Analyzer — forward/backward pass + critical path + project μ/σ
// ============================================================
//
// Phase 1 scope: M-world analytical PERT only. Phase 2 wires Monte
// Carlo into `monteCarloResult`.
//
// TBD-poison-downstream semantics: activities with a null duration
// propagate null through every descendant's ES/EF/LS/LF/slack; if any
// TBD is upstream of the project end, projectMu and projectSigma are
// also null. Cycles emit a diagnostic naming at least one offending
// activity (AC2.5).

import { makeDgmoError } from '../diagnostics';
import type { DgmoError } from '../diagnostics';
import type { Duration, DurationUnit } from '../gantt/types';
import type {
  ParsedPert,
  PertEdge,
  PertGroup,
  ResolvedActivity,
  ResolvedGroup,
  ResolvedPert,
  MonteCarloResult,
} from './types';
import type { DurationEstimate } from './internal';
import { resolveConfidence, CONFIDENCE_TABLE } from './internal';
import { simulateCanonical, type ExpandedActivity } from './monte-carlo';

// ============================================================
// Duration arithmetic helpers
// ============================================================

/** Convert any Duration to a canonical `timeUnit` amount. */
const UNIT_TO_DAYS: Record<DurationUnit, number> = {
  min: 1 / (60 * 24),
  h: 1 / 24,
  d: 1,
  bd: 1, // PERT has no calendar; bd ≈ d for analytical purposes
  w: 7,
  m: 30,
  q: 90,
  y: 365,
  s: 14, // fallback; sprints aren't really PERT-native
};

function toDays(d: Duration): number {
  return d.amount * UNIT_TO_DAYS[d.unit];
}

function fromDays(days: number, unit: DurationUnit): number {
  return days / UNIT_TO_DAYS[unit];
}

// ============================================================
// Estimate expansion (M-only heuristic + Beta-PERT μ/σ)
// ============================================================

interface ExpandedEstimate {
  /** Optimistic, in canonical days. */
  o: number;
  /** Most-likely, in canonical days. */
  m: number;
  /** Pessimistic, in canonical days. */
  p: number;
  /** Beta-PERT mean = (O + 4M + P) / 6. */
  mean: number;
  /** Beta-PERT std dev = (P − O) / 6. */
  sigma: number;
}

function expandEstimate(
  estimate: DurationEstimate,
  diagramConfidence: string,
  activityConfidence: string | undefined
): ExpandedEstimate {
  const o = toDays(estimate.o);
  const m = toDays(estimate.m);
  const p = toDays(estimate.p);

  // Heuristic-pending sentinel: parser set `mOnly = true` when only a
  // single M token was given. Expand using confidence factors.
  let oFinal = o;
  let pFinal = p;
  if (estimate.mOnly) {
    const fromActivity = activityConfidence
      ? resolveConfidence(activityConfidence)
      : null;
    const factors =
      fromActivity ??
      resolveConfidence(diagramConfidence) ??
      CONFIDENCE_TABLE.medium;
    oFinal = m * factors.oFactor;
    pFinal = m * factors.pFactor;
  }

  const mean = (oFinal + 4 * m + pFinal) / 6;
  const sigma = (pFinal - oFinal) / 6;
  return { o: oFinal, m, p: pFinal, mean, sigma };
}

// ============================================================
// analyzePert
// ============================================================

export function analyzePert(parsed: ParsedPert): ResolvedPert {
  const diagnostics: DgmoError[] = [...parsed.diagnostics];
  const error = (line: number, msg: string): void => {
    diagnostics.push(makeDgmoError(line, msg, 'error'));
  };

  const activities = parsed.activities;
  const edges = parsed.edges;

  // Build successor/predecessor maps keyed by activity id.
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  for (const a of activities) {
    successors.set(a.id, []);
    predecessors.set(a.id, []);
  }
  for (const e of edges) {
    successors.get(e.source)?.push(e.target);
    predecessors.get(e.target)?.push(e.source);
  }

  // Topological sort (Kahn's algorithm). On cycle, emit diagnostic.
  const topo: string[] = [];
  const inDegree = new Map<string, number>();
  for (const a of activities)
    inDegree.set(a.id, predecessors.get(a.id)!.length);
  const queue: string[] = [];
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id);

  while (queue.length > 0) {
    const id = queue.shift()!;
    topo.push(id);
    for (const next of successors.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  if (topo.length < activities.length) {
    // Surviving in-degree > 0 means cycle. Pick the first surviving id.
    const culprit = activities.find((a) => (inDegree.get(a.id) ?? 0) > 0);
    if (culprit) {
      error(culprit.lineNumber, `Cycle detected involving "${culprit.name}".`);
    } else {
      error(0, `Cycle detected in PERT graph.`);
    }
    // Bail out — analysis on a cyclic graph is meaningless.
    return emptyResolved(parsed, diagnostics);
  }

  // Expand all estimates up-front (canonical days).
  const expandedById = new Map<string, ExpandedEstimate | null>();
  for (const a of activities) {
    if (a.duration === null) {
      expandedById.set(a.id, null);
      continue;
    }
    expandedById.set(
      a.id,
      expandEstimate(a.duration, parsed.options.confidence, a.confidence)
    );
  }

  // Compute the poisoned set: any activity transitively downstream of a
  // TBD activity. Run BFS from TBD nodes outward.
  const poisoned = new Set<string>();
  for (const a of activities) {
    if (a.duration === null) {
      const stack = [a.id];
      poisoned.add(a.id);
      while (stack.length > 0) {
        const id = stack.pop()!;
        for (const next of successors.get(id) ?? []) {
          if (!poisoned.has(next)) {
            poisoned.add(next);
            stack.push(next);
          }
        }
      }
    }
  }

  // Forward pass: ES/EF for each non-poisoned activity, in topo order.
  const es = new Map<string, number | null>();
  const ef = new Map<string, number | null>();
  for (const id of topo) {
    if (poisoned.has(id)) {
      es.set(id, null);
      ef.set(id, null);
      continue;
    }
    const preds = predecessors.get(id)!;
    const preEf =
      preds.length === 0 ? 0 : Math.max(...preds.map((p) => ef.get(p)!));
    es.set(id, preEf);
    const expanded = expandedById.get(id)!;
    ef.set(id, preEf + expanded.mean);
  }

  // Project μ = max(EF) over terminal activities (no successors).
  // If ANY terminal is poisoned, projectMu becomes null — the actual
  // project end is unknowable until TBDs are estimated. Per AC2.3 +
  // AC3.3a: poisoned terminals invalidate the analytical projectMu;
  // partial-graph MC mode can still run over the un-poisoned subgraph
  // and report subgraph stats (Phase 2).
  let projectMuDays: number | null = null;
  let endId: string | null = null;
  let anyTerminalPoisoned = false;
  for (const a of activities) {
    const succ = successors.get(a.id) ?? [];
    if (succ.length > 0) continue;
    if (poisoned.has(a.id)) {
      anyTerminalPoisoned = true;
      continue;
    }
    const efVal = ef.get(a.id);
    if (efVal != null && (projectMuDays === null || efVal > projectMuDays)) {
      projectMuDays = efVal;
      endId = a.id;
    }
  }
  if (anyTerminalPoisoned) {
    projectMuDays = null;
    endId = null;
  }

  // Backward pass: LS/LF.
  const ls = new Map<string, number | null>();
  const lf = new Map<string, number | null>();
  // Initialize all non-poisoned activities' LF to projectMu (or to their
  // own EF when they are dead-ends with smaller EF — that gives them
  // slack equal to projectMu - EF). Standard PERT convention is LF =
  // projectMu for terminal nodes, then back-propagate via min.
  for (const a of activities) {
    if (poisoned.has(a.id) || projectMuDays === null) {
      ls.set(a.id, null);
      lf.set(a.id, null);
    } else {
      lf.set(a.id, projectMuDays);
      const exp = expandedById.get(a.id)!;
      ls.set(a.id, projectMuDays - exp.mean);
    }
  }
  // Walk topo in reverse.
  for (let i = topo.length - 1; i >= 0; i--) {
    const id = topo[i];
    if (poisoned.has(id) || projectMuDays === null) continue;
    const succ = successors.get(id) ?? [];
    if (succ.length === 0) continue; // already initialized to projectMu
    const minLs = Math.min(...succ.map((s) => ls.get(s)!));
    lf.set(id, minLs);
    const exp = expandedById.get(id)!;
    ls.set(id, minLs - exp.mean);
  }

  // Critical path = walk backward from `endId` taking the predecessor
  // with maximum EF (ties broken by predecessor source-order). This
  // gives a single chain through the M-world longest path.
  const criticalPath: string[] = [];
  if (endId !== null) {
    let cursor: string | null = endId;
    while (cursor !== null) {
      criticalPath.unshift(cursor);
      const preds: string[] = predecessors.get(cursor) ?? [];
      if (preds.length === 0) break;
      let bestPred: string | null = null;
      let bestEf = -Infinity;
      for (const pid of preds) {
        const efp = ef.get(pid);
        if (efp != null && efp > bestEf) {
          bestEf = efp;
          bestPred = pid;
        }
      }
      cursor = bestPred;
    }
  }
  const criticalSet = new Set(criticalPath);

  // Project σ: sqrt(sum of variances on critical path).
  let projectSigmaDays: number | null = null;
  if (projectMuDays !== null && criticalPath.length > 0) {
    let varSum = 0;
    for (const id of criticalPath) {
      const exp = expandedById.get(id);
      if (exp) varSum += exp.sigma * exp.sigma;
    }
    projectSigmaDays = Math.sqrt(varSum);
  }

  // Render activity records (convert canonical days back to options.timeUnit).
  const unit = parsed.options.timeUnit;
  const resolvedActivities: ResolvedActivity[] = activities.map((a) => {
    const exp = expandedById.get(a.id);
    const slackDays =
      ls.get(a.id) !== null && es.get(a.id) !== null
        ? (ls.get(a.id) as number) - (es.get(a.id) as number)
        : null;
    return {
      activity: a,
      es: nullableToUnit(es.get(a.id) ?? null, unit),
      ef: nullableToUnit(ef.get(a.id) ?? null, unit),
      ls: nullableToUnit(ls.get(a.id) ?? null, unit),
      lf: nullableToUnit(lf.get(a.id) ?? null, unit),
      slack: nullableToUnit(slackDays, unit),
      isCriticalPath: criticalSet.has(a.id),
      mu: exp ? fromDays(exp.mean, unit) : null,
      sigma: exp ? fromDays(exp.sigma, unit) : null,
      criticality: null,
    };
  });

  // Resolved groups: μ/σ rolled up along a path through the group. When
  // MC is on (Phase 2), the rollup uses the modal-longest-path observed
  // across trials; otherwise the M-world critical path.
  let monteCarloResult: MonteCarloResult | null = null;

  if (parsed.options.analysis === 'monte-carlo') {
    const allTerminalsPoisoned = activities
      .filter((a) => (successors.get(a.id) ?? []).length === 0)
      .every((a) => poisoned.has(a.id));
    if (allTerminalsPoisoned && activities.length > 0) {
      const tbdNames = activities
        .filter((a) => a.duration === null)
        .map((a) => `"${a.name}"`)
        .join(', ');
      error(
        0,
        `Cannot run Monte Carlo — every project-end path is downstream of an unestimated activity. Estimate at least one of: ${tbdNames}.`
      );
    } else {
      const expandedArr: ExpandedActivity[] = [];
      for (const a of activities) {
        const exp = expandedById.get(a.id);
        if (exp) expandedArr.push({ id: a.id, o: exp.o, m: exp.m, p: exp.p });
      }
      // Build a preliminary ResolvedPert just for the simulator's graph
      // shape. The simulator uses only `activities` (for ids) and `edges`.
      const prelim: ResolvedPert = {
        options: parsed.options,
        activities: resolvedActivities,
        edges,
        groups: [],
        projectMu: null,
        projectSigma: null,
        criticalPath,
        monteCarloResult: null,
        expandedActivities: expandedArr,
        diagnostics: [],
        error: null,
      };
      monteCarloResult = simulateCanonical(prelim, expandedArr, {
        trials: parsed.options.trials,
        seed: parsed.options.seed,
      });
      // Populate per-activity criticality on the resolved activities.
      for (const ra of resolvedActivities) {
        if (poisoned.has(ra.activity.id)) continue;
        const c = monteCarloResult.criticalityByActivity[ra.activity.id];
        ra.criticality = typeof c === 'number' ? c : null;
      }
    }
  }

  // For hammock rollup: use MC-derived modal-longest-path when MC is on.
  const rollupSet =
    monteCarloResult && monteCarloResult.modalCriticalPath.length > 0
      ? new Set(monteCarloResult.modalCriticalPath)
      : criticalSet;
  const resolvedGroups: ResolvedGroup[] = parsed.groups.map((g) =>
    rollupGroup(g, expandedById, rollupSet, unit)
  );

  // Always populate the public expanded-activities cache so Workers
  // (Phase 3b) can re-run the simulator without needing the original
  // ParsedPert. TBDs are omitted; the simulator already treats absent
  // entries as zero-duration.
  const publicExpanded: ExpandedActivity[] = [];
  for (const a of activities) {
    const exp = expandedById.get(a.id);
    if (exp) publicExpanded.push({ id: a.id, o: exp.o, m: exp.m, p: exp.p });
  }

  return {
    options: parsed.options,
    activities: resolvedActivities,
    edges,
    groups: resolvedGroups,
    projectMu: projectMuDays === null ? null : fromDays(projectMuDays, unit),
    projectSigma:
      projectSigmaDays === null ? null : fromDays(projectSigmaDays, unit),
    criticalPath,
    monteCarloResult,
    expandedActivities: publicExpanded,
    diagnostics,
    error: parsed.error ?? firstFatal(diagnostics),
  };
}

// ============================================================
// Helpers
// ============================================================

function nullableToUnit(
  value: number | null,
  unit: DurationUnit
): number | null {
  return value === null ? null : fromDays(value, unit);
}

function firstFatal(diagnostics: DgmoError[]): string | null {
  const f = diagnostics.find((d) => d.severity === 'error');
  return f ? f.message : null;
}

function rollupGroup(
  group: PertGroup,
  expandedById: Map<string, ExpandedEstimate | null>,
  criticalSet: Set<string>,
  unit: DurationUnit
): ResolvedGroup {
  let muDays = 0;
  let varDays = 0;
  let usable = false;
  for (const id of group.activityIds) {
    if (!criticalSet.has(id)) continue;
    const exp = expandedById.get(id);
    if (!exp) continue;
    muDays += exp.mean;
    varDays += exp.sigma * exp.sigma;
    usable = true;
  }
  return {
    group,
    rolledMu: usable ? fromDays(muDays, unit) : null,
    rolledSigma: usable ? fromDays(Math.sqrt(varDays), unit) : null,
    entries: [],
    exits: [],
  };
}

function emptyResolved(
  parsed: ParsedPert,
  diagnostics: DgmoError[]
): ResolvedPert {
  return {
    options: parsed.options,
    activities: parsed.activities.map((a) => ({
      activity: a,
      es: null,
      ef: null,
      ls: null,
      lf: null,
      slack: null,
      isCriticalPath: false,
      mu: null,
      sigma: null,
      criticality: null,
    })),
    edges: parsed.edges,
    groups: parsed.groups.map((g) => ({
      group: g,
      rolledMu: null,
      rolledSigma: null,
      entries: [],
      exits: [],
    })),
    projectMu: null,
    projectSigma: null,
    criticalPath: [],
    monteCarloResult: null,
    expandedActivities: [],
    diagnostics,
    error: firstFatal(diagnostics) ?? parsed.error,
  };
}

// Re-export `_unused` markers so lint doesn't complain (PertEdge is read above).
export type { PertEdge };
