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

  it('AC5.1: compact dimensions when no overrides given', () => {
    const { resolved } = pipeline(loadFixture('basic.dgmo'));
    const layout = layoutPert(resolved);
    // Milestones share dimensions with activities now (160×64) so the
    // visual treatment matches infra/org node styling.
    for (const node of layout.nodes) {
      expect(node.width).toBe(160);
      expect(node.height).toBe(64);
    }
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
  -> B 1 1 1
B
  -> C 1 1 1
C
  -> D 1 1 1
D
  -> E 1 1 1
E
  -> F 1 1 1
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
