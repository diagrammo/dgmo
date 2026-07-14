// BL-122 — clock channel on map POIs. Bare `clock` activates a card and derives
// the zone from the place; a valued `clock: <zone>` names the zone (bare-coord
// pins / overrides). Card RENDER contract is asserted at the end.
import { describe, it, expect, beforeAll } from 'vitest';
import { parseMap } from '../src/map/parser';
import { resolveMap } from '../src/map/resolver';
import { renderMap } from '../src/map/renderer';
import { getPalette } from '../src/palettes';
import { loadMapData } from '../src/map/load-data';
import type { MapData } from '../src/map/resolved-types';

let DATA: MapData;
beforeAll(async () => {
  DATA = await loadMapData();
});

const resolve = (src: string) => resolveMap(parseMap(src), DATA);
const poi = (src: string) => resolve(src).pois[0];
const hasDiag = (src: string, code: string) =>
  resolve(src).diagnostics.some((d) => d.code === code);

const P = getPalette('nord').light;
const DIMS = { width: 800, height: 600 };
function render(src: string): SVGSVGElement {
  const el = document.createElement('div');
  renderMap(
    el,
    resolveMap(parseMap(src), DATA),
    DATA,
    P,
    false,
    undefined,
    DIMS
  );
  return el.querySelector('svg')!;
}

describe('map clock channel — the `clock` flag', () => {
  it('peels a trailing `clock` flag, leaving the place to resolve', () => {
    const p = parseMap('map\npoi Denver clock');
    expect(p.pois[0]?.clock).toBe(true);
    expect(p.pois[0]?.pos).toMatchObject({ kind: 'name', name: 'Denver' });
  });

  it('peels `clock` after an `as` alias', () => {
    const p = parseMap('map\npoi San Francisco as HQ clock');
    expect(p.pois[0]?.clock).toBe(true);
    expect(p.pois[0]?.alias).toBe('HQ');
    expect(p.pois[0]?.pos).toMatchObject({ name: 'San Francisco' });
  });

  it('valued `clock: <zone>` on a coord pin flags it + keeps the coords', () => {
    const p = parseMap('map\npoi 39.74 -104.98 as Field clock: America/Denver');
    expect(p.pois[0]?.clock).toBe(true);
    expect(p.pois[0]?.pos).toMatchObject({ kind: 'coords', lat: 39.74 });
    expect(p.pois[0]?.meta['clock']).toBe('America/Denver');
  });

  it('an unflagged pin is not a clock', () => {
    expect(parseMap('map\npoi Denver').pois[0]?.clock).toBeUndefined();
  });

  it('tolerates `clock` before a comma-separated `label:` (any order)', () => {
    for (const src of [
      'map\npoi Los Angeles clock, label: El Segundo',
      'map\npoi Los Angeles clock label: El Segundo',
      'map\npoi Los Angeles label: El Segundo clock',
    ]) {
      const r = resolve(src);
      expect(r.pois[0]?.name).toBe('Los Angeles');
      expect(r.pois[0]?.label).toBe('El Segundo');
      expect(r.pois[0]?.tz).toBe('America/Los_Angeles');
      expect(r.diagnostics).toHaveLength(0);
    }
  });

  it('tolerates a trailing comma after a bare `clock`', () => {
    const r = resolve('map\npoi Denver clock,');
    expect(r.pois[0]?.name).toBe('Denver');
    expect(r.pois[0]?.tz).toBe('America/Denver');
    expect(r.diagnostics).toHaveLength(0);
  });

  it('there is no header `clock` directive anymore', () => {
    // `clock` on its own line is not a directive → falls through to region-fill,
    // never sets a directive flag.
    const p = parseMap('map\nhours 9-17\npoi Denver clock');
    expect((p.directives as Record<string, unknown>)['clock']).toBeUndefined();
    expect(p.directives.clockHours).toBe('9-17');
  });
});

describe('map clock channel — zone derived from the place', () => {
  it('a named city auto-derives its IANA zone (no tz: needed)', () => {
    expect(poi('map\npoi Denver clock')?.tz).toBe('America/Denver');
  });

  it('a border city derives the correct zone (Austin = Central, not Mountain)', () => {
    expect(poi('map\npoi Austin clock')?.tz).toBe('America/Chicago');
  });

  it('an unflagged named city gets no zone (no card)', () => {
    expect(poi('map\npoi Denver')?.tz).toBeUndefined();
  });

  it('a bare-coord clock pin needs a zone — warns and gets no card', () => {
    const p = poi('map\npoi 39.74 -104.98 as Field clock');
    expect(p?.tz).toBeUndefined();
    expect(p).toBeDefined();
    expect(
      hasDiag('map\npoi 39.74 -104.98 as Field clock', 'W_MAP_CLOCK_TZ_NEEDED')
    ).toBe(true);
  });

  it('a coord pin with a valued `clock: <zone>` resolves', () => {
    expect(
      poi('map\npoi 39.74 -104.98 as Field clock: America/Denver')?.tz
    ).toBe('America/Denver');
  });
});

describe('map clock channel — valued `clock: <zone>` override', () => {
  it('a fixed offset (`clock: UTC+9`) → canonical label + minutes', () => {
    const p = poi('map\npoi 35.6 139.7 as T clock: UTC+9');
    expect(p?.tz).toBe('UTC+9');
    expect(p?.tzFixedOffsetMin).toBe(540);
  });

  it('overriding a city with a DIFFERENT IANA zone warns but is honored', () => {
    const src = 'map\npoi Denver clock: Asia/Tokyo';
    expect(poi(src)?.tz).toBe('Asia/Tokyo');
    expect(hasDiag(src, 'W_MAP_CLOCK_TZ_OVERRIDE')).toBe(true);
  });

  it('a fixed-offset override on a city is intentional — no warn', () => {
    // `clock: UTC` is a deliberate fixed offset, not a mis-derived IANA zone.
    expect(
      hasDiag('map\npoi Denver clock: UTC', 'W_MAP_CLOCK_TZ_OVERRIDE')
    ).toBe(false);
  });

  it('a valued clock: matching the city zone does NOT warn', () => {
    expect(
      hasDiag(
        'map\npoi Denver clock: America/Denver',
        'W_MAP_CLOCK_TZ_OVERRIDE'
      )
    ).toBe(false);
  });

  it('a malformed `clock:` warns and drops the card (pin still resolves)', () => {
    const src = 'map\npoi 1 2 as X clock: Not/AZone';
    expect(poi(src)).toBeDefined();
    expect(poi(src)?.tz).toBeUndefined();
    expect(hasDiag(src, 'W_MAP_CLOCK_TZ_INVALID')).toBe(true);
  });
});

describe('map clock channel — card render (ticker contract)', () => {
  it('bakes a `data-dgmo-clock` card per flagged, zoned POI', () => {
    const svg = render('map\nhours 9-17\ndays mon-fri\npoi Denver clock');
    const cards = svg.querySelectorAll('[data-dgmo-clock]');
    expect(cards.length).toBe(1);
    const g = cards[0]!;
    expect(g.getAttribute('data-dgmo-clock-zone')).toBe('America/Denver');
    expect(
      g.querySelector('[data-dgmo-clock-digital-part="main"]')
    ).toBeTruthy();
    expect(g.querySelector('[data-dgmo-clock-status-dot]')).toBeTruthy();
    expect(g.getAttribute('data-dgmo-clock-work-start')).toBe('540');
  });

  it('renders no cards when no pin is flagged', () => {
    const svg = render('map\npoi Denver\npoi Austin');
    expect(svg.querySelectorAll('[data-dgmo-clock]').length).toBe(0);
  });

  it('renders a card only for the flagged pin', () => {
    const svg = render('map\npoi Denver clock\npoi Austin');
    expect(svg.querySelectorAll('[data-dgmo-clock]').length).toBe(1);
  });
});
