import { describe, expect, it } from 'vitest';

import { getPalette } from '../src/palettes';
import { emitWhiteboard } from '../src/whiteboard/emit';
import { whiteboardLabelPosition } from '../src/whiteboard/geometry';
import { whiteboardLabelCentreY } from '../src/whiteboard/label';
import { parseWhiteboard } from '../src/whiteboard/parser';
import { renderWhiteboard } from '../src/whiteboard/renderer';
import type { WhiteboardShape } from '../src/whiteboard/types';

// A container's label sits at the top (#1601): automatic for a rectangle
// that encloses another shape, note or image; `label:` overrides it.

function board(...lines: string[]) {
  const parsed = parseWhiteboard(['whiteboard', ...lines].join('\n'));
  expect(parsed.diagnostics).toEqual([]);
  return parsed.elements;
}

const at = (els: ReturnType<typeof board>, i = 0) =>
  whiteboardLabelPosition(els[i] as WhiteboardShape, els);

describe('automatic label position', () => {
  it('a rectangle enclosing a shape, note or image puts its label at the top', () => {
    expect(
      at(
        board(
          'rectangle OCI at: 0 0, size: 200 300',
          'rectangle PV at: 40 40, size: 100 50'
        )
      )
    ).toBe('top');
    expect(
      at(board('rectangle OCI at: 0 0, size: 200 300', 'note hi at: 10 10'))
    ).toBe('top');
    expect(
      at(
        board(
          'rectangle OCI at: 0 0, size: 200 300',
          'image pic.assets/a.webp at: 10 10, size: 50 50'
        )
      )
    ).toBe('top');
  });

  it('a child on the edge counts; one poking out does not', () => {
    expect(
      at(
        board(
          'rectangle at: 0 0, size: 200 300',
          'rectangle at: 0 0, size: 200 50'
        )
      )
    ).toBe('top');
    expect(
      at(
        board(
          'rectangle at: 0 0, size: 200 300',
          'rectangle at: 150 0, size: 100 50'
        )
      )
    ).toBe('middle');
  });

  it('a plain rectangle, an ellipse, and an identical box stay in the middle', () => {
    expect(at(board('rectangle at: 0 0, size: 200 300'))).toBe('middle');
    expect(
      at(
        board(
          'ellipse at: 0 0, size: 200 300',
          'rectangle at: 40 40, size: 50 50'
        )
      )
    ).toBe('middle');
    expect(
      at(
        board(
          'rectangle at: 0 0, size: 200 300',
          'rectangle at: 0 0, size: 200 300'
        )
      )
    ).toBe('middle');
  });

  it('only shapes, notes and images count — text and connectors do not', () => {
    expect(
      at(
        board(
          'rectangle at: 0 0, size: 200 300',
          'text hello at: 50 50',
          'arrow from: 10 10, to: 150 150'
        )
      )
    ).toBe('middle');
  });

  it('a written label: wins either way', () => {
    expect(
      at(
        board(
          'rectangle at: 0 0, size: 200 300, label: middle',
          'rectangle at: 40 40, size: 100 50'
        )
      )
    ).toBe('middle');
    expect(at(board('ellipse at: 0 0, size: 200 300, label: top'))).toBe('top');
  });
});

describe('label: in source', () => {
  it('parses top and middle, and round-trips', () => {
    const src = [
      'whiteboard',
      'rectangle A at: 0 0, size: 100 60, label: top',
      'rectangle B at: 200 0, size: 100 60, fill: outline, label: middle',
      'rectangle C at: 400 0, size: 100 60',
      '',
    ].join('\n');
    const parsed = parseWhiteboard(src);
    expect(parsed.diagnostics).toEqual([]);
    const shapes = parsed.elements as WhiteboardShape[];
    expect(shapes.map((s) => s.labelPosition)).toEqual([
      'top',
      'middle',
      undefined,
    ]);
    expect('labelPosition' in shapes[2]!).toBe(false);
    expect(emitWhiteboard(parsed)).toBe(src);
  });

  it('an unknown value warns and falls back to automatic', () => {
    const parsed = parseWhiteboard(
      'whiteboard\nrectangle at: 0 0, size: 100 60, label: tpo'
    );
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0]!.message).toContain('label');
    expect(parsed.diagnostics[0]!.message).toContain('top');
    expect((parsed.elements[0] as WhiteboardShape).labelPosition).toBe(
      undefined
    );
  });
});

describe('drawing', () => {
  const box = {
    kind: 'shape',
    shape: 'rectangle',
    x: 0,
    y: 100,
    width: 200,
    height: 300,
  } as const;

  it('middle centres the block; top sets it below the top padding', () => {
    expect(whiteboardLabelCentreY(box, 'middle', 20)).toBe(250);
    const top = whiteboardLabelCentreY(box, 'top', 20);
    expect(top - 10).toBeGreaterThan(100);
    expect(top - 10).toBeLessThan(120);
  });

  it('the renderer draws a container label near its top edge', () => {
    const container = (extra: string) => {
      document.body.innerHTML = '<div id="c"></div>';
      const el = document.getElementById('c')!;
      renderWhiteboard(
        el,
        parseWhiteboard(
          `whiteboard\nrectangle OCI at: 0 0, size: 200 300${extra}\nrectangle PV at: 50 150, size: 100 50`
        ),
        getPalette('slate').light,
        false
      );
      const label = el.querySelector('.whiteboard-label')!;
      return Number(
        label.getAttribute('y') ??
          label.querySelector('tspan')!.getAttribute('y')
      );
    };
    expect(container('')).toBeLessThan(40);
    expect(container(', label: middle')).toBeGreaterThan(140);
  });
});
