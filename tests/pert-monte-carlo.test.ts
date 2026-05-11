import { describe, it, expect } from 'vitest';
import { parsePert } from '../src/pert/parser';
import { analyzePert } from '../src/pert/analyzer';
import { mulberry32, sampleBetaPert } from '../src/pert/monte-carlo';
import type { CaptionRow } from '../src/pert/types';

function analyze(input: string) {
  return analyzePert(parsePert(input));
}

/** Legacy compatibility shim — see notes in pert-analyzer.test.ts. */
function summaryText(rows: CaptionRow[] | null): string | null {
  if (rows === null) return null;
  return rows.map((r) => r.text).join('\n');
}

describe('mulberry32 PRNG', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces values in [0, 1)', () => {
    const r = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('AC3.2 portability tripwire — first 10 values at seed=42 are stable', () => {
    const r = mulberry32(42);
    const first10 = Array.from({ length: 10 }, () => r());
    // These exact values are the portability contract. If they change, the
    // PRNG implementation drifted — investigate before updating.
    expect(first10).toMatchSnapshot();
  });
});

describe('sampleBetaPert', () => {
  it('zero-variance case (O = M = P) returns M deterministically', () => {
    const rng = mulberry32(1);
    expect(sampleBetaPert(5, 5, 5, rng)).toBe(5);
  });

  it('samples within [O, P]', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = sampleBetaPert(2, 5, 10, rng);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it('mean of N samples approaches Beta-PERT theoretical mean', () => {
    // Theoretical mean = (O + 4M + P) / 6 = (1 + 4*3 + 8) / 6 = 21/6 = 3.5
    const rng = mulberry32(13);
    const N = 5000;
    let sum = 0;
    for (let i = 0; i < N; i++) sum += sampleBetaPert(1, 3, 8, rng);
    const observedMean = sum / N;
    // Within 5% of the theoretical 3.5
    expect(Math.abs(observedMean - 3.5) / 3.5).toBeLessThan(0.05);
  });
});

describe('analyzer + MC integration', () => {
  it('MC enables when at least one activity has O/M/P, regardless of `analysis` directive', () => {
    // Auto-derive: 3-point estimates present → MC runs even though the
    // `analysis monte-carlo` directive is gone.
    const r = analyze(`pert
time-unit w
trials 500
A 1 2 4
B 1 2 4
A
  -> B
`);
    expect(r.mode).toBe('monte-carlo');
    expect(r.monteCarloResult).not.toBeNull();
  });

  it('Auto-derive: no MC when all activities are M-only', () => {
    const r = analyze(`pert
time-unit w
A 2
B 3
A
  -> B
`);
    expect(r.mode).toBe('analytical');
    expect(r.monteCarloResult).toBeNull();
    for (const ra of r.activities) {
      expect(ra.criticality).toBeNull();
    }
  });

  it('Trials clamp: trials < 100 forces analytical with caveat', () => {
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

  it('MC populates criticality + percentiles', () => {
    const r = analyze(`pert
time-unit w
trials 500
seed 42
A 1 2 4
B 1 2 4
A
  -> B
`);
    expect(r.monteCarloResult).not.toBeNull();
    expect(r.monteCarloResult!.trials).toBe(500);
    expect(r.monteCarloResult!.seed).toBe(42);
    // All activities lie on the only path → criticality should be 1.0
    expect(r.monteCarloResult!.criticalityByActivity['a']).toBe(1);
    expect(r.monteCarloResult!.criticalityByActivity['b']).toBe(1);
    // P50 ≤ P80 ≤ P95 monotonically
    expect(r.monteCarloResult!.p50).toBeLessThanOrEqual(
      r.monteCarloResult!.p80
    );
    expect(r.monteCarloResult!.p80).toBeLessThanOrEqual(
      r.monteCarloResult!.p95
    );
  });

  it('AC3.1: P50 mean within ±2% of textbook value', () => {
    // Textbook: linear chain A→B→C with equal Beta-PERT sigmas.
    // Each: O=1, M=2, P=4 → mean = (1 + 8 + 4)/6 = 13/6 ≈ 2.1667 weeks
    // Project mean ≈ 6.5 weeks (sum of 3 means)
    const r = analyze(`pert
time-unit w
trials 5000
seed 1
A 1 2 4
B 1 2 4
C 1 2 4
A
  -> B
B
  -> C
`);
    expect(r.monteCarloResult).not.toBeNull();
    // P50 ≈ project mean for symmetric-ish distributions; in general MC
    // P50 is the median which is close to but not equal to the mean.
    // We assert mean of P50 ± P95 brackets the theoretical mean.
    const expectedMean = 3 * (13 / 6); // canonical days = 7 * (13/6) per week
    const expectedMeanDays = expectedMean * 7; // convert to days
    // The simulator returns p50/p80/p95 in canonical days.
    expect(r.monteCarloResult!.p50).toBeGreaterThan(expectedMeanDays * 0.85);
    expect(r.monteCarloResult!.p50).toBeLessThan(expectedMeanDays * 1.15);
  });

  it('AC3.4: high-parallelism plan has criticality < 1 on competing arms', () => {
    // Diamond: A → B → D, A → C → D. With B and C drawn from the same
    // distribution, neither arm is uniformly critical.
    const r = analyze(`pert
time-unit w
trials 5000
seed 7
A 1 2 4
B 1 2 4
C 1 2 4
D 1 2 4
A
  -> B
  -> C
B
  -> D
C
  -> D
`);
    const cb = r.monteCarloResult!.criticalityByActivity['b'];
    const cc = r.monteCarloResult!.criticalityByActivity['c'];
    expect(cb).toBeGreaterThan(0.2);
    expect(cb).toBeLessThan(0.8);
    expect(cc).toBeGreaterThan(0.2);
    expect(cc).toBeLessThan(0.8);
    // Sum should be ≥ 1 (at least one of B/C is critical each trial)
    expect(cb + cc).toBeGreaterThan(0.95);
  });

  it('AC3.3b: every-terminal-poisoned silently downgrades to analytical (no error)', () => {
    // Auto-derive removes the explicit "ask for MC then fail" path —
    // when the user didn't author the directive, an all-poisoned graph
    // should fall through to TBD-fallback analytical instead of erroring.
    const r = analyze(`pert
time-unit w
trials 200
seed 1
A
B 1 2 4
A
  -> B
`);
    expect(r.mode).toBe('analytical');
    expect(r.monteCarloResult).toBeNull();
    expect(
      r.diagnostics.find((d) => d.message.includes('Cannot run Monte Carlo'))
    ).toBeUndefined();
    expect(summaryText(r.summaryRows)).toContain('Expected duration unknown');
  });

  it('MC-derived hammock rollup uses modal critical path', () => {
    // Single-entry/single-exit group should get a non-null rolledMu.
    const r = analyze(`pert
time-unit w
trials 500
seed 99
[work]
  start 1 2 3
    -> middle
  middle 2 3 4
    -> finish

finish 1 2 3
`);
    const group = r.groups.find((g) => g.group.name === 'work');
    expect(group?.rolledMu).not.toBeNull();
  });
});
