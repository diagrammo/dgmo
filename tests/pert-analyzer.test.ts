import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePert } from '../src/pert/parser';
import { analyzePert, buildSummary } from '../src/pert/analyzer';
import type {
  CaptionRow,
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

/**
 * Legacy compatibility shim. The analyzer now emits `summaryRows`
 * (structured) instead of `summaryText`; many existing tests still
 * assert on the joined text form, so this rebuilds that string from
 * the row list. Backward-mode caption tests use `summaryRows` directly.
 */
function summaryText(rows: CaptionRow[] | null): string | null {
  if (rows === null) return null;
  return rows.map((r) => r.text).join('\n');
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
    expect(summaryText(r.summaryRows)).not.toBeNull();
    expect(summaryText(r.summaryRows)!).toContain(
      'Insufficient trials configured'
    );
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

describe('pert analyzer — summaryText (AC8/AC9/AC15)', () => {
  it('AC8: analytical caption begins with Expected duration; no Critical path bullet (diagram shows it)', () => {
    const r = analyze(`pert
time-unit d
A 2
B 3
A
  -> B
`);
    expect(summaryText(r.summaryRows)).not.toBeNull();
    expect(summaryText(r.summaryRows)!.startsWith('Expected duration:')).toBe(
      true
    );
    expect(summaryText(r.summaryRows)!).not.toContain('Critical path:');
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
    const lines = summaryText(r.summaryRows)!.split('\n');
    // Expected-duration line carries σ as "(± X)" parenthetical.
    // Per spec §13A.10 the percentile rows now use the uniform
    // "P{X}: <duration>" shape (no anchor → bare duration).
    // Standalone "Standard deviation:" / "Critical path:" /
    // "Most-frequent critical path..." bullets are intentionally gone
    // (the diagram's red coloring shows the critical chain).
    expect(lines[0]).toMatch(/^Expected duration:.*\(±\s/);
    expect(lines[1]).toMatch(/^P50:/);
    expect(lines[2]).toMatch(/^P80:/);
    expect(lines[3]).toMatch(/^P95:/);
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
    expect(summaryText(r.summaryRows)).toBe(
      'Expected duration unknown — 1 activity has no estimate.'
    );
  });
});

describe('pert analyzer — cycle bailout (AC26/AC27)', () => {
  it('cycle returns analytical mode, null summary, every activity isAuthored=false', () => {
    const r = analyze(loadFixture('cycle-error.dgmo'));
    expect(r.mode).toBe('analytical');
    expect(summaryText(r.summaryRows)).toBeNull();
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
    const lines = summaryText(r.summaryRows)!.split('\n');
    // Expected-finish line carries σ as "(± X)" parenthetical.
    expect(lines[0]).toMatch(
      /^Expected finish: \d{4}-\d{2}-\d{2} \(±\s.+\)\.$/
    );
    // Per spec §13A.10, percentile rows render as one row per
    // percentile (level 1 sub-rows under "Expected finish").
    expect(lines[1]).toMatch(/^P50 finish: \d{4}-\d{2}-\d{2}\.$/);
    expect(lines[2]).toMatch(/^P80 finish: \d{4}-\d{2}-\d{2}\.$/);
    expect(lines[3]).toMatch(/^P95 finish: \d{4}-\d{2}-\d{2}\.$/);
    // No anchored caption should mention the legacy duration phrasing
    // or the pre-refactor "Nth-percentile finish" prose.
    expect(summaryText(r.summaryRows)).not.toContain('Expected duration');
    expect(summaryText(r.summaryRows)).not.toContain('50th-percentile finish');
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
    const lines = summaryText(r.summaryRows)!.split('\n');
    expect(lines[0]).toMatch(/^Expected start: \d{4}-\d{2}-\d{2} \(±\s.+\)\.$/);
    // Per spec §13A.12, backward-mode percentile rows now render as
    // separate "P{X} latest-safe start: <date>" rows (level 1).
    expect(lines[1]).toMatch(/^P50 latest-safe start: \d{4}-\d{2}-\d{2}/);
    expect(lines[2]).toMatch(/^P80 latest-safe start: \d{4}-\d{2}-\d{2}/);
    expect(lines[3]).toMatch(/^P95 latest-safe start: \d{4}-\d{2}-\d{2}/);
  });

  it('forward anchor + analytical mode: Expected finish only (no percentile bullets)', () => {
    // `trials < 100` clamps to analytical → no MC, no percentile lines.
    // (M-only durations now trigger MC via default-confidence; this test
    // uses the trials clamp to exercise the analytical caption path.)
    const r = analyze(`pert
time-unit w
trials 50
start-date 2026-06-01
A 2
  -> B
B 3
`);
    expect(r.mode).toBe('analytical');
    expect(summaryText(r.summaryRows)).toMatch(
      /^Expected finish: \d{4}-\d{2}-\d{2}\./
    );
    expect(summaryText(r.summaryRows)).not.toContain('percentile');
  });

  it('no anchor: caption keeps the original duration phrasing (regression)', () => {
    const r = analyze(`pert
time-unit d
A 2
  -> B
B 3
`);
    expect(summaryText(r.summaryRows)!.startsWith('Expected duration:')).toBe(
      true
    );
    expect(summaryText(r.summaryRows)).not.toContain('Expected finish');
    expect(summaryText(r.summaryRows)).not.toContain('Expected start');
  });
});

// ── Backward-anchor framing tests (tech-spec §13A.10 / §13A.12) ─────

describe('pert analyzer — backward-anchor caption framing (Task 10)', () => {
  // Local-time anchor; matches the parser's `formatLocalISODate(now)`
  // semantics across machines without UTC drift.
  const NOW = new Date(2026, 4, 10);

  function analyzeWithNow(input: string) {
    return analyzePert(parsePert(input, { now: NOW }));
  }

  it('AC 1 + AC 2: backward + MC emits "P{X} latest-safe start" rows with isPast flag', () => {
    const r = analyzeWithNow(loadFixture('backward-monte-carlo.dgmo'));
    expect(r.mode).toBe('monte-carlo');
    const rows = r.summaryRows!;
    // First row is "Expected start: <date> (± σ)." level 0.
    expect(rows[0].text).toMatch(/^Expected start:/);
    // Three level-1 percentile rows follow, in P50/P80/P95 order.
    expect(rows[1].text).toMatch(/^P50 latest-safe start: \d{4}-\d{2}-\d{2}/);
    expect(rows[2].text).toMatch(/^P80 latest-safe start: \d{4}-\d{2}-\d{2}/);
    expect(rows[3].text).toMatch(/^P95 latest-safe start: \d{4}-\d{2}-\d{2}/);
    // Fixture is calibrated so P50/P80 are feasible and P95 is past.
    expect(rows[1].isPast).toBeFalsy();
    expect(rows[2].isPast).toBeFalsy();
    expect(rows[3].isPast).toBe(true);
    expect(rows[3].text).toMatch(/\(latest-safe start has passed\)$/);
  });

  it('AC 4: backward + TBD upstream → `?` placeholders for every percentile', () => {
    const r = analyzeWithNow(`pert
time-unit w
trials 200
end-date 2026-09-15
A
B 1 2 3
A
  -> B
`);
    expect(r.projectMu).toBeNull();
    const rows = r.summaryRows!;
    expect(rows[0].text).toBe('Expected duration: ?');
    expect(rows[1].text).toBe('P50 latest-safe start: ?');
    expect(rows[2].text).toBe('P80 latest-safe start: ?');
    expect(rows[3].text).toBe('P95 latest-safe start: ?');
  });

  it('AC 5: backward + analytical mode emits no percentile rows', () => {
    // Use `trials 50` clamp to land in analytical mode. (M-only now
    // triggers MC via default-confidence, so we can't rely on duration
    // form alone to choose analytical.)
    const r = analyzeWithNow(`pert
time-unit w
trials 50
end-date 2026-09-15
A 2
  -> B
B 3
`);
    expect(r.mode).toBe('analytical');
    const rows = r.summaryRows!;
    expect(rows.every((row) => !row.text.includes('latest-safe start'))).toBe(
      true
    );
    // Expected-start row is still emitted (μ-derived), but no percentile rows.
    expect(rows.some((row) => row.text.startsWith('Expected start:'))).toBe(
      true
    );
  });

  it('AC 6: backward rounding is conservative (latest-safe start lands earlier)', () => {
    // Synthesize a controlled scenario: 50.7-day P80 against
    // end-date 2026-09-15 → 51-day offset → 2026-07-26 latest-safe start
    // (NOT 2026-07-27 which would round the offset down to 50).
    const rows = buildSummary({
      mode: 'monte-carlo',
      projectMu: 50.7,
      projectSigma: 1,
      unit: 'd',
      parsedActivities: [
        {
          id: 'a',
          name: 'a',
          duration: {
            o: { amount: 50, unit: 'd' },
            m: { amount: 51, unit: 'd' },
            p: { amount: 52, unit: 'd' },
          },
          lineNumber: 1,
          isMilestone: false,
        },
      ],
      monteCarloResult: {
        trials: 1000,
        seed: 1,
        p50: 50.5,
        p80: 50.7,
        p95: 51.2,
        p16: 50.2,
        p84: 50.9,
        minDurationDays: 50,
        maxDurationDays: 52,
        criticalityByActivity: { a: 1 },
        modalCriticalPath: ['a'],
        tornadoSwings: [],
      },
      trialsClamped: false,
      anchor: { kind: 'backward', date: '2026-09-15' },
      today: '2026-05-10',
    })!;
    const p80Row = rows.find((row) =>
      row.text.startsWith('P80 latest-safe start:')
    )!;
    // 50.7 → ceil → 51-day offset; end_date − 51d = 2026-07-26.
    expect(p80Row.text).toMatch(/2026-07-26/);
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
A 4 confidence: low
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

describe('buildSummary — AC14 (zero-variance fallback)', () => {
  it('replaces percentile bullets with the (No variance...) parenthetical', () => {
    const a = stubResolved('a', 5, true, { sigma: 0 });
    const b = stubResolved('b', 3, true, { sigma: 0 });
    const c = stubResolved('c', 2, true, { sigma: 0 });
    const mc: MonteCarloResult = {
      trials: 1000,
      seed: 1,
      p50: 10,
      p80: 10,
      p95: 10,
      p16: 10,
      p84: 10,
      minDurationDays: 10,
      maxDurationDays: 10,
      criticalityByActivity: { a: 1, b: 1, c: 1 },
      modalCriticalPath: ['a', 'b', 'c'],
      tornadoSwings: [],
    };
    const rows = buildSummary({
      mode: 'monte-carlo',
      projectMu: 10,
      projectSigma: 0,
      unit: 'd',
      parsedActivities: [a, b, c].map((r) => r.activity),
      monteCarloResult: mc,
      trialsClamped: false,
      today: '',
    });
    const text = summaryText(rows)!;
    expect(text).toContain(
      '(No variance in estimates — all activities have O = M = P.)'
    );
    expect(text).not.toContain('percentile');
    expect(text).toContain('Expected duration:');
    // Critical-path bullet was dropped — diagram conveys the chain.
    expect(text).not.toContain('Critical path:');
  });
});
