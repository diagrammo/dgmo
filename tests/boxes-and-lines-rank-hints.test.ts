// Rank hints (#1840): `same-rank A, B` lays boxes out on one rank, and
// `order A, B` keeps boxes that share a rank in that order across it. Each
// fixture is checked twice: with its hint, and with the hint line removed, so
// the test proves the hint is what moved the layout.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';

const fixture = (name: string): string =>
  readFileSync(
    join(__dirname, `../stress/boxes-and-lines/rank-hints--${name}.dgmo`),
    'utf8'
  );
const SAME_RANK = fixture('same-rank');
const ORDER = fixture('order');
const withoutHints = (src: string): string =>
  src
    .split('\n')
    .filter((l) => !/^(same-rank|order) /.test(l))
    .join('\n');

async function positions(src: string) {
  const layout = await layoutBoxesAndLines(parseBoxesAndLines(src));
  return new Map(layout.nodes.map((n) => [n.label, { x: n.x, y: n.y }]));
}

const warnings = (src: string): string[] =>
  parseBoxesAndLines(src).diagnostics.map((d) => d.message);

describe('boxes-and-lines rank hints — parse', () => {
  it('reads same-rank and order sets as box labels', () => {
    const parsed = parseBoxesAndLines(SAME_RANK);
    expect(parsed.sameRank).toEqual([['DB', 'Queue']]);
    expect(parsed.diagnostics).toEqual([]);
    expect(parseBoxesAndLines(ORDER).rankOrder).toEqual([['Web', 'Mobile']]);
  });

  it('never turns a hint into a box', () => {
    const labels = parseBoxesAndLines(SAME_RANK).nodes.map((n) => n.label);
    expect(labels.some((l) => l.startsWith('same-rank'))).toBe(false);
  });

  it('matches names case-insensitively and before the box is declared', () => {
    const parsed = parseBoxesAndLines(
      'boxes-and-lines\nsame-rank db, queue\nA -> DB\nB -> X\nX -> Queue\n'
    );
    expect(parsed.sameRank).toEqual([['DB', 'Queue']]);
  });

  it('keeps a box whose name starts with "order" when there is no comma', () => {
    const parsed = parseBoxesAndLines('boxes-and-lines\norder queue\n');
    expect(parsed.nodes.map((n) => n.label)).toEqual(['order queue']);
    expect(parsed.rankOrder).toBeUndefined();
  });

  it('warns on a name that is no box, and on a group', () => {
    const msgs = warnings(
      'boxes-and-lines\n[Edge]\n  LB\nA -> B\nsame-rank A, Nope, [Edge]\n'
    );
    expect(msgs.some((m) => m.includes("'Nope', which is not a box"))).toBe(
      true
    );
    expect(msgs.some((m) => m.includes('the group [Edge]'))).toBe(true);
    expect(msgs.some((m) => m.includes('needs at least two boxes'))).toBe(true);
  });

  it('drops a same-rank set whose members are joined by a path', () => {
    const parsed = parseBoxesAndLines(
      'boxes-and-lines\nA -> B\nB -> C\nsame-rank A, C\n'
    );
    expect(parsed.sameRank).toBeUndefined();
    expect(
      parsed.diagnostics.some((d) =>
        d.message.includes("a line runs from 'A' to 'C'")
      )
    ).toBe(true);
  });
});

describe('boxes-and-lines rank hints — layout', () => {
  it('same-rank puts DB and Queue on one row, which they are not on without it', async () => {
    const hinted = await positions(SAME_RANK);
    expect(hinted.get('DB')!.y).toBe(hinted.get('Queue')!.y);
    const plain = await positions(withoutHints(SAME_RANK));
    expect(plain.get('DB')!.y).not.toBe(plain.get('Queue')!.y);
  });

  it('same-rank in LR puts the boxes in one column, across groups', async () => {
    const src = [
      'boxes-and-lines',
      '[Edge]',
      '  LB',
      '  WAF',
      '[Core]',
      '  [Svc]',
      '    API',
      '    Auth',
      '  DB',
      'User -> LB',
      'LB -> WAF',
      'WAF -> API',
      'API -> Auth',
      'Auth -> DB',
      'User -> Metrics',
      'same-rank Metrics, DB',
    ].join('\n');
    const hinted = await positions(src);
    expect(hinted.get('Metrics')!.x).toBe(hinted.get('DB')!.x);
    const plain = await positions(withoutHints(src));
    expect(plain.get('Metrics')!.x).not.toBe(plain.get('DB')!.x);
  });

  it('order puts Web left of Mobile, which it is not without it', async () => {
    const hinted = await positions(ORDER);
    expect(hinted.get('Web')!.y).toBe(hinted.get('Mobile')!.y);
    expect(hinted.get('Web')!.x).toBeLessThan(hinted.get('Mobile')!.x);
    const plain = await positions(withoutHints(ORDER));
    expect(plain.get('Web')!.x).toBeGreaterThan(plain.get('Mobile')!.x);
  });

  it('same-rank and order together pin both the row and the order', async () => {
    const src = `${withoutHints(SAME_RANK)}\nsame-rank API, Cache\norder API, Cache\n`;
    const hinted = await positions(src);
    expect(hinted.get('API')!.y).toBe(hinted.get('Cache')!.y);
    expect(hinted.get('API')!.x).toBeLessThan(hinted.get('Cache')!.x);
  });
});
