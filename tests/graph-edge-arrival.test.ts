import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { layoutGraph, type LayoutResult } from '../src/graph/layout';
import { parseState } from '../src/graph/state-parser';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { edgeSplinePath } from '../src/graph/edge-spline';
import { unbundleEdges } from '../src/graph/edge-ports';
import { ARROWHEAD_WIDTH } from '../src/utils/visual-conventions';

type Pt = { x: number; y: number };

const GALLERY = resolve(__dirname, '../gallery/fixtures');
const FIXTURES = [
  'flowchart-basic',
  'flowchart-colors',
  'flowchart-complex',
  'flowchart-decision',
  'flowchart-full',
  'flowchart-groups',
  'flowchart-loop',
  'flowchart-nested',
  'flowchart-shapes',
  'state',
  'state-tags',
];

const layout = (name: string): LayoutResult => {
  const src = readFileSync(resolve(GALLERY, `${name}.dgmo`), 'utf8');
  return layoutGraph(
    name.startsWith('state') ? parseState(src) : parseFlowchart(src)
  );
};

/** The drawn curve of a route, flattened: d3's M/L/C path, sampled. */
function drawn(points: readonly Pt[]): Pt[] {
  const d = edgeSplinePath(points)!;
  const out: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  for (const m of d.matchAll(/([MLC])([^MLC]*)/g)) {
    const v = m[2]!.split(/[ ,]+/).filter(Boolean).map(Number);
    if (m[1] !== 'C') {
      cur = { x: v[0]!, y: v[1]! };
      out.push(cur);
      continue;
    }
    for (let k = 0; k + 5 < v.length; k += 6) {
      const [x1, y1, x2, y2, x3, y3] = v.slice(k, k + 6) as number[];
      const p0 = cur;
      for (let i = 1; i <= 40; i++) {
        const t = i / 40;
        const u = 1 - t;
        out.push({
          x:
            u * u * u * p0.x +
            3 * u * u * t * x1! +
            3 * u * t * t * x2! +
            t * t * t * x3!,
          y:
            u * u * u * p0.y +
            3 * u * u * t * y1! +
            3 * u * t * t * y2! +
            t * t * t * y3!,
        });
      }
      cur = { x: x3!, y: y3! };
    }
  }
  return out;
}

interface Arrival {
  edge: string;
  /** Degrees between the arrowhead's axis and square to the face it meets. */
  angle: number;
  /** Farthest the curve strays from that axis under the arrowhead, px. */
  bend: number;
}

/** Every arrival into a box-shaped node (diamonds are re-projected later). */
function arrivals(lay: LayoutResult): Arrival[] {
  const nodes = new Map(lay.nodes.map((n) => [n.id, n]));
  const out: Arrival[] = [];
  for (const e of lay.edges) {
    const n = nodes.get(e.target)!;
    if (e.source === e.target || n.shape === 'decision') continue;
    if (n.shape === 'pseudostate') continue;
    const pts = drawn(e.points);
    const end = pts.at(-1)!;
    let j = pts.length - 2;
    while (j > 0 && Math.hypot(end.x - pts[j]!.x, end.y - pts[j]!.y) < 1e-6)
      j--;
    // marker orient=auto: the arrowhead lies along the path's end tangent.
    const ax = end.x - pts[j]!.x;
    const ay = end.y - pts[j]!.y;
    const al = Math.hypot(ax, ay);
    const ux = ax / al;
    const uy = ay / al;
    const dx = (end.x - n.x) / (n.width / 2);
    const dy = (end.y - n.y) / (n.height / 2);
    // Inward normal of the face the end sits on.
    const [nx, ny] =
      Math.abs(dx) >= Math.abs(dy) ? [-Math.sign(dx), 0] : [0, -Math.sign(dy)];
    const angle =
      (Math.acos(Math.min(1, Math.max(-1, ux * nx + uy * ny))) * 180) / Math.PI;
    let arc = 0;
    let bend = 0;
    for (let i = pts.length - 1; i > 0 && arc < ARROWHEAD_WIDTH; i--) {
      arc += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
      const p = pts[i - 1]!;
      bend = Math.max(bend, Math.abs((p.x - end.x) * uy - (p.y - end.y) * ux));
    }
    out.push({ edge: `${e.source} -> ${e.target}`, angle, bend });
  }
  return out;
}

describe('graph arrows meet their target square-on (#1839)', () => {
  it.each(FIXTURES)('%s: every arrowhead points square into its box', (f) => {
    // dagre aims the last segment at the target's centre, so an edge from
    // the side met the face up to 72° off square (28 of the gallery's
    // arrivals, before).
    const slanted = arrivals(layout(f)).filter((a) => a.angle > 1);
    expect(slanted.map((a) => `${a.edge} ${a.angle.toFixed(1)}°`)).toEqual([]);
  });

  it.each(FIXTURES)('%s: the curve runs straight under its arrowhead', (f) => {
    const bent = arrivals(layout(f)).filter((a) => a.bend > 1);
    expect(bent.map((a) => `${a.edge} ${a.bend.toFixed(2)} px`)).toEqual([]);
  });

  const BOXES = new Map([
    ['a', { x: 0, y: 0, width: 100, height: 40 }],
    ['b', { x: 300, y: 200, width: 100, height: 40 }],
  ]);
  const EDGES = [{ source: 'a', target: 'b' }];

  it('ends a slanted arrival on a straight run square to the face', () => {
    // Into b's top face from the upper left, aimed at b's centre.
    const route = [
      { x: 0, y: 20 },
      { x: 150, y: 100 },
      { x: 280, y: 180 },
    ];
    const [r] = unbundleEdges(EDGES, [route], BOXES, () => 0);
    expect(r!.at(-1)).toEqual({ x: 280, y: 180 });
    // The last three waypoints stand on the vertical through the end.
    expect(r!.slice(-3).map((p) => p.x)).toEqual([280, 280, 280]);
    expect(r!.at(-2)!.y).toBeLessThan(180);
  });

  it('moves an arrival that runs along its face to the face it comes from', () => {
    // From the left, nearly level with b's top face: no room in front of it.
    const route = [
      { x: 0, y: 20 },
      { x: 150, y: 175 },
      { x: 252, y: 180 },
    ];
    const [r] = unbundleEdges(EDGES, [route], BOXES, () => 0);
    // Now on b's left face (x = 250), arriving level.
    expect(r!.at(-1)!.x).toBe(250);
    expect(new Set(r!.slice(-3).map((p) => p.y)).size).toBe(1);
  });

  it('keeps a slanted arrival when turning it would add a crossing', () => {
    const route = [
      { x: 0, y: 20 },
      { x: 150, y: 100 },
      { x: 280, y: 180 },
    ];
    // A second edge, already square, whose curve the first one's box overlaps:
    // a crossing needs two curves.
    const other = [
      { x: 260, y: 20 },
      { x: 260, y: 100 },
      { x: 260, y: 180 },
    ];
    const edges = [...EDGES, { source: 'c', target: 'b' }];
    const boxes = new Map([
      ...BOXES,
      ['c', { x: 260, y: 0, width: 100, height: 40 }],
    ]);
    const turned = (rs: readonly (readonly Pt[])[]) =>
      rs[0]!.length > 3 ? 1 : 0;
    expect(unbundleEdges(edges, [route, other], boxes, turned)).toEqual([
      route,
      other,
    ]);
  });

  it('keeps a slanted arrival when turning it would pierce a node', () => {
    const route = [
      { x: 0, y: 20 },
      { x: 150, y: 100 },
      { x: 280, y: 180 },
    ];
    const turned = (rs: readonly (readonly Pt[])[]) =>
      rs.some((r) => r.length > 3) ? 1 : 0;
    expect(unbundleEdges(EDGES, [route], BOXES, () => 0, turned)).toEqual([
      route,
    ]);
  });
});
