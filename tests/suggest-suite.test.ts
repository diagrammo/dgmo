// ============================================================
// suggest-suite.test.ts — deterministic CI gate over the curated prompt suite.
//
// Runs tests/fixtures/prompt-suite.json through suggestChartTypes and gates on
// selection accuracy + per-type retrievability. This is the Layer-1 (every
// commit, blocking) half of the generation-quality story: it catches a trigger
// regression the moment it lands, and names the offending prompt. The
// non-deterministic generation half (claude -p) lives in scripts/eval-tools.mjs
// (--live), run on a schedule / pre-release.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { suggestChartTypes, chartTypes } from '@diagrammo/dgmo/advanced';
import { extractTypeBlock } from '../scripts/lib/ref-anchors.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const suite: { prompt: string; accept: string[] }[] = JSON.parse(
  readFileSync(join(repo, 'tests/fixtures/prompt-suite.json'), 'utf8')
).cases;
const refMd = readFileSync(join(repo, 'docs/language-reference.md'), 'utf8');
const validIds = new Set(chartTypes.map((c) => c.id));

// Thresholds — raise as the scorer improves; never silently lower.
const TOP1_MIN = 90;
const TOP3_MIN = 95;

describe('prompt-suite fixture integrity', () => {
  it('every `accept` id is a real chart type', () => {
    const bad = suite
      .flatMap((c) => c.accept)
      .filter((id) => !validIds.has(id));
    expect(
      [...new Set(bad)],
      `unknown accept ids: ${[...new Set(bad)].join(', ')}`
    ).toEqual([]);
  });
});

describe('suggest_chart_type lands in the accepted set (per prompt: top-3)', () => {
  for (const { prompt, accept } of suite) {
    it(`"${prompt.slice(0, 50)}…" → ${accept.join('/')}`, () => {
      const top3 = suggestChartTypes(prompt)
        .ranked.slice(0, 3)
        .map((r) => r.type.id);
      expect(
        top3.some((id) => accept.includes(id)),
        `got [${top3.join(', ')}], expected one of [${accept.join(', ')}]`
      ).toBe(true);
    });
  }
});

describe('aggregate selection accuracy meets the gate', () => {
  const results = suite.map(({ prompt, accept }) => {
    const top3 = suggestChartTypes(prompt)
      .ranked.slice(0, 3)
      .map((r) => r.type.id);
    return {
      top1: !!top3[0] && accept.includes(top3[0]),
      top3: top3.some((id) => accept.includes(id)),
    };
  });
  const pct = (n: number) => Math.round((n / results.length) * 100);

  it(`top-1 ≥ ${TOP1_MIN}%`, () => {
    expect(pct(results.filter((r) => r.top1).length)).toBeGreaterThanOrEqual(
      TOP1_MIN
    );
  });
  it(`top-3 ≥ ${TOP3_MIN}%`, () => {
    expect(pct(results.filter((r) => r.top3).length)).toBeGreaterThanOrEqual(
      TOP3_MIN
    );
  });
});

describe('every suggested type is retrievable (Tier-1 slice exists)', () => {
  it('the top pick for each prompt resolves to a TYPE block', () => {
    const unresolved = suite
      .map(({ prompt }) => suggestChartTypes(prompt).ranked[0]?.type.id)
      .filter((id): id is string => !!id)
      .filter((id) => !extractTypeBlock(refMd, id));
    expect(unresolved, `no slice for: ${unresolved.join(', ')}`).toEqual([]);
  });
});
