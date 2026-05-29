import { describe, it, expect } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { renderMap, renderMapForExport } from '../src/map/renderer';
import { getPalette } from '../src/palettes';
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
    expect(bg?.getAttribute('fill')).toBe(P.bg);
    expect(
      svg.querySelectorAll('.dgmo-map-regions path').length
    ).toBeGreaterThan(0);
  });

  it('on-map labels carry a paint-order halo (AC16)', () => {
    const svg = render('map\npoi Tokyo');
    expect(svg.innerHTML).toContain('paint-order');
  });

  it('no-legend suppresses the legend group (AC17)', () => {
    const svg = render('map\nno-legend\nCalifornia score: 5');
    expect(svg.querySelector('.dgmo-map-legend')).toBeNull();
  });

  it('region paths carry data-line-number and fire onClickItem (AC21)', () => {
    let clicked: number | null = null;
    const svg = render('map\nCalifornia score: 5', (n) => (clicked = n));
    const target = svg.querySelector<SVGPathElement>(
      '.dgmo-map-regions path[data-line-number]'
    );
    expect(target).toBeTruthy();
    const ln = Number(target!.getAttribute('data-line-number'));
    expect(ln).toBeGreaterThanOrEqual(0);
    target!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(clicked).toBe(ln);
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

  it('categorical legend group + ramp keys are emitted (AC24)', () => {
    const tag = render(
      'map\ntag M as m\n  HQ blue\nactive-tag M\nUnited States m: HQ'
    );
    expect(tag.querySelector('.dgmo-map-legend')).toBeTruthy();
    const ramp = render('map\nmetric Sales\nCalifornia score: 50');
    expect(ramp.querySelector('.dgmo-map-legend-keys')).toBeTruthy();
  });
});
