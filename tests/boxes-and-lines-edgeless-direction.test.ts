import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';

// #1999 — with no lines, `direction` lays out the boxes themselves:
// `lr` is a row, `tb` is a column. With lines it still names the flow.

const spread = (vals: number[]) => Math.max(...vals) - Math.min(...vals);

async function layout(src: string) {
  return layoutBoxesAndLines(parseBoxesAndLines(src));
}

const flat = (dir: string) =>
  `boxes-and-lines\ndirection-${dir}\nAlpha\nBravo\nCharlie\n`;

const grouped = (dir: string) =>
  `boxes-and-lines\ndirection-${dir}\n[One]\n  A1\n  A2\n  A3\n[Two]\n  B1\n  B2\n  B3\n`;

describe('boxes-and-lines direction with no lines', () => {
  it('lr puts ungrouped boxes in a row', async () => {
    const l = await layout(flat('lr'));
    expect(spread(l.nodes.map((n) => n.y))).toBe(0);
    expect(spread(l.nodes.map((n) => n.x))).toBeGreaterThan(0);
  });

  it('tb puts ungrouped boxes in a column', async () => {
    const l = await layout(flat('tb'));
    expect(spread(l.nodes.map((n) => n.x))).toBe(0);
    expect(spread(l.nodes.map((n) => n.y))).toBeGreaterThan(0);
  });

  it('lr puts groups side by side, tb stacks them', async () => {
    const lr = await layout(grouped('lr'));
    const [l1, l2] = lr.groups;
    expect(Math.abs(l1.y - l2.y)).toBeLessThan(1);
    expect(Math.abs(l1.x - l2.x)).toBeGreaterThan(0);

    const tb = await layout(grouped('tb'));
    const [t1, t2] = tb.groups;
    expect(Math.abs(t1.x - t2.x)).toBeLessThan(1);
    expect(Math.abs(t1.y - t2.y)).toBeGreaterThan(0);
  });

  it('a wrapped group reads row-major under lr', async () => {
    const l = await layout(
      'boxes-and-lines\ndirection-lr\n[G]\n  B1\n  B2\n  B3\n  B4\n'
    );
    const at = (label: string) => l.nodes.find((n) => n.label === label)!;
    // Four boxes wrap into 2×2: B1 B2 on the first row, B3 B4 below.
    expect(at('B1').y).toBe(at('B2').y);
    expect(at('B3').y).toBe(at('B4').y);
    expect(at('B1').x).toBeLessThan(at('B2').x);
    expect(at('B1').y).toBeLessThan(at('B3').y);
  });

  it('lines still set the flow', async () => {
    const lr = await layout('boxes-and-lines\ndirection-lr\nA\n  -> B\n');
    const [a, b] = ['A', 'B'].map((k) => lr.nodes.find((n) => n.label === k)!);
    expect(a.x).toBeLessThan(b.x);
    const tb = await layout('boxes-and-lines\ndirection-tb\nA\n  -> B\n');
    const [c, d] = ['A', 'B'].map((k) => tb.nodes.find((n) => n.label === k)!);
    expect(c.y).toBeLessThan(d.y);
  });
});
