import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSwimlane } from '../src/swimlane/parser';
import { layoutSwimlane } from '../src/swimlane/layout';
import { renderSwimlaneForExport } from '../src/swimlane/renderer';
import { getPalette } from '../src/palettes';
import { mix, themeBaseBg } from '../src/palettes/color-utils';
import { renderForExport } from '../src/d3';
import { measureText } from '../src/utils/text-measure';

const FIX = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

function render(
  name: string,
  isDark = false,
  paletteId = 'nord'
): SVGSVGElement {
  const palette = isDark
    ? getPalette(paletteId).dark
    : getPalette(paletteId).light;
  const parsed = parseSwimlane(FIX(name), palette);
  const layout = layoutSwimlane(parsed);
  const el = document.createElement('div');
  renderSwimlaneForExport(el, parsed, layout, palette, isDark, {
    exportDims: { width: layout.width + 40, height: layout.height + 80 },
    activeTagGroup: parsed.tagGroups[0]?.name ?? null,
  });
  return el.querySelector('svg')!;
}

describe('swimlane renderer — structure appears (AC11)', () => {
  it('draws lane bands, phase labels, nodes and edges', () => {
    const svg = render('swimlane-insurance.dgmo');
    expect(
      svg.querySelectorAll('.dgmo-swimlane-lanes path').length
    ).toBeGreaterThan(0);
    expect(svg.querySelectorAll('.dgmo-swimlane-phases text').length).toBe(4);
    expect(
      svg.querySelectorAll('.dgmo-swimlane-nodes g').length
    ).toBeGreaterThan(0);
    expect(
      svg.querySelectorAll('.dgmo-swimlane-edges path').length
    ).toBeGreaterThan(0);
  });

  it('emits editor↔diagram sync anchors (sw-node/data-node-id, sw-edge-group, chart-title)', () => {
    const svg = render('swimlane-insurance.dgmo');
    expect(
      svg.querySelectorAll('.sw-node[data-node-id]').length
    ).toBeGreaterThan(0);
    expect(
      svg.querySelectorAll('.sw-edge-group[data-line-number]').length
    ).toBeGreaterThan(0);
    expect(svg.querySelector('.chart-title[data-line-number]')).toBeTruthy();
  });

  it('draws a diamond for gateways and a circle for terminals', () => {
    const svg = render('swimlane-insurance.dgmo');
    expect(
      svg.querySelectorAll('.dgmo-swimlane-nodes polygon').length
    ).toBeGreaterThan(0);
    expect(
      svg.querySelectorAll('.dgmo-swimlane-nodes circle').length
    ).toBeGreaterThan(0);
  });

  it('dashes the routed back-edge', () => {
    const svg = render('swimlane-backedge.dgmo');
    const dashed = [
      ...svg.querySelectorAll('.dgmo-swimlane-edges path'),
    ].filter((p) => p.getAttribute('stroke-dasharray'));
    expect(dashed.length).toBeGreaterThan(0);
  });

  it('renders in dark mode and a second palette without throwing', () => {
    expect(
      render('swimlane-insurance.dgmo', true).childElementCount
    ).toBeGreaterThan(0);
    expect(
      render('swimlane-publishing.dgmo', false, 'catppuccin').childElementCount
    ).toBeGreaterThan(0);
  });
});

describe('swimlane renderer — snapshots', () => {
  it('publishing (LR, 2-deep)', () => {
    expect(render('swimlane-publishing.dgmo').outerHTML).toMatchSnapshot();
  });
  it('insurance (LR, phases + gateways + terminals)', () => {
    expect(render('swimlane-insurance.dgmo').outerHTML).toMatchSnapshot();
  });
  it('onboarding (TB transpose)', () => {
    expect(render('swimlane-tb.dgmo').outerHTML).toMatchSnapshot();
  });
});

describe('swimlane renderer — fill-outline (§1.9)', () => {
  const SRC = (directive: string): string => `swimlane Voyage
direction LR
${directive}
[Prep]
  lane Crew blue
    Chart Course -> Rig Sails
[Sail]
  lane Crew blue
    Rig Sails -> (Underway) success
  lane Port red
    (!Aground)`;

  function renderSrc(src: string): SVGSVGElement {
    const palette = getPalette('nord').light;
    const parsed = parseSwimlane(src, palette);
    const layout = layoutSwimlane(parsed);
    const el = document.createElement('div');
    renderSwimlaneForExport(el, parsed, layout, palette, false, {
      exportDims: { width: layout.width + 40, height: layout.height + 80 },
      activeTagGroup: null,
    });
    return el.querySelector('svg')!;
  }

  const palette = getPalette('nord').light;
  const baseBg = themeBaseBg(palette, false);

  it('task rects take the theme base bg with the raw lane color as stroke', () => {
    const svg = renderSrc(SRC('fill-outline'));
    const rects = [
      ...svg.querySelectorAll('.dgmo-swimlane-nodes .sw-node > rect'),
    ];
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.getAttribute('fill')).toBe(baseBg);
      expect(r.getAttribute('stroke')).toBe(palette.colors.blue);
    }
  });

  it('event terminals honor outline (success circle = bg fill, green stroke)', () => {
    const svg = renderSrc(SRC('fill-outline'));
    const circles = [
      ...svg.querySelectorAll('.dgmo-swimlane-nodes circle'),
    ].filter((c) => c.getAttribute('stroke') === palette.colors.green);
    expect(circles.length).toBeGreaterThan(0);
    // Outer success ring is bg-filled; inner decoration ring is fill=none.
    expect(circles.some((c) => c.getAttribute('fill') === baseBg)).toBe(true);
    const errCircle = [
      ...svg.querySelectorAll('.dgmo-swimlane-nodes circle'),
    ].find((c) => c.getAttribute('stroke') === palette.colors.red)!;
    expect(errCircle.getAttribute('fill')).toBe(baseBg);
  });

  it('lane background bands deliberately keep their structural tint', () => {
    const svg = renderSrc(SRC('fill-outline'));
    const band = svg.querySelector('.dgmo-swimlane-lanes path')!;
    expect(band.getAttribute('fill')).toBe(mix(palette.colors.blue, baseBg, 9));
  });

  it('default (tint) node fills are unchanged by the outline support', () => {
    const svg = renderSrc(SRC(''));
    const rect = svg.querySelector('.dgmo-swimlane-nodes .sw-node > rect')!;
    expect(rect.getAttribute('fill')).toBe(
      mix(palette.colors.blue, baseBg, 20)
    );
    expect(rect.getAttribute('stroke')).toBe(
      mix(palette.colors.blue, palette.text, 40)
    );
  });
});

describe('swimlane — renderForExport wiring (AC10)', () => {
  it('returns a non-empty SVG via the public export path', async () => {
    const svg = await renderForExport(
      FIX('swimlane-publishing.dgmo'),
      'light',
      getPalette('nord').light
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('dgmo-swimlane-lanes');
  });
});

// ── BPMN (#1874) ──────────────────────────────────────────────

interface Pt {
  x: number;
  y: number;
}
interface Rect {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The polyline a rendered path draws. Rounded corners are `Q` curves whose
 * control point IS the original corner, so reading M/L points and each Q's
 * control and end point recovers the route the layout handed the renderer.
 */
function pathPoints(d: string): Pt[] {
  const nums = (s: string): number[] =>
    (s.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
  const out: Pt[] = [];
  for (const cmd of d.match(/[MLQ][^MLQ]*/g) ?? []) {
    const v = nums(cmd.slice(1));
    for (let i = 0; i + 1 < v.length; i += 2)
      out.push({ x: v[i]!, y: v[i + 1]! });
  }
  return out;
}

/** Every node's box, read from the rendered shape (rect, diamond or circle). */
function nodeBoxes(svg: SVGSVGElement): Rect[] {
  const num = (el: Element, a: string): number => Number(el.getAttribute(a));
  return [...svg.querySelectorAll('.sw-node')].map((g) => {
    const id = g.getAttribute('data-node-id')!;
    const rect = g.querySelector(':scope > rect');
    if (rect)
      return {
        id,
        x1: num(rect, 'x'),
        y1: num(rect, 'y'),
        x2: num(rect, 'x') + num(rect, 'width'),
        y2: num(rect, 'y') + num(rect, 'height'),
      };
    const poly = g.querySelector(':scope > polygon');
    if (poly) {
      const v = pathPoints(
        'M' + poly.getAttribute('points')!.replace(/,/g, ' ')
      );
      return {
        id,
        x1: Math.min(...v.map((p) => p.x)),
        y1: Math.min(...v.map((p) => p.y)),
        x2: Math.max(...v.map((p) => p.x)),
        y2: Math.max(...v.map((p) => p.y)),
      };
    }
    const c = g.querySelector(':scope > circle')!;
    const r = num(c, 'r');
    return {
      id,
      x1: num(c, 'cx') - r,
      y1: num(c, 'cy') - r,
      x2: num(c, 'cx') + r,
      y2: num(c, 'cy') + r,
    };
  });
}

/** Lines (sequence and message flow) that pass through a node box. */
function linesThroughBoxes(svg: SVGSVGElement): string[] {
  const boxes = nodeBoxes(svg);
  const out = new Set<string>();
  const lines = [
    ...svg.querySelectorAll(
      '.dgmo-swimlane-edges path.sw-edge, .dgmo-swimlane-messages path'
    ),
  ];
  for (const el of lines) {
    const pts = pathPoints(el.getAttribute('d')!);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let t = 0; t <= len; t += 1) {
        const x = a.x + ((b.x - a.x) * t) / (len || 1);
        const y = a.y + ((b.y - a.y) * t) / (len || 1);
        for (const bx of boxes)
          if (
            x > bx.x1 + 0.5 &&
            x < bx.x2 - 0.5 &&
            y > bx.y1 + 0.5 &&
            y < bx.y2 - 0.5
          )
            out.add(
              `line ${el.getAttribute('data-line-number')} through ${bx.id}`
            );
      }
    }
  }
  return [...out];
}

describe('swimlane renderer — BPMN claims process (#1874)', () => {
  it('passes no edge through any node box on the rendered geometry', () => {
    const svg = render('swimlane-bpmn.dgmo');
    expect(
      svg.querySelectorAll('.dgmo-swimlane-edges path.sw-edge').length
    ).toBe(15);
    expect(svg.querySelectorAll('.dgmo-swimlane-messages path').length).toBe(2);
    expect(linesThroughBoxes(svg)).toEqual([]);
  });

  it('passes no edge through a node box in any swimlane fixture, either direction', () => {
    for (const f of [
      'swimlane-insurance.dgmo',
      'swimlane-publishing.dgmo',
      'swimlane-backedge.dgmo',
      'swimlane-tb.dgmo',
    ])
      expect([f, linesThroughBoxes(render(f))]).toEqual([f, []]);
    const tb = FIX('swimlane-bpmn.dgmo').replace(
      'swimlane Insurance claim',
      'swimlane Insurance claim\ndirection-tb'
    );
    const palette = getPalette('nord').light;
    const parsed = parseSwimlane(tb, palette);
    const layout = layoutSwimlane(parsed);
    const el = document.createElement('div');
    renderSwimlaneForExport(el, parsed, layout, palette, false);
    expect(linesThroughBoxes(el.querySelector('svg')!)).toEqual([]);
  });

  it('draws two pools: a name band for the insurer, a thin bar for the customer', () => {
    const svg = render('swimlane-bpmn.dgmo');
    const pools = [...svg.querySelectorAll('.sw-pool')];
    expect(pools.map((p) => p.getAttribute('data-pool'))).toEqual([
      'Customer',
      'Insurer',
    ]);
    const insurerName = pools[1]!.querySelector('text')!;
    expect(insurerName.textContent).toBe('Insurer');
    expect(insurerName.getAttribute('transform')).toMatch(/^rotate\(-90/);
    expect(
      pools[0]!.querySelector('text')!.getAttribute('transform')
    ).toBeNull();
  });

  it('draws message flow dashed, open circle at the source, hollow head', () => {
    const svg = render('swimlane-bpmn.dgmo');
    for (const m of svg.querySelectorAll('.dgmo-swimlane-messages path')) {
      expect(m.getAttribute('stroke-dasharray')).toBeTruthy();
      expect(m.getAttribute('marker-start')).toBe('url(#sw-msg-tail)');
      expect(m.getAttribute('marker-end')).toBe('url(#sw-msg-head)');
    }
    const head = svg.querySelector('#sw-msg-head polygon')!;
    expect(head.getAttribute('fill')).not.toBe(head.getAttribute('stroke'));
  });

  const nodeG = (svg: SVGSVGElement, id: string): Element =>
    svg.querySelector(`.sw-node[data-node-id="${id}"]`)!;

  it('draws an end event as one thick circle, a start thin, a boundary event double', () => {
    const svg = render('swimlane-bpmn.dgmo');
    const paid = nodeG(svg, 'Paid').querySelectorAll('circle');
    expect(paid.length).toBe(1);
    expect(Number(paid[0]!.getAttribute('stroke-width'))).toBeGreaterThan(3);
    const start = nodeG(svg, 'Claim received').querySelector('circle')!;
    expect(Number(start.getAttribute('stroke-width'))).toBeLessThan(2);
    // Timer boundary event: two rings plus the clock face.
    expect(nodeG(svg, '5 days').querySelectorAll('circle').length).toBe(3);
  });

  it('puts the exclusive gateway label above the diamond, with an X inside', () => {
    const svg = render('swimlane-bpmn.dgmo');
    const g = nodeG(svg, 'Amount over 5k?');
    const top = Math.min(
      ...pathPoints(
        'M' +
          g.querySelector('polygon')!.getAttribute('points')!.replace(/,/g, ' ')
      ).map((p) => p.y)
    );
    const label = g.querySelector('.sw-gateway-label')!;
    expect(label.textContent).toBe('Amount over 5k?');
    expect(Number(label.getAttribute('y'))).toBeLessThan(top);
    const x = g.querySelector('path')!.getAttribute('d')!;
    expect(x.match(/M/g)).toHaveLength(2);
    // Unlabelled gateways draw no label.
    expect(nodeG(svg, 'join').querySelector('text')).toBeNull();
  });

  it('draws task markers and the store / note attachments', () => {
    const svg = render('swimlane-bpmn.dgmo');
    expect(
      nodeG(svg, 'Check policy').querySelector('.sw-task-service')
    ).toBeTruthy();
    expect(
      nodeG(svg, 'Adjuster review').querySelector('.sw-task-user')
    ).toBeTruthy();
    expect(
      nodeG(svg, 'Notify customer').querySelector('.sw-task-send')
    ).toBeTruthy();
    expect(svg.querySelectorAll('.sw-artifact-store').length).toBe(1);
    const note = svg.querySelector('.sw-artifact-note')!;
    expect(
      [...note.querySelectorAll('text')].map((t) => t.textContent).join(' ')
    ).toBe('Under 5k, no person reviews the claim');
    expect(
      note.querySelector('.sw-association')!.getAttribute('stroke-dasharray')
    ).toBeTruthy();
  });
});

describe('swimlane renderer — long edge labels (#2264)', () => {
  const LABEL =
    'yes, the peril and the property are both listed in the schedule';
  const SRC = [
    'swimlane Claims',
    'lane Adjuster',
    '  <Is the loss covered?>',
    `    -${LABEL}-> Inspect the property`,
    '    -no-> Deny the claim',
    '  Inspect the property',
    '  Deny the claim',
  ].join('\n');

  function draw(src: string): SVGSVGElement {
    const palette = getPalette('nord').light;
    const parsed = parseSwimlane(src, palette);
    const layout = layoutSwimlane(parsed);
    const el = document.createElement('div');
    renderSwimlaneForExport(el, parsed, layout, palette, false, {
      exportDims: { width: layout.width + 40, height: layout.height + 80 },
    });
    return el.querySelector('svg')!;
  }

  it('wraps a label wider than its segment, keeping the full text as a title', () => {
    const svg = draw(SRC);
    const text = [...svg.querySelectorAll('.dgmo-swimlane-edges text')].find(
      (t) => t.querySelector('title')?.textContent === LABEL
    );
    expect(text).toBeDefined();
    const lines = [...text!.querySelectorAll('tspan')].map(
      (s) => s.textContent ?? ''
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const l of lines) expect(measureText(l, 11)).toBeLessThanOrEqual(120);
  });

  it('leaves a short label on one line with no title', () => {
    const svg = draw(SRC);
    const no = [...svg.querySelectorAll('.dgmo-swimlane-edges text')].find(
      (t) => t.textContent === 'no'
    );
    expect(no).toBeDefined();
    expect(no!.querySelector('tspan')).toBeNull();
    expect(no!.querySelector('title')).toBeNull();
  });
});
