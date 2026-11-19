import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseTreemap } from '../src/treemap/parser';
import { layoutTreemapIcicle } from '../src/treemap/layout-icicle';
import { renderTreemapIcicleForExport } from '../src/treemap/renderer-icicle';
import { renderForExport } from '../src/d3';
import { getPalette } from '../src/palettes';

// The icicle layout for treemap (diagrammo/diagrammo#1857): the same parsed
// hierarchy as bands, root on the left, one column per depth level, a node's
// height its share of the whole.

const palette = getPalette('nord').light;

const SRC = `treemap Plunder Spend ($k)
icicle

Sailing & Rigging
  Rigging
    Lines 200
    Sails 120
  Helm 180
  Lookout 140
Cannon Battery
  Powder 90
  Shot 130
Provisions
  Rum 110
  Hardtack 70
`;

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const win = dom.window;
  for (const k of [
    'document',
    'window',
    'navigator',
    'HTMLElement',
    'SVGElement',
  ] as const) {
    Object.defineProperty(globalThis, k, {
      value: (win as unknown as Record<string, unknown>)[k],
      configurable: true,
    });
  }
});

function render(src: string, w = 960, h = 600): SVGSVGElement {
  const parsed = parseTreemap(src, palette);
  const container = document.createElement('div');
  renderTreemapIcicleForExport(container, parsed, palette, false, {
    width: w,
    height: h,
  });
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('no svg rendered');
  return svg as unknown as SVGSVGElement;
}

function cellByPath(svg: SVGSVGElement, path: string): Element {
  const g = Array.from(svg.querySelectorAll('.dgmo-treemap-cell')).find(
    (el) => el.getAttribute('data-node-path') === path
  );
  if (!g) throw new Error(`no cell ${path}`);
  return g;
}

describe('parseTreemap — icicle flag', () => {
  it('parses the bare `icicle` flag into options', () => {
    const r = parseTreemap(SRC);
    expect(r.error).toBeNull();
    expect(r.options.icicle).toBe(true);
    expect(r.options.radial).toBe(false);
  });

  it('defaults icicle to false when the flag is absent', () => {
    const r = parseTreemap('treemap T\n\nA\n  X 1');
    expect(r.options.icicle).toBe(false);
  });

  it('does not create a phantom "icicle" node', () => {
    const r = parseTreemap(SRC);
    expect(r.roots.map((n) => n.label)).toEqual([
      'Sailing & Rigging',
      'Cannon Battery',
      'Provisions',
    ]);
  });

  it('radial and icicle together is an error on the later flag', () => {
    const r = parseTreemap('treemap T\nradial\nicicle\n\nA\n  X 1');
    const d = r.diagnostics.find((x) => x.code === 'E_TREEMAP_LAYOUT_CONFLICT');
    expect(d?.severity).toBe('error');
    expect(d?.line).toBe(3);
    expect(r.error).not.toBeNull();
  });
});

describe('layoutTreemapIcicle', () => {
  const roots = parseTreemap(SRC).roots;
  const layout = layoutTreemapIcicle(roots, { width: 900, height: 1040 });
  const byPath = (p: string) =>
    layout.cells.find((c) => c.path.join(' / ') === p)!;

  it('draws one equal-width column per depth level, root on the left', () => {
    expect(layout.maxDepthReached).toBe(3);
    expect(layout.columnWidth).toBe(300);
    for (const c of layout.cells) {
      expect(c.x0).toBe((c.depth - 1) * 300);
      expect(c.x1).toBe(c.depth * 300);
    }
  });

  it("a band's height is its share of the whole", () => {
    // total 1040 over 1040 px → 1 px per unit
    expect(layout.total).toBe(1040);
    expect(
      byPath('Sailing & Rigging').y1 - byPath('Sailing & Rigging').y0
    ).toBe(640);
    const lines = byPath('Sailing & Rigging / Rigging / Lines');
    expect(lines.y1 - lines.y0).toBe(200);
    expect(lines.pctOfRoot).toBeCloseTo(200 / 1040);
  });

  it('nests every child inside its parent and keeps source order', () => {
    const top = layout.cells.filter((c) => c.depth === 1);
    expect(top.map((c) => c.label)).toEqual([
      'Sailing & Rigging',
      'Cannon Battery',
      'Provisions',
    ]);
    // Source order, not value order: Powder (90) above Shot (130).
    expect(byPath('Cannon Battery / Powder').y0).toBeLessThan(
      byPath('Cannon Battery / Shot').y0
    );
    for (const c of layout.cells) {
      if (c.depth === 1) continue;
      const parent = byPath(c.path.slice(0, -1).join(' / '));
      expect(c.y0).toBeGreaterThanOrEqual(parent.y0 - 1e-9);
      expect(c.y1).toBeLessThanOrEqual(parent.y1 + 1e-9);
    }
  });

  it('all-zero leaves lay out as empty', () => {
    const r = parseTreemap('treemap T\nicicle\n\nA\n  X 0');
    const l = layoutTreemapIcicle(r.roots, { width: 100, height: 100 });
    expect(l.isEmpty).toBe(true);
    expect(l.cells).toHaveLength(0);
  });
});

describe('renderTreemapIcicle', () => {
  it('renders bands with horizontal name and value · share labels', () => {
    const svg = render(SRC);
    expect(svg.classList.contains('dgmo-treemap-icicle')).toBe(true);
    expect(svg.querySelector('.chart-title')?.textContent).toBe(
      'Plunder Spend ($k)'
    );
    const top = cellByPath(svg, 'Sailing & Rigging');
    expect(top.querySelector('.dgmo-treemap-label')?.textContent).toBe(
      'Sailing & Rigging'
    );
    expect(top.querySelector('.dgmo-treemap-value')?.textContent).toBe(
      '640 · 62%'
    );
    // Labels are plain horizontal text — no textPath, no rotation.
    expect(svg.querySelector('textPath')).toBeNull();
    expect(svg.querySelector('text[transform]')).toBeNull();
  });

  it('drops the label of a band too short to hold it', () => {
    const src = 'treemap T\nicicle\n\nBig 1000\nTiny 1';
    const svg = render(src, 600, 400);
    expect(
      cellByPath(svg, 'Tiny').querySelector('.dgmo-treemap-label')
    ).toBeNull();
    // The band itself is still drawn and still carries its path for hover.
    expect(cellByPath(svg, 'Tiny').querySelector('rect')).not.toBeNull();
    expect(
      cellByPath(svg, 'Big').querySelector('.dgmo-treemap-label')
    ).not.toBeNull();
  });

  it('no-value and no-percent carry over', () => {
    const svg = render(SRC.replace('icicle', 'icicle\nno-value'));
    expect(
      cellByPath(svg, 'Sailing & Rigging').querySelector('.dgmo-treemap-value')
        ?.textContent
    ).toBe('62%');
    const bare = render(SRC.replace('icicle', 'icicle\nno-value\nno-percent'));
    expect(bare.querySelector('.dgmo-treemap-value')).toBeNull();
  });

  it('no-legend hides the legend; tags colour the bands', () => {
    const tagged = SRC.replace(
      'icicle\n',
      'icicle\n\ntag Crew as t\n  Deck blue\n  Guns orange\n'
    ).replace('Sailing & Rigging\n', 'Sailing & Rigging t: Deck\n');
    const svg = render(tagged);
    expect(svg.querySelector('.dgmo-treemap-legend')).not.toBeNull();
    const fill = cellByPath(svg, 'Sailing & Rigging')
      .querySelector('rect')
      ?.getAttribute('fill');
    expect(fill).toBe(palette.colors.blue);
    const none = render(tagged.replace('icicle', 'icicle\nno-legend'));
    expect(none.querySelector('.dgmo-treemap-legend')).toBeNull();
  });

  it('export dispatches the icicle flag to the icicle renderer', async () => {
    const svg = await renderForExport(SRC, 'light');
    expect(svg).toContain('dgmo-treemap-icicle');
    expect(svg).not.toContain('dgmo-treemap-radial');
  });
});
