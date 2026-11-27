// Body chart text stays on the canvas (diagrammo/diagrammo#2421): a long
// title, a long tag group name or value, many tag values, and long callout
// notes wrap first and are cut with … only as a last resort.
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { render } from '../src/render';
import { parseBody } from '../src/body/parser';
import { renderBody } from '../src/body/renderer';
import { getPalette } from '../src/palettes';
import { measureSvgContent, TEXT_WIDTH_SAFETY } from '../src/utils/export-fit';
import { FULL_TEXT_ATTR } from '../src/utils/full-text';
import { measureText } from '../src/utils/text-measure';

const LONG = 'Very long words that keep on going '.repeat(9).slice(0, 300);
const WORD = 'x'.repeat(300);
const MUSCLES = [
  'chest',
  'abs',
  'biceps',
  'quads',
  'calves',
  'forearms',
  'deltoids',
  'obliques',
];

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Box of what `sel` draws, every other mark pruned (root units). */
function inkBox(
  svg: string,
  sel: string,
  skip?: string,
  only?: number
): Box | null {
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const root = doc.documentElement;
  const keepers = Array.from(root.querySelectorAll(sel))
    .filter((e) => !skip || !e.closest(skip))
    .filter((_, i) => only === undefined || i === only);
  if (!keepers.length) return null;
  const prune = (e: Element): void => {
    for (const c of Array.from(e.children)) {
      if (keepers.includes(c)) continue;
      if (keepers.some((k) => c.contains(k))) prune(c);
      else c.remove();
    }
  };
  prune(root);
  return measureSvgContent(root.outerHTML).box;
}

function viewBox(svg: string): Box {
  const m = /viewBox="([^"]+)"/.exec(svg);
  if (!m) throw new Error('no viewBox');
  const [x, y, w, h] = m[1]!.split(/[\s,]+/).map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return { x0: x, y0: y, x1: x + w, y1: y + h };
}

function expectInside(svg: string, sel: string, skip?: string): void {
  const box = inkBox(svg, sel, skip);
  expect(box, `${sel} drew nothing`).not.toBeNull();
  const vb = viewBox(svg);
  expect(box!.x0).toBeGreaterThanOrEqual(vb.x0);
  expect(box!.x1).toBeLessThanOrEqual(vb.x1);
  expect(box!.y0).toBeGreaterThanOrEqual(vb.y0);
  expect(box!.y1).toBeLessThanOrEqual(vb.y1);
}

/**
 * Every legend mark inside the canvas. The measurer pads text widths by
 * TEXT_WIDTH_SAFETY, wider than the legend lays its text out, so each legend
 * text (all start-anchored) is placed by the measurer and sized by its own
 * advance width; every other legend mark is measured as drawn.
 */
function expectLegendInside(svg: string): void {
  const vb = viewBox(svg);
  expectInside(svg, '.dgmo-legend circle');
  // The preview's capsule and hit areas; an export key draws neither.
  if (inkBox(svg, '.dgmo-legend rect')) expectInside(svg, '.dgmo-legend rect');
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  const texts = Array.from(doc.querySelectorAll('.dgmo-legend text'));
  expect(texts.length).toBeGreaterThan(0);
  texts.forEach((t, i) => {
    const box = inkBox(svg, '.dgmo-legend text', undefined, i);
    expect(box).not.toBeNull();
    const size = Number(t.getAttribute('font-size'));
    const w = measureText(t.textContent ?? '', size);
    const scale = (box!.x1 - box!.x0) / (w * TEXT_WIDTH_SAFETY);
    expect(box!.x0).toBeGreaterThanOrEqual(vb.x0);
    expect(box!.x0 + w * scale).toBeLessThanOrEqual(vb.x1);
  });
}

/** The app's path: no export dimensions, so the legend is the preview capsule. */
function preview(src: string): string {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: 1200 });
  Object.defineProperty(c, 'clientHeight', { value: 800 });
  const palette = getPalette('nord').light;
  renderBody(c as HTMLDivElement, parseBody(src, palette), palette, false);
  return c.innerHTML;
}

const exported = async (src: string): Promise<string> =>
  (await render(src)).svg;

const VIEWS = [
  ['single view', ['front']],
  ['dual view', ['front', 'back']],
] as const;
const MODES = [
  ['export', exported],
  ['preview', async (s: string) => preview(s)],
] as const;

function body(views: readonly string[], lines: string[], title = 'T'): string {
  return [`body ${title}`, ...views, '', ...lines].join('\n');
}

describe('body chart text inside the canvas (#2421)', () => {
  for (const [vname, views] of VIEWS)
    for (const [mname, draw] of MODES) {
      it(`${vname}, ${mname}: a 300-character title`, async () => {
        const svg = await draw(body(views, ['chest'], LONG));
        expectInside(svg, 'text');
      });

      it(`${vname}, ${mname}: a 300-character note with spaces`, async () => {
        const svg = await draw(body(views, ['chest', `  ${LONG}`, 'calves']));
        expectInside(svg, 'text');
        expect(svg).toContain(`${FULL_TEXT_ATTR}="${LONG}"`);
      });

      it(`${vname}, ${mname}: a 300-character note with no spaces`, async () => {
        const svg = await draw(body(views, ['chest', `  ${WORD}`, 'calves']));
        expectInside(svg, 'text');
        expect(svg).toContain('…');
        expect(svg).toContain(`${FULL_TEXT_ATTR}="${WORD}"`);
      });

      it(`${vname}, ${mname}: a long tag group name and value`, async () => {
        const name = 'Group name that is very long '.repeat(7).trim();
        const value = 'Value that is very long '.repeat(9).trim();
        const svg = await draw(
          body(views, [
            `tag ${name} as e`,
            `  ${value} red`,
            '  Short blue',
            '',
            `chest e: ${value}`,
            'calves e: Short',
          ])
        );
        expectLegendInside(svg);
        expect(svg).toContain('…');
        expect(svg).toContain(`${FULL_TEXT_ATTR}="${name}"`);
        expect(svg).toContain(`${FULL_TEXT_ATTR}="${value}"`);
        expectInside(svg, 'text', '.dgmo-legend');
      });

      it(`${vname}, ${mname}: many tag values wrap inside the canvas`, async () => {
        const values = MUSCLES.map((_, i) => `Effort level number ${i} here`);
        const svg = await draw(
          body(views, [
            'tag Effort as e',
            ...values.map((v) => `  ${v} red`),
            '',
            ...MUSCLES.map((m, i) => `${m} e: ${values[i]}`),
          ])
        );
        expectLegendInside(svg);
      });
    }
});
