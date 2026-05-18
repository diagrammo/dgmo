// ============================================================
// PERT — Monte Carlo simulation
// ============================================================
//
// Two entry points sharing one Beta-PERT sampler + one PRNG:
//   simulateCanonical(N=10000) — for static export and "computing" runs
//   simulateFast(N=300)        — for the live duration scrubber
//
// Determinism: mulberry32 PRNG with explicit seed; same (seed, inputs)
// → same output across V8/JSC. CI tripwire snapshot pins the first
// 10 trials at seed=42.

import type {
  ResolvedPert,
  MonteCarloResult,
  ResolvedActivity,
  PertEdge,
} from './types';
import { unitToDays } from './internal';
import type { Duration } from '../gantt/types';

function lagDays(lag: Duration | null): number {
  return lag === null ? 0 : lag.amount * unitToDays(lag.unit);
}

// ============================================================
// PRNG
// ============================================================

/**
 * mulberry32: 32-bit seedable PRNG. Portable, deterministic, ~10 lines.
 * Returns a function that yields [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// Beta-PERT sampler
// ============================================================

/** Box-Muller standard normal. */
function standardNormal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Marsaglia-Tsang gamma sampler. Valid for shape α ≥ 1; for α < 1 we
 * boost via the standard `* U^(1/α)` trick. Beta-PERT always has
 * α, β ≥ 1, so the boost path is rarely exercised in practice.
 */
function gamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    const u = rng();
    return gamma(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = standardNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < (x * x) / 2 + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = gamma(alpha, rng);
  const y = gamma(beta, rng);
  return x / (x + y);
}

/**
 * Sample one duration from a Beta-PERT distribution defined by (O, M, P).
 * Zero-variance case (O = M = P) bypasses sampling deterministically.
 */
export function sampleBetaPert(
  o: number,
  m: number,
  p: number,
  rng: () => number
): number {
  if (o === p) return m;
  const range = p - o;
  const alpha = 1 + (4 * (m - o)) / range;
  const beta = 1 + (4 * (p - m)) / range;
  return o + sampleBeta(alpha, beta, rng) * range;
}

// ============================================================
// Simulation
// ============================================================

interface ExpandedActivity {
  id: string;
  o: number;
  m: number;
  p: number;
}

interface SimulationOptions {
  trials: number;
  seed: number;
  /**
   * When true, hard-error if any TBD activity blocks every path to the
   * project end. When false (partial-graph mode), MC runs over the
   * un-poisoned subgraph; downstream path samples treat poisoned
   * activities as 0-duration.
   */
  strict?: boolean;
}

/**
 * Run N trials and accumulate per-activity criticality + completion
 * percentiles + modal-longest-path.
 */
function simulate(
  resolved: ResolvedPert,
  expanded: ExpandedActivity[],
  _predecessors: Map<string, string[]>,
  _successors: Map<string, string[]>,
  topo: string[],
  terminals: string[],
  poisoned: Set<string>,
  opts: SimulationOptions
): MonteCarloResult {
  const rng = mulberry32(opts.seed);
  const expById = new Map<string, ExpandedActivity>();
  for (const e of expanded) expById.set(e.id, e);

  const completionTimes: number[] = new Array(opts.trials);
  const criticalityCount = new Map<string, number>();
  for (const id of topo) criticalityCount.set(id, 0);

  // Modal-longest-path tracking — keyed by tuple-as-string for path identity.
  const pathCount = new Map<string, number>();
  const pathById = new Map<string, string[]>();

  // Index incoming edges by target so the per-trial forward pass can
  // honor each edge's dependency type and lag (FS/SS/FF/SF, ±lag).
  // Without this the simulator would silently treat every edge as FS+0,
  // producing percentile dates that disagree with the deterministic
  // analyzer for any non-default schedule.
  const incomingEdges = new Map<string, PertEdge[]>();
  for (const id of topo) incomingEdges.set(id, []);
  for (const e of resolved.edges) incomingEdges.get(e.target)?.push(e);

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const predOnLongestPath = new Map<string, string | null>();

  for (let trial = 0; trial < opts.trials; trial++) {
    // Sample a duration for each activity in topo order.
    for (const id of topo) {
      const exp = expById.get(id);
      let duration: number;
      if (!exp || poisoned.has(id)) {
        duration = 0;
      } else if (exp.o === exp.p) {
        duration = exp.m;
      } else {
        duration = sampleBetaPert(exp.o, exp.m, exp.p, rng);
      }

      // Collect lower-bound constraints from each incoming edge per its
      // type + lag. Mirrors the analyzer's deterministic forward pass:
      //   FS:  ES ≥ src.EF + lag        SS:  ES ≥ src.ES + lag
      //   FF:  EF ≥ src.EF + lag        SF:  EF ≥ src.ES + lag
      // Track the predecessor whose constraint actually pinned the
      // start time so the modal-path walk can attribute criticality
      // to the right link.
      let esLower = 0;
      let efLower = -Infinity;
      let bestPred: string | null = null;
      let bestPredVal = -Infinity;
      for (const edge of incomingEdges.get(id) ?? []) {
        const aEs = es.get(edge.source) ?? 0;
        const aEf = ef.get(edge.source) ?? 0;
        const lag = lagDays(edge.lag);
        let candES = -Infinity;
        let candEF = -Infinity;
        switch (edge.type) {
          case 'FS':
            candES = aEf + lag;
            break;
          case 'SS':
            candES = aEs + lag;
            break;
          case 'FF':
            candEF = aEf + lag;
            break;
          case 'SF':
            candEF = aEs + lag;
            break;
        }
        if (candES > esLower) esLower = candES;
        if (candEF > efLower) efLower = candEF;
        // For modal-path attribution, weight each edge by its contribution
        // to this activity's effective start time.
        const contribution = Math.max(candES, candEF - duration);
        if (contribution > bestPredVal) {
          bestPredVal = contribution;
          bestPred = edge.source;
        }
      }
      let esVal = esLower;
      let efVal = esVal + duration;
      if (efLower > efVal) {
        efVal = efLower;
        esVal = efVal - duration;
      }
      es.set(id, esVal);
      ef.set(id, efVal);
      predOnLongestPath.set(id, bestPred);
    }

    // Project end = max EF over ALL activities, not just terminals.
    // SS/FF/SF edges break the FS-only invariant that EF is monotonic
    // along edges, so a non-terminal predecessor can finish later than
    // its successor (e.g. SS with small lag + long predecessor).
    let endEf = 0;
    let endId = terminals[0] ?? null;
    for (const id of topo) {
      const e = ef.get(id) ?? 0;
      if (e > endEf) {
        endEf = e;
        endId = id;
      }
    }
    completionTimes[trial] = endEf;

    // Walk back from endId to record this trial's longest-path tuple.
    if (endId !== null) {
      const path: string[] = [];
      let cur: string | null = endId;
      while (cur !== null) {
        path.unshift(cur);
        criticalityCount.set(cur, (criticalityCount.get(cur) ?? 0) + 1);
        cur = predOnLongestPath.get(cur) ?? null;
      }
      const key = path.join(' ');
      pathCount.set(key, (pathCount.get(key) ?? 0) + 1);
      if (!pathById.has(key)) pathById.set(key, path);
    }
  }

  // Percentiles via sort + index.
  completionTimes.sort((a, b) => a - b);
  const pct = (frac: number): number => {
    const idx = Math.min(
      completionTimes.length - 1,
      Math.max(0, Math.floor(frac * completionTimes.length))
    );
    return completionTimes[idx] ?? 0;
  };
  // After sort, min/max are the endpoints. Backward-mode S-curve uses
  // these to bound the candidate-start axis; forward-mode reads them
  // for symmetric x-axis bounds.
  const minDurationDays = completionTimes[0] ?? 0;
  const maxDurationDays = completionTimes[completionTimes.length - 1] ?? 0;

  // Modal critical path with deterministic tiebreak (count desc → variance sum desc → lex).
  let modalKey = '';
  let modalCount = -1;
  for (const [key, count] of pathCount) {
    if (count > modalCount) {
      modalCount = count;
      modalKey = key;
    } else if (count === modalCount) {
      // Tie-break: variance sum, then lex
      const a = pathById.get(modalKey) ?? [];
      const b = pathById.get(key) ?? [];
      const va = pathVariance(a, expById);
      const vb = pathVariance(b, expById);
      if (vb > va) {
        modalKey = key;
      } else if (vb === va && key.localeCompare(modalKey) < 0) {
        modalKey = key;
      }
    }
  }

  const criticalityByActivity: Record<string, number> = {};
  for (const id of topo) {
    criticalityByActivity[id] = (criticalityCount.get(id) ?? 0) / opts.trials;
  }

  return {
    trials: opts.trials,
    seed: opts.seed,
    p50: pct(0.5),
    p80: pct(0.8),
    p95: pct(0.95),
    p16: pct(0.16),
    p84: pct(0.84),
    criticalityByActivity,
    modalCriticalPath: pathById.get(modalKey) ?? [],
    // Analyzer populates this after MC returns by running the
    // deterministic per-activity tornado pass. Empty here so the
    // type contract is satisfied even in scrubber/fast paths that
    // never compute swings.
    tornadoSwings: [],
    minDurationDays,
    maxDurationDays,
  };
}

function pathVariance(
  path: string[],
  expById: Map<string, ExpandedActivity>
): number {
  let sum = 0;
  for (const id of path) {
    const e = expById.get(id);
    if (!e) continue;
    const sigma = (e.p - e.o) / 6;
    sum += sigma * sigma;
  }
  return sum;
}

// ============================================================
// Public entry points
// ============================================================

export interface SimulateOptions {
  trials: number;
  seed: number;
}

/**
 * Build a runnable simulation context from a `ResolvedPert`. The
 * analyzer will call this then invoke `simulateCanonical` /
 * `simulateFast` on the result.
 */
export function buildSimulationContext(resolved: ResolvedPert): {
  predecessors: Map<string, string[]>;
  successors: Map<string, string[]>;
  topo: string[];
  terminals: string[];
  poisoned: Set<string>;
} {
  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const r of resolved.activities) {
    predecessors.set(r.activity.id, []);
    successors.set(r.activity.id, []);
  }
  for (const e of resolved.edges) {
    successors.get(e.source)?.push(e.target);
    predecessors.get(e.target)?.push(e.source);
  }
  const inDegree = new Map<string, number>();
  for (const r of resolved.activities) {
    inDegree.set(r.activity.id, predecessors.get(r.activity.id)!.length);
  }
  const queue: string[] = [];
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id);
  const topo: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    topo.push(id);
    for (const next of successors.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  const terminals: string[] = [];
  for (const r of resolved.activities) {
    if ((successors.get(r.activity.id) ?? []).length === 0) {
      terminals.push(r.activity.id);
    }
  }
  const poisoned = new Set<string>();
  for (const r of resolved.activities) {
    if (r.activity.duration === null) {
      const stack = [r.activity.id];
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (poisoned.has(id)) continue;
        poisoned.add(id);
        for (const next of successors.get(id) ?? []) stack.push(next);
      }
    }
  }
  return { predecessors, successors, topo, terminals, poisoned };
}

/**
 * Canonical simulation — N=10000 by default. Used for static export
 * and the "computing…" Worker job in the app.
 */
export function simulateCanonical(
  resolved: ResolvedPert,
  expanded: ExpandedActivity[],
  opts: SimulateOptions
): MonteCarloResult {
  const ctx = buildSimulationContext(resolved);
  return simulate(
    resolved,
    expanded,
    ctx.predecessors,
    ctx.successors,
    ctx.topo,
    ctx.terminals,
    ctx.poisoned,
    { trials: opts.trials, seed: opts.seed }
  );
}

/**
 * Fast simulation — N=300 by default. Used by the duration scrubber for
 * sub-100ms re-analysis on each rAF tick.
 */
export function simulateFast(
  resolved: ResolvedPert,
  expanded: ExpandedActivity[],
  opts: SimulateOptions
): MonteCarloResult {
  return simulateCanonical(resolved, expanded, opts);
}

// Type-only export used by the analyzer to round-trip the per-activity
// expanded-estimate cache without leaking the analyzer's internal type.
export type { ExpandedActivity };

// Re-export ResolvedActivity to keep the import surface stable for callers.
export type { ResolvedActivity };
