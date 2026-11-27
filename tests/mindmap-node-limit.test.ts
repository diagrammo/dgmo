import { describe, it, expect } from 'vitest';
import { parseMindmap } from '../src/mindmap/parser';
import { MAX_MINDMAP_NODES } from '../src/mindmap/limits';
import type { MindmapNode } from '../src/mindmap/types';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

/**
 * A titled mindmap of `n` nodes (the title root counts), five branches deep
 * by fan-out like the 3,900-node pressure file (#2454). Returns the source
 * and the 1-based line of each node in source order.
 */
function mindmapWith(n: number): { src: string; lines: number[] } {
  const out = ['mindmap Pressure', ''];
  const lines = [1];
  let made = 1;
  const grow = (depth: number) => {
    for (let i = 0; i < 5 && made < n; i++) {
      out.push(`${'  '.repeat(depth)}Node ${made}`);
      made++;
      lines.push(out.length);
      if (depth < 4) grow(depth + 1);
    }
  };
  while (made < n) grow(0);
  return { src: out.join('\n'), lines };
}

const count = (nodes: readonly MindmapNode[]): number =>
  nodes.reduce((sum, n) => sum + 1 + count(n.children), 0);

const tooMany = (src: string) =>
  parseMindmap(src, palette).diagnostics.filter(
    (d) => d.code === 'E_MINDMAP_TOO_MANY_NODES'
  );

describe('mindmap node limit (#2454)', () => {
  it('draws exactly MAX_MINDMAP_NODES nodes with no diagnostic', () => {
    const { src } = mindmapWith(MAX_MINDMAP_NODES);
    const parsed = parseMindmap(src, palette);
    expect(count(parsed.roots)).toBe(MAX_MINDMAP_NODES);
    expect(tooMany(src)).toHaveLength(0);
    expect(parsed.error).toBeNull();
  });

  it('one node over: keeps the limit, one error on the first node left out', () => {
    const { src, lines } = mindmapWith(MAX_MINDMAP_NODES + 1);
    const parsed = parseMindmap(src, palette);
    expect(count(parsed.roots)).toBe(MAX_MINDMAP_NODES);
    const errs = tooMany(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.severity).toBe('error');
    expect(errs[0]!.line).toBe(lines[MAX_MINDMAP_NODES]);
    expect(errs[0]!.message).toContain(`${MAX_MINDMAP_NODES + 1} nodes`);
    expect(errs[0]!.message).toContain(`first ${MAX_MINDMAP_NODES}`);
    expect(errs[0]!.message).toMatch(/collapse branches/i);
    expect(errs[0]!.message).toMatch(/split the map/i);
  });

  it('the pressure size keeps the limit and names the full count', () => {
    const { src } = mindmapWith(3900);
    const parsed = parseMindmap(src, palette);
    expect(count(parsed.roots)).toBe(MAX_MINDMAP_NODES);
    const errs = tooMany(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain('3900 nodes');
  });

  it('a description under a node left out lands on no kept node', () => {
    const { src } = mindmapWith(MAX_MINDMAP_NODES);
    const parsed = parseMindmap(
      `${src}\nLate\n  description: not drawn\n`,
      palette
    );
    const descs: string[] = [];
    const walk = (ns: readonly MindmapNode[]) => {
      for (const n of ns) {
        descs.push(...(n.description ?? []));
        walk(n.children);
      }
    };
    walk(parsed.roots);
    expect(descs).not.toContain('not drawn');
    expect(
      tooMany(`${src}\nLate\n  description: not drawn\n`)[0]!.message
    ).toContain(`${MAX_MINDMAP_NODES + 1} nodes`);
  });
});
