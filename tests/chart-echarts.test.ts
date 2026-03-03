import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { parseEChart, buildEChartsOption } from '../src/echarts';
import {
  buildEChartsOptionFromChart,
  renderEChartsForExport,
} from '../src/echarts';
import { getDgmoFramework } from '../src/dgmo-router';
import { getPalette } from '../src/palettes';
import { collectIndentedValues } from '../src/utils/parsing';

const palette = getPalette('nord').light;

// Helper: parse + build in one step
function build(input: string) {
  const parsed = parseChart(input, palette);
  return buildEChartsOptionFromChart(parsed, palette, false);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function series(opt: Record<string, unknown>): any[] {
  return (opt as { series: unknown[] }).series ?? [];
}

describe('buildEChartsOptionFromChart', () => {
  // ── Common properties ────────────────────────────────────

  it('returns transparent background and animation: false for all types', () => {
    const inputs = [
      'chart: bar\nA: 10\nB: 20',
      'chart: line\nA: 10\nB: 20',
      'chart: area\nA: 10\nB: 20',
      'chart: pie\nA: 10\nB: 20',
      'chart: doughnut\nA: 10\nB: 20',
      'chart: radar\nA: 10\nB: 20',
      'chart: polar-area\nA: 10\nB: 20',
      'chart: bar-stacked\nseries: X, Y\nA: 10, 20\nB: 30, 40',
      'chart: multi-line\nseries: X, Y\nA: 10, 20\nB: 30, 40',
    ];
    for (const input of inputs) {
      const opt = build(input);
      expect(opt).toHaveProperty('backgroundColor', 'transparent');
      expect(opt).toHaveProperty('animation', false);
    }
  });

  // ── Error ────────────────────────────────────────────────

  it('returns warning diagnostic when no data points', () => {
    const parsed = parseChart('chart: bar', palette); // no data → warning
    expect(parsed.error).toBeNull();
    // diagnostics
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0].severity).toBe('warning');
    expect(parsed.diagnostics[0].line).toBe(1);
  });

  // ── Bar ──────────────────────────────────────────────────

  it('successful parse has empty diagnostics', () => {
    const parsed = parseChart('chart: bar\nA: 10\nB: 20', palette);
    expect(parsed.error).toBeNull();
    expect(parsed.diagnostics).toEqual([]);
  });

  it('builds bar chart with per-point colors', () => {
    const opt = build('chart: bar\ntitle: Sales\nA: 10\nB: 20\nC: 30');
    const s = series(opt);
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe('bar');
    expect(s[0].data).toHaveLength(3);
    // Each data item should have itemStyle.color
    for (const d of s[0].data) {
      expect(d.itemStyle.color).toBeDefined();
    }
    // Title present
    expect(opt).toHaveProperty('title');
    expect((opt.title as { text: string }).text).toBe('Sales');
  });

  it('swaps axes for horizontal bar', () => {
    const opt = build('chart: bar\norientation: horizontal\nA: 10\nB: 20');
    // xAxis should be value, yAxis should be category
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const xAxis = (opt as any).xAxis;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yAxis = (opt as any).yAxis;
    expect(xAxis.type).toBe('value');
    expect(yAxis.type).toBe('category');
  });

  // ── Line ─────────────────────────────────────────────────

  it('builds line chart with smooth: false and crosshair', () => {
    const opt = build('chart: line\nA: 10\nB: 20');
    const s = series(opt);
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe('line');
    expect(s[0].smooth).toBe(false);
    expect(s[0].symbolSize).toBe(8);
    // axisPointer should be line type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tooltip = (opt as any).tooltip;
    expect(tooltip.axisPointer.type).toBe('line');
  });

  it('uses single color from parsed.color', () => {
    const opt = build('chart: line\ncolor: #ff0000\nA: 10\nB: 20');
    const s = series(opt);
    expect(s[0].lineStyle.color).toBe('#ff0000');
    expect(s[0].itemStyle.color).toBe('#ff0000');
  });

  // ── Multi-line ───────────────────────────────────────────

  it('builds multi-line with correct data transpose and legend', () => {
    const opt = build(
      'chart: multi-line\nseries: Revenue, Cost\nJan: 100, 50\nFeb: 200, 80'
    );
    const s = series(opt);
    expect(s).toHaveLength(2);
    expect(s[0].name).toBe('Revenue');
    expect(s[1].name).toBe('Cost');
    // Data transposed correctly
    expect(s[0].data).toEqual([100, 200]);
    expect(s[1].data).toEqual([50, 80]);
    // Legend present
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((opt as any).legend).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((opt as any).legend.data).toEqual(['Revenue', 'Cost']);
  });

  // ── Area ─────────────────────────────────────────────────

  it('builds area chart with areaStyle', () => {
    const opt = build('chart: area\nA: 10\nB: 20');
    const s = series(opt);
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe('line');
    expect(s[0].areaStyle).toBeDefined();
    expect(s[0].areaStyle.opacity).toBe(0.25);
  });

  // ── Pie ──────────────────────────────────────────────────

  it('builds pie chart with outer labels and no inner hole', () => {
    const opt = build('chart: pie\nA: 10\nB: 20\nC: 30');
    const s = series(opt);
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe('pie');
    expect(s[0].radius).toEqual(['0%', '70%']);
    expect(s[0].label.position).toBe('outside');
    expect(s[0].label.formatter).toBe('{b} — {c} ({d}%)');
    expect(s[0].labelLine.show).toBe(true);
    // Per-point colors
    for (const d of s[0].data) {
      expect(d.itemStyle.color).toBeDefined();
    }
  });

  // ── Doughnut ─────────────────────────────────────────────

  it('builds doughnut with inner hole radius', () => {
    const opt = build('chart: doughnut\nA: 10\nB: 20\nC: 30');
    const s = series(opt);
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe('pie');
    expect(s[0].radius).toEqual(['40%', '70%']);
  });

  // ── Radar ────────────────────────────────────────────────

  it('builds radar with indicators and value labels', () => {
    const opt = build('chart: radar\nSpeed: 80\nPower: 60\nDefense: 90');
    const s = series(opt);
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe('radar');
    // Radar component with indicators
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const radar = (opt as any).radar;
    expect(radar).toBeDefined();
    expect(radar.indicator).toHaveLength(3);
    // Max auto-calculated: max(80,60,90) * 1.15 = 103.5
    expect(radar.indicator[0].max).toBeCloseTo(103.5);
    // Value labels shown
    expect(s[0].data[0].label.show).toBe(true);
    expect(s[0].data[0].label.formatter).toBe('{c}');
  });

  // ── Polar Area ───────────────────────────────────────────

  it('builds polar area as pie with roseType radius', () => {
    const opt = build('chart: polar-area\nA: 10\nB: 20\nC: 30');
    const s = series(opt);
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe('pie');
    expect(s[0].roseType).toBe('radius');
    // Per-point colors
    for (const d of s[0].data) {
      expect(d.itemStyle.color).toBeDefined();
    }
  });

  // ── Bar Stacked ──────────────────────────────────────────

  it('builds bar-stacked with multiple series all stacked', () => {
    const opt = build(
      'chart: bar-stacked\nseries: A, B, C\nQ1: 10, 20, 30\nQ2: 40, 50, 60'
    );
    const s = series(opt);
    expect(s).toHaveLength(3);
    for (const ss of s) {
      expect(ss.type).toBe('bar');
      expect(ss.stack).toBe('total');
    }
    // Data transposed correctly
    expect(s[0].data).toEqual([10, 40]);
    expect(s[1].data).toEqual([20, 50]);
    expect(s[2].data).toEqual([30, 60]);
    // Legend present
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((opt as any).legend).toBeDefined();
  });

  it('swaps axes for horizontal bar-stacked', () => {
    const opt = build(
      'chart: bar-stacked\norientation: horizontal\nseries: A, B\nQ1: 10, 20\nQ2: 30, 40'
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const xAxis = (opt as any).xAxis;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yAxis = (opt as any).yAxis;
    expect(xAxis.type).toBe('value');
    expect(yAxis.type).toBe('category');
  });
});

// ── Router tests ──────────────────────────────────────────────

describe('getDgmoFramework — standard chart types route to echart', () => {
  const standardTypes = [
    'bar',
    'line',
    'multi-line',
    'area',
    'pie',
    'doughnut',
    'radar',
    'polar-area',
    'bar-stacked',
  ];

  for (const type of standardTypes) {
    it(`routes "${type}" to echart`, () => {
      expect(getDgmoFramework(type)).toBe('echart');
    });
  }

  it('still routes native echart types to echart', () => {
    expect(getDgmoFramework('scatter')).toBe('echart');
    expect(getDgmoFramework('sankey')).toBe('echart');
    expect(getDgmoFramework('funnel')).toBe('echart');
  });
});

// ── collectIndentedValues unit tests ─────────────────────────

describe('collectIndentedValues', () => {
  it('collects indented lines after start index', () => {
    const lines = ['series:', '  Rum', '  Spices', '  Gold', 'Jan: 10'];
    const { values, newIndex } = collectIndentedValues(lines, 0);
    expect(values).toEqual(['Rum', 'Spices', 'Gold']);
    expect(newIndex).toBe(3);
  });

  it('skips blank lines within block', () => {
    const lines = ['series:', '  Rum', '', '  Spices', 'Jan: 10'];
    const { values } = collectIndentedValues(lines, 0);
    expect(values).toEqual(['Rum', 'Spices']);
  });

  it('skips comment lines within block', () => {
    const lines = ['series:', '  Rum', '  // a comment', '  Spices', 'Jan: 10'];
    const { values } = collectIndentedValues(lines, 0);
    expect(values).toEqual(['Rum', 'Spices']);
  });

  it('strips trailing commas', () => {
    const lines = ['series:', '  Rum,', '  Spices, ', '  Gold'];
    const { values } = collectIndentedValues(lines, 0);
    expect(values).toEqual(['Rum', 'Spices', 'Gold']);
  });

  it('returns empty array when no indented lines follow', () => {
    const lines = ['series:', 'Jan: 10'];
    const { values, newIndex } = collectIndentedValues(lines, 0);
    expect(values).toEqual([]);
    expect(newIndex).toBe(0);
  });

  it('handles EOF after indented lines', () => {
    const lines = ['series:', '  A', '  B'];
    const { values, newIndex } = collectIndentedValues(lines, 0);
    expect(values).toEqual(['A', 'B']);
    expect(newIndex).toBe(2);
  });

  it('handles tab indentation', () => {
    const lines = ['series:', '\tRum', '\tSpices', 'Jan: 10'];
    const { values } = collectIndentedValues(lines, 0);
    expect(values).toEqual(['Rum', 'Spices']);
  });
});

// ── Multi-line series in parseChart ─────────────────────────

describe('parseChart — multi-line series', () => {
  it('parses multi-line series for bar-stacked', () => {
    const input = [
      'chart: bar-stacked',
      'series:',
      '  Rum',
      '  Spices',
      '  Gold',
      '',
      'Q1: 10, 20, 30',
      'Q2: 40, 50, 60',
    ].join('\n');
    const parsed = parseChart(input, palette);
    expect(parsed.seriesNames).toEqual(['Rum', 'Spices', 'Gold']);
    expect(parsed.data).toHaveLength(2);
  });

  it('parses multi-line series with color annotations', () => {
    const input = [
      'chart: bar-stacked',
      'series:',
      '  Rum (red)',
      '  Spices (green)',
      '  Gold (yellow)',
      '',
      'Q1: 10, 20, 30',
    ].join('\n');
    const parsed = parseChart(input, palette);
    expect(parsed.seriesNames).toEqual(['Rum', 'Spices', 'Gold']);
    expect(parsed.seriesNameColors).toHaveLength(3);
    expect(parsed.seriesNameColors![0]).toBeDefined();
    expect(parsed.seriesNameColors![1]).toBeDefined();
    expect(parsed.seriesNameColors![2]).toBeDefined();
  });

  it('single-line series still works (regression)', () => {
    const input = 'chart: bar-stacked\nseries: A, B, C\nQ1: 10, 20, 30';
    const parsed = parseChart(input, palette);
    expect(parsed.seriesNames).toEqual(['A', 'B', 'C']);
  });

  it('multi-line series produces identical ECharts option to single-line', () => {
    const singleLine = build(
      'chart: bar-stacked\nseries: Rum, Spices, Gold\nQ1: 10, 20, 30\nQ2: 40, 50, 60'
    );
    const multiLine = build(
      [
        'chart: bar-stacked',
        'series:',
        '  Rum',
        '  Spices',
        '  Gold',
        '',
        'Q1: 10, 20, 30',
        'Q2: 40, 50, 60',
      ].join('\n')
    );
    expect(series(multiLine)).toEqual(series(singleLine));
  });
});

// ── Multi-line columns/rows in parseEChart ──────────────────

describe('parseEChart — multi-line columns/rows', () => {
  it('parses multi-line columns for heatmap', () => {
    const input = [
      'chart: heatmap',
      'columns:',
      '  Jan',
      '  Feb',
      '  Mar',
      '',
      'Team A: 5, 4, 3',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.columns).toEqual(['Jan', 'Feb', 'Mar']);
  });

  it('parses multi-line rows for heatmap', () => {
    const input = [
      'chart: heatmap',
      'columns: Jan, Feb',
      'rows:',
      '  Team A',
      '  Team B',
      '',
      'Team A: 5, 4',
      'Team B: 3, 2',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.rows).toEqual(['Team A', 'Team B']);
  });

  it('single-line columns still works (regression)', () => {
    const input = 'chart: heatmap\ncolumns: Jan, Feb, Mar\nTeam A: 5, 4, 3';
    const parsed = parseEChart(input, palette);
    expect(parsed.columns).toEqual(['Jan', 'Feb', 'Mar']);
  });
});

// ── SSR render test ───────────────────────────────────────────

describe('renderEChartsForExport — standard chart types', () => {
  it('renders a bar chart to SVG via the parseChart→ECharts pipeline', async () => {
    const svg = await renderEChartsForExport(
      'chart: bar\nA: 10\nB: 20',
      'light'
    );
    expect(svg).toContain('<svg');
  });

  it('still renders native echart types', async () => {
    const svg = await renderEChartsForExport(
      'chart: funnel\nA: 100\nB: 60\nC: 30',
      'light'
    );
    expect(svg).toContain('<svg');
  });
});

// ── Sankey indentation syntax ─────────────────────────────────

describe('parseEChart — sankey indentation syntax', () => {
  it('basic indentation: source with indented targets produces correct links', () => {
    const input = [
      'chart: sankey',
      '',
      'Revenue',
      '  Costs: 600',
      '  Profit: 400',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.links).toHaveLength(2);
    expect(parsed.links![0]).toMatchObject({ source: 'Revenue', target: 'Costs', value: 600 });
    expect(parsed.links![1]).toMatchObject({ source: 'Revenue', target: 'Profit', value: 400 });
  });

  it('deep nesting: 3-level nesting produces correct parent→child links', () => {
    const input = [
      'chart: sankey',
      '',
      'Revenue',
      '  Operating Costs: 400',
      '    Rent: 150',
      '    Utilities: 100',
      '    Supplies: 150',
      '  Salaries: 300',
      '    Engineering: 180',
      '    Sales: 120',
      '  Profit: 300',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.links).toHaveLength(8);
    // Level 1: Revenue → children
    expect(parsed.links![0]).toMatchObject({ source: 'Revenue', target: 'Operating Costs', value: 400 });
    expect(parsed.links![4]).toMatchObject({ source: 'Revenue', target: 'Salaries', value: 300 });
    expect(parsed.links![7]).toMatchObject({ source: 'Revenue', target: 'Profit', value: 300 });
    // Level 2: Operating Costs → children
    expect(parsed.links![1]).toMatchObject({ source: 'Operating Costs', target: 'Rent', value: 150 });
    expect(parsed.links![2]).toMatchObject({ source: 'Operating Costs', target: 'Utilities', value: 100 });
    expect(parsed.links![3]).toMatchObject({ source: 'Operating Costs', target: 'Supplies', value: 150 });
    // Level 2: Salaries → children
    expect(parsed.links![5]).toMatchObject({ source: 'Salaries', target: 'Engineering', value: 180 });
    expect(parsed.links![6]).toMatchObject({ source: 'Salaries', target: 'Sales', value: 120 });
  });

  it('multiple source groups: two bare labels each with children', () => {
    const input = [
      'chart: sankey',
      '',
      'Source A',
      '  Target 1: 100',
      '  Target 2: 200',
      'Source B',
      '  Target 3: 300',
      '  Target 4: 400',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.links).toHaveLength(4);
    expect(parsed.links![0]).toMatchObject({ source: 'Source A', target: 'Target 1', value: 100 });
    expect(parsed.links![1]).toMatchObject({ source: 'Source A', target: 'Target 2', value: 200 });
    expect(parsed.links![2]).toMatchObject({ source: 'Source B', target: 'Target 3', value: 300 });
    expect(parsed.links![3]).toMatchObject({ source: 'Source B', target: 'Target 4', value: 400 });
  });

  it('mixed syntax: flat arrows + indented groups coexist', () => {
    const input = [
      'chart: sankey',
      '',
      '// Flat arrow',
      'External -> Revenue: 1000',
      '',
      '// Indented',
      'Revenue',
      '  Costs: 600',
      '  Profit: 400',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.links).toHaveLength(3);
    expect(parsed.links![0]).toMatchObject({ source: 'External', target: 'Revenue', value: 1000 });
    expect(parsed.links![1]).toMatchObject({ source: 'Revenue', target: 'Costs', value: 600 });
    expect(parsed.links![2]).toMatchObject({ source: 'Revenue', target: 'Profit', value: 400 });
  });

  it('backward compat: flat-only sankey still parses identically', () => {
    const input = [
      'chart: sankey',
      '',
      'A -> B: 100',
      'A -> C: 200',
      'B -> D: 50',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.links).toHaveLength(3);
    expect(parsed.links![0]).toMatchObject({ source: 'A', target: 'B', value: 100 });
    expect(parsed.links![1]).toMatchObject({ source: 'A', target: 'C', value: 200 });
    expect(parsed.links![2]).toMatchObject({ source: 'B', target: 'D', value: 50 });
  });

  it('comments and blank lines inside indented group do not break it', () => {
    const input = [
      'chart: sankey',
      '',
      'Revenue',
      '  // Core business',
      '  Operating Costs: 400',
      '  Salaries: 300',
      '',
      '  // Retained',
      '  Profit: 300',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.links).toHaveLength(3);
    expect(parsed.links![0]).toMatchObject({ source: 'Revenue', target: 'Operating Costs', value: 400 });
    expect(parsed.links![1]).toMatchObject({ source: 'Revenue', target: 'Salaries', value: 300 });
    expect(parsed.links![2]).toMatchObject({ source: 'Revenue', target: 'Profit', value: 300 });
  });
});

// ── Sankey color annotations ─────────────────────────────────

describe('parseEChart — sankey color annotations', () => {
  it('node color via indentation syntax: bare label with (color)', () => {
    const input = [
      'chart: sankey',
      '',
      'Revenue (green)',
      '  Costs: 600',
      '  Profit: 400',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.nodeColors).toBeDefined();
    expect(parsed.nodeColors!['Revenue']).toBe('#a3be8c');
    // Source name is clean (no color suffix)
    expect(parsed.links![0].source).toBe('Revenue');
    expect(parsed.links![1].source).toBe('Revenue');
  });

  it('target node color via indentation syntax', () => {
    const input = [
      'chart: sankey',
      '',
      'Revenue',
      '  Costs (red): 600',
      '  Profit (blue): 400',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.nodeColors!['Costs']).toBe('#bf616a');
    expect(parsed.nodeColors!['Profit']).toBe('#5e81ac');
    expect(parsed.links![0].target).toBe('Costs');
    expect(parsed.links![1].target).toBe('Profit');
  });

  it('node colors via arrow syntax', () => {
    const input = [
      'chart: sankey',
      '',
      'A (blue) -> B (red): 100',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.nodeColors!['A']).toBe('#5e81ac');
    expect(parsed.nodeColors!['B']).toBe('#bf616a');
    expect(parsed.links![0].source).toBe('A');
    expect(parsed.links![0].target).toBe('B');
  });

  it('link color via indentation syntax', () => {
    const input = [
      'chart: sankey',
      '',
      'Revenue',
      '  Costs: 600 (orange)',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.links![0].color).toBe('#d08770');
    expect(parsed.links![0].value).toBe(600);
  });

  it('link color via arrow syntax', () => {
    const input = [
      'chart: sankey',
      '',
      'A -> B: 100 (purple)',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.links![0].color).toBe('#b48ead');
    expect(parsed.links![0].value).toBe(100);
  });

  it('uncolored sankey still works (backward compat)', () => {
    const input = [
      'chart: sankey',
      '',
      'A -> B: 100',
      'B -> C: 50',
    ].join('\n');
    const parsed = parseEChart(input, palette);
    expect(parsed.nodeColors).toBeUndefined();
    expect(parsed.links![0].color).toBeUndefined();
    expect(parsed.links![1].color).toBeUndefined();
    expect(parsed.links).toHaveLength(2);
  });
});

describe('buildSankeyOption — color annotations', () => {
  // Helper to parse + build sankey (native echart type, not routed through parseChart)
  function buildSankey(input: string) {
    const parsed = parseEChart(input, palette);
    return buildEChartsOption(parsed, palette, false);
  }

  it('uses nodeColors for node itemStyle.color', () => {
    const input = [
      'chart: sankey',
      '',
      'A (green) -> B (red): 100',
      'B -> C: 50',
    ].join('\n');
    const opt = buildSankey(input);
    const s = series(opt)[0];
    const nodeA = s.data.find((n: { name: string }) => n.name === 'A');
    const nodeB = s.data.find((n: { name: string }) => n.name === 'B');
    const nodeC = s.data.find((n: { name: string }) => n.name === 'C');
    expect(nodeA.itemStyle.color).toBe('#a3be8c');
    expect(nodeB.itemStyle.color).toBe('#bf616a');
    // C has no annotation — falls back to palette color
    expect(nodeC.itemStyle.color).toBeDefined();
    expect(nodeC.itemStyle.color).not.toBe('#a3be8c');
  });

  it('applies lineStyle.color on colored links', () => {
    const input = [
      'chart: sankey',
      '',
      'A -> B: 100 (orange)',
      'A -> C: 50',
    ].join('\n');
    const opt = buildSankey(input);
    const s = series(opt)[0];
    const linkAB = s.links.find((l: { source: string; target: string }) => l.source === 'A' && l.target === 'B');
    const linkAC = s.links.find((l: { source: string; target: string }) => l.source === 'A' && l.target === 'C');
    expect(linkAB.lineStyle).toEqual({ color: '#d08770' });
    expect(linkAC.lineStyle).toBeUndefined();
  });
});
