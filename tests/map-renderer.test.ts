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
  waterBodies: {
    entries: [
      [20, -40, 'North Atlantic Ocean', 0, 'ocean'],
      [0, -150, 'North Pacific Ocean', 0, 'ocean'],
      [-30, 0, 'South Atlantic Ocean', 0, 'ocean'],
      [10, 70, 'Indian Ocean', 0, 'ocean'],
    ],
  },
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
    // Ocean / backdrop is the faded blue water tint (see WATER_TINT_LIGHT).
    expect(bg?.getAttribute('fill')).toBe(mix(P.colors.blue, P.bg, 13));
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

  it('route legs + leg labels carry data-line-number and fire onClickItem', () => {
    let clicked: number | null = null;
    // Leg line is line 3 (`  -ferry-> Osaka value: 40`).
    const svg = render(
      'map\nroute Tokyo\n  -ferry-> Osaka value: 40',
      (n) => (clicked = n)
    );
    const path = svg.querySelector<SVGPathElement>(
      '.dgmo-map-legs path[data-line-number]'
    );
    expect(path).toBeTruthy();
    expect(Number(path!.getAttribute('data-line-number'))).toBe(3);
    path!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(clicked).toBe(3);
    // The in-arrow "ferry" label is clickable too.
    const label = svg.querySelector<SVGTextElement>(
      '.dgmo-map-legs text[data-line-number]'
    );
    expect(label).toBeTruthy();
    expect(Number(label!.getAttribute('data-line-number'))).toBe(3);
  });

  it('POI labels carry data-line-number and fire onClickItem', () => {
    let clicked: number | null = null;
    // POI line is line 2 (`poi Tokyo`).
    const svg = render('map\npoi Tokyo', (n) => (clicked = n));
    const label = svg.querySelector<SVGTextElement>(
      '.dgmo-map-labels text[data-line-number]'
    );
    expect(label).toBeTruthy();
    expect(Number(label!.getAttribute('data-line-number'))).toBe(2);
    label!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(clicked).toBe(2);
  });

  it('POI marker + label share a data-poi id (label-hover spotlight)', () => {
    const svg = render('map\npoi Tokyo');
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

  it('renders the caption directive (AC4)', () => {
    const svg = render('map My Title\ncaption A note\npoi Tokyo');
    expect(svg.textContent).toContain('A note');
  });

  it('relief default-on (dataless world); no-relief removes it (AC8)', () => {
    expect(render('map').querySelector('.dgmo-map-relief')).toBeTruthy();
    expect(
      render('map\nno-relief').querySelector('.dgmo-map-relief')
    ).toBeNull();
  });

  it('`relief` → hachure lines clipped to a range-union clipPath (AC3)', () => {
    const svg = render('map');
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

  it('relief still renders on a data map (always on; only `no-relief` hides it)', () => {
    // Relief is unconditional now: a region value no longer suppresses it — the
    // renderer lays the hachure atop the data fills. The group must be present,
    // and `no-relief` is the only switch that removes it.
    expect(
      render('map\nUnited States value: 5').querySelector('.dgmo-map-relief')
    ).toBeTruthy();
    expect(
      render('map\nUnited States value: 5\nno-relief').querySelector(
        '.dgmo-map-relief'
      )
    ).toBeNull();
  });

  it('coastline default-on; no-coastline removes the water-lines group (AC2)', () => {
    expect(render('map').querySelector('.dgmo-map-water-lines')).toBeTruthy();
    expect(
      render('map\nno-coastline').querySelector('.dgmo-map-water-lines')
    ).toBeNull();
    expect(
      render('map\nno-coastline').querySelector('mask#dgmo-map-water-mask')
    ).toBeNull();
  });

  it('`coastline` → masked water-lines group with stroked region paths (AC1)', () => {
    const svg = render('map');
    const group = svg.querySelector('.dgmo-map-water-lines');
    expect(group).toBeTruthy();
    // Masked to the water side (NOT a clipPath — a mask can subtract land).
    expect(group!.getAttribute('mask')).toBe('url(#dgmo-map-water-mask)');
    // 2 lines × (colour + water overdraw) passes → multiple stroked paths.
    expect(group!.getAttribute('fill')).toBe('none'); // rings stroked, not filled
    const paths = group!.querySelectorAll('path');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]!.getAttribute('stroke-linejoin')).toBe('round');
  });

  it('water mask = white canvas − black land + userSpaceOnUse (AC2)', () => {
    const svg = render('map');
    const mask = svg.querySelector('mask#dgmo-map-water-mask')!;
    expect(mask).toBeTruthy();
    // userSpaceOnUse so the reveal reaches the canvas edges (round-2 #2).
    expect(mask.getAttribute('maskUnits')).toBe('userSpaceOnUse');
    // White reveal rect + ≥1 black land path (land + its borders self-remove).
    const whites = [...mask.querySelectorAll('rect, path')].filter(
      (n) => n.getAttribute('fill') === 'white'
    );
    const blacks = [...mask.querySelectorAll('rect, path')].filter(
      (n) => n.getAttribute('fill') === 'black'
    );
    expect(whites.length).toBeGreaterThan(0);
    expect(blacks.length).toBeGreaterThan(0);
    // A land region's own path appears (black) in the mask, so any band along
    // its land/land border falls on hidden land (AC2).
    const usD = svg
      .querySelector<SVGPathElement>('.dgmo-map-regions path')!
      .getAttribute('d');
    const maskDs = [...mask.querySelectorAll('path')].map((p) =>
      p.getAttribute('d')
    );
    expect(maskDs).toContain(usD);
  });

  it('water-lines are decorative — no data attributes (AC1)', () => {
    const group = render('map').querySelector('.dgmo-map-water-lines')!;
    expect(group.querySelector('[data-line-number]')).toBeNull();
    expect(group.querySelector('[data-region]')).toBeNull();
  });

  it('outer band is the widest stroke + each colour band exceeds its overdraw → a ring survives (AC1)', () => {
    const group = render('map').querySelector('.dgmo-map-water-lines')!;
    const paths = [...group.querySelectorAll('path')];
    // Colour bands carry stroke-opacity; flat-water overdraws do not.
    const colour = paths.filter((p) => p.getAttribute('stroke-opacity'));
    const water = paths.filter((p) => !p.getAttribute('stroke-opacity'));
    expect(colour.length).toBeGreaterThan(0);
    expect(water.length).toBeGreaterThan(0);
    const cw = colour.map((p) => Number(p.getAttribute('stroke-width')));
    const ww = water.map((p) => Number(p.getAttribute('stroke-width')));
    const all = paths.map((p) => Number(p.getAttribute('stroke-width')));
    // One distinct colour-band width per ring: 2·(d_k+t), d_k stepping outward.
    expect(new Set(cw).size).toBe(5);
    // The widest stroke overall is a colour band (the outer line) — NOT a water
    // overdraw — so the outer ring is never fully eroded.
    expect(Math.max(...cw)).toBe(Math.max(...all));
    expect(Math.max(...cw)).toBeGreaterThan(Math.max(...ww));
  });

  it('water mask is a single white reveal rect with NO frame band — rings carry to every edge (AC2b)', () => {
    const mask = render('map').querySelector('mask#dgmo-map-water-mask')!;
    const rects = [...mask.querySelectorAll('rect')];
    // Exactly one white full-canvas reveal rect; no black frame-band rects (the
    // mask's black land paths already hide any synthetic frame-cut edge).
    expect(
      rects.filter((r) => r.getAttribute('fill') === 'white')
    ).toHaveLength(1);
    expect(
      rects.filter((r) => r.getAttribute('fill') === 'black')
    ).toHaveLength(0);
  });

  it('re-strokes coast outlines inside the masked group so coastlines stay crisp (not faded by the erosion overdraw)', () => {
    const group = render('map').querySelector('.dgmo-map-water-lines')!;
    // The restroke pass appends one plain region outline per region (stroke, no
    // stroke-opacity, width 0.5) on TOP of the ring passes.
    const restrokes = [...group.querySelectorAll('path')].filter(
      (p) =>
        !p.getAttribute('stroke-opacity') &&
        p.getAttribute('stroke-width') === '0.5'
    );
    expect(restrokes.length).toBeGreaterThan(0);
  });

  it('lakes are re-revealed as water in the mask (white path), land stays black (AC5)', () => {
    const data: MapData = {
      ...DATA,
      lakes: rectTopo('lakes', [
        { id: 'lake-0', name: 'Big Lake', box: [-100, 38, -95, 43] },
      ]),
    };
    const el = document.createElement('div');
    renderMap(
      el,
      resolveMap(parseMap('map'), data),
      data,
      P,
      false,
      undefined,
      DIMS
    );
    const mask = el.querySelector('mask#dgmo-map-water-mask')!;
    const whitePaths = [...mask.querySelectorAll('path')].filter(
      (p) => p.getAttribute('fill') === 'white'
    );
    const blackPaths = [...mask.querySelectorAll('path')].filter(
      (p) => p.getAttribute('fill') === 'black'
    );
    expect(whitePaths.length).toBeGreaterThan(0); // lake interior re-revealed
    expect(blackPaths.length).toBeGreaterThan(0); // land hidden
    // Control: no lakes → no white PATHS (only the white reveal rect).
    const noLake = render('map').querySelector('mask#dgmo-map-water-mask')!;
    expect(
      [...noLake.querySelectorAll('path')].filter(
        (p) => p.getAttribute('fill') === 'white'
      )
    ).toHaveLength(0);
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

describe('renderer — coincident-stack spiderfy + hover-only (AC1/AC8)', () => {
  // 8 co-located POIs collapse into ONE spiderfy stack.
  const STACK_SRC =
    'map\n' +
    Array.from({ length: 8 }, (_, i) => `poi 0 0 as poi${i}long`).join('\n');
  // A dense-but-DISTINCT compact chain (US corners anchor the fit) still goes
  // hover-only — no stack, no badge.
  const HOVER_SRC = [
    'map',
    'poi 49 -124 as anchorNW',
    'poi 26 -67 as anchorSE',
    ...Array.from(
      { length: 8 },
      (_, i) => `poi ${38 + i * 0.6} ${-100 - i * 0.6} as mid${i}long`
    ),
  ].join('\n');

  // US-only data so the hover-only chain fits locally (the shared DATA includes
  // Japan, which compresses US POIs into an overlapping stack).
  const US_ONLY = {
    worldCoarse: rectTopo('countries', [
      { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    ]),
    worldDetail: rectTopo('countries', [
      { id: 'US', name: 'United States', box: [-125, 25, -66, 49] },
    ]),
    usStates: rectTopo('states', []),
    gazetteer: { cities: [], byName: {}, alt: {} },
  } as unknown as MapData;

  // Preview render: NO exportDims (param 7 undefined). renderMap reads the
  // container size when exportDims is absent; jsdom reports 0, so stub it.
  function renderPreview(src: string, data: MapData = DATA): SVGSVGElement {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: 800 });
    Object.defineProperty(el, 'clientHeight', { value: 600 });
    renderMap(el, resolveMap(parseMap(src), data), data, P, false, undefined);
    return el.querySelector('svg')!;
  }
  function renderExport(src: string, data: MapData): SVGSVGElement {
    const el = document.createElement('div');
    renderMap(
      el,
      resolveMap(parseMap(src), data),
      data,
      P,
      false,
      undefined,
      DIMS
    );
    return el.querySelector('svg')!;
  }

  it('preview emits a hidden collapse badge + visible spiderfied members', () => {
    const svg = renderPreview(STACK_SRC);
    // One collapsed badge, hidden by default (the app reveals it at rest).
    const badges = svg.querySelectorAll('[data-cluster]');
    expect(badges.length).toBe(1);
    expect((badges[0] as SVGGElement).style.opacity).toBe('0');
    // All 8 member dots/labels/legs present and tagged for app collapse.
    expect(
      svg.querySelectorAll('[data-cluster-member]').length
    ).toBeGreaterThanOrEqual(8);
    // Members are spiderfied, NOT hover-only.
    expect(svg.querySelectorAll('[data-poi-hidden]').length).toBe(0);
  });

  it('export shows every spiderfied label and NO collapse badge (AC8)', () => {
    const svg = render(STACK_SRC);
    expect(svg.querySelectorAll('[data-cluster]').length).toBe(0);
    // One text label per member (members are now labelled via a leader-lined
    // column; each row is a <text> plus a <line> leader, both tagged for the
    // app's collapse toggle — count text only here).
    const memberLabels = svg.querySelectorAll(
      '.dgmo-map-labels text[data-cluster-member]'
    );
    expect(memberLabels.length).toBe(8);
    // Each labelled member also carries a leader line tagged for the toggle.
    expect(
      svg.querySelectorAll('.dgmo-map-labels line[data-cluster-member]').length
    ).toBe(8);
  });

  it('dense-but-distinct chain stays hover-only: preview hides, export omits', () => {
    const preview = renderPreview(HOVER_SRC, US_ONLY);
    const hidden =
      preview.querySelectorAll<SVGTextElement>('[data-poi-hidden]');
    expect(hidden.length).toBe(8); // the 8 mid POIs
    for (const el of Array.from(hidden)) {
      expect(el.style.opacity).toBe('0');
      expect(el.style.pointerEvents).toBe('none');
      expect(el.getAttribute('data-poi')).toBeTruthy();
    }
    // No stack badge for a distinct chain.
    expect(preview.querySelectorAll('[data-cluster]').length).toBe(0);
    // Export omits hover-only labels entirely.
    expect(
      renderExport(HOVER_SRC, US_ONLY).querySelectorAll('[data-poi-hidden]')
        .length
    ).toBe(0);
  });
});

describe('context labels — cartographic styling (AC12)', () => {
  it('water context labels render italic + letter-spaced + haloed <text>', () => {
    // Offshore POIs frame open ocean so the North Atlantic anchor lands in clear
    // water (over land it would be excluded — water names belong over water).
    const svg = render('map\npoi 22 -42\npoi 18 -38');
    const labels = [...svg.querySelectorAll('.dgmo-map-labels text')];
    const italic = labels.filter(
      (t) => t.getAttribute('font-style') === 'italic'
    );
    expect(italic.length).toBeGreaterThan(0);
    for (const t of italic) {
      expect(Number(t.getAttribute('letter-spacing'))).toBeGreaterThan(0);
      expect(t.getAttribute('paint-order')).toBe('stroke fill'); // halo
      expect(t.getAttribute('stroke')).toBeTruthy();
    }
  });
  it('off by default → no italic context text (no regression)', () => {
    const svg = render('map\npoi Tokyo\npoi 40 -74');
    const italic = [...svg.querySelectorAll('text')].filter(
      (t) => t.getAttribute('font-style') === 'italic'
    );
    expect(italic).toHaveLength(0);
  });
});
