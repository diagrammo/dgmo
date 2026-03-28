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

  it('pie no-label-value no-label-percent shows name only', () => {
    const opt = build('pie\nno-label-value\nno-label-percent' + data);
    expect(labelFormatter(opt)).toBe('{b}');
  });

  it('pie no-label-percent shows name and value', () => {
    const opt = build('pie\nno-label-percent' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c}');
  });

  it('pie no-label-value shows name and percent', () => {
    const opt = build('pie\nno-label-value' + data);
    expect(labelFormatter(opt)).toBe('{b} — {d}%');
  });

  it('pie with all labels shows full format', () => {
    const opt = build('pie' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c} ({d}%)');
  });

  // ── Doughnut ───────────────────────────────────────────────

  it('doughnut no-label-value no-label-percent shows name only', () => {
    const opt = build('doughnut\nno-label-value\nno-label-percent' + data);
    expect(labelFormatter(opt)).toBe('{b}');
  });

  // ── Polar-Area ─────────────────────────────────────────────

  it('polar-area no-label-name no-label-value shows percent only', () => {
    const opt = build('polar-area\nno-label-name\nno-label-value' + data);
    expect(labelFormatter(opt)).toBe('{d}%');
  });

  it('polar-area defaults to full format', () => {
    const opt = build('polar-area' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c} ({d}%)');
  });

  // ── Parser ─────────────────────────────────────────────────

  it('parseChart stores no-label flags', () => {
    const parsed = parseChart('pie\nno-label-name\nno-label-value\nA 10', palette);
    expect(parsed.noLabelName).toBe(true);
    expect(parsed.noLabelValue).toBe(true);
    expect(parsed.noLabelPercent).toBeUndefined();
  });

  it('parseChart defaults all labels visible', () => {
    const parsed = parseChart('pie\nA 10', palette);
    expect(parsed.noLabelName).toBeUndefined();
    expect(parsed.noLabelValue).toBeUndefined();
    expect(parsed.noLabelPercent).toBeUndefined();
  });
});
