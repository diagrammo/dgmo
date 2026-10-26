// An edge label wider than the rank gap widens the gap (#1535): the label sits
// between the two tables with room for the crow's-foot markers at each end.
import { describe, it, expect } from 'vitest';
import { parseERDiagram } from '../../src/er/parser';
import { layoutERDiagram } from '../../src/er/layout';
import { measureText } from '../../src/utils/text-measure';

const MARKER_ROOM = 24; // layout.ts EDGE_LABEL_MARKER_ROOM

function twoTables(label: string) {
  const src = `er T

a
  id int pk
  1-${label}-* b

b
  id int pk
  a_id int fk
`;
  const lay = layoutERDiagram(parseERDiagram(src));
  const [left, right] = [...lay.nodes].sort((p, q) => p.x - q.x);
  const gap = right!.x - right!.width / 2 - (left!.x + left!.width / 2);
  const edge = lay.edges[0]!;
  const mid = edge.points[Math.floor(edge.points.length / 2)]!;
  const half = (measureText(label, 11) + 8) / 2;
  return {
    gap,
    leftRoom: mid.x - half - (left!.x + left!.width / 2),
    rightRoom: right!.x - right!.width / 2 - (mid.x + half),
    width: lay.width,
  };
}

describe('ER edge label wider than the rank gap (#1535)', () => {
  it('widens the gap so the label clears both tables by the marker room', () => {
    const r = twoTables('raised_by_the_customer_through_the_portal');
    expect(r.leftRoom).toBeGreaterThanOrEqual(MARKER_ROOM - 0.5);
    expect(r.rightRoom).toBeGreaterThanOrEqual(MARKER_ROOM - 0.5);
  });

  it('leaves a label that already fits at the plain 80px gap', () => {
    // 'frequents' is the gallery's widest label (58px box); its layout and
    // gallery/snapshots/er.svg must not move.
    for (const label of ['has', 'frequents'])
      expect(twoTables(label).gap).toBeCloseTo(80, 0);
  });
});
