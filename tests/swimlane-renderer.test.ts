import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSwimlane } from '../src/swimlane/parser';
import { layoutSwimlane } from '../src/swimlane/layout';
import { renderSwimlaneForExport } from '../src/swimlane/renderer';
import { getPalette } from '../src/palettes';
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
      svg.querySelectorAll('.dgmo-swimlane-lanes rect').length
    ).toBeGreaterThan(0);
    expect(svg.querySelectorAll('.dgmo-swimlane-phases text').length).toBe(4);
    expect(
      svg.querySelectorAll('.dgmo-swimlane-nodes g').length
    ).toBeGreaterThan(0);
    expect(
      svg.querySelectorAll('.dgmo-swimlane-edges path').length
    ).toBeGreaterThan(0);
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
