import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import {
  layoutBoxesAndLines,
  computeNodeSize,
  type BLLayoutResult,
} from '../src/boxes-and-lines/layout';
import { groupedTierCandidates } from '../src/boxes-and-lines/layout-grouped';
import { countOrderInversions } from '../src/boxes-and-lines/layout-search';

// Source order wins every crossing tie (#1887). A tie is never broken by
// trading a crossing; these cases have nothing to trade, so the written order
// is the only thing left to decide them.

const PANELS = readFileSync(
  `${__dirname}/fixtures/boxes-and-lines/source-order-panels.dgmo`,
  'utf8'
);

type Dir = 'LR' | 'TB';
const cross = (dir: Dir, p: { x: number; y: number }) =>
  dir === 'TB' ? p.x : p.y;

function groupOrder(layout: BLLayoutResult, dir: Dir): string[] {
  return [...layout.groups]
    .sort((a, b) => cross(dir, a) - cross(dir, b))
    .map((g) => g.label);
}

function nodeOrder(
  layout: BLLayoutResult,
  dir: Dir,
  labels: string[]
): string[] {
  return layout.nodes
    .filter((n) => labels.includes(n.label))
    .sort((a, b) => cross(dir, a) - cross(dir, b))
    .map((n) => n.label);
}

describe('boxes-and-lines keeps source order on a tie (#1887)', () => {
  for (const [dir, directive] of [
    ['LR', 'direction-lr'],
    ['TB', 'direction-tb'],
  ] as const) {
    it(`stacks four unconnected panels in written order (${dir})`, async () => {
      const parsed = parseBoxesAndLines(
        PANELS.replace('direction-lr', directive)
      );
      expect(parsed.direction).toBe(dir);
      const layout = await layoutBoxesAndLines(parsed);
      expect(groupOrder(layout, dir)).toEqual([
        '1. First panel',
        '2. Second panel',
        '3. Third panel',
        '4. Fourth panel',
      ]);
    });
  }

  it('the tier ordering pass seeds units and tied rank-mates from declaration order', () => {
    const src = [
      'boxes-and-lines',
      '[Zulu]',
      '  Hub',
      '  Yankee',
      '  Xray',
      '  Whiskey',
      '[Alpha]',
      '  Start',
      '  Finish',
      '[Mike]',
      '  Left',
      '  Right',
      'Hub -> Yankee',
      'Hub -> Xray',
      'Hub -> Whiskey',
      'Start -> Finish',
      'Left -> Right',
    ].join('\n');
    const parsed = parseBoxesAndLines(src);
    const sizes = new Map(
      parsed.nodes.map((n) => [n.label, computeNodeSize(n, true)])
    );
    const cands = groupedTierCandidates(parsed, sizes);
    expect(cands.length).toBeGreaterThan(0);
    // Some kept candidate is fully in source order, and the search can take it.
    const inOrder = cands.filter((c) => countOrderInversions(c, parsed) === 0);
    expect(inOrder.length).toBeGreaterThan(0);
    const c = inOrder[0]!;
    expect(groupOrder(c, 'LR')).toEqual(['Zulu', 'Alpha', 'Mike']);
    expect(nodeOrder(c, 'LR', ['Yankee', 'Xray', 'Whiskey'])).toEqual([
      'Yankee',
      'Xray',
      'Whiskey',
    ]);
  });

  it('lays out disconnected groups and tied rank-mates in declaration order', async () => {
    const src = [
      'boxes-and-lines',
      '[Zulu]',
      '  Hub',
      '  Yankee',
      '  Xray',
      '  Whiskey',
      '[Alpha]',
      '  Start',
      '  Finish',
      '[Mike]',
      '  Left',
      '  Right',
      'Hub -> Yankee',
      'Hub -> Xray',
      'Hub -> Whiskey',
      'Start -> Finish',
      'Left -> Right',
    ].join('\n');
    const parsed = parseBoxesAndLines(src);
    const layout = await layoutBoxesAndLines(parsed);
    expect(groupOrder(layout, 'LR')).toEqual(['Zulu', 'Alpha', 'Mike']);
    expect(nodeOrder(layout, 'LR', ['Yankee', 'Xray', 'Whiskey'])).toEqual([
      'Yankee',
      'Xray',
      'Whiskey',
    ]);
    expect(countOrderInversions(layout, parsed)).toBe(0);
  });

  it('countOrderInversions counts side-by-side groups and rank-mates drawn out of order', () => {
    const parsed = parseBoxesAndLines(
      ['boxes-and-lines', '[G1]', '  A', '  B', '[G2]', '  C', 'A -> C'].join(
        '\n'
      )
    );
    const box = (label: string, x: number, y: number) => ({
      label,
      x,
      y,
      width: 10,
      height: 10,
    });
    const grp = (label: string, x: number, y: number) => ({
      label,
      lineNumber: 0,
      x,
      y,
      width: 40,
      height: 40,
      collapsed: false,
      childCount: 1,
    });
    const make = (bY: number, g2Y: number) =>
      ({
        nodes: [box('A', 0, 0), box('B', 0, bY), box('C', 0, g2Y)],
        edges: [],
        groups: [grp('G1', 0, 0), grp('G2', 0, g2Y)],
        width: 100,
        height: 100,
      }) as unknown as BLLayoutResult;
    expect(countOrderInversions(make(50, 200), parsed)).toBe(0);
    // B above A in the same rank and group: one inversion.
    expect(countOrderInversions(make(-50, 200), parsed)).toBe(1);
    // G2 above G1, overlapping on the rank axis: one more.
    expect(countOrderInversions(make(-50, -200), parsed)).toBe(2);
  });
});
