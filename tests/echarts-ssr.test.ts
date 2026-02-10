import { describe, it, expect } from 'vitest';
import { renderEChartsForExport } from '../src/echarts';

// Minimal valid inputs for each ECharts chart type
const SCATTER_INPUT = `chart: scatter
title: Test Scatter
A: 1, 2
B: 3, 4
C: 5, 6`;

const SANKEY_INPUT = `chart: sankey
title: Test Sankey
A -> B: 10
B -> C: 5
A -> C: 3`;

const CHORD_INPUT = `chart: chord
title: Test Chord
A -> B: 10
B -> C: 5
C -> A: 3`;

const FUNCTION_INPUT = `chart: function
title: Test Function
x: -5 to 5
f(x): x^2
g(x): sin(x)`;

const HEATMAP_INPUT = `chart: heatmap
title: Test Heatmap
columns: Mon, Tue, Wed
Morning: 10, 20, 30
Afternoon: 40, 50, 60`;

const FUNNEL_INPUT = `chart: funnel
title: Test Funnel
Visitors: 1000
Signups: 500
Paid: 100`;

describe('renderEChartsForExport', () => {
  it('renders scatter chart to SVG', async () => {
    const svg = await renderEChartsForExport(SCATTER_INPUT, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders sankey chart to SVG', async () => {
    const svg = await renderEChartsForExport(SANKEY_INPUT, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders chord chart to SVG', async () => {
    const svg = await renderEChartsForExport(CHORD_INPUT, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders function chart to SVG', async () => {
    const svg = await renderEChartsForExport(FUNCTION_INPUT, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders heatmap chart to SVG', async () => {
    const svg = await renderEChartsForExport(HEATMAP_INPUT, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders funnel chart to SVG', async () => {
    const svg = await renderEChartsForExport(FUNNEL_INPUT, 'light');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('returns empty string for invalid input', async () => {
    const svg = await renderEChartsForExport('chart: scatter\n', 'light');
    expect(svg).toBe('');
  });

  it('returns empty string for unsupported chart type', async () => {
    const svg = await renderEChartsForExport('chart: unknown\nA: 1', 'light');
    expect(svg).toBe('');
  });

  it('includes font-family in SVG output', async () => {
    const svg = await renderEChartsForExport(SCATTER_INPUT, 'light');
    expect(svg).toContain('font-family');
  });

  it('renders with dark theme', async () => {
    const svg = await renderEChartsForExport(SCATTER_INPUT, 'dark');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders with transparent theme', async () => {
    const svg = await renderEChartsForExport(SCATTER_INPUT, 'transparent');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  it('renders with explicit palette', async () => {
    const { getPalette } = await import('../src/palettes');
    const palette = getPalette('solarized').light;
    const svg = await renderEChartsForExport(SCATTER_INPUT, 'light', palette);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });
});
