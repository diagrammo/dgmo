import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3';

// #1317: a link that skips a column was one curve from source to target, and
// ran through the nodes of the column it crossed. The factory's run page drew
// In progress → Done straight through Awaiting release.
const SKIP = `sankey Skip

Triage -> Ready for agent 1
Ready for agent -> In progress 13
In progress -> Done 7
In progress -> Awaiting release 5
In progress -> Your turn 1
Awaiting release -> Done 10
`;

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

describe('sankey link that skips a column', () => {
  it('passes the crossed column clear of its nodes', async () => {
    const svg = await renderDataChartD3(SKIP, 'light');
    const rects = [
      ...svg.matchAll(/<rect[^>]*data-emph-key="node:[^>]*>/g),
    ].map((m) => ({
      name: /node:([^"]*)"/.exec(m[0])![1],
      x: Number(attr(m[0], 'x')),
      y: Number(attr(m[0], 'y')),
      h: Number(attr(m[0], 'height')),
    }));
    const awaiting = rects.find((r) => r.name === 'Awaiting release')!;
    const column = rects.filter((r) => r.x === awaiting.x);
    expect(column.length).toBe(2);

    const tag = [...svg.matchAll(/<path[^>]*>/g)]
      .map((m) => m[0])
      .find((t) => t.includes('link:In progress␟Done'))!;
    const pts = [...attr(tag, 'd')!.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(
      (m) => ({ x: Number(m[1]), y: Number(m[2]) })
    );
    // the band's edges where it crosses the Awaiting release column
    const ys = pts.filter((p) => p.x === awaiting.x).map((p) => p.y);
    expect(ys.length).toBeGreaterThanOrEqual(2);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    for (const n of column) {
      expect(hi <= n.y || lo >= n.y + n.h, `crosses ${n.name}`).toBe(true);
    }
  });
});
