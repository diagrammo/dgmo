// SPIKE: framework-agnostic mount controller for the hand-built D3 data charts.
// Proves the host-integration glue (render → inject → attach interactions →
// update → destroy) works headlessly, with no ECharts and no framework.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountD3DataChart } from '../src/charts-d3/mount';
import { renderDataChartD3 } from '../src/charts-d3/index';

const LINE = `line Monthly Active Users
series
  iOS
  Android

Jan 12 18
Feb 15 22
Mar 14 25`;

const PIE = `pie Languages
TypeScript 45
Python 30
Rust 25`;

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
});

describe('mountD3DataChart', () => {
  it('renders an interactive SVG with semantic markup', async () => {
    const ctrl = mountD3DataChart(host, LINE, {
      theme: 'light',
      palette: 'slate',
    });
    await ctrl.update(LINE);
    expect(host.querySelector('svg')).toBeTruthy();
    expect(host.querySelector('.dgmo-series')).toBeTruthy();
    expect(host.querySelector('.dgmo-pt[data-line-number]')).toBeTruthy();
    expect(host.querySelector('.dgmo-plot-rect')).toBeTruthy();
    ctrl.destroy();
  });

  it('bakes an invisible fat hit corridor into each line series', async () => {
    const ctrl = mountD3DataChart(host, LINE, {
      theme: 'light',
      palette: 'slate',
    });
    await ctrl.update(LINE);
    const series = host.querySelectorAll('g.dgmo-series');
    expect(series.length).toBe(2);
    for (const g of series) {
      const hit = g.querySelector<SVGPathElement>('.dgmo-series-hit');
      // Without the corridor, the baked CSS :hover emphasis in embeds only
      // fires on the 2.5px stroke / 4px dots and reads as dead.
      expect(hit).toBeTruthy();
      expect(hit!.getAttribute('stroke')).toBe('transparent');
      expect(parseFloat(hit!.getAttribute('stroke-width')!)).toBeGreaterThan(
        10
      );
      expect(hit!.getAttribute('fill')).toBe('none');
      expect(hit!.getAttribute('d')).toBe(
        g.querySelector('.dgmo-series-line')!.getAttribute('d')
      );
    }
    ctrl.destroy();
  });

  it('wires click-to-source-line via the adapter', async () => {
    let navigated: number | null = null;
    const ctrl = mountD3DataChart(host, LINE, {
      onNavigate: (n) => (navigated = n),
    });
    await ctrl.update(LINE);
    const pt = host.querySelector<SVGCircleElement>(
      '.dgmo-pt[data-line-number]'
    );
    expect(pt).toBeTruthy();
    const expected = parseInt(pt!.getAttribute('data-line-number')!, 10);
    pt!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navigated).toBe(expected);
    ctrl.destroy();
  });

  it('re-renders on update() and supersedes stale paints', async () => {
    const ctrl = mountD3DataChart(host, LINE, {});
    await ctrl.update(LINE);
    expect(host.querySelector('.dgmo-series')).toBeTruthy();
    // switch to a different chart family
    await ctrl.update(PIE);
    expect(
      host.querySelector('.dgmo-datum[data-name="TypeScript"]')
    ).toBeTruthy();
    expect(host.querySelector('.dgmo-series')).toBeFalsy();
    ctrl.destroy();
  });

  it('renders at the requested dimensions (responsive to pane size)', async () => {
    const svg = await renderDataChartD3(LINE, 'light', undefined, {
      width: 640,
      height: 360,
    });
    expect(svg).toContain('width="640"');
    expect(svg).toContain('height="360"');
    const big = await renderDataChartD3(LINE, 'light', undefined, {
      width: 1000,
      height: 500,
    });
    expect(big).toContain('width="1000"');
    expect(big).toContain('height="500"');
  });

  it('destroy() clears the container and detaches', async () => {
    const ctrl = mountD3DataChart(host, PIE, {});
    await ctrl.update(PIE);
    expect(host.querySelector('svg')).toBeTruthy();
    ctrl.destroy();
    expect(host.innerHTML).toBe('');
  });
});
