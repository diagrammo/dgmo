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

  // Regression, issue #122. `@diagrammo/dgmo-cli` 0.62.0 shipped with no map
  // data (#121); `loadMapData` threw a message naming every directory it had
  // looked in, and every layer above discarded it — so a broken install
  // surfaced as "the input may be invalid" and read as a bad diagram for an
  // afternoon. The loader's own words have to survive, or the next missing
  // asset costs the same afternoon.
  it("keeps the loader's own message, so a broken install is not read as a bad diagram", async () => {
    const { diagnostics } = await render('map\nCalifornia heat: 5', {
      mapData: () =>
        Promise.reject(
          new Error(
            'map data assets not found near /pkg/dist (looked in ./data, ./map-data)'
          )
        ),
    });
    const dx = diagnostics.find((d) => d.code === 'E_MAP_DATA_NOT_SUPPLIED');
    expect(dx, 'expected the missing-map-data diagnostic').toBeDefined();
    expect(dx!.message).toContain('map data assets not found near /pkg/dist');
    expect(dx!.message).toContain('./map-data');
  });

  it('tells a host that supplied nothing to supply something, and does not say that to one that tried', async () => {
    const { diagnostics: nothingSupplied } = await render(
      'map\nCalifornia heat: 5'
    );
    const missing = nothingSupplied.find(
      (d) => d.code === 'E_MAP_DATA_NOT_SUPPLIED'
    );
    // A host that passed nothing has a wiring bug: name the option.
    expect(missing!.message).toMatch(/pass `mapData`/);

    const { diagnostics: loaderFailed } = await render(
      'map\nCalifornia heat: 5',
      {
        mapData: () => Promise.reject(new Error('assets missing from package')),
      }
    );
    const failed = loaderFailed.find(
      (d) => d.code === 'E_MAP_DATA_NOT_SUPPLIED'
    );
    // A host that DID pass a loader has a broken install, not a wiring bug —
    // telling it to pass `mapData` sends the reader to the wrong file.
    expect(failed!.message).not.toMatch(/pass `mapData`/);
    expect(failed!.message).toContain('assets missing from package');
  });
});

describe('map SVG weight — region geometry is not copied into the relief clip (#1013)', () => {
  // dgmo-content's map/map-office-hours.dgmo: a world map with relief, the
  // corpus's heaviest SVG.
  const OFFICE_HOURS = [
    'map Follow-the-Sun Support Desk',
    '',
    'hours 9-17',
    'workweek mon-fri',
    '',
    'poi San Francisco clock label: West Coast',
    'poi London clock label: EMEA',
    'poi Singapore clock label: APAC',
    'poi Sydney clock label: Pacific',
  ].join('\n');

  it('the relief land clip references the drawn region paths instead of repeating their `d`', async () => {
    const { svg } = await render(OFFICE_HOURS, withMapData);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const clip = doc.querySelector('clipPath[id^="dgmo-relief-land__m"]')!;
    expect(clip).toBeTruthy();
    expect(clip.querySelectorAll('path')).toHaveLength(0);
    const land = [...doc.querySelectorAll('.dgmo-map-regions path[data-iso]')];
    const uses = [...clip.querySelectorAll('use')];
    expect(uses.length).toBe(land.length);
    for (const u of uses) {
      const target = doc.getElementById(u.getAttribute('href')!.slice(1));
      expect(target?.closest('.dgmo-map-regions')).toBeTruthy();
    }
    // Outside the label patch (a deliberate fill-only repaint), no region's
    // `d` is written as a second standalone path.
    const ds = new Map<string, number>();
    for (const p of doc.querySelectorAll('path[d]')) {
      if (p.closest('.dgmo-map-label-patch')) continue;
      const d = p.getAttribute('d')!;
      ds.set(d, (ds.get(d) ?? 0) + 1);
    }
    const copied = land.filter((p) => ds.get(p.getAttribute('d')!)! > 1);
    expect(copied).toHaveLength(0);
  });
});
