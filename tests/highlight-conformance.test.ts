/**
 * Highlight-conformance harness.
 *
 * For each chart-type fixture under tests/fixtures/highlight-conformance/,
 * runs the source through highlightDgmo() and asserts each declared token
 * receives the expected role. Failures point to either:
 *   - a keyword set in dgmo/src/editor/keywords.ts is missing the token
 *   - the Lezer grammar doesn't tokenize the construct correctly
 *   - the post-processing in highlight-api.ts is overriding the role
 *
 * Drift protection:
 *   The fixture set is auto-discovered via `import.meta.glob` and cross-
 *   checked against the canonical `chartTypes` registry. Adding a new
 *   chart type without a matching fixture file fails the coverage test.
 */
import { describe, expect, it } from 'vitest';

import { chartTypes } from '../src/chart-types';
import { REGISTRY_TOKEN_CHART_TYPES } from '../src/directives-registry';
import { highlightDgmo } from '../src/editor/highlight-api';

import type { HighlightFixture } from './fixtures/highlight-conformance/_types';

const fixtureModules = import.meta.glob<{ fixture: HighlightFixture }>(
  './fixtures/highlight-conformance/*.ts',
  { eager: true }
);

const fixturesByChartType = new Map<string, HighlightFixture>();
for (const [path, mod] of Object.entries(fixtureModules)) {
  if (path.endsWith('/_types.ts')) continue;
  const f = mod.fixture;
  if (!f) continue;
  fixturesByChartType.set(f.chartType, f);
}

describe('highlight conformance — coverage', () => {
  for (const ct of chartTypes) {
    it(`has a fixture for chart type '${ct.id}'`, () => {
      expect(
        fixturesByChartType.has(ct.id),
        `Missing highlight-conformance fixture for chart type '${ct.id}'. Add tests/fixtures/highlight-conformance/${ct.id}.ts.`
      ).toBe(true);
    });
  }
});

// Every fixture proves the chart-type scope (#1734): it names a token that is
// a keyword in some other chart type and asserts it is NOT one here.
const KEYWORD_ROLES = new Set([
  'keyword',
  'controlKeyword',
  'modifier',
  'definitionKeyword',
]);

describe('highlight conformance — chart-type scope', () => {
  for (const f of fixturesByChartType.values()) {
    it(`'${f.chartType}' asserts a keyword of another chart type stays text`, () => {
      const scoped = f.assertions.filter((a) => {
        const scope = REGISTRY_TOKEN_CHART_TYPES.get(a.text);
        return (
          scope !== undefined &&
          scope !== 'all' &&
          !scope.has(f.chartType) &&
          !KEYWORD_ROLES.has(a.role)
        );
      });
      expect(
        scoped.length,
        `Fixture '${f.chartType}' needs one assertion on a registry token scoped to other chart types (for example 'roles'), with a non-keyword role.`
      ).toBeGreaterThan(0);
    });
  }
});

for (const f of fixturesByChartType.values()) {
  describe(`highlight conformance — ${f.chartType} (spec §${f.specSection})`, () => {
    const tokens = highlightDgmo(f.source);

    for (const a of f.assertions) {
      const occurrence = a.nth ?? 1;
      const label = occurrence === 1 ? a.text : `${a.text} (#${occurrence})`;

      it(`'${label}' has role '${a.role}'`, () => {
        const matches = tokens.filter((t) => t.text === a.text);
        expect(
          matches.length,
          `Expected at least ${occurrence} occurrence(s) of '${a.text}' in source. Source:\n${f.source}`
        ).toBeGreaterThanOrEqual(occurrence);

        const target = matches[occurrence - 1];
        expect(
          target.role,
          `Token '${a.text}' (occurrence ${occurrence}) has role '${target.role}', expected '${a.role}'. Drift root cause is usually:\n  - missing entry in dgmo/src/editor/keywords.ts (CHART_TYPES, DIRECTIVE_KEYWORDS, METADATA_KEYS, etc.)\n  - grammar specialization not picking up the token\n  - post-processing overriding the role`
        ).toBe(a.role);
      });
    }
  });
}
