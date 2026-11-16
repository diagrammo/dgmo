// `highlight` names a path (#2041): an arrow chain, written with the same
// arrows a diagram uses, lights exactly those nodes and the links between.
import { describe, it, expect } from 'vitest';
import { render } from '../src/render';
import { parseDgmo } from '../src/dgmo-router';
import {
  parseEmphasisDirective,
  parseHighlightChain,
  resolveHighlightPaths,
} from '../src/utils/emphasis';

describe('parseHighlightChain', () => {
  it('reads plain and labelled arrows', () => {
    expect(parseHighlightChain('Edge -> API -> Cache')).toEqual({
      nodes: ['Edge', 'API', 'Cache'],
      links: [
        { from: 'Edge', to: 'API' },
        { from: 'API', to: 'Cache' },
      ],
    });
    expect(parseHighlightChain('OK? -no-> Pay')).toEqual({
      nodes: ['OK?', 'Pay'],
      links: [{ from: 'OK?', to: 'Pay', label: 'no' }],
    });
  });

  it('a name with no arrow is not a chain', () => {
    expect(parseHighlightChain('Port Royal')).toBeNull();
    expect(parseHighlightChain('Ship-to-shore')).toBeNull();
  });
});

describe('resolveHighlightPaths', () => {
  const nodes = ['A', 'B', 'C', 'D'];
  const edges = [
    { from: 'A', to: 'B' },
    { from: 'B', to: 'C' },
    { from: 'A', to: 'D', label: 'no' },
  ];
  const dir = (text: string) => parseEmphasisDirective(`highlight ${text}`, 1)!;

  it('a chain lights its nodes and links only', () => {
    const r = resolveHighlightPaths(dir('A -> B -> C'), nodes, edges);
    expect([...r.litNodes].sort()).toEqual(['A', 'B', 'C']);
    expect([...r.litEdges].sort()).toEqual([0, 1]);
  });

  it('a labelled arrow matches only the edge with that label', () => {
    expect([
      ...resolveHighlightPaths(dir('A -no-> D'), nodes, edges).litEdges,
    ]).toEqual([2]);
    const miss = resolveHighlightPaths(dir('A -yes-> D'), nodes, edges);
    expect(miss.active).toBe(false);
    expect(miss.unknown).toEqual(['A -yes-> D']);
  });

  it('a missing link is reported by name and lights nothing', () => {
    const r = resolveHighlightPaths(dir('A -> C'), nodes, edges);
    expect(r.active).toBe(false);
    expect(r.unknown).toEqual(['A -> C']);
  });

  it('plain names and chains mix with a comma', () => {
    const r = resolveHighlightPaths(dir('A -> B, D'), nodes, edges);
    expect([...r.litNodes].sort()).toEqual(['A', 'B', 'D']);
  });

  it('a trailing colour paints the chain', () => {
    const r = resolveHighlightPaths(dir('A -> B orange'), nodes, edges);
    expect(r.color).toBe('orange');
    expect([...r.litEdges]).toEqual([0]);
  });
});

describe('sankey: highlight a flow chain', () => {
  const SANKEY = `sankey Traffic
highlight Ads -> Landing -> Signup

Ads
  Landing 30
Search
  Landing 50
Landing
  Signup 40
  Bounce 40`;

  it('lights only the named ribbons', async () => {
    const { svg } = await render(SANKEY);
    const host = document.createElement('div');
    host.innerHTML = svg;
    const ribbons = [...host.querySelectorAll('path[data-emph-key^="link:"]')];
    const lit = ribbons.filter(
      (r) => r.getAttribute('fill') === r.getAttribute('data-color')
    );
    expect(lit.map((r) => r.getAttribute('data-name')).sort()).toEqual([
      'Ads → Landing',
      'Landing → Signup',
    ]);
  });

  it('warns when the chain names a flow the chart lacks', () => {
    const src = SANKEY.replace('Ads -> Landing -> Signup', 'Ads -> Signup');
    const msgs = parseDgmo(src).diagnostics.map((d) => d.message);
    expect(msgs).toContain(
      'highlight names a flow this chart does not have: Ads -> Signup'
    );
  });
});
