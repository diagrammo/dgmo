// A cross-group edge label needs a gap between the two group WALLS, which is
// the gap between their nodes LESS the padding each group box adds. The dagre
// path reserves room by hanging a virtual node on the edge, so it widens the
// node gap and the corridor never grows — every inter-group corridor on a
// diagram came out the same width whatever crossed it, and a label wider than
// it was drawn astride the border (#778, on top of #777).
//
// Two assertions, deliberately at different levels: the generator's own
// arithmetic (scale-free — a corridor measured against the label that crosses
// it), and the committed gallery fixture end to end, which is where the defect
// was visible.
import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { groupedTierCandidates } from '../src/boxes-and-lines/layout-grouped';
import {
  measureEdgeLabel,
  BOX_CLEAR_PAD,
} from '../src/boxes-and-lines/label-placement';
import { NODE_WIDTH, NODE_HEIGHT } from '../src/boxes-and-lines/node-metrics';
import { readFileSync } from 'node:fs';

const LONG_LABEL = 'suggest + per-type';

const TWO_GROUPS = `boxes-and-lines Corridor
direction-lr

[Upstream]
  Source
  Feeder

[Downstream]
  Sink
  Drain

Source -${LONG_LABEL}-> Sink
Feeder -> Drain
`;

/** Clear horizontal run between the two top-level group boxes. */
function corridorWidth(
  groups: readonly { x: number; width: number }[]
): number {
  const [a, b] = [...groups].sort((p, q) => p.x - q.x);
  return b!.x - b!.width / 2 - (a!.x + a!.width / 2);
}

describe('cross-group edge label corridor (#778)', () => {
  it('widens the corridor to fit the label only when the caller reserves', () => {
    const parsed = parseBoxesAndLines(TWO_GROUPS);
    const sizes = new Map(
      parsed.nodes.map((n) => [
        n.label,
        { width: NODE_WIDTH, height: NODE_HEIGHT },
      ])
    );
    const needed = measureEdgeLabel(LONG_LABEL).width + 2 * BOX_CLEAR_PAD;

    const plain = groupedTierCandidates(parsed, sizes);
    const reserved = groupedTierCandidates(parsed, sizes, {
      reserveEdgeLabels: true,
    });
    expect(plain.length).toBeGreaterThan(0);
    expect(reserved.length).toBe(plain.length);

    // Unreserved: the corridor is whatever the fixed rank gap leaves over, and
    // the label does not fit in it. Reserved: it does.
    // The reserved corridor lands ON the requirement, so compare with a float
    // epsilon rather than an exact `>=`.
    expect(corridorWidth(plain[0]!.groups)).toBeLessThan(needed);
    expect(corridorWidth(reserved[0]!.groups)).toBeGreaterThan(needed - 1e-6);
  });

  it('leaves no label astride a group it does not live in, on the gallery fixture', async () => {
    const parsed = parseBoxesAndLines(
      readFileSync('gallery/fixtures/boxes-and-lines.dgmo', 'utf8')
    );
    const lay = await layoutBoxesAndLines(parsed);

    // Transitive containment: which groups enclose a node.
    const byLabel = new Map(parsed.groups.map((g) => [g.label, g]));
    const encloses = new Map<string, Set<string>>();
    for (const g of parsed.groups)
      for (const c of g.children) {
        const s = encloses.get(c) ?? new Set<string>();
        let cur: string | undefined = g.label;
        const guard = new Set<string>();
        while (cur && !guard.has(cur)) {
          guard.add(cur);
          s.add(cur);
          cur = byLabel.get(cur)?.parentGroup;
        }
        encloses.set(c, s);
      }

    const astride: string[] = [];
    for (const e of lay.edges) {
      if (!e.label || e.labelX === undefined || e.labelY === undefined)
        continue;
      const lw = e.labelWidth ?? 0;
      const lh = e.labelHeight ?? 0;
      const src = encloses.get(e.source) ?? new Set<string>();
      const tgt = encloses.get(e.target) ?? new Set<string>();
      for (const g of lay.groups) {
        if (g.collapsed) continue;
        if (src.has(g.label) && tgt.has(g.label)) continue; // its own container
        if (
          e.labelX - lw / 2 < g.x + g.width / 2 &&
          e.labelX + lw / 2 > g.x - g.width / 2 &&
          e.labelY - lh / 2 < g.y + g.height / 2 &&
          e.labelY + lh / 2 > g.y - g.height / 2
        )
          astride.push(`"${e.label}" over "${g.label}"`);
      }
    }
    expect(astride).toEqual([]);
  });
});
