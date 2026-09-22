// dgmo's own live-DOM mount goes through the sanitizing boundary
// (diagrammo/diagrammo#884).
//
// `mountD3DataChart` assigns renderer output with `container.innerHTML` and,
// unlike the `auto` and `element` script-tag bundles, used to call nothing
// afterwards. The renderer is stubbed here because the real one escapes its
// input correctly — the point of the boundary is that the mount does not have
// to depend on that being true of every chart type forever, and the fallback
// path renders an error card built from the author's own source text.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ChartsD3 from '../src/charts-d3/index';

const renderDataChartD3 = vi.fn();

vi.mock('../src/charts-d3/index', async (importOriginal) => {
  const actual = await importOriginal<typeof ChartsD3>();
  return { ...actual, renderDataChartD3 };
});

const { mountD3DataChart } = await import('../src/charts-d3/mount');

const HOSTILE = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">',
  '<script>globalThis.__dgmoPwned = true;</script>',
  '<foreignObject><div onclick="steal()">payload</div></foreignObject>',
  '<rect onload="steal()" fill="red" />',
  '<a href="javascript:alert(1)"><text>link</text></a>',
  '</svg>',
].join('');

describe('mountD3DataChart sanitizes what it injects', () => {
  beforeEach(() => {
    renderDataChartD3.mockReset();
    renderDataChartD3.mockResolvedValue(HOSTILE);
  });

  it('strips script, foreignObject, on* and javascript: from the container', async () => {
    const container = document.createElement('div');
    document.body.append(container);

    const ctrl = mountD3DataChart(container, 'bar\n  a 1');
    // The constructor's first paint is fire-and-forget; update() awaits one.
    await ctrl.update('bar\n  a 1');

    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('foreignObject')).toBeNull();
    expect(container.querySelector('[onload]')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.querySelector('rect')!.getAttribute('fill')).toBe('red');

    ctrl.destroy();
    container.remove();
  });

  it('sanitizes the error-card fallback too, not only the chart path', async () => {
    // A null from the chart renderer sends mount through render()'s error
    // card, which is assembled from the author's own source text.
    renderDataChartD3.mockResolvedValue(null);
    const container = document.createElement('div');
    document.body.append(container);

    const ctrl = mountD3DataChart(container, 'not-a-chart-type\n  ???');
    await ctrl.update('not-a-chart-type\n  ???');

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('foreignObject')).toBeNull();

    ctrl.destroy();
    container.remove();
  });
});
