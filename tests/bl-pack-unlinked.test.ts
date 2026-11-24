// A group's unlinked boxes fill its grid's holes (#2062, rubric rule 4).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packUnlinkedMembers } from '../src/boxes-and-lines/pack-unlinked';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import type { BLLayoutResult } from '../src/boxes-and-lines/layout';
import type { BLGroup } from '../src/boxes-and-lines/types';
import { checkLayout } from './stress/bl-rubric';

const grp = (label: string, children: string[]) =>
  ({ label, children, lineNumber: 0, metadata: {} }) as unknown as BLGroup;
const box = (label: string, x: number, y: number) => ({
  label,
  x,
  y,
  width: 100,
  height: 60,
});
const layoutOf = (
  nodes: ReturnType<typeof box>[],
  edges: {
    source: string;
    target: string;
    points: { x: number; y: number }[];
  }[] = []
) =>
  ({
    nodes,
    edges: edges.map((e) => ({
      ...e,
      bidirectional: false,
      lineNumber: 0,
      yOffset: 0,
      parallelCount: 1,
      metadata: {},
    })),
    groups: [
      {
        label: 'G',
        lineNumber: 0,
        x: 300,
        y: 200,
        width: 600,
        height: 400,
        collapsed: false,
        childCount: nodes.length,
      },
    ],
    width: 800,
    height: 600,
  }) as unknown as BLLayoutResult;

describe('packUnlinkedMembers', () => {
  it('moves an unlinked box that sits after a hole to the start of its row', () => {
    // A·B / ·CD — C sits after a hole.
    const l = layoutOf([
      box('A', 100, 100),
      box('B', 250, 100),
      box('C', 250, 200),
      box('D', 400, 200),
    ]);
    const out = packUnlinkedMembers(
      l,
      [grp('G', ['A', 'B', 'C', 'D'])],
      true,
      new Set()
    );
    const at = new Map(out.nodes.map((n) => [n.label, [n.x, n.y]]));
    expect(at.get('C')).toEqual([100, 200]);
    expect(at.get('D')).toEqual([250, 200]);
  });

  it('returns the same layout when the grid is already packed', () => {
    const l = layoutOf([
      box('A', 100, 100),
      box('B', 250, 100),
      box('C', 100, 200),
    ]);
    expect(
      packUnlinkedMembers(l, [grp('G', ['A', 'B', 'C'])], true, new Set())
    ).toBe(l);
  });

  it('never puts a box on a cell an arrow runs through', () => {
    // L is linked; its arrow leaves down through the empty cell under it.
    const l = layoutOf(
      [
        box('L', 100, 100),
        box('B', 250, 100),
        box('C', 250, 200),
        box('X', 100, 500),
      ],
      [
        {
          source: 'L',
          target: 'X',
          points: [
            { x: 100, y: 130 },
            { x: 100, y: 470 },
          ],
        },
      ]
    );
    const out = packUnlinkedMembers(
      l,
      [grp('G', ['L', 'B', 'C'])],
      true,
      new Set()
    );
    expect(out.nodes.find((n) => n.label === 'C')).toMatchObject({
      x: 250,
      y: 200,
    });
  });

  it('leaves a box named by a layout hint where it is', () => {
    const l = layoutOf([box('A', 100, 100), box('C', 250, 200)]);
    expect(
      packUnlinkedMembers(l, [grp('G', ['A', 'C'])], true, new Set(['C']))
    ).toBe(l);
  });
});

describe('grid holes on the owner-shaped fixture', () => {
  const src = readFileSync(
    join(
      __dirname,
      '..',
      'stress/boxes-and-lines/grouped-flow--storefront-rebuild.dgmo'
    ),
    'utf8'
  );
  // The fresh render with a group folded from the start — the shape of the
  // owner's modernize-mpv, whose identity group carries `collapsed: true`.
  for (const folded of [[], ['Identity']]) {
    it(`no grid holes, ${folded.length ? folded.join('+') + ' folded' : 'expanded'}`, async () => {
      const parsed = parseBoxesAndLines(src);
      const cr = collapseBoxesAndLines(parsed, new Set(folded));
      const l = await layoutBoxesAndLines(cr.parsed, {
        collapsedChildCounts: cr.collapsedChildCounts,
        originalGroups: cr.originalGroups,
      });
      const r4 = checkLayout(l, cr.originalGroups, parsed.direction).get(4)!;
      expect(r4).toEqual([]);
    }, 300_000);
  }
});
