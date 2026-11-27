// Function chart magnitude limit (#2437): a curve past FUNCTION_MAX_ABS_Y
// raises an error on its line and is not drawn; the others still plot, and
// a large but legal range prints compact tick labels.
import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { parseFunctionChart } from '../src/data-chart-parser';
import { validateDiagram } from '../src/validate-diagram';
import {
  FUNCTION_MAX_ABS_Y,
  functionOverflows,
  functionSampleXs,
} from '../src/charts-d3/function-limits';

const HUGE_AND_TINY = `function Huge and tiny
x-axis 0..10

big: 1000000000000*x
tiny: 0.000000000001*x
green: exp(1000*x)`;

async function render(src: string): Promise<Element | null> {
  const host = document.createElement('div');
  host.innerHTML = await renderDataChartD3(src, 'light', undefined, {
    width: 800,
    height: 500,
  });
  return host.querySelector('svg');
}

const curves = (svg: Element) =>
  [...svg.querySelectorAll('path[data-series-name]')]
    .filter((p) => p.getAttribute('class') !== 'dgmo-series-area')
    .map((p) => p.getAttribute('data-series-name'));

const ticks = (svg: Element) =>
  [...svg.querySelectorAll('text.dgmo-tick')].map((t) => t.textContent ?? '');

describe('function chart — overflow limit', () => {
  it('exp(1000*x) on 0..10 gives one error on its line and no curve', async () => {
    const parsed = parseFunctionChart(HUGE_AND_TINY);
    const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('E_FUNCTION_OVERFLOW');
    expect(errors[0]!.line).toBe(6);
    expect(errors[0]!.message).toContain('exp(1000*x)');
    expect(errors[0]!.message).toContain('0..10');
    expect(parsed.error).toBeNull();

    const svg = (await render(HUGE_AND_TINY))!;
    expect(curves(svg).sort()).toEqual(['big', 'tiny']);
    for (const t of ticks(svg)) expect(t.length).toBeLessThanOrEqual(6);
  });

  it('a lone overflowing function is the error card, not an empty axis', async () => {
    const src = `function Boom\nx-axis 0..10\n\ngreen: exp(1000*x)`;
    expect(parseFunctionChart(src).error).toContain('Overflow green');
    expect(await render(src)).toBeNull();
  });

  it('1e12*x alone plots with compact tick labels', async () => {
    const src = `function Big\nx-axis 0..10\n\nbig: 1000000000000*x`;
    expect(
      parseFunctionChart(src).diagnostics.filter((d) => d.severity === 'error')
    ).toEqual([]);
    const svg = (await render(src))!;
    expect(curves(svg)).toEqual(['big']);
    const labels = ticks(svg).filter((t) => /\d/.test(t));
    expect(labels).toContain('10T');
    for (const t of labels) expect(t.length).toBeLessThanOrEqual(6);
  });

  it('a pole (1/x at 0) or a domain gap (sqrt(x) below 0) is not an overflow', () => {
    const xs = functionSampleXs({ min: -10, max: 10 });
    expect(functionOverflows('1/x', xs)).toBe(false);
    expect(functionOverflows('sqrt(x)', xs)).toBe(false);
    expect(functionOverflows(`${FUNCTION_MAX_ABS_Y * 10}`, xs)).toBe(true);
  });

  it('the validate path reports the error', () => {
    const v = validateDiagram(HUGE_AND_TINY);
    expect(v.errors.map((e) => e.code)).toEqual(['E_FUNCTION_OVERFLOW']);
  });
});
