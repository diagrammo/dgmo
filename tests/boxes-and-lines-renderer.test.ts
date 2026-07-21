import { describe, it, expect } from 'vitest';
import { parseBoxesAndLines } from '../src/boxes-and-lines/parser';
import { layoutBoxesAndLines } from '../src/boxes-and-lines/layout';
import { renderBoxesAndLines } from '../src/boxes-and-lines/renderer';
import { getPalette } from '../src/palettes';
import {
  mix,
  relativeLuminance,
  shapeFill,
  valueRampColor,
} from '../src/palettes/color-utils';

const P = getPalette('nord').light;
const DIMS = { width: 800, height: 600 };

async function render(
  src: string,
  opts?: { activeTagGroup?: string | null }
): Promise<SVGSVGElement> {
  const parsed = parseBoxesAndLines(src);
  const layout = await layoutBoxesAndLines(parsed);
  const el = document.createElement('div');
  renderBoxesAndLines(el, parsed, layout, P, false, {
    exportDims: DIMS,
    ...opts,
  });
  return el.querySelector('svg')!;
}

function nodeFor(svg: SVGSVGElement, label: string): SVGGElement {
  return svg.querySelector<SVGGElement>(`.bl-node[data-node-id="${label}"]`)!;
}

function nodeCenterX(svg: SVGSVGElement, label: string): number {
  const t = nodeFor(svg, label).getAttribute('transform')!;
  return Number(/translate\(([\d.]+)/.exec(t)![1]);
}

describe('boxes-and-lines renderer — edge labels', () => {
  it('centers an edge label between its two nodes (not clipped under the target)', async () => {
    const svg = await render('boxes-and-lines\nA -guards-> B');
    const labels = [...svg.querySelectorAll('.bl-edge-labels text')].filter(
      (t) => t.textContent === 'guards'
    );
    expect(labels.length).toBe(1);
    const lx = Number(labels[0]!.getAttribute('x'));
    const ax = nodeCenterX(svg, 'A');
    const bx = nodeCenterX(svg, 'B');
    // Label sits in the gap between the node centres, ~centred (not at the
    // target edge where it would clip under the node).
    expect(lx).toBeGreaterThan(Math.min(ax, bx));
    expect(lx).toBeLessThan(Math.max(ax, bx));
    expect(Math.abs(lx - (ax + bx) / 2)).toBeLessThan(Math.abs(bx - ax) / 4);
  });

  it('paints edge labels after nodes so boxes never clip them (z-order)', async () => {
    const svg = await render('boxes-and-lines\nA -guards-> B');
    const labelLayer = svg.querySelector('.bl-edge-labels')!;
    const lastNode = [...svg.querySelectorAll('.bl-node')].pop()!;
    expect(labelLayer).toBeTruthy();
    // bl-edge-labels follows the nodes in document order ⇒ painted on top.
    expect(
      lastNode.compareDocumentPosition(labelLayer) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('wraps a long edge label onto multiple tspans', async () => {
    const svg = await render(
      'boxes-and-lines\nA -reads the styling guidance document-> B'
    );
    const label = [...svg.querySelectorAll('.bl-edge-labels text')].find((t) =>
      (t.textContent ?? '').includes('styling')
    )!;
    expect(label).toBeTruthy();
    expect(label.querySelectorAll('tspan').length).toBeGreaterThan(1);
  });

  it('keeps a long label clear of the boxes in a tight LR chain', async () => {
    // The screenshot case: short hops in LR with a long label that used to clip.
    const svg = await render(
      'boxes-and-lines\ndirection LR\nAI Assistant -get_language_reference-> Server'
    );
    const label = [...svg.querySelectorAll('.bl-edge-labels text')].find((t) =>
      (t.textContent ?? '').includes('language')
    )!;
    expect(label).toBeTruthy();
    // Label box (the halo rect, sibling of the text in the same label group)
    // must not intersect any node box.
    const lb = label.parentElement!.querySelector('rect') as SVGRectElement;
    const lx = Number(lb.getAttribute('x'));
    const ly = Number(lb.getAttribute('y'));
    const lw = Number(lb.getAttribute('width'));
    const lh = Number(lb.getAttribute('height'));
    for (const n of svg.querySelectorAll('.bl-node')) {
      const r = n.querySelector('rect') as SVGRectElement | null;
      const t = (n as SVGGElement).getAttribute('transform') ?? '';
      const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(t);
      if (!r || !m) continue;
      const nx = Number(m[1]) + Number(r.getAttribute('x'));
      const ny = Number(m[2]) + Number(r.getAttribute('y'));
      const nw = Number(r.getAttribute('width'));
      const nh = Number(r.getAttribute('height'));
      const overlap =
        lx < nx + nw && lx + lw > nx && ly < ny + nh && ly + lh > ny;
      expect(overlap).toBe(false);
    }
  });
});

describe('boxes-and-lines renderer — value ramp', () => {
  it('emits data-value (incl "0") and never data-tag-value (AC14, AC22, AC24)', async () => {
    const svg = await render(
      'boxes-and-lines\nheat Load\nAPI heat: 50\nDB heat: 0\nAPI -> DB'
    );
    const api = nodeFor(svg, 'API');
    const db = nodeFor(svg, 'DB');
    expect(api.getAttribute('data-value')).toBe('50');
    expect(db.getAttribute('data-value')).toBe('0');
    expect(api.getAttribute('data-tag-value')).toBeNull();
    expect(db.getAttribute('data-tag-value')).toBeNull();
  });

  it('renders the gradient ramp, active, when value present (AC13, AC25)', async () => {
    const svg = await render(
      'boxes-and-lines\nheat Load\nA heat: 10\nB heat: 90\nA -> B'
    );
    const ramp = svg.querySelector('.dgmo-legend-gradient-ramp');
    expect(ramp).toBeTruthy();
    expect(ramp!.getAttribute('data-ramp-min')).toBe('10');
    expect(ramp!.getAttribute('data-ramp-max')).toBe('90');
  });

  it('anchors the ramp at data-min when values are negative (AC12)', async () => {
    const svg = await render(
      'boxes-and-lines\nA heat: -20\nB heat: 40\nA -> B'
    );
    const ramp = svg.querySelector('.dgmo-legend-gradient-ramp')!;
    expect(ramp.getAttribute('data-ramp-min')).toBe('-20');
    expect(ramp.getAttribute('data-ramp-max')).toBe('40');
  });

  it('anchors all-non-negative data at the data minimum, not 0 (AC12)', async () => {
    const svg = await render(
      'boxes-and-lines\nA heat: 40\nB heat: 100\nA -> B'
    );
    const ramp = svg.querySelector('.dgmo-legend-gradient-ramp')!;
    // 2026-06-08: low end = lowest value (40), not the old 0-anchor.
    expect(ramp.getAttribute('data-ramp-min')).toBe('40');
    expect(ramp.getAttribute('data-ramp-max')).toBe('100');
  });

  it('survives a degenerate single-value ramp with no NaN (AC11)', async () => {
    const svg = await render('boxes-and-lines\nA heat: 7\nB\nA -> B');
    expect(svg).toBeTruthy();
    const ramp = svg.querySelector('.dgmo-legend-gradient-ramp')!;
    // Single value → min === max === the lone value; fillForValue falls back to
    // t = 1 (no divide-by-zero), so the box renders without NaN.
    expect(ramp.getAttribute('data-ramp-min')).toBe('7');
    expect(ramp.getAttribute('data-ramp-max')).toBe('7');
    const a = nodeFor(svg, 'A').querySelector('rect')!;
    expect(a.getAttribute('fill')).not.toContain('NaN');
  });

  it('value-tints boxes and strokes them with the ramp hue (default = primary)', async () => {
    const svg = await render('boxes-and-lines\nA heat: 10\nB heat: 90\nA -> B');
    const b = nodeFor(svg, 'B').querySelector('rect')!;
    // No heat color → hue defaults to palette.primary.
    expect(b.getAttribute('stroke')).toBe(P.primary);
    // High value tints near full hue (distinct from the page bg).
    expect(b.getAttribute('fill')).not.toBe(P.bg);
  });

  it('honors a heat trailing color as the ramp hue (AC4)', async () => {
    const svg = await render(
      'boxes-and-lines\nheat Heat red\nA heat: 10\nB heat: 90\nA -> B'
    );
    const b = nodeFor(svg, 'B').querySelector('rect')!;
    expect(b.getAttribute('stroke')).toBe(P.colors.red);
  });

  it('single-colour ramp uses a muted 25% fill + solid ramp-hue outline', async () => {
    const svg = await render(
      'boxes-and-lines\nheat Heat blue\nA heat: 0\nB heat: 100\nA -> B'
    );
    const b = nodeFor(svg, 'B').querySelector('rect')!;
    // Max value → ramp colour is the full hue, but the fill is its muted 25%
    // tint (NOT the raw saturated hue), with a solid hue outline.
    expect(b.getAttribute('stroke')).toBe(P.colors.blue);
    expect(b.getAttribute('fill')).toBe(shapeFill(P, P.colors.blue, false));
    expect(b.getAttribute('fill')).not.toBe(P.colors.blue);
  });

  it('single-colour ramp honours fill-solid (full hue at max)', async () => {
    const svg = await render(
      'boxes-and-lines\nfill-solid\nheat Heat blue\nA heat: 0\nB heat: 100\nA -> B'
    );
    const b = nodeFor(svg, 'B').querySelector('rect')!;
    expect(b.getAttribute('fill')).toBe(P.colors.blue);
  });

  it('two-colour ramp: standard convention — outline = ramp colour, fill = 25% tint (AC1, AC10)', async () => {
    const svg = await render(
      'boxes-and-lines\nheat Heat blue green\nA heat: 0\nB heat: 100\nA -> B'
    );
    const a = nodeFor(svg, 'A').querySelector('rect')!;
    const b = nodeFor(svg, 'B').querySelector('rect')!;
    // The box's INTENT colour = its ramp position (t=0 → blue, t=1 → green);
    // outline is that colour, fill is the standard 25% faded tint of it.
    const aRamp = valueRampColor(P.colors.blue, P.colors.green, 0, {
      isDark: false,
    });
    const bRamp = valueRampColor(P.colors.blue, P.colors.green, 1, {
      isDark: false,
    });
    expect(a.getAttribute('stroke')).toBe(aRamp);
    expect(a.getAttribute('fill')).toBe(shapeFill(P, aRamp, false));
    expect(b.getAttribute('stroke')).toBe(bRamp);
    expect(b.getAttribute('fill')).toBe(shapeFill(P, bRamp, false));
  });

  it('two-colour ramp honours fill-solid (full ramp colour) (AC1)', async () => {
    const svg = await render(
      'boxes-and-lines\nfill-solid\nheat Heat blue green\nA heat: 0\nB heat: 100\nA -> B'
    );
    const b = nodeFor(svg, 'B').querySelector('rect')!;
    const bRamp = valueRampColor(P.colors.blue, P.colors.green, 1, {
      isDark: false,
    });
    // fill-solid ⇒ fill == the full ramp colour (no 25% tint).
    expect(b.getAttribute('fill')).toBe(bRamp);
    expect(b.getAttribute('stroke')).toBe(bRamp);
  });

  it('diverging green→red mid outline is a straight palette fade (no synthetic hue)', async () => {
    const svg = await render(
      'boxes-and-lines\nheat Heat green red\nA heat: 0\nMid heat: 50\nB heat: 100\nA -> B'
    );
    // The saturated intent is carried on the outline (fill is its 25% tint).
    const midStroke = nodeFor(svg, 'Mid')
      .querySelector('rect')!
      .getAttribute('stroke')!;
    // Direct sRGB fade between the two palette endpoints — on-palette, no
    // invented bisector hue.
    expect(midStroke).toBe(
      valueRampColor(P.colors.green, P.colors.red, 0.5, { isDark: false })
    );
    expect(midStroke).toBe(mix(P.colors.red, P.colors.green, 50));
  });

  it('legend gradient stops reproduce the fills', async () => {
    const svg = await render(
      'boxes-and-lines\nheat Heat green red\nA heat: 0\nB heat: 100\nA -> B'
    );
    const stops = [...svg.querySelectorAll('stop')] as SVGStopElement[];
    expect(stops.length).toBe(2); // direct fade → two endpoints
    for (const s of stops) {
      const offset = parseFloat(s.getAttribute('offset')!) / 100;
      expect(s.getAttribute('stop-color')).toBe(
        valueRampColor(P.colors.green, P.colors.red, offset, { isDark: false })
      );
    }
  });

  it('gives a no-value box the neutral fill while value is active (AC10)', async () => {
    const svg = await render('boxes-and-lines\nA heat: 10\nB\nA -> B');
    const b = nodeFor(svg, 'B').querySelector('rect')!;
    const neutral = mix(P.bg, P.text, 95);
    expect(b.getAttribute('fill')).toBe(neutral);
  });

  it('leaves a tag-only diagram untouched — no gradient, first tag active (AC6)', async () => {
    const svg = await render(
      'boxes-and-lines\ntag Team as t Backend blue, Frontend green\nA t: Backend\nB t: Frontend\nA -> B'
    );
    expect(svg.querySelector('.dgmo-legend-gradient-ramp')).toBeNull();
    // Tag tint applied — fill is the tag shape-fill, not the value-neutral fill.
    const a = nodeFor(svg, 'A').querySelector('rect')!;
    expect(a.getAttribute('stroke')).toMatch(/^#/);
    expect(a.getAttribute('fill')).not.toBe(mix(P.bg, P.text, 95));
  });

  it('active-tag <tag-group> switches off the value ramp (AC8)', async () => {
    const svg = await render(
      'boxes-and-lines\ntag Team as t Backend blue, Frontend green\nheat Load\nA heat: 10, t: Backend\nB heat: 90, t: Frontend\nA -> B',
      { activeTagGroup: 'Team' }
    );
    // Tag group active → boxes tinted by tag, gradient capsule not active.
    expect(svg.querySelector('.dgmo-legend-gradient-ramp')).toBeNull();
    const a = nodeFor(svg, 'A').querySelector('rect')!;
    expect(a.getAttribute('stroke')).toMatch(/^#/);
    expect(a.getAttribute('fill')).not.toBe(mix(P.bg, P.text, 95));
  });

  it('prints value text by default; `no-value` suppresses (decision #48)', async () => {
    const on = await render('boxes-and-lines\nA heat: 42\nB\nA -> B');
    const valText = on.querySelector('.bl-node-value');
    expect(valText).toBeTruthy();
    // No heat → bare number.
    expect(valText!.textContent).toBe('42');
    const off = await render(
      'boxes-and-lines\nno-value\nA heat: 42\nB\nA -> B'
    );
    expect(off.querySelector('.bl-node-value')).toBeNull();
  });

  it('prefixes the value with the metric label ("Crew: 120") on plain nodes (AC16)', async () => {
    const svg = await render(
      'boxes-and-lines\nheat Crew\nshow-values\nFlagship heat: 120\nSloop heat: 12\nFlagship -> Sloop'
    );
    const flagship = nodeFor(svg, 'Flagship');
    const valText = flagship.querySelector('.bl-node-value')!;
    expect(valText.textContent).toBe('Crew: 120');
    // A thin divider sits between the title and the value line.
    expect(flagship.querySelector('line')).toBeTruthy();
  });

  it('keeps the description legible on a dark solid fill (contrast-aware, not fixed grey)', async () => {
    const svg = await render(
      'boxes-and-lines\nfill-solid\nheat Heat red blue\nA heat: 0\n  Forgotten coin in the bilge\n  -> B\nB heat: 100\n  Full chest'
    );
    const a = nodeFor(svg, 'A');
    const fill = a.querySelector('rect')!.getAttribute('fill')!;
    // A (value 0) is the saturated low endpoint → dark fill under fill-solid.
    expect(relativeLuminance(fill)).toBeLessThan(0.5);
    const descEl = [...a.querySelectorAll('text')].find((t) =>
      t.textContent?.includes('Forgotten')
    )!;
    expect(descEl).toBeTruthy();
    // Description colour adapts to the dark fill — NOT the fixed muted grey that
    // would sink into the saturated box.
    expect(descEl.getAttribute('fill')).not.toBe(P.textMuted);
  });

  it('keeps the subtle muted description colour on default (light/tinted) fills', async () => {
    const svg = await render(
      'boxes-and-lines\nheat Heat red blue\nA heat: 0\n  Forgotten coin in the bilge\n  -> B\nB heat: 100\n  Full chest'
    );
    const a = nodeFor(svg, 'A');
    const descEl = [...a.querySelectorAll('text')].find((t) =>
      t.textContent?.includes('Forgotten')
    )!;
    expect(descEl.getAttribute('fill')).toBe(P.textMuted);
  });

  it('described node: title, ONE divider, then description + value as one body (org-card style, no 3rd section)', async () => {
    const svg = await render(
      'boxes-and-lines\nheat Readiness red green\nshow-values\nFlagship heat: 96\n  Fully crewed and battle-ready\n  -> Sloop\nSloop heat: 22\n  Barely afloat'
    );
    const flagship = nodeFor(svg, 'Flagship');
    const valText = flagship.querySelector('.bl-node-value')!;
    expect(valText.textContent).toBe('Readiness: 96');
    expect(valText.getAttribute('text-anchor')).toBe('middle');
    // Exactly ONE divider (title | body) — the old layout added a second divider
    // for a bottom value footer, making it read as three sections.
    expect(flagship.querySelectorAll('line').length).toBe(1);
    // No corner-badge rect.
    expect(flagship.querySelectorAll('rect').length).toBeLessThanOrEqual(2);
    // Title is bold (matches the org card).
    const title = [...flagship.querySelectorAll('text')].find(
      (t) => t.textContent === 'Flagship'
    )!;
    expect(title.getAttribute('font-weight')).toBe('bold');
  });

  it('described value-card divider stays visible in fill-solid (uses contrast colour, not the equal stroke)', async () => {
    const svg = await render(
      'boxes-and-lines\nfill-solid\nheat Readiness red green\nshow-values\nFlagship heat: 96\n  Fully crewed\n  -> Sloop\nSloop heat: 22\n  Barely afloat'
    );
    const flagship = nodeFor(svg, 'Flagship');
    const rectFill = flagship.querySelector('rect')!.getAttribute('fill');
    const divider = flagship.querySelector('line')!;
    // In solid mode stroke == fill; the divider must NOT use it (it would vanish).
    expect(divider.getAttribute('stroke')).not.toBe(rectFill);
  });
});

describe('boxes-and-lines renderer — fit within viewport', () => {
  // A tall, titled+legended graph forced into a short landscape viewport must
  // scale so ALL content stays inside the canvas. Regression: the title/legend
  // overhead is drawn unscaled, so folding it into the scaled denominator let
  // the diagram bleed past the bottom edge whenever scale < 1.
  const TALL_SRC = [
    'boxes-and-lines Deep Stack',
    'tag Type as t',
    '  Web red',
    '  Service blue',
    ...Array.from({ length: 14 }, (_, i) => {
      const n = i + 1;
      return `N${n} t:Service\n  -> N${n + 1}`;
    }),
    'N15 t:Web',
  ].join('\n');

  async function scaledBottom(width: number, height: number): Promise<number> {
    const parsed = parseBoxesAndLines(TALL_SRC);
    const layout = await layoutBoxesAndLines(parsed);
    const el = document.createElement('div');
    renderBoxesAndLines(el, parsed, layout, P, false, {
      exportDims: { width, height },
    });
    const g = el.querySelector<SVGGElement>('g[transform*="scale"]')!;
    const t = g.getAttribute('transform')!;
    const scale = Number(/scale\(([\d.]+)\)/.exec(t)![1]);
    const oy = Number(/translate\([-\d.]+,([-\d.]+)\)/.exec(t)![1]);
    return oy + layout.height * scale;
  }

  it('keeps scaled content within the viewport height when scale < 1', async () => {
    // Short landscape viewport → binding constraint is height, scale < 1.
    const H = 620;
    expect(await scaledBottom(1100, H)).toBeLessThanOrEqual(H);
  });

  it('stays inside the viewport across a range of short heights', async () => {
    for (const H of [980, 700, 560, 420]) {
      expect(await scaledBottom(1050, H)).toBeLessThanOrEqual(H);
    }
  });
});
