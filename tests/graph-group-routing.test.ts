import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { layoutGraph, type LayoutResult } from '../src/graph/layout';
import type { ParsedGraph } from '../src/graph/types';
import { parseFlowchart } from '../src/graph/flowchart-parser';
import { parseState } from '../src/graph/state-parser';
import {
  countSplineCrossings,
  countEdgeNodePierces,
  countForeignGroupCrossings,
} from '../src/boxes-and-lines/layout-search';
import type { BLLayoutResult } from '../src/boxes-and-lines/layout';
import type { BLGroup } from '../src/boxes-and-lines/types';

// The boxes-and-lines scorers, read the way the search reads a graph layout:
// node and group boxes centred, groups keyed by id.
function asScored(lay: LayoutResult): BLLayoutResult {
  return {
    nodes: lay.nodes.map((n) => ({
      label: n.id,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    })),
    edges: lay.edges,
    groups: lay.groups
      .filter((g) => !g.collapsed)
      .map((g) => ({
        label: g.id,
        x: g.x + g.width / 2,
        y: g.y + g.height / 2,
        width: g.width,
        height: g.height,
        collapsed: false,
      })),
    width: lay.width,
    height: lay.height,
  } as unknown as BLLayoutResult;
}

const holdings = (graph: ParsedGraph): BLGroup[] =>
  (graph.groups ?? []).map((g) => ({
    label: g.id,
    children: g.nodeIds,
    lineNumber: g.lineNumber,
    metadata: {},
  }));

const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, '../gallery/fixtures', name), 'utf8');

// The published state example (dgmo-content examples/state), named in #1839:
// edges from Combat into Losses run straight through the Aftermath box.
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

// Three groups and thirteen edges, several of them between ungrouped states
// on either side of a group. Choosing a placement alone still leaves three
// edges through a group box; only bending them around it clears them.
const AROUND = `state Around

[*] -> A

A

[G0]
  B
  C
  D

[G1]
  E
  F
  G

[G2]
  H
  I

J

C -> I
H -> B
C -> E
G -> J
A -> J
E -> D
E -> D
C -> I
E -> F
A -> E
H -> I
H -> E
B -> E
`;

describe('layoutGraph routes curves around groups (#1839)', () => {
  it('runs no Combat edge through the Aftermath box in the state example', () => {
    const g = parseState(SHIP_BATTLE);
    const lay = asScored(layoutGraph(g));
    expect(countForeignGroupCrossings(lay, holdings(g))).toBe(0);
    expect(countEdgeNodePierces(lay)).toBe(0);
  });

  it('bends edges around a group box when no placement avoids it', () => {
    const g = parseState(AROUND);
    const lay = asScored(layoutGraph(g));
    expect(countForeignGroupCrossings(lay, holdings(g))).toBe(0);
    expect(countEdgeNodePierces(lay)).toBe(0);
    expect(countSplineCrossings(lay)).toBeLessThanOrEqual(1);
  });

  it('leaves the gallery fixtures with groups clear of foreign passes', () => {
    for (const g of [
      parseState(fixture('state.dgmo')),
      parseState(fixture('state-tags.dgmo')),
      parseFlowchart(fixture('flowchart-groups.dgmo')),
      parseFlowchart(fixture('flowchart-complex.dgmo')),
      parseFlowchart(fixture('flowchart-shapes.dgmo')),
    ])
      expect(
        countForeignGroupCrossings(asScored(layoutGraph(g)), holdings(g))
      ).toBe(0);
  });

  it('is deterministic — the same source lays out the same twice', () => {
    const g = parseState(AROUND);
    expect(layoutGraph(g)).toEqual(layoutGraph(g));
  });
});
