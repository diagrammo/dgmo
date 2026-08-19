// chart-type-conformance.test.ts — issue 7 (no single test drives every chart
// type through parse to drawn output).
//
// One fixture per registered chart type, driven through the SAME entry the app
// and CLI export through (`renderForExport`), asserting each one parses without
// error and draws something. Before this, every chart type's coverage was
// whatever its own hand-written test happened to assert, so a type could parse
// clean and render an empty sheet with nothing failing — which is the shape of
// the defects this repo files by hand (the goal bar drawing as a floating lens
// at low values, #258).
//
// It deliberately does NOT require the 51 renderers to converge on one
// signature: `renderForExport` already normalises them, dispatching through
// DIAGRAM_EXPORT_HANDLERS for diagrams/visualizations and charts-d3 for the
// data charts. The uniform-interface half of issue 7 was dropped after a census
// showed the drafted shape described the minority case.
//
// The fixtures are files, not inline strings, so they can be rendered by hand
// and audited by the dgmo-syntax-auditor like any other .dgmo. Keep them
// MINIMAL: this suite answers "does this type draw at all", and every extra
// line is a second thing that can fail here instead of in that type's own test.
//
// Adding a chart type? Add tests/fixtures/conformance/<id>.dgmo. The coverage
// test below fails in both directions, so neither a missing fixture nor an
// orphaned one can pass unnoticed.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { CHART_TYPE_REGISTRY } from '../src/chart-type-registry';
import { parseDgmoChartType } from '../src/dgmo-router';
import { renderForExport } from '../src/d3';
import { loadMapData } from '../src/map/load-data';

// `__dirname`, not `import.meta.url`: the suite runs in the jsdom environment,
// where `import.meta.url` is an http:// document URL and fileURLToPath throws.
const FIXTURE_DIR = join(__dirname, 'fixtures/conformance');

const fixtureIds = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.dgmo'))
  .map((f) => f.replace(/\.dgmo$/, ''));

const read = (id: string) =>
  readFileSync(join(FIXTURE_DIR, `${id}.dgmo`), 'utf8');

/**
 * The one type that cannot render from its source alone: this module reads
 * nothing from disk or the network, so a host hands over the basemap assets or
 * the map degrades to '' plus an E_MAP_DATA_NOT_SUPPLIED diagnostic (pinned in
 * block.test.ts). Every other type must draw with no options at all — the test
 * below asserts this table stays a table of one, so a renderer that grows a
 * host dependency cannot quietly join it.
 */
const RENDER_OPTIONS: Record<string, Parameters<typeof renderForExport>[4]> = {
  map: { mapData: loadMapData },
};

/** Anything that puts ink on the sheet. A root <svg> alone is not output. */
const DRAWN =
  /<(path|rect|circle|ellipse|line|polygon|polyline|text|image|use)\b/;

/**
 * A NaN or undefined that reached an attribute value. Renderers divide by
 * counts and measure text, so a layout that goes wrong arrives here rather
 * than throwing — the SVG is well-formed and draws nothing where it matters.
 */
const BAD_NUMBER = /="[^"]*\b(NaN|undefined|Infinity)\b[^"]*"/;

describe('chart-type conformance — coverage', () => {
  it('there is exactly one fixture per registered chart type', () => {
    const registered = CHART_TYPE_REGISTRY.map((d) => d.id).sort();
    expect(fixtureIds.slice().sort()).toEqual(registered);
  });

  it('map is the only type that needs the host to supply anything', () => {
    expect(Object.keys(RENDER_OPTIONS)).toEqual(['map']);
  });
});

describe.each(CHART_TYPE_REGISTRY.map((d) => [d.id, d] as const))(
  'chart-type conformance — %s',
  (id, descriptor) => {
    it('the fixture routes to its own chart type', () => {
      // Guards the fixture, not the product: a fixture that detected as some
      // OTHER type would render fine and test nothing about this row.
      expect(parseDgmoChartType(read(id))).toBe(id);
    });

    it('parses with no error diagnostics', () => {
      const errors = descriptor
        .parse(read(id))
        .diagnostics.filter((d) => d.severity === 'error');
      expect(errors.map((e) => `${e.line}: ${e.message}`)).toEqual([]);
    });

    it('renders drawn output in light and dark', async () => {
      for (const theme of ['light', 'dark'] as const) {
        const svg = await renderForExport(
          read(id),
          theme,
          undefined,
          undefined,
          RENDER_OPTIONS[id]
        );
        expect(svg, `${id} rendered nothing in ${theme}`).toMatch(/^\s*<svg/);
        expect(svg, `${id} drew no elements in ${theme}`).toMatch(DRAWN);
        const bad = svg.match(BAD_NUMBER);
        expect(bad?.[0], `${id} has a broken attribute in ${theme}`).toBe(
          undefined
        );
      }
    });
  }
);
