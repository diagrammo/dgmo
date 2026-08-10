import { describe, it, expect } from 'vitest';
import { parseJourneyMap } from '../src/journey-map/parser';
import { renderJourneyMap } from '../src/journey-map/renderer';
import { getPalette } from '../src/palettes';
import { measureText } from '../src/utils/text-measure';

// A journey map is very wide and very short, its cards are narrow, its text is
// real prose, and nothing clips — so it is the chart type where an inaccurate
// width model shows first. It measured against a Helvetica table while drawing
// Inter, under-measured every string by ~8%, and drew the last word of a line
// past the card's right border (issue 147).
//
// Growing a card taller costs nothing here: the layout already levels every
// card to the tallest one, so the reserved vertical space is there either way.
// Wrapping is always the right answer; clipping or ellipsizing body text is
// not, which is why these assert containment rather than "no overflow marks".

const P = getPalette('nord').light;
const DIMS = { width: 1400, height: 700 };

// The diagram from the ecosystem docs page where the overflow was spotted.
const SRC = `journey-map Being invited into someone else's space

persona New member
  Sent a link by a colleague, has no account yet

[Before]
  Sign in with the invited address score: 3
    pain: Claim on login fires only at sign in, so nothing appears
  Open the link you were sent score: 4

[After]
  Find the space in your list score: 2
    pain: Nothing pushes the change, so it lands whenever something re-lists
  Start editing a diagram score: 5
`;

interface Run {
  text: string;
  x: number;
  width: number;
  anchor: string;
}

function textRuns(scope: Element): Run[] {
  const runs: Run[] = [];
  for (const el of scope.querySelectorAll('text')) {
    // A <text> with tspans reports its children's content; measure each line.
    const spans = el.querySelectorAll('tspan');
    const parts = spans.length
      ? [...spans].map((s) => ({ node: s, text: s.textContent ?? '' }))
      : [{ node: el, text: el.textContent ?? '' }];
    const size = Number(el.getAttribute('font-size') ?? 12);
    const bold = el.getAttribute('font-weight') === 'bold';
    for (const p of parts) {
      if (!p.text.trim()) continue;
      const x = Number(p.node.getAttribute('x') ?? el.getAttribute('x') ?? 0);
      runs.push({
        text: p.text,
        x,
        width: measureText(p.text, size, { bold }),
        anchor: el.getAttribute('text-anchor') ?? 'start',
      });
    }
  }
  return runs;
}

function extent(run: Run): { left: number; right: number } {
  if (run.anchor === 'middle') {
    return { left: run.x - run.width / 2, right: run.x + run.width / 2 };
  }
  if (run.anchor === 'end') return { left: run.x - run.width, right: run.x };
  return { left: run.x, right: run.x + run.width };
}

function render(src: string): SVGSVGElement {
  const el = document.createElement('div');
  renderJourneyMap(el, parseJourneyMap(src), P, false, { exportDims: DIMS });
  return el.querySelector('svg')!;
}

describe('journey-map text stays inside the rect it belongs to', () => {
  it('keeps every step-card text run within its card', () => {
    const svg = render(SRC);
    const cards = [...svg.querySelectorAll('.journey-step')];
    expect(cards.length).toBeGreaterThan(0);

    const overflowing: string[] = [];
    for (const card of cards) {
      const rect = card.querySelector('rect');
      if (!rect) continue;
      const rx = Number(rect.getAttribute('x'));
      const rw = Number(rect.getAttribute('width'));
      for (const run of textRuns(card)) {
        const { left, right } = extent(run);
        // Half a pixel of slack: the widths are an additive per-glyph model
        // with no kerning, so they are close but not the renderer's own float.
        if (left < rx - 0.5 || right > rx + rw + 0.5) {
          overflowing.push(
            `"${run.text}" spans ${left.toFixed(1)}–${right.toFixed(1)}, ` +
              `card spans ${rx.toFixed(1)}–${(rx + rw).toFixed(1)}`
          );
        }
      }
    }
    expect(overflowing).toEqual([]);
  });

  it('keeps the persona name inside the persona panel', () => {
    const svg = render(SRC);
    const panel = svg.querySelector('.journey-persona')!;
    const rect = panel.querySelector('rect')!;
    const rx = Number(rect.getAttribute('x'));
    const rw = Number(rect.getAttribute('width'));

    for (const run of textRuns(panel)) {
      const { left, right } = extent(run);
      expect(left).toBeGreaterThanOrEqual(rx - 0.5);
      expect(right).toBeLessThanOrEqual(rx + rw + 0.5);
    }
  });

  it('keeps the diagram title clear of the persona panel', () => {
    const svg = render(SRC);
    const title = svg.querySelector('.chart-title text')!;
    const panelRect = svg.querySelector('.journey-persona rect')!;
    const panelX = Number(panelRect.getAttribute('x'));

    const size = Number(title.getAttribute('font-size'));
    const right =
      Number(title.getAttribute('x')) +
      measureText(title.textContent ?? '', size, { bold: true });
    expect(right).toBeLessThanOrEqual(panelX);
  });

  it('grows the card rather than losing the words', () => {
    // A long step title wraps onto more lines; it is never ellipsized, and the
    // words all survive. This is the half of the fix that a safety margin on
    // the old table would have got wrong.
    const long = `journey-map Wrapping

[Only]
  Sign in with the invited address and then confirm it score: 3
`;
    const svg = render(long);
    const card = svg.querySelector('.journey-step')!;
    const joined = textRuns(card)
      .map((r) => r.text)
      .join(' ');
    expect(joined).not.toContain('…');
    for (const word of 'Sign in with the invited address and then confirm it'.split(
      ' '
    )) {
      expect(joined).toContain(word);
    }
  });
});
