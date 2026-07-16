import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseBody } from '../src/body/parser';
import { renderBody } from '../src/body/renderer';
import { getPalette } from '../src/palettes';
import { getSeriesColors, themeBaseBg } from '../src/palettes/color-utils';

const codes = (src: string): string[] =>
  parseBody(src).diagnostics.map((d) => d.code ?? '');

describe('body parser — header + figure defaults', () => {
  it('parses the title from the header line', () => {
    const p = parseBody('body Push Day');
    expect(p.error).toBeFalsy();
    expect(p.title).toBe('Push Day');
    expect(p.diagnostics).toHaveLength(0);
  });

  it('defaults to muscle / male / front when no directives are given', () => {
    const p = parseBody('body');
    expect(p.options.form).toBe('muscle');
    expect(p.options.sex).toBe('male');
    expect(p.options.views).toEqual(['front']);
    expect(p.parts).toHaveLength(0);
  });
});

describe('body parser — bare directives', () => {
  it('`skin`, `female`, `back` set form / sex / view', () => {
    const p = parseBody(`body
skin
female
back`);
    expect(p.options.form).toBe('skin');
    expect(p.options.sex).toBe('female');
    expect(p.options.views).toEqual(['back']);
  });

  it('naming both `front` and `back` yields both views', () => {
    const p = parseBody(`body
front
back`);
    expect(p.options.views).toEqual(['front', 'back']);
  });
});

describe('body parser — parts', () => {
  it('a catalog name becomes a part', () => {
    const p = parseBody(`body
muscle
chest`);
    expect(p.parts).toHaveLength(1);
    expect(p.parts[0]!.name).toBe('chest');
    expect(
      codes(`body
muscle
chest`)
    ).not.toContain('W_BODY_UNKNOWN_PART');
  });

  it('gym aliases resolve without an unknown-part warning', () => {
    const src = `body
muscle
pecs
quads`;
    const p = parseBody(src);
    expect(p.parts.map((x) => x.name)).toEqual(['pecs', 'quads']);
    expect(codes(src)).not.toContain('W_BODY_UNKNOWN_PART');
  });

  it('trailing tag metadata attaches to the part', () => {
    const p = parseBody(`body
chest e: Primary`);
    expect(p.parts[0]!.metadata['e']).toBe('Primary');
  });

  it('an indented note under a part is captured', () => {
    const p = parseBody(`body
chest
  Primary mover in the bench press`);
    expect(p.parts[0]!.notes).toEqual(['Primary mover in the bench press']);
  });

  it('an unknown part warns without throwing and the rest still parses', () => {
    const src = `body
chest
bogus-muscle-xyz`;
    const p = parseBody(src);
    expect(p.error).toBeFalsy();
    expect(codes(src)).toContain('W_BODY_UNKNOWN_PART');
    expect(p.parts.map((x) => x.name)).toEqual(['chest', 'bogus-muscle-xyz']);
  });
});

describe('body parser — §1.9 fill family', () => {
  it('`fill-solid` sets options.fillMode to solid (not an unknown part)', () => {
    const src = `body
fill-solid
chest`;
    const p = parseBody(src);
    expect(p.options.fillMode).toBe('solid');
    expect(p.parts.map((x) => x.name)).toEqual(['chest']);
    expect(codes(src)).not.toContain('W_BODY_UNKNOWN_PART');
  });

  it('`fill-outline` sets options.fillMode to outline', () => {
    const p = parseBody(`body
fill-outline
chest`);
    expect(p.options.fillMode).toBe('outline');
  });

  it('last one wins — `fill-tint` after `fill-solid` restores the default', () => {
    const p = parseBody(`body
fill-solid
fill-tint
chest`);
    expect(p.options.fillMode).toBeUndefined();
  });
});

// ============================================================
// Renderer — fill family region treatment
// ============================================================

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const [key, value] of Object.entries({
    document: win.document,
    window: win,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    SVGElement: win.SVGElement,
  })) {
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
});

const nordLight = getPalette('nord').light;

function makeContainer(): HTMLDivElement {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: 1200 });
  Object.defineProperty(c, 'clientHeight', { value: 800 });
  return c as HTMLDivElement;
}

/** Region paths only (leaders/circles/labels share the class but aren't paths
 *  with a solid region fill — leaders are `fill="none"`). */
function regionPaths(c: HTMLDivElement): Element[] {
  return Array.from(c.querySelectorAll('path.dgmo-body-part')).filter(
    (p) => p.getAttribute('fill') !== 'none'
  );
}

describe('body renderer — §1.9 fill family', () => {
  const accent = getSeriesColors(nordLight)[0]!;

  it('fill-outline: regions fill with the base bg, colour on the stroke', () => {
    const c = makeContainer();
    renderBody(c, parseBody(`body\nfill-outline\nchest`), nordLight, false);
    const regions = regionPaths(c);
    expect(regions.length).toBeGreaterThan(0);
    for (const p of regions) {
      expect(p.getAttribute('fill')).toBe(themeBaseBg(nordLight, false));
      expect(p.getAttribute('stroke')).toBe(accent);
    }
  });

  it('fill-solid: regions carry the full-saturation colour', () => {
    const c = makeContainer();
    renderBody(c, parseBody(`body\nfill-solid\nchest`), nordLight, false);
    const regions = regionPaths(c);
    expect(regions.length).toBeGreaterThan(0);
    for (const p of regions) {
      expect(p.getAttribute('fill')).toBe(accent);
      expect(p.getAttribute('fill-opacity')).toBeNull();
    }
  });

  it('default keeps the muted 70/30 blend — not solid, not hollow', () => {
    const c = makeContainer();
    renderBody(c, parseBody(`body\nchest`), nordLight, false);
    const regions = regionPaths(c);
    expect(regions.length).toBeGreaterThan(0);
    for (const p of regions) {
      expect(p.getAttribute('fill')).not.toBe(accent);
      expect(p.getAttribute('fill')).not.toBe(themeBaseBg(nordLight, false));
      expect(p.getAttribute('stroke')).toBe(accent);
    }
  });
});
