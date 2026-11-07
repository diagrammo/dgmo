// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';
import { render } from '../src/render';
import { mix, shapeFill } from '../src/palettes/color-utils';
import { parseSwot } from '../src/swot/parser';
import { renderSwot } from '../src/swot/renderer';
import { hoverCssFor } from '../src/utils/hover-styles';
import { resolveActiveTagGroup } from '../src/utils/tag-groups';

const palette = getPalette('nord').light;

function draw(src: string, containerWidth = 0): HTMLElement {
  const parsed = parseSwot(src, palette);
  const container = document.createElement('div');
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    width: containerWidth,
  } as DOMRect);
  renderSwot(container, parsed, palette, false, {
    activeTagGroup: resolveActiveTagGroup(
      parsed.tagGroups,
      parsed.options['active-tag']
    ),
  });
  return container;
}

const panel = (c: HTMLElement, key: string) =>
  c.querySelector(`.swot-panel[data-section="${key}"]`)!;
const rectOf = (c: HTMLElement, key: string) => {
  const r = panel(c, key).querySelector('rect')!;
  return {
    x: Number(r.getAttribute('x')),
    y: Number(r.getAttribute('y')),
    width: Number(r.getAttribute('width')),
    height: Number(r.getAttribute('height')),
  };
};

const FULL = `swot T
threats
  D
opportunities
  C
weaknesses
  B
strengths
  A
`;

describe('renderSwot', () => {
  it('places S W / O T whatever the source order', () => {
    const c = draw(FULL);
    const s = rectOf(c, 'strengths');
    const w = rectOf(c, 'weaknesses');
    const o = rectOf(c, 'opportunities');
    const t = rectOf(c, 'threats');
    expect(s.x).toBe(o.x);
    expect(w.x).toBe(t.x);
    expect(w.x).toBeGreaterThan(s.x);
    expect(s.y).toBe(w.y);
    expect(o.y).toBe(t.y);
    expect(o.y).toBeGreaterThan(s.y);
    expect(w.x - (s.x + s.width)).toBe(12);
    expect(o.y - (s.y + s.height)).toBe(12);
  });

  it('draws the sizes the spec names', () => {
    const c = draw(FULL);
    const rect = panel(c, 'strengths').querySelector('rect')!;
    expect(rect.getAttribute('rx')).toBe('8');
    const dot = panel(c, 'strengths').querySelector('circle')!;
    expect(dot.getAttribute('r')).toBe('3.5');
    const item = panel(c, 'strengths').querySelector('.swot-item text')!;
    expect(item.getAttribute('font-size')).toBe('13');
  });

  it('mixes the header band 38% from the section colour', () => {
    const c = draw(FULL);
    const panelFill = panel(c, 'threats')
      .querySelector('rect')!
      .getAttribute('fill')!;
    expect(
      panel(c, 'threats').querySelector('.swot-header')!.getAttribute('fill')
    ).toBe(mix(palette.colors.red, panelFill, 38));
  });

  it('draws a missing section with a muted italic None listed', () => {
    const c = draw('swot\nstrengths\n  A\n');
    const empty = panel(c, 'threats').querySelector('.swot-empty')!;
    expect(empty.textContent).toBe('None listed');
    expect(empty.getAttribute('font-style')).toBe('italic');
    expect(empty.getAttribute('fill')).toBe(palette.textMuted);
    expect(panel(c, 'threats').hasAttribute('data-line-number')).toBe(false);
  });

  it('sets data-line-number on sections and items', () => {
    const c = draw('swot\nstrengths\n  A\n');
    expect(panel(c, 'strengths').getAttribute('data-line-number')).toBe('2');
    expect(
      panel(c, 'strengths')
        .querySelector('.swot-item')!
        .getAttribute('data-line-number')
    ).toBe('3');
  });

  it('a tag recolours the dot; an untagged item and the band keep the section colour', () => {
    const src = `swot
tag Priority as p
  High red
  Low gray
active-tag Priority

strengths
  Tagged p: Low
  Untagged
`;
    const c = draw(src);
    const dots = panel(c, 'strengths').querySelectorAll('circle');
    expect(dots[0]!.getAttribute('fill')).toBe(palette.colors.gray);
    expect(dots[1]!.getAttribute('fill')).toBe(palette.colors.green);
    const items = panel(c, 'strengths').querySelectorAll('.swot-item');
    expect(items[0]!.getAttribute('data-tag-priority')).toBe('low');
    expect(items[1]!.hasAttribute('data-tag-priority')).toBe(false);
    expect(c.querySelector('.swot-legend')).not.toBeNull();
    const panelFill = panel(c, 'strengths')
      .querySelector('rect')!
      .getAttribute('fill')!;
    expect(
      panel(c, 'strengths').querySelector('.swot-header')!.getAttribute('fill')
    ).toBe(mix(palette.colors.green, panelFill, 38));
  });

  it('draws every tag group, so a click can switch to another', () => {
    const c = draw(`swot
tag Priority as p
  High red
tag Owner as o
  Eng blue
active-tag Priority
strengths
  A p: High, o: Eng
`);
    const groups = [...c.querySelectorAll('[data-legend-group]')].map((e) =>
      e.getAttribute('data-legend-group')
    );
    expect(groups).toEqual(['priority', 'owner']);
  });

  it('tints a tagged row in its tag colour; no-tint-items turns it off', () => {
    const src = `swot
tag Priority as p
  High red
active-tag Priority
strengths
  Tagged p: High
  Untagged
`;
    const on = draw(src);
    const tints = on.querySelectorAll('.swot-item-tint');
    expect(tints).toHaveLength(1);
    expect(tints[0]!.getAttribute('fill')).toBe(
      shapeFill(palette, palette.colors.red, false)
    );
    const off = draw(
      src.replace('active-tag Priority', 'active-tag Priority\nno-tint-items')
    );
    expect(off.querySelectorAll('.swot-item-tint')).toHaveLength(0);
    expect(off.querySelectorAll('.swot-item circle')).toHaveLength(2);
  });

  it('no-legend hides the legend', () => {
    const c = draw('swot\ntag P\n  A red\nno-legend\n\nstrengths\n  x P: A\n');
    expect(c.querySelector('.swot-legend')).toBeNull();
  });

  it('labels the axes, and no-axes wins over the label options', () => {
    const on = draw(FULL);
    const onAxes = [...on.querySelectorAll('.swot-axes text')].map(
      (t) => t.textContent
    );
    expect(onAxes).toEqual(['HELPFUL', 'HARMFUL', 'INTERNAL', 'EXTERNAL']);
    const rotated = on.querySelectorAll('.swot-axes text')[2]!;
    expect(rotated.getAttribute('transform')).toContain('rotate(-90');
    // Drawn as matrix headers (#1742): a filled band over each column with
    // the panel's x and width, and a rail beside each row with its height.
    const headers = [...on.querySelectorAll('.swot-axis-header')];
    expect(headers).toHaveLength(4);
    const s = rectOf(on, 'strengths');
    const w = rectOf(on, 'weaknesses');
    const o = rectOf(on, 'opportunities');
    const attr = (el: Element, k: string) => Number(el.getAttribute(k));
    expect(attr(headers[0]!, 'x')).toBe(s.x);
    expect(attr(headers[0]!, 'width')).toBe(s.width);
    expect(attr(headers[1]!, 'x')).toBe(w.x);
    expect(attr(headers[0]!, 'y') + attr(headers[0]!, 'height')).toBeLessThan(
      s.y
    );
    expect(attr(headers[2]!, 'y')).toBe(s.y);
    expect(attr(headers[3]!, 'y')).toBe(o.y);
    expect(attr(headers[2]!, 'x') + attr(headers[2]!, 'width')).toBeLessThan(
      s.x
    );
    const off = draw(
      `swot\nno-axes\nx-label A, B\ny-label C, D\n${FULL.slice(7)}`
    );
    expect(off.querySelector('.swot-axes')).toBeNull();
  });

  it('keeps every word: a long list wraps and grows the row, with no truncation', () => {
    const long =
      'A very long strength that cannot possibly fit on one line of a panel this wide, so it must wrap onto further lines';
    const c = draw(
      `swot\nstrengths\n  ${long}\n  Second\nweaknesses\n  Short\n`
    );
    const text = [...panel(c, 'strengths').querySelectorAll('.swot-item text')]
      .map((t) => t.textContent)
      .join(' ');
    expect(text).toBe(`${long} Second`);
    const s = rectOf(c, 'strengths');
    const w = rectOf(c, 'weaknesses');
    expect(s.height).toBe(w.height);
    expect(s.width).toBe(w.width);
    expect(rectOf(c, 'opportunities').height).toBeLessThan(s.height);
  });

  it('stays 2×2 at phone width and scales as a whole', () => {
    const wide = draw(FULL, 1200);
    const phone = draw(FULL, 320);
    const svg = phone.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('100%');
    expect(svg.hasAttribute('height')).toBe(false);
    expect(svg.getAttribute('viewBox')).toBe(
      wide.querySelector('svg')!.getAttribute('viewBox')
    );
    for (const key of ['strengths', 'weaknesses', 'opportunities', 'threats']) {
      expect(rectOf(phone, key)).toEqual(rectOf(wide, key));
    }
  });

  it('a long title widens the sheet rather than being cut', () => {
    const title = 'A very long title '.repeat(10).trim();
    const svg = draw(`swot ${title}\nstrengths\n  A\n`).querySelector('svg')!;
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(800);
  });
});

describe('swot export', () => {
  it('exports through the shared entry with a <desc>', async () => {
    const svg = await renderForExport(FULL, 'light');
    expect(svg).toContain('swot-panel');
    const rendered = await render(FULL);
    expect(rendered.svg).toContain('<desc');
    expect(rendered.svg).toContain(
      'SWOT analysis with 4 items: Strengths 1, Weaknesses 1, Opportunities 1, Threats 1.'
    );
  });

  it('hovering a panel dims the others, and the legend pairs on items', async () => {
    const src = `swot
tag Priority as p
  High red
  Low gray

strengths
  A p: High
`;
    const { svg } = await render(src);
    expect(svg).toMatch(/\.swot-panel/);
    expect(svg).toMatch(/svg:has\(\.swot-panel:hover\)/);
    expect(svg).toContain('.swot-item');
  });

  it('an axis header keeps the two panels it heads and dims the rest', async () => {
    const { svg } = await render(FULL);
    expect(svg).toContain('data-swot-axis="col-0"');
    expect(svg).toContain('data-swot-col="0"');
    expect(svg).toContain(
      'svg:has(.swot-axis[data-swot-axis="col-0"]:hover) :is(.swot-panel:not([data-swot-col="0"]),.swot-axis:not([data-swot-axis="col-0"])){opacity:0.4}'
    );
    expect(svg).toContain('[data-swot-axis="row-1"]:hover');
  });

  it('hoverCssFor hands a live render the same hover CSS render() bakes in', async () => {
    const src = `swot
tag Priority as p
  High red
  Low gray

strengths
  A p: High
`;
    const { svg } = await render(src);
    const baked = svg.match(
      /<style>([^<]*swot-panel:hover[^<]*)<\/style>/
    )?.[1];
    const live = draw(src).querySelector('svg')!.outerHTML;
    expect(baked).toBeTruthy();
    expect(hoverCssFor(live, 'swot')).toBe(baked);
    expect(hoverCssFor(live, 'no-such-chart')).toBe('');
  });

  it('an error exports nothing', async () => {
    expect(await renderForExport('swot\n[Strengths]\n  A\n', 'light')).toBe('');
  });
});
