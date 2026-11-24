/**
 * Completion-conformance harness.
 *
 * For each chart-type fixture under tests/fixtures/completion-conformance/,
 * this suite asserts that dgmo/src/completion-registry.ts surfaces exactly what the
 * language spec documents — no missing tokens, no stale entries.
 *
 * Adding a chart type to coverage:
 *   1. Read the spec section for the chart type.
 *   2. Create tests/fixtures/completion-conformance/<chart-type>.ts.
 *   (The test discovers it; no import to add. A chart type without a fixture
 *   fails the coverage suite.)
 *
 * Failures point at one of three things to fix:
 *   - completion-registry.ts is missing a documented directive/pipe key
 *   - completion-registry.ts has an entry that's not in the spec (rename, remove,
 *     or document)
 *   - the fixture got out of sync with the spec
 */
import { describe, expect, it } from 'vitest';

// The symbol extractors live in the app (ADR-001); their drift-guard is
// diagrammo-app/tests/features/editor/completion/conformance.test.ts. dgmo
// owns the registry data, which this suite checks against the spec.
import {
  COMPLETION_REGISTRY,
  PIPE_METADATA,
  STRUCTURAL_KEYWORDS,
  TAG_SUPPORTING_TYPES,
  REFERENCE_GRAMMAR,
} from '../src/completion-registry';
import { ALL_CHART_TYPES } from '../src/advanced';
import { chartTypes } from '../src/chart-types';
import { getAvailablePalettes } from '../src/palettes';

import type { ConformanceFixture } from './fixtures/completion-conformance/_types';

// Fixtures are auto-discovered, so a fixture file is wired in by existing.
// The coverage suite below fails when an offered chart type has none.
const fixtureModules = import.meta.glob<{ fixture: ConformanceFixture }>(
  './fixtures/completion-conformance/*.ts',
  { eager: true }
);

const fixtures: ConformanceFixture[] = Object.entries(fixtureModules)
  .filter(([path]) => !/\/_[^/]*\.ts$/.test(path))
  .map(([, mod]) => mod.fixture)
  .filter((f): f is ConformanceFixture => f !== undefined)
  .sort((x, y) => x.chartType.localeCompare(y.chartType));

describe('completion conformance — coverage', () => {
  for (const ct of chartTypes) {
    if (ct.internal) continue;
    it(`has a fixture for chart type '${ct.id}'`, () => {
      expect(
        fixtures.some((f) => f.chartType === ct.id),
        `Missing completion-conformance fixture for chart type '${ct.id}'. Add tests/fixtures/completion-conformance/${ct.id}.ts.`
      ).toBe(true);
    });
  }
});

const UNIVERSAL_DIRECTIVES = ['palette', 'no-title', 'legend-inline'];

for (const f of fixtures) {
  describe(`completion conformance — ${f.chartType} (spec §${f.specSection})`, () => {
    it('has an entry in COMPLETION_REGISTRY', () => {
      expect(
        COMPLETION_REGISTRY.get(f.chartType),
        `Spec §${f.specSection} documents '${f.chartType}' but COMPLETION_REGISTRY has no entry for it.`
      ).toBeDefined();
    });

    it('directive set matches the spec', () => {
      const spec = COMPLETION_REGISTRY.get(f.chartType);
      if (!spec) return; // covered by the previous test

      const actual = new Set(Object.keys(spec.directives));
      const expected = new Set([...UNIVERSAL_DIRECTIVES, ...f.directives]);
      const allowed = new Set(f.allowExtras ?? []);

      const missing = [...expected].filter((d) => !actual.has(d)).sort();
      const stale = [...actual]
        .filter((d) => !expected.has(d) && !allowed.has(d))
        .sort();

      expect(
        { missing, stale },
        `Directive drift in '${f.chartType}'. Missing entries are documented in spec §${f.specSection} but not registered. Stale entries are registered but not in the spec — either document them in the fixture, add to allowExtras, or remove from completion-registry.ts.`
      ).toEqual({ missing: [], stale: [] });
    });

    it('pipe metadata matches the spec', () => {
      const liveBuckets = PIPE_METADATA.get(f.chartType);
      // RACI/ring/pyramid use role/phase/layer contexts that the live registry
      // doesn't currently express — surface that as a known gap rather than
      // a hard fail until PIPE_METADATA gains multi-context support.
      const expectedKeys = [
        ...(f.pipeKeys.node ?? []),
        ...(f.pipeKeys.edge ?? []),
        ...(f.pipeKeys.role ?? []),
        ...(f.pipeKeys.phase ?? []),
        ...(f.pipeKeys.layer ?? []),
      ];

      if (expectedKeys.length === 0) {
        expect(
          liveBuckets,
          `'${f.chartType}' has no pipe-metadata in the spec, but PIPE_METADATA has an entry.`
        ).toBeUndefined();
        return;
      }

      expect(
        liveBuckets,
        `Spec §${f.specSection} defines pipe metadata for '${f.chartType}' (${expectedKeys.join(', ')}) but PIPE_METADATA has no entry.`
      ).toBeDefined();

      if (!liveBuckets) return;
      const actualKeys = new Set<string>();
      for (const ctx of Object.values(liveBuckets)) {
        for (const k of Object.keys(ctx)) actualKeys.add(k);
      }
      const missing = expectedKeys.filter((k) => !actualKeys.has(k)).sort();
      expect(
        missing,
        `Pipe-metadata gap in '${f.chartType}'. Spec §${f.specSection} documents these keys but PIPE_METADATA doesn't surface them.`
      ).toEqual([]);
    });

    it('first-line keyword is recognized', () => {
      if (!f.firstLineKeyword) return;
      expect(
        ALL_CHART_TYPES.has(f.firstLineKeyword),
        `'${f.firstLineKeyword}' should be a valid first-line keyword per spec §${f.specSection}.`
      ).toBe(true);
    });

    it('non-first-line tokens are correctly rejected', () => {
      for (const token of f.notFirstLineKeywords ?? []) {
        expect(
          ALL_CHART_TYPES.has(token),
          `'${token}' is in ALL_CHART_TYPES but spec §${f.specSection} says it's NOT a first-line keyword.`
        ).toBe(false);
      }
    });

    it('structural keywords match the spec (no parser-invalid tokens)', () => {
      const allowedStructural = new Set(f.allowExtraStructural ?? []);
      const actual = [...(STRUCTURAL_KEYWORDS.get(f.chartType) ?? [])]
        .filter((k) => !allowedStructural.has(k))
        .sort();
      const expected = [...(f.structuralKeywords ?? [])].sort();
      expect(
        actual,
        `Structural-keyword drift in '${f.chartType}'. STRUCTURAL_KEYWORDS must match the parser-recognized tokens documented in this fixture (spec §${f.specSection}). Every token must be something the parser actually accepts — never a removed/diagnostic-only token.`
      ).toEqual(expected);
    });

    it('tag-support derivation matches spec §1.3 list', () => {
      // TAG_SUPPORTING_TYPES is derived from STRUCTURAL_KEYWORDS — a chart
      // supports `tag` blocks iff it offers the `tag` keyword. This keeps the
      // spec §1.3 "Diagram types that support tags" list honest.
      const offersTag = (f.structuralKeywords ?? []).includes('tag');
      expect(
        TAG_SUPPORTING_TYPES.has(f.chartType),
        `Tag-support drift in '${f.chartType}': structuralKeywords ${offersTag ? 'includes' : 'omits'} 'tag' but TAG_SUPPORTING_TYPES ${TAG_SUPPORTING_TYPES.has(f.chartType) ? 'includes' : 'omits'} it.`
      ).toBe(offersTag);
    });

    for (const check of f.enumChecks ?? []) {
      it(`enum values for '${check.directive}' match the spec`, () => {
        const spec = COMPLETION_REGISTRY.get(f.chartType);
        const directive = spec?.directives[check.directive];
        const actual = directive?.values ?? [];

        let expected: string[];
        if ('source' in check && check.source === 'palettes') {
          expected = getAvailablePalettes().map((p) => p.id);
        } else if ('values' in check) {
          expected = check.values;
        } else {
          return;
        }

        expect(actual.sort()).toEqual([...expected].sort());
      });
    }
  });
}

// ============================================================
// Generative reference-grammar descriptors (NOT the hand-maintained list above)
// ============================================================
//
// Iterates ALL_CHART_TYPES directly, so a new chart type cannot be forgotten.
// That each reference-grammar type has a working extractor is checked where
// the extractors live: the app's completion conformance test.

describe('reference-grammar descriptors (generative over ALL_CHART_TYPES)', () => {
  for (const type of ALL_CHART_TYPES) {
    const grammar = REFERENCE_GRAMMAR.get(type);
    if (!grammar?.hasReferenceGrammar) continue;

    it(`'${type}' declares at least one reference operator`, () => {
      expect(
        grammar.referenceOperators.length,
        `'${type}' has hasReferenceGrammar: true but no referenceOperators — the app can't build a trigger.`
      ).toBeGreaterThanOrEqual(1);
    });
  }

  it('every ALL_CHART_TYPES entry has a REFERENCE_GRAMMAR descriptor', () => {
    const missing = [...ALL_CHART_TYPES].filter(
      (t) => !REFERENCE_GRAMMAR.has(t)
    );
    expect(
      missing,
      `These chart types have no REFERENCE_GRAMMAR entry — the auto-fill loop in completion-registry.ts should cover every registered type.`
    ).toEqual([]);
  });
});
