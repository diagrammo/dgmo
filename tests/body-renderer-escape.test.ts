import { describe, it, expect } from 'vitest';
import { parseBody } from '../src/body/parser';
import { renderBody } from '../src/body/renderer';
import { getPalette } from '../src/palettes';

// diagrammo/diagrammo#1501, item 4: the body chart builds its marks as one
// markup string, so a tag value is written into `data-emph-key="…"` and
// `data-tag-<group>="…"` by hand. A `"` in the value must stay inside the
// attribute rather than close it and open new ones.

const nordLight = getPalette('nord').light;
const PAYLOAD = 'x" onmouseover="alert(1)';

function render(src: string): HTMLDivElement {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: 1200 });
  Object.defineProperty(c, 'clientHeight', { value: 800 });
  renderBody(c as HTMLDivElement, parseBody(src), nordLight, false);
  return c as HTMLDivElement;
}

const SINGLE = `body
tag Effort as e
  Primary red
chest e: ${PAYLOAD}`;

const DUAL = `body
front
back
tag Effort as e
  Primary red
deltoids e: ${PAYLOAD}`;

describe('body renderer — a tag value cannot break out of an attribute', () => {
  for (const [name, src] of [
    ['single view', SINGLE],
    ['dual view', DUAL],
  ] as const) {
    it(`${name}: no attribute is injected`, () => {
      const c = render(src);
      expect(c.querySelectorAll('.dgmo-body-part').length).toBeGreaterThan(0);
      expect(c.querySelectorAll('[onmouseover]')).toHaveLength(0);
    });

    it(`${name}: the whole value survives in the emph and tag attributes`, () => {
      const c = render(src);
      const parts = Array.from(c.querySelectorAll('.dgmo-body-part'));
      expect(parts.length).toBeGreaterThan(0);
      for (const el of parts) {
        expect(el.getAttribute('data-emph-key')).toBe(PAYLOAD.toLowerCase());
        expect(el.getAttribute('data-tag-effort')).toBe(PAYLOAD.toLowerCase());
      }
    });
  }

  it('a quote in a note or label still renders as text', () => {
    const c = render(`body
chest
  the "big" one`);
    const texts = Array.from(c.querySelectorAll('text.dgmo-body-part')).map(
      (t) => t.textContent
    );
    expect(texts).toContain('the "big" one');
  });
});
