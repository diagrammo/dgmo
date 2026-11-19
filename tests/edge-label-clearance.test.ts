// Edge labels in state and flowchart diagrams never sit on a node (#1948).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '../src/render';
import { parseState } from '../src/graph/state-parser';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { layoutGraph } from '../src/graph/layout';
import { getPalette } from '../src/palettes';
import { measureText } from '../src/utils/text-measure';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function labelHits(
  file: string,
  kind: 'state' | 'flowchart'
): Promise<{ labels: number; hits: string[] }> {
  const source = readFileSync(resolve(__dirname, '../stress', file), 'utf8');
  const palette = getPalette('nord').light;
  const parsed =
    kind === 'state'
      ? parseState(source, palette)
      : parseFlowchart(source, palette);
  const layout = layoutGraph(parsed);
  const nodes: Array<Box & { id: string }> = layout.nodes.map((n) => ({
    id: n.id,
    x: n.x - n.width / 2,
    y: n.y - n.height / 2,
    w: n.width,
    h: n.height,
  }));
  const { svg } = await render(source, { theme: 'light', palette: 'nord' });
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const cls = kind === 'state' ? 'st-edge-label-bg' : 'fc-edge-label-bg';
  const rects = [...doc.querySelectorAll(`rect.${cls}`)];
  const hits: string[] = [];
  for (const r of rects) {
    const box: Box = {
      x: Number(r.getAttribute('x')),
      y: Number(r.getAttribute('y')),
      w: Number(r.getAttribute('width')),
      h: Number(r.getAttribute('height')),
    };
    const label = r.nextElementSibling?.textContent ?? '';
    for (const n of nodes)
      if (overlaps(box, n)) hits.push(`${label} × ${n.id}`);
  }
  return { labels: rects.length, hits };
}

describe('edge labels clear every node (#1948)', () => {
  it.each([
    ['state/long-labels--edge-labels.dgmo', 'state'],
    ['flowchart/long-labels--edge-labels.dgmo', 'flowchart'],
  ] as const)('%s', async (file, kind) => {
    const { labels, hits } = await labelHits(file, kind);
    expect(labels).toBeGreaterThan(5);
    expect(hits).toEqual([]);
  });
});

// A two-way labelled pair in a state diagram (#2072): the two curves run
// apart, each label sits beside its own curve and clear of every state, the
// title fits the canvas, and the canvas ends at the drawing.
describe('a two-way labelled state pair (#2072)', () => {
  const source = (dir: 'lr' | 'tb'): string => `state Circuit Breaker
direction-${dir}

[*] -> Closed
Closed -failures exceed threshold-> Open
Open -cool-down elapsed-> HalfOpen
HalfOpen -probe succeeds-> Closed
HalfOpen -probe fails-> Open
`;

  type P = { x: number; y: number };
  const segDist = (p: P, a: P, b: P): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
      : 0;
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  // Least distance from any vertex of one polyline to the other, both ways.
  const routeGap = (r: readonly P[], s: readonly P[]): number => {
    let best = Infinity;
    for (const [u, v] of [
      [r, s],
      [s, r],
    ] as const)
      for (const p of u)
        for (let i = 1; i < v.length; i++)
          best = Math.min(best, segDist(p, v[i - 1]!, v[i]!));
    return best;
  };
  const toPolyline = (d: string): P[] => {
    const n = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
    const out: P[] = [];
    for (let i = 0; i + 1 < n.length; i += 2)
      out.push({ x: n[i]!, y: n[i + 1]! });
    return out;
  };

  it.each(['lr', 'tb'] as const)('direction-%s', async (dir) => {
    const { svg } = await render(source(dir), {
      theme: 'light',
      palette: 'nord',
    });
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    const [, , vw, vh] = root.getAttribute('viewBox')!.split(' ').map(Number);

    // Everything below is in the plot group's coordinates.
    const nodes: Array<Box & { id: string }> = [];
    for (const g of doc.querySelectorAll('g.st-node')) {
      const m = /translate\(([-\d.e]+), ([-\d.e]+)\)/.exec(
        g.getAttribute('transform') ?? ''
      )!;
      const r = g.querySelector('rect');
      if (!r) continue;
      nodes.push({
        id: g.getAttribute('data-node-id')!,
        x: Number(m[1]) + Number(r.getAttribute('x')),
        y: Number(m[2]) + Number(r.getAttribute('y')),
        w: Number(r.getAttribute('width')),
        h: Number(r.getAttribute('height')),
      });
    }
    expect(nodes.length).toBe(3);

    const edges = [...doc.querySelectorAll('g.st-edge-group')].map((g) => {
      const r = g.querySelector('rect.st-edge-label-bg');
      return {
        from: g.getAttribute('data-source')!,
        to: g.getAttribute('data-target')!,
        route: toPolyline(g.querySelector('path')!.getAttribute('d')!),
        label: r
          ? {
              text: g.querySelector('text')!.textContent!,
              x: Number(r.getAttribute('x')),
              y: Number(r.getAttribute('y')),
              w: Number(r.getAttribute('width')),
              h: Number(r.getAttribute('height')),
            }
          : null,
      };
    });

    // Every label clears every state.
    const hits: string[] = [];
    for (const e of edges)
      if (e.label)
        for (const n of nodes)
          if (overlaps(e.label, n)) hits.push(`${e.label.text} × ${n.id}`);
    expect(hits).toEqual([]);

    // The pair runs on two distinct curves, and each label is nearer its own.
    const fwd = edges.find(
      (e) => e.from === 'state:open' && e.to === 'state:halfopen'
    )!;
    const back = edges.find(
      (e) => e.from === 'state:halfopen' && e.to === 'state:open'
    )!;
    expect(routeGap(fwd.route, back.route)).toBeGreaterThanOrEqual(20);
    for (const [own, other] of [
      [fwd, back],
      [back, fwd],
    ] as const) {
      const c = {
        x: own.label!.x + own.label!.w / 2,
        y: own.label!.y + own.label!.h / 2,
      };
      expect(routeGap([c], own.route)).toBeLessThan(routeGap([c], other.route));
    }

    // The plot sits inside the canvas with no dead band right or below: the
    // margin there is the left/top padding, not 40 px more.
    const plot = /translate\(([-\d.e]+), ([-\d.e]+)\) scale\(([\d.e]+)\)/.exec(
      root.querySelector('g[transform*="scale"]')!.getAttribute('transform')!
    )!;
    const [ox, oy, sc] = [Number(plot[1]), Number(plot[2]), Number(plot[3])];
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    }
    for (const e of edges) {
      for (const p of e.route) {
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      if (e.label) {
        maxX = Math.max(maxX, e.label.x + e.label.w);
        maxY = Math.max(maxY, e.label.y + e.label.h);
      }
    }
    expect(vh! - (oy + maxY * sc)).toBeLessThanOrEqual(24);
    if (dir === 'lr') expect(vw! - (ox + maxX * sc)).toBeLessThanOrEqual(24);

    // The whole title is on the canvas.
    const title = root.querySelector('text.chart-title')!;
    const tx = Number(title.getAttribute('x'));
    const tw = measureText('Circuit Breaker', 20, { bold: true });
    expect(tx).toBeGreaterThanOrEqual(0);
    expect(tx + tw).toBeLessThanOrEqual(vw!);
  });

  it('a title wider than the drawing widens the canvas', async () => {
    const t = 'A Much Longer Title For A Tiny Two State Machine Here';
    const { svg } = await render(`state ${t}\n\nA -go-> B\n`, {
      theme: 'light',
      palette: 'nord',
    });
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const vw = Number(
      doc.documentElement.getAttribute('viewBox')!.split(' ')[2]
    );
    const title = doc.querySelector('text.chart-title')!;
    const tx = Number(title.getAttribute('x'));
    expect(title.getAttribute('text-anchor')).toBe('start');
    expect(tx + measureText(t, 20, { bold: true })).toBeLessThanOrEqual(vw);
  });
});
