// BL-122 — clock channel on map POIs (parse + tz resolution). The card RENDER is
// covered separately; here we lock the directive parse and the `tz:` bridge.
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

describe('map clock channel — directive parse', () => {
  it('`clock` is a bare flag on the header', () => {
    const p = parseMap('map\nclock\npoi 35.68 139.76 as Tokyo');
    expect(p.directives.clock).toBe(true);
  });

  it('`hours` / `days` capture the availability window raw', () => {
    const p = parseMap('map\nclock\nhours 9-17\ndays mon-fri\npoi 1 2 as A');
    expect(p.directives.clockHours).toBe('9-17');
    expect(p.directives.clockDays).toBe('mon-fri');
  });

  it('clock is off by default', () => {
    const p = parseMap('map\npoi 1 2 as A');
    expect(p.directives.clock).toBeUndefined();
  });
});

describe('map clock channel — tz resolution', () => {
  it('explicit IANA `tz:` resolves when clock is on', () => {
    const r = resolve('map\nclock\npoi 35.68 139.76 as Tokyo tz: Asia/Tokyo');
    expect(r.pois[0]?.tz).toBe('Asia/Tokyo');
    expect(r.pois[0]?.tzFixedOffsetMin).toBeUndefined();
  });

  it('fixed-offset `tz: UTC+9` → canonical label + offset minutes', () => {
    const r = resolve('map\nclock\npoi 35.68 139.76 as Tokyo tz: UTC+9');
    expect(r.pois[0]?.tz).toBe('UTC+9');
    expect(r.pois[0]?.tzFixedOffsetMin).toBe(540);
  });

  it('half-hour fixed offset (`tz: UTC+5:30`) parses', () => {
    const r = resolve('map\nclock\npoi 19 72 as Mumbai tz: UTC+5:30');
    expect(r.pois[0]?.tz).toBe('UTC+5:30');
    expect(r.pois[0]?.tzFixedOffsetMin).toBe(330);
  });

  it('a stray `tz:` is inert when clock is OFF (no card, no warn)', () => {
    const r = resolve('map\npoi 35.68 139.76 as Tokyo tz: Asia/Tokyo');
    expect(r.pois[0]?.tz).toBeUndefined();
    expect(r.diagnostics.some((d) => d.code === 'W_MAP_CLOCK_TZ_INVALID')).toBe(
      false
    );
  });

  it('malformed `tz:` warns and omits the card (pin still resolves)', () => {
    const r = resolve('map\nclock\npoi 35.68 139.76 as Tokyo tz: Not/AZone');
    expect(r.pois[0]).toBeDefined();
    expect(r.pois[0]?.tz).toBeUndefined();
    expect(r.diagnostics.some((d) => d.code === 'W_MAP_CLOCK_TZ_INVALID')).toBe(
      true
    );
  });

  it('a pin with no `tz:` under an on clock simply gets no card', () => {
    const r = resolve('map\nclock\npoi 35.68 139.76 as Tokyo');
    expect(r.pois[0]?.tz).toBeUndefined();
  });
});

describe('map clock channel — card render (ticker contract)', () => {
  it('bakes a `data-dgmo-clock` card group per tz POI', () => {
    const svg = render('map\nclock\npoi 35.68 139.76 as Tokyo tz: Asia/Tokyo');
    const cards = svg.querySelectorAll('[data-dgmo-clock]');
    expect(cards.length).toBe(1);
    const g = cards[0]!;
    expect(g.getAttribute('data-dgmo-clock-zone')).toBe('Asia/Tokyo');
    // Digital-part anchors the shared ticker updates each second.
    expect(
      g.querySelector('[data-dgmo-clock-digital-part="main"]')
    ).toBeTruthy();
    expect(
      g.querySelector('[data-dgmo-clock-digital-part="sec"]')
    ).toBeTruthy();
    expect(g.querySelector('[data-dgmo-clock-status-dot]')).toBeTruthy();
    // Palette swatches for the palette-blind ticker.
    expect(g.getAttribute('data-dgmo-clock-c-ok')).toBeTruthy();
  });

  it('bakes coords so the ticker can flip day/night status', () => {
    const svg = render('map\nclock\npoi 35.68 139.76 as Tokyo tz: Asia/Tokyo');
    const g = svg.querySelector('[data-dgmo-clock]')!;
    expect(g.getAttribute('data-dgmo-clock-lat')).toBe('35.68');
    expect(g.getAttribute('data-dgmo-clock-lon')).toBe('139.76');
  });

  it('a fixed offset bakes `-fixed-offset` and no sun', () => {
    const svg = render('map\nclock\npoi 35.68 139.76 as T tz: UTC+9');
    const g = svg.querySelector('[data-dgmo-clock]')!;
    expect(g.getAttribute('data-dgmo-clock-fixed-offset')).toBe('540');
    expect(g.getAttribute('data-dgmo-clock-sun')).toBe('0');
  });

  it('bakes the work window + a live status anchor when hours are set', () => {
    const svg = render(
      'map\nclock\nhours 9-17\ndays mon-fri\npoi 35.68 139.76 as T tz: Asia/Tokyo'
    );
    const g = svg.querySelector('[data-dgmo-clock]')!;
    expect(g.getAttribute('data-dgmo-clock-work-start')).toBe('540');
    expect(g.getAttribute('data-dgmo-clock-work-end')).toBe('1020');
    expect(g.getAttribute('data-dgmo-clock-work-days')).toBe(
      'Mon,Tue,Wed,Thu,Fri'
    );
    expect(g.querySelector('[data-dgmo-clock-status]')).toBeTruthy();
  });

  it('renders no cards when the clock directive is off', () => {
    const svg = render('map\npoi 35.68 139.76 as Tokyo tz: Asia/Tokyo');
    expect(svg.querySelectorAll('[data-dgmo-clock]').length).toBe(0);
  });

  it('skips a tz-less pin (no card) but still renders the map', () => {
    const svg = render('map\nclock\npoi 35.68 139.76 as Tokyo');
    expect(svg.querySelectorAll('[data-dgmo-clock]').length).toBe(0);
    expect(svg).toBeTruthy();
  });
});
