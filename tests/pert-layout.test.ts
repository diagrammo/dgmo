import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePert } from '../src/pert/parser';
import { analyzePert } from '../src/pert/analyzer';
import { layoutPert, relayoutPert } from '../src/pert/layout';

const FIXTURES = join(__dirname, '../test-fixtures/pert');

function pipeline(input: string) {
  const parsed = parsePert(input);
  const resolved = analyzePert(parsed);
  return { parsed, resolved };
}

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

describe('pert layout', () => {
  it('returns positions for every activity', () => {
    const { resolved } = pipeline(loadFixture('basic.dgmo'));
    const layout = layoutPert(resolved);
    expect(layout.nodes).toHaveLength(resolved.activities.length);
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
    }
  });

  it('AC5.1: default node dimensions size to content with a uniform width', () => {
    const { resolved } = pipeline(loadFixture('basic.dgmo'));
    const layout = layoutPert(resolved);
    // Every non-milestone node shares one width (uniform grid).
    const widths = new Set(layout.nodes.map((n) => n.width));
    expect(widths.size).toBe(1);
    for (const node of layout.nodes) {
      // Stays within the computed-sizing clamp range.
      expect(node.width).toBeGreaterThanOrEqual(120);
      expect(node.width).toBeLessThanOrEqual(280);
      expect(node.height).toBe(90);
    }
  });

  it('date-anchored diagrams produce wider nodes than non-anchored', () => {
    const { resolved: plain } = pipeline(loadFixture('basic.dgmo'));
    const plainLayout = layoutPert(plain);
    const { resolved: dated } = pipeline(loadFixture('start-date.dgmo'));
    const datedLayout = layoutPert(dated);
    // Outer cells hold `YYYY-MM-DD` (10 chars) vs. a short `5w`-style
    // duration — so the date variant must be the wider of the two.
    expect(datedLayout.nodes[0]!.width).toBeGreaterThan(
      plainLayout.nodes[0]!.width
    );
  });

  it('AC5.2: relayoutPert with override grows the targeted node and ripples neighbors', () => {
    const { resolved } = pipeline(loadFixture('basic.dgmo'));
    const baseLayout = layoutPert(resolved);
    const target = baseLayout.nodes[1];
    const overrideLayout = relayoutPert(resolved, {
      [target.id]: { width: 280, height: 180 },
    });
    const grown = overrideLayout.nodes.find((n) => n.id === target.id)!;
    expect(grown.width).toBe(280);
    expect(grown.height).toBe(180);
    // Diagram bounds must accommodate the override.
    expect(overrideLayout.width).toBeGreaterThan(baseLayout.width);
  });

  it('AC5.7: direction TB produces a taller-than-wide layout for a long chain', () => {
    const linear = `pert
direction TB
A 1 1 1
B 1 1 1
C 1 1 1
D 1 1 1
E 1 1 1
F 1 1 1
A
  -> B
B
  -> C
C
  -> D
D
  -> E
E
  -> F
`;
    const { resolved: tbResolved } = pipeline(linear);
    const tbLayout = layoutPert(tbResolved);
    expect(tbLayout.height / tbLayout.width).toBeGreaterThan(1);

    // LR variant of the same chain — width-dominant.
    const { resolved: lrResolved } = pipeline(
      linear.replace('direction TB', 'direction LR')
    );
    const lrLayout = layoutPert(lrResolved);
    expect(lrLayout.width / lrLayout.height).toBeGreaterThan(1);
  });

  it('groups have non-zero bounds when they contain activities', () => {
    const { resolved } = pipeline(loadFixture('with-groups.dgmo'));
    const layout = layoutPert(resolved);
    for (const grp of layout.groups) {
      expect(grp.width).toBeGreaterThan(0);
      expect(grp.height).toBeGreaterThan(0);
    }
  });
});
