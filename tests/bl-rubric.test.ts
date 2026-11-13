// The grouped boxes-and-lines rubric (diagrammo/diagrammo#1975).
//
// 1. The hand-drawn target pictures pass every check — the checks are
//    calibrated against what the owner approved, not against the engine.
// 2. The engine is held to a ratchet on the blocking rules (BLOCKING): a
//    failure count may only go down, and when it does the baseline must be
//    lowered in the same change. Non-blocking rules are printed, not asserted.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOCKING, RULES, checkLayout, scoreFixture } from './stress/bl-rubric';
import type { BLLayoutResult } from '../src/boxes-and-lines/layout';
import type { BLGroup } from '../src/boxes-and-lines/types';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const FIXTURES = {
  'storefront-rebuild': [['Frontends'], ['Frontends', 'Core'], ['Identity']],
  'box-office-platform': [['Ticketing Core'], ['Middleware'], ['Media']],
} as const;

/** Blocking-rule failure counts on today's engine, per fixture and state.
 *  Measured 2026-11-13. Lower a number when a fix lowers it; never raise one. */
const BASELINE: Record<
  string,
  Record<string, Partial<Record<number, number>>>
> = JSON.parse(read('tests/stress/bl-rubric-baseline.json'));

describe('grouped layout rubric — targets', () => {
  for (const name of Object.keys(FIXTURES)) {
    it(`${name} target passes every check`, () => {
      const t = JSON.parse(read(`tests/stress/bl-targets/${name}.json`)) as {
        layout: BLLayoutResult;
        groups: { label: string; children: string[] }[];
      };
      const groups = t.groups.map(
        (g) => ({ ...g, lineNumber: 0, metadata: {} }) as unknown as BLGroup
      );
      const failures = [...checkLayout(t.layout, groups, 'LR')].filter(
        ([, m]) => m.length > 0
      );
      expect(failures).toEqual([]);
    });
  }
});

describe('grouped layout rubric — engine ratchet', () => {
  for (const [name, collapses] of Object.entries(FIXTURES)) {
    it(`${name} blocking failures do not grow`, async () => {
      const src = read(`stress/boxes-and-lines/grouped-flow--${name}.dgmo`);
      const states = await scoreFixture(src, collapses);
      const report: string[] = [];
      for (const s of states) {
        const row = RULES.map((r) => `R${r}:${s.failures.get(r)!.length}`);
        report.push(`${name} | ${s.state.padEnd(30)} | ${row.join(' ')}`);
        for (const r of BLOCKING) {
          const got = s.failures.get(r)!.length;
          const max = BASELINE[name]?.[s.state]?.[r] ?? 0;
          expect(
            got,
            `${name} / ${s.state} / rule ${r} grew: ${s.failures.get(r)!.join('; ')}`
          ).toBeLessThanOrEqual(max);
          expect(
            got,
            `${name} / ${s.state} / rule ${r} improved to ${got} — lower the baseline`
          ).toBe(max);
        }
      }
      console.warn(report.join('\n'));
    });
  }
});
