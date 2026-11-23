import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';

// #2001 — a `direction-tb` / `direction-lr` line inside a group lays out that
// group's members on that axis, as a sub-layout inside the outer layout.

const spread = (vals: number[]) => Math.max(...vals) - Math.min(...vals);

const src = (groupDirection: string) => `boxes-and-lines Release Train
direction-lr

Source -> Lint
Sign-off -> Deploy

[Checks]
${groupDirection}
  Lint
  Tests
  Sign-off

Lint -> Tests
Tests -> Sign-off
`;

const members = ['Lint', 'Tests', 'Sign-off'];

async function layout(text: string) {
  const parsed = parseBoxesAndLines(text);
  const l = await layoutBoxesAndLines(parsed);
  const at = (label: string) => {
    const n = l.nodes.find((m) => m.label === label);
    if (!n) throw new Error(`no box ${label}`);
    return n;
  };
  return { parsed, l, at };
}

describe('boxes-and-lines per-group direction', () => {
  it('parses the line onto the group, not as a box', () => {
    const tb = parseBoxesAndLines(src('  direction-tb'));
    expect(tb.groups.find((g) => g.label === 'Checks')?.direction).toBe('TB');
    expect(tb.nodes.map((n) => n.label)).not.toContain('direction-tb');
    expect(tb.direction).toBe('LR');
    expect(tb.diagnostics).toEqual([]);

    const legacy = parseBoxesAndLines(src('  direction TB'));
    expect(legacy.groups[0]?.direction).toBe('TB');
    expect(legacy.nodes.map((n) => n.label)).not.toContain('direction TB');

    const none = parseBoxesAndLines(src(''));
    expect(none.groups[0]?.direction).toBeUndefined();
  });

  it('stacks the group on TB only when it says so', async () => {
    const without = await layout(src(''));
    const mx = members.map((m) => without.at(m).x);
    const my = members.map((m) => without.at(m).y);
    // Without the line the members follow the diagram's LR flow.
    expect(spread(my)).toBeLessThan(1);
    expect(spread(mx)).toBeGreaterThan(100);

    const withTb = await layout(src('  direction-tb'));
    const tx = members.map((m) => withTb.at(m).x);
    const ty = members.map((m) => withTb.at(m).y);
    // With it they stack top to bottom, in flow order.
    expect(spread(tx)).toBeLessThan(1);
    expect(ty[0]!).toBeLessThan(ty[1]!);
    expect(ty[1]!).toBeLessThan(ty[2]!);
    // The rest of the diagram still runs left to right.
    expect(withTb.at('Source').x).toBeLessThan(tx[0]!);
    expect(withTb.at('Deploy').x).toBeGreaterThan(tx[0]!);
  });

  it('keeps every member inside its group frame and draws every line', async () => {
    const { l, parsed } = await layout(src('  direction-tb'));
    const frame = l.groups.find((g) => g.label === 'Checks')!;
    for (const m of members) {
      const n = l.nodes.find((x) => x.label === m)!;
      expect(n.x - n.width / 2).toBeGreaterThanOrEqual(
        frame.x - frame.width / 2
      );
      expect(n.x + n.width / 2).toBeLessThanOrEqual(frame.x + frame.width / 2);
      expect(n.y - n.height / 2).toBeGreaterThanOrEqual(
        frame.y - frame.height / 2
      );
      expect(n.y + n.height / 2).toBeLessThanOrEqual(
        frame.y + frame.height / 2
      );
    }
    expect(l.nodes.map((n) => n.label).sort()).toEqual(
      parsed.nodes.map((n) => n.label).sort()
    );
    const drawn = l.edges.map((e) => `${e.source}>${e.target}`).sort();
    expect(drawn).toEqual(
      parsed.edges.map((e) => `${e.source}>${e.target}`).sort()
    );
  });

  it('ends a line from outside on the member it names', async () => {
    const { l, at } = await layout(src('  direction-tb'));
    const into = l.edges.find((e) => e.target === 'Lint')!;
    const end = into.points[into.points.length - 1]!;
    const lint = at('Lint');
    expect(Math.abs(end.x - (lint.x - lint.width / 2))).toBeLessThan(1);
    expect(Math.abs(end.y - lint.y)).toBeLessThan(1);
    const out = l.edges.find((e) => e.source === 'Sign-off')!;
    const start = out.points[0]!;
    const so = at('Sign-off');
    expect(Math.abs(start.y - so.y)).toBeLessThan(so.height / 2 + 1);
  });

  it('a direction equal to the diagram changes nothing', async () => {
    const plain = await layout(src(''));
    const same = await layout(src('  direction-lr'));
    expect(same.l.nodes).toEqual(plain.l.nodes);
  });

  it('a collapsed directed group folds like any other', async () => {
    const parsed = parseBoxesAndLines(
      src('  direction-tb').replace('[Checks]', '[Checks] collapsed')
    );
    const c = collapseBoxesAndLines(parsed, new Set(['Checks']));
    const l = await layoutBoxesAndLines(c.parsed, c);
    expect(l.nodes.map((n) => n.label)).not.toContain('Lint');
    expect(l.groups.find((g) => g.label === 'Checks')?.collapsed).toBe(true);
  });
});

describe('boxes-and-lines per-group direction — editor', () => {
  it('highlights the indented line as a directive', async () => {
    const { highlightDgmo } = await import('../src/editor/highlight-api');
    const tokens = highlightDgmo(
      'boxes-and-lines X\ndirection-lr\n[Checks]\n  direction-tb\n  Lint\n'
    );
    expect(tokens.filter((t) => t.text === 'direction-tb')).toEqual([
      { text: 'direction-tb', role: 'keyword' },
    ]);
  });
});
