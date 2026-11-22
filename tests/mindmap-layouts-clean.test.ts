// The sandbox fixtures behind the layout decision (#2100) must lay out clean
// in both modes: no node on a node, no edge through a node it does not join,
// and no two edges crossing.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMindmap } from '../src/mindmap/parser';
import { layoutMindmap } from '../src/mindmap/layout';
import { getPalette } from '../src/palettes';
import type {
  MindmapLayoutNode,
  MindmapLayoutResult,
} from '../src/mindmap/types';

const DIR = join(__dirname, 'fixtures/mindmap-layouts');
const palette = getPalette('bold').light;

type Pt = [number, number];
type Seg = [Pt, Pt];

/** Flatten an absolute M/L/C path into segments; a curve into 16 chords. */
function segments(path: string): Seg[] {
  const tokens = path.match(/[MLC]|-?[\d.]+(?:e[+-]?\d+)?/g)!;
  const out: Seg[] = [];
  let cur: Pt = [0, 0];
  let i = 0;
  const num = () => parseFloat(tokens[i++]!);
  while (i < tokens.length) {
    const cmd = tokens[i++]!;
    if (cmd === 'M') cur = [num(), num()];
    else if (cmd === 'L') {
      const p: Pt = [num(), num()];
      out.push([cur, p]);
      cur = p;
    } else {
      const c1: Pt = [num(), num()];
      const c2: Pt = [num(), num()];
      const p: Pt = [num(), num()];
      let prev = cur;
      for (let k = 1; k <= 16; k++) {
        const t = k / 16,
          u = 1 - t;
        const q: Pt = [
          u ** 3 * cur[0] +
            3 * u * u * t * c1[0] +
            3 * u * t * t * c2[0] +
            t ** 3 * p[0],
          u ** 3 * cur[1] +
            3 * u * u * t * c1[1] +
            3 * u * t * t * c2[1] +
            t ** 3 * p[1],
        ];
        out.push([prev, q]);
        prev = q;
      }
      cur = p;
    }
  }
  return out;
}

function hitsBox([a, b]: Seg, n: MindmapLayoutNode, inset = 1): boolean {
  const [xmin, xmax, ymin, ymax] = [
    n.x + inset,
    n.x + n.width - inset,
    n.y + inset,
    n.y + n.height - inset,
  ];
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  let t0 = 0,
    t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, a[0] - xmin) &&
    clip(dx, xmax - a[0]) &&
    clip(-dy, a[1] - ymin) &&
    clip(dy, ymax - a[1]) &&
    t0 < t1
  );
}

/** Proper crossing only: touching at an end point does not count. */
function cross([a, b]: Seg, [c, d]: Seg): boolean {
  const o = (p: Pt, q: Pt, r: Pt) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const eps = 1e-6;
  const d1 = o(c, d, a),
    d2 = o(c, d, b),
    d3 = o(a, b, c),
    d4 = o(a, b, d);
  return (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  );
}

function layout(src: string): MindmapLayoutResult {
  return layoutMindmap(parseMindmap(src, palette), palette);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.dgmo'));

describe('mindmap layouts lay out clean (#2100)', () => {
  it('has the ten sandbox fixtures', () => {
    expect(files.length).toBe(10);
  });

  for (const file of files) {
    const src = readFileSync(join(DIR, file), 'utf8');
    const withoutRadial = src.replace(/^radial\s*$/m, '');
    const withRadial = /^radial\s*$/m.test(src)
      ? src
      : src.replace('\n', '\nradial\n');
    for (const [mode, text] of [
      ['two-sided', withoutRadial],
      ['radial', withRadial],
    ] as const) {
      it(`${file} — ${mode}`, () => {
        const r = layout(text);
        const label = new Map(r.nodes.map((n) => [n.id, n.label]));
        for (let i = 0; i < r.nodes.length; i++) {
          for (let j = i + 1; j < r.nodes.length; j++) {
            const a = r.nodes[i]!,
              b = r.nodes[j]!;
            const overlap =
              a.x < b.x + b.width &&
              b.x < a.x + a.width &&
              a.y < b.y + b.height &&
              b.y < a.y + a.height;
            expect(overlap, `${a.label} / ${b.label}`).toBe(false);
          }
        }
        const segs = r.edges.map((e) => segments(e.path));
        r.edges.forEach((e, i) => {
          for (const s of segs[i]!) {
            for (const n of r.nodes) {
              if (n.id === e.sourceId || n.id === e.targetId) continue;
              expect(
                hitsBox(s, n),
                `${label.get(e.sourceId)}→${label.get(e.targetId)} crosses ${n.label}`
              ).toBe(false);
            }
          }
          for (let j = i + 1; j < r.edges.length; j++) {
            const f = r.edges[j]!;
            const shared = [e.sourceId, e.targetId].some(
              (id) => id === f.sourceId || id === f.targetId
            );
            if (shared) continue;
            const hit = segs[i]!.some((s) => segs[j]!.some((t) => cross(s, t)));
            expect(
              hit,
              `${label.get(e.sourceId)}→${label.get(e.targetId)} crosses ${label.get(f.sourceId)}→${label.get(f.targetId)}`
            ).toBe(false);
          }
        });
      });
    }
  }
});
