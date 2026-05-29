import { describe, it, expect } from 'vitest';
import { render } from '../src/render';
import { parseDgmoChartType, getRenderCategory } from '../src/dgmo-router';
import { parseFirstLine, ALL_CHART_TYPES } from '../src/utils/parsing';

describe('map router + render() wiring (step 5)', () => {
  it('detects map from the explicit first line (AC1)', () => {
    expect(parseDgmoChartType('map\npoi Tokyo')).toBe('map');
    expect(parseFirstLine('map My Title')).toEqual({
      chartType: 'map',
      title: 'My Title',
    });
    expect(ALL_CHART_TYPES.has('map')).toBe(true);
  });

  it('map is a visualization category (AC2)', () => {
    expect(getRenderCategory('map')).toBe('visualization');
  });

  it('render() produces a map SVG with regions + background (AC4)', async () => {
    const { svg } = await render('map\nCalifornia score: 92');
    expect(svg).toContain('<svg');
    expect(svg).toContain('dgmo-map-regions');
    expect(svg).toContain('<path');
  });

  it('render() draws POIs + an edge end-to-end via the real gazetteer (AC5)', async () => {
    const { svg } = await render('map\npoi Tokyo\npoi Osaka\nTokyo -> Osaka');
    expect(svg).toContain('dgmo-map-pois');
    expect(svg).toContain('<circle');
    expect(svg).toContain('dgmo-map-legs');
  });

  it('empty and partial maps still render, never empty/throw (AC6)', async () => {
    const empty = await render('map');
    expect(empty.svg).toContain('<svg');
    expect(empty.svg).toContain('dgmo-map-regions');

    // A POI that fails to geocode is dropped; the base map still renders and
    // render() does not throw.
    const partial = await render('map\npoi Nowheresville');
    expect(partial.svg).toContain('<svg');
    expect(partial.svg).toContain('dgmo-map-regions');
  });

  it('surfaces resolver diagnostics (unknown place) through render()', async () => {
    const { diagnostics } = await render('map\npoi Nowheresville');
    expect(
      diagnostics.some(
        (d) => d.severity === 'error' && /Nowheresville/.test(d.message)
      )
    ).toBe(true);
  });

  it('a fully-valid map reports no diagnostics', async () => {
    const { diagnostics } = await render('map\nCalifornia score: 50');
    expect(diagnostics).toHaveLength(0);
  });

  it('renders in dark theme without throwing', async () => {
    const { svg } = await render('map\nCalifornia score: 5', {
      theme: 'dark',
    });
    expect(svg).toContain('<svg');
  });
});
