import { describe, it, expect } from 'vitest';
import { parseFamily } from '../src/family/parser';
import { layoutFamily } from '../src/family/layout';

// #1841 slice (d): a wide family tree stacks each run of childless,
// unmarried siblings in a column under their parents.

/** Two founders → k children, each married with g children of their own. */
function familySource(k: number, g: number, extra = ''): string {
  const lines = [
    'family Probe',
    extra,
    '',
    'Adam Elder b: 1900, sex: m',
    'Eve Elder b: 1902, sex: f',
    '',
    'Adam Elder + Eve Elder m: 1925',
  ];
  for (let i = 1; i <= k; i++) lines.push(`  Child ${i} b: ${1926 + i}`);
  for (let i = 1; i <= k; i++) {
    lines.push('', `Child ${i} + Spouse ${i} m: 1950`);
    for (let j = 1; j <= g; j++)
      lines.push(
        `  Grandchild ${i}.${j} b: ${1951 + j}${j === 2 ? ', adopted' : ''}`
      );
  }
  return lines.join('\n');
}

type Layout = ReturnType<typeof layoutFamily>;
const byLabel = (l: Layout, label: string) =>
  l.nodes.find((n) => n.label === label)!;

const overlaps = (l: Layout): string[] => {
  const bad: string[] = [];
  for (let i = 0; i < l.nodes.length; i++)
    for (let j = i + 1; j < l.nodes.length; j++) {
      const a = l.nodes[i]!;
      const b = l.nodes[j]!;
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox > 0.5 && oy > 0.5) bad.push(`${a.label} / ${b.label}`);
    }
  return bad;
};

describe('family sibling stacking (#1841)', () => {
  it('cuts a six-couple, three-generation tree from 11.7:1 to under 4:1', () => {
    const l = layoutFamily(parseFamily(familySource(6, 4)));
    expect(l.width / l.height).toBeLessThan(4);
    expect(overlaps(l)).toEqual([]);
  });

  it("stacks a couple's childless children in one column, eldest on top", () => {
    const l = layoutFamily(parseFamily(familySource(6, 4)));
    const kids = [1, 2, 3, 4].map((j) => byLabel(l, `Grandchild 1.${j}`));
    for (const k of kids) expect(k.x).toBe(kids[0]!.x);
    for (let j = 1; j < kids.length; j++)
      expect(kids[j]!.y).toBeGreaterThan(kids[j - 1]!.y + kids[j - 1]!.height);
    // Still the same generation.
    expect(new Set(kids.map((k) => k.row)).size).toBe(1);
  });

  it('runs a trunk down the lane and ends each edge on the card side', () => {
    const l = layoutFamily(parseFamily(familySource(6, 4)));
    for (const j of [1, 2, 3, 4]) {
      const k = byLabel(l, `Grandchild 1.${j}`);
      const e = l.edges.find((x) => x.childId === k.id)!;
      expect(e.points).toHaveLength(5);
      const end = e.points[4]!;
      expect(end.x).toBeCloseTo(k.x, 5);
      expect(end.y).toBeGreaterThan(k.y);
      expect(end.y).toBeLessThan(k.y + k.height);
      expect(e.points[3]!.x).toBe(e.points[2]!.x);
      expect(e.points[3]!.x).toBeLessThan(k.x);
    }
  });

  it('keeps a small family as a spread row', () => {
    const l = layoutFamily(
      parseFamily('family\n\nAnn + Bo m: 1950\n  Cy b: 1951\n  Di b: 1953')
    );
    const cy = byLabel(l, 'Cy');
    const di = byLabel(l, 'Di');
    expect(cy.y).toBe(di.y);
    expect(cy.x).not.toBe(di.x);
  });

  it('never stacks the focused person', () => {
    const parsed = parseFamily(familySource(6, 4));
    const focus = parsed.persons.get(
      [...parsed.persons.values()].find((p) => p.label === 'Grandchild 1.1')!.id
    )!;
    const l = layoutFamily(parsed, focus.id);
    expect(overlaps(l)).toEqual([]);
  });
});
