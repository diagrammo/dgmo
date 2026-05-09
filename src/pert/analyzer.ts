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
      isAuthored: a.duration !== null && !a.duration.mOnly && !a.isMilestone,
    };
  });

  // Resolved groups: μ/σ rolled up along a path through the group. When
  // MC is on, the rollup uses the modal-longest-path observed across
  // trials; otherwise the M-world critical path.
  let monteCarloResult: MonteCarloResult | null = null;

  // Auto-derive mode from data: monte-carlo when at least one
  // non-milestone activity carries a three-point estimate.
  const dataDrivenMC = activities.some((a) => has3PointEstimate(a));
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
        edges,
        groups: [],
        mode: 'monte-carlo',
        summaryText: null,
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
    rollupGroup(g, expandedById, resolvedById, rollupSet, unit)
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
    projectMuDays === null ? null : fromDays(projectMuDays, unit);
  const projectSigmaOut =
    projectSigmaDays === null ? null : fromDays(projectSigmaDays, unit);

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

  // Build the canonical caption (no collapse). Renderer re-invokes with
  // a non-empty collapsed set when groups are collapsed at render time.
  const summaryText = buildSummary({
    mode,
    projectMu: projectMuOut,
    projectSigma: projectSigmaOut,
    unit,
    criticalPath,
    activities: resolvedActivities,
    parsedActivities: activities,
    monteCarloResult,
    trialsClamped,
    collapsedGroupIds: new Set(),
    groups: parsed.groups,
    anchor: parsed.options.anchor,
  });

  return {
    options: parsed.options,
    activities: resolvedActivities,
    edges,
    groups: resolvedGroups,
    mode,
    summaryText,
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
 * True iff the source supplied an explicit O/M/P triple for the
 * activity. Milestones report false (they're zero-duration sentinels,
 * not estimated work).
 */
function has3PointEstimate(a: PertActivity): boolean {
  return a.duration !== null && !a.duration.mOnly && !a.isMilestone;
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
  resolvedById: Map<string, ResolvedActivity>,
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
    rolledMu: usable ? fromDays(muDays, unit) : null,
    rolledSigma: usable ? fromDays(Math.sqrt(varDays), unit) : null,
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

// ============================================================
// Caption (project-stats summary) builder
// ============================================================

/**
 * Build the project-stats caption emitted as `ResolvedPert.summaryText`.
 * Renderer reads the returned string and emits one `<tspan>` per
 * `\n`-delimited line. Returns the empty string if the analyzer
 * produced no output (e.g. cycle bailout) — caller decides whether to
 * map that to `null`.
 */
export interface BuildSummaryInput {
  mode: 'monte-carlo' | 'analytical';
  projectMu: number | null;
  projectSigma: number | null;
  unit: DurationUnit;
  criticalPath: string[];
  activities: ResolvedActivity[];
  parsedActivities: PertActivity[];
  monteCarloResult: MonteCarloResult | null;
  trialsClamped: boolean;
  collapsedGroupIds: ReadonlySet<string>;
  groups: PertGroup[];
  /**
   * Date anchor — when set, "Expected duration" becomes a date and
   * Monte-Carlo percentiles render as ISO dates instead of durations.
   * Forward → end-date bullets; backward → start-date bullets.
   */
  anchor?: Anchor;
}

export function buildSummary(input: BuildSummaryInput): string | null {
  const {
    mode,
    projectMu,
    projectSigma,
    unit,
    criticalPath,
    activities,
    parsedActivities,
    monteCarloResult,
    trialsClamped,
    collapsedGroupIds,
    groups,
  } = input;
  const anchor = input.anchor ?? null;

  if (parsedActivities.length === 0) return null;

  // TBD fallback — no project end resolvable.
  if (projectMu === null) {
    const tbdCount = parsedActivities.filter(
      (a) => a.duration === null && !a.isMilestone
    ).length;
    return `Expected duration unknown — ${tbdCount} ${
      tbdCount === 1 ? 'activity has' : 'activities have'
    } no estimate.`;
  }

  const lines: string[] = [];
  const mc = mode === 'monte-carlo' && monteCarloResult !== null;
  const sigmaPositive = projectSigma !== null && projectSigma > 0;
  const showMcDetail = mc && sigmaPositive;
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const collapsedGroupByMember = new Map<string, string>();
  for (const g of groups) {
    if (!collapsedGroupIds.has(g.id)) continue;
    for (const aid of g.activityIds) collapsedGroupByMember.set(aid, g.id);
  }

  // 1. Expected duration / finish / start — fold σ into a "(± X)"
  // parenthetical when MC ran with σ > 0. Reads more naturally than a
  // separate "Standard deviation:" bullet; for a roughly-normal
  // distribution ±1σ covers ~68% of outcomes.
  // Forward anchor → expected finish date; backward anchor → expected
  // start date (the latest acceptable start that hits end-date with
  // 50% probability under the M-world). No anchor → duration.
  const sigmaParen = showMcDetail
    ? ` (± ${roundForCaption(projectSigma!)} ${pluralizeUnit(projectSigma!, unit)})`
    : '';
  if (anchor && anchor.kind === 'forward') {
    const projectMuDays = projectMu * unitToDays(unit);
    lines.push(
      `Expected finish: ${addCalendarDays(anchor.date, projectMuDays)}${sigmaParen}.`
    );
  } else if (anchor && anchor.kind === 'backward') {
    const projectMuDays = projectMu * unitToDays(unit);
    lines.push(
      `Expected start: ${addCalendarDays(anchor.date, -projectMuDays)}${sigmaParen}.`
    );
  } else {
    const muStr = `${roundForCaption(projectMu)} ${pluralizeUnit(projectMu, unit)}`;
    lines.push(`Expected duration: ${muStr}${sigmaParen}.`);
  }

  // 3. Percentiles
  // Forward anchor → end-date for each percentile (start-date + Pn).
  // Backward anchor → start-date for each percentile (end-date - Pn) —
  // the latest acceptable start that hits end-date with N% probability.
  // No anchor → single combined duration line (existing behavior).
  if (showMcDetail) {
    if (anchor) {
      const direction = anchor.kind === 'forward' ? 1 : -1;
      const noun = anchor.kind === 'forward' ? 'end date' : 'start date';
      // Join the three percentile sentences with ". " so bulletizeCaption
      // splits them into indented sub-bullets under "Expected finish" /
      // "Expected start" — matches the unanchored caption shape.
      const fragments = [50, 80, 95].map((pct, i) => {
        const days = [
          monteCarloResult!.p50,
          monteCarloResult!.p80,
          monteCarloResult!.p95,
        ][i];
        return `${pct}th percentile ${noun}: ${addCalendarDays(anchor.date, direction * days)}`;
      });
      lines.push(fragments.join('. ') + '.');
    } else {
      const p50 = fromDays(monteCarloResult!.p50, unit);
      const p80 = fromDays(monteCarloResult!.p80, unit);
      const p95 = fromDays(monteCarloResult!.p95, unit);
      lines.push(
        `50th-percentile finish: ${formatPercentile(p50, unit)}. ` +
          `80th-percentile: ${formatPercentile(p80, unit)}. ` +
          `95th-percentile: ${formatPercentile(p95, unit)}.`
      );
    }
  }

  // 4. Critical path — intentionally NOT a caption bullet. The diagram
  // already shows the critical chain via red node borders + edge stroke;
  // duplicating the names in text adds noise without information.
  // Modal-vs-deterministic divergence is dropped for the same reason
  // (it only makes sense as a contrast to "Critical path").

  // 6. Bottleneck — intentionally NOT a caption bullet. Calling out a
  // single "longest critical activity" overclaims; on a critical path
  // every activity is a constraint. The diagram itself shows the dur
  // cell on every red-bordered card, and the renderer now emphasizes
  // top-20% activities (bold cell text) so the longest sticks out
  // visually without naming any single one as THE bottleneck.

  // 7. Hidden risk (top 1, optionally a second within 0.10 of the first)
  if (showMcDetail) {
    const hidden = findHiddenRisk(
      criticalPath,
      activities,
      monteCarloResult!.criticalityByActivity
    );
    for (const h of hidden) {
      const groupId = collapsedGroupByMember.get(h.activity.id);
      const group = groupId ? groupsById.get(groupId) : undefined;
      const pct = Math.round(h.criticality * 100);
      if (group) {
        lines.push(
          `${group.name} (collapsed) lands on the critical path in ${pct}% of simulations.`
        );
      } else {
        lines.push(
          `${h.activity.name} lands on the critical path in ${pct}% of simulations.`
        );
      }
    }
  }

  // 8. Heuristic-variance caveat
  if (showMcDetail) {
    const fraction = computeHeuristicVarianceFraction(criticalPath, activities);
    if (fraction > 0.5) {
      lines.push(
        'Variance estimates derive primarily from the `confidence` heuristic; results are indicative.'
      );
    }
  }

  // 9. Zero-variance fallback (replaces percentile/bottleneck/hidden-risk)
  if (mc && projectSigma === 0) {
    const filtered: string[] = lines.filter((line) =>
      line.startsWith('Expected duration:')
    );
    filtered.push(
      '(No variance in estimates — all activities have O = M = P.)'
    );
    return filtered.join('\n');
  }

  // 10. Trials caveat (mode auto-derived to MC then clamped back)
  if (trialsClamped) {
    lines.push(
      'Insufficient trials configured (`trials` < 100) — falling back to deterministic analysis.'
    );
  }

  return lines.join('\n');
}

interface HiddenRiskEntry {
  activity: PertActivity;
  criticality: number;
}

function findHiddenRisk(
  criticalPath: string[],
  activities: ResolvedActivity[],
  criticalityByActivity: Record<string, number>
): HiddenRiskEntry[] {
  const onCpm = new Set(criticalPath);
  const offCpm: HiddenRiskEntry[] = [];
  for (const r of activities) {
    if (onCpm.has(r.activity.id)) continue;
    if (r.activity.isMilestone) continue;
    const c = criticalityByActivity[r.activity.id];
    if (typeof c !== 'number' || c < 0.25) continue;
    offCpm.push({ activity: r.activity, criticality: c });
  }
  if (offCpm.length === 0) return [];
  offCpm.sort((a, b) => b.criticality - a.criticality);
  const top = offCpm[0];
  if (offCpm.length === 1) return [top];
  const second = offCpm[1];
  if (
    second.criticality >= 0.25 &&
    top.criticality - second.criticality <= 0.1
  ) {
    return [top, second];
  }
  return [top];
}

function computeHeuristicVarianceFraction(
  criticalPath: string[],
  activities: ResolvedActivity[]
): number {
  const byId = new Map(activities.map((r) => [r.activity.id, r]));
  let totalVar = 0;
  let heuristicVar = 0;
  for (const id of criticalPath) {
    const r = byId.get(id);
    if (!r || r.activity.isMilestone) continue;
    if (r.sigma === null) continue;
    const v = r.sigma * r.sigma;
    totalVar += v;
    if (!r.isAuthored) heuristicVar += v;
  }
  return totalVar > 0 ? heuristicVar / totalVar : 0;
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
  s: ['day', 'days'],
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
    edges: parsed.edges,
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
    mode: 'analytical',
    summaryText: null,
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
