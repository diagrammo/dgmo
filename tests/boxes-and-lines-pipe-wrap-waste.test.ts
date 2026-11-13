import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { collapseBoxesAndLines } from '../src/boxes-and-lines/collapse';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';

// #1974: the three faults that made a grouped boxes-and-lines diagram unusable.

describe('pipe in a box name (E_BL_PIPE_IN_NAME)', () => {
  const src = [
    'boxes-and-lines',
    'tag Status as s',
    '  doing yellow',
    '[MFEs]',
    '  AuthMFE s:doing',
    '    -> AuthMS | doing',
    '[Phoebe]',
    '  AuthMS | s:doing',
  ].join('\n');

  it('raises an error on the node line and on the edge target', () => {
    const p = parseBoxesAndLines(src);
    const lines = p.diagnostics
      .filter((d) => d.code === 'E_BL_PIPE_IN_NAME')
      .map((d) => d.line);
    expect(lines).toEqual([6, 8]);
    expect(
      p.diagnostics.find((d) => d.code === 'E_BL_PIPE_IN_NAME')!.severity
    ).toBe('error');
  });

  it('recovers by cutting at the pipe, so both mentions meet at one box', () => {
    const p = parseBoxesAndLines(src);
    expect(p.nodes.map((n) => n.label).sort()).toEqual(['AuthMFE', 'AuthMS']);
    expect(p.nodes.find((n) => n.label === 'AuthMS')!.metadata['status']).toBe(
      'doing'
    );
  });

  it('leaves a quoted pipe alone', () => {
    const p = parseBoxesAndLines(
      ['boxes-and-lines', '"Order | Items"', '  -> "Cart | Lines"'].join('\n')
    );
    expect(p.diagnostics.some((d) => d.code === 'E_BL_PIPE_IN_NAME')).toBe(
      false
    );
    expect(p.nodes.map((n) => n.label).sort()).toEqual([
      'Cart | Lines',
      'Order | Items',
    ]);
  });
});

describe('edgeless group members wrap into a grid', () => {
  it('eight unconnected boxes take three rows, not one column', async () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const p = parseBoxesAndLines(
      ['boxes-and-lines', '[G]', ...names.map((n) => '  ' + n)].join('\n')
    );
    const lay = await layoutBoxesAndLines(p);
    const ys = new Set(lay.nodes.map((n) => Math.round(n.y)));
    const xs = new Set(lay.nodes.map((n) => Math.round(n.x)));
    expect(ys.size).toBe(3);
    expect(xs.size).toBe(3);
    const g = lay.groups[0]!;
    expect(g.width).toBeGreaterThan(g.height);
  });

  it('leaves three unconnected boxes as they were', async () => {
    const p = parseBoxesAndLines(
      ['boxes-and-lines', '[G]', '  A', '  B', '  C'].join('\n')
    );
    const lay = await layoutBoxesAndLines(p);
    expect(new Set(lay.nodes.map((n) => Math.round(n.x))).size).toBe(1);
  });
});

describe('stable collapse falls back when it wastes the canvas', () => {
  const src = ['boxes-and-lines', 'A', '  -> B', '[G]', '  B', '  C', 'E'].join(
    '\n'
  );

  async function collapsed(prev: Map<string, { x: number; y: number }>) {
    const parsed = parseBoxesAndLines(src);
    const cr = collapseBoxesAndLines(parsed, new Set(['G']));
    return layoutBoxesAndLines(
      cr.parsed,
      {
        collapsedChildCounts: cr.collapsedChildCounts,
        originalGroups: cr.originalGroups,
      },
      { previousPositions: prev, stableCollapse: true }
    );
  }

  it('keeps the frozen layout when it is compact', async () => {
    const prev = new Map([
      ['A', { x: 100, y: 150 }],
      ['B', { x: 300, y: 100 }],
      ['C', { x: 300, y: 200 }],
      ['E', { x: 100, y: 300 }],
    ]);
    const lay = await collapsed(prev);
    const at = (l: string) => lay.nodes.find((n) => n.label === l)!;
    expect(Math.round(at('E').y - at('A').y)).toBe(150);
  });

  it('lays out afresh when a frozen box strands far from the rest', async () => {
    const prev = new Map([
      ['A', { x: 100, y: 150 }],
      ['B', { x: 300, y: 100 }],
      ['C', { x: 300, y: 200 }],
      ['E', { x: 2000, y: 3000 }],
    ]);
    const lay = await collapsed(prev);
    const e = lay.nodes.find((n) => n.label === 'E')!;
    expect(e.y).toBeLessThan(1000);
    expect(lay.width * lay.height).toBeLessThan(600 * 600);
  });
});
