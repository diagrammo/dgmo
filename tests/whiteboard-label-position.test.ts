import { describe, expect, it } from 'vitest';

import { getPalette } from '../src/palettes';
import { emitWhiteboard } from '../src/whiteboard/emit';
import { whiteboardLabelPosition } from '../src/whiteboard/geometry';
import {
  WHITEBOARD_CONTAINER_FONT,
  WHITEBOARD_LABEL_LINE,
  whiteboardLabelCentreY,
  whiteboardLabelWidth,
  whiteboardShapeLabel,
} from '../src/whiteboard/label';
import { measureText } from '../src/utils/text-measure';
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

describe('a top label never runs into another shape (#1605)', () => {
  const layout = (...lines: string[]) => {
    const els = board(...lines);
    return { els, label: whiteboardShapeLabel(els[0] as WhiteboardShape, els) };
  };
  const span = (l: ReturnType<typeof whiteboardShapeLabel>) => {
    const h = l.lines.length * l.font * WHITEBOARD_LABEL_LINE;
    return { top: l.cy - h / 2, bottom: l.cy + h / 2 };
  };
  const LONG =
    'Oracle Cloud Infrastructure us-ashburn-1 production tenancy shared services compartment owned by SysEng';

  it('a short top label is 16px semibold; a middle one stays 14px regular', () => {
    const { label } = layout(
      'rectangle OCI at: 0 0, size: 260 280',
      'rectangle PV at: 80 100, size: 100 50'
    );
    expect(label).toMatchObject({
      lines: ['OCI'],
      font: WHITEBOARD_CONTAINER_FONT,
      bold: true,
      onEdge: false,
    });
    const plain = layout('rectangle Box at: 0 0, size: 100 50').label;
    expect(plain).toMatchObject({ font: 14, bold: false });
  });

  it('a long label fits the strip above the first child, shrinking, then …', () => {
    const { label } = layout(
      `rectangle ${LONG} at: 0 0, size: 260 280`,
      'rectangle PVO at: 80 60, size: 100 50'
    );
    expect(span(label).bottom).toBeLessThanOrEqual(60);
    expect(label.font).toBeLessThan(WHITEBOARD_CONTAINER_FONT);
    const tight = layout(
      `rectangle ${LONG} at: 0 0, size: 260 280`,
      'rectangle PVO at: 80 32, size: 100 50'
    ).label;
    expect(span(tight).bottom).toBeLessThanOrEqual(32);
    expect(tight.lines.at(-1)).toMatch(/\u2026$/);
  });

  it('with a child against the top, the label moves below the children', () => {
    const { label } = layout(
      'rectangle OCI at: 0 0, size: 260 280',
      'rectangle PVO at: 80 4, size: 100 50',
      'rectangle PV at: 80 150, size: 100 50'
    );
    expect(span(label).top).toBeGreaterThanOrEqual(200);
    expect(span(label).bottom).toBeLessThanOrEqual(280);
  });

  it('with no room above or below, one line sits in the top border, ending in …', () => {
    const { label } = layout(
      `rectangle ${LONG} at: 0 0, size: 260 120`,
      'rectangle Full at: 20 4, size: 220 112'
    );
    expect(label.onEdge).toBe(true);
    expect(label.cy).toBe(0);
    expect(label.lines).toHaveLength(1);
    expect(label.lines[0]).toMatch(/\u2026$/);
  });

  it('an explicit middle label moves to the clear strip nearest the centre', () => {
    const { label } = layout(
      'rectangle OCI at: 0 0, size: 260 280, label: middle',
      'rectangle PV at: 80 110, size: 100 60'
    );
    expect(label).toMatchObject({ font: 14, bold: false, onEdge: false });
    const { top, bottom } = span(label);
    expect(bottom <= 106 || top >= 174).toBe(true);
    const plain = layout('rectangle Box at: 0 0, size: 100 50').label;
    expect(plain.cy).toBe(25);
  });

  it('an enclosing container does not count; an enclosed one does', () => {
    const els = board(
      'rectangle Region at: 0 0, size: 300 300',
      'rectangle VCN at: 20 40, size: 260 240',
      'rectangle PV at: 100 140, size: 100 50'
    );
    const outer = whiteboardShapeLabel(els[0] as WhiteboardShape, els);
    const inner = whiteboardShapeLabel(els[1] as WhiteboardShape, els);
    expect(span(outer).bottom).toBeLessThanOrEqual(40);
    expect(span(inner).top).toBeGreaterThan(40);
    expect(span(inner).bottom).toBeLessThanOrEqual(140);
  });

  it('across random boards, every top or middle label stays inside its box and off every other shape', () => {
    let seed = 1601;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * n);
    };
    const words = [
      'OCI',
      'Oracle',
      'Cloud',
      'us-ashburn-1',
      'production',
      'shared',
      'services',
      'Kubernetes',
      'cluster',
    ];
    for (let k = 0; k < 300; k++) {
      const w = 80 + rnd(260);
      const h = 60 + rnd(260);
      const name = Array.from(
        { length: 1 + rnd(12) },
        () => words[rnd(words.length)]
      ).join(' ');
      const middle = k % 2 ? ', label: middle' : '';
      const lines = [`rectangle ${name} at: 0 0, size: ${w} ${h}${middle}`];
      for (let c = 0; c < 1 + rnd(3); c++) {
        const cw = 10 + rnd(Math.max(1, w - 20));
        const ch = 10 + rnd(Math.max(1, h - 20));
        const cx = rnd(Math.max(1, w - cw));
        const cy = rnd(Math.max(1, h - ch));
        lines.push(`rectangle c at: ${cx} ${cy}, size: ${cw} ${ch}`);
      }
      const els = parseWhiteboard(['whiteboard', ...lines].join('\n')).elements;
      const box = els[0] as WhiteboardShape;
      const l = whiteboardShapeLabel(box, els);
      if (l.lines.length === 0) continue;
      const { top, bottom } = span(l);
      const width = Math.max(
        ...l.lines.map((t) => measureText(t, l.font, { bold: l.bold }))
      );
      expect(width).toBeLessThanOrEqual(whiteboardLabelWidth(box) + 0.01);
      if (l.onEdge) {
        expect(l.cy).toBe(box.y);
        continue;
      }
      expect(top).toBeGreaterThanOrEqual(box.y);
      expect(bottom).toBeLessThanOrEqual(box.y + box.height);
      for (const o of els.slice(1) as WhiteboardShape[]) {
        const clear = bottom <= o.y || top >= o.y + o.height;
        expect(clear, `${lines.join(' | ')}`).toBe(true);
      }
    }
  });
});
