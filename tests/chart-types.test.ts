import { describe, it, expect } from 'vitest';
import { chartTypes } from '../src/chart-types';
import { knownChartTypeIds, getAllChartTypes } from '../src/dgmo-router';
import {
  suggestChartTypes,
  scoreChartType,
  confidence,
  MIN_PRIMARY_SCORE,
  AMBIGUITY_THRESHOLD,
} from '../src/chart-type-scoring';

describe('chartTypes data integrity', () => {
  it('every id matches /^[a-z][a-z0-9-]*$/', () => {
    for (const c of chartTypes) {
      expect(c.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('no duplicate ids', () => {
    const ids = chartTypes.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every type has at least one trigger', () => {
    for (const c of chartTypes) {
      expect(c.triggers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all triggers are ASCII-only', () => {
    for (const c of chartTypes) {
      for (const t of c.triggers) {
        expect(t).toMatch(/^[\x20-\x7e]+$/);
      }
    }
  });

  it('no trigger phrase appears in more than one type', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const c of chartTypes) {
      for (const t of c.triggers) {
        if (seen.has(t)) {
          collisions.push(`"${t}": ${seen.get(t)} vs ${c.id}`);
        } else {
          seen.set(t, c.id);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it('fallback set is exactly the 5 documented ids', () => {
    expect(
      chartTypes
        .filter((c) => c.fallback)
        .map((c) => c.id)
        .sort()
    ).toEqual(['bar', 'boxes-and-lines', 'flowchart', 'line', 'sequence']);
  });
});

describe('parser registry cross-check', () => {
  it('chartTypes ids and knownChartTypeIds cover the same set', () => {
    expect(new Set(chartTypes.map((c) => c.id))).toEqual(
      new Set(knownChartTypeIds)
    );
  });

  it('getAllChartTypes() returns chartTypes in tier order', () => {
    expect(getAllChartTypes()).toEqual(chartTypes.map((c) => c.id));
  });
});

describe('scoring — representative prompts', () => {
  const cases: Array<{ prompt: string; expected: string; label?: string }> = [
    {
      prompt: 'what a customer goes through when they walk into a coffee store',
      expected: 'journey-map',
      label: 'AC1 coffee-store prompt → journey-map',
    },
    { prompt: 'database tables with foreign keys', expected: 'er' },
    { prompt: 'PDCA cycle for kaizen', expected: 'cycle' },
    { prompt: 'show me a sankey diagram of budget', expected: 'sankey' },
    { prompt: 'c4 diagram of our banking system', expected: 'c4' },
    { prompt: 'tech radar for 2026 adoption', expected: 'tech-radar' },
    { prompt: 'sprint plan with task dependencies', expected: 'gantt' },
  ];

  for (const { prompt, expected, label } of cases) {
    it(label ?? `"${prompt}" → ${expected}`, () => {
      const { ranked, fellBack } = suggestChartTypes(prompt);
      expect(fellBack).toBe(false);
      expect(ranked[0]?.type.id).toBe(expected);
    });
  }

  it('"scattered the plot yesterday" does NOT match scatter (word boundary)', () => {
    const { ranked } = suggestChartTypes('I scattered the plot yesterday');
    const scatter = ranked.find((r) => r.type.id === 'scatter');
    // If scatter is present at all, it should not be the top match and should
    // have only description-level score.
    if (scatter) {
      expect(scatter.matched).toEqual([]);
    }
    expect(ranked[0]?.type.id).not.toBe('scatter');
  });

  it('"water diagram of the plant" does NOT match er (substring-vs-token)', () => {
    const { ranked } = suggestChartTypes('water diagram of the plant');
    const er = ranked.find((r) => r.type.id === 'er');
    if (er) expect(er.matched).toEqual([]);
    expect(ranked[0]?.type.id).not.toBe('er');
  });

  it('"water flow in the plant" drops to fallback (description-only)', () => {
    const { fellBack, ranked } = suggestChartTypes('water flow in the plant');
    expect(fellBack).toBe(true);
    expect(ranked[0] === undefined || ranked[0].score < MIN_PRIMARY_SCORE).toBe(
      true
    );
  });

  it('"asdfgh banana xylophone" → zero-match fallback returns flagged types', () => {
    const { ranked, fallback, fellBack } = suggestChartTypes(
      'asdfgh banana xylophone'
    );
    expect(fellBack).toBe(true);
    expect(ranked.filter((r) => r.score >= MIN_PRIMARY_SCORE)).toEqual([]);
    expect(fallback.map((c) => c.id).sort()).toEqual([
      'bar',
      'boxes-and-lines',
      'flowchart',
      'line',
      'sequence',
    ]);
  });

  it('"show me a UML class hierarchy and a state machine" surfaces both types', () => {
    // Both types trigger (class via "uml class" + "class hierarchy", state via
    // "state machine"). class's double-trigger hit means the confidence is
    // "medium", not "ambiguous" — class is the clearer match. The AC is that
    // both concepts surface in the top candidates so Claude can disambiguate.
    const result = suggestChartTypes(
      'show me a UML class hierarchy and a state machine'
    );
    expect(result.fellBack).toBe(false);
    const topTwo = new Set(result.ranked.slice(0, 2).map((r) => r.type.id));
    expect(topTwo.has('class')).toBe(true);
    expect(topTwo.has('state')).toBe(true);
  });

  it('"customer journey for coffee shop" → high confidence journey-map', () => {
    const result = suggestChartTypes('customer journey for coffee shop');
    expect(result.confidence).toBe('high');
    expect(result.ranked[0]?.type.id).toBe('journey-map');
  });

  it('"database tables and data model" → er with non-ambiguous confidence', () => {
    const result = suggestChartTypes('database tables and data model');
    expect(result.ranked[0]?.type.id).toBe('er');
    expect(result.confidence).not.toBe('ambiguous');
  });

  it('Unicode normalization: "2×2 matrix" matches quadrant', () => {
    const result = suggestChartTypes('show me a 2×2 matrix');
    expect(result.ranked[0]?.type.id).toBe('quadrant');
  });

  it('Unicode normalization: curly-quoted "customer ’journey’" matches journey-map', () => {
    const result = suggestChartTypes(
      'let’s map the customer ’journey’ for onboarding'
    );
    expect(result.ranked[0]?.type.id).toBe('journey-map');
  });

  it('single-description-token gap → ambiguous, not medium', () => {
    // Construct two types where top has one trigger hit (score 2) and second
    // has one trigger hit with identical token count (score 2). Tied scores
    // → gap 0 < AMBIGUITY_THRESHOLD → ambiguous.
    const topA = { score: 2.0, second: 2.0 };
    expect(confidence(topA.score, topA.second)).toBe('ambiguous');

    // Top = 2.0, second = 1.75 (trigger hit + 3 desc hits) → gap 0.25 <
    // AMBIGUITY_THRESHOLD → ambiguous (not medium).
    expect(confidence(2.0, 1.75)).toBe('ambiguous');
    expect(AMBIGUITY_THRESHOLD).toBe(0.5);
  });
});

describe('confidence() rules', () => {
  it('top below MIN_PRIMARY_SCORE is ambiguous', () => {
    expect(confidence(0.5, 0)).toBe('ambiguous');
  });

  it('second === 0 is high', () => {
    expect(confidence(1.0, 0)).toBe('high');
    expect(confidence(5.0, 0)).toBe('high');
  });

  it('top dominates second by 2x → high', () => {
    expect(confidence(4.0, 2.0)).toBe('high');
    expect(confidence(6.0, 3.0)).toBe('high');
  });

  it('gap ≥ AMBIGUITY_THRESHOLD but < 2x → medium', () => {
    expect(confidence(3.0, 2.0)).toBe('medium');
  });
});

describe('scoreChartType', () => {
  it('distinctive trigger token contributes at least 1.0', () => {
    const seq = chartTypes.find((c) => c.id === 'sequence')!;
    const { score, matched } = scoreChartType('I need a sequence diagram', seq);
    // "sequence" is distinctive (IDF weight 1.0); "diagram" is a stopword.
    expect(matched).toContain('sequence diagram');
    expect(score).toBeGreaterThanOrEqual(1.0);
  });

  it('description-only hit contributes 0.25 per token (no trigger match)', () => {
    // Synthetic type with no triggers isolates the description tiebreak from
    // the IDF token-subset matcher.
    const synthetic = {
      id: 'synthetic',
      description: 'xylophone quokka',
      triggers: [],
    };
    const { score, matched } = scoreChartType('a xylophone please', synthetic);
    expect(matched).toEqual([]);
    expect(score).toBeCloseTo(0.25, 5); // one description-token hit ("xylophone")
  });
});

describe('perf smoke', () => {
  it('5000-char prompt completes quickly', () => {
    const big = 'banana '.repeat(800); // ~5600 chars
    const t0 = Date.now();
    const result = suggestChartTypes(big.slice(0, 5000));
    const elapsed = Date.now() - t0;
    // Generous threshold — CI jitter. Real runs are sub-millisecond.
    expect(elapsed).toBeLessThan(250);
    expect(result).toBeDefined();
  });
});
