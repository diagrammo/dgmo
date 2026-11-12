// A single-series bar draws every bar in ONE hue (#1829): a hue per category
// encodes nothing, and the first category used to come out red whatever its
// sign. Positive bars take the palette's primary, negative bars its red — the
// diverging hue. An author's color still wins; multi-series keeps one hue per
// series.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';
import '../src/palettes/index';
import { getAvailablePalettes } from '../src/palettes/registry';
import type { PaletteColors } from '../src/palettes/types';

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

async function strokes(
  src: string,
  palette?: PaletteColors,
  theme: 'light' | 'dark' = 'light'
): Promise<string[]> {
  host.innerHTML = await renderDataChartD3(src, theme, palette);
  return [
    ...host.querySelectorAll<SVGRectElement>('rect[data-line-number]'),
  ].map((r) => (r.getAttribute('stroke') ?? '').toLowerCase());
}

const POSITIVE = `bar Treasure Hauls by Port

Port Royal 850
Tortuga 620
Nassau 1100
Havana 400`;

const MIXED = `bar Profit by Port

Port Royal 850
Tortuga -120
Nassau 1100
Havana -40`;

describe('single-series bar colour', () => {
  for (const p of getAvailablePalettes()) {
    for (const mode of ['light', 'dark'] as const) {
      const c = p[mode];
      it(`${p.id} ${mode}: every positive bar is the primary hue`, async () => {
        const s = await strokes(POSITIVE, c, mode);
        expect(s).toHaveLength(4);
        expect(new Set(s)).toEqual(new Set([c.primary.toLowerCase()]));
      });
      it(`${p.id} ${mode}: negative bars take red, positive bars the primary`, async () => {
        const s = await strokes(MIXED, c, mode);
        const pos = c.primary.toLowerCase();
        const neg = c.colors.red.toLowerCase();
        expect(pos).not.toBe(neg);
        expect(s).toEqual([pos, neg, pos, neg]);
      });
    }
  }

  it('horizontal bars follow the same rule', async () => {
    const s = await strokes(`${MIXED}\norientation-horizontal`);
    expect(new Set(s).size).toBe(2);
    expect(s[0]).toBe(s[2]);
    expect(s[1]).toBe(s[3]);
    expect(s[0]).not.toBe(s[1]);
  });

  it("a row's own colour still overrides", async () => {
    const plain = await strokes(POSITIVE);
    const s = await strokes(
      POSITIVE.replace('Tortuga 620', 'Tortuga green 620')
    );
    expect(s[1]).not.toBe(plain[1]);
    expect(s[0]).toBe(plain[0]);
    expect(s[2]).toBe(plain[2]);
  });

  it("the chart's `color` directive sets the one hue for every bar", async () => {
    const plain = await strokes(MIXED);
    const s = await strokes(MIXED.replace('\n\n', '\ncolor green\n\n'));
    expect(new Set(s).size).toBe(1);
    expect(s[0]).not.toBe(plain[0]);
  });

  it('multi-series bars keep one hue per series', async () => {
    const s = await strokes(`bar Hauls
group
  Gold
  Silver

Port Royal 850 300
Tortuga 620 200`);
    expect(s).toHaveLength(4);
    expect(s[0]).toBe(s[2]);
    expect(s[1]).toBe(s[3]);
    expect(s[0]).not.toBe(s[1]);
  });
});
