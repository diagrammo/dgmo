// `highlight` on scatter, slope and treemap (#1829, spec §1.11): the named
// points, series or nodes keep full strength and everything else recedes. On
// scatter and slope it sits indented under its row or `[Group]` (#2080); a
// chart-level `highlight <Name>` there is the old form and changes nothing. A receded element is painted with the grey ground
// (`storyGround`, #2046) and carries no `opacity` attribute; the named ones
// are drawn solid in their own colour; a name that matches nothing changes
// nothing.
import { highlightUnder } from './helpers/highlight-under';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '../src/render';
import { parseTreemap } from '../src/treemap/parser';
import { parseSlope } from '../src/slope/parser';
import { treemapRecedes } from '../src/treemap/treemap-shared';
import '../src/palettes/index';
import { getPalette } from '../src/palettes';
import { storyGround } from '../src/utils/emphasis';

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

const ground = storyGround(getPalette('slate').light, false);

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

/** Fill of each point, keyed by its name; asserts none carries opacity. */
async function pointFill(src: string): Promise<Record<string, string | null>> {
  const h = await draw(src);
  const out: Record<string, string | null> = {};
  for (const c of h.querySelectorAll<SVGCircleElement>('circle[data-name]')) {
    expect(c.getAttribute('opacity')).toBeNull();
    out[c.getAttribute('data-name')!.split(' · ')[0]!] = c.getAttribute('fill');
  }
  return out;
}

/** Each point's own colour, keyed by its name. */
async function pointOwn(src: string): Promise<Record<string, string | null>> {
  const h = await draw(src);
  const out: Record<string, string | null> = {};
  for (const c of h.querySelectorAll<SVGCircleElement>('circle[data-name]'))
    out[c.getAttribute('data-name')!.split(' · ')[0]!] =
      c.getAttribute('data-color');
  return out;
}

describe('highlight on scatter', () => {
  it('keeps the named point solid and greys the rest', async () => {
    const src = highlightUnder(SCATTER, ['Fancy']);
    const f = await pointFill(src);
    const own = await pointOwn(src);
    expect(f['Fancy']).toBe(own['Fancy']);
    expect(f['Black Pearl']).toBe(ground.groundFill);
    expect(f['Queen Anne']).toBe(ground.groundFill);
    expect(f['Ranger']).toBe(ground.groundFill);
  });

  it('takes a comma list, case-insensitively', async () => {
    const src = highlightUnder(SCATTER, ['Black Pearl', 'Ranger']);
    const f = await pointFill(src);
    const own = await pointOwn(src);
    expect(f['Black Pearl']).toBe(own['Black Pearl']);
    expect(f['Ranger']).toBe(own['Ranger']);
    expect(f['Fancy']).toBe(ground.groundFill);
  });

  it('keeps every point of a named category', async () => {
    const src = highlightUnder(SCATTER_CATS, ['Pirate']);
    const f = await pointFill(src);
    const own = await pointOwn(src);
    expect(f['Black Pearl']).toBe(own['Black Pearl']);
    expect(f['Fancy']).toBe(own['Fancy']);
    expect(f['Dreadnought']).toBe(ground.groundFill);
    expect(f['Victory']).toBe(ground.groundFill);
  });

  it('paints a receded point and its label with the grey ground', async () => {
    const h = await draw(highlightUnder(SCATTER, ['Fancy']));
    const pt = (n: string) =>
      [...h.querySelectorAll('circle[data-name]')].find((c) =>
        c.getAttribute('data-name')!.startsWith(n)
      )!;
    expect(pt('Ranger').getAttribute('stroke')).toBe(ground.groundStroke);
    expect(pt('Fancy').getAttribute('stroke')).toBe(
      pt('Fancy').getAttribute('data-color')
    );
    const label = (t: string) =>
      [...h.querySelectorAll('text.dgmo-ptlabel')].find(
        (e) => e.textContent === t
      );
    expect(label('Fancy')?.getAttribute('opacity') ?? null).toBeNull();
    expect(label('Fancy')?.getAttribute('fill')).not.toBe(ground.groundText);
    expect(label('Ranger')?.getAttribute('opacity') ?? null).toBeNull();
    // A point label is coloured to match its point, so it greys with the stroke.
    expect(label('Ranger')?.getAttribute('fill')).toBe(ground.groundStroke);
  });

  it('draws receded points before the lit one', async () => {
    const h = await draw(highlightUnder(SCATTER, ['Black Pearl']));
    const names = [...h.querySelectorAll('circle[data-name]')].map(
      (c) => c.getAttribute('data-name')!.split(' · ')[0]
    );
    expect(names[names.length - 1]).toBe('Black Pearl');
  });

  it('changes nothing when no name matches', async () => {
    expect(await pointFill(withLine(SCATTER, 'highlight Kraken'))).toEqual(
      await pointFill(SCATTER)
    );
  });

  it('ignores dim, which scatter does not adopt', async () => {
    expect(await pointFill(withLine(SCATTER, 'dim Fancy'))).toEqual(
      await pointFill(SCATTER)
    );
  });
});

// ── slope ──────────────────────────────────────────────────

const SLOPE = `slope Crew Size by Year

period 1715 1720

Black Pearl 40 90
Queen Anne 150 300
Fancy 80 60`;

const SLOPE_NAMES = ['Black Pearl', 'Queen Anne', 'Fancy'];

/** Each series' group, keyed by series name (DOM order is not source order). */
async function slopeGroups(src: string): Promise<Record<string, Element>> {
  const h = await draw(src);
  const out: Record<string, Element> = {};
  for (const g of h.querySelectorAll('g.slope-series')) {
    const name = SLOPE_NAMES.find((n) => g.textContent!.includes(n))!;
    out[name] = g;
  }
  return out;
}

const slopeStroke = (g: Element) =>
  g.querySelector('path')!.getAttribute('stroke');

describe('highlight on slope', () => {
  it('parses the directive and keeps it out of the data', () => {
    const p = parseSlope(highlightUnder(SLOPE, ['Fancy']));
    expect(p.emphasis?.names).toEqual(['Fancy']);
    expect(p.data.map((d) => d.label)).toEqual([
      'Black Pearl',
      'Queen Anne',
      'Fancy',
    ]);
    expect(p.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('keeps the named series solid and greys the rest', async () => {
    const g = await slopeGroups(highlightUnder(SLOPE, ['Fancy']));
    expect(slopeStroke(g['Black Pearl']!)).toBe(ground.groundStroke);
    expect(slopeStroke(g['Queen Anne']!)).toBe(ground.groundStroke);
    expect(slopeStroke(g['Fancy']!)).not.toBe(ground.groundStroke);
    for (const grp of Object.values(g))
      expect(grp.querySelector('path')!.getAttribute('opacity')).toBeNull();
  });

  it('paints the points and labels of a receded series with the ground', async () => {
    const g = await slopeGroups(highlightUnder(SLOPE, ['Fancy']));
    const pearl = g['Black Pearl']!;
    for (const c of pearl.querySelectorAll('circle')) {
      expect(c.getAttribute('opacity')).toBeNull();
      expect(c.getAttribute('fill')).toBe(ground.groundStroke);
    }
    for (const t of pearl.querySelectorAll('text')) {
      expect(t.getAttribute('opacity')).toBeNull();
      expect(t.getAttribute('fill')).toBe(ground.groundText);
    }
    const fancy = g['Fancy']!;
    for (const t of fancy.querySelectorAll('text'))
      expect(t.getAttribute('fill')).not.toBe(ground.groundText);
  });

  it('draws receded series before the lit one', async () => {
    const h = await draw(highlightUnder(SLOPE, ['Black Pearl']));
    const groups = [...h.querySelectorAll('g.slope-series')];
    expect(groups[groups.length - 1]!.textContent).toContain('Black Pearl');
  });

  it('changes nothing when no name matches', async () => {
    const g = await slopeGroups(withLine(SLOPE, 'highlight Kraken'));
    const plain = await slopeGroups(SLOPE);
    for (const n of SLOPE_NAMES)
      expect(slopeStroke(g[n]!)).toBe(slopeStroke(plain[n]!));
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

/** Fill of each cell's shape (rect or arc), keyed by node path. */
async function cellFill(src: string): Promise<Record<string, string | null>> {
  const h = await draw(src);
  const out: Record<string, string | null> = {};
  for (const g of h.querySelectorAll('g.dgmo-treemap-cell')) {
    expect(g.getAttribute('opacity')).toBeNull();
    const shape = g.querySelector(
      'rect.dgmo-treemap-rect, path.dgmo-treemap-arc'
    )!;
    expect(shape.getAttribute('opacity')).toBeNull();
    out[g.getAttribute('data-node-path')!] = shape.getAttribute('fill');
  }
  return out;
}

describe('highlight on treemap', () => {
  it('parses the directive and keeps it out of the hierarchy', () => {
    const p = parseTreemap(withLine(TREEMAP, 'highlight Rum'));
    expect(p.emphasis?.names).toEqual(['Rum']);
    expect(p.roots.map((r) => r.label)).toEqual(['Provisions', 'Armament']);
    expect(p.error).toBeNull();
  });

  it('keeps the named leaf solid and greys every other cell', async () => {
    const o = await cellFill(withLine(TREEMAP, 'highlight Rum'));
    // The subject is drawn solid in its own colour: neither ground paint.
    expect(o['Provisions / Rum']).not.toBe(ground.groundFill);
    expect(o['Provisions / Rum']).not.toBe(ground.groundStroke);
    expect(o['Provisions / Biscuit']).toBe(ground.groundFill);
    expect(o['Armament / Powder']).toBe(ground.groundFill);
    // Receded containers take the darker ground so leaves still read inside.
    expect(o['Armament']).toBe(ground.groundStroke);
    // The branch holding a named leaf recedes too.
    expect(o['Provisions']).toBe(ground.groundStroke);
  });

  it('keeps a named branch and everything inside it', async () => {
    const o = await cellFill(withLine(TREEMAP, 'highlight Armament'));
    for (const k of ['Armament', 'Armament / Powder', 'Armament / Shot']) {
      expect(o[k]).not.toBe(ground.groundFill);
      expect(o[k]).not.toBe(ground.groundStroke);
    }
    expect(o['Provisions']).toBe(ground.groundStroke);
    expect(o['Provisions / Rum']).toBe(ground.groundFill);
  });

  it('a trailing colour word paints the named leaf with that palette colour', async () => {
    const o = await cellFill(withLine(TREEMAP, 'highlight Rum orange'));
    expect(o['Provisions / Rum']).toBe(getPalette('slate').light.colors.orange);
    expect(o['Provisions / Biscuit']).toBe(ground.groundFill);
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

  it('greys arcs in sunburst mode too', async () => {
    const o = await cellFill(withLine(TREEMAP, 'sunburst\nhighlight Rum'));
    expect(o['Provisions / Rum']).not.toBe(ground.groundFill);
    expect(o['Provisions / Rum']).not.toBe(ground.groundStroke);
    expect(o['Provisions / Biscuit']).toBe(ground.groundFill);
    expect(o['Armament']).toBe(ground.groundStroke);
  });

  it('changes nothing when no name matches', async () => {
    expect(await cellFill(withLine(TREEMAP, 'highlight Kraken'))).toEqual(
      await cellFill(TREEMAP)
    );
  });
});
