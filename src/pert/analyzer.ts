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
  Anchor,
  ParsedPert,
  PertActivity,
  PertEdge,
  PertGroup,
  ResolvedActivity,
  ResolvedGroup,
  ResolvedPert,
  MonteCarloResult,
  TornadoSwing,
} from './types';
import type { DurationEstimate } from './internal';
import {
  addCalendarDays,
  resolveConfidence,
  unitToDays,
  CONFIDENCE_TABLE,
} from './internal';
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
  s: 14, // fallback when sprint-length isn't authored; the analyzer
  // overrides this from `options.sprintLength` when in sprint mode.
};

function unitDays(unit: DurationUnit, sprintDaysOverride?: number): number {
  if (unit === 's' && sprintDaysOverride !== undefined) {
    return sprintDaysOverride;
  }
  return UNIT_TO_DAYS[unit];
}

function toDays(d: Duration, sprintDaysOverride?: number): number {
  return d.amount * unitDays(d.unit, sprintDaysOverride);
}

function fromDays(
  days: number,
  unit: DurationUnit,
  sprintDaysOverride?: number
): number {
  return days / unitDays(unit, sprintDaysOverride);
}

function resolveSprintDays(opts: {
  sprintMode: 'auto' | 'explicit' | null;
  sprintLength: Duration | null;
}): number | undefined {
  if (!opts.sprintMode || !opts.sprintLength) return undefined;
  return opts.sprintLength.amount * UNIT_TO_DAYS[opts.sprintLength.unit];
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
  activityConfidence: string | undefined,
  sprintDays?: number
): ExpandedEstimate {
  const o = toDays(estimate.o, sprintDays);
  const m = toDays(estimate.m, sprintDays);
  const p = toDays(estimate.p, sprintDays);

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
  const warn = (line: number, msg: string): void => {
    diagnostics.push(makeDgmoError(line, msg, 'warning'));
  };

  // Sprint mode override: when the diagram opts into sprint mode, the
  // `s` unit means "one sprint" worth of canonical days as configured
  // by `sprint-length`. Without this, every `s` defaults to the 14-day
  // fallback, which silently disagrees with the user's `sprint-length`
  // directive.
  const sprintDays = resolveSprintDays(parsed.options);

  // Build successor/predecessor maps keyed by activity id, plus parallel
  // maps keyed-by-edge-direction so the forward/backward pass can read
  // dep-type and lag for each (source, target) link.
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  const incomingEdges = new Map<string, PertEdge[]>();
  const outgoingEdges = new Map<string, PertEdge[]>();
  for (const a of activities) {
    successors.set(a.id, []);
    predecessors.set(a.id, []);
    incomingEdges.set(a.id, []);
    outgoingEdges.set(a.id, []);
  }
  for (const e of edges) {
    successors.get(e.source)?.push(e.target);
    predecessors.get(e.target)?.push(e.source);
    incomingEdges.get(e.target)?.push(e);
    outgoingEdges.get(e.source)?.push(e);
  }

  // Lead-exceeds-duration validation. For an FS edge with negative lag
  // (lead) of magnitude L, if L > predecessor's duration, the constraint
  // implies B.ES < A.ES — logically impossible without an SS/SF edge.
  // Surface as a warning so the user can correct it; analyzer still
  // computes a schedule (the warning is informational).
  for (const e of edges) {
    if (!e.lag || e.lag.amount >= 0) continue;
    const src = activities.find((a) => a.id === e.source);
    if (!src?.duration) continue;
    const leadDays = -toDays(e.lag, sprintDays);
    const srcDurDays = toDays(src.duration.m, sprintDays);
    if (e.type === 'FS' && leadDays > srcDurDays) {
      warn(
        e.lineNumber,
        `Lead (${-e.lag.amount}${e.lag.unit}) exceeds predecessor "${src.name}" duration — ` +
          `the FS edge implies the successor starts before the predecessor.`
      );
    }
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
      expandEstimate(
        a.duration,
        parsed.options.confidence,
        a.confidence,
        sprintDays
      )
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
  // Each incoming edge contributes a lower bound according to its type:
  //   FS:  B.ES ≥ A.EF + lag        (constrains ES)
  //   SS:  B.ES ≥ A.ES + lag        (constrains ES)
  //   FF:  B.EF ≥ A.EF + lag        (constrains EF)
  //   SF:  B.EF ≥ A.ES + lag        (constrains EF)
  // ES then EF are picked so EF − ES = duration, and both bounds hold.
  const es = new Map<string, number | null>();
  const ef = new Map<string, number | null>();
  for (const id of topo) {
    if (poisoned.has(id)) {
      es.set(id, null);
      ef.set(id, null);
      continue;
    }
    const expanded = expandedById.get(id)!;
    const dur = expanded.mean;

    let esLower = 0;
    let efLower = -Infinity;
    for (const edge of incomingEdges.get(id) ?? []) {
      const aEs = es.get(edge.source);
      const aEf = ef.get(edge.source);
      if (aEs == null || aEf == null) continue;
      const lagDays = edge.lag ? toDays(edge.lag, sprintDays) : 0;
      switch (edge.type) {
        case 'FS':
          esLower = Math.max(esLower, aEf + lagDays);
          break;
        case 'SS':
          esLower = Math.max(esLower, aEs + lagDays);
          break;
        case 'FF':
          efLower = Math.max(efLower, aEf + lagDays);
          break;
        case 'SF':
          efLower = Math.max(efLower, aEs + lagDays);
          break;
      }
    }
    // Pin EF = ES + dur, then bump ES forward if EF-side constraints
    // demand a later finish than ES + dur supports.
    let esVal = esLower;
    let efVal = esVal + dur;
    if (efLower > efVal) {
      efVal = efLower;
      esVal = efVal - dur;
    }
    es.set(id, esVal);
    ef.set(id, efVal);
  }

  // Project μ = max(EF) over all non-poisoned activities. Pure FS graphs
  // have monotonic EF along edges so terminals always carry the project
  // end, but SS/FF/SF edges break that invariant — a non-terminal
  // predecessor can finish after its SS-successor. Considering every
  // activity gives the right answer for any mix of dep types.
  // If ANY terminal is poisoned, projectMu becomes null — the actual
  // project end is unknowable until TBDs are estimated. Per AC2.3 +
  // AC3.3a: poisoned terminals invalidate the analytical projectMu.
  let projectMuDays: number | null = null;
  let endId: string | null = null;
  let anyTerminalPoisoned = false;
  for (const a of activities) {
    const isTerminal = (successors.get(a.id) ?? []).length === 0;
    if (poisoned.has(a.id)) {
      if (isTerminal) anyTerminalPoisoned = true;
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
  // Walk topo in reverse. Each outgoing edge contributes an upper bound:
  //   FS:  A.LF ≤ B.LS − lag
  //   SS:  A.LS ≤ B.LS − lag
  //   FF:  A.LF ≤ B.LF − lag
  //   SF:  A.LS ≤ B.LF − lag
  // LS then LF are picked so LF − LS = duration, and both bounds hold.
  for (let i = topo.length - 1; i >= 0; i--) {
    // In-bounds by loop guard.
    const id = topo[i]!;
    if (poisoned.has(id) || projectMuDays === null) continue;
    const out = outgoingEdges.get(id) ?? [];
    if (out.length === 0) continue; // already initialized to projectMu

    const exp = expandedById.get(id)!;
    const dur = exp.mean;

    let lfUpper = Infinity;
    let lsUpper = Infinity;
    for (const edge of out) {
      const bLs = ls.get(edge.target);
      const bLf = lf.get(edge.target);
      if (bLs == null || bLf == null) continue;
      const lagDays = edge.lag ? toDays(edge.lag, sprintDays) : 0;
      switch (edge.type) {
        case 'FS':
          lfUpper = Math.min(lfUpper, bLs - lagDays);
          break;
        case 'SS':
          lsUpper = Math.min(lsUpper, bLs - lagDays);
          break;
        case 'FF':
          lfUpper = Math.min(lfUpper, bLf - lagDays);
          break;
        case 'SF':
          lsUpper = Math.min(lsUpper, bLf - lagDays);
          break;
      }
    }
    let lfVal = lfUpper;
    let lsVal = lfVal - dur;
    if (lsUpper < lsVal) {
      lsVal = lsUpper;
      lfVal = lsVal + dur;
    }
    lf.set(id, lfVal);
    ls.set(id, lsVal);
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
      es: nullableToUnit(es.get(a.id) ?? null, unit, sprintDays),
      ef: nullableToUnit(ef.get(a.id) ?? null, unit, sprintDays),
      ls: nullableToUnit(ls.get(a.id) ?? null, unit, sprintDays),
      lf: nullableToUnit(lf.get(a.id) ?? null, unit, sprintDays),
      slack: nullableToUnit(slackDays, unit, sprintDays),
      isCriticalPath: criticalSet.has(a.id),
      mu: exp ? fromDays(exp.mean, unit, sprintDays) : null,
      sigma: exp ? fromDays(exp.sigma, unit, sprintDays) : null,
      criticality: null,
      isAuthored: a.duration !== null && !a.duration.mOnly && !a.isMilestone,
    };
  });

  // Resolved groups: μ/σ rolled up along a path through the group. When
  // MC is on, the rollup uses the modal-longest-path observed across
  // trials; otherwise the M-world critical path.
  let monteCarloResult: MonteCarloResult | null = null;

  // Auto-derive mode from data: monte-carlo when at least one
  // non-milestone activity carries a duration. M-only activities count —
  // the parser fills O and P from `default-confidence`, and analytical
  // mode already uses those spreads to compute project σ.
  const dataDrivenMC = activities.some((a) => hasDuration(a));
  // Trials clamp: nonsense percentiles from low-N samples → fall back
  // to analytical and surface the reason in the caption.
  const trialsClamped = dataDrivenMC && parsed.options.trials < 100;
  let mode: 'monte-carlo' | 'analytical' =
    dataDrivenMC && !trialsClamped ? 'monte-carlo' : 'analytical';

  if (mode === 'monte-carlo') {
    const allTerminalsPoisoned = activities
      .filter((a) => (successors.get(a.id) ?? []).length === 0)
      .every((a) => poisoned.has(a.id));
    if (allTerminalsPoisoned && activities.length > 0) {
      // Silently downgrade — the TBD-fallback caption already names
      // the unestimated activities. Erroring would block render even
      // when the user didn't ask for MC explicitly (auto-derive).
      mode = 'analytical';
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
        edges: edges.slice(),
        groups: [],
        tagGroups: parsed.tagGroups.slice(),
        mode: 'monte-carlo',
        projectSubtitle: null,
        projectMu: null,
        projectSigma: null,
        criticalPath,
        projectStart: null,
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
      // True tornado swings — for each activity, hold every other at μ
      // and re-run the deterministic forward pass twice (at O, then at P)
      // to measure how much the project end-date moves. Stored in the MC
      // result so the renderer can paint two-sided bars.
      monteCarloResult.tornadoSwings = computeTornadoSwings(
        activities,
        topo,
        incomingEdges,
        expandedById,
        poisoned,
        monteCarloResult.criticalityByActivity,
        sprintDays
      );
    }
  }

  // For hammock rollup: use MC-derived modal-longest-path when MC is on.
  const rollupSet =
    monteCarloResult && monteCarloResult.modalCriticalPath.length > 0
      ? new Set(monteCarloResult.modalCriticalPath)
      : criticalSet;
  const resolvedById = new Map(
    resolvedActivities.map((r) => [r.activity.id, r])
  );
  const resolvedGroups: ResolvedGroup[] = parsed.groups.map((g) =>
    rollupGroup(g, expandedById, resolvedById, rollupSet, unit, sprintDays)
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

  const projectMuOut =
    projectMuDays === null ? null : fromDays(projectMuDays, unit, sprintDays);
  const projectSigmaOut =
    projectSigmaDays === null
      ? null
      : fromDays(projectSigmaDays, unit, sprintDays);

  // Derive projectStart from the optional anchor. Renderer reads this
  // directly — no mode-specific logic in the presentation layer.
  //   forward  → literal start-date
  //   backward → end-date − projectMu (in calendar days), rounded once
  //   no anchor or backward+TBD upstream → null
  let projectStart: string | null = null;
  const anchor = parsed.options.anchor;
  if (anchor !== null) {
    if (anchor.kind === 'forward') {
      projectStart = anchor.date;
    } else if (anchor.kind === 'backward' && projectMuDays !== null) {
      projectStart = addCalendarDays(anchor.date, -projectMuDays);
    }
  }

  const projectSubtitle = buildProjectSubtitle({
    projectMu: projectMuOut,
    projectSigma: projectSigmaOut,
    unit,
    anchor: parsed.options.anchor,
    mcRan: mode === 'monte-carlo' && monteCarloResult !== null,
  });

  return {
    options: parsed.options,
    activities: resolvedActivities,
    edges: edges.slice(),
    groups: resolvedGroups,
    tagGroups: parsed.tagGroups.slice(),
    mode,
    projectSubtitle,
    projectMu: projectMuOut,
    projectSigma: projectSigmaOut,
    criticalPath,
    projectStart,
    monteCarloResult,
    expandedActivities: publicExpanded,
    diagnostics,
    error: parsed.error ?? firstFatal(diagnostics),
  };
}

/**
 * True iff the activity has a duration we can simulate — either an
 * explicit O/M/P triple or an M-only value (whose O/P are filled from
 * `default-confidence`). Milestones report false (zero-duration
 * sentinels); zero-duration M-only activities also report false since
 * factor × 0 = 0 → no spread for MC to simulate.
 */
function hasDuration(a: PertActivity): boolean {
  if (a.duration === null || a.isMilestone) return false;
  if (a.duration.mOnly) return a.duration.m.amount > 0;
  return true;
}

/**
 * Type-aware deterministic forward pass: project end (max EF across
 * activities) in canonical days, given a duration per activity.
 * Mirrors the edge-aware schedule math in `analyzePert` so SS / FF /
 * SF / lag are honored. Poisoned activities contribute 0 days but
 * still propagate edges (we treat them as zero-duration sentinels).
 */
function computeProjectEndDays(
  activities: readonly PertActivity[],
  topo: string[],
  incomingEdges: Map<string, PertEdge[]>,
  durations: Map<string, number>,
  poisoned: Set<string>,
  sprintDays: number | undefined
): number {
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of topo) {
    const dur = poisoned.has(id) ? 0 : (durations.get(id) ?? 0);
    let esLower = 0;
    let efLower = -Infinity;
    for (const edge of incomingEdges.get(id) ?? []) {
      const aEs = es.get(edge.source) ?? 0;
      const aEf = ef.get(edge.source) ?? 0;
      const lag = edge.lag ? toDays(edge.lag, sprintDays) : 0;
      switch (edge.type) {
        case 'FS':
          esLower = Math.max(esLower, aEf + lag);
          break;
        case 'SS':
          esLower = Math.max(esLower, aEs + lag);
          break;
        case 'FF':
          efLower = Math.max(efLower, aEf + lag);
          break;
        case 'SF':
          efLower = Math.max(efLower, aEs + lag);
          break;
      }
    }
    let esVal = esLower;
    let efVal = esVal + dur;
    if (efLower > efVal) {
      efVal = efLower;
      esVal = efVal - dur;
    }
    es.set(id, esVal);
    ef.set(id, efVal);
  }
  let projectEnd = 0;
  for (const a of activities) {
    const e = ef.get(a.id) ?? 0;
    if (e > projectEnd) projectEnd = e;
  }
  return projectEnd;
}

/**
 * Build true two-sided tornado swings. For each activity:
 *   1. Hold every other activity at its μ
 *   2. Run the forward pass once with this activity = O → low end
 *   3. Run again with this activity = P → high end
 *   4. lowSwing = baseline - low end, highSwing = high end - baseline
 *
 * Returns an array sorted descending by total swing. Milestones,
 * poisoned activities, and activities with zero swing in both
 * directions are excluded.
 */
function computeTornadoSwings(
  activities: readonly PertActivity[],
  topo: string[],
  incomingEdges: Map<string, PertEdge[]>,
  expandedById: Map<string, ExpandedEstimate | null>,
  poisoned: Set<string>,
  criticalityByActivity: Record<string, number>,
  sprintDays?: number
): TornadoSwing[] {
  const meansById = new Map<string, number>();
  for (const a of activities) {
    if (poisoned.has(a.id)) continue;
    const exp = expandedById.get(a.id);
    if (exp) meansById.set(a.id, exp.mean);
  }
  const baseline = computeProjectEndDays(
    activities,
    topo,
    incomingEdges,
    meansById,
    poisoned,
    sprintDays
  );
  const swings: TornadoSwing[] = [];
  for (const a of activities) {
    if (a.isMilestone || a.duration === null || poisoned.has(a.id)) continue;
    const exp = expandedById.get(a.id);
    if (!exp) continue;
    // O ≈ M means zero-width swing — skip the work AND skip the row.
    if (exp.o === exp.m && exp.p === exp.m) continue;

    const lowMap = new Map(meansById);
    lowMap.set(a.id, exp.o);
    const lowEnd = computeProjectEndDays(
      activities,
      topo,
      incomingEdges,
      lowMap,
      poisoned,
      sprintDays
    );

    const highMap = new Map(meansById);
    highMap.set(a.id, exp.p);
    const highEnd = computeProjectEndDays(
      activities,
      topo,
      incomingEdges,
      highMap,
      poisoned,
      sprintDays
    );

    const lowSwing = Math.max(0, baseline - lowEnd);
    const highSwing = Math.max(0, highEnd - baseline);
    if (lowSwing === 0 && highSwing === 0) continue;
    const c = criticalityByActivity[a.id];
    swings.push({
      id: a.id,
      name: a.name,
      lowSwing,
      highSwing,
      criticality: typeof c === 'number' ? c : null,
    });
  }
  swings.sort((a, b) => b.lowSwing + b.highSwing - (a.lowSwing + a.highSwing));
  return swings;
}

// ============================================================
// Helpers
// ============================================================

function nullableToUnit(
  value: number | null,
  unit: DurationUnit,
  sprintDays?: number
): number | null {
  return value === null ? null : fromDays(value, unit, sprintDays);
}

function firstFatal(diagnostics: DgmoError[]): string | null {
  const f = diagnostics.find((d) => d.severity === 'error');
  return f ? f.message : null;
}

function rollupGroup(
  group: PertGroup,
  expandedById: Map<string, ExpandedEstimate | null>,
  resolvedById: Map<string, ResolvedActivity>,
  criticalSet: Set<string>,
  unit: DurationUnit,
  sprintDays?: number
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

  // Schedule envelope across member activities (in source unit, not days).
  let es: number | null = null;
  let ef: number | null = null;
  let ls: number | null = null;
  let lf: number | null = null;
  let criticality: number | null = null;
  for (const id of group.activityIds) {
    const r = resolvedById.get(id);
    if (!r) continue;
    if (r.es !== null) es = es === null ? r.es : Math.min(es, r.es);
    if (r.ef !== null) ef = ef === null ? r.ef : Math.max(ef, r.ef);
    if (r.ls !== null) ls = ls === null ? r.ls : Math.min(ls, r.ls);
    if (r.lf !== null) lf = lf === null ? r.lf : Math.max(lf, r.lf);
    if (r.criticality !== null) {
      criticality =
        criticality === null
          ? r.criticality
          : Math.max(criticality, r.criticality);
    }
  }
  const slack = ls !== null && es !== null ? ls - es : null;

  return {
    group,
    rolledMu: usable ? fromDays(muDays, unit, sprintDays) : null,
    rolledSigma: usable ? fromDays(Math.sqrt(varDays), unit, sprintDays) : null,
    entries: [],
    exits: [],
    es,
    ef,
    ls,
    lf,
    slack,
    criticality,
  };
}

/**
 * Build the one-line project subtitle rendered under the diagram title.
 * This is the ONLY place a PERT diagram prints its headline number: the
 * Summary card that used to restate it below the diagram was deleted on
 * 2026-08-24 (#455) for saying what this line already says.
 *
 * Shape per mode (§13A.7):
 *   - Forward:    `Expected finish: <date> · ≈ <μ> <unit> of work (± <σ>)`
 *   - Backward:   `Expected start: <date> · ≈ <μ> <unit> lead time (± <σ>)`
 *   - Unanchored: `≈ <μ> <unit> (± <σ>)`
 *
 * Returns null when projectMu is indeterminate (TBD upstream) AND no
 * anchor is present — there's nothing useful to say. With an anchor we
 * still render `Expected finish: ? · ≈ ? <unit>` to preserve the slot.
 */
export function buildProjectSubtitle(input: {
  projectMu: number | null;
  projectSigma: number | null;
  unit: DurationUnit;
  anchor?: Anchor;
  /**
   * Whether the Monte Carlo run produced output. The ± parenthetical
   * appears only when the simulation ran with σ > 0 — quoting a spread
   * the simulation never produced would be inventing precision.
   */
  mcRan?: boolean;
}): string | null {
  const anchor = input.anchor ?? null;
  const { projectMu, projectSigma, unit } = input;

  const sigmaPositive = projectSigma !== null && projectSigma > 0;
  // σ carries its unit. A bare number here reads as a fraction of the
  // μ figure beside it, and in the anchored shapes ("≈ 10 weeks of
  // work (± 2)") there is no adjacent unit for it to borrow at all.
  const sigmaParen =
    sigmaPositive && input.mcRan !== false
      ? ` (± ${formatPercentile(projectSigma!, unit)})`
      : '';

  if (projectMu === null) {
    // Anchored + TBD: keep the framing prefix, mark the math as ?.
    if (anchor?.kind === 'forward') {
      return `Expected finish: ? · ≈ ? ${pluralizeUnit(2, unit)} of work`;
    }
    if (anchor?.kind === 'backward') {
      return `Expected start: ? · ≈ ? ${pluralizeUnit(2, unit)} lead time`;
    }
    // Unanchored + TBD: surface that the total is unknown. The per-node
    // `?` placeholders convey which activities are missing estimates.
    return `≈ ? ${pluralizeUnit(2, unit)}`;
  }

  const muStr = `${roundForCaption(projectMu)} ${pluralizeUnit(projectMu, unit)}`;

  if (anchor?.kind === 'forward') {
    const projectMuDays = projectMu * unitToDays(unit);
    return `Expected finish: ${addCalendarDays(anchor.date, projectMuDays)} · ≈ ${muStr} of work${sigmaParen}`;
  }
  if (anchor?.kind === 'backward') {
    const projectMuDays = projectMu * unitToDays(unit);
    return `Expected start: ${addCalendarDays(anchor.date, -projectMuDays)} · ≈ ${muStr} lead time${sigmaParen}`;
  }
  return `≈ ${muStr}${sigmaParen}`;
}

function roundForCaption(n: number): string {
  let rounded: number;
  const abs = Math.abs(n);
  if (abs < 10) rounded = Math.round(n * 100) / 100;
  else if (abs < 100) rounded = Math.round(n * 10) / 10;
  else rounded = Math.round(n);
  // Trim trailing zeros after the decimal: 29.20 → 29.2, 29.00 → 29.
  const str = rounded.toString();
  return str.includes('.') ? str.replace(/\.?0+$/, '') : str;
}

const UNIT_WORDS: Record<DurationUnit, [string, string]> = {
  min: ['minute', 'minutes'],
  h: ['hour', 'hours'],
  d: ['day', 'days'],
  bd: ['business day', 'business days'],
  w: ['week', 'weeks'],
  m: ['month', 'months'],
  q: ['quarter', 'quarters'],
  y: ['year', 'years'],
  s: ['sprint', 'sprints'],
};

function pluralizeUnit(value: number, unit: DurationUnit): string {
  const [singular, plural] = UNIT_WORDS[unit];
  return roundForCaption(value) === '1' ? singular : plural;
}

function formatPercentile(value: number, unit: DurationUnit): string {
  return `${roundForCaption(value)} ${pluralizeUnit(value, unit)}`;
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
      isAuthored: false,
    })),
    edges: parsed.edges.slice(),
    groups: parsed.groups.map((g) => ({
      group: g,
      rolledMu: null,
      rolledSigma: null,
      entries: [],
      exits: [],
      es: null,
      ef: null,
      ls: null,
      lf: null,
      slack: null,
      criticality: null,
    })),
    tagGroups: parsed.tagGroups.slice(),
    mode: 'analytical',
    projectSubtitle: null,
    projectMu: null,
    projectSigma: null,
    criticalPath: [],
    projectStart: null,
    monteCarloResult: null,
    expandedActivities: [],
    diagnostics,
    error: firstFatal(diagnostics) ?? parsed.error,
  };
}

// Re-export `_unused` markers so lint doesn't complain (PertEdge is read above).
export type { PertEdge };
