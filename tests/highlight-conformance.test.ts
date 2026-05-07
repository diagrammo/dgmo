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
// Data charts (§16)
import { fixture as barFixture } from './fixtures/highlight-conformance/bar';
import { fixture as lineFixture } from './fixtures/highlight-conformance/line';
import { fixture as multiLineFixture } from './fixtures/highlight-conformance/multi-line';
import { fixture as areaFixture } from './fixtures/highlight-conformance/area';
import { fixture as pieFixture } from './fixtures/highlight-conformance/pie';
import { fixture as doughnutFixture } from './fixtures/highlight-conformance/doughnut';
import { fixture as polarAreaFixture } from './fixtures/highlight-conformance/polar-area';
import { fixture as radarFixture } from './fixtures/highlight-conformance/radar';
import { fixture as barStackedFixture } from './fixtures/highlight-conformance/bar-stacked';
import { fixture as scatterFixture } from './fixtures/highlight-conformance/scatter';
import { fixture as sankeyFixture } from './fixtures/highlight-conformance/sankey';
import { fixture as chordFixture } from './fixtures/highlight-conformance/chord';
import { fixture as functionFixture } from './fixtures/highlight-conformance/function';
import { fixture as heatmapFixture } from './fixtures/highlight-conformance/heatmap';
import { fixture as funnelFixture } from './fixtures/highlight-conformance/funnel';
// Visualizations (§17 + §15 timeline + §20 tech-radar)
import { fixture as slopeFixture } from './fixtures/highlight-conformance/slope';
import { fixture as wordcloudFixture } from './fixtures/highlight-conformance/wordcloud';
import { fixture as arcFixture } from './fixtures/highlight-conformance/arc';
import { fixture as timelineFixture } from './fixtures/highlight-conformance/timeline';
import { fixture as vennFixture } from './fixtures/highlight-conformance/venn';
import { fixture as quadrantFixture } from './fixtures/highlight-conformance/quadrant';
import { fixture as techRadarFixture } from './fixtures/highlight-conformance/tech-radar';
// Diagrams (§3-§14, §19)
import { fixture as sequenceFixture } from './fixtures/highlight-conformance/sequence';
import { fixture as flowchartFixture } from './fixtures/highlight-conformance/flowchart';
import { fixture as stateFixture } from './fixtures/highlight-conformance/state';
import { fixture as orgFixture } from './fixtures/highlight-conformance/org';
import { fixture as c4Fixture } from './fixtures/highlight-conformance/c4';
import { fixture as erFixture } from './fixtures/highlight-conformance/er';
import { fixture as classFixture } from './fixtures/highlight-conformance/class';
import { fixture as kanbanFixture } from './fixtures/highlight-conformance/kanban';
import { fixture as sitemapFixture } from './fixtures/highlight-conformance/sitemap';
import { fixture as infraFixture } from './fixtures/highlight-conformance/infra';
import { fixture as ganttFixture } from './fixtures/highlight-conformance/gantt';
import { fixture as boxesAndLinesFixture } from './fixtures/highlight-conformance/boxes-and-lines';
import { fixture as wireframeFixture } from './fixtures/highlight-conformance/wireframe';

const fixtures: HighlightFixture[] = [
  raciFixture,
  ringFixture,
  pyramidFixture,
  cycleFixture,
  journeyMapFixture,
  mindmapFixture,
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
  sankeyFixture,
  chordFixture,
  functionFixture,
  heatmapFixture,
  funnelFixture,
  slopeFixture,
  wordcloudFixture,
  arcFixture,
  timelineFixture,
  vennFixture,
  quadrantFixture,
  techRadarFixture,
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
  wireframeFixture,
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
