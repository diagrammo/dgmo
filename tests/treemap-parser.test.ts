import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseTreemap } from '../src/treemap/parser';
import { layoutTreemap, sumValue } from '../src/treemap/layout';
import { layoutTreemapRadial } from '../src/treemap/layout-radial';
import type { RadialCell } from '../src/treemap/layout-radial';
import { renderTreemapRadial } from '../src/treemap/renderer-radial';
import {
  activeTagGroupOf,
  buildHeatScale,
  buildLegend,
  depthTint,
  resolveColorMode,
} from '../src/treemap/treemap-shared';
import { getPalette } from '../src/palettes';
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

  it('parses canonical no-value (decision #48; plural no-values stays legacy)', () => {
    const canonical = parseTreemap('treemap T\nno-value\n\nA\n  X 1');
    expect(canonical.options.noValues).toBe(true);
    const legacy = parseTreemap('treemap T\nno-values\n\nA\n  X 1');
    expect(legacy.options.noValues).toBe(true);
    // Neither spelling leaks into the tree as a node.
    expect(canonical.roots.map((n) => n.label)).toEqual(['A']);
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

describe('parseTreemap — resting-dimension precedence + active-tag (decision #48)', () => {
  const TAGS = 'tag Team as t\n  Eng blue\n  Sales green';
  const BODY =
    'Engineering t: Eng\n  Platform 320 heat: 2\n  Mobile 180 heat: -1';

  it('heat beats tags at rest — the #48 FLIP from the old tag-first order', () => {
    // Pre-#48 this resolved to 'tag' (tag → heat → branch). Decision #48
    // flips treemap to the universal heat → tag → branch precedence
    // (map §24B.4 / b&l §13.9 parity), so heat wins when both are present.
    const r = parseTreemap(`treemap T\n\n${TAGS}\n\n${BODY}`);
    expect(r.tagGroups).toHaveLength(1);
    expect(r.hasHeat).toBe(true);
    expect(r.defaultColorMode).toBe('heat');
  });

  it('tag only → tag; neither → branch (unchanged tails of the chain)', () => {
    const tagOnly = parseTreemap(
      `treemap T\n\n${TAGS}\n\nEngineering t: Eng\n  Platform 320`
    );
    expect(tagOnly.defaultColorMode).toBe('tag');
    expect(parseTreemap('treemap T\nA\n  X 1').defaultColorMode).toBe('branch');
  });

  it('active-tag <group> forces the tag view over resting heat', () => {
    const r = parseTreemap(`treemap T\nactive-tag Team\n\n${TAGS}\n\n${BODY}`);
    expect(r.activeTag).toBe('Team');
    expect(r.defaultColorMode).toBe('tag');
    // Case-insensitive group matching.
    const rLower = parseTreemap(
      `treemap T\nactive-tag team\n\n${TAGS}\n\n${BODY}`
    );
    expect(rLower.defaultColorMode).toBe('tag');
  });

  it('active-tag <heat label> re-selects the ramp', () => {
    const r = parseTreemap(
      `treemap T\nheat Risk\nactive-tag Risk\n\n${TAGS}\n\n${BODY}`
    );
    expect(r.defaultColorMode).toBe('heat');
  });

  it('an unnamed ramp answers to `Value` (its legend name)', () => {
    const r = parseTreemap(`treemap T\nactive-tag Value\n\n${TAGS}\n\n${BODY}`);
    expect(r.defaultColorMode).toBe('heat');
  });

  it('active-tag none forces branch mode (§24C.6)', () => {
    const r = parseTreemap(`treemap T\nactive-tag none\n\n${TAGS}\n\n${BODY}`);
    expect(r.defaultColorMode).toBe('branch');
    expect(codes(r)).toEqual([]);
  });

  it('unknown active-tag warns and falls back to the default resolution', () => {
    const r = parseTreemap(`treemap T\nactive-tag Nope\n\n${TAGS}\n\n${BODY}`);
    expect(r.defaultColorMode).toBe('heat');
    expect(
      r.diagnostics.some(
        (d) => d.severity === 'warning' && /active-tag "Nope"/.test(d.message)
      )
    ).toBe(true);
  });

  it('does not create a phantom "active-tag" node', () => {
    const r = parseTreemap('treemap T\nactive-tag none\n\nA\n  X 1');
    expect(r.roots.map((n) => n.label)).toEqual(['A']);
  });

  it('active-tag selects a non-first tag group for fill + legend', () => {
    const r = parseTreemap(
      'treemap T\nactive-tag Stage\n\ntag Team as t\n  Eng blue\n\ntag Stage as s\n  Beta orange\n\nA t: Eng, s: Beta\n  X 1'
    );
    expect(r.defaultColorMode).toBe('tag');
    expect(activeTagGroupOf(r)?.name).toBe('Stage');
    const legend = buildLegend('tag', r, null, ['#111111'], 0);
    expect(legend.activeGroup).toBe('Stage');
  });

  it('runtime switcher override still wins over the directive', () => {
    const r = parseTreemap(`treemap T\nactive-tag Team\n\n${TAGS}\n\n${BODY}`);
    expect(resolveColorMode(r, 'heat')).toBe('heat');
    expect(resolveColorMode(r, 'branch')).toBe('branch');
    expect(resolveColorMode(r)).toBe('tag');
  });

  it('inapplicable modes fall back along heat → tag → branch (#48)', () => {
    // heat requested but no heat data → tag when groups exist…
    const tagOnly = parseTreemap(
      `treemap T\n\n${TAGS}\n\nEngineering t: Eng\n  Platform 320`
    );
    expect(resolveColorMode(tagOnly, 'heat')).toBe('tag');
    // …else branch.
    const bare = parseTreemap('treemap T\nA\n  X 1');
    expect(resolveColorMode(bare, 'heat')).toBe('branch');
    expect(resolveColorMode(bare, 'tag')).toBe('branch');
  });

  it('midpoint-at-0 diverging ramp is untouched by the flip (decision #14)', () => {
    const nordLight = getPalette('nord').light;
    const r = parseTreemap(`treemap T\n\n${TAGS}\n\n${BODY}`);
    const heat = buildHeatScale(r, nordLight)!;
    expect(heat.signed).toBe(true);
    // Diverging red · neutral · green with the midpoint pinned at 0.
    expect(heat.stops).toEqual([
      nordLight.colors.red,
      nordLight.surface,
      nordLight.colors.green,
    ]);
    expect(heat.scale(0).toLowerCase()).toBe(nordLight.surface.toLowerCase());
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

describe('layoutTreemap — heat aggregation', () => {
  it('container heat is the mean of descendant leaf heats', () => {
    const r = parseTreemap(
      'treemap T\nheat Risk\n\nGroup\n  A 10 heat: 2\n  B 20 heat: 4\n  Sub\n    C 5 heat: 6\nD 40'
    );
    const { cells } = layoutTreemap(r.roots, {
      width: 600,
      height: 400,
      headerH: 18,
    });
    // Group aggregates every descendant leaf heat (A, B, and Sub's C).
    expect(cells.find((c) => c.label === 'Group')!.heat).toBe((2 + 4 + 6) / 3);
    // Nested container aggregates its own leaves only.
    expect(cells.find((c) => c.label === 'Sub')!.heat).toBe(6);
    // Leaves keep their explicit heat.
    expect(cells.find((c) => c.label === 'A')!.heat).toBe(2);
    expect(cells.find((c) => c.label === 'B')!.heat).toBe(4);
    // A heat-less leaf stays undefined.
    expect(cells.find((c) => c.label === 'D')!.heat).toBeUndefined();
  });

  it('explicit heat on a branch wins over the leaf mean; heat-less subtrees stay undefined', () => {
    const leaf = (
      label: string,
      value: number,
      heat?: number
    ): TreemapNode => ({
      id: label,
      label,
      value,
      ...(heat !== undefined && { heat }),
      metadata: {},
      children: [],
      lineNumber: 1,
    });
    const branch = (
      label: string,
      children: TreemapNode[],
      heat?: number
    ): TreemapNode => ({
      id: label,
      label,
      ...(heat !== undefined && { heat }),
      metadata: {},
      children,
      lineNumber: 1,
    });
    const roots = [
      branch('P', [leaf('X', 10, 1), leaf('Y', 20, 3)], 9),
      branch('Q', [leaf('Z', 5)]),
    ];
    const { cells } = layoutTreemap(roots, {
      width: 600,
      height: 400,
      headerH: 18,
    });
    // Explicit branch heat overrides the descendant mean (which would be 2).
    expect(cells.find((c) => c.label === 'P')!.heat).toBe(9);
    // No heated leaves anywhere under Q → undefined, not NaN or 0.
    expect(cells.find((c) => c.label === 'Q')!.heat).toBeUndefined();
    expect(cells.find((c) => c.label === 'Z')!.heat).toBeUndefined();
  });
});

// ============================================================
// Radial (sunburst) mode
// ============================================================

describe('parseTreemap — radial directive (AC1)', () => {
  it('parses the bare `radial` flag into options', () => {
    const r = parseTreemap('treemap T\nradial\n\nA\n  X 1\n  Y 2');
    expect(r.error).toBeNull();
    expect(r.options.radial).toBe(true);
    // Other directives still parse unchanged alongside it.
    expect(r.roots.map((n) => n.label)).toEqual(['A']);
  });

  it('defaults radial to false when the flag is absent', () => {
    const r = parseTreemap('treemap T\nA\n  X 1');
    expect(r.options.radial).toBe(false);
  });

  it('does not create a phantom "radial" node', () => {
    const r = parseTreemap('treemap T\nradial\n\nA\n  X 1');
    expect(findNode(r.roots, 'radial')).toBeUndefined();
  });
});

describe('layoutTreemapRadial — geometry (AC2/AC3)', () => {
  const find = (cells: readonly RadialCell[], label: string): RadialCell =>
    cells.find((c) => c.label === label)!;

  it('arc sweep equals value / root proportion × 2π', () => {
    const r = parseTreemap('treemap T\nA\n  X 300\n  Y 100');
    const { cells, total } = layoutTreemapRadial(r.roots, { radius: 200 });
    expect(total).toBe(400);
    const x = find(cells, 'X');
    const sweepX = x.endAngle - x.startAngle;
    // X = 300/400 of the whole → 3/4 of 2π.
    expect(sweepX).toBeCloseTo((300 / 400) * 2 * Math.PI, 6);
  });

  it('nests each child arc within its parent wedge', () => {
    const r = parseTreemap('treemap T\nA\n  X 300\n  Y 100');
    const { cells } = layoutTreemapRadial(r.roots, { radius: 200 });
    const a = find(cells, 'A');
    const x = find(cells, 'X');
    const y = find(cells, 'Y');
    expect(x.startAngle).toBeGreaterThanOrEqual(a.startAngle - 1e-9);
    expect(x.endAngle).toBeLessThanOrEqual(a.endAngle + 1e-9);
    expect(y.startAngle).toBeGreaterThanOrEqual(a.startAngle - 1e-9);
    expect(y.endAngle).toBeLessThanOrEqual(a.endAngle + 1e-9);
    // Child rings sit further out than their parent.
    expect(x.innerR).toBeGreaterThanOrEqual(a.outerR - 1e-9);
  });

  it('preserves SOURCE order — does NOT value-sort (F2 regression guard)', () => {
    // Smaller value FIRST in source; a value-sort would put Big at angle 0.
    const r = parseTreemap('treemap T\nSmall 100\nBig 300');
    const { cells } = layoutTreemapRadial(r.roots, { radius: 200 });
    const small = find(cells, 'Small');
    const big = find(cells, 'Big');
    // Source order: Small starts at 12 o'clock (0), Big follows.
    expect(small.startAngle).toBeCloseTo(0, 6);
    expect(small.startAngle).toBeLessThan(big.startAngle);
  });

  it('multi-root: all top-level nodes land on ring 1 (F1/AC3)', () => {
    const r = parseTreemap('treemap Total\nA 100\nB 200\nC 300');
    const { cells, total } = layoutTreemapRadial(r.roots, { radius: 200 });
    expect(total).toBe(600);
    const ring1 = cells.filter((c) => c.depth === 1).map((c) => c.label);
    expect(ring1).toEqual(['A', 'B', 'C']);
    // No cell IS the synthetic root — the disc is drawn separately.
    expect(cells.some((c) => c.label === '__root')).toBe(false);
  });

  it('all-zero grand total → empty-state, no NaN arcs (F5/AC9)', () => {
    const r = parseTreemap('treemap T\nA\n  X 0\n  Y 0');
    const res = layoutTreemapRadial(r.roots, { radius: 200 });
    expect(res.isEmpty).toBe(true);
    expect(res.total).toBe(0);
    expect(res.cells).toHaveLength(0);
    expect(Number.isNaN(res.discRadius)).toBe(false);
  });

  it('flat (single-level) radial produces a labeled donut, no crash (AC13)', () => {
    const r = parseTreemap('treemap T\nradial\n\nA 1\nB 2\nC 3');
    const { cells } = layoutTreemapRadial(r.roots, { radius: 200 });
    expect(cells).toHaveLength(3);
    expect(cells.every((c) => c.depth === 1)).toBe(true);
    // Inner radius > 0 → a donut (the center disc hole).
    expect(cells.every((c) => c.innerR > 0)).toBe(true);
  });
});

describe('treemap diagnostics — mode-neutral wording (AC11)', () => {
  it('negative-leaf / valueless-leaf / branch-value codes still fire with reworded messages', () => {
    const neg = parseTreemap('treemap T\nradial\n\nA\n  Bad -5');
    expect(codes(neg)).toContain('E_TREEMAP_NEGATIVE_VALUE');

    const lonely = parseTreemap('treemap T\nradial\n\nA\n  Lonely');
    const leafMsg = lonely.diagnostics.find(
      (d) => d.code === 'W_TREEMAP_LEAF_NO_VALUE'
    )!;
    expect(leafMsg.message).toContain('zero size');
    expect(leafMsg.message).not.toContain('area');

    const branch = parseTreemap('treemap T\nradial\n\nOps 999\n  Cloud 110');
    const branchMsg = branch.diagnostics.find(
      (d) => d.code === 'W_TREEMAP_BRANCH_VALUE_IGNORED'
    )!;
    expect(branchMsg.message).toContain('the size is the auto-sum');
    expect(branchMsg.message).not.toContain('area');
  });
});

describe('depthTint — lightness floor (AC8)', () => {
  const bg = '#ffffff';
  const hue = getPalette('nord').light.primary;

  it('floors the tint so deep rings stay distinct (keepPct clamps at 55)', () => {
    // keepPct = max(55, 100-(depth-1)*18): depth 4 → 46 clamped to 55, and every
    // deeper level stays at 55 → identical fills (never washes toward the bg).
    expect(depthTint(hue, 4, bg)).toBe(depthTint(hue, 20, bg));
    // Shallow depths are still distinct (ramp is live above the floor).
    expect(depthTint(hue, 1, bg)).not.toBe(depthTint(hue, 4, bg));
  });
});

describe('renderTreemapRadial — small-arc label dropout (AC7)', () => {
  beforeAll(() => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    const win = dom.window;
    for (const [k, value] of Object.entries({
      document: win.document,
      window: win,
      navigator: win.navigator,
      HTMLElement: win.HTMLElement,
      SVGElement: win.SVGElement,
    })) {
      Object.defineProperty(globalThis, k, { value, configurable: true });
    }
  });

  const nordLight = getPalette('nord').light;
  const mount = (w = 600, h = 600): HTMLDivElement => {
    const c = document.createElement('div');
    Object.defineProperty(c, 'clientWidth', { value: w });
    Object.defineProperty(c, 'clientHeight', { value: h });
    return c;
  };

  it('drops the inline label of an arc whose sweep is < 6°', () => {
    // Tiny = 5/1005 ≈ 0.5% → ~1.8° sweep (< 6°); Big ≈ 99.5% → labeled.
    // no-legend so textContent reflects arc labels (+ disc), not the legend list.
    const r = parseTreemap('treemap T\nradial\nno-legend\n\nBig 1000\nTiny 5');
    const c = mount();
    renderTreemapRadial(c, r, nordLight, false);
    const text = c.textContent ?? '';
    expect(text).toContain('Big');
    expect(text).not.toContain('Tiny');
  });
});
