// `highlight <Name>[, <Name>…]` on bar, line and pie (#1829, spec §1.11): the
// named categories, series or slices keep full strength and everything else
// recedes. A receded element keeps its paint — the dim is a baked `opacity`
// attribute, never a recolour — and a name that matches nothing dims nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { parseChart } from '../src/chart';
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
  host.innerHTML = await renderDataChartD3(src, 'light');
  return host;
}

const dimShape = String(EMPHASIS_DIM_OPACITY);
const dimText = String(EMPHASIS_DIM_TEXT_OPACITY);

const BAR = `bar Treasure Hauls by Port

Port Royal 850
Tortuga 620
Nassau 1100
Havana 400`;

/** Opacity of each bar, keyed by its category. */
async function barOpacity(src: string): Promise<Record<string, string | null>> {
  const h = await draw(src);
  const out: Record<string, string | null> = {};
  for (const r of h.querySelectorAll<SVGRectElement>('rect[data-name]'))
    out[r.getAttribute('data-name')!] = r.getAttribute('opacity');
  return out;
}

describe('highlight on bar', () => {
  it('keeps the named bar and recedes the rest', async () => {
    const o = await barOpacity(BAR.replace('\n\n', '\nhighlight Nassau\n\n'));
    expect(o['Nassau']).toBeNull();
    expect(o['Port Royal']).toBe(dimShape);
    expect(o['Tortuga']).toBe(dimShape);
    expect(o['Havana']).toBe(dimShape);
  });

  it('takes a comma list, case-insensitively', async () => {
    const o = await barOpacity(
      BAR.replace('\n\n', '\nhighlight port royal, HAVANA\n\n')
    );
    expect(o['Port Royal']).toBeNull();
    expect(o['Havana']).toBeNull();
    expect(o['Tortuga']).toBe(dimShape);
    expect(o['Nassau']).toBe(dimShape);
  });

  it('never recolours a receded bar', async () => {
    const plain = await draw(BAR);
    const before = [...plain.querySelectorAll('rect[data-name]')].map((r) =>
      r.getAttribute('fill')
    );
    const lit = await draw(BAR.replace('\n\n', '\nhighlight Nassau\n\n'));
    const after = [...lit.querySelectorAll('rect[data-name]')].map((r) =>
      r.getAttribute('fill')
    );
    expect(after).toEqual(before);
  });

  it('recedes the value label of a receded bar', async () => {
    const h = await draw(BAR.replace('\n\n', '\nhighlight Nassau\n\n'));
    const label = (t: string) =>
      [...h.querySelectorAll('text')].find((e) => e.textContent === t);
    expect(label('1,100')?.getAttribute('opacity') ?? null).toBeNull();
    expect(label('850')?.getAttribute('opacity')).toBe(dimText);
  });

  it('a name that matches nothing dims nothing', async () => {
    const o = await barOpacity(BAR.replace('\n\n', '\nhighlight Kingston\n\n'));
    expect(Object.values(o).every((v) => v === null)).toBe(true);
  });

  it('on a stacked bar, a series name keeps that series in every bar', async () => {
    const STACK = `bar Cargo by Port

highlight Rum

stack
  Rum
  Silk
  Spice

Port Royal 10 20 30
Tortuga 5 15 25`;
    const h = await draw(STACK);
    const rects = [...h.querySelectorAll<SVGRectElement>('rect[data-name]')];
    expect(rects).toHaveLength(6);
    for (const r of rects) {
      const rum = r.getAttribute('data-series-name') === 'Rum';
      expect(r.getAttribute('opacity')).toBe(rum ? null : dimShape);
    }
  });

  it('on a stacked bar, a category name keeps every segment of that bar', async () => {
    const STACK = `bar Cargo by Port

highlight Tortuga

stack
  Rum
  Silk

Port Royal 10 20
Tortuga 5 15`;
    const h = await draw(STACK);
    for (const r of h.querySelectorAll<SVGRectElement>('rect[data-name]')) {
      const tortuga = r.getAttribute('data-name')!.startsWith('Tortuga');
      expect(r.getAttribute('opacity')).toBe(tortuga ? null : dimShape);
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

highlight Navy

series
  Navy
  Merchant
  Pirate

1700 11 43 27
1710 13 47 31
1720 17 53 23`;

  it('keeps the named series and recedes the others', async () => {
    const h = await draw(LINE);
    const groups = [...h.querySelectorAll<SVGGElement>('g.dgmo-series')];
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      const navy = g.getAttribute('data-series-name') === 'Navy';
      expect(g.getAttribute('opacity')).toBe(navy ? null : dimShape);
    }
  });

  it('recedes the value labels of a receded series', async () => {
    const h = await draw(LINE);
    const label = (t: string) =>
      [...h.querySelectorAll('text')].find((e) => e.textContent === t);
    expect(label('11')?.getAttribute('opacity') ?? null).toBeNull();
    expect(label('43')?.getAttribute('opacity')).toBe(dimText);
  });
});

describe('highlight on pie', () => {
  const PIE = `pie Plunder Share

highlight Rum

Rum 40
Silk 35
Spice 25`;

  it('keeps the named slice, its leader and its label; recedes the rest', async () => {
    const h = await draw(PIE);
    const slices = [...h.querySelectorAll<SVGPathElement>('path[data-name]')];
    expect(slices).toHaveLength(3);
    for (const p of slices) {
      const rum = p.getAttribute('data-name') === 'Rum';
      expect(p.getAttribute('opacity')).toBe(rum ? null : dimShape);
    }
    for (const t of h.querySelectorAll<SVGTextElement>('text[data-name]')) {
      const rum = t.getAttribute('data-name') === 'Rum';
      expect(t.getAttribute('opacity')).toBe(rum ? null : dimText);
    }
    for (const l of h.querySelectorAll('polyline[data-name]')) {
      const rum = l.getAttribute('data-name') === 'Rum';
      expect(l.getAttribute('opacity')).toBe(rum ? null : dimShape);
    }
  });
});

describe('highlight is not adopted elsewhere in this parser', () => {
  it('radar reads it as ordinary content', () => {
    const c = parseChart(`radar Crew\n\nhighlight Speed\nSpeed 5\nStrength 3`);
    expect(c.emphasis).toBeUndefined();
  });

  it('`dim` is not a bar directive', () => {
    const c = parseChart(`bar Ports\n\ndim Nassau\nNassau 3\nTortuga 4`);
    expect(c.emphasis).toBeUndefined();
  });
});
