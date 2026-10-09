import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { render } from '../src/index';
import { getAvailablePalettes, getPalette } from '../src/palettes';
import { parseWhiteboard } from '../src/whiteboard/parser';
import {
  IMAGE_NOT_UPLOADED,
  renderWhiteboard,
  whiteboardBounds,
} from '../src/whiteboard/renderer';

const FIXTURE = readFileSync(
  join(__dirname, '..', 'gallery', 'fixtures', 'whiteboard.dgmo'),
  'utf8'
);

function draw(
  src: string,
  isDark = false,
  opts?: Parameters<typeof renderWhiteboard>[4]
): SVGSVGElement {
  const pal = getPalette('nord')[isDark ? 'dark' : 'light'];
  const el = document.createElement('div');
  renderWhiteboard(el, parseWhiteboard(src, pal), pal, isDark, opts);
  return el.querySelector('svg')!;
}

describe('whiteboard renderer', () => {
  it('renders the fixture in light and dark through render()', async () => {
    for (const theme of ['light', 'dark'] as const) {
      const { svg, diagnostics } = await render(FIXTURE, { theme });
      expect(diagnostics).toEqual([]);
      expect(svg).toContain('<svg');
      expect(svg).toContain('Login ideas');
      expect(svg).not.toMatch(/NaN|undefined/);
    }
  });

  it('draws ink as the palette text colour, flipping with the theme', () => {
    const src =
      'whiteboard\nink ink 3 AHysAxoGEgIUAyYJFAESAi4MEgIUAyYJFAESAjQOGgE';
    const light = draw(src, false).querySelector('.whiteboard-ink path')!;
    const dark = draw(src, true).querySelector('.whiteboard-ink path')!;
    expect(light.getAttribute('fill')).toBe(getPalette('nord').light.text);
    expect(dark.getAttribute('fill')).toBe(getPalette('nord').dark.text);
    expect(light.getAttribute('d')).toMatch(/^M[-\d.]+ [-\d.]+Q.*Z$/);
  });

  it('takes the palette shade of a named colour', () => {
    const svg = draw('whiteboard\nrectangle at: 0 0, size: 50 50, color: red');
    expect(
      svg.querySelector('.whiteboard-rectangle rect')!.getAttribute('stroke')
    ).toBe(getPalette('nord').light.colors.red);
  });

  it('draws every element kind', () => {
    const svg = draw(FIXTURE);
    for (const cls of [
      'rectangle',
      'ellipse',
      'database',
      'queue',
      'arrow',
      'text',
      'image',
      'ink',
    ]) {
      expect(svg.querySelector(`.whiteboard-${cls}`), cls).not.toBeNull();
    }
    // Every element keeps its source line for click-to-source.
    expect(
      svg.querySelectorAll('[data-line-number]').length
    ).toBeGreaterThanOrEqual(14);
  });

  it('draws a line with no head, and an arrow with one', () => {
    const svg = draw(
      'whiteboard\nline from: 0 0, to: 100 0\narrow from: 0 50, to: 100 50'
    );
    const line = svg.querySelector('.whiteboard-line')!;
    expect(line.querySelector('line')).not.toBeNull();
    expect(line.querySelector('polygon, marker, path')).toBeNull();
    // The line runs to its end point; the arrow's shaft stops at the head.
    expect(line.querySelector('line')!.getAttribute('x2')).toBe('100');
    expect(svg.querySelector('.whiteboard-arrow polygon')).not.toBeNull();
    expect(svg.querySelector('marker')).toBeNull();
  });

  it('dashes a dashed arrow or line, scaled to the stroke width', () => {
    const svg = draw(
      [
        'whiteboard',
        'line from: 0 0, to: 100 0, style: dashed',
        'arrow from: 0 50, to: 100 50, style: dashed',
        'arrow from: 0 90, to: 100 90',
      ].join('\n')
    );
    const strokes = [...svg.querySelectorAll('g[class^="whiteboard-"] > line')];
    expect(strokes).toHaveLength(3);
    const [line, dashed, solid] = strokes;
    const width = Number(line!.getAttribute('stroke-width'));
    expect(line!.getAttribute('stroke-dasharray')).toBe(
      `${3 * width} ${4 * width}`
    );
    expect(dashed!.getAttribute('stroke-dasharray')).toBe(
      `${3 * width} ${4 * width}`
    );
    expect(solid!.hasAttribute('stroke-dasharray')).toBe(false);
  });

  it('crops to the content plus a margin, wherever it sits', () => {
    const near = draw('whiteboard\nrectangle at: 0 0, size: 100 50');
    const far = draw('whiteboard\nrectangle at: -90000 40000, size: 100 50');
    expect(near.getAttribute('width')).toBe(far.getAttribute('width'));
    expect(near.getAttribute('height')).toBe(far.getAttribute('height'));
    expect(Number(near.getAttribute('width'))).toBeLessThan(200);
    expect(
      whiteboardBounds(parseWhiteboard('whiteboard\ntext a at: -10 -20'))
    ).toMatchObject({ minX: -10, minY: -20 });
  });

  it('draws an unresolved image as a labelled placeholder, never an error', () => {
    const src = 'whiteboard\nimage a.assets/x.webp at: 0 0, size: 120 80';
    const svg = draw(src);
    expect(svg.querySelector('image')).toBeNull();
    expect(svg.textContent).toContain(IMAGE_NOT_UPLOADED);
  });

  it('passes an https image through by default', () => {
    const svg = draw(
      'whiteboard\nimage https://cdn.example.com/a.webp at: 0 0, size: 120 80'
    );
    expect(svg.querySelector('image')!.getAttribute('href')).toBe(
      'https://cdn.example.com/a.webp'
    );
  });

  it('asks resolveImage, whose answer is final', () => {
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    const svg = draw(
      'whiteboard\nimage a.assets/x.png at: 0 0, size: 10 10',
      false,
      {
        resolveImage: (ref) => (ref === 'a.assets/x.png' ? data : undefined),
      }
    );
    expect(svg.querySelector('image')!.getAttribute('href')).toBe(data);

    const refused = draw(
      'whiteboard\nimage https://cdn.example.com/a.webp at: 0 0, size: 10 10',
      false,
      { resolveImage: () => undefined }
    );
    expect(refused.querySelector('image')).toBeNull();

    const unsafe = draw('whiteboard\nimage a.png at: 0 0, size: 10 10', false, {
      resolveImage: () => 'javascript:alert(1)',
    });
    expect(unsafe.querySelector('image')).toBeNull();
  });

  it('threads resolveImage through render()', async () => {
    const { svg } = await render(
      'whiteboard\nimage a.assets/x.png at: 0 0, size: 10 10',
      { resolveImage: () => 'data:image/png;base64,AAAA' }
    );
    expect(svg).toContain('data:image/png;base64,AAAA');
  });

  it('renders with every palette in both themes', async () => {
    for (const id of getAvailablePalettes().map((p) => p.id)) {
      for (const theme of ['light', 'dark'] as const) {
        const { svg } = await render(FIXTURE, { theme, palette: id });
        expect(svg, `${id}/${theme}`).toContain('whiteboard-ink');
        expect(svg, `${id}/${theme}`).not.toMatch(/NaN|undefined/);
      }
    }
  });
});
