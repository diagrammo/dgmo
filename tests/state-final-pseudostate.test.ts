import { describe, it, expect } from 'vitest';
import { parseState, FINAL_PSEUDOSTATE_ID } from '../src/graph/state-parser';
import { layoutGraph } from '../src/graph/layout';

// dgmo-content examples/state/state.dgmo (ship battle) — the #1891 repro:
// end transitions from the last rank looped around the whole diagram.
const SHIP_BATTLE = `state Ship Battle Lifecycle

[*] -> Sailing

Sailing
  -enemy spotted-> BattleStations

[Losses] gray
  Captured -> [*]
  Sinking -> [*]

[Aftermath] teal
  Victorious
    -loot taken-> Sailing

  Retreating
    -escaped-> Sailing
    -caught-> Captured

[Combat] red
  Engaging
    -alongside-> Boarding
    -hull breach-> Sinking
    -outgunned-> Retreating

  Boarding
    -crew wins-> Victorious
    -crew loses-> Captured

BattleStations
  -in range-> Engaging
  -enemy retreats-> Sailing
`;

describe('state final pseudostate (#1891)', () => {
  it('gives [*] as a target its own node, apart from the start', () => {
    const parsed = parseState(SHIP_BATTLE);
    const pseudo = parsed.nodes.filter((n) => n.shape === 'pseudostate');
    expect(pseudo.map((n) => n.id).sort()).toEqual(
      ['pseudostate:[*]', FINAL_PSEUDOSTATE_ID].sort()
    );
    const intoFinal = parsed.edges.filter(
      (e) => e.target === FINAL_PSEUDOSTATE_ID
    );
    expect(intoFinal.map((e) => e.source).sort()).toEqual([
      'state:captured',
      'state:sinking',
    ]);
    expect(parsed.edges.some((e) => e.target === 'pseudostate:[*]')).toBe(
      false
    );
  });

  it('keeps every edge route inside the node bounding box (no outer loop)', () => {
    const layout = layoutGraph(parseState(SHIP_BATTLE));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of layout.nodes) {
      minX = Math.min(minX, n.x - n.width / 2);
      maxX = Math.max(maxX, n.x + n.width / 2);
      minY = Math.min(minY, n.y - n.height / 2);
      maxY = Math.max(maxY, n.y + n.height / 2);
    }
    // Small slack for a curve's bow near a box edge; the old loop ran
    // ~65 px outside the box and spanned the full width.
    const SLACK = 20;
    for (const e of layout.edges) {
      for (const p of e.points) {
        expect(p.x).toBeGreaterThanOrEqual(minX - SLACK);
        expect(p.x).toBeLessThanOrEqual(maxX + SLACK);
        expect(p.y).toBeGreaterThanOrEqual(minY - SLACK);
        expect(p.y).toBeLessThanOrEqual(maxY + SLACK);
      }
    }
  });
});
