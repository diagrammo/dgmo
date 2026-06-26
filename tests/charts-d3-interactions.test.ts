// Interaction adapter: tooltip-free axis-projection model.
import { describe, it, expect, afterEach } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { attachDataChartInteractions } from '../src/charts-d3/interactions';

const SCATTER = `scatter Height vs Weight
x-label Height
y-label Weight

Alice 165 60
Bob 178 80
Carol 160 55`;

const LINE = `line MAU
series
  iOS
  Android

Jan 12 18
Feb 15 22
Mar 14 25`;

let host: HTMLDivElement;
let svg: SVGSVGElement;
let detach: () => void;

async function mount(src: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  host.innerHTML = await renderDataChartD3(src, 'light', undefined, {
    width: 800,
    height: 500,
  });
  svg = host.querySelector('svg')!;
  detach = attachDataChartInteractions(svg, {});
}

afterEach(() => {
  detach?.();
  host?.remove();
});

describe('axis-projection interactions (no tooltips)', () => {
  it('scatter: hovering a point draws leaders to both axes + on-axis pills, dims others', async () => {
    await mount(SCATTER);
    const pt = svg.querySelector<SVGCircleElement>(
      '.dgmo-datum[data-axval-x]'
    )!;
    pt.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    const overlay = svg.querySelector('.dgmo-overlay')!;
    // two dotted leader lines (to x-axis and y-axis)
    expect(overlay.querySelectorAll('.dgmo-axline').length).toBe(2);
    // two on-axis value pills (rect + text each)
    expect(overlay.querySelectorAll('rect').length).toBe(2);
    expect(overlay.querySelectorAll('text').length).toBe(2);
    // the hovered point's value appears on an axis
    expect(overlay.textContent).toContain(pt.getAttribute('data-axval-y'));
    // other figures dimmed, hovered not
    expect(pt.classList.contains('dgmo-dim')).toBe(false);
    const others = [...svg.querySelectorAll('.dgmo-datum')].filter(
      (d) => d !== pt
    );
    expect(others.every((d) => d.classList.contains('dgmo-dim'))).toBe(true);
  });

  it('no tooltip element is ever created', async () => {
    await mount(SCATTER);
    const pt = svg.querySelector<SVGCircleElement>('.dgmo-datum')!;
    pt.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    // legacy tooltip was an absolutely-positioned div in the container
    expect(host.querySelector('div')).toBeNull();
  });

  it('line: crosshair projects the nearest point to the y-axis', async () => {
    await mount(LINE);
    const plot = svg.querySelector('.dgmo-plot-rect')!;
    plot.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 })
    );
    const overlay = svg.querySelector('.dgmo-overlay')!;
    // vertical (to x-axis) + horizontal (to y-axis) leaders
    expect(overlay.querySelectorAll('.dgmo-axline').length).toBe(2);
    // x-label pill + y-value pill
    expect(overlay.querySelectorAll('rect').length).toBe(2);
  });

  it('mouseleave clears the overlay and dimming', async () => {
    await mount(SCATTER);
    const pt = svg.querySelector<SVGCircleElement>('.dgmo-datum')!;
    pt.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    svg.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    const overlay = svg.querySelector('.dgmo-overlay');
    expect(overlay?.children.length ?? 0).toBe(0);
    expect(
      [...svg.querySelectorAll('.dgmo-datum')].some((d) =>
        d.classList.contains('dgmo-dim')
      )
    ).toBe(false);
  });
});
