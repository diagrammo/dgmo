import { describe, expect, it } from 'vitest';

import { getPalette } from '../src/palettes';
import { mix, shapeFill } from '../src/palettes/color-utils';
import { layoutSketch } from '../src/sketch/layout';
import { parseSketch } from '../src/sketch/parser';
import { renderSketch } from '../src/sketch/renderer';

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

Spyglass Feed shape: cloud, at: 0 0, crew: Deck
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

  it('draws every shape kind with a distinct body', () => {
    const svg = render(
      'sketch\nR at: 0 0\nD shape: database, at: 2 0\nQ shape: queue, at: 4 0\nC shape: cloud, at: 0 2\nP shape: person, at: 2 2\nDoc shape: document, at: 4 2\nN shape: note, at: 0 4'
    );
    expect(svg.querySelectorAll('.sk-node').length).toBe(7);
    // database + queue draw ellipse caps; person draws the icon circle
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
    expect(rect.getAttribute('fill')).toBe(mix(P.surface, P.bg, 40));
    expect(rect.getAttribute('stroke')).toBe(P.textMuted);
  });

  it('tagged edges take the tag color full-stroke; untagged use textMuted', () => {
    const src =
      'sketch\n\ntag Crew\n  Deck\n  Hold\n\nA at: 0 0, crew: Deck\n  -x-> b crew: Hold\n  -y-> b\nB as b at: 2 0';
    const svg = render(src);
    const strokes = [...svg.querySelectorAll('.sk-edge-group path')].map((p) =>
      p.getAttribute('stroke')
    );
    expect(strokes).toContain(P.textMuted);
    const holdColor = parseSketch(src, P).tagGroups[0]!.entries[1]!.color;
    expect(strokes).toContain(holdColor);
  });
});

describe('sketch renderer — edges', () => {
  it('heads map to markers: one=end, both=end+start, none=neither; dashed = 6 3', () => {
    const src =
      'sketch\nA at: 0 0\n  -one-> b\n  <-both-> b\n  -none- b\n  ~sec~> b\nB as b at: 4 0';
    const svg = render(src);
    const paths = [...svg.querySelectorAll('.sk-edge-group path')];
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

  it('edges leave ports at 90° (cubic with axis-aligned handles)', () => {
    const svg = render('sketch\nA at: 0 0\n  -> b\nB as b at: 4 0');
    const d = svg.querySelector('.sk-edge-group path')!.getAttribute('d')!;
    // Horizontal neighbors: start/first-handle share y (perpendicular exit).
    const m = d.match(/^M ([\d.]+) ([\d.]+) C ([\d.]+) ([\d.]+),/);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(m![4]);
  });

  it('renders edge labels with a background halo above nodes', () => {
    const svg = render('sketch\nA at: 0 0\n  -haul-> b\nB as b at: 4 0');
    const label = svg.querySelector('.sk-edge-label')!;
    expect(label.querySelector('rect')).not.toBeNull();
    expect(label.textContent).toBe('haul');
  });
});

describe('sketch renderer — text fit (AC 9)', () => {
  it('a 40-char name never escapes the footprint', () => {
    const name = 'Extraordinarily Long Shape Name For Test';
    expect(name.length).toBe(40);
    const svg = render(`sketch\n${name} at: 0 0`);
    const texts = [...svg.querySelectorAll('.sk-node text')];
    expect(texts.length).toBeGreaterThan(1); // wrapped
    const node = svg.querySelector('.sk-node rect')!;
    const w = Number(node.getAttribute('width'));
    expect(w).toBe(208); // footprint never grows
    for (const t of texts) {
      expect(Number(t.getAttribute('font-size'))).toBeLessThanOrEqual(13);
    }
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
});
