// sankey alluvial mode (#1858): a `period` line names the columns and each
// row is one full path with its count.
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseSankey } from '../src/data-chart-parser';
import { renderForExport } from '../src/d3';

const SOURCE = `sankey Customers by plan

period
  Q1
  Q2
  Q3

Free blue
Pro orange
Team green

Free -> Free -> Free 400
Free -> Free -> Pro 80
Free -> Pro -> Pro 120
Pro -> Pro -> Pro 200
Pro -> Free -> Free 40
Team -> Pro -> Pro 20
`;

const codes = (src: string) => parseSankey(src).diagnostics.map((d) => d.code);

describe('sankey alluvial mode — parse', () => {
  it('reads the period block, the declared categories and the paths', () => {
    const p = parseSankey(SOURCE);
    expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(p.links).toBeUndefined();
    expect(p.alluvial?.periods).toEqual(['Q1', 'Q2', 'Q3']);
    expect(p.alluvial?.categories).toEqual(['Free', 'Pro', 'Team']);
    expect(p.alluvial?.paths.map((x) => [x.steps.join('>'), x.value])).toEqual([
      ['Free>Free>Free', 400],
      ['Free>Free>Pro', 80],
      ['Free>Pro>Pro', 120],
      ['Pro>Pro>Pro', 200],
      ['Pro>Free>Free', 40],
      ['Team>Pro>Pro', 20],
    ]);
    expect(p.nodeColors?.Free).toBeDefined();
  });

  it('takes a one-line period and one-arrow paths for two periods', () => {
    const p = parseSankey(
      'sankey Plans\nperiod 2024 2025\nFree -> Pro 30\nPro -> Pro 50\n'
    );
    expect(p.alluvial?.periods).toEqual(['2024', '2025']);
    expect(p.alluvial?.paths).toHaveLength(2);
    expect(p.diagnostics).toEqual([]);
  });

  it('orders undeclared categories by first appearance', () => {
    const p = parseSankey(
      'sankey Plans\nperiod A B C\nTeam -> Pro -> Free 5\nFree -> Free -> Pro 3\n'
    );
    expect(p.alluvial?.categories).toEqual(['Team', 'Pro', 'Free']);
  });

  it('reports a path whose length differs from the periods', () => {
    expect(
      codes('sankey P\nperiod Q1 Q2 Q3\nFree -> Pro 80\nA -> B -> C 1\n')
    ).toContain('E_SANKEY_PATH_LENGTH');
    const p = parseSankey(
      'sankey P\nperiod Q1 Q2 Q3\nA -> B -> C -> D 9\nA -> B -> C 1\n'
    );
    expect(p.alluvial?.paths).toHaveLength(1);
  });

  it('reports sankey tree rows mixed with path rows', () => {
    expect(
      codes('sankey P\nperiod Q1 Q2\nFree\n  Pro 80\nFree -> Pro 5\n')
    ).toContain('E_SANKEY_MIXED_ROWS');
    expect(codes('sankey P\nperiod Q1 Q2\nFree -- Pro 5\n')).toContain(
      'E_SANKEY_MIXED_ROWS'
    );
  });

  it('reports a path without a period line, and fewer than two periods', () => {
    expect(codes('sankey P\nFree -> Free -> Pro 80\n')).toContain(
      'E_SANKEY_PATH_NO_PERIOD'
    );
    expect(codes('sankey P\nperiod Q1\nFree 80\n')).toContain(
      'E_SANKEY_FEW_PERIODS'
    );
  });

  it('leaves an ordinary sankey untouched', () => {
    const p = parseSankey('sankey T\nA -> B 5\nB -> C 3\n');
    expect(p.alluvial).toBeUndefined();
    expect(p.links).toHaveLength(2);
    expect(p.diagnostics).toEqual([]);
  });
});

describe('sankey alluvial mode — render', () => {
  const render = async (src: string) => {
    const svg = await renderForExport(src, 'light');
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    return dom.window.document;
  };

  it('draws one node per category per period and a header per period', async () => {
    const doc = await render(SOURCE);
    const nodes = [...doc.querySelectorAll('rect[data-emph-key^="node:"]')];
    // Q1: Free Pro Team · Q2: Free Pro · Q3: Free Pro
    expect(nodes.map((n) => n.getAttribute('data-emph-key'))).toEqual([
      'node:0␟Free',
      'node:0␟Pro',
      'node:0␟Team',
      'node:1␟Free',
      'node:1␟Pro',
      'node:2␟Free',
      'node:2␟Pro',
    ]);
    const texts = [...doc.querySelectorAll('text')].map((t) => t.textContent);
    for (const q of ['Q1', 'Q2', 'Q3']) expect(texts).toContain(q);
  });

  it('keeps a band in its first-column colour through every column', async () => {
    const doc = await render(SOURCE);
    const bands = [...doc.querySelectorAll('path[data-emph-key^="cohort:"]')];
    const byCohort = new Map<string, Set<string>>();
    for (const b of bands) {
      const k = b.getAttribute('data-emph-key')!;
      const set = byCohort.get(k) ?? new Set();
      set.add(b.getAttribute('fill')!);
      byCohort.set(k, set);
    }
    expect([...byCohort.keys()].sort()).toEqual([
      'cohort:Free',
      'cohort:Pro',
      'cohort:Team',
    ]);
    for (const fills of byCohort.values()) expect(fills.size).toBe(1);
    // The Pro cohort's Q2 → Q3 band into Free is drawn in Pro's colour.
    const proIntoFree = bands.find(
      (b) =>
        b.getAttribute('data-emph-key') === 'cohort:Pro' &&
        b.getAttribute('data-name') === 'Free → Free'
    );
    expect(proIntoFree?.getAttribute('data-size')).toBe('40');
  });

  it('bakes a hover readout: cohort and step on a band, column total on a node', async () => {
    const doc = await render(SOURCE);
    const band = doc.querySelector(
      'path[data-emph-key="cohort:Free"][data-name="Free → Pro"]'
    )!;
    expect(band.getAttribute('data-size-label')).toBe(
      'Free cohort · Q1 Free → Q2 Pro'
    );
    expect(band.getAttribute('data-size')).toBe('120');
    const node = doc.querySelector('rect[data-emph-key="node:0␟Free"]')!;
    expect(node.getAttribute('data-size')).toBe('600');
    expect(node.getAttribute('data-size-label')).toBe('Free · Q1 · of 860');
  });

  it('stacks categories in declaration order in every column', async () => {
    const doc = await render(SOURCE);
    const y = (k: string) =>
      parseFloat(
        doc.querySelector(`rect[data-emph-key="${k}"]`)!.getAttribute('y')!
      );
    for (const j of [0, 1, 2])
      expect(y(`node:${j}␟Free`)).toBeLessThan(y(`node:${j}␟Pro`));
  });
});
