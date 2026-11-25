import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { measureText } from '../src/utils/text-measure';
import { ARROWHEAD_HEIGHT } from '../src/utils/visual-conventions';

// #2299 — an edge into a box under a group title ran straight through the
// title. The check samples the curve the renderer draws (d3 curveBasis: a
// uniform cubic B-spline with both ends tripled) and keeps it, arrowhead
// included, off every expanded group's title text.

const GROUP_LABEL_ZONE = 32; // renderer.ts — title sits in the frame's top zone
const GROUP_TITLE_FONT_SIZE = 14;

type P = { x: number; y: number };

function sampleBasis(pts: readonly P[]): P[] {
  const c = [
    pts[0]!,
    pts[0]!,
    ...pts,
    pts[pts.length - 1]!,
    pts[pts.length - 1]!,
  ];
  const out: P[] = [];
  for (let i = 0; i + 3 < c.length; i++) {
    const [a, b, d, e] = [c[i]!, c[i + 1]!, c[i + 2]!, c[i + 3]!];
    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      const w0 = (1 - t) ** 3 / 6;
      const w1 = (3 * t ** 3 - 6 * t ** 2 + 4) / 6;
      const w2 = (-3 * t ** 3 + 3 * t ** 2 + 3 * t + 1) / 6;
      const w3 = t ** 3 / 6;
      out.push({
        x: w0 * a.x + w1 * b.x + w2 * d.x + w3 * e.x,
        y: w0 * a.y + w1 * b.y + w2 * d.y + w3 * e.y,
      });
    }
  }
  return out;
}

async function titleHits(src: string): Promise<string[]> {
  const parsed = parseBoxesAndLines(src);
  const l = await layoutBoxesAndLines(parsed);
  const half = ARROWHEAD_HEIGHT / 2;
  const hits: string[] = [];
  for (const g of l.groups) {
    if (g.collapsed) continue;
    const tw = measureText(g.label, GROUP_TITLE_FONT_SIZE, { bold: true });
    const x0 = g.x - tw / 2 - half;
    const x1 = g.x + tw / 2 + half;
    const y0 = g.y - g.height / 2;
    const y1 = y0 + GROUP_LABEL_ZONE;
    for (const e of l.edges)
      for (const p of sampleBasis(e.points))
        if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1) {
          hits.push(`${e.source} -> ${e.target} through [${g.label}]`);
          break;
        }
  }
  return hits;
}

describe('boxes-and-lines edges clear group titles (#2299)', () => {
  it('a top-level TB edge into a two-box group', async () => {
    expect(
      await titleHits(`boxes-and-lines
direction-tb

Signal -> Cannons

[Assault]
  Cannons
  Shields
`)
    ).toEqual([]);
  });

  it('a per-group direction-lr group with one centred member', async () => {
    expect(
      await titleHits(`boxes-and-lines
direction-tb

Signal -> Cannons

[Assault]
  direction-lr
  Cannons
`)
    ).toEqual([]);
  });

  it('cross edges between per-group-direction groups', async () => {
    expect(
      await titleHits(`boxes-and-lines Raid Pipeline
direction-tb

[Scout]
  direction-lr
  Spyglass
    -> Lookout
  Lookout
    -> Signal
  Signal

[Assault]
  direction-tb
  Cannons
    -> Grapples
  Grapples
    -> Boarding
  Boarding

[Loot]
  direction-lr
  Sort
    -> Weigh
  Weigh
    -> Divide
  Divide

Signal -> Cannons
Boarding -> Sort
`)
    ).toEqual([]);
  });
});
