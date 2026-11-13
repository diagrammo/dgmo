// Step line and the time x-axis (#1880). A line whose every row is an ISO
// date places rows by time; `step` / `step-before` draw held values.
import { describe, it, expect } from 'vitest';
import { parseChart } from '../src/chart';
import { renderDataChartD3 } from '../src/charts-d3';
import { isoDatesOf, parseIsoDateLabel } from '../src/charts-d3/date-axis';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

/** cx of every point of the first series, in row order. */
function pointXs(svg: string): number[] {
  const out: number[] = [];
  const re =
    /<circle[^>]*class="dgmo-pt"[^>]*data-series-index="0"[^>]*cx="([\d.]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) out.push(Number(m[1]));
  return out;
}

/** The `d` of the first series' line path. */
function linePath(svg: string): string {
  return svg.match(/class="dgmo-series-line" d="([^"]+)"/)![1]!;
}

const RATES = `line Fed funds rate
2022-01 0.25
2022-03 0.50
2022-04 1.00
2023-07 5.50
2024-09 5.00`;

describe('ISO date labels', () => {
  it('reads YYYY-MM and YYYY-MM-DD', () => {
    expect(parseIsoDateLabel('2022-03')?.getMonth()).toBe(2);
    expect(parseIsoDateLabel('2022-03-15')?.getDate()).toBe(15);
  });

  it('rejects other forms and impossible dates', () => {
    for (const s of ['2022', 'Q1 2022', '2022-13', '2023-02-30', '03/2022'])
      expect(parseIsoDateLabel(s)).toBeNull();
  });

  it('needs every row to be a date', () => {
    expect(isoDatesOf(['2022-01', '2022-02'])).not.toBeNull();
    expect(isoDatesOf(['2022-01', 'Feb'])).toBeNull();
    expect(isoDatesOf(['2020', '2021'])).toBeNull();
  });
});

describe('line time axis', () => {
  it('spaces dated rows by time, not evenly', async () => {
    const xs = pointXs(await renderDataChartD3(RATES, 'light', palette));
    expect(xs).toHaveLength(5);
    // Jan→Mar is two months; Apr 2022→Jul 2023 is fifteen.
    const twoMonths = xs[1]! - xs[0]!;
    const fifteenMonths = xs[3]! - xs[2]!;
    expect(fifteenMonths / twoMonths).toBeGreaterThan(6);
    expect(fifteenMonths / twoMonths).toBeLessThan(9);
  });

  it('labels the axis with time ticks, not the row labels', async () => {
    const svg = await renderDataChartD3(RATES, 'light', palette);
    expect(svg).not.toContain('>2022-03<');
    // Under three years the axis ticks months, thinned to fit (#1830).
    expect(svg).toMatch(/>\w{3} '23</);
  });

  it('keeps even spacing for bare years', async () => {
    const xs = pointXs(
      await renderDataChartD3(
        'line X\n2019 1\n2020 2\n2024 3',
        'light',
        palette
      )
    );
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 5);
  });

  it('places eras on the time axis by their rows', async () => {
    const svg = await renderDataChartD3(
      `${RATES}\n\nera 2022-04 -> 2023-07 Hikes`,
      'light',
      palette
    );
    const xs = pointXs(svg);
    const rect = svg.match(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/)!;
    expect(Number(rect[1])).toBeCloseTo(xs[2]!, 3);
    expect(Number(rect[1]) + Number(rect[2])).toBeCloseTo(xs[3]!, 3);
  });
});

describe('step and step-before', () => {
  it('parses the flags', () => {
    expect(parseChart('line X\nstep\nA 1').step).toBe('after');
    expect(parseChart('line X\nstep-before\nA 1').step).toBe('before');
  });

  it('errors when both are set', () => {
    const r = parseChart('line X\nstep\nstep-before\nA 1');
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('warns and drops the flag off a line chart', () => {
    const r = parseChart('bar X\nstep\nA 1');
    expect(r.step).toBeUndefined();
    expect(r.diagnostics.some((d) => /only to line/.test(d.message))).toBe(
      true
    );
  });

  it('step holds each value until the next point and stops at the last', async () => {
    const svg = await renderDataChartD3(
      'line X\nstep\nA 1\nB 3\nC 2',
      'light',
      palette
    );
    const xs = pointXs(svg);
    const d = linePath(svg);
    // Horizontal-then-vertical: every segment is axis-aligned.
    const coords = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    for (let i = 1; i < coords.length; i++) {
      const [x0, y0] = coords[i - 1]!;
      const [x1, y1] = coords[i]!;
      expect(Math.abs(x1! - x0!) < 1e-6 || Math.abs(y1! - y0!) < 1e-6).toBe(
        true
      );
    }
    // After: the jump to B's value happens at B's x.
    expect(coords[1]![0]).toBeCloseTo(xs[1]!, 3);
    expect(coords[1]![1]).toBeCloseTo(coords[0]![1]!, 3);
    // The line ends at the last point, not the plot edge.
    expect(coords[coords.length - 1]![0]).toBeCloseTo(xs[2]!, 3);
  });

  it('step-before reaches each value at its own point', async () => {
    const svg = await renderDataChartD3(
      'line X\nstep-before\nA 1\nB 3\nC 2',
      'light',
      palette
    );
    const xs = pointXs(svg);
    const coords = [...linePath(svg).matchAll(/(-?[\d.]+),(-?[\d.]+)/g)];
    // Before: the vertical comes first, at A's x.
    expect(Number(coords[1]![1])).toBeCloseTo(xs[0]!, 3);
  });

  it('hover points still sit on the data values', async () => {
    const svg = await renderDataChartD3(
      'line X\nstep\nA 1\nB 3',
      'light',
      palette
    );
    expect(svg).toContain('data-value="1"');
    expect(svg).toContain('data-value="3"');
  });

  it('steps the filled area too', async () => {
    const svg = await renderDataChartD3(
      'line X\nstep\nfill\nA 1\nB 3\nC 2',
      'light',
      palette
    );
    const area = svg.match(/class="dgmo-series-area" d="([^"]+)"/)![1]!;
    expect(area.split('L').length).toBeGreaterThan(6);
  });
});
