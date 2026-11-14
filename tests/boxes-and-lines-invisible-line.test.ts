// Invisible lines (#2002): `A ~~ B` ranks B after A, as a drawn line would,
// but nothing routes, scores or draws it. The fixture is checked twice: with
// its `~~` line, and with that line removed, so the test proves the invisible
// line is what moved the layout.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { getPalette } from '../src/palettes';

const FIXTURE = readFileSync(
  join(__dirname, '../stress/boxes-and-lines/invisible-line--rank-after.dgmo'),
  'utf8'
);
const withoutInvisible = (src: string): string =>
  src
    .split('\n')
    .filter((l) => !l.includes('~~') || l.startsWith('//'))
    .join('\n');
const INVISIBLE_LINE =
  FIXTURE.split('\n').findIndex((l) => l === 'DB ~~ Docs') + 1;

async function positions(src: string) {
  const layout = await layoutBoxesAndLines(parseBoxesAndLines(src));
  return new Map(layout.nodes.map((n) => [n.label, { x: n.x, y: n.y }]));
}

const warnings = (src: string): string[] =>
  parseBoxesAndLines(src).diagnostics.map((d) => d.message);

describe('boxes-and-lines invisible line — parse', () => {
  it('reads A ~~ B as an invisible edge, never as a box or a line', () => {
    const parsed = parseBoxesAndLines(FIXTURE);
    expect(parsed.invisibleEdges).toEqual([{ source: 'DB', target: 'Docs' }]);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.edges).toHaveLength(3);
    expect(parsed.nodes.map((n) => n.label).some((l) => l.includes('~'))).toBe(
      false
    );
  });

  it('matches names case-insensitively and before the box is declared', () => {
    const parsed = parseBoxesAndLines(
      'boxes-and-lines\napi ~~ docs\nClient -> API\nClient -> Docs\n'
    );
    expect(parsed.invisibleEdges).toEqual([{ source: 'API', target: 'Docs' }]);
  });

  it('warns on a name that is no box, on a group, and on a self-loop', () => {
    const msgs = warnings(
      'boxes-and-lines\n[Edge]\n  LB\nA -> B\nA ~~ Nope\n[Edge] ~~ B\nA ~~ A\n'
    );
    expect(msgs.some((m) => m.includes("'Nope', which is not a box"))).toBe(
      true
    );
    expect(msgs.some((m) => m.includes('the group [Edge]'))).toBe(true);
    expect(msgs.some((m) => m.includes("joins 'A' to itself"))).toBe(true);
    expect(
      parseBoxesAndLines(
        'boxes-and-lines\n[Edge]\n  LB\nA -> B\nA ~~ Nope\n[Edge] ~~ B\nA ~~ A\n'
      ).invisibleEdges
    ).toBeUndefined();
  });

  it('stops a same-rank set its members are ranked apart by', () => {
    const parsed = parseBoxesAndLines(`${FIXTURE}\nsame-rank DB, Docs\n`);
    expect(parsed.sameRank).toBeUndefined();
    expect(
      parsed.diagnostics.some((d) =>
        d.message.includes("a line runs from 'DB' to 'Docs'")
      )
    ).toBe(true);
  });
});

describe('boxes-and-lines invisible line — layout', () => {
  it('DB ~~ Docs moves Docs to the rank after DB, which it is not on without it', async () => {
    const hinted = await positions(FIXTURE);
    expect(hinted.get('Docs')!.x).toBeGreaterThan(hinted.get('DB')!.x);
    const plain = await positions(withoutInvisible(FIXTURE));
    expect(plain.get('Docs')!.x).toBeLessThanOrEqual(plain.get('DB')!.x);
  });

  it('ranks along the flow even when it is the only connection', async () => {
    const hinted = await positions('boxes-and-lines\nA\nB\nA ~~ B\n');
    expect(hinted.get('B')!.x).toBeGreaterThan(hinted.get('A')!.x);
    expect(hinted.get('B')!.y).toBe(hinted.get('A')!.y);
  });
});

describe('boxes-and-lines invisible line — render', () => {
  it('draws no path for the invisible line', async () => {
    const parsed = parseBoxesAndLines(FIXTURE);
    const layout = await layoutBoxesAndLines(parsed);
    expect(layout.edges).toHaveLength(parsed.edges.length);
    const el = document.createElement('div');
    renderBoxesAndLines(el, parsed, layout, getPalette('nord').light, false, {
      exportDims: { width: 800, height: 600 },
    });
    const svg = el.querySelector('svg')!;
    expect(svg.querySelectorAll('g.bl-edge-group')).toHaveLength(
      parsed.edges.length
    );
    expect(
      svg.querySelectorAll(`[data-line-number="${INVISIBLE_LINE}"]`)
    ).toHaveLength(0);
  });
});
