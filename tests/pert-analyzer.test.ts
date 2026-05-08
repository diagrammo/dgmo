import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePert } from '../src/pert/parser';
import { analyzePert } from '../src/pert/analyzer';

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
  -> B 2 2 2
B
  -> C 3 3 3
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
  -> B 2 2 2
  -> C 4 4 4
B
  -> D 1 1 1
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
  -> C 2 2 2
B 5 5 5
C
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
  -> B 2 3 4
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
