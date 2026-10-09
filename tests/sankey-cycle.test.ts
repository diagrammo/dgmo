import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3';

// #1218: a cycle made longest-path ranking climb one column per pass, so the
// loop's two nodes landed ~N columns out and crushed the real columns left.
const BOUNCE = `sankey Day Fri 9 Oct — every status move

Ready for agent (6) -> In progress (5) 5 gray
In progress (5) -> Ready for agent again (1) 1 purple
Ready for agent again (1) -> In progress again (1) 1 purple
In progress again (1) -> Ready for agent again (1) 1 purple
Triage (1) -> Ready for agent (6) 1 teal
In progress (5) -> Awaiting release (2) 2 teal
Ready for agent (6) -> Your turn (2) 1 blue
In progress (5) -> Your turn (2) 1 blue
In progress (5) -> Done (1) 1 green
`;

/** x of each node rect, keyed by node name. */
function nodeX(svg: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of svg.matchAll(/<rect[^>]*>/g)) {
    const tag = m[0];
    const key = /data-emph-key="node:([^"]*)"/.exec(tag)?.[1];
    const x = /\sx="([^"]*)"/.exec(tag)?.[1];
    if (key && x) out.set(key, Number(x));
  }
  return out;
}

describe('sankey with a cycle', () => {
  it('lays out one column per acyclic depth, not per ranking pass', async () => {
    const xs = nodeX(await renderDataChartD3(BOUNCE, 'light'));
    expect(xs.size).toBe(8);
    // Triage → Ready → In progress → Ready again → In progress again
    expect(new Set(xs.values()).size).toBe(5);
    const order = [
      'Triage (1)',
      'Ready for agent (6)',
      'In progress (5)',
      'Ready for agent again (1)',
      'In progress again (1)',
    ].map((n) => xs.get(n)!);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(xs.get('Done (1)')).toBe(xs.get('Ready for agent again (1)'));
  });

  it('still draws the closing flow, as a return ribbon', async () => {
    const svg = await renderDataChartD3(BOUNCE, 'light');
    const back = [...svg.matchAll(/<path[^>]*>/g)]
      .map((m) => m[0])
      .filter((t) =>
        t.includes('link:In progress again (1)␟Ready for agent again (1)')
      );
    expect(back).toHaveLength(1);
    expect(back[0]).toContain('fill="none"');
    expect(back[0]).toMatch(/stroke-width="[\d.]+"/);
  });

  it('handles a graph that is nothing but a cycle', async () => {
    const xs = nodeX(
      await renderDataChartD3('sankey Loop\n\nA -> B 1\nB -> A 1\n', 'light')
    );
    expect(new Set(xs.values()).size).toBe(2);
  });

  it('leaves an acyclic sankey free of return ribbons', async () => {
    const svg = await renderDataChartD3(
      'sankey Flat\n\nA -> B 2\nB -> C 1\nB -> D 1\n',
      'light'
    );
    expect(svg).not.toContain('fill="none"');
  });
});
