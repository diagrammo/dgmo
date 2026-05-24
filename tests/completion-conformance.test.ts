/**
 * Completion-conformance harness.
 *
 * For each chart-type fixture under tests/fixtures/completion-conformance/,
 * this suite asserts that dgmo/src/completion.ts surfaces exactly what the
 * language spec documents — no missing tokens, no stale entries.
 *
 * Adding a chart type to coverage:
 *   1. Read the spec section for the chart type.
 *   2. Create tests/fixtures/completion-conformance/<chart-type>.ts.
 *   3. Add an import below.
 *
 * Failures point at one of three things to fix:
 *   - completion.ts is missing a documented directive/pipe key
 *   - completion.ts has an entry that's not in the spec (rename, remove,
 *     or document)
 *   - the fixture got out of sync with the spec
 */
import { describe, expect, it } from 'vitest';

import {
  COMPLETION_REGISTRY,
  PIPE_METADATA,
  ALL_CHART_TYPES,
} from '../src/internal';
import { getAvailablePalettes } from '../src/palettes';

import type { ConformanceFixture } from './fixtures/completion-conformance/_types';

import { fixture as raciFixture } from './fixtures/completion-conformance/raci';
import { fixture as ringFixture } from './fixtures/completion-conformance/ring';
import { fixture as pyramidFixture } from './fixtures/completion-conformance/pyramid';
import { fixture as cycleFixture } from './fixtures/completion-conformance/cycle';
import { fixture as journeyMapFixture } from './fixtures/completion-conformance/journey-map';
import { fixture as mindmapFixture } from './fixtures/completion-conformance/mindmap';
// Data charts (spec §16)
import { fixture as barFixture } from './fixtures/completion-conformance/bar';
import { fixture as lineFixture } from './fixtures/completion-conformance/line';
import { fixture as multiLineFixture } from './fixtures/completion-conformance/multi-line';
import { fixture as areaFixture } from './fixtures/completion-conformance/area';
import { fixture as pieFixture } from './fixtures/completion-conformance/pie';
import { fixture as doughnutFixture } from './fixtures/completion-conformance/doughnut';
import { fixture as polarAreaFixture } from './fixtures/completion-conformance/polar-area';
import { fixture as radarFixture } from './fixtures/completion-conformance/radar';
import { fixture as barStackedFixture } from './fixtures/completion-conformance/bar-stacked';
import { fixture as scatterFixture } from './fixtures/completion-conformance/scatter';
import { fixture as heatmapFixture } from './fixtures/completion-conformance/heatmap';
import { fixture as funnelFixture } from './fixtures/completion-conformance/funnel';
import { fixture as functionFixture } from './fixtures/completion-conformance/function';
import { fixture as sankeyFixture } from './fixtures/completion-conformance/sankey';
import { fixture as chordFixture } from './fixtures/completion-conformance/chord';
// Visualizations (spec §17 + §15 timeline + §20 tech-radar)
import { fixture as slopeFixture } from './fixtures/completion-conformance/slope';
import { fixture as wordcloudFixture } from './fixtures/completion-conformance/wordcloud';
import { fixture as arcFixture } from './fixtures/completion-conformance/arc';
import { fixture as vennFixture } from './fixtures/completion-conformance/venn';
import { fixture as quadrantFixture } from './fixtures/completion-conformance/quadrant';
import { fixture as timelineFixture } from './fixtures/completion-conformance/timeline';
import { fixture as techRadarFixture } from './fixtures/completion-conformance/tech-radar';
// Diagrams (spec §3–§14, §19)
import { fixture as sequenceFixture } from './fixtures/completion-conformance/sequence';
import { fixture as flowchartFixture } from './fixtures/completion-conformance/flowchart';
import { fixture as stateFixture } from './fixtures/completion-conformance/state';
import { fixture as orgFixture } from './fixtures/completion-conformance/org';
import { fixture as c4Fixture } from './fixtures/completion-conformance/c4';
import { fixture as erFixture } from './fixtures/completion-conformance/er';
import { fixture as classFixture } from './fixtures/completion-conformance/class';
import { fixture as kanbanFixture } from './fixtures/completion-conformance/kanban';
import { fixture as sitemapFixture } from './fixtures/completion-conformance/sitemap';
import { fixture as infraFixture } from './fixtures/completion-conformance/infra';
import { fixture as ganttFixture } from './fixtures/completion-conformance/gantt';
import { fixture as boxesAndLinesFixture } from './fixtures/completion-conformance/boxes-and-lines';
import { fixture as pertFixture } from './fixtures/completion-conformance/pert';
import { fixture as wireframeFixture } from './fixtures/completion-conformance/wireframe';

const fixtures: ConformanceFixture[] = [
  raciFixture,
  ringFixture,
  pyramidFixture,
  cycleFixture,
  journeyMapFixture,
  mindmapFixture,
  // Data charts
  barFixture,
  lineFixture,
  multiLineFixture,
  areaFixture,
  pieFixture,
  doughnutFixture,
  polarAreaFixture,
  radarFixture,
  barStackedFixture,
  scatterFixture,
  heatmapFixture,
  funnelFixture,
  functionFixture,
  sankeyFixture,
  chordFixture,
  // Visualizations
  slopeFixture,
  wordcloudFixture,
  arcFixture,
  vennFixture,
  quadrantFixture,
  timelineFixture,
  techRadarFixture,
  // Diagrams
  sequenceFixture,
  flowchartFixture,
  stateFixture,
  orgFixture,
  c4Fixture,
  erFixture,
  classFixture,
  kanbanFixture,
  sitemapFixture,
  infraFixture,
  ganttFixture,
  boxesAndLinesFixture,
  pertFixture,
  wireframeFixture,
];

const UNIVERSAL_DIRECTIVES = ['palette', 'theme', 'no-title'];

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
        `Directive drift in '${f.chartType}'. Missing entries are documented in spec §${f.specSection} but not registered. Stale entries are registered but not in the spec — either document them in the fixture, add to allowExtras, or remove from completion.ts.`
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
