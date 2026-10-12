import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseClassDiagram } from '../src/class/parser';
import {
  layoutClassDiagram,
  type ClassLayoutResult,
} from '../src/class/layout';
import {
  countSplineCrossings,
  countEdgeOverlaps,
  countEdgeNodePierces,
} from '../src/boxes-and-lines/layout-search';
import type { BLLayoutResult } from '../src/boxes-and-lines/layout';

// The boxes-and-lines scorers, read the way the search reads a class layout.
function asScored(lay: ClassLayoutResult): BLLayoutResult {
  return {
    nodes: lay.nodes.map((n) => ({
      label: n.id,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
    })),
    edges: lay.edges,
    groups: [],
    width: lay.width,
    height: lay.height,
  } as unknown as BLLayoutResult;
}

const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, '../gallery/fixtures', name), 'utf8');

describe('layoutClassDiagram crossing search (#1240)', () => {
  it('takes the full class fixture from 2 crossings and 1 overlap run to none', () => {
    const lay = asScored(
      layoutClassDiagram(parseClassDiagram(fixture('class-full.dgmo')))
    );
    expect(countSplineCrossings(lay)).toBe(0);
    expect(countEdgeOverlaps(lay)).toBe(0);
    expect(countEdgeNodePierces(lay)).toBe(0);
  });

  it('is deterministic — the same source lays out the same twice', () => {
    const parsed = parseClassDiagram(fixture('class-full.dgmo'));
    expect(layoutClassDiagram(parsed)).toEqual(layoutClassDiagram(parsed));
  });

  it('leaves a diagram with nothing to fix as plain dagre placed it', () => {
    // A base class with three subclasses: no crossing, so the plain placement
    // stands — the subclasses share one rank.
    const lay = layoutClassDiagram(
      parseClassDiagram(`class Shapes

Shape
A extends Shape
B extends Shape
C extends Shape
`)
    );
    const y = new Map(lay.nodes.map((n) => [n.name, n.y]));
    expect(lay.nodes).toHaveLength(4);
    expect(countSplineCrossings(asScored(lay))).toBe(0);
    expect(y.get('A')).toBe(y.get('B'));
    expect(y.get('B')).toBe(y.get('C'));
  });
});
