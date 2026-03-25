/**
 * Tests for ECharts legend group extractors.
 *
 * Ensures chart types produce correct LegendGroupData for the
 * centralized legend renderer, preserving original entry names
 * for ECharts highlight/downplay interactivity.
 */
import { describe, it, expect } from 'vitest';
import { getPalette, getSeriesColors } from '../src/palettes';
import { parseExtendedChart } from '../src/echarts';
import { parseChart } from '../src/chart';
import { getExtendedChartLegendGroups, getSimpleChartLegendGroups } from '../src/echarts';

const palette = getPalette('nord').light;
const colors = getSeriesColors(palette);

describe('getExtendedChartLegendGroups', () => {
  it('extracts scatter categories with original casing', () => {
    const content = `chart: scatter
title: Test

[SaaS](blue)
  A: 1, 2
  B: 3, 4

[Fintech](green)
  C: 5, 6`;
    const parsed = parseExtendedChart(content, palette);
    const groups = getExtendedChartLegendGroups(parsed, colors);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Group');
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[0].entries[0].value).toBe('SaaS');
    expect(groups[0].entries[1].value).toBe('Fintech');
  });

  it('returns empty for scatter without categories', () => {
    const content = `chart: scatter
A: 1, 2
B: 3, 4`;
    const parsed = parseExtendedChart(content, palette);
    const groups = getExtendedChartLegendGroups(parsed, colors);
    expect(groups).toHaveLength(0);
  });

  it('extracts function names with original casing', () => {
    const content = `chart: function
x: -5 to 5
f(x) (blue): sin(x)
g(x) (red): cos(x)`;
    const parsed = parseExtendedChart(content, palette);
    const groups = getExtendedChartLegendGroups(parsed, colors);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Function');
    expect(groups[0].entries[0].value).toBe('f(x)');
    expect(groups[0].entries[1].value).toBe('g(x)');
  });

  it('extracts chord node names', () => {
    const content = `chart: chord
title: Test

Engineering -> Design: 5
Design -> Product: 3`;
    const parsed = parseExtendedChart(content, palette);
    const groups = getExtendedChartLegendGroups(parsed, colors);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Node');
    expect(groups[0].entries.map((e) => e.value)).toEqual(
      expect.arrayContaining(['Engineering', 'Design', 'Product']),
    );
  });

  it('returns empty for heatmap (no legend)', () => {
    const content = `chart: heatmap
columns: A, B
Row1: 1, 2`;
    const parsed = parseExtendedChart(content, palette);
    const groups = getExtendedChartLegendGroups(parsed, colors);
    expect(groups).toHaveLength(0);
  });
});

describe('getSimpleChartLegendGroups', () => {
  it('extracts multi-line series names', () => {
    const content = `chart: line
series: Revenue, Cost

Q1: 10, 5
Q2: 20, 8`;
    const parsed = parseChart(content, palette);
    const groups = getSimpleChartLegendGroups(parsed, colors);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries[0].value).toBe('Revenue');
    expect(groups[0].entries[1].value).toBe('Cost');
  });

  it('returns empty for single-series charts', () => {
    const content = `chart: bar
Apples: 10
Oranges: 20`;
    const parsed = parseChart(content, palette);
    const groups = getSimpleChartLegendGroups(parsed, colors);
    expect(groups).toHaveLength(0);
  });
});
