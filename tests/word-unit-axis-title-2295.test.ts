// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseWaterfall } from '../src/waterfall/parser';
import { renderWaterfall } from '../src/waterfall/renderer';
import { parseDot } from '../src/dot/parser';
import { renderDot } from '../src/dot/renderer';
import { getPalette } from '../src/palettes';

const palette = getPalette('nord').light;
const size = { width: 960, height: 480 };

function wf(src: string): HTMLDivElement {
  const parsed = parseWaterfall(src);
  expect(parsed.error).toBeNull();
  const c = document.createElement('div');
  renderWaterfall(c, parsed, palette, false, undefined, size);
  return c;
}
function dot(src: string): HTMLDivElement {
  const parsed = parseDot(src);
  expect(parsed.error).toBeNull();
  const c = document.createElement('div');
  renderDot(c, parsed, palette, false, undefined, size);
  return c;
}
const texts = (c: Element, sel: string) =>
  [...c.querySelectorAll(sel)].map((e) => e.textContent ?? '');

const WF = (extra: string) => `waterfall Bridge
${extra}
Start 40 total
Up +5
Down -3
End total
`;
const DOT = (extra: string) => `dot Scores
${extra}
A 40 45
B 41 44
`;

describe('word unit is stated once, on the axis title (#2295)', () => {
  for (const [name, extra] of [
    ['vertical', 'unit pp'],
    ['horizontal', 'unit pp\norientation-horizontal'],
  ] as const) {
    it(`waterfall ${name}: bare numbers, one title`, () => {
      const c = wf(WF(extra));
      const all = [
        ...texts(c, '.waterfall-tick'),
        ...texts(c, '.waterfall-value'),
      ];
      expect(all.length).toBeGreaterThan(0);
      expect(all.some((t) => t.includes('pp'))).toBe(false);
      expect(all).toContain('−3');
      expect(texts(c, '.waterfall-axis-title')).toEqual(['pp']);
    });
  }

  it('waterfall: a symbol unit stays on every number, no title', () => {
    const c = wf(WF('unit %'));
    expect(texts(c, '.waterfall-tick').every((t) => t.includes('%'))).toBe(
      true
    );
    expect(c.querySelector('.waterfall-axis-title')).toBeNull();
  });

  it('waterfall: no-value keeps the title over bare ticks', () => {
    const c = wf(WF('unit pp\nno-value'));
    expect(c.querySelector('.waterfall-value')).toBeNull();
    expect(texts(c, '.waterfall-tick').some((t) => t.includes('pp'))).toBe(
      false
    );
    expect(texts(c, '.waterfall-axis-title')).toEqual(['pp']);
  });

  it('dot: bare ticks and gaps, one title', () => {
    const c = dot(DOT('series a, b\ngap\nunit pp'));
    const all = [...texts(c, '.dot-tick'), ...texts(c, '.dot-gap')];
    expect(all.length).toBeGreaterThan(0);
    expect(all.some((t) => t.includes('pp'))).toBe(false);
    expect(texts(c, '.dot-axis-title')).toEqual(['pp']);
  });

  it('dot: a symbol unit stays on every number, no title', () => {
    const c = dot(DOT('series a, b\nunit %'));
    expect(texts(c, '.dot-tick').every((t) => t.includes('%'))).toBe(true);
    expect(c.querySelector('.dot-axis-title')).toBeNull();
  });
});
