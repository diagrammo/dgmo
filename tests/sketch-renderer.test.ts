import { describe, expect, it } from 'vitest';

import { getPalette } from '../src/palettes';
import { mix, shapeFill } from '../src/palettes/color-utils';
import { SKETCH_FOOT_H, SKETCH_HALF_SLOT_Y } from '../src/sketch/geometry';
import { layoutSketch } from '../src/sketch/layout';
import { parseSketch } from '../src/sketch/parser';
import { renderSketch, sketchEdgeGeometry } from '../src/sketch/renderer';

const P = getPalette('nord').light;

function render(src: string, opts?: Parameters<typeof renderSketch>[5]) {
  const parsed = parseSketch(src, P);
  const layout = layoutSketch(parsed);
  const el = document.createElement('div');
  renderSketch(el, parsed, layout, P, false, opts);
  return el.querySelector('svg')!;
}

const PIRATE = `sketch Plunder Pipeline

tag Crew
  Deck
  Hold

Spyglass Feed shape: database, at: 0 0, crew: Deck
  -sightings-> con
Captain's Console as con at: 2 0, crew: Deck
  -orders-> bq
Divvy Service as dvy at: 4 0, crew: Hold

[Below Decks] at: 2 2, crew: Hold
  Booty Queue as bq shape: queue, at: 0 0
    ~haul~> dvy
  Ship Ledger as ledger shape: database, at: 2 0

[Armory] as armory at: 0 2, collapsed
  Powder Store at: 0 0
`;

describe('sketch renderer — structure', () => {
  it('renders nodes, box frames, edges, title, and legend', () => {
    const svg = render(PIRATE);
    expect(svg.querySelectorAll('.sk-node').length).toBe(6); // 5 shapes + 1 collapsed card
    expect(svg.querySelectorAll('.sk-box').length).toBe(1);
    expect(svg.querySelectorAll('.sk-edge-group').length).toBe(3);
    expect(svg.textContent).toContain('Plunder Pipeline');
    expect(svg.querySelector('.sk-legend-group')).not.toBeNull();
  });

  it('routes a hub`s third edge out a free side (top) when left+right are taken', () => {
    // Hub has edges left (l) and right (r); the up-and-left edge (u) is
    // primarily horizontal but its left side is claimed, so it must flip to the
    // hub`s TOP rather than crowd the left port.
    const svg = render(
      'sketch\n' +
        'Hub as hub at: 10 4\n  -a-> l\n  -b-> r\n  -c-> u\n' +
        'L as l at: 0 4\nR as r at: 20 4\nU as u at: 4 0\n'
    );
    // Edge groups are appended in declaration order: [→l, →r, →u].
    const [yl, yr, yu] = [...svg.querySelectorAll('.sk-edge-group')].map((g) =>
      Number(
        /^M\s+[-\d.]+\s+([-\d.]+)/.exec(
          g.querySelector('path')!.getAttribute('d')!
        )![1]
      )
    );
    // The side edges leave at mid-height; the flipped edge leaves higher (top).
    expect(yu).toBeLessThan(yl);
    expect(yu).toBeLessThan(yr);
  });

  it('marks each shape kind with a header type badge', () => {
    const svg = render(
      'sketch\nR at: 0 0\nD shape: database, at: 2 0\nQ shape: queue, at: 4 0\nP shape: person, at: 2 2\nDoc shape: document, at: 4 2\nN shape: note, at: 0 4'
    );
    expect(svg.querySelectorAll('.sk-node').length).toBe(6);
    // database + queue badges draw an ellipse cap; person badge draws a circle.
    expect(svg.querySelectorAll('.sk-node ellipse').length).toBe(2);
    expect(svg.querySelectorAll('.sk-node circle').length).toBe(1);
  });

  it('stamps data attributes for hover + canvas wiring', () => {
    const svg = render(PIRATE);
    const edge = svg.querySelector('.sk-edge-group')!;
    expect(edge.getAttribute('data-from')).toBeTruthy();
    expect(edge.getAttribute('data-to')).toBeTruthy();
    const node = svg.querySelector('.sk-node')!;
    expect(node.getAttribute('data-node-id')).toBeTruthy();
    expect(node.getAttribute('data-line-number')).toBeTruthy();
    const box = svg.querySelector('.sk-box')!;
    expect(box.getAttribute('data-group-toggle')).toBe('Below Decks');
  });
});

describe('sketch renderer — colors', () => {
  it('tagged shapes get the 25% tint fill + tag stroke', () => {
    const svg = render(PIRATE);
    const tagColor = parseSketch(PIRATE, P).tagGroups[0]!.entries[0]!.color;
    const expected = shapeFill(P, tagColor, false);
    const fills = [...svg.querySelectorAll('.sk-node path, .sk-node rect')].map(
      (el) => el.getAttribute('fill')
    );
    expect(fills).toContain(expected);
  });

  it('untagged shapes render neutral gray (decision 26a)', () => {
    const svg = render('sketch\nLonely at: 0 0');
    const rect = svg.querySelector('.sk-node rect')!;
    expect(rect.getAttribute('fill')).toBe(mix(P.textMuted, P.bg, 12));
    expect(rect.getAttribute('stroke')).toBe(P.textMuted);
  });

  it('edges: colored only by their OWN tag; untagged lines stay neutral', () => {
    // A is Deck; edge x is Hold (own tag → colored), edge y is untagged so it
    // stays neutral (no source inheritance), edge z is untagged too.
    const src =
      'sketch\n\ntag Crew\n  Deck\n  Hold\n\nA at: 0 0, crew: Deck\n  -x-> b crew: Hold\n  -y-> b\nB as b at: 2 0\nLone at: 0 2\n  -z-> b';
    const svg = render(src);
    const entries = parseSketch(src, P).tagGroups[0]!.entries;
    const deckColor = entries[0]!.color;
    const holdColor = entries[1]!.color;
    const strokes = new Set(
      [...svg.querySelectorAll('.sk-edge-group path')].map((p) =>
        p.getAttribute('stroke')
      )
    );
    expect(strokes).toContain(holdColor); // edge's own tag
    expect(strokes).toContain(P.textMuted); // untagged lines are neutral
    expect(strokes).not.toContain(deckColor); // no source-shape flow inheritance
  });
});

describe('sketch renderer — edges', () => {
  it('heads map to markers: one=end, both=end+start, none=neither; dashed = 6 3', () => {
    const src =
      'sketch\nA at: 0 0\n  -one-> b\n  <-both-> b\n  -none- b\n  ~sec~> b\nB as b at: 4 0';
    const svg = render(src);
    // Exclude the wide transparent hit paths (.sk-edge-hit) — count drawn lines.
    const paths = [
      ...svg.querySelectorAll('.sk-edge-group path:not(.sk-edge-hit)'),
    ];
    expect(paths.filter((p) => p.getAttribute('marker-end')).length).toBe(3);
    expect(paths.filter((p) => p.getAttribute('marker-start')).length).toBe(1);
    expect(
      paths.filter(
        (p) => !p.getAttribute('marker-end') && !p.getAttribute('marker-start')
      ).length
    ).toBe(1);
    expect(
      paths.filter((p) => p.getAttribute('stroke-dasharray') === '6 3').length
    ).toBe(1);
  });

  it('each edge carries a wide transparent hit path (easy click target)', () => {
    const svg = render('sketch\nA at: 0 0\n  -> b\nB as b at: 4 0');
    const hit = svg.querySelector('.sk-edge-group path.sk-edge-hit')!;
    expect(hit).not.toBeNull();
    expect(hit.getAttribute('stroke')).toBe('transparent');
    expect(Number(hit.getAttribute('stroke-width'))).toBeGreaterThan(10);
    expect(hit.getAttribute('pointer-events')).toBe('stroke');
    // Same geometry as the drawn line, and the drawn line is still resolved
    // first by `.sk-edge-group path` (hit path is appended last).
    const drawn = svg.querySelector('.sk-edge-group path')!;
    expect(drawn.classList.contains('sk-edge-hit')).toBe(false);
    expect(hit.getAttribute('d')).toBe(drawn.getAttribute('d'));
  });

  it('edges leave ports at 90° (cubic with axis-aligned handles)', () => {
    const svg = render('sketch\nA at: 0 0\n  -> b\nB as b at: 4 0');
    const d = svg.querySelector('.sk-edge-group path')!.getAttribute('d')!;
    // Horizontal neighbors: start/first-handle share y (perpendicular exit).
    const m = d.match(/^M ([\d.]+) ([\d.]+) C ([\d.]+) ([\d.]+),/);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(m![4]);
  });

  it('plain endpoints attach at facing-side midpoints (real ports)', () => {
    const parseEnds = (svg: SVGSVGElement): { y0: number; y1: number } => {
      const d = svg.querySelector('.sk-edge-group path')!.getAttribute('d')!;
      const m = d.match(/^M (\S+) (\S+) C \S+ \S+, \S+ \S+, (\S+) (\S+)$/)!;
      return { y0: Number(m[2]), y1: Number(m[4]) };
    };
    // Aligned pair → straight line through both card centers (equal endpoint y).
    const aligned = parseEnds(
      render('sketch\nA at: 0 0\n  -> b\nB as b at: 4 0')
    );
    expect(aligned.y0).toBeCloseTo(SKETCH_FOOT_H / 2, 3);
    expect(aligned.y1).toBeCloseTo(aligned.y0, 3);
    // Half-slot cross-offset → each end sits at its OWN card midpoint (a port),
    // not clamped to the overlap band → the two ys differ (clean diagonal).
    const offset = parseEnds(
      render('sketch\nA at: 0 0\n  -> b\nB as b at: 4 1')
    );
    expect(offset.y0).toBeCloseTo(SKETCH_FOOT_H / 2, 3);
    expect(offset.y1).toBeCloseTo(SKETCH_HALF_SLOT_Y + SKETCH_FOOT_H / 2, 3);
    expect(offset.y0).not.toBeCloseTo(offset.y1, 1);
  });

  it('renders edge labels with a background halo above nodes', () => {
    const svg = render('sketch\nA at: 0 0\n  -haul-> b\nB as b at: 4 0');
    const label = svg.querySelector('.sk-edge-label')!;
    expect(label.querySelector('rect')).not.toBeNull();
    expect(label.textContent).toBe('haul');
  });

  it('routes an edge AROUND a stacked sibling instead of through it', () => {
    // A shape below a group links to the group`s TOP child. The natural
    // straight attachment would enter the box from the bottom and cut through
    // the BOTTOM sibling to reach the top one — obstacle avoidance must reroute
    // it (here: enter the top child from a clear side).
    const src =
      'sketch\n' +
      'Net as net at: 0 6\n  -binds-> top\n' +
      '[Hold] at: 0 0\n' +
      '  Top as top at: 0 0\n' +
      '  Bot as bot at: 0 3\n';
    const parsed = parseSketch(src, P);
    const layout = layoutSketch(parsed);
    const idOf = (label: string) =>
      layout.nodes.find((n) => n.label === label)!.id;
    const [netId, topId, botId] = [idOf('Net'), idOf('Top'), idOf('Bot')];
    const geom = sketchEdgeGeometry(layout).find(
      (g) => g?.sourceId === netId && g?.targetId === topId
    )!;
    expect(geom).toBeTruthy();

    // Sample the cubic and assert no point lands inside the sibling `bot` rect.
    const m =
      /^M\s+([-\d.]+)\s+([-\d.]+)\s+C\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+)/.exec(
        geom.d
      )!;
    const [x0, y0, cx0, cy0, cx1, cy1, x1, y1] = m.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const bot = layout.nodes.find((n) => n.id === botId)!;
    let inside = 0;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const u = 1 - t;
      const px =
        u * u * u * x0 +
        3 * u * u * t * cx0 +
        3 * u * t * t * cx1 +
        t * t * t * x1;
      const py =
        u * u * u * y0 +
        3 * u * u * t * cy0 +
        3 * u * t * t * cy1 +
        t * t * t * y1;
      if (
        px > bot.x + 6 &&
        px < bot.x + bot.w - 6 &&
        py > bot.y + 6 &&
        py < bot.y + bot.h - 6
      )
        inside++;
    }
    expect(inside).toBe(0);
  });

  it('places a rerouted edge`s label clear of every shape', () => {
    // The Net→Top edge detours around the box; its label must sit on the ARC
    // midpoint (out in the bulge), not the endpoint average (which lands on the
    // box / sibling it routed past).
    const src =
      'sketch\n' +
      'Net as net at: 0 6\n  -binds-> top\n' +
      '[Hold] at: 0 0\n' +
      '  Top as top at: 0 0\n' +
      '  Bot as bot at: 0 3\n';
    const layout = layoutSketch(parseSketch(src, P));
    const idOf = (label: string) =>
      layout.nodes.find((n) => n.label === label)!.id;
    const geom = sketchEdgeGeometry(layout).find(
      (g) => g?.sourceId === idOf('Net') && g?.targetId === idOf('Top')
    )!;
    const rects = [
      ...layout.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h })),
      ...layout.boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })),
    ];
    const inside = rects.some(
      (r) =>
        geom.mid.x > r.x &&
        geom.mid.x < r.x + r.w &&
        geom.mid.y > r.y &&
        geom.mid.y < r.y + r.h
    );
    expect(inside).toBe(false);
  });

  it('declutters overlapping edge labels onto their own lines', () => {
    // Two edges cross in the middle; naively both labels land on the crossing
    // point and overlap. Declutter must slide them apart (each stays on its own
    // curve) so neither box intersects the other.
    const svg = render(
      'sketch\n' +
        'A as a at: 0 4\n  -alpha-> c\n' +
        'B as b at: 8 4\n  -beta-> d\n' +
        'C as c at: 8 0\nD as d at: 0 0\n'
    );
    const boxes = [...svg.querySelectorAll('.sk-edge-label rect')].map((r) => ({
      x: Number(r.getAttribute('x')),
      y: Number(r.getAttribute('y')),
      w: Number(r.getAttribute('width')),
      h: Number(r.getAttribute('height')),
    }));
    expect(boxes.length).toBe(2);
    const [a, b] = boxes as [(typeof boxes)[0], (typeof boxes)[0]];
    const overlap =
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(overlap).toBe(false);
  });

  it('fans multiple edges sharing a node side to distinct ports', () => {
    // Three edges leave a hub toward three right-side targets. All pick the
    // RIGHT side; they must attach at three DISTINCT points (a fan), not stack
    // on the side midpoint.
    const layout = layoutSketch(
      parseSketch(
        'sketch\n' +
          'H as h at: 0 3\n  -> a\n  -> b\n  -> c\n' +
          'A as a at: 6 0\nB as b at: 6 3\nC as c at: 6 6\n',
        P
      )
    );
    const idOf = (label: string) =>
      layout.nodes.find((n) => n.label === label)!.id;
    const geom = sketchEdgeGeometry(layout);
    const startY = (to: string) => {
      const g = geom.find(
        (x) => x?.sourceId === idOf('H') && x?.targetId === idOf(to)
      )!;
      return Number(/^M [\d.-]+ ([\d.-]+)/.exec(g.d)![1]);
    };
    const ys = [startY('A'), startY('B'), startY('C')];
    expect(new Set(ys).size).toBe(3); // three distinct ports
    // Ordered by target row: A (top) highest port, C (bottom) lowest.
    expect(ys[0]).toBeLessThan(ys[1]!);
    expect(ys[1]).toBeLessThan(ys[2]!);
  });

  it('adds a hop on one line where two edges cross', () => {
    // Two edges cross in the middle (swapped corners). Exactly one gets a
    // `dRender` hop path (an added C hump) so the crossing reads as a jump; the
    // pure `d` cubic is untouched. The other edge keeps a plain cubic.
    const layout = layoutSketch(
      parseSketch(
        'sketch\n' +
          'A as a at: 0 4\n  -x-> c\n' +
          'B as b at: 8 4\n  -y-> d\n' +
          'C as c at: 8 0\nD as d at: 0 0\n',
        P
      )
    );
    const geom = sketchEdgeGeometry(layout).filter(Boolean);
    const hopped = geom.filter((g) => g!.dRender);
    expect(hopped.length).toBe(1);
    const h = hopped[0]!;
    // Pure `d` is a single cubic (one `C`, no line-tos) for other consumers.
    expect(h.d).toMatch(/^M [\d.-]+ [\d.-]+ C [^A-Z]+$/);
    // The hop render path is a polyline (L commands) with a hump cubic — the
    // added geometry that reads as a jump.
    expect(h.dRender).toContain('L ');
    expect(h.dRender).toContain('C ');
  });

  it('picks the side that avoids crossing another edge', () => {
    // Mirrors the twin-holds case: a bottom-right node links to the TOP child of
    // a group, while a bottom-left node links to the BOTTOM child of the same
    // group. Routing the top-child edge up the group`s INNER side would cross
    // the bottom-child edge; it must take the OUTER side instead.
    const src =
      'sketch\n' +
      'Left as left at: 0 6\n  -> d\n' +
      'Right as right at: 8 6\n  -> c\n' +
      '[Box] at: 6 0\n' +
      '  Ctop as c at: 0 0\n' +
      '  Dbot as d at: 0 3\n';
    const layout = layoutSketch(parseSketch(src, P));
    const idOf = (label: string) =>
      layout.nodes.find((n) => n.label === label)!.id;
    const geom = sketchEdgeGeometry(layout);
    const find = (from: string, to: string) =>
      geom.find((g) => g?.sourceId === idOf(from) && g?.targetId === idOf(to))!;
    const sample = (d: string) => {
      const m =
        /^M\s+([-\d.]+)\s+([-\d.]+)\s+C\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+),\s+([-\d.]+)\s+([-\d.]+)/.exec(
          d
        )!;
      const [x0, y0, cx0, cy0, cx1, cy1, x1, y1] = m
        .slice(1)
        .map(Number) as number[];
      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const u = 1 - t;
        pts.push({
          x:
            u * u * u * x0! +
            3 * u * u * t * cx0! +
            3 * u * t * t * cx1! +
            t * t * t * x1!,
          y:
            u * u * u * y0! +
            3 * u * u * t * cy0! +
            3 * u * t * t * cy1! +
            t * t * t * y1!,
        });
      }
      return pts;
    };
    const cross = (
      a: { x: number; y: number }[],
      b: { x: number; y: number }[]
    ) => {
      const o = (p: any, q: any, r: any) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      let n = 0;
      for (let i = 0; i + 1 < a.length; i++)
        for (let j = 0; j + 1 < b.length; j++) {
          const d1 = o(a[i], a[i + 1], b[j]);
          const d2 = o(a[i], a[i + 1], b[j + 1]);
          const d3 = o(b[j], b[j + 1], a[i]);
          const d4 = o(b[j], b[j + 1], a[i + 1]);
          if (
            ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
            ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
          )
            n++;
        }
      return n;
    };
    expect(
      cross(sample(find('Right', 'Ctop').d), sample(find('Left', 'Dbot').d))
    ).toBe(0);
  });
});

describe('sketch renderer — text fit (AC 9)', () => {
  it('a 40-char name wraps onto multiple lines within the fixed footprint', () => {
    const name = 'Extraordinarily Long Shape Name For Test';
    expect(name.length).toBe(40);
    const svg = render(`sketch\n${name} at: 0 0`);
    const texts = [...svg.querySelectorAll('.sk-node text')];
    expect(texts.length).toBeGreaterThan(1); // wraps, not a tiny one-liner
    // No text lost: the visible lines reconstruct the full name (no ellipsis).
    expect(texts.map((t) => t.textContent).join(' ')).toBe(name);
    for (const t of texts) {
      const fs = Number(t.getAttribute('font-size'));
      expect(fs).toBeGreaterThanOrEqual(11);
      expect(fs).toBeLessThanOrEqual(30);
    }
    const node = svg.querySelector('.sk-node rect')!;
    expect(Number(node.getAttribute('width'))).toBe(208); // footprint never grows
  });
});

describe('sketch renderer — collapse (AC 12 static state)', () => {
  it('an authored-collapsed box renders as a card with the collapse-bar', () => {
    const svg = render(PIRATE);
    const card = svg.querySelector('.sk-box-collapsed')!;
    expect(card).not.toBeNull();
    expect(card.querySelector('.sk-collapse-bar')).not.toBeNull();
    expect(card.getAttribute('data-group-toggle')).toBe('Armory');
    expect(svg.textContent).toContain('Armory');
    expect(svg.textContent).not.toContain('Powder Store');
  });

  it('box band label renders big/thick/faded', () => {
    const svg = render(PIRATE);
    const band = [...svg.querySelectorAll('.sk-box text')].find(
      (t) => t.textContent === 'Below Decks'
    )!;
    expect(band.getAttribute('font-size')).toBe('19');
    expect(band.getAttribute('font-weight')).toBe('800');
    expect(Number(band.getAttribute('opacity'))).toBeCloseTo(0.55);
  });
});

describe('sketch renderer — options', () => {
  it('no-legend hides the legend', () => {
    const svg = render('sketch\nno-legend\n\ntag Crew\n  Deck\n\nA crew: Deck');
    expect(svg.querySelector('.sk-legend-group')).toBeNull();
  });

  it('solid-fill uses the raw tag color as fill', () => {
    const src =
      'sketch\nsolid-fill\n\ntag Crew\n  Deck\n\nA at: 0 0, crew: Deck';
    const svg = render(src);
    const tagColor = parseSketch(src, P).tagGroups[0]!.entries[0]!.color;
    const rect = svg.querySelector('.sk-node rect')!;
    expect(rect.getAttribute('fill')).toBe(tagColor);
  });

  it('no-descriptions hides card metadata rows (name fills the card)', () => {
    const rows = (svg: SVGSVGElement) =>
      [...svg.querySelectorAll('.sk-node text')].map((t) => t.textContent);
    const withRows = render(
      'sketch\ntag Crew\n  Deck\n\nA at: 0 0, crew: Deck'
    );
    expect(rows(withRows).some((t) => t?.includes('Crew'))).toBe(true);
    const hidden = render(
      'sketch\nno-descriptions\ntag Crew\n  Deck\n\nA at: 0 0, crew: Deck'
    );
    expect(rows(hidden).some((t) => t?.includes('Crew'))).toBe(false);
    expect(hidden.textContent).toContain('A'); // name still there
  });

  it('the hideDescriptions render option hides rows (view-state hd path)', () => {
    const src = 'sketch\ntag Crew\n  Deck\n\nA at: 0 0, crew: Deck';
    const svg = render(src, { hideDescriptions: true });
    const rowTexts = [...svg.querySelectorAll('.sk-node text')].map(
      (t) => t.textContent
    );
    expect(rowTexts.some((t) => t?.includes('Crew'))).toBe(false);
  });

  it('no-descriptions hides a free-text markdown description block', () => {
    const src = 'sketch\nLedger at: 0 0\n  > this is a note';
    // Shown by default: the markdown block (.sk-desc) is drawn.
    const shown = render(src);
    expect(shown.querySelector('.sk-desc')).not.toBeNull();
    expect(shown.textContent).toContain('this is a note');
    // Hidden via directive.
    const viaDirective = render(
      'sketch\nno-descriptions\nLedger at: 0 0\n  > this is a note'
    );
    expect(viaDirective.querySelector('.sk-desc')).toBeNull();
    expect(viaDirective.textContent).not.toContain('this is a note');
    expect(viaDirective.textContent).toContain('Ledger'); // name still there
    // Hidden via the render-option (canvas toggle path).
    const viaOption = render(src, { hideDescriptions: true });
    expect(viaOption.querySelector('.sk-desc')).toBeNull();
    expect(viaOption.textContent).not.toContain('this is a note');
  });
});
