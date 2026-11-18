// `highlight` on bar, line and pie (#1829, spec §1.11), indented under its
// row or series name (#2080): the named categories, series or slices keep full strength and everything else
// recedes. A receded element is painted with the grey ground (`storyGround`,
// #2046) — its fill, stroke and label text are replaced, and it carries no
// `opacity` attribute — the named elements are drawn solid in their own
// colour, and a name that matches nothing changes nothing.
import { highlightUnder } from './helpers/highlight-under';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { parseChart } from '../src/chart';
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
  host.innerHTML = await renderDataChartD3(src, 'light');
  return host;
}

const palette = getPalette('slate').light;
const ground = storyGround(palette, false);

const BAR = `bar Treasure Hauls by Port

Port Royal 850
Tortuga 620
Nassau 1100
Havana 400`;

/** Fill of each bar, keyed by its category; asserts no bar carries opacity. */
async function barFill(src: string): Promise<Record<string, string | null>> {
  const h = await draw(src);
  const out: Record<string, string | null> = {};
  for (const r of h.querySelectorAll<SVGRectElement>('rect[data-name]')) {
    expect(r.getAttribute('opacity')).toBeNull();
    out[r.getAttribute('data-name')!] = r.getAttribute('fill');
  }
  return out;
}

/** A bar's own colour, as `data-color` records it. */
async function barOwn(src: string): Promise<Record<string, string | null>> {
  const h = await draw(src);
  const out: Record<string, string | null> = {};
  for (const r of h.querySelectorAll<SVGRectElement>('rect[data-name]'))
    out[r.getAttribute('data-name')!] = r.getAttribute('data-color');
  return out;
}

describe('highlight on bar', () => {
  it('keeps the named bar solid in its own colour and greys the rest', async () => {
    const src = highlightUnder(BAR, ['Nassau']);
    const f = await barFill(src);
    const own = await barOwn(src);
    expect(f['Nassau']).toBe(own['Nassau']);
    expect(f['Port Royal']).toBe(ground.groundFill);
    expect(f['Tortuga']).toBe(ground.groundFill);
    expect(f['Havana']).toBe(ground.groundFill);
  });

  it('a highlight under each of several rows lights them all', async () => {
    const src = highlightUnder(BAR, ['Port Royal', 'Havana']);
    const f = await barFill(src);
    const own = await barOwn(src);
    expect(f['Port Royal']).toBe(own['Port Royal']);
    expect(f['Havana']).toBe(own['Havana']);
    expect(f['Tortuga']).toBe(ground.groundFill);
    expect(f['Nassau']).toBe(ground.groundFill);
  });

  it('paints a receded bar with the grey ground, outline included', async () => {
    const lit = await draw(highlightUnder(BAR, ['Nassau']));
    const bars = [...lit.querySelectorAll('rect[data-name]')];
    const tortuga = bars.find(
      (r) => r.getAttribute('data-name') === 'Tortuga'
    )!;
    expect(tortuga.getAttribute('fill')).toBe(ground.groundFill);
    expect(tortuga.getAttribute('stroke')).toBe(ground.groundStroke);
    const nassau = bars.find((r) => r.getAttribute('data-name') === 'Nassau')!;
    expect(nassau.getAttribute('fill')).toBe(nassau.getAttribute('data-color'));
    expect(nassau.getAttribute('stroke')).toBe(
      nassau.getAttribute('data-color')
    );
  });

  it('keeps the receded bar its own data-color for hover', async () => {
    const plain = await barOwn(BAR);
    const lit = await barOwn(highlightUnder(BAR, ['Nassau']));
    expect(lit).toEqual(plain);
  });

  it('a trailing colour word paints the named bar with that palette colour', async () => {
    const f = await barFill(highlightUnder(BAR, ['Nassau'], 'orange'));
    expect(f['Nassau']).toBe(palette.colors.orange);
    expect(f['Tortuga']).toBe(ground.groundFill);
  });

  it('a name that ends in a colour word still matches whole', async () => {
    const AGENT = `bar Agents\n\nAgent Orange 5\n  highlight\nAgent Smith 7`;
    const f = await barFill(AGENT);
    const own = await barOwn(AGENT);
    expect(f['Agent Orange']).toBe(own['Agent Orange']);
    expect(f['Agent Orange']).not.toBe(palette.colors.orange);
    expect(f['Agent Smith']).toBe(ground.groundFill);
  });

  it('paints the value label of a receded bar with the ground text', async () => {
    const h = await draw(highlightUnder(BAR, ['Nassau']));
    const label = (t: string) =>
      [...h.querySelectorAll('text')].find((e) => e.textContent === t);
    expect(label('1,100')?.getAttribute('fill')).toBe(palette.text);
    expect(label('850')?.getAttribute('fill')).toBe(ground.groundText);
    expect(label('850')?.getAttribute('opacity') ?? null).toBeNull();
  });

  it('the old chart-level line changes nothing and shows the indented form', async () => {
    const src = BAR.replace('\n\n', '\nhighlight Nassau\n\n');
    expect(await barFill(src)).toEqual(await barFill(BAR));
    expect(parseChart(src).diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('Nassau\n  highlight'),
    ]);
  });

  it('under a row, a name after highlight warns: the row names it', () => {
    const c = parseChart(
      BAR.replace('Nassau 1100', 'Nassau 1100\n  highlight Kingston')
    );
    expect(c.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('takes only a colour here'),
    ]);
  });

  it('on a stacked bar, a series name keeps that series in every bar', async () => {
    const STACK = `bar Cargo by Port

stack
  Rum
    highlight
  Silk
  Spice

Port Royal 10 20 30
Tortuga 5 15 25`;
    const h = await draw(STACK);
    const rects = [...h.querySelectorAll<SVGRectElement>('rect[data-name]')];
    expect(rects).toHaveLength(6);
    for (const r of rects) {
      const rum = r.getAttribute('data-series-name') === 'Rum';
      expect(r.getAttribute('opacity')).toBeNull();
      expect(r.getAttribute('fill')).toBe(
        rum ? r.getAttribute('data-color') : ground.groundFill
      );
    }
  });

  it('on a stacked bar, a category name keeps every segment of that bar', async () => {
    const STACK = `bar Cargo by Port

stack
  Rum
  Silk

Port Royal 10 20
Tortuga 5 15
  highlight`;
    const h = await draw(STACK);
    for (const r of h.querySelectorAll<SVGRectElement>('rect[data-name]')) {
      const tortuga = r.getAttribute('data-name')!.startsWith('Tortuga');
      expect(r.getAttribute('opacity')).toBeNull();
      expect(r.getAttribute('fill')).toBe(
        tortuga ? r.getAttribute('data-color') : ground.groundFill
      );
    }
  });

  it('a category named Highlight… stays data', () => {
    const c = parseChart(`bar Reels\n\nHighlight Reel 5\nBlooper Reel 3`);
    expect(c.emphasis).toBeUndefined();
    expect(c.data.map((d) => d.label)).toEqual([
      'Highlight Reel',
      'Blooper Reel',
    ]);
  });
});

describe('highlight on line', () => {
  const LINE = `line Fleet Size

series
  Navy
    highlight
  Merchant
  Pirate

1700 11 43 27
1710 13 47 31
1720 17 53 23`;

  it('keeps the named series solid and greys the others', async () => {
    const h = await draw(LINE);
    const groups = [...h.querySelectorAll<SVGGElement>('g.dgmo-series')];
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      const navy = g.getAttribute('data-series-name') === 'Navy';
      expect(g.getAttribute('opacity')).toBeNull();
      const stroke = g
        .querySelector('.dgmo-series-line')!
        .getAttribute('stroke');
      expect(stroke).toBe(
        navy ? g.getAttribute('data-color') : ground.groundStroke
      );
      for (const c of g.querySelectorAll('circle.dgmo-pt'))
        expect(c.getAttribute('stroke')).toBe(stroke);
    }
  });

  it('draws receded series before the lit one', async () => {
    const h = await draw(LINE);
    const names = [...h.querySelectorAll('g.dgmo-series')].map((g) =>
      g.getAttribute('data-series-name')
    );
    expect(names[names.length - 1]).toBe('Navy');
  });

  it('paints the value labels of a receded series with the ground text', async () => {
    const h = await draw(LINE);
    const label = (t: string) =>
      [...h.querySelectorAll('text')].find((e) => e.textContent === t);
    expect(label('11')?.getAttribute('fill')).not.toBe(ground.groundText);
    expect(label('43')?.getAttribute('fill')).toBe(ground.groundText);
    expect(label('43')?.getAttribute('opacity') ?? null).toBeNull();
  });

  it('greys the legend entries of receded series', async () => {
    const h = await draw(LINE);
    for (const e of h.querySelectorAll('g[data-legend-entry]')) {
      const navy = e.getAttribute('data-series-name') === 'Navy';
      const dot = e.querySelector('circle')!.getAttribute('fill');
      if (navy) expect(dot).not.toBe(ground.groundStroke);
      else expect(dot).toBe(ground.groundStroke);
    }
  });
});

describe('highlight on pie', () => {
  const PIE = `pie Plunder Share

Rum 40
  highlight
Silk 35
Spice 25`;

  it('keeps the named slice, its leader and its label; greys the rest', async () => {
    const h = await draw(PIE);
    const slices = [...h.querySelectorAll<SVGPathElement>('path[data-name]')];
    expect(slices).toHaveLength(3);
    for (const p of slices) {
      const rum = p.getAttribute('data-name') === 'Rum';
      expect(p.getAttribute('opacity')).toBeNull();
      expect(p.getAttribute('fill')).toBe(
        rum ? p.getAttribute('data-color') : ground.groundFill
      );
      expect(p.getAttribute('stroke')).toBe(
        rum ? p.getAttribute('data-color') : ground.groundStroke
      );
    }
    // A pie label is coloured to match its slice, so it greys with the stroke.
    for (const t of h.querySelectorAll<SVGTextElement>('text[data-name]')) {
      const rum = t.getAttribute('data-name') === 'Rum';
      expect(t.getAttribute('opacity')).toBeNull();
      expect(t.getAttribute('fill')).toBe(
        rum ? t.getAttribute('data-color') : ground.groundStroke
      );
    }
    for (const l of h.querySelectorAll('polyline[data-name]')) {
      const rum = l.getAttribute('data-name') === 'Rum';
      expect(l.getAttribute('opacity')).toBeNull();
      expect(l.getAttribute('stroke')).toBe(
        rum ? l.getAttribute('data-color') : ground.groundStroke
      );
    }
  });
});

describe('highlight is not adopted elsewhere in this parser', () => {
  it('radar reads it as ordinary content', () => {
    const c = parseChart(`radar Crew\n\nSpeed 5\n  highlight\nStrength 3`);
    expect(c.emphasis).toBeUndefined();
  });

  it('`dim` is not a bar directive', () => {
    const c = parseChart(`bar Ports\n\ndim Nassau\nNassau 3\nTortuga 4`);
    expect(c.emphasis).toBeUndefined();
  });
});
