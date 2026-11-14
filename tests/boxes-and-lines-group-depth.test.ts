// Group nesting depth (#1840): boxes-and-lines nests groups four deep, enough
// for account → VPC → subnet → service. A fifth level is refused with a warning.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';

const FIXTURE = readFileSync(
  join(__dirname, '../stress/boxes-and-lines/nesting--aws-account.dgmo'),
  'utf8'
);

const depthWarning = (src: string): boolean =>
  parseBoxesAndLines(src).diagnostics.some((d) =>
    d.message.includes('maximum depth')
  );

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Layout boxes are centred on (x, y).
const inside = (inner: Box, outer: Box): boolean =>
  inner.x - inner.width / 2 >= outer.x - outer.width / 2 &&
  inner.x + inner.width / 2 <= outer.x + outer.width / 2 &&
  inner.y - inner.height / 2 >= outer.y - outer.height / 2 &&
  inner.y + inner.height / 2 <= outer.y + outer.height / 2;

describe('boxes-and-lines group nesting depth', () => {
  it('parses groups four deep with no depth warning', () => {
    const parsed = parseBoxesAndLines(FIXTURE);
    expect(depthWarning(FIXTURE)).toBe(false);
    expect(parsed.groups).toHaveLength(7);

    const parentOf = new Map(
      parsed.groups.map((g) => [g.label, g.parentGroup])
    );
    expect(parentOf.get('App Tier')).toBe('Private Subnet');
    expect(parentOf.get('Private Subnet')).toBe('VPC');
    expect(parentOf.get('VPC')).toBe('Production Account');
    expect(parentOf.get('Production Account')).toBeUndefined();
    expect(parsed.groups.find((g) => g.label === 'App Tier')!.children).toEqual(
      ['API', 'Worker']
    );
  });

  it('warns on a fifth level', () => {
    expect(
      depthWarning(
        'boxes-and-lines\n[A]\n  [B]\n    [C]\n      [D]\n        [E]\n          X'
      )
    ).toBe(true);
  });

  it('draws each group inside its parent, and each member inside its group', async () => {
    const parsed = parseBoxesAndLines(FIXTURE);
    const layout = await layoutBoxesAndLines(parsed);
    const groupBox = new Map(layout.groups.map((g) => [g.label, g]));
    const nodeBox = new Map(layout.nodes.map((n) => [n.label, n]));
    expect(groupBox.size).toBe(7);

    for (const g of parsed.groups) {
      const outer = groupBox.get(g.label)!;
      for (const child of g.children) {
        const inner = groupBox.get(child) ?? nodeBox.get(child);
        expect(inner, `${child} is laid out`).toBeDefined();
        expect(inside(inner!, outer), `${child} inside [${g.label}]`).toBe(
          true
        );
      }
    }
  });
});
