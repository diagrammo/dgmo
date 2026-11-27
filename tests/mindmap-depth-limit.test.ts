import { describe, it, expect } from 'vitest';
import { parseMindmap } from '../src/mindmap/parser';
import { MAX_MINDMAP_DEPTH } from '../src/mindmap/limits';
import type { MindmapNode } from '../src/mindmap/types';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;

/**
 * A chain of `levels` nodes, one per level, the title root as level 1, like
 * the 60-deep pressure file (#2455). Level k sits on line k + 1 (k >= 2).
 */
function chain(levels: number, tail = ''): string {
  const out = ['mindmap Level 1', ''];
  for (let k = 2; k <= levels; k++) out.push(`${'  '.repeat(k - 2)}Level ${k}`);
  return out.join('\n') + tail;
}

const depthOf = (nodes: readonly MindmapNode[]): number =>
  nodes.length === 0
    ? 0
    : 1 + Math.max(...nodes.map((n) => depthOf(n.children)));

const tooDeep = (src: string) =>
  parseMindmap(src, palette).diagnostics.filter(
    (d) => d.code === 'E_MINDMAP_TOO_DEEP'
  );

describe('mindmap depth limit (#2455)', () => {
  it('a chain of exactly MAX_MINDMAP_DEPTH levels parses clean', () => {
    const parsed = parseMindmap(chain(MAX_MINDMAP_DEPTH), palette);
    expect(depthOf(parsed.roots)).toBe(MAX_MINDMAP_DEPTH);
    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.error).toBeNull();
  });

  it('one level over: one error on the first too-deep line, tree cut at the limit', () => {
    const src = chain(MAX_MINDMAP_DEPTH + 1);
    const parsed = parseMindmap(src, palette);
    expect(depthOf(parsed.roots)).toBe(MAX_MINDMAP_DEPTH);
    const errs = tooDeep(src);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.severity).toBe('error');
    expect(errs[0]!.line).toBe(MAX_MINDMAP_DEPTH + 2);
    expect(errs[0]!.message).toContain(`${MAX_MINDMAP_DEPTH} levels`);
    expect(errs[0]!.message).toMatch(/flatten the branch/i);
    expect(errs[0]!.message).toMatch(/split the map/i);
  });

  it('the 60-deep pressure chain draws down to the limit with one error', () => {
    const src = chain(60);
    const parsed = parseMindmap(src, palette);
    expect(depthOf(parsed.roots)).toBe(MAX_MINDMAP_DEPTH);
    expect(tooDeep(src)).toHaveLength(1);
  });

  it('drops the too-deep subtree and its descriptions, keeps later shallow nodes', () => {
    const src = chain(
      MAX_MINDMAP_DEPTH + 2,
      `\n${'  '.repeat(MAX_MINDMAP_DEPTH)}  description: not drawn\nSibling\n  Child\n`
    );
    const parsed = parseMindmap(src, palette);
    expect(depthOf(parsed.roots)).toBe(MAX_MINDMAP_DEPTH);
    const labels: string[] = [];
    const descs: string[] = [];
    const walk = (ns: readonly MindmapNode[]) => {
      for (const n of ns) {
        labels.push(n.label);
        descs.push(...(n.description ?? []));
        walk(n.children);
      }
    };
    walk(parsed.roots);
    expect(labels).toContain('Sibling');
    expect(labels).toContain('Child');
    expect(labels).not.toContain(`Level ${MAX_MINDMAP_DEPTH + 1}`);
    expect(descs).not.toContain('not drawn');
    expect(tooDeep(src)).toHaveLength(1);
  });

  it('counts the first line as level 1 in an untitled map too', () => {
    const lines = Array.from(
      { length: MAX_MINDMAP_DEPTH + 1 },
      (_, i) => `${'  '.repeat(i)}Level ${i + 1}`
    );
    const src = `mindmap\n\n${lines.join('\n')}`;
    const parsed = parseMindmap(src, palette);
    expect(depthOf(parsed.roots)).toBe(MAX_MINDMAP_DEPTH);
    expect(tooDeep(src)[0]!.line).toBe(MAX_MINDMAP_DEPTH + 3);
  });
});
