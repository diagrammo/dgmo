// `fill` directive on function charts — shades the band below each curve,
// parity with the `line` chart's bare `fill` (§1.9). Retires the vestigial
// `shade` no-op token.
import { describe, it, expect } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';

const SRC = (opts = '') =>
  `function Trajectory
x 0 to 10
${opts}
f(x): x`;

async function render(src: string): Promise<SVGSVGElement> {
  const host = document.createElement('div');
  host.innerHTML = await renderDataChartD3(src, 'light', undefined, {
    width: 800,
    height: 500,
  });
  return host.querySelector('svg')!;
}

describe('function chart — fill directive', () => {
  it('draws no area band by default', async () => {
    const svg = await render(SRC());
    expect(svg.querySelector('.dgmo-series-area')).toBeNull();
  });

  it('`fill` draws a translucent area band below each curve', async () => {
    const svg = await render(SRC('fill'));
    const areas = svg.querySelectorAll('.dgmo-series-area');
    expect(areas.length).toBeGreaterThan(0);
    const area = areas[0]!;
    expect(area.getAttribute('d')).toBeTruthy();
    expect(area.getAttribute('fill')).not.toBe('none');
    // curve stroke still renders on top of the band
    expect(svg.querySelectorAll('path[stroke-width]').length).toBeGreaterThan(
      0
    );
  });

  it('`fill-solid` makes the band opaque (raw intent, not the 25% tint)', async () => {
    const tint = (await render(SRC('fill')))
      .querySelector('.dgmo-series-area')!
      .getAttribute('fill');
    const solid = (await render(SRC('fill\nfill-solid')))
      .querySelector('.dgmo-series-area')!
      .getAttribute('fill');
    expect(solid).toBeTruthy();
    expect(solid).not.toBe(tint);
  });
});
