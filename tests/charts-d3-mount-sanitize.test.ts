// dgmo's own live-DOM mount goes through the sanitizing boundary, and does it
// in the order the boundary requires (diagrammo/diagrammo#884).
//
// `mountD3DataChart` assigns renderer output into the host's live pane and,
// unlike the `auto` and `element` script-tag bundles, used to call nothing
// afterwards. The renderer is stubbed here because the real one escapes its
// input correctly — the point of the boundary is that the mount does not have
// to depend on that staying true of every chart type forever, and the fallback
// path renders an error card built from the author's own source text.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ChartsD3 from '../src/charts-d3/index';

const renderDataChartD3 = vi.fn();
const render = vi.fn();

vi.mock('../src/charts-d3/index', async (importOriginal) => {
  const actual = await importOriginal<typeof ChartsD3>();
  return { ...actual, renderDataChartD3 };
});

vi.mock('../src/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render')>();
  return { ...actual, render };
});

const { mountD3DataChart } = await import('../src/charts-d3/mount');

// A custom element records the one thing jsdom can observe about insertion
// order: `connectedCallback` runs synchronously inside an `innerHTML`
// assignment on a document-attached node, and not at all on a detached one.
// It sits inside a `foreignObject`, so the sanitizer removes it either way —
// the flag is therefore true only if the subtree was connected BEFORE the
// scrub, which is exactly the defect.
const CONNECTED: string[] = [];
class PwnProbe extends HTMLElement {
  connectedCallback(): void {
    CONNECTED.push('connected');
  }
}
customElements.define('dgmo-pwn-probe', PwnProbe);

const HOSTILE = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">',
  '<script>globalThis.__dgmoPwned = true;</script>',
  '<foreignObject><dgmo-pwn-probe></dgmo-pwn-probe>',
  '<div onclick="steal()">payload</div></foreignObject>',
  '<rect onload="steal()" fill="red" />',
  '<a href="javascript:alert(1)"><text>link</text></a>',
  '<a href="#safe"><animate attributeName="href" to="javascript:alert(1)"/></a>',
  '</svg>',
].join('');

describe('mountD3DataChart sanitizes what it injects', () => {
  beforeEach(() => {
    CONNECTED.length = 0;
    renderDataChartD3.mockReset();
    render.mockReset();
    renderDataChartD3.mockResolvedValue(HOSTILE);
  });

  it('strips script, foreignObject, on*, javascript: and href animations', async () => {
    const container = document.createElement('div');
    document.body.append(container);

    const ctrl = mountD3DataChart(container, 'bar\n  a 1');
    // The constructor's first paint is fire-and-forget; update() awaits one.
    await ctrl.update('bar\n  a 1');

    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('foreignObject')).toBeNull();
    expect(container.querySelector('[onload]')).toBeNull();
    expect(container.querySelector('animate')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.querySelector('rect')!.getAttribute('fill')).toBe('red');
    expect(container.querySelector('a[href="#safe"]')).not.toBeNull();

    ctrl.destroy();
    container.remove();
  });

  it('never connects the hostile subtree to the document', async () => {
    // 🔴 The finding this assertion exists for: sanitizing one line AFTER
    // `container.innerHTML = svg` is too late. Connecting the subtree is what
    // creates an <iframe>'s browsing context, starts an <img>'s fetch and runs
    // a custom element's connectedCallback — all inside the assignment, before
    // any scrub could run. A detached holder makes all of them unreachable.
    const container = document.createElement('div');
    document.body.append(container);

    const ctrl = mountD3DataChart(container, 'bar\n  a 1');
    await ctrl.update('bar\n  a 1');

    expect(CONNECTED).toEqual([]);

    ctrl.destroy();
    container.remove();
  });

  it('sanitizes the render() fallback too, not only the chart path', async () => {
    // A null from the chart renderer sends mount through render(), whose
    // error card is assembled from the author's own source text — so that
    // branch needs the boundary as much as the chart one. Stubbed rather than
    // driven by a bad source string: `render()` answers an EMPTY svg for an
    // unknown chart type, which would leave every assertion below true of an
    // empty container and the test proving nothing.
    renderDataChartD3.mockResolvedValue(null);
    render.mockResolvedValue({ svg: HOSTILE });
    const container = document.createElement('div');
    document.body.append(container);

    const ctrl = mountD3DataChart(container, 'not-a-chart-type\n  ???');
    await ctrl.update('not-a-chart-type\n  ???');

    // It really rendered — without this the assertions below would pass just
    // as happily against an empty container.
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('rect')).not.toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('foreignObject')).toBeNull();
    expect(container.querySelector('animate')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    expect(CONNECTED).toEqual([]);

    ctrl.destroy();
    container.remove();
  });
});
