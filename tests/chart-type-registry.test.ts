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
import { DIAGRAM_EXPORT_HANDLERS } from '../src/d3';

// The only diagram/visualization id NOT in the handler table on purpose:
// `sequence` has no chart-type of its own (auto-detected from arrow syntax) and
// routes through the exportVisualization fallthrough. Story 109.2 gave every D3
// visualization (slope/arc/timeline/wordcloud/venn/quadrant) its own handler.
const FALLTHROUGH_IDS = new Set(['sequence']);

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
  treemap: 'visualization',
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

// The set of types whose min-dimension formula moved into the registry
// (Story 111.5) — the old `computeMinDimensions` switch cases. A registered
// type missing a `minDims` silently falls back to {300,200}; this guard trips
// instead, the same way EXPECTED_MEASURE_IDS guards `measure`. (rasci/daci had
// no switch case — they intentionally keep the {300,200} default.)
const EXPECTED_MINDIMS_IDS = [
  'arc',
  'class',
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

  it('exactly the expected types expose a minDims function', () => {
    const withMinDims = CHART_TYPE_REGISTRY.filter((d) => d.minDims)
      .map((d) => d.id)
      .sort();
    expect(withMinDims).toEqual(EXPECTED_MINDIMS_IDS);
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

  it('FALLTHROUGH_IDS is exactly the diagram/viz ids with no dedicated handler', () => {
    // Derive the fallthrough set from the registry MINUS the handler table
    // (not a hand-copy): every diagram/visualization id must either have its own
    // handler or be a deliberate fallthrough. A new type that is registered but
    // wired to neither would surface here as an extra uncovered id.
    const uncovered = CHART_TYPE_REGISTRY.filter(
      (d) => d.category === 'diagram' || d.category === 'visualization'
    )
      .filter((d) => !DIAGRAM_EXPORT_HANDLERS[d.id])
      .map((d) => d.id);
    expect(new Set(uncovered)).toEqual(FALLTHROUGH_IDS);
    // And the only legitimate fallthrough is sequence.
    expect(FALLTHROUGH_IDS).toEqual(new Set(['sequence']));
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
