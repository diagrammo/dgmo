import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMindmap } from '../src/mindmap/parser';
import { layoutMindmap } from '../src/mindmap/layout';
import { getPalette } from '../src/palettes';
import type {
  MindmapLayoutNode,
  MindmapLayoutResult,
} from '../src/mindmap/types';

const palette = getPalette('bold').light;

const leaves = (n: number, indent: string, prefix = 'Leaf') =>
  Array.from({ length: n }, (_, i) => `${indent}${prefix} ${i + 1}`).join('\n');

// The tree the balance slice measured (#1843): one trunk holds every leaf.
const TRUNK = `mindmap Root\n  Trunk\n${leaves(12, '    ')}`;
const TRUNK_PLUS = `${TRUNK}\n  Small A\n    A1\n  Small B\n    B1`;
const DEEP = `mindmap Plan
  Research
    Users
      Interviews
      Survey
    Market
  Build
    Frontend
      Editor
      Preview
      Export
    Backend
      Sync
  Launch
    Docs`;

function layout(src: string): MindmapLayoutResult {
  return layoutMindmap(parseMindmap(src), palette);
}

function centre(n: MindmapLayoutNode): [number, number] {
  return [n.x + n.width / 2, n.y + n.height / 2];
}

function boxesOverlap(a: MindmapLayoutNode, b: MindmapLayoutNode): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Segments of an M/L path. */
function segments(path: string): [number, number, number, number][] {
  const pts = [...path.matchAll(/[ML]\s*([\d.e+-]+)\s+([\d.e+-]+)/g)].map(
    (m) => [parseFloat(m[1]!), parseFloat(m[2]!)] as const
  );
  const out: [number, number, number, number][] = [];
  for (let i = 1; i < pts.length; i++) {
    out.push([pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]]);
  }
  return out;
}

/** Liang–Barsky: does the segment enter the box shrunk by `inset`? */
function segmentHitsBox(
  [x1, y1, x2, y2]: [number, number, number, number],
  n: MindmapLayoutNode,
  inset = 1
): boolean {
  const xmin = n.x + inset,
    xmax = n.x + n.width - inset,
    ymin = n.y + inset,
    ymax = n.y + n.height - inset;
  const dx = x2 - x1,
    dy = y2 - y1;
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
    clip(-dx, x1 - xmin) &&
    clip(dx, xmax - x1) &&
    clip(-dy, y1 - ymin) &&
    clip(dy, ymax - y1) &&
    t0 < t1
  );
}

describe('mindmap radial layout (#1843)', () => {
  it('`radial` is a bare flag, off by default', () => {
    expect(parseMindmap(`mindmap Root\nradial\n  A`).options['radial']).toBe(
      'on'
    );
    const plain = parseMindmap('mindmap Root\n  A');
    expect(plain.options['radial']).toBeUndefined();
    // The flag is an option, never a node.
    const flagged = parseMindmap(`mindmap Root\nradial\n  A`);
    expect(flagged.roots[0]!.children.map((c) => c.label)).toEqual(['A']);
  });

  it('a dominant trunk spreads its leaves around the root, not down one column', () => {
    const two = layout(TRUNK);
    const radial = layout(TRUNK.replace('\n', '\nradial\n'));
    // Two-sided: every leaf is one column to the right of the root.
    expect(two.height / two.width).toBeGreaterThan(1);
    const root = radial.nodes[0]!;
    const [rx, ry] = centre(root);
    const leafNodes = radial.nodes.filter((n) => n.depth === 2);
    expect(leafNodes).toHaveLength(12);
    const left = leafNodes.filter((n) => centre(n)[0] < rx).length;
    const right = leafNodes.filter((n) => centre(n)[0] > rx).length;
    const above = leafNodes.filter((n) => centre(n)[1] < ry).length;
    const below = leafNodes.filter((n) => centre(n)[1] > ry).length;
    for (const side of [left, right, above, below]) {
      expect(side).toBeGreaterThanOrEqual(3);
    }
    // Nearly square, and shorter than the one-column picture.
    expect(radial.height / radial.width).toBeLessThan(1.25);
    expect(radial.width / radial.height).toBeLessThan(1.25);
    expect(radial.height).toBeLessThan(two.height);
  });

  it('each branch gets an angle in proportion to its leaf count', () => {
    const r = layout(TRUNK_PLUS.replace('\n', '\nradial\n'));
    const trunk = r.nodes.find((n) => n.label === 'Trunk')!;
    const a = r.nodes.find((n) => n.label === 'Small A')!;
    const b = r.nodes.find((n) => n.label === 'Small B')!;
    // Leaf shares 12 : 1 : 1 of the full turn.
    const leafAngles = r.nodes
      .filter((n) => n.label.startsWith('Leaf'))
      .map((n) => n.angle);
    const trunkArc = Math.max(...leafAngles) - Math.min(...leafAngles);
    expect(trunkArc).toBeCloseTo((2 * Math.PI * 11) / 14, 6);
    // Small A and Small B sit side by side, one leaf share apart.
    expect(b.angle - a.angle).toBeCloseTo((2 * Math.PI) / 14, 6);
    // The trunk is centred in its own twelve-leaf span.
    const mid = (Math.max(...leafAngles) + Math.min(...leafAngles)) / 2;
    expect(trunk.angle).toBeCloseTo(mid, 6);
  });

  it('branches follow source order clockwise, within one turn', () => {
    const r = layout(DEEP.replace('\n', '\nradial\n'));
    const angles = ['Research', 'Build', 'Launch'].map(
      (l) => r.nodes.find((n) => n.label === l)!.angle
    );
    expect(angles[0]!).toBeLessThan(angles[1]!);
    expect(angles[1]!).toBeLessThan(angles[2]!);
    expect(angles[2]! - angles[0]!).toBeLessThan(2 * Math.PI);
    // Each node's angle is where it is drawn: clockwise from +x, y down.
    const [rx, ry] = centre(r.nodes[0]!);
    for (const n of r.nodes.slice(1)) {
      const [x, y] = centre(n);
      expect(Math.cos(n.angle) * n.radius).toBeCloseTo(x - rx, 6);
      expect(Math.sin(n.angle) * n.radius).toBeCloseTo(y - ry, 6);
    }
  });

  it('the picture takes its most compact turn', () => {
    // Small A and Small B sit side by side; at the top or bottom their wide
    // boxes would push ring 1 out to clear each other (1198 × 1090 measured
    // with no turn), at the sides they stack.
    const r = layout(TRUNK_PLUS.replace('\n', '\nradial\n'));
    expect(r.width * r.height).toBeLessThan(1198 * 1090 * 0.75);
  });

  for (const [name, src] of [
    ['trunk', TRUNK],
    ['trunk plus two branches', TRUNK_PLUS],
    ['three levels', DEEP],
    [
      'the gallery fixture',
      readFileSync(
        join(__dirname, '../gallery/fixtures/mindmap-radial.dgmo'),
        'utf8'
      ),
    ],
    [
      'long labels',
      `mindmap Root\n${leaves(9, '  ', 'Quarterly planning review with every regional lead and the finance partners')}`,
    ],
  ] as const) {
    describe(`${name}`, () => {
      const r = layout(
        /^radial$/m.test(src) ? src : src.replace('\n', '\nradial\n')
      );

      it('no two nodes overlap', () => {
        for (let i = 0; i < r.nodes.length; i++) {
          for (let j = i + 1; j < r.nodes.length; j++) {
            expect(
              boxesOverlap(r.nodes[i]!, r.nodes[j]!),
              `${r.nodes[i]!.label} / ${r.nodes[j]!.label}`
            ).toBe(false);
          }
        }
      });

      it('every node and edge lies inside the canvas', () => {
        for (const n of r.nodes) {
          expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
          expect(n.x).toBeGreaterThanOrEqual(0);
          expect(n.y).toBeGreaterThanOrEqual(0);
          expect(n.x + n.width).toBeLessThanOrEqual(r.width);
          expect(n.y + n.height).toBeLessThanOrEqual(r.height);
        }
        for (const e of r.edges) {
          for (const [x1, y1, x2, y2] of segments(e.path)) {
            for (const v of [x1, x2]) expect(v >= 0 && v <= r.width).toBe(true);
            for (const v of [y1, y2])
              expect(v >= 0 && v <= r.height).toBe(true);
          }
        }
      });

      it('every non-root node has an edge, and no edge crosses a node it does not join', () => {
        const byId = new Map(r.nodes.map((n) => [n.id, n]));
        const targets = new Set(
          r.edges
            .filter((e) => e.sourceId !== e.targetId)
            .map((e) => e.targetId)
        );
        for (const n of r.nodes.slice(1)) expect(targets.has(n.id)).toBe(true);
        for (const e of r.edges) {
          expect(e.path).toMatch(
            /^M [\d.e+-]+ [\d.e+-]+( L [\d.e+-]+ [\d.e+-]+)+$/
          );
          for (const seg of segments(e.path)) {
            for (const n of r.nodes) {
              if (n.id === e.sourceId || n.id === e.targetId) continue;
              expect(
                segmentHitsBox(seg, n),
                `edge ${byId.get(e.sourceId)!.label}→${byId.get(e.targetId)!.label} crosses ${n.label}`
              ).toBe(false);
            }
          }
        }
      });
    });
  }

  it('multi-root: each root gets its own radial tree, side by side', () => {
    const r = layout(`mindmap\nradial\nOne\n  A\n  B\n  C\nTwo\n  D\n  E`);
    const one = r.nodes.filter((n) => ['One', 'A', 'B', 'C'].includes(n.label));
    const two = r.nodes.filter((n) => ['Two', 'D', 'E'].includes(n.label));
    const oneRight = Math.max(...one.map((n) => n.x + n.width));
    const twoLeft = Math.min(...two.map((n) => n.x));
    expect(twoLeft).toBeGreaterThan(oneRight);
  });

  it('without the flag the two-sided layout is unchanged', () => {
    const plain = layout(DEEP);
    for (const n of plain.nodes) {
      expect(n.angle).toBe(0);
      expect(n.radius).toBe(0);
    }
  });
});
