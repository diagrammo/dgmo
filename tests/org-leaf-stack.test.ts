import { describe, it, expect } from 'vitest';
import { parseOrg } from '../src/org/parser';
import { layoutOrg } from '../src/org/layout';

// #1841: a wide org chart stacks each person's all-leaf reports in a column
// under them instead of spreading every leaf across one rank.

/** CEO → v VPs → m managers each → i engineers each. */
function orgSource(v: number, m: number, i: number, header = ''): string {
  const lines = ['org Probe', header, '', 'Chief Executive', '  role: CEO'];
  for (let a = 1; a <= v; a++) {
    lines.push(`  VP ${a}`, '    role: Vice President');
    for (let b = 1; b <= m; b++) {
      lines.push(`    Manager ${a}.${b}`, '      role: Engineering Manager');
      for (let c = 1; c <= i; c++) {
        lines.push(
          `      Engineer ${a}.${b}.${c}`,
          '        role: Software Engineer'
        );
      }
    }
  }
  return lines.join('\n');
}

const byLabel = (layout: ReturnType<typeof layoutOrg>, label: string) =>
  layout.nodes.find((n) => n.label === label)!;

describe('org leaf stacking (#1841)', () => {
  it('renders the 45-person chart under 3:1', () => {
    const layout = layoutOrg(parseOrg(orgSource(4, 2, 4)));
    expect(layout.nodes).toHaveLength(45);
    expect(layout.width / layout.height).toBeLessThan(3);
  });

  it("stacks a manager's engineers in one column below the manager", () => {
    const layout = layoutOrg(parseOrg(orgSource(4, 2, 4)));
    const manager = byLabel(layout, 'Manager 1.1');
    const engineers = [1, 2, 3, 4].map((c) =>
      byLabel(layout, `Engineer 1.1.${c}`)
    );
    for (const e of engineers) {
      expect(e.x).toBe(engineers[0]!.x);
      expect(e.y).toBeGreaterThan(manager.y + manager.height);
    }
    for (let k = 1; k < engineers.length; k++) {
      expect(engineers[k]!.y).toBeGreaterThanOrEqual(
        engineers[k - 1]!.y + engineers[k - 1]!.height
      );
    }
  });

  it('joins the column with a trunk line and a tick into each card', () => {
    const layout = layoutOrg(parseOrg(orgSource(4, 2, 4)));
    const manager = byLabel(layout, 'Manager 1.1');
    const trunk = layout.edges.find(
      (e) =>
        e.sourceId === manager.id &&
        e.targetId === manager.id &&
        e.points.length === 4
    )!;
    expect(trunk).toBeDefined();
    // Leaves the manager's bottom centre, then runs down the trunk lane.
    expect(trunk.points[0]!.x).toBeCloseTo(manager.x, 5);
    expect(trunk.points[0]!.y).toBeCloseTo(manager.y + manager.height, 5);
    const trunkX = trunk.points[3]!.x;
    expect(trunk.points[2]!.x).toBe(trunkX);
    for (let c = 1; c <= 4; c++) {
      const e = byLabel(layout, `Engineer 1.1.${c}`);
      const tick = layout.edges.find(
        (edge) => edge.sourceId === manager.id && edge.targetId === e.id
      )!;
      expect(tick.points).toHaveLength(2);
      const [from, to] = tick.points as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      expect(from.x).toBe(trunkX);
      expect(from.y).toBe(to.y);
      // Ends on the card's left edge (x is the card's centre), mid-height.
      expect(to.x).toBeCloseTo(e.x - e.width / 2, 5);
      expect(to.y).toBeCloseTo(e.y + e.height / 2, 5);
      expect(to.y).toBeLessThanOrEqual(trunk.points[3]!.y);
    }
  });

  it('keeps a chart within 2:1 as a spread row', () => {
    // Two reports fit under the target aspect, so nothing stacks.
    const layout = layoutOrg(parseOrg('org\nAlice\n  Bob\n  Carol'));
    const bob = byLabel(layout, 'Bob');
    const carol = byLabel(layout, 'Carol');
    expect(layout.width / layout.height).toBeLessThanOrEqual(2);
    expect(bob.y).toBe(carol.y);
    expect(bob.x).not.toBe(carol.x);
  });

  it('runs the stack as a row under direction-lr', () => {
    const layout = layoutOrg(parseOrg(orgSource(4, 2, 4, 'direction-lr')));
    const manager = byLabel(layout, 'Manager 1.1');
    const engineers = [1, 2, 3, 4].map((c) =>
      byLabel(layout, `Engineer 1.1.${c}`)
    );
    for (const e of engineers) {
      expect(e.y).toBe(engineers[0]!.y);
      expect(e.x - e.width / 2).toBeGreaterThan(manager.x + manager.width / 2);
    }
    // Spread, the leaves would make the chart 32 cards tall.
    expect(layout.height / layout.width).toBeLessThan(2);
  });

  it('leaves a team container stack as it was', () => {
    const layout = layoutOrg(
      parseOrg('org\nAlice\n  [Platform]\n    Bob\n    Carol\n    Dave')
    );
    const xs = ['Bob', 'Carol', 'Dave'].map((l) => byLabel(layout, l).x);
    expect(new Set(xs).size).toBe(1);
    // Container members carry no tick edges.
    const ids = ['Bob', 'Carol', 'Dave'].map((l) => byLabel(layout, l).id);
    expect(layout.edges.some((e) => ids.includes(e.targetId))).toBe(false);
  });

  // Slices (a) and (b): compaction above the leaf rank, two-column stacks.

  type Layout = ReturnType<typeof layoutOrg>;
  const overlaps = (layout: Layout): string[] => {
    const bad: string[] = [];
    const ns = layout.nodes;
    for (let i = 0; i < ns.length; i++)
      for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i]!;
        const b = ns[j]!;
        const ox =
          Math.min(a.x + a.width / 2, b.x + b.width / 2) -
          Math.max(a.x - a.width / 2, b.x - b.width / 2);
        const oy =
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (ox > 0.5 && oy > 0.5) bad.push(`${a.label} / ${b.label}`);
      }
    return bad;
  };
  /** Edge segments that run through the inside of a card. */
  const crossings = (layout: Layout): string[] => {
    const bad: string[] = [];
    for (const e of layout.edges) {
      for (let k = 1; k < e.points.length; k++) {
        const p = e.points[k - 1]!;
        const q = e.points[k]!;
        for (const n of layout.nodes) {
          const l = n.x - n.width / 2 + 1;
          const r = n.x + n.width / 2 - 1;
          const t = n.y + 1;
          const b = n.y + n.height - 1;
          const sx0 = Math.min(p.x, q.x);
          const sx1 = Math.max(p.x, q.x);
          const sy0 = Math.min(p.y, q.y);
          const sy1 = Math.max(p.y, q.y);
          if (sx1 > l && sx0 < r && sy1 > t && sy0 < b)
            bad.push(`${e.sourceId}->${e.targetId} through ${n.label}`);
        }
      }
    }
    return bad;
  };

  const shapes: [string, string][] = [
    ['45 people', orgSource(4, 2, 4)],
    ['106 people', orgSource(5, 4, 4)],
    ['131 people', orgSource(5, 5, 4)],
    ['103 people, ten per manager', orgSource(3, 3, 10)],
    ['87 people, twenty per manager', orgSource(2, 2, 20)],
    ['106 people, direction-lr', orgSource(5, 4, 4, 'direction-lr')],
  ];
  for (const [name, src] of shapes) {
    it(`lays out ${name} with no card overlap and no line through a card`, () => {
      const layout = layoutOrg(parseOrg(src));
      expect(overlaps(layout)).toEqual([]);
      expect(crossings(layout)).toEqual([]);
    });
  }

  it('renders the 100-person probe under 3:1', () => {
    const layout = layoutOrg(parseOrg(orgSource(5, 4, 4)));
    expect(layout.nodes).toHaveLength(106);
    const aspect = layout.width / layout.height;
    expect(aspect).toBeLessThan(3);
    expect(aspect).toBeGreaterThanOrEqual(1);
  });

  it("hangs a VP's managers in two columns either side of a trunk", () => {
    const layout = layoutOrg(parseOrg(orgSource(5, 4, 4)));
    const vp = byLabel(layout, 'VP 1');
    const managers = [1, 2, 3, 4].map((b) => byLabel(layout, `Manager 1.${b}`));
    const left = managers.filter((m) => m.x < vp.x);
    const right = managers.filter((m) => m.x > vp.x);
    expect(left).toHaveLength(2);
    expect(right).toHaveLength(2);
    const trunk = layout.edges.find(
      (e) =>
        e.sourceId === vp.id &&
        e.targetId === vp.id &&
        e.points.every((p) => p.x === vp.x)
    );
    expect(trunk).toBeDefined();
    for (const m of managers) {
      const tick = layout.edges.find(
        (e) => e.sourceId === vp.id && e.targetId === m.id
      )!;
      const end = tick.points[tick.points.length - 1]!;
      const side = m.x < vp.x ? m.x + m.width / 2 : m.x - m.width / 2;
      expect(end.x).toBeCloseTo(side, 5);
      expect(end.y).toBeCloseTo(m.y + m.height / 2, 5);
    }
  });

  it('splits a long run of leaf reports into two columns', () => {
    const layout = layoutOrg(parseOrg(orgSource(1, 1, 20)));
    const xs = new Set(
      layout.nodes.filter((n) => n.label.startsWith('Engineer')).map((n) => n.x)
    );
    expect(xs.size).toBe(2);
  });

  it('keeps a short run of leaf reports in one column', () => {
    const layout = layoutOrg(parseOrg(orgSource(4, 2, 4)));
    const xs = new Set(
      [1, 2, 3, 4].map((c) => byLabel(layout, `Engineer 1.1.${c}`).x)
    );
    expect(xs.size).toBe(1);
  });
});
