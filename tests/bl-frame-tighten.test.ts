// A group frame is sized by its contents (#2062, rubric rule 6).
import { describe, it, expect } from 'vitest';
import { tightenGroupFrames } from '../src/boxes-and-lines/layout-search';
import type { BLGroup } from '../src/boxes-and-lines/types';

const grp = (label: string, children: string[], parentGroup?: string) =>
  ({
    label,
    children,
    parentGroup,
    lineNumber: 0,
    metadata: {},
  }) as unknown as BLGroup;
const frame = (
  label: string,
  x: number,
  y: number,
  width: number,
  height: number
) => ({
  label,
  lineNumber: 0,
  x,
  y,
  width,
  height,
  collapsed: false,
  childCount: 1,
});

describe('tightenGroupFrames', () => {
  it('shrinks a frame dagre stretched to a wide sibling', () => {
    const nodes = [{ label: 'A', x: 300, y: 100, width: 100, height: 60 }];
    const groups = [frame('G', 420, 100, 430, 130)];
    tightenGroupFrames(nodes, groups, [grp('G', ['A'])]);
    expect(groups[0]).toMatchObject({ x: 300, width: 160, height: 130 });
  });

  it('leaves a naturally padded frame exactly as it was', () => {
    const nodes = [{ label: 'A', x: 300, y: 100, width: 100, height: 60 }];
    const groups = [frame('G', 301, 100, 162, 132)];
    tightenGroupFrames(nodes, groups, [grp('G', ['A'])]);
    expect(groups[0]).toMatchObject({
      x: 301,
      y: 100,
      width: 162,
      height: 132,
    });
  });

  it('keeps room for a long title', () => {
    const nodes = [{ label: 'A', x: 300, y: 100, width: 60, height: 60 }];
    const label = 'A rather long group title here';
    const groups = [frame(label, 420, 100, 600, 130)];
    tightenGroupFrames(nodes, groups, [grp(label, ['A'])]);
    expect(groups[0]!.width).toBeGreaterThan(200);
    expect(groups[0]!.width).toBeLessThan(600);
  });

  it('fits a parent to its already-tightened child', () => {
    const nodes = [{ label: 'A', x: 300, y: 200, width: 100, height: 60 }];
    const groups = [
      frame('Outer', 420, 200, 560, 260),
      frame('Inner', 420, 200, 500, 130),
    ];
    tightenGroupFrames(nodes, groups, [
      grp('Outer', []),
      grp('Inner', ['A'], 'Outer'),
    ]);
    expect(groups[1]).toMatchObject({ x: 300, width: 160 });
    expect(groups[0]).toMatchObject({ x: 300, width: 220 });
  });
});
