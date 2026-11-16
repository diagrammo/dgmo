// Edge labels in state and flowchart diagrams never sit on a node (#1948).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '../src/render';
import { parseState } from '../src/graph/state-parser';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { layoutGraph } from '../src/graph/layout';
import { getPalette } from '../src/palettes';

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
