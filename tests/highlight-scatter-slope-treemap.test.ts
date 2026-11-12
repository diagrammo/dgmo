// `highlight <Name>[, <Name>…]` on scatter, slope and treemap (#1829, spec
// §1.11): the named points, series or nodes keep full strength and everything
// else recedes. A receded element keeps its paint — the dim is a baked
// `opacity` attribute, never a recolour — and a name that matches nothing
// dims nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '../src/render';
import { parseTreemap } from '../src/treemap/parser';
import { parseSlope } from '../src/slope/parser';
import { treemapRecedes } from '../src/treemap/treemap-shared';
import '../src/palettes/index';
import {
  EMPHASIS_DIM_OPACITY,
  EMPHASIS_DIM_TEXT_OPACITY,
} from '../src/utils/emphasis';

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

async function draw(src: string): Promise<HTMLDivElement> {
  host.innerHTML = (await render(src, { theme: 'light' })).svg;
  return host;
}

const dimShape = String(EMPHASIS_DIM_OPACITY);
const dimText = String(EMPHASIS_DIM_TEXT_OPACITY);

const withLine = (src: string, line: string) =>
  src.replace('\n\n', `\n${line}\n\n`);

// ── scatter ────────────────────────────────────────────────

const SCATTER = `scatter Ships by Speed and Crew

Black Pearl 12 40
Queen Anne 9 150
Fancy 11 80
Ranger 7 30`;

const SCATTER_CATS = `scatter Ships by Navy

[Royal]
  Dreadnought 6 400
  Victory 7 820
[Pirate]
  Black Pearl 12 40
  Fancy 11 80`;

/** Opacity of each point, keyed by its name. */
async function pointOpacity(
  src: string
): Promise<Record<string, string | null>> {
  const h = await draw(src);
  const out: Record<string, string | null> = {};
  for (const c of h.querySelectorAll<SVGCircleElement>('circle[data-name]'))
    out[c.getAttribute('data-name')!.split(' · ')[0]!] =
      c.getAttribute('opacity');
  return out;
}

describe('highlight on scatter', () => {
  it('keeps the named point and recedes the rest', async () => {
    const o = await pointOpacity(withLine(SCATTER, 'highlight Fancy'));
    expect(o['Fancy']).toBeNull();
    expect(o['Black Pearl']).toBe(dimShape);
    expect(o['Queen Anne']).toBe(dimShape);
    expect(o['Ranger']).toBe(dimShape);
  });

  it('takes a comma list, case-insensitively', async () => {
    const o = await pointOpacity(
      withLine(SCATTER, 'highlight black pearl, RANGER')
    );
    expect(o['Black Pearl']).toBeNull();
    expect(o['Ranger']).toBeNull();
    expect(o['Fancy']).toBe(dimShape);
  });

  it('keeps every point of a named category', async () => {
    const o = await pointOpacity(withLine(SCATTER_CATS, 'highlight Pirate'));
    expect(o['Black Pearl']).toBeNull();
    expect(o['Fancy']).toBeNull();
    expect(o['Dreadnought']).toBe(dimShape);
    expect(o['Victory']).toBe(dimShape);
  });

  it('never recolours a receded point, and recedes its label', async () => {
    const plain = await draw(SCATTER);
    const before = [...plain.querySelectorAll('circle[data-name]')].map((c) =>
      c.getAttribute('stroke')
    );
    const h = await draw(withLine(SCATTER, 'highlight Fancy'));
    const after = [...h.querySelectorAll('circle[data-name]')].map((c) =>
      c.getAttribute('stroke')
    );
    expect(after).toEqual(before);
    const label = (t: string) =>
      [...h.querySelectorAll('text.dgmo-ptlabel')].find(
        (e) => e.textContent === t
      );
    expect(label('Fancy')?.getAttribute('opacity') ?? null).toBeNull();
    expect(label('Ranger')?.getAttribute('opacity')).toBe(dimText);
  });

  it('dims nothing when no name matches', async () => {
    const o = await pointOpacity(withLine(SCATTER, 'highlight Kraken'));
    expect(Object.values(o).every((v) => v === null)).toBe(true);
  });

  it('ignores dim, which scatter does not adopt', async () => {
    const o = await pointOpacity(withLine(SCATTER, 'dim Fancy'));
    expect(Object.values(o).every((v) => v === null)).toBe(true);
  });
});

// ── slope ──────────────────────────────────────────────────

const SLOPE = `slope Crew Size by Year

period 1715 1720

Black Pearl 40 90
Queen Anne 150 300
Fancy 80 60`;

/** Opacity of each series' line, keyed by series name. */
async function slopeOpacity(
  src: string
): Promise<Record<string, string | null>> {
  const h = await draw(src);
  const names = ['Black Pearl', 'Queen Anne', 'Fancy'];
  const groups = [...h.querySelectorAll('g.slope-series')];
  const out: Record<string, string | null> = {};
  groups.forEach((g, i) => {
    out[names[i]!] = g.querySelector('path')!.getAttribute('opacity');
  });
  return out;
}

describe('highlight on slope', () => {
  it('parses the directive and keeps it out of the data', () => {
    const p = parseSlope(withLine(SLOPE, 'highlight Fancy'));
    expect(p.emphasis?.names).toEqual(['Fancy']);
    expect(p.data.map((d) => d.label)).toEqual([
      'Black Pearl',
      'Queen Anne',
      'Fancy',
    ]);
    expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('keeps the named series and recedes the rest', async () => {
    const o = await slopeOpacity(withLine(SLOPE, 'highlight Fancy'));
    expect(o['Fancy']).toBeNull();
    expect(o['Black Pearl']).toBe(dimShape);
    expect(o['Queen Anne']).toBe(dimShape);
  });

  it('recedes the points and labels of a receded series', async () => {
    const h = await draw(withLine(SLOPE, 'highlight Fancy'));
    const groups = [...h.querySelectorAll('g.slope-series')];
    const pearl = groups[0]!;
    for (const c of pearl.querySelectorAll('circle'))
      expect(c.getAttribute('opacity')).toBe(dimShape);
    for (const t of pearl.querySelectorAll('text'))
      expect(t.getAttribute('opacity')).toBe(dimText);
    const fancy = groups[2]!;
    for (const t of fancy.querySelectorAll('text'))
      expect(t.getAttribute('opacity')).toBeNull();
  });

  it('dims nothing when no name matches', async () => {
    const o = await slopeOpacity(withLine(SLOPE, 'highlight Kraken'));
    expect(Object.values(o).every((v) => v === null)).toBe(true);
  });
});

// ── treemap ────────────────────────────────────────────────

const TREEMAP = `treemap Ship Stores

Provisions
  Rum 320
  Biscuit 180
Armament
  Powder 110
  Shot 90`;

/** Opacity of each cell group, keyed by its node path. */
async function cellOpacity(
  src: string
): Promise<Record<string, string | null>> {
  const h = await draw(src);
  const out: Record<string, string | null> = {};
  for (const g of h.querySelectorAll('g.dgmo-treemap-cell'))
    out[g.getAttribute('data-node-path')!] = g.getAttribute('opacity');
  return out;
}

describe('highlight on treemap', () => {
  it('parses the directive and keeps it out of the hierarchy', () => {
    const p = parseTreemap(withLine(TREEMAP, 'highlight Rum'));
    expect(p.emphasis?.names).toEqual(['Rum']);
    expect(p.roots.map((r) => r.label)).toEqual(['Provisions', 'Armament']);
    expect(p.error).toBeNull();
  });

  it('keeps the named leaf and recedes every other cell', async () => {
    const o = await cellOpacity(withLine(TREEMAP, 'highlight Rum'));
    expect(o['Provisions / Rum']).toBeNull();
    expect(o['Provisions / Biscuit']).toBe(dimShape);
    expect(o['Armament']).toBe(dimShape);
    expect(o['Armament / Powder']).toBe(dimShape);
    // The branch holding a named leaf recedes too: at full strength behind
    // translucent siblings it would read as colour, not as ground.
    expect(o['Provisions']).toBe(dimShape);
  });

  it('keeps a named branch and everything inside it', async () => {
    const o = await cellOpacity(withLine(TREEMAP, 'highlight Armament'));
    expect(o['Armament']).toBeNull();
    expect(o['Armament / Powder']).toBeNull();
    expect(o['Armament / Shot']).toBeNull();
    expect(o['Provisions']).toBe(dimShape);
    expect(o['Provisions / Rum']).toBe(dimShape);
  });

  it('keeps a collapsed block lit when a named node is inside it', () => {
    // `depth` collapses only in the interactive app (a render option), so
    // the predicate is checked on the cells a depth-1 layout would draw.
    const p = parseTreemap(withLine(TREEMAP, 'highlight Powder'));
    const recedes = treemapRecedes(p);
    const [provisions, armament] = p.roots;
    expect(
      recedes({ path: ['Armament'], node: armament!, isCollapsed: true })
    ).toBe(false);
    expect(
      recedes({ path: ['Provisions'], node: provisions!, isCollapsed: true })
    ).toBe(true);
    // Drawn as a container (not collapsed), the branch recedes like any
    // ancestor of a named leaf.
    expect(
      recedes({ path: ['Armament'], node: armament!, isCollapsed: false })
    ).toBe(true);
  });

  it('recedes arcs in radial mode too', async () => {
    const o = await cellOpacity(withLine(TREEMAP, 'radial\nhighlight Rum'));
    expect(o['Provisions / Rum']).toBeNull();
    expect(o['Armament / Shot']).toBe(dimShape);
  });

  it('never recolours a receded cell', async () => {
    const fills = async (src: string) =>
      [...(await draw(src)).querySelectorAll('rect.dgmo-treemap-rect')].map(
        (r) => r.getAttribute('fill')
      );
    expect(await fills(withLine(TREEMAP, 'highlight Rum'))).toEqual(
      await fills(TREEMAP)
    );
  });

  it('dims nothing when no name matches', async () => {
    const o = await cellOpacity(withLine(TREEMAP, 'highlight Kraken'));
    expect(Object.values(o).every((v) => v === null)).toBe(true);
  });
});
