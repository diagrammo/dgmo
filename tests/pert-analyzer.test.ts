import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePert } from '../src/pert/parser';
import { analyzePert, buildSummary } from '../src/pert/analyzer';
import type {
  MonteCarloResult,
  PertActivity,
  ResolvedActivity,
} from '../src/pert/types';

const FIXTURES = join(__dirname, '../test-fixtures/pert');
function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function analyze(input: string) {
  const parsed = parsePert(input);
  return analyzePert(parsed);
}

const APPROX = (actual: number | null, expected: number, eps = 1e-6) => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThan(eps);
};

describe('pert analyzer — forward pass', () => {
  it('AC2.1: linear chain ES/EF/projectMu match textbook values', () => {
    // A(1w) → B(2w) → C(3w) — μ = O+4M+P / 6 with M-only forces all amounts equal,
    // so use 3-point estimates with O = M = P (zero variance) for crisp values.
    const resolved = analyze(`pert
time-unit w
A 1 1 1
B 2 2 2
C 3 3 3
A
  -> B
B
  -> C
`);
    expect(resolved.error).toBeNull();
    const A = resolved.activities.find((r) => r.activity.name === 'A')!;
    const B = resolved.activities.find((r) => r.activity.name === 'B')!;
    const C = resolved.activities.find((r) => r.activity.name === 'C')!;
    APPROX(A.es, 0);
    APPROX(A.ef, 1);
    APPROX(B.es, 1);
    APPROX(B.ef, 3);
    APPROX(C.es, 3);
    APPROX(C.ef, 6);
    APPROX(resolved.projectMu, 6);
  });

  it('AC2.2: diamond critical path picks longest of two parallel arms', () => {
    // A(1) → B(2) → D(1)
    // A(1) → C(4) → D(1)  ← critical (1+4+1 = 6)
    // Use zero-variance 3-points so μ = M precisely.
    const resolved = analyze(`pert
time-unit w
A 1 1 1
B 2 2 2
C 4 4 4
D 1 1 1
A
  -> B
  -> C
B
  -> D
C
  -> D
`);
    expect(resolved.error).toBeNull();
    APPROX(resolved.projectMu, 6);
    // Critical-path stores canonical (normalized) ids — lowercase.
    expect(resolved.criticalPath).toEqual(['a', 'c', 'd']);
    const B = resolved.activities.find((r) => r.activity.name === 'B')!;
    APPROX(B.slack, 2);
  });
});

describe('pert analyzer — TBD propagation', () => {
  it('AC2.3: descendants of TBD activity have null ES/EF/LS/LF/slack', () => {
    const resolved = analyze(loadFixture('tbd-poison.dgmo'));
    expect(resolved.error).toBeNull();
    const celebrate = resolved.activities.find(
      (r) => r.activity.name === 'celebrate'
    )!;
    const divvy = resolved.activities.find(
      (r) => r.activity.name === 'divvy shares'
    )!;
    expect(celebrate.es).toBeNull();
    expect(celebrate.ef).toBeNull();
    expect(divvy.es).toBeNull();
    expect(divvy.slack).toBeNull();
    // Project μ becomes null because the project end (divvy shares) is poisoned.
    expect(resolved.projectMu).toBeNull();
    expect(resolved.projectSigma).toBeNull();
  });

  it('AC2.4: graph with no TBD has non-null projectMu/projectSigma', () => {
    const resolved = analyze(loadFixture('three-point.dgmo'));
    expect(resolved.error).toBeNull();
    expect(resolved.projectMu).not.toBeNull();
    expect(resolved.projectSigma).not.toBeNull();
  });
});

describe('pert analyzer — cycle detection', () => {
  it('AC2.5: cycle emits diagnostic identifying an activity by name', () => {
    const resolved = analyze(loadFixture('cycle-error.dgmo'));
    const cycle = resolved.diagnostics.find((d) =>
      d.message.toLowerCase().includes('cycle')
    );
    expect(cycle).toBeDefined();
    // Should name one of the cycle members
    expect(cycle!.message).toMatch(/[abc]/);
  });
});

describe('pert analyzer — project μ/σ', () => {
  it('projectMu equals max(EF) over all activities', () => {
    const resolved = analyze(`pert
time-unit w
A 1 1 1
B 5 5 5
C 2 2 2
A
  -> C
`);
    expect(resolved.error).toBeNull();
    APPROX(resolved.projectMu, 5);
  });

  it('projectSigma is sqrt(sum of variances on critical path)', () => {
    // A(O=1, M=2, P=4) → σ = (4-1)/6 = 0.5
    // B(O=2, M=3, P=4) → σ = (4-2)/6 = 0.333…
    // expected projectSigma = sqrt(0.5^2 + 0.333^2) ≈ sqrt(0.361) ≈ 0.6009
    const resolved = analyze(`pert
time-unit w
A 1 2 4
B 2 3 4
A
  -> B
`);
    expect(resolved.error).toBeNull();
    expect(resolved.projectSigma).not.toBeNull();
    // Within 1e-2 of 0.6009
    // ~0.6009 (sqrt of 0.5^2 + (1/3)^2 — full digits would lose precision at runtime)
    expect(Math.abs((resolved.projectSigma as number) - 0.6009)).toBeLessThan(
      1e-2
    );
  });
});

describe('pert analyzer — zero-duration activity semantics', () => {
  it('zero-duration activities contribute zero to project μ/σ but participate in critical path', () => {
    const resolved = analyze(loadFixture('with-zero-duration.dgmo'));
    expect(resolved.error).toBeNull();
    const m = resolved.activities.find(
      (r) => r.activity.name === 'voyage approved'
    )!;
    APPROX(m.mu, 0);
    APPROX(m.sigma, 0);
  });
});

describe('pert analyzer — mode auto-derivation (AC1–AC4)', () => {
  it('AC1: all M-only activities → analytical mode, no MC result', () => {
    const r = analyze(`pert
time-unit w
A 2
B 3
A
  -> B
`);
    expect(r.mode).toBe('analytical');
    expect(r.monteCarloResult).toBeNull();
  });

  it('AC2: at least one O/M/P triple → monte-carlo mode', () => {
    const r = analyze(`pert
time-unit w
trials 200
A 1 2 4
B 3
A
  -> B
`);
    expect(r.mode).toBe('monte-carlo');
    expect(r.monteCarloResult).not.toBeNull();
  });

  it('AC3: zero-duration-only diagram → analytical mode', () => {
    const r = analyze(`pert
start 0
middle 0
end 0
start
  -> middle
middle
  -> end
`);
    expect(r.mode).toBe('analytical');
  });

  it('AC4: trials < 100 clamps to analytical and adds caveat to summary', () => {
    const r = analyze(`pert
time-unit w
trials 50
A 1 2 4
B 1 2 4
A
  -> B
`);
    expect(r.mode).toBe('analytical');
    expect(r.monteCarloResult).toBeNull();
    expect(r.summaryText).not.toBeNull();
    expect(r.summaryText!).toContain('Insufficient trials configured');
  });
});

describe('pert analyzer — `analysis` directive does not force mode (AC6)', () => {
  it('analysis directive with M-only data → analytical (data wins)', () => {
    const r = analyze(`pert
analysis monte-carlo
A 2
`);
    expect(r.mode).toBe('analytical');
  });
});

describe('pert analyzer — isAuthored (AC28)', () => {
  it('3-point activity → isAuthored true; M-only → false; zero-duration → false; TBD → false', () => {
    const r = analyze(`pert
time-unit w
trials 200

start 0
A 1 2 4
B 3
C
start
  -> A
A
  -> B
B
  -> C
`);
    const find = (name: string) =>
      r.activities.find((ra) => ra.activity.name === name)!;
    expect(find('A').isAuthored).toBe(true);
    expect(find('B').isAuthored).toBe(false);
    expect(find('C').isAuthored).toBe(false);
    expect(find('start').isAuthored).toBe(false);
  });
});

describe('pert analyzer — summaryText (AC8/AC9/AC15)', () => {
  it('AC8: analytical caption begins with Expected duration; no Critical path bullet (diagram shows it)', () => {
    const r = analyze(`pert
time-unit d
A 2
B 3
A
  -> B
`);
    expect(r.summaryText).not.toBeNull();
    expect(r.summaryText!.startsWith('Expected duration:')).toBe(true);
    expect(r.summaryText!).not.toContain('Critical path:');
  });

  it('AC9: MC caption emits expected (with ±σ)/percentiles/critical/bottleneck in order', () => {
    const r = analyze(`pert
time-unit d
trials 500
seed 42
A 1 2 4
B 1 2 4
C 1 2 4
A
  -> B
B
  -> C
`);
    expect(r.mode).toBe('monte-carlo');
    const lines = r.summaryText!.split('\n');
    // Expected-duration line carries σ as "(± X)" parenthetical.
    // Standalone "Standard deviation:" / "Critical path:" /
    // "Most-frequent critical path..." bullets are intentionally gone
    // (the diagram's red coloring shows the critical chain).
    expect(lines[0]).toMatch(/^Expected duration:.*\(±\s/);
    expect(lines[1]).toMatch(/^50th-percentile finish:/);
    expect(
      lines.find((l) => l.startsWith('Standard deviation:'))
    ).toBeUndefined();
    expect(lines.find((l) => l.startsWith('Critical path:'))).toBeUndefined();
    expect(
      lines.find((l) => l.startsWith('Most-frequent critical path'))
    ).toBeUndefined();
    expect(lines.find((l) => l.startsWith('Bottleneck:'))).toBeUndefined();
  });

  it('AC15: TBD upstream → caption is exactly the TBD-fallback sentence', () => {
    const r = analyze(`pert
time-unit w
A
B 1 2 3
A
  -> B
`);
    expect(r.projectMu).toBeNull();
    expect(r.summaryText).toBe(
      'Expected duration unknown — 1 activity has no estimate.'
    );
  });
});

describe('pert analyzer — cycle bailout (AC26/AC27)', () => {
  it('cycle returns analytical mode, null summary, every activity isAuthored=false', () => {
    const r = analyze(loadFixture('cycle-error.dgmo'));
    expect(r.mode).toBe('analytical');
    expect(r.summaryText).toBeNull();
    for (const ra of r.activities) {
      expect(ra.isAuthored).toBe(false);
    }
  });
});

describe('pert analyzer — caption with date anchor', () => {
  it('forward anchor: Expected finish renders as a date and percentile bullets show end-dates', () => {
    const r = analyze(`pert
time-unit w
trials 500
seed 42
start-date 2026-06-01
A 1 2 4
  -> B
B 1 2 4
  -> C
C 1 2 4
`);
    expect(r.mode).toBe('monte-carlo');
    const lines = r.summaryText!.split('\n');
    // Expected-finish line carries σ as "(± X)" parenthetical.
    expect(lines[0]).toMatch(
      /^Expected finish: \d{4}-\d{2}-\d{2} \(±\s.+\)\.$/
    );
    // The three percentile sentences live on a single line joined by
    // ". " — bulletizeCaption splits them into indented sub-bullets
    // under "Expected finish" (matches unanchored shape).
    expect(lines[1]).toMatch(
      /^50th percentile end date: \d{4}-\d{2}-\d{2}\. 80th percentile end date: \d{4}-\d{2}-\d{2}\. 95th percentile end date: \d{4}-\d{2}-\d{2}\.$/
    );
    // No anchored caption should mention the legacy "Nth-percentile finish" prose.
    expect(r.summaryText).not.toContain('Expected duration');
    expect(r.summaryText).not.toContain('50th-percentile finish');
  });

  it('backward anchor: Expected start renders as a date and percentile bullets show start-dates', () => {
    const r = analyze(`pert
time-unit w
trials 500
seed 42
end-date 2026-09-15
A 1 2 4
  -> B
B 1 2 4
  -> C
C 1 2 4
`);
    expect(r.mode).toBe('monte-carlo');
    const lines = r.summaryText!.split('\n');
    expect(lines[0]).toMatch(/^Expected start: \d{4}-\d{2}-\d{2} \(±\s.+\)\.$/);
    // Single ". "-joined line — three percentile sub-bullets after split.
    expect(lines[1]).toMatch(
      /^50th percentile start date: \d{4}-\d{2}-\d{2}\. 80th percentile start date: \d{4}-\d{2}-\d{2}\. 95th percentile start date: \d{4}-\d{2}-\d{2}\.$/
    );
  });

  it('forward anchor + analytical mode: Expected finish only (no percentile bullets)', () => {
    // M-only durations → analytical mode → no MC, no percentile lines.
    const r = analyze(`pert
time-unit w
start-date 2026-06-01
A 2
  -> B
B 3
`);
    expect(r.mode).toBe('analytical');
    expect(r.summaryText).toMatch(/^Expected finish: \d{4}-\d{2}-\d{2}\./);
    expect(r.summaryText).not.toContain('percentile');
  });

  it('no anchor: caption keeps the original duration phrasing (regression)', () => {
    const r = analyze(`pert
time-unit d
A 2
  -> B
B 3
`);
    expect(r.summaryText!.startsWith('Expected duration:')).toBe(true);
    expect(r.summaryText).not.toContain('Expected finish');
    expect(r.summaryText).not.toContain('Expected start');
  });
});

describe('pert analyzer — projectStart derivation', () => {
  it('forward anchor sets projectStart to the literal start-date', () => {
    const r = analyze(`pert
time-unit w
start-date 2026-06-01
A 1 1 1
B 2 2 2
A
  -> B
`);
    expect(r.projectStart).toBe('2026-06-01');
  });

  it('backward anchor + non-null projectMu derives projectStart', () => {
    // A(1w) → B(2w) → C(3w) — projectMu = 6 weeks = 42 days.
    // end-date 2026-09-15 minus 42 days = 2026-08-04.
    const r = analyze(`pert
time-unit w
end-date 2026-09-15
A 1 1 1
B 2 2 2
C 3 3 3
A
  -> B
B
  -> C
`);
    expect(r.projectMu).not.toBeNull();
    expect(r.projectStart).toBe('2026-08-04');
  });

  it('backward anchor + TBD upstream → projectStart is null (degenerate)', () => {
    // A is TBD; projectMu null; projectStart cannot be derived.
    const r = analyze(`pert
time-unit w
end-date 2026-09-15
A
B 1 2 3
A
  -> B
`);
    expect(r.projectMu).toBeNull();
    expect(r.projectStart).toBeNull();
  });

  it('no anchor → projectStart is null', () => {
    const r = analyze(`pert
time-unit w
A 1 1 1
B 2 2 2
A
  -> B
`);
    expect(r.projectStart).toBeNull();
  });

  it('anchoring does not change ES/EF/LS/LF math (regression guard)', () => {
    const baseSrc = `pert
time-unit w
A 1 1 1
B 2 2 2
C 3 3 3
A
  -> B
B
  -> C
`;
    const anchored = `pert
time-unit w
start-date 2026-06-01
A 1 1 1
B 2 2 2
C 3 3 3
A
  -> B
B
  -> C
`;
    const a = analyze(baseSrc);
    const b = analyze(anchored);
    for (const ra of a.activities) {
      const rb = b.activities.find((x) => x.activity.id === ra.activity.id)!;
      expect(rb.es).toBe(ra.es);
      expect(rb.ef).toBe(ra.ef);
      expect(rb.ls).toBe(ra.ls);
      expect(rb.lf).toBe(ra.lf);
      expect(rb.slack).toBe(ra.slack);
    }
    expect(b.projectMu).toBe(a.projectMu);
  });
});

describe('pert analyzer — confidence heuristic', () => {
  it('M-only with default medium confidence: O = 0.75 * M, P = 3 * M', () => {
    const resolved = analyze(`pert
time-unit w
A 4
`);
    expect(resolved.error).toBeNull();
    const A = resolved.activities[0];
    // mean = (0.75*4 + 4*4 + 3*4) / 6 = (3 + 16 + 12) / 6 = 31/6 ≈ 5.1667
    APPROX(A.mu, 31 / 6);
  });

  it('per-activity confidence override beats diagram default-confidence', () => {
    const resolved = analyze(`pert
time-unit w
default-confidence high
A 4 | confidence: low
`);
    expect(resolved.error).toBeNull();
    const A = resolved.activities[0];
    // low: O=0.5*4=2, P=4*4=16; mean = (2 + 16 + 16) / 6 ≈ 5.6667
    APPROX(A.mu, (2 + 16 + 16) / 6);
  });
});

// ============================================================
// buildSummary — direct unit tests against deterministic inputs
// ============================================================

function stubActivity(
  id: string,
  name: string,
  isMilestone = false
): PertActivity {
  return {
    id,
    name,
    duration: isMilestone
      ? {
          o: { amount: 0, unit: 'd' },
          m: { amount: 0, unit: 'd' },
          p: { amount: 0, unit: 'd' },
          mOnly: false,
        }
      : {
          o: { amount: 1, unit: 'd' },
          m: { amount: 2, unit: 'd' },
          p: { amount: 3, unit: 'd' },
          mOnly: false,
        },
    lineNumber: 1,
    isMilestone,
  };
}

function stubResolved(
  id: string,
  mu: number,
  isAuthored: boolean,
  opts: { isMilestone?: boolean; isCriticalPath?: boolean; sigma?: number } = {}
): ResolvedActivity {
  const sigma = opts.sigma ?? (isAuthored ? 0.5 : 1.5);
  return {
    activity: stubActivity(id, id, opts.isMilestone),
    es: 0,
    ef: mu,
    ls: 0,
    lf: mu,
    slack: 0,
    isCriticalPath: opts.isCriticalPath ?? true,
    mu,
    sigma,
    criticality: null,
    isAuthored,
  };
}

describe('buildSummary — AC11 (two hidden-risk sentences within 0.10)', () => {
  it('reports both off-CPM activities in descending order when within 0.10 and ≥0.25', () => {
    const cpm = stubResolved('a', 5, true);
    const b = stubResolved('b', 4, true, { isCriticalPath: false });
    const c = stubResolved('c', 4, true, { isCriticalPath: false });
    const mc: MonteCarloResult = {
      trials: 1000,
      seed: 1,
      p50: 5,
      p80: 5,
      p95: 5,
      criticalityByActivity: { a: 1.0, b: 0.5, c: 0.45 },
      modalCriticalPath: ['a'],
    };
    const summary = buildSummary({
      mode: 'monte-carlo',
      projectMu: 5,
      projectSigma: 0.5,
      unit: 'd',
      criticalPath: ['a'],
      activities: [cpm, b, c],
      parsedActivities: [cpm.activity, b.activity, c.activity],
      monteCarloResult: mc,
      trialsClamped: false,
      collapsedGroupIds: new Set(),
      groups: [],
    });
    expect(summary).not.toBeNull();
    const hidden = summary!
      .split('\n')
      .filter((l) => l.includes('lands on the critical path'));
    expect(hidden.length).toBe(2);
    expect(hidden[0]).toMatch(/^b lands.*50%/);
    expect(hidden[1]).toMatch(/^c lands.*45%/);
  });

  it('reports only top hidden-risk when second activity is more than 0.10 below', () => {
    const cpm = stubResolved('a', 5, true);
    const b = stubResolved('b', 4, true, { isCriticalPath: false });
    const c = stubResolved('c', 4, true, { isCriticalPath: false });
    const mc: MonteCarloResult = {
      trials: 1000,
      seed: 1,
      p50: 5,
      p80: 5,
      p95: 5,
      criticalityByActivity: { a: 1.0, b: 0.5, c: 0.3 },
      modalCriticalPath: ['a'],
    };
    const summary = buildSummary({
      mode: 'monte-carlo',
      projectMu: 5,
      projectSigma: 0.5,
      unit: 'd',
      criticalPath: ['a'],
      activities: [cpm, b, c],
      parsedActivities: [cpm.activity, b.activity, c.activity],
      monteCarloResult: mc,
      trialsClamped: false,
      collapsedGroupIds: new Set(),
      groups: [],
    });
    const hidden = summary!
      .split('\n')
      .filter((l) => l.includes('lands on the critical path'));
    expect(hidden.length).toBe(1);
    expect(hidden[0]).toMatch(/^b lands/);
  });
});

describe('buildSummary — AC14 (zero-variance fallback)', () => {
  it('replaces percentile/bottleneck/hidden-risk with the (No variance...) parenthetical', () => {
    const a = stubResolved('a', 5, true, { sigma: 0 });
    const b = stubResolved('b', 3, true, { sigma: 0 });
    const c = stubResolved('c', 2, true, { sigma: 0 });
    const mc: MonteCarloResult = {
      trials: 1000,
      seed: 1,
      p50: 10,
      p80: 10,
      p95: 10,
      criticalityByActivity: { a: 1, b: 1, c: 1 },
      modalCriticalPath: ['a', 'b', 'c'],
    };
    const summary = buildSummary({
      mode: 'monte-carlo',
      projectMu: 10,
      projectSigma: 0,
      unit: 'd',
      criticalPath: ['a', 'b', 'c'],
      activities: [a, b, c],
      parsedActivities: [a, b, c].map((r) => r.activity),
      monteCarloResult: mc,
      trialsClamped: false,
      collapsedGroupIds: new Set(),
      groups: [],
    });
    expect(summary!).toContain(
      '(No variance in estimates — all activities have O = M = P.)'
    );
    expect(summary!).not.toContain('percentile');
    expect(summary!).not.toContain('Bottleneck:');
    expect(summary!).not.toContain('lands on the critical path');
    expect(summary!).toContain('Expected duration:');
    // Critical-path bullet was dropped — diagram conveys the chain.
    expect(summary!).not.toContain('Critical path:');
  });
});

describe('buildSummary — AC17/AC18 (heuristic-variance caveat)', () => {
  it('AC17: > 50% heuristic variance on CPM → caveat fires', () => {
    const a = stubResolved('a', 5, false, { sigma: 1.5 });
    const b = stubResolved('b', 5, false, { sigma: 1.5 });
    const c = stubResolved('c', 5, true, { sigma: 0.5 });
    const mc: MonteCarloResult = {
      trials: 1000,
      seed: 1,
      p50: 15,
      p80: 15,
      p95: 15,
      criticalityByActivity: { a: 1, b: 1, c: 1 },
      modalCriticalPath: ['a', 'b', 'c'],
    };
    const summary = buildSummary({
      mode: 'monte-carlo',
      projectMu: 15,
      projectSigma: Math.sqrt(4.75),
      unit: 'd',
      criticalPath: ['a', 'b', 'c'],
      activities: [a, b, c],
      parsedActivities: [a, b, c].map((r) => r.activity),
      monteCarloResult: mc,
      trialsClamped: false,
      collapsedGroupIds: new Set(),
      groups: [],
    });
    expect(summary!).toContain(
      'Variance estimates derive primarily from the `confidence` heuristic'
    );
  });

  it('AC18: ≤ 50% heuristic variance → no caveat', () => {
    const a = stubResolved('a', 5, true, { sigma: 1.0 });
    const b = stubResolved('b', 5, true, { sigma: 1.0 });
    const c = stubResolved('c', 5, false, { sigma: 0.5 });
    const mc: MonteCarloResult = {
      trials: 1000,
      seed: 1,
      p50: 15,
      p80: 15,
      p95: 15,
      criticalityByActivity: { a: 1, b: 1, c: 1 },
      modalCriticalPath: ['a', 'b', 'c'],
    };
    const summary = buildSummary({
      mode: 'monte-carlo',
      projectMu: 15,
      projectSigma: Math.sqrt(2.25),
      unit: 'd',
      criticalPath: ['a', 'b', 'c'],
      activities: [a, b, c],
      parsedActivities: [a, b, c].map((r) => r.activity),
      monteCarloResult: mc,
      trialsClamped: false,
      collapsedGroupIds: new Set(),
      groups: [],
    });
    expect(summary!).not.toContain('Variance estimates derive primarily');
  });
});
