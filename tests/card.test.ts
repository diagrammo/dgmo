import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import * as d3 from 'd3-selection';
import {
  renderNodeCard,
  renderContainerCard,
  renderCollapseBar,
  type NodeCardOptions,
  type ContainerCardOptions,
} from '../src/utils/card';

// Set up jsdom globals (mirrors the other renderer tests).
beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  Object.defineProperty(globalThis, 'document', {
    value: win.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
  });
});

function makeGroup() {
  const svg = d3
    .select(document.body)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg');
  return svg.append('g');
}

const BASE: NodeCardOptions = {
  width: 120,
  height: 60,
  rx: 6,
  fill: '#abcdef',
  stroke: '#123456',
  strokeWidth: 1.5,
  label: 'Node',
  labelColor: '#ffffff',
  labelFontSize: 13,
  headerHeight: 28,
};

describe('renderNodeCard', () => {
  it('draws a rect then a label, in that order, with the convention attrs', () => {
    const g = makeGroup();
    renderNodeCard(g, BASE);

    const children = g.node()!.childNodes;
    expect(children).toHaveLength(2);
    expect((children[0] as Element).tagName.toLowerCase()).toBe('rect');
    expect((children[1] as Element).tagName.toLowerCase()).toBe('text');

    const rect = g.select('rect');
    expect(rect.attr('width')).toBe('120');
    expect(rect.attr('height')).toBe('60');
    expect(rect.attr('rx')).toBe('6');
    expect(rect.attr('fill')).toBe('#abcdef');
    expect(rect.attr('stroke')).toBe('#123456');
    expect(rect.attr('stroke-width')).toBe('1.5');
    expect(rect.attr('stroke-dasharray')).toBeNull();

    const label = g.select('text');
    expect(label.text()).toBe('Node');
    expect(label.attr('text-anchor')).toBe('middle');
    expect(label.attr('font-weight')).toBe('bold');
    expect(label.attr('x')).toBe('60'); // width / 2
    // The header band's centre, headerHeight / 2 — the renderer does the
    // baseline itself. This asserted 18.5 until 2026-08-09, when the single-
    // line branch still added `labelFontSize / 2 - 2` by hand while the
    // multi-line branch beside it already used `dominant-baseline`, so one
    // card's title moved depending on whether it wrapped.
    expect(label.attr('y')).toBe('14'); // headerHeight / 2
    expect(label.attr('dominant-baseline')).toBe('central');
    expect(label.attr('fill')).toBe('#ffffff');
  });

  it('adds the dashed border when dashed is set', () => {
    const g = makeGroup();
    renderNodeCard(g, { ...BASE, dashed: true });
    expect(g.select('rect').attr('stroke-dasharray')).toBe('6 3');
  });

  it('draws no separator or meta rows when meta is absent', () => {
    const g = makeGroup();
    renderNodeCard(g, BASE);
    expect(g.selectAll('line').size()).toBe(0);
    expect(g.selectAll('text').size()).toBe(1); // label only
  });

  it('draws the separator and one key+value text pair per meta row', () => {
    const g = makeGroup();
    renderNodeCard(g, {
      ...BASE,
      meta: {
        rows: [
          ['Owner', 'Ada'],
          ['Team', 'Core'],
        ],
        fontSize: 11,
        lineHeight: 16,
        separatorGap: 6,
        separatorColor: '#999999',
        textColor: '#ffffff',
      },
    });

    const sep = g.select('line');
    expect(sep.attr('y1')).toBe('28'); // headerHeight
    expect(sep.attr('y2')).toBe('28');
    expect(sep.attr('stroke')).toBe('#999999');
    expect(sep.attr('stroke-opacity')).toBe('0.3');
    expect(sep.attr('stroke-width')).toBe('1');

    // label + 2 rows * (key + value) = 5 text nodes
    expect(g.selectAll('text').size()).toBe(5);

    const texts = g.selectAll('text').nodes() as Element[];
    expect(texts[1]!.textContent).toBe('Owner: ');
    expect(texts[2]!.textContent).toBe('Ada');
    expect(texts[3]!.textContent).toBe('Team: ');
    expect(texts[4]!.textContent).toBe('Core');

    // First meta baseline = headerHeight + separatorGap + fontSize = 28 + 6 + 11
    expect((texts[1] as Element).getAttribute('y')).toBe('45');
    // Second row baseline = 45 + lineHeight(16) = 61
    expect((texts[3] as Element).getAttribute('y')).toBe('61');

    // Value column is right of the key column.
    const keyX = Number((texts[1] as Element).getAttribute('x'));
    const valueX = Number((texts[2] as Element).getAttribute('x'));
    expect(valueX).toBeGreaterThan(keyX);
  });
});

const CONTAINER: ContainerCardOptions = {
  width: 200,
  height: 90,
  rx: 8,
  fill: '#eeeeee',
  stroke: '#336699',
  strokeWidth: 1.5,
  label: 'Team',
  labelColor: '#111111',
  labelFontSize: 13,
  headerHeight: 30,
  rows: [],
  keyColor: '#777777',
  metaFontSize: 11,
  metaLineHeight: 16,
};

describe('renderContainerCard', () => {
  it('draws the rect at 0.35 stroke opacity, then a bold centred label', () => {
    const g = makeGroup();
    renderContainerCard(g, CONTAINER);

    const children = g.node()!.childNodes;
    expect(children).toHaveLength(2);
    const rect = g.select('rect');
    expect(rect.attr('fill')).toBe('#eeeeee');
    expect(rect.attr('stroke')).toBe('#336699');
    expect(rect.attr('stroke-opacity')).toBe('0.35');
    expect(rect.attr('stroke-width')).toBe('1.5');
    const label = g.select('text');
    expect(label.text()).toBe('Team');
    expect(label.attr('x')).toBe('100');
    expect(label.attr('y')).toBe('15');
    expect(label.attr('font-weight')).toBe('bold');
  });

  it('draws one muted key and one coloured value per row, with no separator', () => {
    const g = makeGroup();
    renderContainerCard(g, {
      ...CONTAINER,
      rows: [
        ['Lead', 'Ada', '#aa0000'],
        ['Size', '4', '#111111'],
      ],
    });

    expect(g.select('line').empty()).toBe(true);
    const texts = g.selectAll('text').nodes() as Element[];
    expect(texts).toHaveLength(5);
    expect(texts[1]!.textContent).toBe('Lead: ');
    expect(texts[1]!.getAttribute('fill')).toBe('#777777');
    expect(texts[2]!.textContent).toBe('Ada');
    expect(texts[2]!.getAttribute('fill')).toBe('#aa0000');
    // First baseline = headerHeight + metaFontSize - 2 = 30 + 11 - 2.
    expect(texts[1]!.getAttribute('y')).toBe('39');
    expect(texts[3]!.getAttribute('y')).toBe('55');
    expect(Number(texts[2]!.getAttribute('x'))).toBeGreaterThan(10);
  });
});

describe('renderCollapseBar', () => {
  it('appends a clipPath then a clipped, classed 4px bar at the card bottom', () => {
    const g = makeGroup();
    renderCollapseBar(g, {
      width: 120,
      height: 60,
      rx: 6,
      fill: '#123456',
      clipId: 'clip-x',
      prefix: 'org',
    });

    const children = g.node()!.childNodes;
    expect((children[0] as Element).tagName.toLowerCase()).toBe('clippath');
    expect((children[1] as Element).tagName.toLowerCase()).toBe('rect');

    const clipRect = g.select('clipPath rect');
    expect(clipRect.attr('rx')).toBe('6');

    const bar = g.select('rect.org-collapse-bar');
    expect(bar.attr('y')).toBe('56'); // height - COLLAPSE_BAR_HEIGHT
    expect(bar.attr('height')).toBe('4');
    expect(bar.attr('width')).toBe('120');
    expect(bar.attr('fill')).toBe('#123456');
    expect(bar.attr('clip-path')).toBe('url(#clip-x)');
    expect(bar.attr('class')).toBe('org-collapse-bar dgmo-collapse-bar');
  });

  it('offsets bar and clip by the card origin and scales the height', () => {
    const g = makeGroup();
    renderCollapseBar(g, {
      x: 10,
      y: 20,
      width: 120,
      height: 60,
      rx: 6,
      fill: '#000000',
      clipId: 'clip-y',
      prefix: 'bl',
      scale: 0.5,
    });
    const bar = g.select('rect.bl-collapse-bar');
    expect(bar.attr('x')).toBe('10');
    expect(bar.attr('height')).toBe('2');
    expect(bar.attr('y')).toBe('78'); // 20 + 60 - 2
    expect(g.select('clipPath rect').attr('x')).toBe('10');
  });
});
