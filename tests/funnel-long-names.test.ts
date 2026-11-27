// funnel-long-names.test.ts — a long stage name is capped and wrapped, so the
// bands still draw at a normal width inside the canvas (#2441).
import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { measureText } from '../src/utils/text-measure';
import { flattenTabular } from './helpers/tabular-text';

const LONG =
  'An extraordinarily long stage name that keeps going well past any sensible width for a funnel label because the author pasted a whole sentence in';

const SRC = [
  'funnel Long labels',
  '',
  `${LONG} 1000`,
  'Middle 500',
  `${LONG} again 200`,
].join('\n');

const WIDTH = 720;
/** The renderer's FUNNEL_MIN_PLOT_WIDTH. */
const MIN_PLOT = 60;

describe('funnel long stage names', () => {
  it('draws every band and label inside the SVG at a normal plot width', async () => {
    expect(LONG.length).toBeGreaterThanOrEqual(140);
    const svg = flattenTabular(
      await renderDataChartD3(SRC, 'light', undefined, {
        width: WIDTH,
        height: 500,
      })
    );
    const polys = [...svg.matchAll(/<polygon points="([^"]+)"/g)].map((m) =>
      m[1]!.split(' ').map((p) => p.split(',').map(Number))
    );
    expect(polys).toHaveLength(3);
    for (const pts of polys)
      for (const [x] of pts) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(WIDTH);
      }
    // The top band spans the whole plot.
    const top = polys[0]!;
    expect(top[1]![0]! - top[0]![0]!).toBeGreaterThanOrEqual(MIN_PLOT);

    const labels = [
      ...svg.matchAll(/<text([^>]*class="dgmo-ptlabel"[^>]*)>([^<]*)</g),
    ];
    expect(labels.length).toBeGreaterThan(3); // the long names wrapped
    for (const [, a, text] of labels) {
      const x = Number(a!.match(/ x="([^"]+)"/)![1]);
      const fs = Number(a!.match(/font-size="([^"]+)"/)![1]);
      const w = measureText(text!, fs, { bold: true });
      const anchor = a!.match(/text-anchor="([^"]+)"/)![1];
      if (anchor === 'end') expect(x - w).toBeGreaterThanOrEqual(0);
      else expect(x + w).toBeLessThanOrEqual(WIDTH);
    }
    // The cut names end in … and keep their full text.
    expect(svg).toMatch(/…</);
    expect(svg).toContain(`data-full-text="${LONG}"`);
    expect(svg).not.toContain('<title');
  });

  it('short names draw unwrapped and uncut', async () => {
    const svg = await renderDataChartD3(
      'funnel T\n\nA 1000\nB 500\nC 200',
      'light'
    );
    expect(svg).not.toContain('…');
    expect(svg).not.toContain('data-full-text');
  });
});
