import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { buildSimpleChartOption } from '../src/echarts';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

function build(input: string) {
  const parsed = parseChart(input, palette);
  return buildSimpleChartOption(parsed, palette, false);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function labelFormatter(opt: Record<string, unknown>): any {
  const series = (opt as { series: { label: { formatter: string } }[] }).series;
  return series?.[0]?.label?.formatter;
}

describe('Pie / Doughnut / Polar-Area configurable labels', () => {
  const data = '\nA 10\nB 20\nC 30';

  // ── Pie ────────────────────────────────────────────────────

  it('pie defaults to full format', () => {
    const opt = build('pie' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c} ({d}%)');
  });

  it('pie no-value no-percent shows name only', () => {
    const opt = build('pie\nno-value\nno-percent' + data);
    expect(labelFormatter(opt)).toBe('{b}');
  });

  it('pie no-percent shows name and value', () => {
    const opt = build('pie\nno-percent' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c}');
  });

  it('pie no-value shows name and percent', () => {
    const opt = build('pie\nno-value' + data);
    expect(labelFormatter(opt)).toBe('{b} — {d}%');
  });

  it('pie with all labels shows full format', () => {
    const opt = build('pie' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c} ({d}%)');
  });

  // ── Doughnut ───────────────────────────────────────────────

  it('doughnut no-value no-percent shows name only', () => {
    const opt = build('doughnut\nno-value\nno-percent' + data);
    expect(labelFormatter(opt)).toBe('{b}');
  });

  // ── Polar-Area ─────────────────────────────────────────────

  it('polar-area no-name no-value shows percent only', () => {
    const opt = build('polar-area\nno-name\nno-value' + data);
    expect(labelFormatter(opt)).toBe('{d}%');
  });

  it('polar-area defaults to full format', () => {
    const opt = build('polar-area' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c} ({d}%)');
  });

  // ── Parser ─────────────────────────────────────────────────

  it('parseChart stores no-* flags', () => {
    const parsed = parseChart('pie\nno-name\nno-value\nA 10', palette);
    expect(parsed.noName).toBe(true);
    expect(parsed.noValue).toBe(true);
    expect(parsed.noPercent).toBeUndefined();
  });

  it('parseChart defaults all labels visible', () => {
    const parsed = parseChart('pie\nA 10', palette);
    expect(parsed.noName).toBeUndefined();
    expect(parsed.noValue).toBeUndefined();
    expect(parsed.noPercent).toBeUndefined();
  });

  // ── Retired flag diagnostic ────────────────────────────────

  it('errors on retired no-label-name with did-you-mean', () => {
    const r = parseChart('pie\nno-label-name\nA 10\nB 20', palette);
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('no-label-name');
    expect(r.error).toContain('no-name');
  });

  it('errors on retired no-label-value with did-you-mean', () => {
    const r = parseChart('pie\nno-label-value\nA 10', palette);
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('no-value');
  });

  it('errors on retired no-label-percent with did-you-mean', () => {
    const r = parseChart('pie\nno-label-percent\nA 10', palette);
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('no-percent');
  });

  // ── Silent-ignore unknown no-* flags ───────────────────────

  it('silent-ignores typoed no-* flag (no-vlaue)', () => {
    const r = parseChart('pie\nno-vlaue\nA 10\nB 20', palette);
    expect(r.error).toBeNull();
    expect(r.noValue).toBeUndefined();
  });

  it('silent-ignores no-name on a bar chart (not honored, but parses)', () => {
    const r = parseChart('bar\nno-name\nA 10\nB 20', palette);
    expect(r.error).toBeNull();
    expect(r.noName).toBe(true);
  });
});

// ─── New cartesian value labels (Phase 2a) ────────────────────────

describe('Cartesian value labels (bar / line / area)', () => {
  const data = '\nJan 100\nFeb 200\nMar 150';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function labelShow(opt: Record<string, unknown>): any {
    const series = (opt as { series: { label?: { show?: boolean } }[] }).series;
    return series?.[0]?.label?.show;
  }

  it('bar shows values atop bars by default', () => {
    expect(labelShow(build('bar' + data))).toBe(true);
  });

  it('bar with no-value hides value labels', () => {
    expect(labelShow(build('bar\nno-value' + data))).toBe(false);
  });

  it('line shows values at points by default', () => {
    expect(labelShow(build('line' + data))).toBe(true);
  });

  it('line with no-value hides value labels', () => {
    expect(labelShow(build('line\nno-value' + data))).toBe(false);
  });

  it('area shows values at points by default', () => {
    expect(labelShow(build('area' + data))).toBe(true);
  });

  it('area with no-value hides value labels', () => {
    expect(labelShow(build('area\nno-value' + data))).toBe(false);
  });
});

// ─── Wired-existing-rendering renderer tests (Phase 1) ────────────

describe('no-value suppression on default-on charts', () => {
  it('radar shows values at vertices by default', () => {
    const data = '\nA 10\nB 20\nC 30\nD 40';
    const opt = build('radar' + data) as {
      series: { data: { label?: { show?: boolean } }[] }[];
    };
    expect(opt.series[0].data[0].label?.show).toBe(true);
  });

  it('radar with no-value hides vertex values', () => {
    const data = '\nA 10\nB 20\nC 30\nD 40';
    const opt = build('radar\nno-value' + data) as {
      series: { data: { label?: { show?: boolean } }[] }[];
    };
    expect(opt.series[0].data[0].label?.show).toBe(false);
  });

  it('bar-stacked shows segment values inside stacks by default', () => {
    const data = '\nseries A, B\nQ1 10, 20\nQ2 30, 40';
    const opt = build('bar-stacked' + data) as {
      series: { label?: { show?: boolean } }[];
    };
    expect(opt.series?.[0]?.label?.show).toBe(true);
  });

  it('bar-stacked with no-value hides segment values', () => {
    const data = '\nseries A, B\nQ1 10, 20\nQ2 30, 40';
    const opt = build('bar-stacked\nno-value' + data) as {
      series: { label?: { show?: boolean } }[];
    };
    expect(opt.series?.[0]?.label?.show).toBe(false);
  });
});
