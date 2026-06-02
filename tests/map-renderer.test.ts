import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { renderMap, renderMapForExport } from '../src/map/renderer';
import { getPalette } from '../src/palettes';
import { mix } from '../src/palettes/color-utils';
import type { MapData } from '../src/map/resolved-types';
import type { BoundaryTopology, Gazetteer } from '../src/map/data/types';

function rectTopo(
  obj: string,
  geoms: Array<{
    id: string;
    name: string;
    box: [number, number, number, number];
  }>
): BoundaryTopology {
  const arcs = geoms.map((g) => {
    const [w, s, e, n] = g.box;
    return [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ];
  });
  return {
    type: 'Topology',
    arcs,
    objects: {
      [obj]: {
        type: 'GeometryCollection',
        geometries: geoms.map((g, i) => ({
          type: 'Polygon',
          id: g.id,
          properties: { name: g.name },
          arcs: [[i]],
        })),
      },
    },
  } as unknown as BoundaryTopology;
}

const gazetteer: Gazetteer = {
  cities: [
    [35.68, 139.69, 'JP', 9_000_000, 'Tokyo'],
    [34.69, 135.5, 'JP', 2_700_000, 'Osaka'],
  ],
  byName: { tokyo: [0], osaka: [1] },
  alt: {},
};

const DATA: MapData = {
  worldCoarse: rectTopo('countries', [
    { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    { id: 'JP', name: 'Japan', box: [129, 31, 146, 45] },
  ]),
  worldDetail: rectTopo('countries', [
    { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    { id: 'JP', name: 'Japan', box: [129, 31, 146, 45] },
  ]),
  usStates: rectTopo('states', [
    { id: 'US-CA', name: 'California', box: [-124, 32, -114, 42] },
  ]),
  mountainRanges: rectTopo('ranges', [
    { id: 'mtn-0', name: 'Rockies', box: [-120, 35, -105, 45] },
  ]),
  gazetteer,
};

const P = getPalette('nord').light;
const DIMS = { width: 800, height: 600 };

function render(src: string, onClick?: (n: number) => void): SVGSVGElement {
  const el = document.createElement('div');
  renderMap(el, resolveMap(parseMap(src), DATA), DATA, P, false, onClick, DIMS);
  return el.querySelector('svg')!;
}

describe('renderer — SVG output (AC1, AC16, AC17, AC21, AC22, AC24)', () => {
  it('emits an svg with a background rect + region paths (AC1)', () => {
    const svg = render('map');
    expect(svg).toBeTruthy();
    const bg = svg.querySelector('rect');
    // Ocean / backdrop is the blue water tint (see WATER_TINT).
    expect(bg?.getAttribute('fill')).toBe(mix(P.colors.blue, P.bg, 55));
    expect(
      svg.querySelectorAll('.dgmo-map-regions path').length
    ).toBeGreaterThan(0);
  });

  it('on-map labels carry a paint-order halo (AC16)', () => {
    const svg = render('map\npoi Tokyo');
    expect(svg.innerHTML).toContain('paint-order');
  });

  it('no-legend suppresses the legend group (AC17)', () => {
    const svg = render('map\nno-legend\nCalifornia value: 5');
    expect(svg.querySelector('.dgmo-map-legend')).toBeNull();
  });

  it('region paths carry data-line-number and fire onClickItem (AC21)', () => {
    let clicked: number | null = null;
    const svg = render('map\nCalifornia value: 5', (n) => (clicked = n));
    const target = svg.querySelector<SVGPathElement>(
      '.dgmo-map-regions path[data-line-number]'
    );
    expect(target).toBeTruthy();
    const ln = Number(target!.getAttribute('data-line-number'));
    expect(ln).toBeGreaterThanOrEqual(0);
    target!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(clicked).toBe(ln);
  });

  it('POI marker + label share a data-poi id (label-hover spotlight)', () => {
    const svg = render('map\npoi-labels all\npoi Tokyo');
    const marker = svg.querySelector<SVGCircleElement>('circle[data-poi]');
    const label = svg.querySelector<SVGTextElement>('text[data-poi]');
    expect(marker).toBeTruthy();
    expect(label).toBeTruthy();
    expect(label!.getAttribute('data-poi')).toBe(
      marker!.getAttribute('data-poi')
    );
  });

  it('still renders an svg when the resolved map has errors (AC22)', () => {
    const el = document.createElement('div');
    const resolved = resolveMap(parseMap('map\npoi Nowheresville'), DATA);
    expect(resolved.error).not.toBeNull();
    expect(() =>
      renderMapForExport(el, resolved, DATA, P, false, DIMS)
    ).not.toThrow();
    expect(el.querySelector('svg')).toBeTruthy();
  });

  it('renders subtitle + caption directives', () => {
    const svg = render(
      'map My Title\nsubtitle A sub\ncaption A note\npoi Tokyo'
    );
    expect(svg.textContent).toContain('A sub');
    expect(svg.textContent).toContain('A note');
  });

  it('off by default → no relief group (AC2)', () => {
    expect(render('map').querySelector('.dgmo-map-relief')).toBeNull();
  });

  it('`relief` → hachure lines clipped to a range-union clipPath (AC3)', () => {
    const svg = render('map\nrelief');
    const group = svg.querySelector('.dgmo-map-relief');
    expect(group).toBeTruthy();
    // Clipped to the union of range paths.
    expect(group!.getAttribute('clip-path')).toBe('url(#dgmo-relief-clip)');
    const clip = svg.querySelector('defs clipPath#dgmo-relief-clip');
    expect(clip).toBeTruthy();
    expect(clip!.querySelectorAll('path').length).toBeGreaterThan(0);
    // Horizontal hachure lines (x spans, y constant).
    const lines = group!.querySelectorAll('line');
    expect(lines.length).toBeGreaterThan(0);
    const ln = lines[0]!;
    expect(ln.getAttribute('y1')).toBe(ln.getAttribute('y2'));
    // Decorative — no click target / line-number.
    expect(group!.querySelector('[data-line-number]')).toBeNull();
  });

  it('categorical group + score ramp both render in the top legend (AC24)', () => {
    const tag = render(
      'map\ntag M as m\n  HQ blue\nactive-tag M\nUnited States m: HQ'
    );
    expect(tag.querySelector('.dgmo-map-legend')).toBeTruthy();
    // The score ramp now lives in the top legend as a gradient group (not the
    // old bottom-right keys block).
    const ramp = render('map\nregion-metric Sales\nCalifornia value: 50');
    expect(ramp.querySelector('.dgmo-map-legend')).toBeTruthy();
    expect(
      ramp.querySelector('linearGradient[id^="dgmo-legend-ramp"]')
    ).toBeTruthy();
  });
});
