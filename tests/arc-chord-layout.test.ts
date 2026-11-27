// arc-chord-layout.test.ts — `arc` + `layout chord` (#26, #29; ribbons #1856).
//
// The circular layout is reachable ONLY through the arc engine via a
// `layout chord` directive over the same pairwise edges; `chord` is not a
// chart-type keyword (#29). Since #1856 (owner's decision 2026-11-12) it draws
// ribbons: each node is an outer segment sized by its total flow (given +
// received), each link one ribbon flush on both segments, width = weight.

import { describe, it, expect } from 'vitest';
import { renderForExport } from '../src/d3';
import { render } from '../src/render';
import { parseDgmoChartType, getRenderCategory } from '../src/dgmo-router';
import { getPalette } from '../src/palettes';
import { themeBaseBg, mix } from '../src/palettes/color-utils';
import { parseArc } from '../src/arc/parser';
import { orderArcNodes } from '../src/arc/renderer';
import { layoutChord, placeChordLabels } from '../src/arc/chord';
import { measureText } from '../src/utils/text-measure';

/** Distinct rounded circle-cy values: 1 ⇒ nodes share a baseline (arc/linear). */
function distinctNodeRows(svg: string): number {
  const cys = [...svg.matchAll(/<circle[^>]*cy="([\d.]+)"/g)].map((m) =>
    Math.round(parseFloat(m[1]!))
  );
  return new Set(cys).size;
}

/** Every element carrying `class="<cls>"`, as its open tag. */
function tags(svg: string, cls: string): string[] {
  return [
    ...svg.matchAll(new RegExp(`<[a-z]+[^>]*class="${cls}"[^>]*>`, 'g')),
  ].map((m) => m[0]);
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

const EDGES = 'A -> B 5\nB -> C 4\nC -> A 3\n';
const TAU = Math.PI * 2;

describe('arc circular layout (#26 / #29)', () => {
  it('bare arc is linear', async () => {
    const arc = await renderForExport(`arc D\n${EDGES}`, 'light');
    expect(distinctNodeRows(arc)).toBe(1);
  });

  it('`chord` is not a chart-type keyword (#29)', () => {
    expect(parseDgmoChartType(`chord D\n${EDGES}`)).not.toBe('chord');
    expect(getRenderCategory('chord')).toBeNull();
  });
});

describe('`layout chord` draws ribbons (#1856)', () => {
  it('one ribbon per link and one segment per node; no hairline dots', async () => {
    const svg = await renderForExport(`arc D\nlayout chord\n${EDGES}`, 'light');
    expect(tags(svg, 'arc-chord-ribbon')).toHaveLength(3);
    expect(tags(svg, 'arc-chord-segment')).toHaveLength(3);
    expect(svg).not.toMatch(/<circle/);
  });

  it('renders through the public render() entry with no diagnostics', async () => {
    const { svg, diagnostics } = await render(`arc D\nlayout chord\n${EDGES}`, {
      palette: 'slate',
    });
    expect(diagnostics).toEqual([]);
    expect(svg).not.toContain('sequence-diagram');
    expect(tags(svg, 'arc-chord-ribbon')).toHaveLength(3);
  });

  it('ribbons carry the AUTHORED line numbers', async () => {
    const svg = await renderForExport(
      `arc D\nlayout chord\n\nA -> B 5\nB -> C 4\n`,
      'light'
    );
    const lines = tags(svg, 'arc-chord-ribbon')
      .map((t) => attr(t, 'data-line-number'))
      .sort();
    expect(lines).toEqual(['4', '5']);
  });

  it('reciprocal links stay two ribbons', async () => {
    const svg = await renderForExport(
      'arc D\nlayout chord\nA -> B 5\nB -> A 2\n',
      'light'
    );
    const r = tags(svg, 'arc-chord-ribbon');
    expect(r).toHaveLength(2);
    expect(r.map((t) => attr(t, 'aria-label')).sort()).toEqual([
      'A → B 5',
      'B → A 2',
    ]);
  });

  it('larger ribbons draw first', async () => {
    const svg = await renderForExport(
      'arc D\nlayout chord\nA -> B 1\nB -> C 9\nC -> A 4\n',
      'light'
    );
    const values = tags(svg, 'arc-chord-ribbon').map((t) =>
      Number(attr(t, 'data-value'))
    );
    expect(values).toEqual([9, 4, 1]);
  });

  it('labels sit outside the ring with their total; `no-value` drops it', async () => {
    const svg = await renderForExport(
      'arc D\nlayout chord\nA -> B 5\nB -> C 4\n',
      'light'
    );
    // B gives 4 and receives 5.
    expect(svg).toMatch(/<tspan>B<\/tspan><tspan[^>]*> 9<\/tspan>/);
    const bare = await renderForExport(
      'arc D\nlayout chord\nno-value\nA -> B 5\nB -> C 4\n',
      'light'
    );
    expect(bare).toContain('<tspan>B</tspan>');
    expect(bare).not.toMatch(/<tspan[^>]*> 9<\/tspan>/);
  });

  it('the hover readout is empty at rest', async () => {
    const svg = await renderForExport(`arc D\nlayout chord\n${EDGES}`, 'light');
    expect(svg).toMatch(
      /class="arc-chord-readout"[^>]*><\/text>|class="arc-chord-readout"[^>]*\/>/
    );
  });

  it('keeps the chart frame', async () => {
    const svg = await renderForExport(
      'arc T\nlayout chord\nA -> B 3\nB -> C 2\nsubtitle Deck\n',
      'light'
    );
    expect(svg).toContain('chart-subtitle');
  });
});

describe('`layout` diagnostics (#1856)', () => {
  it('an unknown layout warns on its line, with a suggestion', () => {
    const p = parseArc('arc D\nlayout chrod\nA -> B 5\n');
    expect(p.layout).toBeUndefined();
    const d = p.diagnostics.find((x) => x.line === 2);
    expect(d?.severity).toBe('warning');
    expect(d?.message).toContain("Unknown layout 'chrod'");
    expect(d?.message).toContain('chord');
  });

  it('a known layout is silent', () => {
    expect(parseArc(`arc D\nlayout chord\n${EDGES}`).diagnostics).toEqual([]);
  });
});

describe('chord geometry (#1856)', () => {
  const links = parseArc(
    'arc D\nlayout chord\nA -> B 6\nB -> C 2\nC -> A 4\nA -> D 3\n'
  ).links;
  const nodes = ['A', 'B', 'C', 'D'];
  const lay = layoutChord(nodes, links);

  it('a segment is sized by its node’s total flow, given + received', () => {
    const span = (n: string) => {
      const s = lay.nodes.find((x) => x.name === n)!;
      return s.a1 - s.a0;
    };
    // A: 6 + 4 + 3 = 13; B: 6 + 2 = 8; C: 2 + 4 = 6; D (receive-only): 3.
    expect(lay.nodes.map((n) => n.total)).toEqual([13, 8, 6, 3]);
    expect(span('A') / span('D')).toBeCloseTo(13 / 3, 6);
    expect(span('B') / span('C')).toBeCloseTo(8 / 6, 6);
  });

  it('the segments and pads fill the circle once, in order, without overlap', () => {
    const totalSpan = lay.nodes.reduce((s, n) => s + (n.a1 - n.a0), 0);
    expect(totalSpan).toBeLessThan(TAU);
    expect(totalSpan).toBeGreaterThan(TAU * 0.8);
    for (let i = 1; i < lay.nodes.length; i++)
      expect(lay.nodes[i]!.a0).toBeGreaterThan(lay.nodes[i - 1]!.a1);
    expect(lay.nodes.at(-1)!.a1).toBeLessThanOrEqual(TAU);
  });

  it('a ribbon is its weight wide at BOTH ends, each end flush on its segment', () => {
    const seg = new Map(lay.nodes.map((n) => [n.name, n]));
    const k = (seg.get('A')!.a1 - seg.get('A')!.a0) / 13;
    for (const r of lay.ribbons) {
      expect(r.source.a1 - r.source.a0).toBeCloseTo(r.link.value * k, 9);
      expect(r.target.a1 - r.target.a0).toBeCloseTo(r.link.value * k, 9);
      const s = seg.get(r.link.source)!;
      const t = seg.get(r.link.target)!;
      expect(r.source.a0).toBeGreaterThanOrEqual(s.a0 - 1e-9);
      expect(r.source.a1).toBeLessThanOrEqual(s.a1 + 1e-9);
      expect(r.target.a0).toBeGreaterThanOrEqual(t.a0 - 1e-9);
      expect(r.target.a1).toBeLessThanOrEqual(t.a1 + 1e-9);
    }
  });

  it('the ends on a segment tile it exactly', () => {
    for (const n of lay.nodes) {
      const ends = lay.ribbons
        .flatMap((r) => [
          ...(r.link.source === n.name ? [r.source] : []),
          ...(r.link.target === n.name ? [r.target] : []),
        ])
        .sort((x, y) => x.a0 - y.a0);
      expect(ends[0]!.a0).toBeCloseTo(n.a0, 9);
      expect(ends.at(-1)!.a1).toBeCloseTo(n.a1, 9);
      for (let i = 1; i < ends.length; i++)
        expect(ends[i]!.a0).toBeCloseTo(ends[i - 1]!.a1, 9);
    }
  });
});

describe('chord colour (#1856)', () => {
  const palette = getPalette('slate').light;

  function ribbonFill(svg: string, label: string): string {
    const t = tags(svg, 'arc-chord-ribbon').find(
      (x) => attr(x, 'aria-label') === label
    )!;
    return attr(t, 'stroke')!;
  }
  function segmentStroke(svg: string, node: string): string {
    const g = new RegExp(
      `data-node="${node}"[^>]*>\\s*<path[^>]*class="arc-chord-segment"[^>]*>`
    ).exec(svg)![0];
    return attr(g.slice(g.indexOf('<path')), 'stroke')!;
  }

  it('a ribbon takes the colour of its larger node by total; a tie goes to the source', async () => {
    // Totals: A 5+1=6, B 5+2=7, C 2+1=3 → A→B is B's colour, B→C is B's.
    const svg = await renderForExport(
      'arc D\nlayout chord\nA -> B 5\nB -> C 2\nC -> A 1\n',
      'light',
      palette
    );
    expect(ribbonFill(svg, 'A → B 5')).toBe(segmentStroke(svg, 'B'));
    expect(ribbonFill(svg, 'B → C 2')).toBe(segmentStroke(svg, 'B'));
    expect(ribbonFill(svg, 'C → A 1')).toBe(segmentStroke(svg, 'A'));
    const tie = await renderForExport(
      'arc D\nlayout chord\nA -> B 5\n',
      'light',
      palette
    );
    expect(ribbonFill(tie, 'A → B 5')).toBe(segmentStroke(tie, 'A'));
  });

  it('an explicit link colour wins', async () => {
    const svg = await renderForExport(
      'arc D\nlayout chord\nA -> B red 5\nB -> C 2\n',
      'light',
      palette
    );
    expect(ribbonFill(svg, 'A → B 5')).toBe(palette.colors.red);
  });

  it('a node takes its group colour', async () => {
    const svg = await renderForExport(
      'arc D\nlayout chord\n[Crew] green\n  A -> B 5\nB -> C 2\n',
      'light',
      palette
    );
    expect(segmentStroke(svg, 'A')).toBe(palette.colors.green);
  });

  it('`order name` sets the ring order', async () => {
    const src = 'arc D\nlayout chord\norder name\nC -> A 2\nB -> A 1\n';
    const p = parseArc(src);
    expect(orderArcNodes(p.links, p.arcOrder, p.arcNodeGroups)).toEqual([
      'A',
      'B',
      'C',
    ]);
    const svg = await renderForExport(src, 'light', palette);
    const order = [
      ...svg.matchAll(/class="arc-node" data-node="([^"]+)"/g),
    ].map((m) => m[1]);
    expect(order).toEqual(['A', 'B', 'C']);
  });
});

describe('fill family through `layout chord` (§1.9)', () => {
  const palette = getPalette('slate').light;
  const bg = themeBaseBg(palette, false);

  function segments(svg: string): { fill: string; stroke: string }[] {
    return tags(svg, 'arc-chord-segment').map((t) => ({
      fill: attr(t, 'fill')!,
      stroke: attr(t, 'stroke')!,
    }));
  }

  it('default segments take the 25% tint', async () => {
    const svg = await renderForExport(
      `arc D\nlayout chord\n${EDGES}`,
      'light',
      palette
    );
    for (const s of segments(svg)) expect(s.fill).toBe(mix(s.stroke, bg, 25));
  });

  it('fill-solid segments take the raw colour', async () => {
    const svg = await renderForExport(
      `arc D\nlayout chord\nfill-solid\n${EDGES}`,
      'light',
      palette
    );
    for (const s of segments(svg)) expect(s.fill).toBe(s.stroke);
  });

  it('fill-outline hollows segments and ribbons', async () => {
    const svg = await renderForExport(
      `arc D\nlayout chord\nfill-outline\n${EDGES}`,
      'light',
      palette
    );
    for (const s of segments(svg)) {
      expect(s.fill).toBe(bg);
      expect(s.stroke).not.toBe(bg);
    }
    for (const r of tags(svg, 'arc-chord-ribbon'))
      expect(attr(r, 'fill-opacity')).toBe('0');
  });
});

describe('crowded chord labels (#2418)', () => {
  const EXTREME =
    'A -> B 100000\nB -> A 90000\nA -> C 1\nC -> D 1\nD -> E 2\nE -> many 1\nmany -> 11 1\n11 -> F 1\nF -> G 1\n';
  const W = 800;
  const H = 600;

  function place(edges: string, w = W, h = H) {
    const parsed = parseArc(`arc D\nlayout chord\n${edges}`);
    const layout = layoutChord(
      orderArcNodes(parsed.links, parsed.arcOrder, parsed.arcNodeGroups),
      parsed.links
    );
    return placeChordLabels(
      layout.nodes.map((nd) => ({
        a0: nd.a0,
        a1: nd.a1,
        width: measureText(`${nd.name} ${nd.total}`, 12),
      })),
      w,
      h
    );
  }

  it('near-zero neighbours never overlap, and stay inside the canvas', () => {
    for (const [w, h] of [
      [W, H],
      [400, 300],
      [1200, 900],
    ] as const) {
      const { labels } = place(EXTREME, w, h);
      for (let i = 0; i < labels.length; i++) {
        const a = labels[i]!.box;
        expect(a.x0).toBeGreaterThanOrEqual(-w / 2);
        expect(a.x1).toBeLessThanOrEqual(w / 2);
        expect(a.y0).toBeGreaterThanOrEqual(-h / 2);
        expect(a.y1).toBeLessThanOrEqual(h / 2);
        for (let j = i + 1; j < labels.length; j++) {
          const b = labels[j]!.box;
          const overlap =
            a.x0 < b.x1 - 0.01 &&
            b.x0 < a.x1 - 0.01 &&
            a.y0 < b.y1 - 0.01 &&
            b.y0 < a.y1 - 0.01;
          expect(overlap, `labels ${i} and ${j} overlap`).toBe(false);
        }
      }
    }
  });

  it('crowded labels get a leader; the uncrowded big ones do not', async () => {
    const { labels } = place(EXTREME);
    expect(labels.filter((l) => l.leader).length).toBeGreaterThan(1);
    expect(labels.slice(0, 2).every((l) => !l.leader)).toBe(true);
    const svg = await renderForExport(
      `arc D\nlayout chord\n${EXTREME}`,
      'light'
    );
    expect(tags(svg, 'arc-chord-leader').length).toBe(
      labels.filter((l) => l.leader).length
    );
  });

  it('even weights draw no leaders', async () => {
    expect(place(EDGES).labels.some((l) => l.leader)).toBe(false);
    const svg = await renderForExport(`arc D\nlayout chord\n${EDGES}`, 'light');
    expect(tags(svg, 'arc-chord-leader')).toHaveLength(0);
  });
});
