// Dense line points (#2203): when neighbouring points sit closer than a few
// dot widths, the resting dots go (r=0) so the line reads; hover grows the
// nearest one. Dots that carry data — a reached target, an extreme — stay.
import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3';
import { getPalette } from '../src/palettes';
import { parseChart } from '../src/chart';
import { readFileSync } from 'node:fs';

const palette = getPalette('nord').light;

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => `P${i} ${50 + ((i * 37) % 41)}`).join(
    '\n'
  );
const radii = (svg: string) =>
  [...svg.matchAll(/<circle[^>]*class="dgmo-pt"[^>]*>/g)].map((m) =>
    Number(/ r="([^"]*)"/.exec(m[0])![1])
  );

describe('line points — resting dots by density (#2203)', () => {
  it('keeps a dot on every point when the points are spread out', async () => {
    const svg = await renderDataChartD3(
      `line Sparse\nno-extremes\n\n${rows(10)}`,
      'light',
      palette,
      { width: 600 }
    );
    const r = radii(svg);
    expect(r).toHaveLength(10);
    expect(r.every((x) => x > 0)).toBe(true);
  });

  it('drops resting dots when points are packed, but keeps them hoverable', async () => {
    const svg = await renderDataChartD3(
      `line Dense\nno-extremes\n\n${rows(60)}`,
      'light',
      palette,
      { width: 480 }
    );
    const r = radii(svg);
    // Still in the DOM, so the crosshair finds and grows the nearest one.
    expect(r).toHaveLength(60);
    expect(r.every((x) => x === 0)).toBe(true);
  });

  it('follows the rendered width, not the point count', async () => {
    const src = `line Same data\nno-extremes\n\n${rows(30)}`;
    const wide = radii(
      await renderDataChartD3(src, 'light', palette, { width: 1600 })
    );
    const narrow = radii(
      await renderDataChartD3(src, 'light', palette, { width: 400 })
    );
    expect(wide.every((x) => x > 0)).toBe(true);
    expect(narrow.every((x) => x === 0)).toBe(true);
  });

  it('keeps the dots that carry data: extremes and a reached target', async () => {
    const ext = radii(
      await renderDataChartD3(`line Dense\n\n${rows(60)}`, 'light', palette, {
        width: 480,
      })
    );
    expect(ext.filter((x) => x > 0).length).toBeGreaterThanOrEqual(2);
    expect(ext.filter((x) => x > 0).length).toBeLessThan(10);

    const tgt = radii(
      await renderDataChartD3(
        `line Dense\nno-extremes\ntarget 88\n\n${rows(60)}`,
        'light',
        palette,
        { width: 480 }
      )
    );
    const reached = rows(60)
      .split('\n')
      .filter((l) => Number(l.split(' ')[1]) >= 88).length;
    expect(reached).toBeGreaterThan(0);
    expect(tgt.filter((x) => x > 0)).toHaveLength(reached);
  });

  it('the gallery fixture parses clean and keeps only its extremes dots', async () => {
    const src = readFileSync('gallery/fixtures/line-dense.dgmo', 'utf8');
    expect(parseChart(src, palette).diagnostics).toEqual([]);
    const r = radii(await renderDataChartD3(src, 'light', palette));
    expect(r).toHaveLength(240);
    expect(r.filter((x) => x > 0)).toHaveLength(4);
  });

  it('prints values only where dots would be: the last point when dense (#2209)', async () => {
    // Value labels carry no class; count 12px text against the same chart
    // under no-value, so axis and title text cancel out.
    const texts = (svg: string) =>
      (svg.match(/<text[^>]*font-size="12"/g) ?? []).length;
    const values = async (src: string, width: number) =>
      texts(
        await renderDataChartD3(`line C\n\n${src}`, 'light', palette, { width })
      ) -
      texts(
        await renderDataChartD3(
          `line C\nno-value\n\n${src}`,
          'light',
          palette,
          { width }
        )
      );
    expect(await values(rows(60), 480)).toBe(1);
    expect(await values(rows(10), 600)).toBeGreaterThan(1);
  });
});
