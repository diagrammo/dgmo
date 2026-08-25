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

describe('pert analyzer — edge types and lag/lead', () => {
  it('FS+lag: B.ES = A.EF + lag', () => {
    // A 2d → +3d lag → B 2d
    const r = analyze(`pert
time-unit d
A 2 2 2
B 2 2 2
A
  -3d-> B
`);
    expect(r.error).toBeNull();
    const A = r.activities.find((x) => x.activity.name === 'A')!;
    const B = r.activities.find((x) => x.activity.name === 'B')!;
    expect(A.es).toBe(0);
    expect(A.ef).toBe(2);
    expect(B.es).toBe(5); // A.ef (2) + lag (3) = 5
    expect(B.ef).toBe(7);
    expect(r.projectMu).toBe(7);
  });

  it('SS+lag: B.ES = A.ES + lag (parallel start with offset)', () => {
    // A 5d → SS+1d → B 3d. B starts 1d after A starts; both finish independently.
    const r = analyze(`pert
time-unit d
A 5 5 5
B 3 3 3
A
  -SS+1d-> B
`);
    expect(r.error).toBeNull();
    const A = r.activities.find((x) => x.activity.name === 'A')!;
    const B = r.activities.find((x) => x.activity.name === 'B')!;
    expect(A.es).toBe(0);
    expect(A.ef).toBe(5);
    expect(B.es).toBe(1); // A.ES (0) + 1d
    expect(B.ef).toBe(4); // 1 + 3
    // projectMu = max(EF) over all activities = max(5, 4) = 5
    expect(r.projectMu).toBe(5);
  });

  it('FF+lag: B.EF = A.EF + lag (synchronized finish, B may push later)', () => {
    // A 5d → FF+1d → B 2d. B's EF must be A.EF + 1 = 6, so B.ES = 4.
    const r = analyze(`pert
time-unit d
A 5 5 5
B 2 2 2
A
  -FF+1d-> B
`);
    expect(r.error).toBeNull();
    const B = r.activities.find((x) => x.activity.name === 'B')!;
    expect(B.ef).toBe(6); // A.EF (5) + 1d
    expect(B.es).toBe(4); // 6 - 2 (B's duration)
  });

  it('FS lead (negative lag): B.ES = A.EF − lead', () => {
    // A 5d → FS-2d → B 3d. B starts 2d before A finishes (overlap).
    const r = analyze(`pert
time-unit d
A 5 5 5
B 3 3 3
A
  -FS-2d-> B
`);
    expect(r.error).toBeNull();
    const B = r.activities.find((x) => x.activity.name === 'B')!;
    expect(B.es).toBe(3); // A.EF (5) - 2d = 3
    expect(B.ef).toBe(6);
  });

  it('lead exceeding predecessor duration emits a warning', () => {
    // A 2d → FS-3d → B 2d. Lead (3d) > A.duration (2d) → impossible overlap.
    const r = analyze(`pert
time-unit d
A 2 2 2
B 2 2 2
A
  -FS-3d-> B
`);
    const w = r.diagnostics.find(
      (d) =>
        d.severity === 'warning' &&
        /Lead .* exceeds predecessor/.test(d.message)
    );
    expect(w).toBeDefined();
  });
});

describe('pert analyzer — sprint mode', () => {
  it('time-unit s with default sprint-length (2w) computes durations in sprint units', () => {
    // A 2 sprints, B 1 sprint, FS chain. Expected duration = 3 sprints.
    const r = analyze(`pert
time-unit s
A 2 2 2
B 1 1 1
A
  -> B
`);
    expect(r.error).toBeNull();
    expect(r.options.sprintMode).toBe('auto');
    const A = r.activities.find((x) => x.activity.name === 'A')!;
    const B = r.activities.find((x) => x.activity.name === 'B')!;
    expect(A.es).toBe(0);
    expect(A.ef).toBe(2);
    expect(B.es).toBe(2);
    expect(B.ef).toBe(3);
    expect(r.projectMu).toBe(3);
  });

  it('custom sprint-length is honored end-to-end', () => {
    // With sprint-length 3w (21 days), one sprint = 21 days. So A 2s = 42d.
    // mu in sprint units stays 2; the underlying canonical-day math
    // uses 21 days/sprint instead of the 14-day fallback.
    const r = analyze(`pert
time-unit s
sprint-length 3w
A 2 2 2
B 1 1 1
A
  -> B
`);
    expect(r.error).toBeNull();
    expect(r.options.sprintLength).toEqual({ amount: 3, unit: 'w' });
    const A = r.activities.find((x) => x.activity.name === 'A')!;
    expect(A.ef).toBe(2); // still 2 sprints in display unit
    expect(r.projectMu).toBe(3);
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
  it('AC1: all M-only activities → monte-carlo mode via default-confidence spreads', () => {
    // M-only durations get O/P filled from `default-confidence` (medium by
    // default); the simulator runs on those filled-in triples. Analytical
    // mode already uses those spreads to compute project σ, so MC is the
    // honest extension of that.
    const r = analyze(`pert
time-unit w
trials 500
A 2
B 3
A
  -> B
`);
    expect(r.mode).toBe('monte-carlo');
    expect(r.monteCarloResult).not.toBeNull();
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

  it('AC4: trials < 100 clamps to analytical', () => {
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
    // The clamp used to add a caveat bullet to the Summary card; the card
    // was deleted 2026-08-24 (#455), so the observable consequence is the
    // subtitle dropping its ± parenthetical — there is no simulated spread.
    expect(r.projectSubtitle).not.toBeNull();
    expect(r.projectSubtitle!).not.toContain('±');
  });
});

describe('pert analyzer — `analysis` directive does not force mode (AC6)', () => {
  it('analysis directive is inert; mode is data-driven', () => {
    // The directive is deprecated. Mode comes from data: M-only (with
    // default-confidence spreads) triggers MC. The directive itself
    // neither forces nor blocks it.
    const r = analyze(`pert
analysis monte-carlo
A 2
`);
    expect(r.mode).toBe('monte-carlo');
  });

  it('analysis directive cannot force MC when there is no data to simulate', () => {
    // No durations → nothing to simulate; analytical wins regardless.
    const r = analyze(`pert
analysis monte-carlo
A
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

describe('pert analyzer — cycle bailout (AC26/AC27)', () => {
  it('cycle returns analytical mode, null subtitle, every activity isAuthored=false', () => {
    const r = analyze(loadFixture('cycle-error.dgmo'));
    expect(r.mode).toBe('analytical');
    expect(r.projectSubtitle).toBeNull();
    for (const ra of r.activities) {
      expect(ra.isAuthored).toBe(false);
    }
  });
});

// ── Backward-anchor framing tests (tech-spec §13A.10 / §13A.12) ─────

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
A 4 confidence: low
`);
    expect(resolved.error).toBeNull();
    const A = resolved.activities[0];
    // low: O=0.5*4=2, P=4*4=16; mean = (2 + 16 + 16) / 6 ≈ 5.6667
    APPROX(A.mu, (2 + 16 + 16) / 6);
  });
});
