import { describe, it, expect, vi } from 'vitest';
import { render } from '../src/render';
import { loadMapData } from '../src/map/load-data';
import { parseDgmoChartType, getRenderCategory } from '../src/dgmo-router';
import { parseFirstLine, ALL_CHART_TYPES } from '../src/utils/parsing';

// `render()` reaches for neither disk nor network on its own, so every map
// render here injects the Node loader the way the CLI does. Passing the
// FUNCTION rather than its result is the contract: it runs only when the
// content really is a map.
const withMapData = { mapData: loadMapData };

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
    const { svg } = await render('map\nCalifornia heat: 92', withMapData);
    expect(svg).toContain('<svg');
    expect(svg).toContain('dgmo-map-regions');
    expect(svg).toContain('<path');
  });

  it('render() draws POIs + an edge end-to-end via the real gazetteer (AC5)', async () => {
    const { svg } = await render(
      'map\npoi Tokyo\npoi Osaka\nTokyo -> Osaka',
      withMapData
    );
    expect(svg).toContain('dgmo-map-pois');
    expect(svg).toContain('<circle');
    expect(svg).toContain('dgmo-map-legs');
  });

  it('empty and partial maps still render, never empty/throw (AC6)', async () => {
    const empty = await render('map', withMapData);
    expect(empty.svg).toContain('<svg');
    expect(empty.svg).toContain('dgmo-map-regions');

    // A POI that fails to geocode is dropped; the base map still renders and
    // render() does not throw.
    const partial = await render('map\npoi Nowheresville', withMapData);
    expect(partial.svg).toContain('<svg');
    expect(partial.svg).toContain('dgmo-map-regions');
  });

  it('surfaces resolver diagnostics (unknown place) through render()', async () => {
    const { diagnostics } = await render('map\npoi Nowheresville', withMapData);
    expect(
      diagnostics.some(
        (d) => d.severity === 'error' && /Nowheresville/.test(d.message)
      )
    ).toBe(true);
  });

  it('a fully-valid map reports no diagnostics', async () => {
    const { diagnostics } = await render('map\nCalifornia heat: 50', {
      ...withMapData,
    });
    expect(diagnostics).toHaveLength(0);
  });

  it('renders in dark theme without throwing', async () => {
    const { svg } = await render('map\nCalifornia heat: 5', {
      ...withMapData,
      theme: 'dark',
    });
    expect(svg).toContain('<svg');
  });
});

describe('render() takes no environment it was not handed', () => {
  it('a map with no mapData renders empty and says why', async () => {
    const { svg, diagnostics } = await render('map\nCalifornia heat: 5');
    expect(svg).toBe('');
    const dx = diagnostics.find((d) => d.code === 'E_MAP_DATA_NOT_SUPPLIED');
    expect(dx, 'expected the missing-map-data diagnostic').toBeDefined();
    expect(dx!.severity).toBe('error');
    // The message has to name the fix, because the caller cannot see the
    // signature from a runtime failure.
    expect(dx!.message).toMatch(/mapData/);
  });

  it('accepts bundled data as well as a loader', async () => {
    const data = await loadMapData();
    const { svg, diagnostics } = await render('map\nCalifornia heat: 5', {
      mapData: data,
    });
    expect(svg).toContain('dgmo-map-regions');
    expect(diagnostics).toHaveLength(0);
  });

  it('does not call the loader for a chart that is not a map', async () => {
    const loader = vi.fn(loadMapData);
    const { svg } = await render('pie Languages\nTypeScript: 45\nRust: 55', {
      mapData: loader,
    });
    expect(svg).toContain('<svg');
    expect(loader).not.toHaveBeenCalled();
  });

  it('a loader that throws degrades to the same diagnostic, never a rejection', async () => {
    const { svg, diagnostics } = await render('map\nCalifornia heat: 5', {
      mapData: () => Promise.reject(new Error('no assets in this environment')),
    });
    expect(svg).toBe('');
    expect(diagnostics.some((d) => d.code === 'E_MAP_DATA_NOT_SUPPLIED')).toBe(
      true
    );
  });
});
