// polar-area-wedge-limit.test.ts — a polar-area chart draws at most
// MAX_POLAR_AREA_WEDGES wedges and errors on the first one past it (#2457).
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { MAX_POLAR_AREA_WEDGES } from '../src/charts-d3/polar-limits';
import { renderDataChartD3 } from '../src/charts-d3/index';

const polar = (n: number) =>
  [
    'polar-area Many wedges',
    '',
    ...Array.from({ length: n }, (_, i) => `W${i + 1} ${(i % 9) + 1}`),
  ].join('\n');

const CODE = 'E_POLAR_AREA_TOO_MANY_WEDGES';

describe('polar-area wedge limit', () => {
  it(`${MAX_POLAR_AREA_WEDGES} wedges raise nothing`, () => {
    const p = parseChart(polar(MAX_POLAR_AREA_WEDGES));
    expect(p.diagnostics.filter((d) => d.code === CODE)).toHaveLength(0);
    expect(p.data).toHaveLength(MAX_POLAR_AREA_WEDGES);
  });

  it('one wedge over the limit raises one error on that wedge', () => {
    const p = parseChart(polar(MAX_POLAR_AREA_WEDGES + 1));
    const hits = p.diagnostics.filter((d) => d.code === CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe('error');
    expect(hits[0]!.line).toBe(3 + MAX_POLAR_AREA_WEDGES);
    expect(hits[0]!.message).toContain(`${MAX_POLAR_AREA_WEDGES + 1} wedges`);
    expect(hits[0]!.message).toContain(`first ${MAX_POLAR_AREA_WEDGES}`);
    expect(hits[0]!.message).toContain('bar chart');
    expect(p.data.map((d) => d.label)).toEqual(
      Array.from({ length: MAX_POLAR_AREA_WEDGES }, (_, i) => `W${i + 1}`)
    );
  });

  it('the 200-wedge file draws only the first wedges and their labels', async () => {
    const svg = await renderDataChartD3(polar(200), 'light');
    expect(svg.match(/<path[^>]*data-line-number/g)).toHaveLength(
      MAX_POLAR_AREA_WEDGES
    );
    const labels = [...svg.matchAll(/<text[^>]*>W(\d+) /g)].map((m) =>
      Number(m[1])
    );
    expect(labels).toHaveLength(MAX_POLAR_AREA_WEDGES);
    expect(Math.max(...labels)).toBe(MAX_POLAR_AREA_WEDGES);
  });
});
