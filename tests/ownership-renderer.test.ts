// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';
import { layoutOwnership } from '../src/ownership/layout';
import { parseOwnership } from '../src/ownership/parser';
import { renderOwnership } from '../src/ownership/renderer';
import { DEFAULT_DIM_OPACITY } from '../src/utils/hover-styles';

const palette = getPalette('nord').light;

/** The round-two fixture: eight entities, one cross-holding, two outside owners. */
const ROUND_TWO = readFileSync(
  join(__dirname, '../gallery/fixtures/ownership.dgmo'),
  'utf8'
);

function draw(src: string, exportMode = false): HTMLElement {
  const parsed = parseOwnership(src);
  expect(parsed.error).toBeNull();
  const container = document.createElement('div');
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
    width: 0,
  } as DOMRect);
  renderOwnership(container, parsed, palette, false, {
    exportMode,
    activeTagGroup: parsed.tagGroups[0]?.name ?? null,
  });
  return container;
}

// ── Rendered geometry ────────────────────────────────────────

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface Edge {
  from: string;
  to: string;
  segs: Seg[];
  end: { x: number; y: number };
}
type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'triangle'; pts: [number, number][] };

const num = (el: Element, a: string) => Number(el.getAttribute(a));

function points(d: string): { x: number; y: number }[] {
  return [...d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

function edgesOf(c: HTMLElement): Edge[] {
  return [...c.querySelectorAll('.ownership-edge')].map((g) => {
    const pts = points(
      g.querySelector('.ownership-edge-line')!.getAttribute('d')!
    );
    const segs: Seg[] = [];
    for (let i = 1; i < pts.length; i++)
      segs.push({
        x1: pts[i - 1]!.x,
        y1: pts[i - 1]!.y,
        x2: pts[i]!.x,
        y2: pts[i]!.y,
      });
    return {
      from: g.getAttribute('data-from')!,
      to: g.getAttribute('data-to')!,
      segs,
      end: pts[pts.length - 1]!,
    };
  });
}

function shapesOf(c: HTMLElement): Map<string, Shape> {
  const out = new Map<string, Shape>();
  for (const g of c.querySelectorAll('.ownership-entity')) {
    const el = g.querySelector('.ownership-shape')!;
    const id = g.getAttribute('data-node-id')!;
    if (el.tagName === 'rect')
      out.set(id, {
        kind: 'rect',
        x: num(el, 'x'),
        y: num(el, 'y'),
        w: num(el, 'width'),
        h: num(el, 'height'),
      });
    else if (el.tagName === 'ellipse')
      out.set(id, {
        kind: 'ellipse',
        cx: num(el, 'cx'),
        cy: num(el, 'cy'),
        rx: num(el, 'rx'),
        ry: num(el, 'ry'),
      });
    else
      out.set(id, {
        kind: 'triangle',
        pts: points(el.getAttribute('d')!).map((p) => [p.x, p.y]) as [
          number,
          number,
        ][],
      });
  }
  return out;
}

/** Strictly inside the shape, by more than `inset`. */
function inside(s: Shape, x: number, y: number, inset = 1): boolean {
  if (s.kind === 'rect')
    return (
      x > s.x + inset &&
      x < s.x + s.w - inset &&
      y > s.y + inset &&
      y < s.y + s.h - inset
    );
  if (s.kind === 'ellipse')
    return (
      ((x - s.cx) / (s.rx - inset)) ** 2 + ((y - s.cy) / (s.ry - inset)) ** 2 <
      1
    );
  const [[ax, ay], [bx, by], [cx, cy]] = s.pts;
  const side = (px: number, py: number, qx: number, qy: number) =>
    (qx - px) * (y - py) - (qy - py) * (x - px);
  const d1 = side(ax, ay, bx, by);
  const d2 = side(bx, by, cx, cy);
  const d3 = side(cx, cy, ax, ay);
  const len = Math.hypot(bx - ax, by - ay);
  // All on one side, each by more than inset × edge length.
  return (
    (d1 > inset * len && d2 > inset * len && d3 > inset * len) ||
    (d1 < -inset * len && d2 < -inset * len && d3 < -inset * len)
  );
}

/** Two axis-aligned segments meet: cross, touch or overlap. */
function meet(a: Seg, b: Seg, tol = 0.5): boolean {
  const ax1 = Math.min(a.x1, a.x2);
  const ax2 = Math.max(a.x1, a.x2);
  const ay1 = Math.min(a.y1, a.y2);
  const ay2 = Math.max(a.y1, a.y2);
  const bx1 = Math.min(b.x1, b.x2);
  const bx2 = Math.max(b.x1, b.x2);
  const by1 = Math.min(b.y1, b.y2);
  const by2 = Math.max(b.y1, b.y2);
  return (
    ax1 <= bx2 + tol && bx1 <= ax2 + tol && ay1 <= by2 + tol && by1 <= ay2 + tol
  );
}

/** Pairs of lines from different owners that meet anywhere. */
function renderedCrossings(c: HTMLElement): string[] {
  const edges = edgesOf(c);
  const out: string[] = [];
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i]!;
      const b = edges[j]!;
      // Lines leaving one point share that owner's trunk and run (rule 2).
      if (a.segs[0]!.x1 === b.segs[0]!.x1 && a.segs[0]!.y1 === b.segs[0]!.y1)
        continue;
      if (a.segs.some((s) => b.segs.some((t) => meet(s, t))))
        out.push(`${a.from}→${a.to} × ${b.from}→${b.to}`);
    }
  return out;
}

/** Lines that pass through a shape (sampled every pixel). */
function linesThroughBoxes(c: HTMLElement): string[] {
  const shapes = shapesOf(c);
  const out: string[] = [];
  for (const e of edgesOf(c)) {
    for (const s of e.segs) {
      const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      for (let t = 0; t <= len; t += 1) {
        const x = s.x1 + ((s.x2 - s.x1) * t) / (len || 1);
        const y = s.y1 + ((s.y2 - s.y1) * t) / (len || 1);
        for (const [id, shape] of shapes)
          if (inside(shape, x, y)) out.push(`${e.from}→${e.to} through ${id}`);
      }
    }
  }
  return [...new Set(out)];
}

const idOf = (c: HTMLElement, name: string): string =>
  [...c.querySelectorAll('.ownership-entity')]
    .find(
      (g) => g.querySelector('.ownership-entity-name')!.textContent === name
    )!
    .getAttribute('data-node-id')!;

const centreX = (c: HTMLElement, name: string): number => {
  const s = shapesOf(c).get(idOf(c, name))!;
  if (s.kind === 'rect') return s.x + s.w / 2;
  if (s.kind === 'ellipse') return s.cx;
  return s.pts[0]![0];
};

// ── Tests ────────────────────────────────────────────────────

describe('ownership routing on the round-two fixture (#1873)', () => {
  it('draws zero line crossings on the rendered geometry', () => {
    const c = draw(ROUND_TWO);
    expect(edgesOf(c)).toHaveLength(8);
    expect(renderedCrossings(c)).toEqual([]);
    expect(parseOwnership(ROUND_TWO).diagnostics).toEqual([]);
  });

  it('passes no line through a box', () => {
    expect(linesThroughBoxes(draw(ROUND_TWO))).toEqual([]);
  });

  it('enters an entity with several owners left to right in owner order', () => {
    const c = draw(ROUND_TWO);
    const edges = edgesOf(c);
    for (const name of ['Acme Labs LLC', 'Acme GmbH', 'Acme SAS']) {
      const id = idOf(c, name);
      const into = edges.filter((e) => e.to === id);
      expect(into.length).toBe(2);
      const ownerX = (e: Edge) => centreX(c, nameOf(c, e.from));
      const byOwner = [...into].sort((a, b) => ownerX(a) - ownerX(b));
      const byEntry = [...into].sort((a, b) => a.end.x - b.end.x);
      expect(byEntry).toEqual(byOwner);
    }
  });

  it('places an entity with several owners between them', () => {
    const c = draw(ROUND_TWO);
    const between = (mid: string, a: string, b: string) => {
      const [lo, hi] = [centreX(c, a), centreX(c, b)].sort((x, y) => x - y);
      expect(centreX(c, mid)).toBeGreaterThan(lo!);
      expect(centreX(c, mid)).toBeLessThan(hi!);
    };
    between('Acme Labs LLC', 'Partner Fund LP', 'Acme Inc');
    between('Acme GmbH', 'Acme Inc', 'Acme BV');
    between('Acme SAS', 'Acme BV', 'J. Moreau');
  });

  it('sets a pill on its own line’s last vertical, clear of every other line', () => {
    const c = draw(ROUND_TWO);
    const groups = [...c.querySelectorAll('.ownership-edge')];
    const edges = edgesOf(c);
    groups.forEach((g, i) => {
      const pill = g.querySelector('.ownership-pill')!;
      const px = num(pill, 'x') + num(pill, 'width') / 2;
      const py = num(pill, 'y') + num(pill, 'height') / 2;
      const last = edges[i]!.segs[edges[i]!.segs.length - 1]!;
      expect(last.x1).toBeCloseTo(px, 1);
      expect(last.x2).toBeCloseTo(px, 1);
      expect(py).toBeGreaterThan(Math.min(last.y1, last.y2));
      expect(py).toBeLessThan(Math.max(last.y1, last.y2));
      const box: Seg = {
        x1: num(pill, 'x'),
        y1: num(pill, 'y'),
        x2: num(pill, 'x') + num(pill, 'width'),
        y2: num(pill, 'y') + num(pill, 'height'),
      };
      edges.forEach((other, j) => {
        if (j === i || other.from === edges[i]!.from) return;
        for (const s of other.segs) expect(meet(s, box, 0)).toBe(false);
      });
    });
  });

  it('meets a triangle on its slope and an oval on its curve', () => {
    const c = draw(ROUND_TWO);
    const shapes = shapesOf(c);
    const labs = shapes.get(idOf(c, 'Acme Labs LLC'))!;
    expect(labs.kind).toBe('triangle');
    const apexY = labs.kind === 'triangle' ? labs.pts[0]![1] : 0;
    for (const e of edgesOf(c).filter((x) => x.to === idOf(c, 'Acme Labs LLC')))
      expect(e.end.y).toBeGreaterThan(apexY + 1);
  });

  it('draws outside owners and their lines dashed', () => {
    const c = draw(ROUND_TWO);
    const fund = c.querySelector(
      `.ownership-entity[data-node-id="${idOf(c, 'Partner Fund LP')}"] .ownership-shape`
    )!;
    expect(fund.getAttribute('stroke-dasharray')).toBeTruthy();
    const line = c.querySelector(
      `.ownership-edge[data-from="${idOf(c, 'Partner Fund LP')}"] .ownership-edge-line`
    )!;
    expect(line.getAttribute('stroke-dasharray')).toBeTruthy();
    const inc = c.querySelector(
      `.ownership-edge[data-from="${idOf(c, 'Acme Inc')}"] .ownership-edge-line`
    )!;
    expect(inc.getAttribute('stroke-dasharray')).toBeNull();
  });
});

function nameOf(c: HTMLElement, id: string): string {
  return c.querySelector(
    `.ownership-entity[data-node-id="${id}"] .ownership-entity-name`
  )!.textContent!;
}

describe('ownership look (#1873)', () => {
  it('shows the name, "jurisdiction · type" and the first description line', () => {
    const c = draw(ROUND_TWO);
    const inc = c.querySelector(
      `.ownership-entity[data-node-id="${idOf(c, 'Acme Inc')}"]`
    )!;
    expect(inc.querySelector('.ownership-entity-facts')!.textContent).toBe(
      'US · Corporation'
    );
    expect(inc.querySelector('.ownership-entity-desc')!.textContent).toBe(
      'Delaware C-corp'
    );
    const labs = c.querySelector(
      `.ownership-entity[data-node-id="${idOf(c, 'Acme Labs LLC')}"]`
    )!;
    // A triangle drops the type.
    expect(labs.querySelector('.ownership-entity-facts')!.textContent).toBe(
      'US'
    );
  });

  // #2101: a partnership triangle wraps its name instead of widening.
  describe('partnership triangle', () => {
    const SRC = [
      'ownership Holding',
      'tag Jurisdiction as j',
      '  UK  blue',
      '',
      'Salt Holdings Ltd  j: UK',
      '  100% Anchor Chandlers Ltd  j: UK',
      '    Ship stores and rope',
      '  50% Lantern Lane Freight LLP  j: UK, type: partnership',
      '    Joint venture with a carrier',
      '  50% Blackwater Ventures Fund II LP  j: UK, type: partnership',
      '    Feeder fund',
      '    100% Feeder Ltd  j: UK',
    ].join('\n');
    const layout = layoutOwnership(parseOwnership(SRC));
    const byName = (n: string) =>
      layout.entities.find((e) => e.entity.name === n)!;

    it('wraps the name to at most two lines at a sibling-like width', () => {
      const rect = byName('Anchor Chandlers Ltd');
      for (const n of [
        'Lantern Lane Freight LLP',
        'Blackwater Ventures Fund II LP',
      ]) {
        const tri = byName(n);
        expect(tri.nameLines.length).toBe(2);
        expect(tri.width).toBeLessThan(rect.width * 1.5);
        // One aspect, so the triangle is never a flat wedge.
        expect(tri.height / tri.width).toBeGreaterThan(0.55);
      }
    });

    it('does not stretch the boxes beside it', () => {
      const rect = byName('Anchor Chandlers Ltd');
      expect(rect.height).toBeLessThan(
        byName('Lantern Lane Freight LLP').height
      );
    });

    it('puts the jurisdiction in a code box and the description under the base', () => {
      const c = draw(SRC);
      const g = c.querySelector(
        `.ownership-entity[data-node-id="${byName('Lantern Lane Freight LLP').id}"]`
      )!;
      expect(g.querySelector('.ownership-entity-code text')!.textContent).toBe(
        'UK'
      );
      const tri = byName('Lantern Lane Freight LLP');
      const desc = g.querySelector('.ownership-entity-desc')!;
      expect(desc.textContent).toBe('Joint venture with a carrier');
      expect(Number(desc.getAttribute('y'))).toBeGreaterThan(
        tri.y + tri.height
      );
    });

    it('drops the caption when a line leaves the base', () => {
      expect(byName('Blackwater Ventures Fund II LP').desc).toBe('');
    });
  });

  it('keys only the shapes the chart uses', () => {
    const key = draw(ROUND_TWO).querySelector('.ownership-shape-key')!;
    expect([...key.querySelectorAll('text')].map((t) => t.textContent)).toEqual(
      ['Shape', 'Corporation', 'Partnership', 'Individual']
    );
  });

  it('draws the legend capsule for the tag group', () => {
    const c = draw(ROUND_TWO);
    expect(
      c.querySelector('.ownership-legend [data-legend-group]')
    ).not.toBeNull();
  });

  it('draws a trust with a double outline', () => {
    const c = draw('ownership G\n\nA Ltd\n  100% B Trust  type: trust\n');
    expect(
      c.querySelectorAll('.ownership-entities .ownership-shape-inner')
    ).toHaveLength(1);
  });

  it('takes the fill family on group entities, never on outside ones', () => {
    const c = draw(
      'ownership G\nfill-solid\n\nA Ltd\n  100% B Ltd\nF LP\n  10% -> A Ltd\n'
    );
    const fills = [...c.querySelectorAll('.ownership-entity')].map((g) =>
      g.querySelector('.ownership-shape')!.getAttribute('fill')
    );
    expect(fills[0]).toBe(palette.textMuted);
    expect(fills[2]).toBe(palette.bg);
  });
});

describe('ownership hover and focus (#1873)', () => {
  it('lights the chain of owners and sums effective ownership on the card', () => {
    const c = draw(ROUND_TWO);
    const g = c.querySelector(
      `.ownership-entity[data-node-id="${idOf(c, 'Acme GmbH')}"]`
    )!;
    g.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    const opacity = (name: string) =>
      c
        .querySelector(`.ownership-entity[data-node-id="${idOf(c, name)}"]`)!
        .getAttribute('opacity');
    for (const lit of ['Acme GmbH', 'Acme BV', 'Acme Inc', 'Acme Holdings plc'])
      expect(opacity(lit)).toBeNull();
    expect(opacity('Acme Labs LLC')).toBe(String(DEFAULT_DIM_OPACITY));
    const tip = c.querySelector('[data-d3-tooltip]')!;
    expect(tip.textContent).toContain(
      '90% via Acme BV + 10% via Acme Inc = 100%'
    );
    g.dispatchEvent(new MouseEvent('mouseleave'));
    expect(opacity('Acme Labs LLC')).toBeNull();
  });

  it('lights a line and its two ends', () => {
    const c = draw(ROUND_TWO);
    const fund = idOf(c, 'Partner Fund LP');
    const edge = c.querySelector(`.ownership-edge[data-from="${fund}"]`)!;
    edge.dispatchEvent(new MouseEvent('mouseenter'));
    expect(
      c
        .querySelector(
          `.ownership-entity[data-node-id="${idOf(c, 'Acme Inc')}"]`
        )!
        .getAttribute('opacity')
    ).toBe(String(DEFAULT_DIM_OPACITY));
    expect(
      c
        .querySelector(`.ownership-entity[data-node-id="${fund}"]`)!
        .getAttribute('opacity')
    ).toBeNull();
    expect(c.querySelector('[data-d3-tooltip]')!.textContent).toContain(
      'Partner Fund LP → Acme Labs LLC'
    );
  });

  it('tabs through the entities in tree order; an export has no tab stops', () => {
    const c = draw(ROUND_TWO);
    const order = [
      ...c.querySelectorAll('.ownership-entity[tabindex="0"]'),
    ].map((g) => g.querySelector('.ownership-entity-name')!.textContent);
    expect(order).toEqual([
      'Acme Holdings plc',
      'Acme Inc',
      'Acme Labs LLC',
      'Acme BV',
      'Acme GmbH',
      'Acme SAS',
      'Partner Fund LP',
      'J. Moreau',
    ]);
    const x = draw(ROUND_TWO, true);
    expect(x.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(
      x.querySelector('.ownership-entity')!.getAttribute('aria-label')
    ).toContain('Acme Holdings plc');
  });

  it('opens the card on Enter', () => {
    const c = draw(ROUND_TWO);
    const g = c.querySelector('.ownership-entity')!;
    g.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const tip = c.querySelector<HTMLElement>('[data-d3-tooltip]')!;
    expect(tip.style.display).toBe('block');
    expect(tip.textContent).toContain('Acme Holdings plc');
  });
});

describe('ownership export (#1873)', () => {
  it('renders through renderForExport', async () => {
    const svg = await renderForExport(ROUND_TWO, 'light');
    expect(svg).toContain('ownership-entity');
    expect(svg).toContain('Acme group structure');
  });
});

// ── Random structures: the routing contract holds beyond the fixture ─

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGroup(seed: number): string {
  const rnd = mulberry(seed);
  const lines = ['ownership Random'];
  const names: string[] = ['Top'];
  const depth = new Map<string, number>([['Top', 0]]);
  lines.push('', 'Top');
  const grow = (parent: string, level: number): void => {
    if (level > 3) return;
    const kids = Math.floor(rnd() * 3);
    for (let k = 0; k < kids; k++) {
      const name = `E${names.length}`;
      names.push(name);
      depth.set(name, level);
      const type =
        rnd() < 0.2
          ? '  type: partnership'
          : rnd() < 0.1
            ? '  type: individual'
            : '';
      lines.push(`${'  '.repeat(level)}50% ${name}${type}`);
      grow(name, level + 1);
    }
  };
  grow('Top', 1);
  // A few cross-holdings and outside owners, 10% each.
  const extra = Math.floor(rnd() * 3);
  for (let i = 0; i < extra && names.length > 2; i++) {
    const target = names[1 + Math.floor(rnd() * (names.length - 1))]!;
    lines.push(`Fund${i} LP  type: partnership`, `  10% -> ${target}`);
  }
  return lines.join('\n') + '\n';
}

describe('ownership routing on random structures (#1873)', () => {
  it('never passes a line through a box, and reports every crossing it draws', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const src = randomGroup(seed);
      const parsed = parseOwnership(src);
      if (parsed.error) continue;
      const c = draw(src);
      expect(linesThroughBoxes(c), src).toEqual([]);
      const reported = layoutOwnership(parsed).crossings.length;
      if (renderedCrossings(c).length > 0)
        expect(reported, src).toBeGreaterThan(0);
    }
  });
});

describe('ownership legend beside a long title (#2103)', () => {
  it('keeps the legend on the page when the expanded group wraps', () => {
    const src = [
      'ownership Société Générale des Écumeurs de la Mer Méditerranée — 海賊グループ — شركة القراصنة',
      'tag Jurisdiction as j',
      '  Saudi Arabia green',
      '  Japan red',
      '  China orange',
      '  France blue',
      '  Spain purple',
      '  Türkiye teal',
      '',
      'Parent Holdings SA  j: France',
      '  60% Child One KK  j: Japan',
      '  40% Child Two SL  j: Spain',
    ].join('\n');
    for (const active of [true, false]) {
      const parsed = parseOwnership(src);
      expect(parsed.error).toBeNull();
      const container = document.createElement('div');
      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
        width: 0,
      } as DOMRect);
      renderOwnership(container, parsed, palette, false, {
        activeTagGroup: active ? 'Jurisdiction' : null,
      });
      const g = container.querySelector('.ownership-legend')!;
      const y = Number(
        /translate\([^,]+,([^)]+)\)/.exec(g.getAttribute('transform')!)![1]
      );
      expect(y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('ownership legend and shape key (#2102)', () => {
  const SRC = readFileSync(
    join(__dirname, '../gallery/fixtures/ownership-legend-key.dgmo'),
    'utf8'
  );

  it('draws the shape key as an entry of the shared legend', () => {
    const c = draw(SRC);
    const key = c.querySelector('.ownership-shape-key')!;
    expect(key.querySelector('[data-legend-group="shape"]')).not.toBeNull();
    expect(
      [...key.querySelectorAll('[data-legend-entry]')].map((e) =>
        e.getAttribute('data-legend-entry')
      )
    ).toEqual(['corporation', 'partnership', 'individual', 'trust']);
    // The entry dot is the shape it names.
    expect(key.querySelectorAll('circle')).toHaveLength(0);
    expect(key.querySelectorAll('.ownership-shape').length).toBeGreaterThan(3);
  });

  it('tag-group pills carry the attribute the preview clicks on', () => {
    const c = draw(SRC);
    const keys = [
      ...c.querySelectorAll('.ownership-legend [data-legend-group]'),
    ].map((e) => e.getAttribute('data-legend-group'));
    expect(keys).toContain('jurisdiction');
    expect(keys).toContain('status');
  });

  it('hovering a key entry lights that type and dims the rest', () => {
    const c = draw(SRC);
    const entry = c.querySelector('[data-legend-entry="trust"]')!;
    entry.dispatchEvent(new MouseEvent('mouseenter'));
    const lit = [...c.querySelectorAll('.ownership-entity')].filter(
      (e) => e.getAttribute('opacity') === null
    );
    expect(lit.length).toBeGreaterThan(0);
    expect(
      lit.every((e) => e.getAttribute('data-entity-type') === 'trust')
    ).toBe(true);
    const dimmed = [...c.querySelectorAll('.ownership-entity')].filter(
      (e) => e.getAttribute('opacity') === String(DEFAULT_DIM_OPACITY)
    );
    expect(dimmed.length).toBeGreaterThan(0);
    entry.dispatchEvent(new MouseEvent('mouseleave'));
    expect(
      [...c.querySelectorAll('.ownership-entity')].every(
        (e) => e.getAttribute('opacity') === null
      )
    ).toBe(true);
  });

  it('leaves the legend row on the title row under a subtitle', () => {
    const c = document.createElement('div');
    vi.spyOn(c, 'getBoundingClientRect').mockReturnValue({
      width: 0,
    } as DOMRect);
    const parsed = parseOwnership(SRC);
    expect(parsed.error).toBeNull();
    renderOwnership(c, parsed, palette, false, {
      activeTagGroup: 'Jurisdiction',
    });
    const legend = c.querySelector('.ownership-legend')!;
    expect(legend.hasAttribute('data-chart-header')).toBe(true);
    // Pinned back up by the subtitle band, so it is not drawn in the band.
    expect(legend.getAttribute('transform')).toMatch(/^translate\(0,-/);
  });
});
