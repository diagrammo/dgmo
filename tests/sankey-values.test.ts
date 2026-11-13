import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3';

// #1837: a sankey drew no numbers anywhere — a budget flow showed only names.
// Each node's label now carries its throughput, the larger of what flows in
// and what flows out, through the chart's number format; `no-value` hides it.

/** Node label → the value its bold tspan carries ('' when it has none). */
function labelValues(svg: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of svg.matchAll(
    /<text[^>]*font-size="13"[^>]*>([^<]*)(?:<tspan[^>]*>([^<]*)<\/tspan>)?/g
  )) {
    out.set(m[1]!, (m[2] ?? '').trim());
  }
  return out;
}

const BUDGET = `sankey Budget

Revenue -> Salaries 4200
Revenue -> Rent 1300
Grants -> Salaries 800
Salaries -> Engineering 3000
Salaries -> Support 2000
`;

describe('sankey node values', () => {
  it('every node label carries the larger of its inflow and outflow', async () => {
    const values = labelValues(await renderDataChartD3(BUDGET, 'light'));
    expect(Object.fromEntries(values)).toEqual({
      Revenue: '5,500',
      Grants: '800',
      Salaries: '5,000',
      Rent: '1,300',
      Engineering: '3,000',
      Support: '2,000',
    });
  });

  it('the value is drawn bold, apart from the name', async () => {
    const svg = await renderDataChartD3(BUDGET, 'light');
    expect(svg).toContain('<tspan font-weight="bold"> 5,500</tspan>');
  });

  it('values follow the chart number format', async () => {
    const values = labelValues(
      await renderDataChartD3(`${BUDGET}\nunit k\n`, 'light')
    );
    expect(values.get('Revenue')).toBe('5,500 k');
  });

  it('no-value takes the values off and leaves the names', async () => {
    const svg = await renderDataChartD3(`${BUDGET}\nno-value\n`, 'light');
    expect(svg).not.toContain('<tspan');
    expect([...labelValues(svg).keys()]).toContain('Salaries');
  });

  it('a name too long for its room gives way; its value is kept whole', async () => {
    const long = 'A destination whose name runs on for sixty characters, yes!!';
    const svg = await renderDataChartD3(
      `sankey Long\n\nSource -> ${long} 1234\n`,
      'light'
    );
    const values = labelValues(svg);
    const name = [...values.keys()].find((k) => k.startsWith('A destination'))!;
    expect(name.endsWith('…')).toBe(true);
    expect(values.get(name)).toBe('1,234');
  });
});
