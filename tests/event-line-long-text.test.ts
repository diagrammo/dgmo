import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseEventLine } from '../src/event-line/parser';
import { renderEventLineForExport } from '../src/event-line/renderer';
import { DESC_MAX_LINES } from '../src/event-line/layout';
import { getPalette } from '../src/palettes';
import { measureText } from '../src/utils/text-measure';
import { FULL_TEXT_ATTR } from '../src/utils/full-text';
import { TITLE_FONT_SIZE } from '../src/utils/title-constants';

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

const palette = getPalette('nord').light;

function draw(src: string): SVGSVGElement {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 900 });
  Object.defineProperty(container, 'clientHeight', { value: 500 });
  renderEventLineForExport(
    container,
    parseEventLine(src, palette),
    palette,
    false,
    {
      width: 900,
      height: 500,
    }
  );
  return container.querySelector('svg')!;
}

// The #2435 pressure file shape: 150-char titles, unbroken 100-char words,
// 800-char descriptions, a chart title that is one unbroken run.
const WORD = 'Supercalifragilistic'.repeat(5);
const LONG_DESC = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
const PRESSURE = `event-line ${'T'.repeat(200)}

2020-01 ${'Long title words '.repeat(9).trim()}
  ${WORD}
2021-01 Second
  ${LONG_DESC} ${LONG_DESC}
2022-01 Third
  Short and fine.`;

describe('event-line long text (#2435)', () => {
  it('fits the chart title on the canvas and keeps the full text', () => {
    const svg = draw(PRESSURE);
    const title = svg.querySelector('text.chart-title')!;
    const width = Number(svg.getAttribute('width'));
    expect(title.textContent!.endsWith('…')).toBe(true);
    expect(
      measureText(title.textContent!, TITLE_FONT_SIZE, { bold: true })
    ).toBeLessThan(width);
    expect(title.getAttribute(FULL_TEXT_ATTR)).toBe('T'.repeat(200));
    expect(svg.querySelector('title')).toBeNull();
  });

  it('caps a long description and keeps its full text on the card', () => {
    const svg = draw(PRESSURE);
    const card = [...svg.querySelectorAll('g.dgmo-event-card')][1]!;
    const body = [...card.querySelectorAll('text')].filter((t) =>
      /word\d/.test(t.textContent ?? '')
    );
    expect(body).toHaveLength(DESC_MAX_LINES);
    expect(body[body.length - 1]!.textContent!.endsWith('…')).toBe(true);
    expect(card.getAttribute(FULL_TEXT_ATTR)).toContain('word79');
  });

  it('breaks an unbroken word inside its card', () => {
    const svg = draw(PRESSURE);
    const card = svg.querySelector('g.dgmo-event-card')!;
    const pieces = [...card.querySelectorAll('text')]
      .map((t) => t.textContent ?? '')
      .filter((t) => t.startsWith('Supercal'));
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join('')).toBe(WORD);
    // Drawn in full: no cut, no full-text attribute.
    expect(card.getAttribute(FULL_TEXT_ATTR)).toBeNull();
  });

  it('a short description draws in full with no attribute', () => {
    const svg = draw(PRESSURE);
    const card = [...svg.querySelectorAll('g.dgmo-event-card')][2]!;
    expect(card.getAttribute(FULL_TEXT_ATTR)).toBeNull();
  });
});
