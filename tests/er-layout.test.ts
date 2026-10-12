import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseERDiagram } from '../src/er/parser';
import { layoutERDiagram, type ERLayoutResult } from '../src/er/layout';
import {
  countSplineCrossings,
  countEdgeOverlaps,
  countEdgeNodePierces,
} from '../src/boxes-and-lines/layout-search';
import type { BLLayoutResult } from '../src/boxes-and-lines/layout';

// The boxes-and-lines scorers, read the way the search reads an ER layout.
function asScored(lay: ERLayoutResult): BLLayoutResult {
  return {
    nodes: lay.nodes.map((n) => ({
      label: n.id,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    })),
    edges: lay.edges,
    groups: [],
    width: lay.width,
    height: lay.height,
  } as unknown as BLLayoutResult;
}

// Eight tables whose plain dagre placement draws 2 crossings and 1 overlap run.
const TANGLED = `er Tangled

t0
  id int pk

t1
  id int pk
  name varchar
  1-* t7
  1-* t0

t2
  id int pk
  name varchar
  ?-1 t6
  ?-1 t5

t3
  id int pk

t4
  id int pk
  name varchar
  1-1 t2
  ?-1 t1

t5
  id int pk
  name varchar
  *-refs-1 t7

t6
  id int pk
  1-has-* t1

t7
  id int pk
  name varchar
  1-1 t0
  *-1 t3
`;

describe('layoutERDiagram crossing search (#1240)', () => {
  it('takes a tangled diagram from 2 crossings and 1 overlap run to none', () => {
    const lay = asScored(layoutERDiagram(parseERDiagram(TANGLED)));
    expect(countSplineCrossings(lay)).toBe(0);
    expect(countEdgeOverlaps(lay)).toBe(0);
    expect(countEdgeNodePierces(lay)).toBe(0);
  });

  it('is deterministic — the same source lays out the same twice', () => {
    const parsed = parseERDiagram(TANGLED);
    expect(layoutERDiagram(parsed)).toEqual(layoutERDiagram(parsed));
  });

  it('leaves the gallery fixture, which has nothing to fix, with no crossing', () => {
    const src = readFileSync(
      resolve(__dirname, '../gallery/fixtures/er.dgmo'),
      'utf8'
    );
    const lay = asScored(layoutERDiagram(parseERDiagram(src)));
    expect(countSplineCrossings(lay)).toBe(0);
    expect(countEdgeOverlaps(lay)).toBe(0);
  });

  it('keeps every edge on the canvas, wherever the search routes it', () => {
    // 40 seeded random ER diagrams. A winning candidate can route an edge
    // outside every table, or the detour can bend one there; the canvas must
    // still hold it.
    let seed = 7;
    const r = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const cards = ['1-*', '1-1', '?-1', '*-1', '1-has-*'];
    const off: string[] = [];
    for (let k = 0; k < 40; k++) {
      const n = 4 + Math.floor(r() * 10);
      const m = Math.floor(n * (0.8 + r() * 1.0));
      const rels = new Map<number, string[]>();
      for (let j = 0; j < m; j++) {
        const a = Math.floor(r() * n);
        const b = Math.floor(r() * n);
        if (a === b) continue;
        const card = cards[Math.floor(r() * cards.length)]!;
        rels.set(a, [...(rels.get(a) ?? []), `  ${card} t${b}`]);
      }
      const lines = ['er R', ''];
      for (let i = 0; i < n; i++)
        lines.push(`t${i}`, '  id int pk', ...(rels.get(i) ?? []), '');
      const lay = layoutERDiagram(parseERDiagram(lines.join('\n')));
      for (const e of lay.edges)
        for (const p of e.points)
          if (p.x < 0 || p.y < 0 || p.x > lay.width || p.y > lay.height)
            off.push(`rand${k} ${e.source}->${e.target} (${p.x}, ${p.y})`);
    }
    expect(off).toEqual([]);
  });
});
