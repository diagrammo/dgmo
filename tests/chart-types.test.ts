// chart-types.test.ts — REGISTRY integrity only.
//
// Chart-type SELECTION (suggestChartTypes, scoring, triggers, confidence) moved
// to the dgmo-mcp server; its tests live there (dgmo-mcp/tests/suggest.test.ts).
// This file guards the data model the render library actually owns.

import { describe, it, expect } from 'vitest';
import { chartTypes, CHART_TYPE_ALIASES } from '../src/chart-types';
import { knownChartTypeIds, getAllChartTypes } from '../src/dgmo-router';

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

  it('every type has a non-empty description', () => {
    for (const c of chartTypes) {
      expect(c.description.length).toBeGreaterThan(0);
    }
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
  it('chartTypes ids plus aliases cover the same set as knownChartTypeIds', () => {
    // knownChartTypeIds is derived from the dispatch registry, which includes the
    // retained aliases (doughnut, area, multi-line, rasci, daci) that are no
    // longer in the surfaced `chartTypes` list.
    expect(
      new Set([
        ...chartTypes.map((c) => c.id),
        ...Object.keys(CHART_TYPE_ALIASES),
      ])
    ).toEqual(new Set(knownChartTypeIds));
  });

  it('getAllChartTypes() returns chartTypes in tier order', () => {
    expect(getAllChartTypes()).toEqual(chartTypes.map((c) => c.id));
  });
});
