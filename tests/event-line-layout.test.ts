import { describe, it, expect } from 'vitest';
import { parseEventLine } from '../src/event-line/parser';
import {
  CARD_W,
  layoutEventLine,
  type EventLineLayout,
  type Placed,
} from '../src/event-line/layout';
import { getPalette } from '../src/palettes';

// Layout is computed as data before anything is drawn, so these tests read
// coordinates straight off `layoutEventLine` — no DOM, no SVG parsing.

const nordLight = getPalette('nord').light;

function layout(src: string, width = 1200, heightHint = 600): EventLineLayout {
  return layoutEventLine(parseEventLine(src, nordLight), nordLight, false, {
    width,
    heightHint,
    exportMode: true,
    hiddenSet: new Set(),
    activeGroup: null,
    topUsed: 0,
  });
}

/** A card's box in canvas coordinates, from the layout alone. */
function box(l: EventLineLayout, p: Placed) {
  const near =
    p.side === 'above' ? l.spineY - l.laneNear(p) : l.spineY + l.laneNear(p);
  const top = p.side === 'above' ? near - p.cardH : near;
  return { left: p.left, right: p.left + CARD_W, top, bottom: top + p.cardH };
}

function expectNoOverlap(l: EventLineLayout): void {
  const boxes = l.placed.map((p) => box(l, p));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlap =
        a.left < b.right &&
        b.left < a.right &&
        a.top < b.bottom &&
        b.top < a.bottom;
      expect(overlap, `cards ${i} and ${j} overlap`).toBe(false);
    }
}

describe('layoutEventLine', () => {
  it('stacks five same-year cards into separate lanes that never overlap', () => {
    const l = layout(
      `event-line Crowded
no-scale
side above

2001 Alpha
  a short description here
2001 Bravo
  a short description here
2001 Charlie
  a short description here
2001 Delta
  a short description here
2001 Echo
  a short description here`,
      700,
      500
    );
    expect(l.placed).toHaveLength(5);
    expect(l.placed.every((p) => p.side === 'above')).toBe(true);
    // no-scale: even spacing from the left margin, at least MIN_SPACING apart.
    const xs = l.placed.map((p) => p.x);
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(96);
    // Every dot stays under its own card, inset from the card's edges.
    for (const p of l.placed) {
      expect(p.x).toBeGreaterThanOrEqual(p.left + 18);
      expect(p.x).toBeLessThanOrEqual(p.left + CARD_W - 18);
    }
    expectNoOverlap(l);
    // The canvas grows to hold the rightmost card rather than clamping it.
    const rightmost = Math.max(...l.placed.map((p) => p.left + CARD_W));
    expect(l.contentW).toBeGreaterThanOrEqual(rightmost);
  });

  it('keeps a crowded event on its true date and puts its card in a deeper lane', () => {
    const l = layout(`event-line T
side above

2020-01-01 One
  body
2020-01-15 Two
  body
2020-02-01 Three
  body
2023-06-01 Far
  body`);
    const [one, two, three, far] = l.placed;
    // Dates map to x in order, to scale: the three January events sit close
    // together and Far sits far to the right.
    expect(one!.x).toBeLessThan(two!.x);
    expect(two!.x).toBeLessThan(three!.x);
    expect(far!.x - three!.x).toBeGreaterThan(5 * (three!.x - one!.x));
    // The clustered cards cannot sit side by side, so they take more than one lane.
    expect(new Set([one, two, three].map((p) => p!.lane)).size).toBeGreaterThan(
      1
    );
    // A deeper lane is farther from the spine than a shallower one.
    const lane0 = [one, two, three].find((p) => p!.lane === 0)!;
    const lane1 = [one, two, three].find((p) => p!.lane === 1)!;
    expect(l.laneNear(lane1)).toBeGreaterThan(l.laneNear(lane0) + lane0.cardH);
    expectNoOverlap(l);
  });

  it('gives coincident dates one shared x', () => {
    const l = layout(`event-line T
side below

2020-05-01 First
2020-05-01 Second
2021-05-01 Later`);
    const [first, second, later] = l.placed;
    expect(second!.x).toBe(first!.x);
    expect(later!.x).toBeGreaterThan(first!.x);
    expect(first!.lane).not.toBe(second!.lane);
    expectNoOverlap(l);
  });

  it('alternates sides in source order and places eras opposite the cards', () => {
    const l = layout(`event-line T

[Era]
  2020-01-01 a
  2020-06-01 b
2021-01-01 c
2021-06-01 d`);
    expect(l.placed.map((p) => p.side)).toEqual([
      'above',
      'below',
      'above',
      'below',
    ]);
    expect(l.hasEras).toBe(true);
    expect(l.eraSide).toBe('below');
  });

  it('floats same-side collapsed eras apart so each card centers on its capsule', () => {
    const l = layout(
      `event-line Same Side
side above

[Alpha] collapsed: true
  2020-01-01 a1
  2020-06-01 a2

[Beta] collapsed: true
  2021-01-01 b1
  2021-06-01 b2`,
      1400
    );
    expect(l.placed.map((p) => p.kind)).toEqual(['era', 'era']);
    const [a, b] = l.placed;
    // Each card is centered on its capsule, so its leader runs straight down.
    expect(a!.left).toBeCloseTo(a!.x - CARD_W / 2, 6);
    expect(b!.left).toBeCloseTo(b!.x - CARD_W / 2, 6);
    expect(a!.spanHalf).toBeGreaterThan(0);
    // The two cards clear each other horizontally in the same lane.
    expect(a!.lane).toBe(b!.lane);
    expect(b!.left).toBeGreaterThanOrEqual(a!.left + CARD_W);
    expectNoOverlap(l);
  });

  it('puts the spine below everything above it', () => {
    const l = layout(`event-line T
side above

2020-01-01 One
  line one
  line two
2020-01-02 Two`);
    const tallest = Math.max(...l.placed.map((p) => l.laneNear(p) + p.cardH));
    expect(l.spineY).toBeGreaterThanOrEqual(tallest);
    for (const p of l.placed) expect(box(l, p).bottom).toBeLessThan(l.spineY);
  });
});
