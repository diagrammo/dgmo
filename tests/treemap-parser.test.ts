import { describe, it, expect } from 'vitest';
import { parseTreemap } from '../src/treemap/parser';
import { layoutTreemap, sumValue } from '../src/treemap/layout';
import type { TreemapNode } from '../src/treemap/types';

function codes(r: ReturnType<typeof parseTreemap>): string[] {
  return r.diagnostics.map((d) => d.code ?? '').filter(Boolean);
}
function findNode(
  nodes: readonly TreemapNode[],
  label: string
): TreemapNode | undefined {
  for (const n of nodes) {
    if (n.label === label) return n;
    const found = findNode(n.children, label);
    if (found) return found;
  }
  return undefined;
}

describe('parseTreemap — declaration & hierarchy', () => {
  it('parses the title and a nested hierarchy', () => {
    const r = parseTreemap(
      'treemap Q3 Budget\n\nEngineering\n  Platform 320\n  Mobile 180'
    );
    expect(r.error).toBeNull();
    expect(r.title).toBe('Q3 Budget');
    expect(r.roots).toHaveLength(1);
    expect(r.roots[0]!.label).toBe('Engineering');
    expect(r.roots[0]!.children.map((c) => c.label)).toEqual([
      'Platform',
      'Mobile',
    ]);
  });

  it('rejects a wrong chart type', () => {
    const r = parseTreemap('pie A 1\nB 2');
    expect(r.error).not.toBeNull();
  });

  it('errors on empty content', () => {
    expect(parseTreemap('   ').error).not.toBeNull();
  });
});

describe('parseTreemap — value resolution & auto-sum (AC2)', () => {
  it('reads the trailing number as a leaf size', () => {
    const r = parseTreemap(
      'treemap T\nEngineering\n  Platform 320\n  Mobile 180'
    );
    const platform = findNode(r.roots, 'Platform')!;
    expect(platform.value).toBe(320);
  });

  it('auto-sums a branch and ignores its trailing number (AC2b)', () => {
    const r = parseTreemap(
      'treemap T\nOperations 999\n  Cloud 110\n  Support 70'
    );
    const ops = findNode(r.roots, 'Operations')!;
    expect(ops.value).toBeUndefined();
    expect(codes(r)).toContain('W_TREEMAP_BRANCH_VALUE_IGNORED');
    expect(sumValue(ops)).toBe(180);
  });

  it('supports underscore digit separators', () => {
    const r = parseTreemap('treemap T\nA\n  X 1_000');
    expect(findNode(r.roots, 'X')!.value).toBe(1000);
  });
});

describe('parseTreemap — value disambiguation (AC2b)', () => {
  it('unquoted trailing digit becomes the value', () => {
    const r = parseTreemap('treemap T\nA\n  Region 5');
    const node = findNode(r.roots, 'Region')!;
    expect(node.label).toBe('Region');
    expect(node.value).toBe(5);
  });

  it('quoted label preserves a trailing digit and has no value', () => {
    const r = parseTreemap('treemap T\nA\n  "Region 5"');
    const node = findNode(r.roots, 'Region 5')!;
    expect(node).toBeDefined();
    expect(node.value).toBe(0);
    expect(codes(r)).toContain('W_TREEMAP_LEAF_NO_VALUE');
  });

  it('a quoted label can still carry a trailing value (quotes stripped)', () => {
    const r = parseTreemap('treemap T\nA\n  "Region 5" 100');
    const node = findNode(r.roots, 'Region 5')!;
    expect(node).toBeDefined();
    expect(node.value).toBe(100);
  });

  it('a value-less leaf warns and renders zero area', () => {
    const r = parseTreemap('treemap T\nA\n  Lonely');
    expect(findNode(r.roots, 'Lonely')!.value).toBe(0);
    expect(codes(r)).toContain('W_TREEMAP_LEAF_NO_VALUE');
  });

  it('a negative leaf value errors', () => {
    const r = parseTreemap('treemap T\nA\n  Bad -5');
    expect(codes(r)).toContain('E_TREEMAP_NEGATIVE_VALUE');
  });
});

describe('parseTreemap — tags (AC3)', () => {
  it('applies a declared tag and lists it in the group', () => {
    const r = parseTreemap(
      'treemap T\n\ntag Team as t\n  Eng blue\n  Sales green\n\nEngineering t: Eng\n  Platform 320'
    );
    expect(r.tagGroups).toHaveLength(1);
    expect(r.defaultColorMode).toBe('tag');
    const eng = findNode(r.roots, 'Engineering')!;
    expect(eng.metadata['team']).toBe('Eng');
    // Cascade: child inherits the tag.
    expect(findNode(r.roots, 'Platform')!.metadata['team']).toBe('Eng');
  });

  it('errors when a tag is declared after content', () => {
    const r = parseTreemap(
      'treemap T\nEngineering\n  Platform 320\n\ntag Team as t\n  Eng blue'
    );
    expect(codes(r)).toContain('E_TAG_DECLARED_AFTER_CONTENT');
  });
});

describe('parseTreemap — heat (AC4/5)', () => {
  it('parses a per-node heat metric and the heat directive', () => {
    const r = parseTreemap(
      'treemap T\nheat Day change %\n\nAAPL 180 heat: -2.4\nNVDA 220 heat: 4.1'
    );
    expect(r.hasHeat).toBe(true);
    expect(r.defaultColorMode).toBe('heat');
    expect(r.options.heatLabel).toBe('Day change %');
    expect(findNode(r.roots, 'AAPL')!.heat).toBe(-2.4);
    expect(findNode(r.roots, 'NVDA')!.heat).toBe(4.1);
  });

  it('peels explicit ramp colors from the heat directive (AC6)', () => {
    const r = parseTreemap('treemap T\nheat Risk red green\n\nA 1 heat: 2');
    expect(r.options.heatColors).toEqual(['red', 'green']);
    expect(r.options.heatLabel).toBe('Risk');
  });

  it('one explicit color peels as a single token (AC6)', () => {
    const r = parseTreemap('treemap T\nheat Risk red\n\nA 1 heat: 2');
    expect(r.options.heatColors).toEqual(['red']);
  });
});

describe('parseTreemap — directives & defaults (AC9)', () => {
  it('parses depth and no-* opt-outs', () => {
    const r = parseTreemap(
      'treemap T\ndepth 2\nno-percent\nno-legend\n\nA\n  X 1'
    );
    expect(r.options.maxDepth).toBe(2);
    expect(r.options.noPercent).toBe(true);
    expect(r.options.noLegend).toBe(true);
    expect(r.options.noValues).toBe(false);
  });

  it('warns and ignores the removed "other-below" directive', () => {
    const r = parseTreemap('treemap T\nother-below 3\n\nA\n  X 1');
    // No junk node was created from the directive line.
    expect(r.roots.map((n) => n.label)).toEqual(['A']);
    expect(r.diagnostics.some((d) => /other-below/.test(d.message))).toBe(true);
  });

  it('defaults to branch color mode with no tags or heat', () => {
    const r = parseTreemap('treemap T\nA\n  X 1\n  Y 2');
    expect(r.defaultColorMode).toBe('branch');
  });
});

describe('layoutTreemap — geometry & depth (AC2c)', () => {
  it('produces proportional areas that sum to the rectangle', () => {
    const r = parseTreemap('treemap T\nA\n  X 300\n  Y 100');
    const { cells, total } = layoutTreemap(r.roots, {
      width: 400,
      height: 300,
      headerH: 18,
    });
    expect(total).toBe(400);
    const x = cells.find((c) => c.label === 'X')!;
    const y = cells.find((c) => c.label === 'Y')!;
    const areaX = (x.x1 - x.x0) * (x.y1 - x.y0);
    const areaY = (y.x1 - y.x0) * (y.y1 - y.y0);
    // X is 3× Y in value → roughly 3× in area.
    expect(areaX / areaY).toBeGreaterThan(2.3);
  });

  it('renders every small child as its own cell (no rollup)', () => {
    const r = parseTreemap(
      'treemap T\nGames\n  Puzzle 4200\n  Strategy 3100\n  Trivia 90\n  Word 60'
    );
    const { cells } = layoutTreemap(r.roots, {
      width: 600,
      height: 400,
      headerH: 18,
    });
    const labels = cells.map((c) => c.label);
    expect(labels).toContain('Trivia');
    expect(labels).toContain('Word');
    expect(labels).not.toContain('Other');
  });

  it('depth cap collapses deeper branches into solid blocks (AC7)', () => {
    const r = parseTreemap(
      'treemap T\nRepo\n  src\n    a 10\n    b 20\n  dist 30'
    );
    const { cells } = layoutTreemap(r.roots, {
      width: 600,
      height: 400,
      headerH: 18,
      maxDepth: 2,
    });
    const src = cells.find((c) => c.label === 'src')!;
    expect(src.isCollapsed).toBe(true);
    // Collapsed node keeps its full summed value; descendants are not drawn.
    expect(src.value).toBe(30);
    expect(cells.some((c) => c.label === 'a')).toBe(false);
  });
});
