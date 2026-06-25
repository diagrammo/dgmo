import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseEventLine } from '../src/event-line/parser';
import {
  renderEventLine,
  renderEventLineForExport,
} from '../src/event-line/renderer';
import { getPalette } from '../src/palettes';
import { getRenderCategory } from '../src/dgmo-router';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [k, value] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, k, { value, configurable: true });
  }
});

const nordLight = getPalette('nord').light;

function mount(w = 900, h = 500): HTMLDivElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: w });
  Object.defineProperty(container, 'clientHeight', { value: h });
  return container;
}

const TAGGED = `event-line Super Bowl Halftime Shows

tag Genre as g
  Pop blue
  R&B teal

2012-02-05 XLVI  g: Pop
  **Madonna** with LMFAO, Nicki Minaj.
  - Greek-temple set
  - Marching-band finale

2013-02-03 XLVII  g: R&B
  Beyoncé reunites Destiny's Child.`;

describe('event-line renderer', () => {
  it('routes through the visualization category', () => {
    expect(getRenderCategory('event-line')).toBe('visualization');
  });

  it('renders a spine, one dot per event, a title, and cards', () => {
    const parsed = parseEventLine(TAGGED, nordLight);
    const container = mount();
    renderEventLine(container, parsed, nordLight, false);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // one circle (dot) per event
    expect(svg!.querySelectorAll('.dgmo-event-dot').length).toBe(
      parsed.events.length
    );
    // title
    expect(svg!.querySelector('.chart-title')?.textContent).toBe(
      'Super Bowl Halftime Shows'
    );
    // cards (rects) — at least one per event
    expect(svg!.querySelectorAll('rect').length).toBeGreaterThanOrEqual(
      parsed.events.length
    );
    // a spine line + leader lines exist
    expect(svg!.querySelectorAll('line').length).toBeGreaterThanOrEqual(
      parsed.events.length
    );
    // legend root from the shared framework
    expect(svg!.querySelector('.dgmo-legend')).not.toBeNull();
  });

  it('renders the export path with fixed dimensions', () => {
    const parsed = parseEventLine(TAGGED, nordLight);
    const container = mount();
    renderEventLineForExport(container, parsed, nordLight, false, {
      width: 800,
      height: 500,
    });
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll('.dgmo-event-dot').length).toBe(
      parsed.events.length
    );
  });

  it('renders no-scale + side below without throwing', () => {
    const parsed = parseEventLine(
      `event-line X
no-scale
side below

1991 A
  one
1993 B
  two
1995 C
  three`,
      nordLight
    );
    const container = mount();
    expect(() =>
      renderEventLine(container, parsed, nordLight, false)
    ).not.toThrow();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders an untagged event-line (no legend) without throwing', () => {
    const parsed = parseEventLine(
      `event-line Plain

2020 A
  one
2021 B
  two`,
      nordLight
    );
    const container = mount();
    renderEventLine(container, parsed, nordLight, false);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.dgmo-legend')).toBeNull();
  });

  const ERAS = `event-line A History of the Web
no-scale

[The Early Web]
1991 WorldWideWeb
  one
1993 Mosaic
  two

[The Standards Era] collapsed: true
1995 JavaScript
  three
1996 CSS
  four

[The App Era]
2005 Ajax
  five`;

  it('draws an era bracket group per era, with as-authored labels', () => {
    const parsed = parseEventLine(ERAS, nordLight);
    const container = mount();
    renderEventLine(container, parsed, nordLight, false);
    const svg = container.querySelector('svg')!;
    const eraGroups = svg.querySelectorAll('g[data-era]');
    // 3 brackets + 1 collapsed summary card all carry data-era
    const names = new Set(
      [...eraGroups].map((g) => g.getAttribute('data-era'))
    );
    expect(names).toEqual(
      new Set(['The Early Web', 'The Standards Era', 'The App Era'])
    );
    // label text is verbatim (not upper-cased)
    expect(svg.textContent).toContain('The Early Web');
    expect(svg.textContent).not.toContain('THE EARLY WEB');
  });

  it('collapses an era into one event-like card with a bulleted member list', () => {
    const parsed = parseEventLine(ERAS, nordLight);
    const container = mount();
    renderEventLine(container, parsed, nordLight, false);
    const svg = container.querySelector('svg')!;
    // The collapsed era is a summary card (data-era-collapsed=true) ...
    const card = svg.querySelector('g[data-era-collapsed="true"]');
    expect(card).not.toBeNull();
    // ... listing its member events as bullets, and the two collapsed events
    // no longer render their own cards (only Early Web + App Era events do).
    expect(svg.textContent).toContain('1995 JavaScript');
    expect(svg.textContent).toContain('1996 CSS');
    // 3 visible events + 1 era summary = 4 dots
    expect(svg.querySelectorAll('.dgmo-event-dot').length).toBe(4);
  });

  it('places era brackets opposite the cards under `side below`', () => {
    const parsed = parseEventLine(
      `event-line X
side below

[Phase One]
2020 A
  one
2021 B
  two`,
      nordLight
    );
    const container = mount();
    renderEventLine(container, parsed, nordLight, false);
    const svg = container.querySelector('svg')!;
    const spineY = Number(svg.querySelector('line')!.getAttribute('y1'));
    const eraText = [...svg.querySelectorAll('g[data-era] text')].find(
      (t) => t.textContent === 'Phase One'
    )!;
    // cards are below → the era label sits ABOVE the spine
    expect(Number(eraText.getAttribute('y'))).toBeLessThan(spineY);
  });
});
