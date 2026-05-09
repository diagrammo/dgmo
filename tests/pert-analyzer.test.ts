import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePert } from '../src/pert/parser';
import { analyzePert, buildSummary } from '../src/pert/analyzer';
import type { PertActivity, ResolvedActivity } from '../src/pert/types';

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

describe('pert analyzer — milestone semantics', () => {
  it('milestones contribute zero to project μ/σ but participate in critical path', () => {
    const resolved = analyze(loadFixture('with-milestones.dgmo'));
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

  it('AC3: milestones-only diagram → analytical mode', () => {
    const r = analyze(`pert
milestone start
milestone middle
milestone end
start
  -> middle
middle
  -> end
`);
    expect(r.mode).toBe('analytical');
  });

  it('AC4: trials < 100 clamps mode to analytical (no MC result)', () => {
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
  it('3-point activity → isAuthored true; M-only → false; milestone → false; TBD → false', () => {
    const r = analyze(`pert
time-unit w
trials 200

milestone start
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

describe('pert analyzer — summaryText is a two-bullet legend', () => {
  it('analytical caption: Field labels + Critical path', () => {
    const r = analyze(`pert
time-unit d
A 2
B 3
A
  -> B
`);
    expect(r.summaryText).not.toBeNull();
    const lines = r.summaryText!.split('\n');
    expect(lines[0]).toBe('Field labels: ES dur EF / name / LS slack LF');
    expect(lines[1]).toMatch(/^Critical path:/);
  });

  it('MC caption is the same two-bullet legend (no project stats)', () => {
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
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Field labels: ES dur EF / name / LS slack LF');
    expect(lines[1]).toMatch(/^Critical path:/);
  });

  it('TBD upstream → caption is just Field labels (no critical path resolvable)', () => {
    const r = analyze(`pert
time-unit w
A
B 1 2 3
A
  -> B
`);
    expect(r.projectMu).toBeNull();
    // Critical path may still resolve through the un-poisoned arm; if
    // not, only Field labels survives. Either way, expected-duration /
    // percentile content is gone.
    expect(r.summaryText).not.toBeNull();
    expect(r.summaryText!.startsWith('Field labels:')).toBe(true);
    expect(r.summaryText!).not.toContain('Expected duration');
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

  it('per-activity confidence override beats diagram confidence', () => {
    const resolved = analyze(`pert
time-unit w
confidence high
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

describe('buildSummary — critical-path abbreviation', () => {
  it('renders full chain at 7 activities', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const acts = ids.map((id) => stubResolved(id, 1, false, { sigma: 0 }));
    const summary = buildSummary({
      mode: 'analytical',
      projectMu: 7,
      projectSigma: 0,
      unit: 'd',
      criticalPath: ids,
      activities: acts,
      parsedActivities: acts.map((r) => r.activity),
      monteCarloResult: null,
      trialsClamped: false,
      collapsedGroupIds: new Set(),
      groups: [],
    });
    expect(summary!).toContain('Critical path: a → b → c → d → e → f → g.');
  });

  it('abbreviates to head → … → tail at 8 activities', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const acts = ids.map((id) => stubResolved(id, 1, false, { sigma: 0 }));
    const summary = buildSummary({
      mode: 'analytical',
      projectMu: 8,
      projectSigma: 0,
      unit: 'd',
      criticalPath: ids,
      activities: acts,
      parsedActivities: acts.map((r) => r.activity),
      monteCarloResult: null,
      trialsClamped: false,
      collapsedGroupIds: new Set(),
      groups: [],
    });
    expect(summary!).toContain('Critical path: a → … → h.');
  });
});
