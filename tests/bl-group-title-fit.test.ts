// diagrammo/diagrammo#2423: a long expanded-group name wraps inside its frame,
// is cut with "…" only past its last line, and never runs into the group's
// first box. Short names draw as one line, exactly as before.
import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { GROUP_TITLE_FONT_SIZE } from '../src/boxes-and-lines/group-title';
import { measureText } from '../src/utils/text-measure';
import { FULL_TEXT_ATTR } from '../src/utils/full-text';
import { getPalette } from '../src/palettes';

const P = getPalette('nord').light;
// 150 characters.
const LONG =
  'Customer Identity and Access Management Platform Services Including ' +
  'Single Sign On Federation Multi Factor Authentication And Audit Logging Tool Suite';

const FIXTURES: Record<string, string> = {
  flat: `boxes-and-lines T\n\n[${LONG}]\n  Auth\n    -> Users\n  Users\n`,
  lr: `boxes-and-lines T\ndirection-lr\n\n[${LONG}]\n  Auth\n    -> Users\n  Users\n`,
  nested: `boxes-and-lines T\n\nEntry\n  -> Auth\n\n[Outer ${LONG}]\n  [Inner ${LONG}]\n    Auth\n  Gate\n    -> Auth\n`,
};

async function draw(src: string): Promise<HTMLElement> {
  const parsed = parseBoxesAndLines(src);
  const layout = await layoutBoxesAndLines(parsed);
  const el = document.createElement('div');
  renderBoxesAndLines(el, parsed, layout, P, false, {
    exportDims: { width: 1200, height: 900 },
  });
  return el;
}

const num = (el: Element, a: string): number => Number(el.getAttribute(a));

describe('boxes-and-lines — expanded group title fits its frame (#2423)', () => {
  expect(LONG.length).toBe(150);
  for (const [name, src] of Object.entries(FIXTURES)) {
    it(`${name}: every title line lies inside its group rectangle`, async () => {
      const el = await draw(src);
      const groups = [...el.querySelectorAll('g.bl-group')];
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) {
        const rect = g.querySelector(':scope > rect')!;
        const x0 = num(rect, 'x');
        const y0 = num(rect, 'y');
        const x1 = x0 + num(rect, 'width');
        const y1 = y0 + num(rect, 'height');
        const lines = [...g.querySelectorAll(':scope > text.bl-group-label')];
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.length).toBeLessThanOrEqual(3);
        for (const t of lines) {
          const w = measureText(t.textContent!, GROUP_TITLE_FONT_SIZE, {
            bold: true,
          });
          const cx = num(t, 'x');
          const y = num(t, 'y');
          expect(cx - w / 2).toBeGreaterThanOrEqual(x0);
          expect(cx + w / 2).toBeLessThanOrEqual(x1);
          expect(y - GROUP_TITLE_FONT_SIZE).toBeGreaterThanOrEqual(y0);
          expect(y).toBeLessThanOrEqual(y1);
        }
        expect(lines.at(-1)!.textContent!.endsWith('…')).toBe(true);
        expect(g.getAttribute(FULL_TEXT_ATTR)).toContain(LONG);
      }
    });

    it(`${name}: the last title line stays above every box in the group`, async () => {
      const el = await draw(src);
      const nodeTops = [...el.querySelectorAll('g.bl-node')].map((n) => {
        const [tx, ty] = n
          .getAttribute('transform')!
          .match(/-?[\d.]+/g)!
          .map(Number);
        const r = n.querySelector('rect')!;
        return {
          x: tx! + num(r, 'x'),
          y: ty! + num(r, 'y'),
          w: num(r, 'width'),
        };
      });
      for (const g of el.querySelectorAll('g.bl-group')) {
        const rect = g.querySelector(':scope > rect')!;
        const x0 = num(rect, 'x');
        const y0 = num(rect, 'y');
        const x1 = x0 + num(rect, 'width');
        const y1 = y0 + num(rect, 'height');
        const lines = [...g.querySelectorAll(':scope > text.bl-group-label')];
        const baseline = num(lines.at(-1)!, 'y');
        const inside = nodeTops.filter(
          (n) => n.x >= x0 && n.x + n.w <= x1 && n.y >= y0 && n.y <= y1
        );
        expect(inside.length).toBeGreaterThan(0);
        for (const n of inside) expect(n.y).toBeGreaterThan(baseline);
      }
    });
  }

  it('a short name draws as one line with no full-text attribute', async () => {
    const el = await draw(
      'boxes-and-lines T\n\n[Identity]\n  Auth\n    -> Users\n  Users\n'
    );
    const g = el.querySelector('g.bl-group')!;
    const lines = g.querySelectorAll(':scope > text.bl-group-label');
    expect([...lines].map((t) => t.textContent)).toEqual(['Identity']);
    expect(g.hasAttribute(FULL_TEXT_ATTR)).toBe(false);
  });
});
