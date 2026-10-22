// #1344 — a whiteboard colour can be given a meaning: a `tag` block names
// colours, and a legend above the board shows them.
import { describe, expect, it } from 'vitest';

import { TAG_SUPPORTING_TYPES } from '../src/completion-registry';
import { getPalette } from '../src/palettes';
import { emitWhiteboard, sameWhiteboard } from '../src/whiteboard/emit';
import { parseWhiteboard } from '../src/whiteboard/parser';
import { renderWhiteboard } from '../src/whiteboard/renderer';

const pal = getPalette('nord').light;

function draw(src: string): SVGSVGElement {
  const el = document.createElement('div');
  renderWhiteboard(el, parseWhiteboard(src, pal), pal, false);
  return el.querySelector('svg')!;
}

const TWO_COLOURS = [
  'rectangle Login at: 0 0, size: 120 60, color: red',
  'rectangle Signup at: 200 0, size: 120 60, color: blue',
];

describe('whiteboard tag block (#1344)', () => {
  it('is a tag-supporting chart type', () => {
    expect(TAG_SUPPORTING_TYPES.has('whiteboard')).toBe(true);
  });

  it('parses a tag block into colour names, block and inline forms', () => {
    const block = parseWhiteboard(
      [
        'whiteboard',
        'tag Meaning',
        '  Blocked red',
        '  Done green',
        ...TWO_COLOURS,
      ].join('\n')
    );
    expect(block.diagnostics).toEqual([]);
    expect(block.tagGroups).toHaveLength(1);
    expect(block.tagGroups[0]!.name).toBe('Meaning');
    expect(
      block.tagGroups[0]!.entries.map((e) => [e.value, e.color, e.lineNumber])
    ).toEqual([
      ['Blocked', 'red', 3],
      ['Done', 'green', 4],
    ]);
    // The shapes are untouched: they keep their own colour.
    expect(block.elements).toHaveLength(2);

    const inline = parseWhiteboard(
      [
        'whiteboard',
        'tag Meaning as m Waiting on legal orange, Done green',
        ...TWO_COLOURS,
      ].join('\n')
    );
    expect(inline.tagGroups[0]!.entries.map((e) => [e.value, e.color])).toEqual(
      [
        ['Waiting on legal', 'orange'],
        ['Done', 'green'],
      ]
    );
  });

  it('round-trips through emitWhiteboard, a quoted group name included', () => {
    const src = [
      'whiteboard',
      'tag "Review state" as rs',
      '  Waiting on legal orange',
      ...TWO_COLOURS,
    ].join('\n');
    const a = parseWhiteboard(src);
    const b = parseWhiteboard(emitWhiteboard(a));
    expect(b.tagGroups[0]!.name).toBe('Review state');
    expect(b.tagGroups[0]!.alias).toBe('rs');
    expect(sameWhiteboard(a, b)).toBe(true);
  });

  it('warns on an entry that names no whiteboard colour, and drops it', () => {
    const p = parseWhiteboard(
      [
        'whiteboard',
        'tag Meaning',
        '  Blocked',
        '  Done crimson',
        ...TWO_COLOURS,
      ].join('\n')
    );
    expect(p.tagGroups[0]!.entries).toEqual([]);
    expect(p.diagnostics.map((d) => [d.line, d.code])).toEqual([
      [3, 'W_WHITEBOARD_BAD_TAG_ENTRY'],
      [4, 'W_WHITEBOARD_BAD_TAG_ENTRY'],
    ]);
  });

  it('draws no legend under two colours', () => {
    const svg = draw(
      ['whiteboard', 'tag Meaning', '  Blocked red', TWO_COLOURS[0]!].join('\n')
    );
    expect(svg.querySelector('.whiteboard-legend')).toBeNull();
  });

  it('draws a faint legend of bare dots when no colour is named', () => {
    const svg = draw(['whiteboard', ...TWO_COLOURS].join('\n'));
    const legend = svg.querySelector('.whiteboard-legend');
    expect(legend).not.toBeNull();
    expect(legend!.getAttribute('opacity')).toBe('0.4');
    // One dot per colour, and no names beside them.
    expect(legend!.querySelectorAll('[data-series-name]')).toHaveLength(2);
  });

  it('draws the named colours at full strength, above the board', () => {
    // Same bounds, one colour: no legend.
    const plain = draw(
      [
        'whiteboard Flows',
        TWO_COLOURS[0]!,
        TWO_COLOURS[1]!.replace(', color: blue', ''),
      ].join('\n')
    );
    const svg = draw(
      ['whiteboard Flows', 'tag Meaning', '  Blocked red', ...TWO_COLOURS].join(
        '\n'
      )
    );
    const legend = svg.querySelector('.whiteboard-legend')!;
    expect(legend.getAttribute('opacity')).toBeNull();
    expect(legend.textContent).toContain('Blocked');
    // The board moves down to make room; the title stays on top.
    const ty = (s: SVGSVGElement): number =>
      Number(
        /translate\([^,]+,([-\d.]+)\)/.exec(
          s.querySelector('.whiteboard-canvas')!.getAttribute('transform')!
        )![1]
      );
    expect(ty(svg)).toBeGreaterThan(ty(plain));
    expect(Number(svg.getAttribute('height'))).toBeGreaterThan(
      Number(plain.getAttribute('height'))
    );
  });

  it('counts neither ink nor a note in its default yellow as a colour', () => {
    const svg = draw(
      [
        'whiteboard',
        'rectangle A at: 0 0, size: 120 60',
        'note Hi at: 200 0',
        'rectangle B at: 400 0, size: 120 60, color: red',
      ].join('\n')
    );
    expect(svg.querySelector('.whiteboard-legend')).toBeNull();
  });
});
