import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { buildEChartsOptionFromChart } from '../src/echarts';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

function build(input: string) {
  const parsed = parseChart(input, palette);
  return buildEChartsOptionFromChart(parsed, palette, false);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function labelFormatter(opt: Record<string, unknown>): any {
  const series = (opt as { series: { label: { formatter: string } }[] }).series;
  return series?.[0]?.label?.formatter;
}

describe('Pie / Doughnut / Polar-Area configurable labels', () => {
  const data = '\nA: 10\nB: 20\nC: 30';

  // ── Pie ────────────────────────────────────────────────────

  it('pie defaults to full format', () => {
    const opt = build('chart: pie' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c} ({d}%)');
  });

  it('pie labels: name shows name only', () => {
    const opt = build('chart: pie\nlabels: name' + data);
    expect(labelFormatter(opt)).toBe('{b}');
  });

  it('pie labels: value shows name and value', () => {
    const opt = build('chart: pie\nlabels: value' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c}');
  });

  it('pie labels: percent shows name and percent', () => {
    const opt = build('chart: pie\nlabels: percent' + data);
    expect(labelFormatter(opt)).toBe('{b} — {d}%');
  });

  it('pie labels: full shows full format', () => {
    const opt = build('chart: pie\nlabels: full' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c} ({d}%)');
  });

  // ── Doughnut ───────────────────────────────────────────────

  it('doughnut labels: name', () => {
    const opt = build('chart: doughnut\nlabels: name' + data);
    expect(labelFormatter(opt)).toBe('{b}');
  });

  // ── Polar-Area ─────────────────────────────────────────────

  it('polar-area labels: percent', () => {
    const opt = build('chart: polar-area\nlabels: percent' + data);
    expect(labelFormatter(opt)).toBe('{b} — {d}%');
  });

  it('polar-area defaults to full format', () => {
    const opt = build('chart: polar-area' + data);
    expect(labelFormatter(opt)).toBe('{b} — {c} ({d}%)');
  });

  // ── Parser ─────────────────────────────────────────────────

  it('parseChart stores labels field', () => {
    const parsed = parseChart('chart: pie\nlabels: name\nA: 10', palette);
    expect(parsed.labels).toBe('name');
  });

  it('parseChart ignores invalid labels value', () => {
    const parsed = parseChart('chart: pie\nlabels: invalid\nA: 10', palette);
    expect(parsed.labels).toBeUndefined();
  });
});
