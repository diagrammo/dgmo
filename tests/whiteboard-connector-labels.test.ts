import { describe, expect, it } from 'vitest';

import { clipWhiteboardConnector } from '../src/whiteboard/geometry';
import {
  WHITEBOARD_LABEL_FONT,
  WHITEBOARD_LABEL_LINE,
} from '../src/whiteboard/label';
import { parseWhiteboard } from '../src/whiteboard/parser';
import { whiteboardConnectorLabelPoints } from '../src/whiteboard/renderer';
import type { WhiteboardElement } from '../src/whiteboard/types';
import { measureText } from '../src/utils/text-measure';

// #1923: a connector label must say which line it names — never on a
// crossing, never on another connector's stroke, never inside a shape.

/** The owner's twin-holds board: two diagonals crossing at their midpoints,
 *  two verticals whose midpoints fall inside a box. */
const TWIN_HOLDS = `whiteboard Twin Holds
rectangle Fore Hold at: 0 0, size: 160 244, fill: outline
rectangle Aft Hold at: 640 0, size: 160 244, fill: outline
rectangle Barrel A at: 16 28, size: 128 80
rectangle Barrel B at: 16 148, size: 128 80
rectangle Crate C at: 656 28, size: 128 80
rectangle Crate D at: 656 148, size: 128 80
queue Cargo Net at: 16 308, size: 128 80
rectangle Winch at: 656 308, size: 128 80
arrow binds from: 80 348, to: 80 68
arrow binds from: 80 348, to: 720 188
arrow hauals from: 694 368, to: 54 208
arrow hauls from: 720 348, to: 720 68
arrow from: 80 68, to: 720 68`;

type Box = { x0: number; y0: number; x1: number; y1: number };

function labelBox(text: string, p: { x: number; y: number }): Box {
  const hw = measureText(text, WHITEBOARD_LABEL_FONT) / 2;
  const hh = (WHITEBOARD_LABEL_FONT * WHITEBOARD_LABEL_LINE) / 2;
  return { x0: p.x - hw, y0: p.y - hh, x1: p.x + hw, y1: p.y + hh };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Whether segment a→b passes through box, by dense sampling. */
function strokeMeets(
  s: { x1: number; y1: number; x2: number; y2: number },
  b: Box
): boolean {
  for (let k = 0; k <= 200; k++) {
    const t = k / 200;
    const x = s.x1 + (s.x2 - s.x1) * t;
    const y = s.y1 + (s.y2 - s.y1) * t;
    if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
  }
  return false;
}

function distToSegment(
  p: { x: number; y: number },
  s: { x1: number; y1: number; x2: number; y2: number }
): number {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / (dx * dx + dy * dy))
  );
  return Math.hypot(p.x - (s.x1 + dx * t), p.y - (s.y1 + dy * t));
}

function connectors(els: readonly WhiteboardElement[]) {
  return els.filter(
    (e): e is Extract<WhiteboardElement, { kind: 'arrow' | 'line' }> =>
      e.kind === 'arrow' || e.kind === 'line'
  );
}

describe('connector label placement (#1923)', () => {
  const parsed = parseWhiteboard(TWIN_HOLDS);
  const els = parsed.elements;
  const placed = whiteboardConnectorLabelPoints(els);
  const labelled = connectors(els).filter((c) => c.label);

  it('parses clean and places every label', () => {
    expect(parsed.diagnostics).toEqual([]);
    expect(labelled).toHaveLength(4);
    for (const c of labelled) expect(placed.get(c)).toBeDefined();
  });

  it('no label touches another connector’s stroke', () => {
    for (const c of labelled) {
      const box = labelBox(c.label, placed.get(c)!);
      for (const o of connectors(els)) {
        if (o === c) continue;
        expect(
          strokeMeets(clipWhiteboardConnector(o, els), box),
          `"${c.label}" sits on another stroke`
        ).toBe(false);
      }
    }
  });

  it('no label sits inside a box that is not a container', () => {
    const boxes = els.filter(
      (e) => e.kind === 'shape' && !e.label.endsWith('Hold')
    ) as Extract<WhiteboardElement, { kind: 'shape' }>[];
    for (const c of labelled) {
      const box = labelBox(c.label, placed.get(c)!);
      for (const s of boxes) {
        expect(
          overlaps(box, {
            x0: s.x,
            y0: s.y,
            x1: s.x + s.width,
            y1: s.y + s.height,
          }),
          `"${c.label}" sits inside ${s.label}`
        ).toBe(false);
      }
    }
  });

  it('every label stays attached to its own line', () => {
    for (const c of labelled) {
      const s = clipWhiteboardConnector(c, els);
      const p = placed.get(c)!;
      // On the line, or just beside it — never further than its own size.
      expect(distToSegment(p, s)).toBeLessThan(
        measureText(c.label, WHITEBOARD_LABEL_FONT)
      );
    }
  });

  it('a label with nowhere clean to go steps beside its line, to the quieter side', () => {
    // A horizontal arrow whose whole run is covered by a second arrow lying
    // on top of it — no slide clears — with a box crowding the space below.
    const board = parseWhiteboard(
      [
        'whiteboard',
        'arrow go from: 0 100, to: 300 100',
        'line from: 0 100, to: 300 100',
        'rectangle Below at: 0 106, size: 300 60',
      ].join('\n')
    ).elements;
    const go = connectors(board).find((c) => c.label === 'go')!;
    const p = whiteboardConnectorLabelPoints(board).get(go)!;
    expect(p.y).toBeLessThan(100);
  });
});
