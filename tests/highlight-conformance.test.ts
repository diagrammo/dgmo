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
 * Adding coverage:
 *   1. Read the spec section.
 *   2. Create tests/fixtures/highlight-conformance/<chart-type>.ts.
 *   3. Add an import below.
 */
import { describe, expect, it } from 'vitest';

import { highlightDgmo } from '../src/editor/highlight-api';

import type { HighlightFixture } from './fixtures/highlight-conformance/_types';
import { fixture as raciFixture } from './fixtures/highlight-conformance/raci';
import { fixture as ringFixture } from './fixtures/highlight-conformance/ring';
import { fixture as pyramidFixture } from './fixtures/highlight-conformance/pyramid';
import { fixture as cycleFixture } from './fixtures/highlight-conformance/cycle';
import { fixture as journeyMapFixture } from './fixtures/highlight-conformance/journey-map';
import { fixture as mindmapFixture } from './fixtures/highlight-conformance/mindmap';

const fixtures: HighlightFixture[] = [
  raciFixture,
  ringFixture,
  pyramidFixture,
  cycleFixture,
  journeyMapFixture,
  mindmapFixture,
];

for (const f of fixtures) {
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
