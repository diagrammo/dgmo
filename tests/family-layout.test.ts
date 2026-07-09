import { describe, it, expect } from 'vitest';
import { parseFamily } from '../src/family/parser';
import { layoutFamily } from '../src/family/layout';
import { measureText } from '../src/utils/text-measure';
import { familyCardRows } from '../src/family/card-model';

/** True if a horizontal or vertical edge segment passes through any card box. */
function anyLineThroughCard(src: string): boolean {
  const layout = layoutFamily(parseFamily(src));
  for (const e of layout.edges) {
    for (let i = 0; i < e.points.length - 1; i++) {
      const a = e.points[i]!;
      const b = e.points[i + 1]!;
      const horiz = Math.abs(a.y - b.y) < 0.5;
      const vert = Math.abs(a.x - b.x) < 0.5;
      for (const n of layout.nodes) {
        if (horiz) {
          const x1 = Math.min(a.x, b.x);
          const x2 = Math.max(a.x, b.x);
          if (
            a.y > n.y + 0.5 &&
            a.y < n.y + n.height - 0.5 &&
            x2 > n.x + 0.5 &&
            x1 < n.x + n.width - 0.5
          )
            return true;
        }
        if (vert) {
          const y1 = Math.min(a.y, b.y);
          const y2 = Math.max(a.y, b.y);
          if (
            a.x > n.x + 0.5 &&
            a.x < n.x + n.width - 0.5 &&
            y2 > n.y + 0.5 &&
            y1 < n.y + n.height - 0.5
          )
            return true;
        }
      }
    }
  }
  return false;
}

const rowOf = (src: string, id: string): number => {
  const layout = layoutFamily(parseFamily(src));
  return layout.nodes.find((n) => n.id === id)!.row;
};

describe('family layout — couple-rank (AC2b, the load-bearing test)', () => {
  it('a married-in spouse shares the bloodline partner deep row (NOT row 0)', () => {
    // Bloodline: Gramps → Dad → Kid. Kid marries married-in Spouse.
    const src = `family
Gramps + Gran
  Dad
Dad + Mum
  Kid
Kid + Spouse
  Baby`;
    const layout = layoutFamily(parseFamily(src));
    const kid = layout.nodes.find((n) => n.id === 'kid')!;
    const spouse = layout.nodes.find((n) => n.id === 'spouse')!;
    expect(spouse.row).toBe(kid.row);
    expect(spouse.row).toBeGreaterThan(0); // NOT stranded at row 0
  });

  it('unmarried siblings share a row', () => {
    const src = `family
Alice + Bob
  Carol
  Dave`;
    expect(rowOf(src, 'carol')).toBe(rowOf(src, 'dave'));
  });

  it('spouses share a row (horizontal marriage bar)', () => {
    const src = `family
Alice + Bob
  Carol`;
    const layout = layoutFamily(parseFamily(src));
    const a = layout.nodes.find((n) => n.id === 'alice')!;
    const b = layout.nodes.find((n) => n.id === 'bob')!;
    expect(a.row).toBe(b.row);
    expect(layout.bars).toHaveLength(1);
    // Bar is horizontal.
    const bar = layout.bars[0]!;
    expect(bar.x1).not.toBe(bar.x2);
  });

  it('remarriage: one card, two horizontal bars', () => {
    const src = `family
Alice + Bob
  Carol
Carol + Evan
  Frank`;
    const layout = layoutFamily(parseFamily(src));
    expect(layout.nodes.filter((n) => n.id === 'carol')).toHaveLength(1);
    expect(layout.bars).toHaveLength(2);
  });

  it('a remarried hub sits BETWEEN its two spouses (bar never spans a third card)', () => {
    // Anne marries James then Calico — Anne must be the middle card so neither
    // marriage bar passes over the other spouse.
    const src = `family
Anne + James
  Kid1
Anne + Calico
  Kid2`;
    const parsed = parseFamily(src);
    const layout = layoutFamily(parsed);
    const cx = (id: string): number => {
      const n = layout.nodes.find((x) => x.id === id)!;
      return n.x + n.width / 2;
    };
    const [lo, hi] = [cx('james'), cx('calico')].sort((a, b) => a - b);
    expect(cx('anne')).toBeGreaterThan(lo);
    expect(cx('anne')).toBeLessThan(hi);
    // No marriage bar spans over a card that is not one of its parents.
    const parentsOf = new Map(
      parsed.unions.map((u) => [u.id, new Set(u.parents)])
    );
    for (const bar of layout.bars) {
      for (const n of layout.nodes) {
        if (parentsOf.get(bar.unionId)!.has(n.id)) continue;
        const spans =
          bar.y > n.y + 0.5 &&
          bar.y < n.y + n.height - 0.5 &&
          bar.x2 > n.x + 0.5 &&
          bar.x1 < n.x + n.width - 0.5;
        expect(spans).toBe(false);
      }
    }
  });

  it('cousin-marriage diamond lays out with deterministic rows and no crash', () => {
    const src = `family
GrandA + GrandB
  ParentX
  ParentY
ParentX + SpouseX
  CousinA
ParentY + SpouseY
  CousinB
CousinA + CousinB
  Child`;
    const layout = layoutFamily(parseFamily(src));
    expect(rowOf(src, 'granda')).toBe(0);
    expect(rowOf(src, 'parentx')).toBe(rowOf(src, 'parenty'));
    expect(rowOf(src, 'cousina')).toBe(rowOf(src, 'cousinb'));
    expect(rowOf(src, 'child')).toBeGreaterThan(rowOf(src, 'cousina'));
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('child bus never runs through a parent card, even with a tall card', () => {
    // Admiral has 7 meta rows (tall); the bus level must clear its bottom.
    const src = `family
Admiral b: 1642, d: 1710, sex: m, bp: Bristol, dp: Tortuga, occupation: Admiral, military: Royal Navy, education: Naval College, religion: Anglican, burial: St Mary Redcliffe
Lady b: 1650, sex: f
Admiral + Lady m: 1668
  Rourke sex: m
  Merrow sex: f`;
    expect(anyLineThroughCard(src)).toBe(false);
  });

  it('a short-key long-value row does not overflow the card width', () => {
    // `bp` is a short key but a long value; the value is aligned to the widest
    // key column, so the card must be wide enough for that column + the value.
    const src = `family
Someone occupation: Chief Petty Officer of the Fleet, bp: X`;
    const layout = layoutFamily(parseFamily(src));
    const node = layout.nodes[0]!;
    const rows = familyCardRows(node);
    const labeled = rows.filter((r) => !r.year);
    const maxKeyW = Math.max(
      ...labeled.map((r) => measureText(`${r.key}: `, 11))
    );
    const valueX = 10 + maxKeyW + 6;
    for (const r of labeled) {
      const rightEdge = valueX + measureText(r.value, 11);
      expect(rightEdge).toBeLessThanOrEqual(node.width);
    }
  });

  it('a single child sits on a straight vertical line under its parents (no zig-zag)', () => {
    // Includes a cousin-marriage diamond (Cal+Cora → Anchor) where the parents
    // come from different subtrees — Anchor must still be centered on the bar.
    const src = `family
GrandA + GrandB
  ParentX
  ParentY
ParentX + SpouseX
  Cal
ParentY + SpouseY
  Cora
Cal + Cora m: 1750
  Anchor`;
    const parsed = parseFamily(src);
    const layout = layoutFamily(parsed);
    for (const u of parsed.unions) {
      if (u.children.length !== 1) continue;
      const bar = layout.bars.find((b) => b.unionId === u.id);
      const node = layout.nodes.find((n) => n.id === u.children[0]!.personId)!;
      const childCx = node.x + node.width / 2;
      const anchor = bar
        ? bar.midX
        : (() => {
            const p = layout.nodes.find((n) => n.id === u.parents[0])!;
            return p.x + p.width / 2;
          })();
      expect(Math.abs(childCx - anchor)).toBeLessThanOrEqual(1);
    }
  });

  it('focus mode: subtree below + parents as dots above', () => {
    const src = `family
Gran + Gramps
  Dad
  Aunt
Dad + Mum
  Me
  Sibling
Me + Partner
  Kid`;
    const parsed = parseFamily(src);
    const full = layoutFamily(parsed);
    const focus = layoutFamily(parsed, 'me');
    const ids = new Set(focus.nodes.map((n) => n.id));
    // The focused person, spouse, and all descendants are full cards…
    for (const id of ['me', 'partner', 'kid']) expect(ids.has(id)).toBe(true);
    // …parents are NOT cards — they collapse to ancestor dots above…
    expect(ids.has('dad')).toBe(false);
    expect(ids.has('mum')).toBe(false);
    expect(focus.ancestors.map((a) => a.label).sort()).toEqual(['Dad', 'Mum']);
    expect(focus.focusAnchor).toBeDefined();
    // …and grandparents / siblings not below Me are dropped entirely.
    expect(ids.has('gran')).toBe(false);
    expect(ids.has('sibling')).toBe(false);
    expect(focus.nodes.length).toBeLessThan(full.nodes.length);
    // Unknown focus id → full tree, no ancestor dots.
    const none = layoutFamily(parsed, 'nobody');
    expect(none.nodes.length).toBe(full.nodes.length);
    expect(none.ancestors).toHaveLength(0);
  });

  it('adopted child produces one child edge flagged adopted', () => {
    const src = `family
Alice + Bob
  Carol adopted
  Dave`;
    const layout = layoutFamily(parseFamily(src));
    const adoptedEdges = layout.edges.filter((e) => e.adopted);
    expect(adoptedEdges).toHaveLength(1);
    expect(adoptedEdges[0]!.childId).toBe('carol');
  });
});
