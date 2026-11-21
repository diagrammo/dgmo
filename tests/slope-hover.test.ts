// Slope hover (diagrammo/diagrammo#2211): hovering a series — its line, dots
// or either name label — dims every other series. There is no tooltip: the
// dots already carry the positions, and a rank path box covered them.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseSlope } from '../src/slope/parser';
import { renderSlopeChart } from '../src/slope/renderer';
import { getPalette } from '../src/palettes';
import { EMPHASIS_DIM_OPACITY } from '../src/utils/emphasis';
import { HOVER_SPECS, buildHoverCss } from '../src/utils/hover-styles';
import '../src/palettes/index';

const SRC = (rank: boolean) => `slope League position
${rank ? 'rank\n' : ''}
period W1 W2 W3

Arsenal 3 1 1
City 1 2 2
Liverpool 2 3 3
`;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 500 });
  document.body.appendChild(host);
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe.each([true, false])('slope hover (rank=%s)', (rank) => {
  const draw = () => {
    const palette = getPalette('nord').dark;
    renderSlopeChart(host, parseSlope(SRC(rank)), palette, true);
    return [...host.querySelectorAll<SVGGElement>('g.slope-series')];
  };

  it('dims the other series while one is hovered, and restores them', () => {
    const groups = draw();
    expect(groups).toHaveLength(3);
    // Both name labels live inside the series group, so hovering them hovers it.
    const names = [...groups[1]!.querySelectorAll('text')].map(
      (t) => t.textContent
    );
    expect(names.filter((n) => n?.includes('City'))).toHaveLength(2);

    groups[1]!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(groups.map((g) => g.style.opacity)).toEqual([
      String(EMPHASIS_DIM_OPACITY),
      '',
      String(EMPHASIS_DIM_OPACITY),
    ]);

    groups[1]!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(groups.map((g) => g.style.opacity)).toEqual(['', '', '']);
  });

  it('shows no tooltip on hover', () => {
    const groups = draw();
    const before = document.body.querySelectorAll('div').length;
    for (const el of groups[0]!.querySelectorAll('path, circle'))
      el.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.body.querySelectorAll('div').length).toBe(before);
    expect(document.body.textContent).not.toContain('→');
  });
});

it('the exported SVG dims the other series too', () => {
  const css = buildHoverCss(HOVER_SPECS.slope!, {});
  expect(css).toContain(
    'svg:has(g.slope-series:hover) g.slope-series:not(:hover)'
  );
});
