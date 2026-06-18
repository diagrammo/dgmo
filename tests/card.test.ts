import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import * as d3 from 'd3-selection';
import {
  renderNodeCard,
  renderCollapseBar,
  type NodeCardOptions,
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
    // headerHeight/2 + labelFontSize/2 - 2 = 14 + 6.5 - 2 = 18.5
    expect(label.attr('y')).toBe('18.5');
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

describe('renderCollapseBar', () => {
  it('appends a clipPath then a clipped, classed bar at the card bottom', () => {
    const g = makeGroup();
    renderCollapseBar(g, {
      width: 120,
      height: 60,
      barHeight: 6,
      inset: 0,
      rx: 6,
      fill: '#123456',
      clipId: 'clip-x',
      className: 'org-collapse-bar',
    });

    const children = g.node()!.childNodes;
    expect((children[0] as Element).tagName.toLowerCase()).toBe('clippath');
    expect((children[1] as Element).tagName.toLowerCase()).toBe('rect');

    const clipRect = g.select('clipPath rect');
    expect(clipRect.attr('rx')).toBe('6');

    const bar = g.select('rect.org-collapse-bar');
    expect(bar.attr('y')).toBe('54'); // height - barHeight
    expect(bar.attr('height')).toBe('6');
    expect(bar.attr('width')).toBe('120');
    expect(bar.attr('fill')).toBe('#123456');
    expect(bar.attr('clip-path')).toBe('url(#clip-x)');
    expect(bar.attr('class')).toBe('org-collapse-bar');
  });

  it('honors a non-zero inset on both sides', () => {
    const g = makeGroup();
    renderCollapseBar(g, {
      width: 120,
      height: 60,
      barHeight: 6,
      inset: 4,
      rx: 6,
      fill: '#000000',
      clipId: 'clip-y',
      className: 'bl-collapse-bar',
    });
    const bar = g.select('rect.bl-collapse-bar');
    expect(bar.attr('x')).toBe('4');
    expect(bar.attr('width')).toBe('112'); // width - inset*2
  });
});
