import { describe, it, expect } from 'vitest';
import { parseEventLine } from '../src/event-line/parser';
import {
  CARD_W,
  DOT_R,
  layoutEventLine,
  type EventLineLayout,
  type Placed,
} from '../src/event-line/layout';
import { getPalette } from '../src/palettes';

// Layout is computed as data before anything is drawn, so these tests read
// coordinates straight off `layoutEventLine` — no DOM, no SVG parsing.

const nordLight = getPalette('nord').light;

function layout(
  src: string,
  width = 1200,
  heightHint = 600,
  nowDate?: Date,
  activeGroup: string | null = null
): EventLineLayout {
  return layoutEventLine(parseEventLine(src, nordLight), nordLight, false, {
    width,
    heightHint,
    exportMode: true,
    hiddenSet: new Set(),
    activeGroup,
    nowDate,
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

describe('layoutEventLine — drawing-time geometry', () => {
  // Four January/February events crowd into lanes 0–3 above the spine; Far
  // sits alone on the right.
  const CLUSTER = `event-line T
side above

2020-01-01 One
  body
2020-01-15 Two
  body
2020-02-01 Three
  body
2020-02-10 Four
  body
2023-06-01 Far
  body`;

  it('gives each card its box and a leader from the spine to its near edge', () => {
    const l = layout(CLUSTER);
    expect(l.cards.map((c) => c.p)).toEqual(l.placed);
    for (const c of l.cards) {
      const b = box(l, c.p);
      expect(c.top).toBe(b.top);
      expect(c.near).toBe(b.bottom); // above the spine: the near edge is the bottom
      expect(c.leaderFrom).toBe(l.spineY);
      expect(c.eraBar).toBeNull();
    }
  });

  it('marks a leader that runs through another card, and only that one', () => {
    const l = layout(CLUSTER);
    // Lanes 1–3 reach past the lane-0 card stacked below them; lane 0 and the
    // lone Far card run clear.
    expect(l.cards.map((c) => [c.p.lane, c.leaderCrossesCard])).toEqual([
      [0, false],
      [1, true],
      [2, true],
      [3, true],
      [0, false],
    ]);
  });

  it('spans the spine 20px past the outer dots and dashes it after the last real event', () => {
    const l = layout(`event-line T

2020-01-01 a
2021-01-01 b
TBD c`);
    const xs = l.placed.map((p) => p.x);
    expect(l.spine.left).toBe(Math.min(...xs) - 20);
    expect(l.spine.right).toBe(Math.max(...xs) + 20);
    expect(l.spine.dashed).toBe(true);
    const lastReal = l.placed.find((p) => p.label === 'b')!;
    expect(l.spine.solidRight).toBe(lastReal.x);

    const solid = layout(`event-line T

2020-01-01 a
2021-01-01 b`);
    expect(solid.spine.dashed).toBe(false);
    expect(solid.spine.solidRight).toBe(solid.spine.right);
  });

  it('floats a collapsed era bar off the spine, inside the spine, and ends its leader there', () => {
    const l = layout(`event-line T
side above

[Alpha] collapsed: true
  2020-01-01 a1
  2020-06-01 a2
2021-01-01 z`);
    const era = l.cards.find((c) => c.p.kind === 'era')!;
    const bar = era.eraBar!;
    expect(bar.y).toBe(l.spineY - 13); // above: ERA_LEG toward the card
    expect(era.leaderFrom).toBe(bar.y);
    expect(bar.x0).toBeGreaterThanOrEqual(l.spine.left);
    expect(bar.x1).toBeLessThanOrEqual(l.spine.right);
    expect(bar.x1 - bar.x0).toBeGreaterThanOrEqual(32); // ≥ the 16px half-width floor
  });

  it('pads era brackets past their dots and splits a crowded seam between two eras', () => {
    const l = layout(`event-line T

[Early]
  2020-01-01 a
  2020-06-01 b
[Late]
  2020-06-10 c
  2021-01-01 d
2022-01-01 e`);
    const [early, late] = l.eraBrackets;
    expect([early!.era.name, late!.era.name]).toEqual(['Early', 'Late']);
    // Outer ends carry the full 14px pad.
    expect(early!.x0).toBe(early!.firstX - 14);
    expect(late!.x1).toBe(late!.lastX + 14);
    // The runs sit closer than two pads, so the seam is split at their midpoint
    // with a 3px gap each side — the brackets never overlap.
    expect(late!.firstX - early!.lastX).toBeLessThan(28);
    const mid = (early!.lastX + late!.firstX) / 2;
    expect(early!.x1).toBeCloseTo(mid - 3, 9);
    expect(late!.x0).toBeCloseTo(mid + 3, 9);
    expect(early!.x1).toBeLessThan(late!.x0);
  });

  it('pins `now` at its interpolated x with a tab clear of every card', () => {
    const l = layout(`event-line T
now 2021-01-01

2020-01-01 a
2022-01-01 b`);
    const [a, b] = l.placed;
    const now = l.now!;
    expect(now.x).toBe((a!.x + b!.x) / 2);
    expect(now.label).toBe('Jan 1, 2021');
    expect(now.y1 - now.y0).toBe(now.pillH);
    for (const c of l.cards) {
      const overlapsX =
        c.p.left < now.x + now.pillW / 2 &&
        c.p.left + CARD_W > now.x - now.pillW / 2;
      const overlapsY = c.top < now.y1 && c.top + c.p.cardH > now.y0;
      expect(overlapsX && overlapsY).toBe(false);
    }
    // The stem joins the diamond's rim to the tab's spine-side edge.
    const above = now.y1 <= l.spineY;
    expect(now.stemFrom).toBe(above ? l.spineY - DOT_R : l.spineY + DOT_R);
    expect(now.stemTo).toBe(above ? now.y1 : now.y0);
  });

  it('reads a computed `now` from the injected clock, and drops it off-scale', () => {
    const src = `event-line T
now

2020-01-01 a
2022-01-01 b`;
    const l = layout(src, 1200, 600, new Date(2021, 0, 1));
    expect(l.now!.label).toBe('Jan 1, 2021');
    expect(l.now!.x).toBe((l.placed[0]!.x + l.placed[1]!.x) / 2);
    const offScale = layout(src.replace('now\n', 'no-scale\nnow 2021-01-01\n'));
    expect(offScale.now).toBeNull();
  });

  it("pins `now` onto a card's x-span and still clears the card", () => {
    // `now` falls on event a's date, so a's card shares the pin's x-span: the
    // spine-adjacent slot sits inside the leader gap and must stay clear.
    const l = layout(`event-line T
now 2020-01-01

2020-01-01 a
2022-01-01 b`);
    const now = l.now!;
    expect(now.x).toBe(l.placed[0]!.x);
    const sharing = l.cards.filter(
      (c) =>
        c.p.left < now.x + now.pillW / 2 &&
        c.p.left + CARD_W > now.x - now.pillW / 2
    );
    expect(sharing.length).toBeGreaterThan(0);
    for (const c of sharing)
      expect(c.top < now.y1 && c.top + c.p.cardH > now.y0).toBe(false);
  });
});

describe('layoutEventLine — title and legend band', () => {
  const body = `
tag Genre as g
  Pop blue
  R&B teal

2012-02-05 XLVI  g: Pop
2013-02-03 XLVII  g: R&B`;

  it('reserves the title band, then the stacked legend band below it', () => {
    const bare = layout(`event-line\nno-title\n${body}`);
    expect(bare.header.showTitle).toBe(false);
    expect(bare.header.hasLegend).toBe(false);
    expect(bare.header.topUsed).toBe(0);

    const titled = layout(`event-line Shows\n${body}`);
    expect(titled.header.showTitle).toBe(true);
    expect(titled.header.titleH).toBe(48);
    expect(titled.header.topUsed).toBe(48);
    expect(titled.spineY - bare.spineY).toBe(48);

    const legend = layout(
      `event-line Shows\n${body}`,
      1200,
      600,
      undefined,
      'g'
    );
    expect(legend.header.hasLegend).toBe(true);
    expect(legend.header.placement.inline).toBe(false);
    expect(legend.header.topUsed).toBe(48 + 34);
    expect(legend.spineY - bare.spineY).toBe(48 + 34);
  });

  it('drops the legend band when the legend is off', () => {
    const l = layout(
      `event-line Shows\nno-legend\n${body}`,
      1200,
      600,
      undefined,
      'g'
    );
    expect(l.header.hasLegend).toBe(false);
    expect(l.header.topUsed).toBe(48);
  });
});
