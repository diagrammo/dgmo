import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { layoutMap } from '../src/map/layout';
import { loadMapData } from '../src/map/load-data';
import { mapLegendBox } from '../src/map/legend-band';
import { getPalette } from '../src/palettes';
import { measureLegendText } from '../src/utils/legend-constants';

// #1990: a North America data map with a value ramp drew the context name
// "Canada" (22px) with its letters inside the top-centre legend's box. The label
// passed the collision check because its box was centred on the text BASELINE,
// while the glyphs rise above it.
const SRC = `map Change in Median Rent, 2025 to 2026, by State (percent)
region-heat Change in median rent (%)
scale diverging 0

California heat: -3.8
Oregon heat: -1.25
Washington heat: -0.4
Montana heat: 0.3
Idaho heat: 4.75
Texas heat: 3.4
Florida heat: 18.5
Maine heat: -0.05
`;

// Inter's cap height and ascender are ~0.72em above the baseline.
const ASCENT = 0.72;

describe('map legend stays clear of basemap labels (#1990)', () => {
  it.each([
    [800, 600],
    [1100, 750],
    [1200, 800],
  ])('no drawn label intrudes on the legend box at %ix%i', async (w, h) => {
    const data = await loadMapData();
    const resolved = resolveMap(parseMap(SRC), data);
    const layout = layoutMap(
      resolved,
      data,
      { width: w, height: h },
      {
        palette: getPalette('nord').light,
        isDark: false,
        legendMode: 'export',
      }
    );
    const box = mapLegendBox(layout.legend, {
      width: w,
      mode: 'export',
      hasTitle: Boolean(layout.title),
      hasSubtitle: Boolean(layout.subtitle),
    });
    expect(box).not.toBeNull();
    // The fixture is only a reproduction while Canada is drawn near the top.
    expect(layout.labels.some((l) => l.text === 'Canada')).toBe(true);

    const intruders = layout.labels
      .filter((l) => !l.hidden)
      .filter((l) => {
        const fs = l.fontSize ?? 11;
        const lines = l.lines ?? [l.text];
        const stride = fs + 2;
        const tw = Math.max(...lines.map((s) => measureLegendText(s, fs)));
        const x0 =
          l.anchor === 'middle'
            ? l.x - tw / 2
            : l.anchor === 'end'
              ? l.x - tw
              : l.x;
        const firstBase = l.y - ((lines.length - 1) / 2) * stride;
        const top = firstBase - ASCENT * fs;
        const bottom = firstBase + (lines.length - 1) * stride;
        return (
          x0 < box!.x + box!.width &&
          x0 + tw > box!.x &&
          top < box!.y + box!.height &&
          bottom > box!.y
        );
      })
      .map((l) => `${l.text} @ ${l.y.toFixed(1)}`);
    expect(intruders).toEqual([]);
  });
});
