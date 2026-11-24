import { describe, expect, it } from 'vitest';
import { looksLikeSequence } from '../src/sequence/parser';
import { parseSwimlane } from '../src/swimlane/parser';
import { parseSankey } from '../src/data-chart-parser';
import { parseBody } from '../src/body/parser';
import { measureGrowth } from './perf-helpers';

// Line regexes with overlapping quantifiers backtracked on a long run that
// never completed the match (diagrammo/diagrammo#2272). Each test asserts the
// growth exponent between two sizes, never a wall-clock budget.
const LIMIT = 1.5;
const grow = (
  small: number,
  large: number,
  prepare: (n: number) => string,
  run: (s: string) => unknown
) =>
  measureGrowth({
    small,
    large,
    prepare,
    run,
    limit: LIMIT,
    minMs: 5,
    rounds: 3,
    attempts: 3,
  });

describe('line regexes stay linear on a long run that never matches (#2272)', () => {
  it('sequence arrow detection: a line of dashes with no > (looksLikeSequence)', () => {
    const e = grow(
      250,
      1000,
      (n) => '-'.repeat(n),
      (s) => looksLikeSequence(s)
    );
    expect(e).toBeLessThan(LIMIT);
  }, 120_000);

  it('swimlane arrow split: `A ->` then repeated ` -a` tokens', () => {
    const e = grow(
      1000,
      4000,
      (n) => `swimlane T\nlane L\n  A ->${' -a'.repeat(n)}`,
      (s) => parseSwimlane(s)
    );
    expect(e).toBeLessThan(LIMIT);
  }, 120_000);

  it('sankey link regex: `a -> ` repeated on one line', () => {
    const e = grow(
      500,
      2000,
      (n) => `sankey T\n${'a -> '.repeat(n)}`,
      (s) => parseSankey(s)
    );
    expect(e).toBeLessThan(LIMIT);
  }, 120_000);

  it('body meta pair regex: `chest ` then a long word', () => {
    const e = grow(
      1000,
      4000,
      (n) => `body T\nchest ${'a'.repeat(n)}`,
      (s) => parseBody(s)
    );
    expect(e).toBeLessThan(LIMIT);
  }, 120_000);
});

describe('swimlane per-line rescans and diagnostics (#2273, #2274)', () => {
  it('applyMeta artifact dedupe: n lines `B -> A store: s<i>`', () => {
    const e = grow(
      4000,
      16000,
      (n) => {
        const lines = ['swimlane T', 'lane L', '  A', '  B'];
        for (let i = 0; i < n; i++) lines.push(`  B -> A store: s${i}`);
        return lines.join('\n');
      },
      (s) => parseSwimlane(s)
    );
    expect(e).toBeLessThan(LIMIT);
  }, 120_000);

  it('AMBIGUOUS_NODE lists at most 10 lanes plus a count of the rest', () => {
    const n = 60;
    const lines = ['swimlane T'];
    for (let i = 0; i < n; i++) lines.push(`lane L${i}`, '  A');
    lines.push('lane X', '  B -> A -> A');
    const p = parseSwimlane(lines.join('\n'));
    const amb = p.diagnostics.filter((d) => d.code?.includes('AMBIGUOUS_NODE'));
    expect(amb.length).toBeGreaterThan(0);
    for (const d of amb) {
      expect(d.message).toContain('and 50 more');
      expect(d.message).toContain('L9');
      expect(d.message).not.toContain('L10,');
      expect(d.message.length).toBeLessThan(300);
    }
  });
});
