// The fold cue's <style> is scoped to its own diagram (#1741). A <style> in an
// inline SVG applies to the whole page, so unscoped rules from a dark diagram
// and a light one on the same page collided: the last one won for both.
import { describe, it, expect } from 'vitest';
import {
  injectToggleCue,
  toggleCueCss,
  TOGGLE_CUE_ATTR,
} from '../src/utils/card';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><g data-node-toggle="a"><rect/></g></svg>';

/** Every selector in a CSS string, @media wrappers unwrapped. */
function selectors(css: string): string[] {
  const out: string[] = [];
  for (const m of css
    .replace(/@media[^{]*\{/g, '')
    .matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    out.push(
      ...m[1]!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  return out;
}

describe('toggle cue scoping', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`every ${theme} rule needs [${TOGGLE_CUE_ATTR}="${theme}"]`, () => {
      const sels = selectors(toggleCueCss(theme));
      expect(sels.length).toBeGreaterThan(5);
      for (const s of sels) {
        expect(s.startsWith(`[${TOGGLE_CUE_ATTR}="${theme}"] `), s).toBe(true);
      }
    });
  }

  it('the light and dark cues share no selector', () => {
    const light = new Set(selectors(toggleCueCss('light')));
    for (const s of selectors(toggleCueCss('dark')))
      expect(light.has(s), s).toBe(false);
  });

  it('injectToggleCue marks the SVG root with its theme', () => {
    const out = injectToggleCue(SVG, 'dark');
    expect(out).toMatch(/^<svg data-dgmo-cue="dark" xmlns=/);
    expect(out).toContain(`<style>${toggleCueCss('dark')}</style>`);
  });

  it('leaves an SVG with no toggle untouched', () => {
    const plain = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    expect(injectToggleCue(plain, 'dark')).toBe(plain);
  });
});
