import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import {
  buildEChartsOptionFromChart,
  renderEChartsForExport,
} from '../src/echarts';
import { getDgmoFramework } from '../src/dgmo-router';
import { getPalette } from '../src/palettes';

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

  it('returns empty object on parse error', () => {
    const parsed = parseChart('chart: bar', palette); // no data → error
    const opt = buildEChartsOptionFromChart(parsed, palette, false);
    expect(opt).toEqual({});
  });

  // ── Bar ──────────────────────────────────────────────────

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
