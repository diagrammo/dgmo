import { describe, it, expect } from 'vitest';
import { suggestChartTypes } from '../src/chart-type-scoring';
import corpus from './fixtures/suggest-corpus.json';

// Phase-1 quality gate for suggest_chart_type. Runs the real scorer over a
// human-labeled corpus and guards against REGRESSION. A fixed high pass-rate
// threshold is meaningless while the scorer is mid-improvement (baseline is
// only ~15%), so the gate is "never drop below the recorded baseline." When you
// improve the scorer (better triggers / a smarter matcher), RAISE these floors
// to lock the gain in. Iterate interactively with `pnpm cockpit`; regenerate the
// human-readable report with `pnpm suggest-audit`.
//
// Baselines (raise these when you improve the scorer, to lock the gain in):
//   2026-06-04 contiguous-phrase matcher:        top-1 7/46,  top-3 7/46
//   2026-06-04 IDF token-subset matcher (now):   top-1 23/46, top-3 28/46
const BASELINE_TOP1 = 23;
const BASELINE_TOP3 = 28;

interface Entry {
  prompt: string;
  expected: string[];
  note?: string;
}

type Verdict = 'top1' | 'top3' | 'miss';
function grade(entry: Entry): Verdict {
  const r = suggestChartTypes(entry.prompt);
  const ids = r.ranked.map((x) => x.type.id);
  if (r.fellBack) return 'miss';
  if (ids[0] && entry.expected.includes(ids[0])) return 'top1';
  if (ids.slice(0, 3).some((id) => entry.expected.includes(id))) return 'top3';
  return 'miss';
}

describe('suggest_chart_type eval corpus', () => {
  const entries = corpus as Entry[];
  const grades = entries.map(grade);
  const top1 = grades.filter((g) => g === 'top1').length;
  const top3 = grades.filter((g) => g === 'top1' || g === 'top3').length;

  it('corpus is non-trivial', () => {
    expect(entries.length).toBeGreaterThanOrEqual(40);
  });

  it(`top-1 confident-correct does not regress below ${BASELINE_TOP1}/${entries.length}`, () => {
    expect(top1).toBeGreaterThanOrEqual(BASELINE_TOP1);
  });

  it(`expected-in-top-3 does not regress below ${BASELINE_TOP3}/${entries.length}`, () => {
    expect(top3).toBeGreaterThanOrEqual(BASELINE_TOP3);
  });
});
