import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSwimlane } from '../src/swimlane/parser';
import { layoutSwimlane } from '../src/swimlane/layout';
import { renderSwimlaneForExport } from '../src/swimlane/renderer';
import { getPalette } from '../src/palettes';
import { mix, themeBaseBg } from '../src/palettes/color-utils';
import { renderForExport } from '../src/d3';

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
