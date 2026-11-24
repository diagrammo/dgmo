import { describe, it, expect } from 'vitest';
import { parseGoal } from '../src/goal/parser';

function src(bands: number, measures: number, percent = false): string {
  const lines = ['goal Many', 'bands'];
  for (let i = 0; i < bands; i++)
    lines.push(`  ${percent ? `${i + 1}%` : (i + 1) * 10} B${i}`);
  lines.push('target 1000000');
  for (let m = 0; m < measures; m++) lines.push(`[M${m}]`, `actual ${m}`);
  return lines.join('\n');
}

describe('goal inherited bands are shared, not copied (#2274)', () => {
  it('measures inheriting a top-level block hold one bands array', () => {
    const r = parseGoal(src(50, 40));
    expect(r.measures).toHaveLength(40);
    expect(new Set(r.measures.map((m) => m.bands)).size).toBe(1);
  });

  it('retained band objects grow with bands, not bands x measures', () => {
    const distinct = (n: number) => {
      const r = parseGoal(src(n, n));
      return new Set(r.measures.flatMap((m) => m.bands)).size;
    };
    expect(distinct(80)).toBe(80);
  });

  it('percent bands with one shared target are shared too', () => {
    const r = parseGoal(src(20, 10, true));
    expect(new Set(r.measures.map((m) => m.bands)).size).toBe(1);
  });
});
