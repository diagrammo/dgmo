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

const AREA = `line Cumulative Signups
fill
x-label Week
y-label Signups

W1 50
W2 120
W3 210`;

let host: HTMLDivElement;
let svg: SVGSVGElement;
let detach: { destroy: () => void; highlight: (l: number | null) => void };

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
  detach?.destroy();
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
    // two on-axis value labels — plain emphasized text, NOT pills (no rects)
    expect(overlay.querySelectorAll('text').length).toBe(2);
    expect(overlay.querySelectorAll('rect').length).toBe(0);
    // the hovered point's value appears on an axis
    expect(overlay.textContent).toContain(pt.getAttribute('data-axval-y'));
    // the chart's own axis ticks fade so the active value reads as the tick
    const ticks = [...svg.querySelectorAll('.dgmo-tick')];
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((t) => t.classList.contains('dgmo-faded'))).toBe(true);
    // other figures dimmed, hovered not
    expect(pt.classList.contains('dgmo-dim')).toBe(false);
    const others = [...svg.querySelectorAll('.dgmo-datum')].filter(
      (d) => d !== pt
    );
    expect(others.every((d) => d.classList.contains('dgmo-dim'))).toBe(true);
  });

  it('bubble: hovering a sized point also prints the size value at the point', async () => {
    await mount(`scatter Crew Manifest
x-label Height
y-label Weight
size-label Crew

Blackbeard 90 8500 40
Bonny 60 4000 12`);
    const pt = svg.querySelector<SVGCircleElement>('.dgmo-datum[data-size]')!;
    pt.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    const overlay = svg.querySelector('.dgmo-overlay')!;
    // two on-axis values + the two-line size block (number + label)
    expect(overlay.querySelectorAll('text').length).toBe(4);
    const [num, lbl] = [...overlay.querySelectorAll('.dgmo-pointval')];
    expect(num!.textContent).toBe(pt.getAttribute('data-size'));
    expect(lbl!.textContent).toBe('Crew');
    // block tinted with the bubble's color
    expect(num!.getAttribute('fill')).toBe(pt.getAttribute('data-color'));
    expect(lbl!.getAttribute('fill')).toBe(pt.getAttribute('data-color'));
    // both lines share the vertical axis
    expect(lbl!.getAttribute('x')).toBe(num!.getAttribute('x'));
    // clears the bubble: either beside it (start/end anchor) or vertically
    // past its radius
    const cy = parseFloat(pt.getAttribute('cy')!);
    const r = parseFloat(pt.getAttribute('r')!);
    const anchor = num!.getAttribute('text-anchor');
    const vy = parseFloat(num!.getAttribute('y')!);
    expect(anchor !== 'middle' || Math.abs(vy - cy) > r).toBe(true);
    // label sits farther from the bubble than the number
    const ly = parseFloat(lbl!.getAttribute('y')!);
    expect(Math.abs(ly - cy)).toBeGreaterThan(Math.abs(vy - cy));
  });

  it('bubble: size value falls back to "size" label and is absent without a size column', async () => {
    await mount(`scatter No Label

Alice 165 60 20
Bob 178 80`);
    const sized = svg.querySelector<SVGCircleElement>(
      '.dgmo-datum[data-size]'
    )!;
    sized.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const [num, lbl] = [
      ...svg.querySelectorAll('.dgmo-overlay .dgmo-pointval'),
    ];
    expect(num!.textContent).toBe('20');
    expect(lbl!.textContent).toBe('size');

    const unsized = [
      ...svg.querySelectorAll<SVGCircleElement>('.dgmo-datum'),
    ].find((d) => !d.hasAttribute('data-size'))!;
    unsized.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(svg.querySelector('.dgmo-overlay .dgmo-pointval')).toBeNull();
  });

  it('bubble: hover value position is baked and used by the adapter', async () => {
    await mount(`scatter Baked
size-label Crew

Blackbeard 90 8500 40`);
    const pt = svg.querySelector<SVGCircleElement>('.dgmo-datum[data-size]')!;
    expect(pt.getAttribute('data-sizeval-x')).not.toBeNull();
    expect(pt.getAttribute('data-sizeval-y')).not.toBeNull();
    pt.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const val = svg.querySelector('.dgmo-overlay .dgmo-pointval')!;
    expect(val.getAttribute('x')).toBe(pt.getAttribute('data-sizeval-x'));
    expect(val.getAttribute('y')).toBe(pt.getAttribute('data-sizeval-y'));
  });

  it('scatter: hovering a point fades every other point label, not its own', async () => {
    await mount(SCATTER);
    const pt = svg.querySelector<SVGCircleElement>('.dgmo-datum')!;
    pt.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    const line = pt.getAttribute('data-line-number');
    const labels = [...svg.querySelectorAll<SVGElement>('.dgmo-ptlabel')];
    expect(labels.length).toBe(3);
    const own = labels.filter(
      (l) => l.getAttribute('data-line-number') === line
    );
    const others = labels.filter(
      (l) => l.getAttribute('data-line-number') !== line
    );
    expect(own.every((l) => !l.classList.contains('dgmo-dim'))).toBe(true);
    expect(others.every((l) => l.classList.contains('dgmo-dim'))).toBe(true);

    // leaving clears the fade
    svg.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(labels.every((l) => !l.classList.contains('dgmo-dim'))).toBe(true);
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
    // x-label + y-value on-axis labels (text, not pills)
    expect(overlay.querySelectorAll('text').length).toBe(2);
    expect(overlay.querySelectorAll('rect').length).toBe(0);
  });

  it('area: crosshair fires when hovering the fill or a dot (not just empty space)', async () => {
    await mount(AREA);
    const fill = svg.querySelector<SVGPathElement>('.dgmo-series-area')!;
    expect(fill).toBeTruthy();
    fill.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 9, clientY: 9 })
    );
    expect(svg.querySelector('.dgmo-overlay .dgmo-axline')).toBeTruthy();

    // and directly over a data dot
    const dot = svg.querySelector<SVGCircleElement>('.dgmo-pt')!;
    dot.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 9, clientY: 9 })
    );
    expect(svg.querySelectorAll('.dgmo-overlay .dgmo-axline').length).toBe(2);
  });

  it('highlight(line) emphasizes the matching figure and dims others; null clears', async () => {
    await mount(SCATTER);
    const pt = svg.querySelector<SVGCircleElement>(
      '.dgmo-datum[data-line-number]'
    )!;
    const line = parseInt(pt.getAttribute('data-line-number')!, 10);
    detach.highlight(line);
    expect(pt.classList.contains('dgmo-dim')).toBe(false);
    const others = [...svg.querySelectorAll('.dgmo-datum')].filter(
      (d) => d !== pt
    );
    expect(others.every((d) => d.classList.contains('dgmo-dim'))).toBe(true);
    detach.highlight(null);
    expect(
      [...svg.querySelectorAll('.dgmo-datum')].some((d) =>
        d.classList.contains('dgmo-dim')
      )
    ).toBe(false);
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

const DUAL_AXIS = `line Oil Price vs Strategic Reserve
x-label Year
series
  y-label $ / barrel
    Oil Price blue
  y-right-label Million barrels
    SPR Size green

2019 57 645
2020 39 638
2021 68 621`;

const RADAR_MULTI = `radar Fleet
series
  Black Pearl blue
  Flying Dutchman purple

Firepower 85 95
Speed 90 55
Armor 60 90`;

describe('legend hover → series emphasis', () => {
  const seriesGroup = (name: string) =>
    svg.querySelector<SVGGElement>(`.dgmo-series[data-series-name="${name}"]`)!;
  const legendEntry = (name: string) =>
    svg.querySelector<SVGGElement>(
      `.chart-legend [data-series-name="${name}"]`
    )!;

  it('radar: hovering a legend entry dims the other series, not the hovered one', async () => {
    await mount(RADAR_MULTI);
    legendEntry('Black Pearl').dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true })
    );
    expect(seriesGroup('Black Pearl').classList.contains('dgmo-dim')).toBe(
      false
    );
    expect(seriesGroup('Flying Dutchman').classList.contains('dgmo-dim')).toBe(
      true
    );
  });

  it('radar: mouseleave restores every series', async () => {
    await mount(RADAR_MULTI);
    const entry = legendEntry('Black Pearl');
    entry.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    entry.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(
      [...svg.querySelectorAll('.dgmo-series')].some((g) =>
        g.classList.contains('dgmo-dim')
      )
    ).toBe(false);
  });

  it('line: legend hover dims non-hovered series groups too', async () => {
    await mount(LINE);
    legendEntry('iOS').dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true })
    );
    expect(seriesGroup('iOS').classList.contains('dgmo-dim')).toBe(false);
    expect(seriesGroup('Android').classList.contains('dgmo-dim')).toBe(true);
  });

  it('legend entries carry a transparent hit-rect so the whole pill is hoverable', async () => {
    await mount(LINE);
    for (const name of ['iOS', 'Android']) {
      const hit = legendEntry(name).querySelector<SVGRectElement>('rect');
      expect(hit).toBeTruthy();
      expect(hit!.getAttribute('fill')).toBe('transparent');
      expect(parseFloat(hit!.getAttribute('width') ?? '0')).toBeGreaterThan(0);
    }
  });

  it('dual-axis line: hovering a legend entry emphasizes its axis series', async () => {
    await mount(DUAL_AXIS);
    legendEntry('Oil Price').dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true })
    );
    expect(seriesGroup('Oil Price').classList.contains('dgmo-dim')).toBe(false);
    expect(seriesGroup('SPR Size').classList.contains('dgmo-dim')).toBe(true);
  });

  it('dual-axis line: hovering a y-axis strip dims the other axis series', async () => {
    await mount(DUAL_AXIS);
    // Oil Price sits on the left axis, SPR Size on the right.
    expect(seriesGroup('Oil Price').getAttribute('data-axis')).toBe('left');
    expect(seriesGroup('SPR Size').getAttribute('data-axis')).toBe('right');
    const strip = (axis: string) =>
      svg.querySelector<SVGRectElement>(`[data-axis-legend="${axis}"]`)!;
    strip('left').dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true })
    );
    expect(seriesGroup('Oil Price').classList.contains('dgmo-dim')).toBe(false);
    expect(seriesGroup('SPR Size').classList.contains('dgmo-dim')).toBe(true);
    strip('left').dispatchEvent(
      new MouseEvent('mouseleave', { bubbles: true })
    );
    strip('right').dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true })
    );
    expect(seriesGroup('SPR Size').classList.contains('dgmo-dim')).toBe(false);
    expect(seriesGroup('Oil Price').classList.contains('dgmo-dim')).toBe(true);
  });

  it('single-axis line: no axis-legend strips (nothing to disambiguate)', async () => {
    await mount(LINE);
    expect(svg.querySelectorAll('[data-axis-legend]').length).toBe(0);
  });
});
