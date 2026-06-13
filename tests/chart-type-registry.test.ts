// chart-type-registry.test.ts — Story 109.1 (arch-review).
//
// Guards the single-source chart-type registry and the sites DERIVED from it.
// Extends the parser cross-check (chart-types.test.ts) to the render-category
// and measure dispatch sites, so a chart type that is registered but missing a
// category or measure path trips a test instead of failing silently at render
// (empty SVG) or sizing (degraded dimensions) time.

import { describe, it, expect } from 'vitest';
import { chartTypes } from '../src/chart-types';
import {
  knownChartTypeIds,
  getRenderCategory,
  isExtendedChartType,
} from '../src/dgmo-router';
import {
  CHART_TYPE_REGISTRY,
  REGISTRY_BY_ID,
} from '../src/chart-type-registry';
import { DIAGRAM_EXPORT_HANDLERS, parseVisualization } from '../src/d3';

// Diagram/visualization types NOT in the handler table on purpose: they fall
// through to the unified D3 visualization renderer (exportVisualization).
const FALLTHROUGH_IDS = new Set([
  'sequence',
  'slope',
  'wordcloud',
  'arc',
  'timeline',
  'venn',
  'quadrant',
]);

// Frozen expectations — the category membership the previous hand-maintained
// Sets in dgmo-router.ts encoded. If a future change moves a type between
// categories, update this map deliberately.
const EXPECTED_CATEGORY: Record<
  string,
  'data-chart' | 'visualization' | 'diagram'
> = {
  // diagram (19)
  sequence: 'diagram',
  flowchart: 'diagram',
  class: 'diagram',
  er: 'diagram',
  org: 'diagram',
  kanban: 'diagram',
  c4: 'diagram',
  state: 'diagram',
  sitemap: 'diagram',
  infra: 'diagram',
  gantt: 'diagram',
  pert: 'diagram',
  'boxes-and-lines': 'diagram',
  mindmap: 'diagram',
  wireframe: 'diagram',
  'journey-map': 'diagram',
  raci: 'diagram',
  rasci: 'diagram',
  daci: 'diagram',
  // visualization (11)
  slope: 'visualization',
  wordcloud: 'visualization',
  arc: 'visualization',
  timeline: 'visualization',
  venn: 'visualization',
  quadrant: 'visualization',
  'tech-radar': 'visualization',
  cycle: 'visualization',
  pyramid: 'visualization',
  ring: 'visualization',
  map: 'visualization',
  // data-chart (15)
  bar: 'data-chart',
  line: 'data-chart',
  pie: 'data-chart',
  doughnut: 'data-chart',
  area: 'data-chart',
  'polar-area': 'data-chart',
  radar: 'data-chart',
  'bar-stacked': 'data-chart',
  'multi-line': 'data-chart',
  scatter: 'data-chart',
  sankey: 'data-chart',
  chord: 'data-chart',
  function: 'data-chart',
  heatmap: 'data-chart',
  funnel: 'data-chart',
};

// The set of types that had a content-count extractor in dimensions.ts.
const EXPECTED_MEASURE_IDS = [
  'arc',
  'class',
  'daci',
  'er',
  'flowchart',
  'gantt',
  'heatmap',
  'infra',
  'kanban',
  'mindmap',
  'org',
  'pert',
  'raci',
  'rasci',
  'sequence',
  'state',
  'tech-radar',
].sort();

const EXPECTED_EXTENDED_IDS = [
  'chord',
  'function',
  'funnel',
  'heatmap',
  'sankey',
  'scatter',
].sort();

describe('chart-type registry — single source of truth', () => {
  it('covers exactly the chartTypes id set (and the derived parser map)', () => {
    const registryIds = new Set(CHART_TYPE_REGISTRY.map((d) => d.id));
    expect(registryIds).toEqual(new Set(chartTypes.map((c) => c.id)));
    expect(registryIds).toEqual(new Set(knownChartTypeIds));
  });

  it('has no duplicate descriptors', () => {
    const ids = CHART_TYPE_REGISTRY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every descriptor carries a parse function', () => {
    for (const d of CHART_TYPE_REGISTRY) {
      expect(typeof d.parse).toBe('function');
    }
  });
});

describe('render-category dispatch derives from the registry', () => {
  it('getRenderCategory matches the frozen category for every type', () => {
    for (const d of CHART_TYPE_REGISTRY) {
      expect(getRenderCategory(d.id)).toBe(EXPECTED_CATEGORY[d.id]);
      expect(d.category).toBe(EXPECTED_CATEGORY[d.id]);
    }
  });

  it('every registered id has a non-null category (no silent unknowns)', () => {
    for (const d of CHART_TYPE_REGISTRY) {
      expect(getRenderCategory(d.id)).not.toBeNull();
    }
  });

  it('getRenderCategory is case-insensitive and null for unknown', () => {
    expect(getRenderCategory('SEQUENCE')).toBe('diagram');
    expect(getRenderCategory('not-a-chart')).toBeNull();
  });

  it('isExtendedChartType matches the extended-parser set exactly', () => {
    const extended = CHART_TYPE_REGISTRY.filter((d) =>
      isExtendedChartType(d.id)
    )
      .map((d) => d.id)
      .sort();
    expect(extended).toEqual(EXPECTED_EXTENDED_IDS);
  });
});

describe('measure dispatch derives from the registry', () => {
  it('exactly the expected types expose a measure function', () => {
    const withMeasure = CHART_TYPE_REGISTRY.filter((d) => d.measure)
      .map((d) => d.id)
      .sort();
    expect(withMeasure).toEqual(EXPECTED_MEASURE_IDS);
  });

  it('REGISTRY_BY_ID resolves descriptors for lookup', () => {
    expect(REGISTRY_BY_ID.get('gantt')?.category).toBe('diagram');
    expect(REGISTRY_BY_ID.get('gantt')?.measure).toBeTypeOf('function');
    expect(REGISTRY_BY_ID.get('nope')).toBeUndefined();
  });
});

describe('export-render dispatch covers the registry', () => {
  it('every diagram/visualization type has a render path (handler or fallthrough)', () => {
    const missing = CHART_TYPE_REGISTRY.filter(
      (d) => d.category === 'diagram' || d.category === 'visualization'
    )
      .filter(
        (d) => !DIAGRAM_EXPORT_HANDLERS[d.id] && !FALLTHROUGH_IDS.has(d.id)
      )
      .map((d) => d.id);
    // A non-empty list here is the bug this story prevents: a registered type
    // that would silently render '' because no handler dispatches it.
    expect(missing).toEqual([]);
  });

  it('FALLTHROUGH_IDS is exactly the types exportVisualization can render', () => {
    // exportVisualization dispatches on parseVisualization()'s `parsed.type`, so
    // it can only render the parseVisualization-bound types — plus `sequence`,
    // which has its own parser but is routed through the fallthrough. Deriving
    // the expected set from the parser BINDING (not a hand-copy) means a future
    // own-parser visualization wrongly added to FALLTHROUGH_IDS — which would
    // silently render '' — fails here instead of passing the coverage check.
    const d3VizIds = CHART_TYPE_REGISTRY.filter(
      (d) => d.parse === parseVisualization
    ).map((d) => d.id);
    expect(FALLTHROUGH_IDS).toEqual(new Set(['sequence', ...d3VizIds]));
  });

  it('the handler table has no stray keys', () => {
    for (const id of Object.keys(DIAGRAM_EXPORT_HANDLERS)) {
      const d = REGISTRY_BY_ID.get(id);
      expect(d, `handler '${id}' is not a registered chart type`).toBeDefined();
      expect(['diagram', 'visualization']).toContain(d!.category);
      expect(FALLTHROUGH_IDS.has(id)).toBe(false);
    }
  });

  it('every handler is a function', () => {
    for (const fn of Object.values(DIAGRAM_EXPORT_HANDLERS)) {
      expect(fn).toBeTypeOf('function');
    }
  });
});
