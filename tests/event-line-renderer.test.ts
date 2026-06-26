import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseEventLine } from '../src/event-line/parser';
import {
  renderEventLine,
  renderEventLineForExport,
  focusEventLine,
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
    // The collapsed era has NO dot — only the 3 visible events do; it terminates
    // on the spine as a ⊓ bracket (leader-weight stroke) instead.
    expect(svg.querySelectorAll('.dgmo-event-dot').length).toBe(3);
    const spineBracket = svg.querySelector(
      'g[data-era-collapsed="true"] path[stroke-width="1.5"]'
    );
    expect(spineBracket).not.toBeNull();
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

  // ── Layout: boxes never overlap, leaders fade across boxes ──
  const CARD_W = 210; // mirror of the renderer constant

  interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
  }
  function cardBoxes(svg: SVGSVGElement): Box[] {
    const boxes: Box[] = [];
    svg.querySelectorAll<SVGGElement>('g[data-line-number]').forEach((g) => {
      const rect = g.querySelector('rect');
      if (!rect) return; // era-bracket groups have no rect — skip
      const m = (g.getAttribute('transform') ?? '').match(
        /translate\(([-\d.]+),\s*([-\d.]+)\)/
      );
      if (!m) return;
      boxes.push({
        x: Number(m[1]),
        y: Number(m[2]),
        w: CARD_W,
        h: Number(rect.getAttribute('height') ?? 0),
      });
    });
    return boxes;
  }
  const overlaps = (a: Box, b: Box): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it('never lets two cards overlap, even when crowded', () => {
    // Many tight events on one side → would collide under the old right-clamp.
    const src = `event-line Crowded
no-scale
side above

2001 Alpha
  a short description here
2001 Bravo
  a short description here
2001 Charlie
  a short description here
2001 Delta
  a short description here
2001 Echo
  a short description here`;
    const parsed = parseEventLine(src, nordLight);
    const container = mount(700, 500);
    renderEventLine(container, parsed, nordLight, false);
    const boxes = cardBoxes(container.querySelector('svg')!);
    expect(boxes.length).toBe(5);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++)
        expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
  });

  it('fades a leader that must cross another card box', () => {
    // Coincident dates on one side stack into lanes; outer leaders cross the
    // inner boxes and must render faded, the innermost one stays solid.
    const src = `event-line Coincident
side above

2001-01-01 Alpha
  desc
2001-01-01 Bravo
  desc
2001-01-01 Charlie
  desc`;
    const parsed = parseEventLine(src, nordLight);
    const container = mount(900, 500);
    renderEventLine(container, parsed, nordLight, false);
    const opacities = [
      ...container.querySelectorAll<SVGLineElement>('line'),
    ].map((l) => l.getAttribute('stroke-opacity'));
    expect(opacities).toContain('0.18'); // ≥1 faded leader
    expect(opacities).toContain('0.65'); // ≥1 solid leader
  });

  it('colors each collapsed-era member bullet by its tag', () => {
    const src = `event-line Tagged Era
no-scale

tag Medium as m
  Film blue
  Series purple
  Special green

[Phase One] collapsed: true
  2008 Iron Man  m: Film
    one
  2011 WandaVision  m: Series
    two
  2012 One-Shot  m: Special
    three`;
    const parsed = parseEventLine(src, nordLight);
    const container = mount(900, 500);
    renderEventLine(container, parsed, nordLight, false);
    const card = container.querySelector('g[data-era-collapsed="true"]')!;
    const texts = [...card.querySelectorAll('text')];
    const bulletFills = texts
      .filter((t) => t.textContent === '•')
      .map((t) => t.getAttribute('fill'));
    expect(bulletFills.length).toBe(3);
    // three members, three different tags → three distinct bullet colors
    expect(new Set(bulletFills).size).toBe(3);
    // the member TEXT (not just the marker) is tag-colored too
    const memberFills = texts
      .filter((t) => /^\d{4}\s/.test(t.textContent ?? ''))
      .map((t) => t.getAttribute('fill'));
    expect(memberFills.length).toBe(3);
    expect(new Set(memberFills)).toEqual(new Set(bulletFills));
    // mixed tags → the era itself (its spine bracket) is neutral/black, NOT a tag color
    const bracket = container.querySelector(
      'g[data-era-collapsed="true"] path[stroke-width="1.5"]'
    )!;
    expect(bulletFills).not.toContain(bracket.getAttribute('stroke'));
  });

  it('colors a uniform-tag collapsed era by that shared tag', () => {
    const src = `event-line U
no-scale

tag T as t
  A blue
  B green

[Era] collapsed: true
  2001 X  t: A
    d
  2002 Y  t: A
    d`;
    const parsed = parseEventLine(src, nordLight);
    const container = mount();
    renderEventLine(container, parsed, nordLight, false);
    const card = container.querySelector('g[data-era-collapsed="true"]')!;
    const bulletFill = [...card.querySelectorAll('text')]
      .find((t) => t.textContent === '•')!
      .getAttribute('fill');
    const bracket = container.querySelector(
      'g[data-era-collapsed="true"] path[stroke-width="1.5"]'
    )!;
    // all members share tag A → the era takes that tag color
    expect(bracket.getAttribute('stroke')).toBe(bulletFill);
  });

  // A clustered timeline: many events bunched in time so the natural layout is
  // tall and narrow. Used to exercise lane packing + adaptive width.
  const CLUSTERED = `event-line Crunch

[A]
  2020-01-01 e1
    - one
  2020-02-01 e2
    - one
    - two
    - three
  2020-03-01 e3
  2020-04-01 e4
    - one
  2020-05-01 e5

[B]
  2020-06-01 e6
  2020-07-01 e7
    - one
    - two
  2020-08-01 e8
  2020-09-01 e9`;

  function viewBox(c: HTMLDivElement): { w: number; h: number } {
    const [, , w, h] = c
      .querySelector('svg')!
      .getAttribute('viewBox')!
      .split(' ')
      .map(Number);
    return { w: w!, h: h! };
  }

  it('spreads wider (and shorter) for a wide panel than a square one', () => {
    const parsed = parseEventLine(CLUSTERED, nordLight);
    const wide = mount(1600, 500); // aspect 3.2
    const square = mount(800, 800); // aspect 1.0
    renderEventLine(wide, parsed, nordLight, false);
    renderEventLine(square, parsed, nordLight, false);
    const w = viewBox(wide);
    const s = viewBox(square);
    // The wide panel pulls a wider, shorter layout than the square one.
    expect(w.w / w.h).toBeGreaterThan(s.w / s.h);
    expect(w.h).toBeLessThanOrEqual(s.h);
    // Never renders narrower than the panel it's given.
    expect(w.w).toBeGreaterThanOrEqual(1600 - 1);
  });

  it('still draws to scale when an era is collapsed (not even-spaced)', () => {
    // Dates are deliberately non-uniform; a collapsed era must not fall back to
    // equidistant spacing. The collapsed era anchors at its earliest member.
    const src = `event-line Scaled

2020-03-01 b
2025-01-01 c
2025-02-01 d

[Late] collapsed: true
  2026-01-01 a1
  2026-02-01 a2`;
    const parsed = parseEventLine(src, nordLight);
    const c = mount(1200, 500);
    renderEventLine(c, parsed, nordLight, false);
    const xs = [...c.querySelectorAll('.dgmo-event-dot')]
      .map((d) => Number(d.getAttribute('cx')))
      .sort((p, q) => p - q);
    const gaps = xs.slice(1).map((x, i) => +(x - xs[i]!).toFixed(1));
    // A huge 2020→2025 jump must dwarf the sub-year gaps — proof of date scaling.
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps) * 3);
  });

  it('shows every member of a collapsed era (no "+N more" truncation)', () => {
    const members = Array.from(
      { length: 9 },
      (_, i) => `  20${20 + i}-01-01 Event ${i + 1}`
    ).join('\n');
    const src = `event-line Big\n\n[All] collapsed: true\n${members}`;
    const parsed = parseEventLine(src, nordLight);
    const c = mount(1200, 500);
    renderEventLine(c, parsed, nordLight, false);
    const text = c.querySelector('svg')!.textContent ?? '';
    expect(text).not.toMatch(/\+\d+ more/);
    for (let i = 1; i <= 9; i++) expect(text).toContain(`Event ${i}`);
  });

  it('compresses a collapsed era to a fixed-width capsule (broken axis)', () => {
    // The bracket (stroke-width 1.5) is the capsule; its width is constant — the
    // folded date range does NOT inflate it (that is what the squiggle signals).
    const bracketWidth = (src: string): number => {
      const c = mount(1400, 500);
      renderEventLine(c, parseEventLine(src, nordLight), nordLight, false);
      const path = c.querySelector(
        'g[data-era-collapsed="true"] path[stroke-width="1.5"]'
      )!;
      const xs = [...path.getAttribute('d')!.matchAll(/[ML]([\d.]+),/g)].map(
        (m) => Number(m[1])
      );
      return Math.max(...xs) - Math.min(...xs);
    };
    const wide = bracketWidth(
      `event-line W\n\n2000-01-01 anchor\n\n[Long] collapsed: true\n  2005-01-01 a\n  2019-01-01 b`
    );
    const narrow = bracketWidth(
      `event-line N\n\n2000-01-01 anchor\n\n[Short] collapsed: true\n  2005-01-01 a\n  2005-06-01 b`
    );
    // A 14-year span and a 5-month span produce the SAME compact capsule width.
    expect(wide).toBeCloseTo(narrow, 1);
  });

  it('gives expanded events the width freed by a collapsed era', () => {
    // Same expanded events; collapsing the OTHER era frees axis for them, so they
    // spread WIDER than when that era is expanded and consumes its date range.
    const expandedSpan = (otherCollapsed: boolean): number => {
      const tag = otherCollapsed ? '[Past] collapsed: true' : '[Past]';
      const src = `event-line S\n\n${tag}\n  2000-01-01 p1\n  2015-01-01 p2\n\n[Now]\n  2017-01-01 a\n  2018-06-01 b\n  2020-01-01 c`;
      const c = mount(1400, 500);
      renderEventLine(c, parseEventLine(src, nordLight), nordLight, false);
      // x-span of the three "Now" dots (the last three by x).
      const xs = [...c.querySelectorAll('.dgmo-event-dot')]
        .map((d) => Number(d.getAttribute('cx')))
        .sort((p, q) => p - q);
      const now = xs.slice(-3);
      return now[2]! - now[0]!;
    };
    expect(expandedSpan(true)).toBeGreaterThan(expandedSpan(false) * 1.5);
  });

  it('keeps event spacing proportional under stretch (not equidistant)', () => {
    // A collapsed era widens the date domain; the expanded events between must
    // stay proportional — a uniform axis stretch must NOT force equidistant gaps.
    const src = `event-line P

2010-01-01 a
2010-02-01 b
2010-03-01 c
2020-01-01 d

[Later] collapsed: true
  2021-01-01 z1
  2040-01-01 z2`;
    const parsed = parseEventLine(src, nordLight);
    const c = mount(1600, 500);
    renderEventLine(c, parsed, nordLight, false);
    const xs = [...c.querySelectorAll('.dgmo-event-dot')]
      .map((d) => Number(d.getAttribute('cx')))
      .sort((p, q) => p - q);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    // The 2010→2020 (10yr) gap must dwarf the 2010 month-apart gaps.
    expect(Math.max(...gaps)).toBeGreaterThan(Math.min(...gaps) * 5);
  });

  it('marks a collapsed era with an axis-break (not-to-scale) glyph', () => {
    const src = `event-line Folded

2020-01-01 a
2020-06-01 b

[Gap] collapsed: true
  2025-01-01 c
  2025-06-01 d`;
    const parsed = parseEventLine(src, nordLight);
    const c = mount(1200, 500);
    renderEventLine(c, parsed, nordLight, false);
    // bracket (stroke-width 1.5) + two break squiggles (stroke-width 1.25).
    expect(
      c.querySelectorAll(
        'g[data-era-collapsed="true"] path[stroke-width="1.5"]'
      ).length
    ).toBe(1);
    expect(
      c.querySelectorAll(
        'g[data-era-collapsed="true"] path[stroke-width="1.25"]'
      ).length
    ).toBe(2);
  });

  it('keeps adjacent era brackets from overlapping when boundaries are tight', () => {
    // Two eras whose boundary events are only days apart on the date scale.
    const src = `event-line Tight

[First]
  2025-01-01 a1
  2025-04-01 a2

[Second]
  2025-04-15 b1
  2025-09-01 b2`;
    const parsed = parseEventLine(src, nordLight);
    const c = mount(1200, 500);
    renderEventLine(c, parsed, nordLight, false);
    const brackets = [
      ...c.querySelectorAll('g[data-era-collapsed="false"]'),
    ].map((g) => {
      const xs = [
        ...g
          .querySelector('path')!
          .getAttribute('d')!
          .matchAll(/M?([\d.]+),/g),
      ].map((m) => Number(m[1]));
      return { x0: Math.min(...xs), x1: Math.max(...xs) };
    });
    brackets.sort((p, q) => p.x0 - q.x0);
    for (let i = 1; i < brackets.length; i++) {
      expect(brackets[i]!.x0).toBeGreaterThanOrEqual(brackets[i - 1]!.x1);
    }
  });
});

describe('event-line hover interactivity', () => {
  const ERAS_SCALED = `event-line Web
tag Kind as k
  Browser blue
  Standard green

[Origins]
  1991-01-01 WorldWideWeb  k: Browser
    first
  1993-04-01 Mosaic  k: Browser

[Standards]
  1995-12-01 JavaScript  k: Standard
  1996-12-01 CSS  k: Standard`;

  function renderPreview(src = ERAS_SCALED): HTMLDivElement {
    const parsed = parseEventLine(src, nordLight);
    const container = mount(1000, 600);
    renderEventLine(container, parsed, nordLight, false);
    return container;
  }

  it('injects a hover <style> and tags every event piece in the preview path', () => {
    const svg = renderPreview().querySelector('svg')!;
    // The style block carries the hover state classes.
    const style = svg.querySelector('style');
    expect(style?.textContent).toContain('dgmo-evt-hl');
    expect(style?.textContent).toContain('dgmo-evt-dim');
    // Each event's dot + leader + card share one data-evt id.
    const ww = svg.querySelectorAll('[data-evt]');
    expect(ww.length).toBeGreaterThan(0);
    const dot = svg.querySelector('.dgmo-event-dot[data-evt]')!;
    const id = dot.getAttribute('data-evt');
    const trio = svg.querySelectorAll(`[data-evt="${id}"]`);
    // dot + leader + card (3) for a visible event
    expect(trio.length).toBe(3);
    // Tag values mirror the legend's data-legend-entry casing.
    expect(svg.querySelector('[data-tag-kind="browser"]')).not.toBeNull();
  });

  it('omits the hover <style> in the export path', () => {
    const parsed = parseEventLine(ERAS_SCALED, nordLight);
    const container = mount();
    renderEventLineForExport(container, parsed, nordLight, false, {
      width: 900,
      height: 500,
    });
    const svg = container.querySelector('svg')!;
    expect(svg.querySelector('style')).toBeNull();
    // ...but the data hooks still ride along (harmless in export).
    expect(svg.querySelector('.dgmo-event-card[data-evt]')).not.toBeNull();
  });

  it('hovering a legend entry dims every event that lacks that tag value', () => {
    const svg = renderPreview().querySelector('svg')!;
    const entry = svg.querySelector('[data-legend-entry="browser"]')!;
    expect(entry).not.toBeNull();
    entry.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    // Standard events dim; Browser events stay lit.
    const standard = svg.querySelector(
      '.dgmo-event-card[data-tag-kind="standard"]'
    )!;
    const browser = svg.querySelector(
      '.dgmo-event-card[data-tag-kind="browser"]'
    )!;
    expect(standard.classList.contains('dgmo-evt-dim')).toBe(true);
    expect(browser.classList.contains('dgmo-evt-dim')).toBe(false);
    // Leaving the diagram clears the dim.
    svg.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
    expect(standard.classList.contains('dgmo-evt-dim')).toBe(false);
  });

  it('hovering one event glows it and dims every other event', () => {
    const svg = renderPreview().querySelector('svg')!;
    const card = svg.querySelector('.dgmo-event-card[data-evt]')!;
    const id = card.getAttribute('data-evt');
    card.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    // The hovered event's pieces glow and are never dimmed.
    svg.querySelectorAll(`[data-evt="${id}"]`).forEach((el) => {
      expect(el.classList.contains('dgmo-evt-hl')).toBe(true);
      expect(el.classList.contains('dgmo-evt-dim')).toBe(false);
    });
    // Every other event dims; the spine line never carries a dim class.
    const other = [...svg.querySelectorAll('.dgmo-event-dot[data-evt]')].find(
      (el) => el.getAttribute('data-evt') !== id
    )!;
    expect(other.classList.contains('dgmo-evt-hl')).toBe(false);
    expect(other.classList.contains('dgmo-evt-dim')).toBe(true);
  });

  it('hovering an era bracket keeps its members lit and dims the rest', () => {
    const svg = renderPreview().querySelector('svg')!;
    const bracket = svg.querySelector('.dgmo-event-era[data-era="Origins"]')!;
    expect(bracket).not.toBeNull();
    bracket.dispatchEvent(
      new window.MouseEvent('mouseover', { bubbles: true })
    );
    expect(bracket.classList.contains('dgmo-evt-era-hl')).toBe(true);
    // Origins members stay lit; a Standards member dims.
    const member = svg.querySelector(
      '.dgmo-event-card[data-evt-era="Origins"]'
    )!;
    const outsider = svg.querySelector(
      '.dgmo-event-card[data-evt-era="Standards"]'
    )!;
    expect(member.classList.contains('dgmo-evt-dim')).toBe(false);
    expect(outsider.classList.contains('dgmo-evt-dim')).toBe(true);
  });

  it('focuses untagged events when the default (first) legend value is hovered', () => {
    const src = `event-line Default Focus
tag Type as t
  Scope green
  Changes blue

[Era]
  2020-01-01 Alpha  t: Changes
  2021-01-01 Beta`;
    const svg = renderPreview(src).querySelector('svg')!;
    const beta = [...svg.querySelectorAll('.dgmo-event-card')].find((g) =>
      g.textContent?.includes('Beta')
    )!;
    // The untagged event carries the default value, so the legend can focus it.
    expect(beta.getAttribute('data-tag-type')).toBe('scope');
    const scope = svg.querySelector('[data-legend-entry="scope"]')!;
    scope.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    expect(beta.classList.contains('dgmo-evt-dim')).toBe(false);
    const alpha = [...svg.querySelectorAll('.dgmo-event-card')].find((g) =>
      g.textContent?.includes('Alpha')
    )!;
    expect(alpha.classList.contains('dgmo-evt-dim')).toBe(true);
  });

  it('focusEventLine pins a focus that hover overrides then reverts to', () => {
    const container = renderPreview();
    const svg = container.querySelector('svg')!;
    const cards = [...svg.querySelectorAll('.dgmo-event-card[data-evt]')];
    const a = cards[0]!;
    const b = cards[1]!;
    const idA = a.getAttribute('data-evt')!;
    // Pin event A (e.g. cursor on A's line): A glows, B dims.
    focusEventLine(container, { kind: 'event', id: idA });
    expect(a.classList.contains('dgmo-evt-hl')).toBe(true);
    expect(b.classList.contains('dgmo-evt-dim')).toBe(true);
    // Hovering B overrides: B glows, A dims.
    b.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    expect(b.classList.contains('dgmo-evt-hl')).toBe(true);
    expect(a.classList.contains('dgmo-evt-dim')).toBe(true);
    // Leaving the diagram reverts to the pinned A (not a full clear).
    svg.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
    expect(a.classList.contains('dgmo-evt-hl')).toBe(true);
    expect(b.classList.contains('dgmo-evt-dim')).toBe(true);
    // Clearing the pin removes all focus state.
    focusEventLine(container, null);
    expect(svg.querySelectorAll('.dgmo-evt-hl,.dgmo-evt-dim').length).toBe(0);
  });

  it('focusEventLine pins an era and a tag category', () => {
    const container = renderPreview();
    const svg = container.querySelector('svg')!;
    focusEventLine(container, { kind: 'era', name: 'Origins' });
    expect(
      svg
        .querySelector('.dgmo-event-card[data-evt-era="Standards"]')!
        .classList.contains('dgmo-evt-dim')
    ).toBe(true);
    expect(
      svg
        .querySelector('.dgmo-event-card[data-evt-era="Origins"]')!
        .classList.contains('dgmo-evt-dim')
    ).toBe(false);
    focusEventLine(container, {
      kind: 'tag',
      group: 'kind',
      value: 'standard',
    });
    expect(
      svg
        .querySelector('.dgmo-event-card[data-tag-kind="browser"]')!
        .classList.contains('dgmo-evt-dim')
    ).toBe(true);
  });

  it('treats a legend value with zero events as a no-op (no all-dim void)', () => {
    const src = `event-line Unused
tag Kind as k
  Browser blue
  Standard green
  Mobile orange

[Era]
  2020-01-01 A  k: Browser
  2021-01-01 B  k: Standard`;
    const svg = renderPreview(src).querySelector('svg')!;
    const mobile = svg.querySelector('[data-legend-entry="mobile"]')!;
    expect(mobile).not.toBeNull();
    mobile.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    // Nothing is tagged Mobile → nothing dims (rather than dimming everything).
    expect(svg.querySelectorAll('.dgmo-evt-dim').length).toBe(0);
  });
});
