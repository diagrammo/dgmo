// Interaction adapter: tooltip-free axis-projection model.
import { describe, it, expect, afterEach } from 'vitest';
import { renderDataChartD3 } from '../src/charts-d3/index';
import { attachDataChartInteractions } from '../src/charts-d3/interactions';

const SCATTER = `scatter Height vs Weight
x-axis Height
y-axis Weight

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
x-axis Week
y-axis Signups

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

    const overlay = svg.querySelector('.dgmo-hover-layer')!;
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
x-axis Height
y-axis Weight
size-label Crew

Blackbeard 90 8500 40
Bonny 60 4000 12`);
    const pt = svg.querySelector<SVGCircleElement>('.dgmo-datum[data-size]')!;
    pt.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    const overlay = svg.querySelector('.dgmo-hover-layer')!;
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

  it('scatter: hovering a point label highlights that point, dims the others', async () => {
    await mount(SCATTER);
    const label = svg.querySelector<SVGElement>('.dgmo-ptlabel')!;
    const line = label.getAttribute('data-line-number');
    label.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    const datums = [...svg.querySelectorAll<SVGElement>('.dgmo-datum')];
    const own = datums.filter(
      (d) => d.getAttribute('data-line-number') === line
    );
    const others = datums.filter(
      (d) => d.getAttribute('data-line-number') !== line
    );
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((d) => !d.classList.contains('dgmo-dim'))).toBe(true);
    expect(others.every((d) => d.classList.contains('dgmo-dim'))).toBe(true);
    // projection leaders fire as if the bubble itself were hovered
    expect(
      svg.querySelector('.dgmo-hover-layer')!.querySelectorAll('.dgmo-axline')
        .length
    ).toBeGreaterThan(0);
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
    const overlay = svg.querySelector('.dgmo-hover-layer')!;
    // vertical (to x-axis) + horizontal (to y-axis) leaders
    expect(overlay.querySelectorAll('.dgmo-axline').length).toBe(2);
    // x-axis title + y-value on-axis labels (text, not pills)
    expect(overlay.querySelectorAll('text').length).toBe(2);
    expect(overlay.querySelectorAll('rect').length).toBe(0);
  });

  it("line: the x value takes the axis labels' slant when they are rotated (#2210)", async () => {
    const rows = Array.from(
      { length: 60 },
      (_, i) => `Nov 20 ${String(i).padStart(2, '0')}:00 ${50 + (i % 9)}`
    ).join('\n');
    await mount(`line Dense\nno-value\n\n${rows}`);
    const tick = Array.from(svg.querySelectorAll('.dgmo-tick')).find((t) =>
      (t.getAttribute('transform') ?? '').includes('rotate')
    );
    expect(tick).toBeTruthy();
    const plot = svg.querySelector('.dgmo-plot-rect')!;
    plot.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 })
    );
    const xValue = Array.from(svg.querySelectorAll('.dgmo-overlay text')).find(
      (t) => (t.textContent ?? '').startsWith('Nov 20')
    )!;
    const angle = /rotate\(([-\d.]+)\)/.exec(
      tick!.getAttribute('transform')!
    )![1];
    expect(xValue.getAttribute('transform')).toContain(`rotate(${angle})`);
    expect(xValue.getAttribute('text-anchor')).toBe('end');
  });

  it('line: the x value stays flat when the axis labels are flat', async () => {
    await mount(LINE);
    svg
      .querySelector('.dgmo-plot-rect')!
      .dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 })
      );
    const xValue = Array.from(svg.querySelectorAll('.dgmo-overlay text')).find(
      (t) => ['Jan', 'Feb', 'Mar'].includes(t.textContent ?? '')
    )!;
    expect(xValue.hasAttribute('transform')).toBe(false);
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
    const overlay = svg.querySelector('.dgmo-hover-layer');
    expect(overlay?.children.length ?? 0).toBe(0);
    expect(
      [...svg.querySelectorAll('.dgmo-datum')].some((d) =>
        d.classList.contains('dgmo-dim')
      )
    ).toBe(false);
  });
});

const DUAL_AXIS = `line Oil Price vs Strategic Reserve
x-axis Year
series
  y-axis $ / barrel
    Oil Price blue
  y-right-axis Million barrels
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

const SCATTER_CAT = `scatter Crews
x-axis Ruthlessness
y-axis Plunder

[Crew A] red
  Alice 60 40
  Bob 70 55

[Crew B] blue
  Zed 80 30
  Yan 50 65`;

const STACKED_BAR = `bar Revenue by Line
stack
  Hardware
  Services
  Support

Q1 40 25 10
Q2 30 45 12`;

// The mirror of the block below: hovering a MARK emphasizes its legend entry
// (diagrammo/diagrammo#852). Before it, the legend — the one surface that names
// a colour — did nothing while the other segments receded.
describe('mark hover → legend emphasis', () => {
  const legendEntry = (name: string) =>
    svg.querySelector<SVGGElement>(
      `.chart-legend [data-series-name="${name}"]`
    )!;
  const segment = (series: string) =>
    svg.querySelector<SVGElement>(`.dgmo-datum[data-series-name="${series}"]`)!;

  it('stacked bar: hovering a segment dims every legend row but its own', async () => {
    await mount(STACKED_BAR);
    segment('Hardware').dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true })
    );
    expect(legendEntry('Hardware').classList.contains('dgmo-dim')).toBe(false);
    expect(legendEntry('Services').classList.contains('dgmo-dim')).toBe(true);
    expect(legendEntry('Support').classList.contains('dgmo-dim')).toBe(true);
  });

  it('stacked bar: leaving the chart restores every legend row', async () => {
    await mount(STACKED_BAR);
    segment('Services').dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true })
    );
    expect(legendEntry('Hardware').classList.contains('dgmo-dim')).toBe(true);
    svg.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(
      [...svg.querySelectorAll('.chart-legend [data-legend-entry]')].some((e) =>
        e.classList.contains('dgmo-dim')
      )
    ).toBe(false);
  });

  it('scatter: hovering a bubble dims the other category, matching the marks', async () => {
    await mount(SCATTER_CAT);
    svg
      .querySelector<SVGElement>('.dgmo-datum[data-emph-key="Alice"]')!
      .dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(legendEntry('Crew A').classList.contains('dgmo-dim')).toBe(false);
    expect(legendEntry('Crew B').classList.contains('dgmo-dim')).toBe(true);
  });

  it('a mark the legend does not name leaves the whole legend alone', async () => {
    // The mirror of "values are read off the marks, never off the legend": a
    // key with no entry must emphasize nothing rather than dim everything.
    await mount(STACKED_BAR);
    const mark = segment('Hardware');
    mark.setAttribute('data-series-name', 'Nothing Named This');
    mark.setAttribute('data-emph-key', 'Nothing Named This');
    mark.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(
      [...svg.querySelectorAll('.chart-legend [data-legend-entry]')].some((e) =>
        e.classList.contains('dgmo-dim')
      )
    ).toBe(false);
  });

  it('the dim style reaches a legend entry, which carries no dgmo-* class', async () => {
    await mount(STACKED_BAR);
    const css = svg.querySelector(
      '#dgmo-chart-interactions-style'
    )!.textContent!;
    expect(css).toContain('[data-legend-entry].dgmo-dim');
  });
});

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

  it('scatter: legend hover dims bubbles of other categories', async () => {
    await mount(SCATTER_CAT);
    const bubble = (name: string) =>
      svg.querySelector<SVGCircleElement>(
        `.dgmo-datum[data-emph-key="${name}"]`
      )!;
    legendEntry('Crew A').dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true })
    );
    expect(bubble('Alice').classList.contains('dgmo-dim')).toBe(false);
    expect(bubble('Zed').classList.contains('dgmo-dim')).toBe(true);
    legendEntry('Crew A').dispatchEvent(
      new MouseEvent('mouseleave', { bubbles: true })
    );
    expect(bubble('Zed').classList.contains('dgmo-dim')).toBe(false);
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

  // #2240: a hovered series lights its own axis (ticks + title) and fades
  // the other; the crosshair reads a value off the series' own axis.
  const sideMarks = (side: string) =>
    Array.from(svg.querySelectorAll(`[data-axis-side="${side}"]`));
  const faded = (els: Element[]) =>
    els.every((e) => e.classList.contains('dgmo-faded'));
  const lit = (els: Element[]) =>
    els.every((e) => !e.classList.contains('dgmo-faded'));

  it('dual-axis line: ticks and titles carry their side', async () => {
    await mount(DUAL_AXIS);
    const titles = (side: string) =>
      sideMarks(side).filter((e) => e.classList.contains('dgmo-axis-title'));
    expect(titles('left').map((t) => t.textContent)).toEqual(['$ / barrel']);
    expect(titles('right').map((t) => t.textContent)).toEqual([
      'Million barrels',
    ]);
    expect(sideMarks('left').length).toBeGreaterThan(2);
    expect(sideMarks('right').length).toBeGreaterThan(2);
  });

  it('dual-axis line: a legend entry lights its axis and fades the other', async () => {
    await mount(DUAL_AXIS);
    legendEntry('SPR Size').dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true })
    );
    expect(lit(sideMarks('right'))).toBe(true);
    expect(faded(sideMarks('left'))).toBe(true);
    legendEntry('SPR Size').dispatchEvent(
      new MouseEvent('mouseleave', { bubbles: true })
    );
    expect(lit([...sideMarks('left'), ...sideMarks('right')])).toBe(true);
    legendEntry('Oil Price').dispatchEvent(
      new MouseEvent('mouseenter', { bubbles: true })
    );
    expect(lit(sideMarks('left'))).toBe(true);
    expect(faded(sideMarks('right'))).toBe(true);
  });

  it('dual-axis line: an axis strip lights its own ticks and title', async () => {
    await mount(DUAL_AXIS);
    svg
      .querySelector('[data-axis-legend="right"]')!
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(lit(sideMarks('right'))).toBe(true);
    expect(faded(sideMarks('left'))).toBe(true);
  });

  it('dual-axis line: the crosshair puts a right-axis value on the right axis', async () => {
    await mount(DUAL_AXIS);
    // jsdom: the crosshair lands on the first slot's topmost point, which in
    // this fixture is SPR Size (645 on the right axis).
    const pt = svg.querySelector<SVGCircleElement>(
      '.dgmo-series[data-series-name="SPR Size"] .dgmo-pt'
    )!;
    const cx = parseFloat(pt.getAttribute('cx')!);
    const cy = parseFloat(pt.getAttribute('cy')!);
    svg
      .querySelector('.dgmo-plot-rect')!
      .dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy })
      );
    const value = Array.from(svg.querySelectorAll('.dgmo-overlay text')).find(
      (t) => t.textContent === pt.getAttribute('data-value')
    )!;
    expect(value).toBeTruthy();
    expect(value.getAttribute('text-anchor')).toBe('start');
    const rightEdge = Math.max(
      ...Array.from(svg.querySelectorAll('.dgmo-axline')).map((l) =>
        Math.max(
          parseFloat(l.getAttribute('x1')!),
          parseFloat(l.getAttribute('x2')!)
        )
      )
    );
    expect(parseFloat(value.getAttribute('x')!)).toBe(rightEdge + 10);
    // The right title stays lit; the left axis fades.
    expect(faded(sideMarks('left'))).toBe(true);
    expect(
      lit(
        sideMarks('right').filter((e) =>
          e.classList.contains('dgmo-axis-title')
        )
      )
    ).toBe(true);
    // Leaving clears every fade.
    svg.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(lit([...sideMarks('left'), ...sideMarks('right')])).toBe(true);
  });

  it('dual-axis line: a left-axis point keeps its value on the left', async () => {
    // jsdom has no screen transform, so the crosshair lands at (0, 0): the
    // first slot's topmost point. Here that is Oil Price, on the left axis.
    await mount(DUAL_AXIS.replace('2019 57 645', '2019 95 300'));
    svg
      .querySelector('.dgmo-plot-rect')!
      .dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const value = Array.from(svg.querySelectorAll('.dgmo-overlay text')).find(
      (t) => t.textContent === '$95' || t.textContent === '95'
    )!;
    expect(value.getAttribute('text-anchor')).toBe('end');
    expect(faded(sideMarks('right'))).toBe(true);
    expect(
      lit(
        sideMarks('left').filter((e) => e.classList.contains('dgmo-axis-title'))
      )
    ).toBe(true);
  });

  it('single-axis line: no axis-legend strips (nothing to disambiguate)', async () => {
    await mount(LINE);
    expect(svg.querySelectorAll('[data-axis-legend]').length).toBe(0);
  });

  // A line with an uncertainty band draws ONE series group plus the band
  // (diagrammo/diagrammo#2099): the legend still has two entries, so hover
  // must still emphasise one and recede the other.
  it('line with a band: hovering the line recedes the band, and the reverse', async () => {
    await mount(`line Storm Wind
series
  Wind red
  Floor orange
  Ceiling orange
band Cone Floor Ceiling

0 45 45 45
12 52 48 56
24 60 52 68`);
    const band = svg.querySelector<SVGGElement>(
      '.dgmo-series-band[data-series-name="Cone"]'
    )!;
    expect(band).toBeTruthy();
    const wind = legendEntry('Wind');
    wind.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(seriesGroup('Wind').classList.contains('dgmo-dim')).toBe(false);
    expect(band.classList.contains('dgmo-dim')).toBe(true);
    wind.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(band.classList.contains('dgmo-dim')).toBe(false);
    const cone = legendEntry('Cone');
    cone.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(seriesGroup('Wind').classList.contains('dgmo-dim')).toBe(true);
    expect(band.classList.contains('dgmo-dim')).toBe(false);
    cone.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(seriesGroup('Wind').classList.contains('dgmo-dim')).toBe(false);
    const css = svg.querySelector('style')?.textContent ?? '';
    expect(css).toContain('.dgmo-series-band.dgmo-dim');
  });

  it('function: legend hover dims the other curves', async () => {
    await mount(`function Damped Roll
x-axis 0..12

Roll blue: 30*exp(-0.25*x)*sin(2*x)
Envelope gray: 30*exp(-0.25*x)`);
    const curve = (name: string) =>
      svg.querySelector<SVGPathElement>(
        `.dgmo-datum[data-series-name="${name}"]`
      )!;
    expect(curve('Roll')).toBeTruthy();
    const entry = legendEntry('Roll');
    entry.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(curve('Roll').classList.contains('dgmo-dim')).toBe(false);
    expect(curve('Envelope').classList.contains('dgmo-dim')).toBe(true);
    entry.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(curve('Envelope').classList.contains('dgmo-dim')).toBe(false);
  });
});

const HEATMAP = `heatmap Activity
columns Jan, Feb, Mar

Caribbean 5 4 5
Atlantic  2 3 2
Pacific   3 1 4`;

describe('series hover → its overlays follow (#2216)', () => {
  const SRC = [
    'line Plunder',
    'mean',
    'series',
    '  Cutlass blue',
    '  Powder green',
    '',
    'A 4 1',
    'B 9 3',
    'C 7 4',
    'D 11 5',
  ].join('\n');
  const owned = (name: string) => [
    ...svg.querySelectorAll(`.dgmo-series-extra[data-series-name="${name}"]`),
  ];
  const hover = (name: string, type: string) =>
    svg
      .querySelector(`.chart-legend [data-series-name="${name}"]`)!
      .dispatchEvent(new MouseEvent(type, { bubbles: true }));

  it('tags each series mean, extremes, values and end name', async () => {
    await mount(SRC);
    const cls = (name: string) =>
      owned(name)
        .map((e) => e.getAttribute('class'))
        .join(' ');
    for (const name of ['Cutlass', 'Powder']) {
      expect(cls(name)).toContain('dgmo-overlay-mean');
      expect(cls(name)).toContain('dgmo-overlay-extremes');
      expect(cls(name)).toContain('dgmo-series-end-label');
    }
  });

  it('dims the other series overlays and keeps the hovered ones lit', async () => {
    await mount(SRC);
    hover('Cutlass', 'mouseenter');
    expect(owned('Cutlass').some((e) => e.classList.contains('dgmo-dim'))).toBe(
      false
    );
    expect(owned('Powder').every((e) => e.classList.contains('dgmo-dim'))).toBe(
      true
    );
    hover('Cutlass', 'mouseleave');
    expect(
      [...svg.querySelectorAll('.dgmo-series-extra')].some((e) =>
        e.classList.contains('dgmo-dim')
      )
    ).toBe(false);
  });
});

describe('series hover → its value labels follow (#2097)', () => {
  const BAR = [
    'bar Cannons vs Crew',
    'group',
    '  Cannons blue',
    '  Crew green',
    '',
    'Revenge 40 300',
    'Fortune 34 262',
  ].join('\n');
  const STACK = [
    'bar Plunder',
    'stack',
    '  Gold orange',
    '  Silver blue',
    '',
    'Tortuga 400 220',
    'Nassau 310 180',
  ].join('\n');
  const MIRROR = [
    'bar Crew',
    'mirror',
    '  Day blue',
    '  Night green',
    '',
    'Deck 60 30',
    'Hold 20 45',
  ].join('\n');
  const LINEV = [
    'line Waves',
    'series',
    '  Siren',
    '  Echo',
    '',
    'A 4 1',
    'B 9 3',
    'C 7 4',
  ].join('\n');
  const labelsOf = (name: string) => [
    ...svg.querySelectorAll(`text[data-series-name="${name}"]`),
  ];
  const hoverLegend = (name: string, type = 'mouseenter') =>
    svg
      .querySelector(`.chart-legend [data-series-name="${name}"]`)!
      .dispatchEvent(new MouseEvent(type, { bubbles: true }));
  const dimmed = (e: Element) =>
    e.classList.contains('dgmo-dim') || !!e.closest('.dgmo-dim');

  const cases: Array<[string, string, string, string]> = [
    ['grouped bar', BAR, 'Cannons', 'Crew'],
    ['stacked bar', STACK, 'Gold', 'Silver'],
    ['mirror bar', MIRROR, 'Day', 'Night'],
    ['line', LINEV, 'Siren', 'Echo'],
  ];
  for (const [label, src, a, b] of cases) {
    it(`${label}: the other series' value labels dim, the hovered series' stay lit`, async () => {
      await mount(src);
      expect(labelsOf(a).length).toBeGreaterThan(0);
      expect(labelsOf(b).length).toBeGreaterThan(0);
      hoverLegend(a);
      expect(labelsOf(a).some(dimmed)).toBe(false);
      expect(labelsOf(b).every(dimmed)).toBe(true);
      hoverLegend(a, 'mouseleave');
      expect(
        [...svg.querySelectorAll('text[data-series-name]')].some(dimmed)
      ).toBe(false);
    });
  }

  it('grouped bar: hovering a bar dims the other series labels', async () => {
    await mount(BAR);
    const bar = svg.querySelector<SVGElement>(
      '.dgmo-datum[data-series-name="Cannons"]'
    )!;
    bar.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(labelsOf('Cannons').some(dimmed)).toBe(false);
    expect(labelsOf('Crew').every(dimmed)).toBe(true);
  });

  it('radar: a hovered series keeps its labels and the other series recede whole', async () => {
    await mount(
      [
        'radar Ratings',
        'series',
        '  Pearl blue',
        '  Dutchman purple',
        '',
        'Fire 85 95',
        'Speed 90 55',
        'Armor 60 90',
      ].join('\n')
    );
    hoverLegend('Pearl');
    const groups = [...svg.querySelectorAll('.dgmo-series')];
    const lit = groups.filter((g) => !g.classList.contains('dgmo-dim'));
    expect(lit).toHaveLength(1);
    expect(lit[0]!.querySelectorAll('text').length).toBeGreaterThan(0);
  });
});

describe('heatmap axis-label click → row/column pin', () => {
  const label = (value: string) =>
    svg.querySelector<SVGElement>(
      `.dgmo-axis-label[data-filter-value="${value}"]`
    )!;
  const cells = () =>
    Array.from(svg.querySelectorAll<SVGElement>('rect.dgmo-datum'));
  const click = (el: Element) =>
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  it('row + column labels carry filter attrs', async () => {
    await mount(HEATMAP);
    expect(label('Caribbean').getAttribute('data-filter-attr')).toBe(
      'data-row-key'
    );
    expect(label('Feb').getAttribute('data-filter-attr')).toBe('data-col-key');
  });

  it('clicking a row label dims every cell outside that row', async () => {
    await mount(HEATMAP);
    click(label('Atlantic'));
    for (const c of cells()) {
      expect(c.classList.contains('dgmo-dim')).toBe(
        c.getAttribute('data-row-key') !== 'Atlantic'
      );
    }
    expect(label('Atlantic').classList.contains('dgmo-axis-active')).toBe(true);
  });

  it('clicking a column label dims every cell outside that column', async () => {
    await mount(HEATMAP);
    click(label('Feb'));
    for (const c of cells()) {
      expect(c.classList.contains('dgmo-dim')).toBe(
        c.getAttribute('data-col-key') !== 'Feb'
      );
    }
  });

  it('clicking the same label again unpins; another label switches the pin', async () => {
    await mount(HEATMAP);
    click(label('Feb'));
    click(label('Feb'));
    expect(cells().some((c) => c.classList.contains('dgmo-dim'))).toBe(false);
    expect(label('Feb').classList.contains('dgmo-axis-active')).toBe(false);

    click(label('Feb'));
    click(label('Pacific'));
    expect(label('Feb').classList.contains('dgmo-axis-active')).toBe(false);
    expect(label('Pacific').classList.contains('dgmo-axis-active')).toBe(true);
    for (const c of cells()) {
      expect(c.classList.contains('dgmo-dim')).toBe(
        c.getAttribute('data-row-key') !== 'Pacific'
      );
    }
  });

  it('pin survives a cell hover + mouseleave', async () => {
    await mount(HEATMAP);
    click(label('Caribbean'));
    const other = cells().find(
      (c) => c.getAttribute('data-row-key') === 'Atlantic'
    )!;
    other.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    svg.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    for (const c of cells()) {
      expect(c.classList.contains('dgmo-dim')).toBe(
        c.getAttribute('data-row-key') !== 'Caribbean'
      );
    }
  });

  it('background click unpins', async () => {
    await mount(HEATMAP);
    click(label('Jan'));
    click(svg);
    expect(cells().some((c) => c.classList.contains('dgmo-dim'))).toBe(false);
  });
});

describe('heatmap axis-label hover + single-cell emphasis', () => {
  const label = (value: string) =>
    svg.querySelector<SVGElement>(
      `.dgmo-axis-label[data-filter-value="${value}"]`
    )!;
  const cells = () =>
    Array.from(svg.querySelectorAll<SVGElement>('rect.dgmo-datum'));
  const fire = (el: Element, type: string) =>
    el.dispatchEvent(new MouseEvent(type, { bubbles: true }));

  it('hovering a row label dims every cell outside that row; leaving restores', async () => {
    await mount(HEATMAP);
    fire(label('Atlantic'), 'mouseenter');
    for (const c of cells()) {
      expect(c.classList.contains('dgmo-dim')).toBe(
        c.getAttribute('data-row-key') !== 'Atlantic'
      );
    }
    fire(label('Atlantic'), 'mouseleave');
    expect(cells().some((c) => c.classList.contains('dgmo-dim'))).toBe(false);
  });

  it('hovering a column label dims every cell outside that column', async () => {
    await mount(HEATMAP);
    fire(label('Mar'), 'mouseenter');
    for (const c of cells()) {
      expect(c.classList.contains('dgmo-dim')).toBe(
        c.getAttribute('data-col-key') !== 'Mar'
      );
    }
  });

  it('label hover yields to the pin on leave', async () => {
    await mount(HEATMAP);
    fire(label('Jan'), 'click');
    fire(label('Pacific'), 'mouseenter');
    fire(label('Pacific'), 'mouseleave');
    for (const c of cells()) {
      expect(c.classList.contains('dgmo-dim')).toBe(
        c.getAttribute('data-col-key') !== 'Jan'
      );
    }
  });

  it('hovering a cell emphasizes only that cell (its value label included)', async () => {
    await mount(HEATMAP);
    const target = cells().find(
      (c) =>
        c.getAttribute('data-row-key') === 'Atlantic' &&
        c.getAttribute('data-col-key') === 'Feb'
    )!;
    fire(target, 'mousemove');
    const key = target.getAttribute('data-emph-key')!;
    for (const d of Array.from(
      svg.querySelectorAll<SVGElement>('.dgmo-datum')
    )) {
      expect(d.classList.contains('dgmo-dim')).toBe(
        d.getAttribute('data-emph-key') !== key
      );
    }
  });
});

// #2079: the chart frame translates the drawing down by the header height; the
// crosshair overlay must live in the same space as the points it points at.
describe('crosshair in a framed chart (#2079)', () => {
  const offsetY = (el: Element): number => {
    let y = 0;
    for (let n: Element | null = el; n; n = n.parentElement) {
      const m = /translate\(\s*[-\d.]+[ ,]+([-\d.]+)\s*\)/.exec(
        n.getAttribute('transform') ?? ''
      );
      if (m) y += parseFloat(m[1]!);
    }
    return y;
  };

  it('horizontal leader sits on the hovered point (log axis + subtitle)', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = await renderDataChartD3(
      `line Pirate havens
subtitle Population growth on a log axis
y-axis 10..1000000 log

series
  Tortuga
  Nassau

1680 120 40
1700 900 300
1720 6000 2500`,
      'light',
      undefined,
      { width: 889, height: 600 },
      true
    );
    svg = host.querySelector('svg')!;
    // jsdom has no layout: identity pointer mapping, so user space == client.
    const ident = () => ({ inverse: () => ({}) });
    (svg as unknown as { getScreenCTM: () => unknown }).getScreenCTM = ident;
    (
      svg.querySelector('.dgmo-plot-rect')!.parentNode as unknown as {
        getScreenCTM: () => unknown;
      }
    ).getScreenCTM = ident;
    (svg as unknown as { createSVGPoint: () => unknown }).createSVGPoint =
      () => ({
        x: 0,
        y: 0,
        matrixTransform() {
          return { x: this.x, y: this.y };
        },
      });
    detach = attachDataChartInteractions(svg, {});

    const pt = svg.querySelector<SVGCircleElement>(
      '.dgmo-pt[data-x-index="1"]'
    )!;
    const cy = parseFloat(pt.getAttribute('cy')!);
    svg.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        clientX: parseFloat(pt.getAttribute('cx')!),
        clientY: cy,
      })
    );
    const overlay = svg.querySelector('.dgmo-hover-layer')!;
    const leader = [...overlay.querySelectorAll('.dgmo-axline')].find(
      (l) => l.getAttribute('y1') === l.getAttribute('y2')
    )!;
    expect(offsetY(pt)).toBeGreaterThan(0); // the frame really shifts the plot
    expect(
      parseFloat(leader.getAttribute('y1')!) + offsetY(leader)
    ).toBeCloseTo(cy + offsetY(pt), 6);
  });
});

describe('band and era hover lights the points inside (#2098)', () => {
  const SRC = `line Sales
band 380..420 Margin
era Mar -> Apr Doldrums
series
  Haul
  Quota

Jan 420 400
Feb 300 410
Mar 380 420
Apr 350 430
May 500 450`;

  const state = () =>
    [...svg.querySelectorAll<SVGElement>('.dgmo-pt')].map((p) => ({
      s: p.getAttribute('data-series-name'),
      x: p.getAttribute('data-x-label'),
      in: p.classList.contains('dgmo-region-in'),
      out: p.classList.contains('dgmo-region-out'),
    }));
  const hover = (sel: string) =>
    svg
      .querySelector(sel)!
      .dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

  it('era: both ends inclusive, every series', async () => {
    await mount(SRC);
    const era = [...svg.querySelectorAll('.dgmo-region')].find(
      (r) => r.getAttribute('data-region-axis') === 'x'
    )!;
    era.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const lit = state()
      .filter((p) => p.in)
      .map((p) => `${p.s}@${p.x}`)
      .sort();
    expect(lit).toEqual(['Haul@Apr', 'Haul@Mar', 'Quota@Apr', 'Quota@Mar']);
    expect(state().every((p) => p.in !== p.out)).toBe(true);
  });

  it('band: both edges inclusive, every series', async () => {
    await mount(SRC);
    const band = [...svg.querySelectorAll('.dgmo-region')].find(
      (r) => r.getAttribute('data-region-axis') === 'y'
    )!;
    band.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const lit = state()
      .filter((p) => p.in)
      .map((p) => `${p.s}@${p.x}`)
      .sort();
    expect(lit).toEqual([
      'Haul@Jan',
      'Haul@Mar',
      'Quota@Feb',
      'Quota@Jan',
      'Quota@Mar',
    ]);
  });

  it('the band label lights the same points; leaving restores', async () => {
    await mount(SRC);
    hover('text.dgmo-region[data-region-axis="y"]');
    expect(state().filter((p) => p.in).length).toBe(5);
    svg.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(state().every((p) => !p.in && !p.out)).toBe(true);
  });

  it('moving off a region onto plain plot restores', async () => {
    await mount(SRC);
    hover('rect.dgmo-region');
    expect(state().some((p) => p.in)).toBe(true);
    svg
      .querySelector('.dgmo-plot-rect')!
      .dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(state().every((p) => !p.in && !p.out)).toBe(true);
  });
});

// Bar hover projects onto the axes (#2307): the FULL category name on the
// category axis, however the ticks were thinned or tilted, and the value on
// the value axis.
describe('bar hover → axis projection (#2307)', () => {
  const CITIES = Array.from(
    { length: 50 },
    (_, i) => `City Number ${String(i).padStart(2, '0')} ${10 + i}`
  ).join('\n');
  const hover = (el: Element) =>
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  const overlayTexts = () =>
    [...svg.querySelectorAll('.dgmo-hover-layer text')].map(
      (t) => t.textContent
    );

  it('vertical: every bar carries its full name and value, even with thinned ticks', async () => {
    await mount(`bar Visitors\norientation-vertical\n\n${CITIES}`);
    const bars = [...svg.querySelectorAll('rect.dgmo-datum')];
    expect(bars.length).toBe(50);
    const shown = [...svg.querySelectorAll('.dgmo-tick')].map(
      (t) => t.textContent
    );
    const names = bars.map((b) => b.getAttribute('data-axval-x'));
    expect(names.filter((n) => !shown.includes(n)).length).toBeGreaterThan(0);
    expect(names[49]).toBe('City Number 49');
    expect(bars[49]!.getAttribute('data-axval-y')).toBe('59');
  });

  it('vertical: hover draws two leaders and prints name + value; the name takes the tick slant', async () => {
    await mount(`bar Visitors\norientation-vertical\n\n${CITIES}`);
    const bar = svg.querySelector(
      'rect.dgmo-datum[data-name="City Number 42"]'
    )!;
    hover(bar);
    expect(svg.querySelectorAll('.dgmo-hover-layer .dgmo-axline').length).toBe(
      2
    );
    expect(overlayTexts()).toEqual(['City Number 42', '52']);
    const name = [...svg.querySelectorAll('.dgmo-hover-layer text')][0]!;
    expect(name.getAttribute('transform') ?? '').toContain('rotate(');
    svg.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(svg.querySelector('.dgmo-hover-layer')?.children.length ?? 0).toBe(
      0
    );
  });

  it('horizontal: hover projects the value onto the bottom axis; the row name stands', async () => {
    await mount(
      `bar Visitors\norientation-horizontal\n\nOslo 92\nRome 23\nLima 77`
    );
    const bar = svg.querySelector('rect.dgmo-datum[data-name="Rome"]')!;
    expect(bar.getAttribute('data-axval-x')).toBe('23');
    expect(bar.hasAttribute('data-axval-y')).toBe(false);
    hover(bar);
    expect(svg.querySelectorAll('.dgmo-hover-layer .dgmo-axline').length).toBe(
      1
    );
    expect(overlayTexts()).toEqual(['23']);
  });

  it('stacked and pareto bars keep the dim-only hover', async () => {
    for (const src of [
      STACKED_BAR,
      `bar Defects\npareto\n\nA 50\nB 30\nC 20`,
    ]) {
      await mount(src);
      expect(svg.querySelector('[data-axval-x], [data-axval-y]')).toBeNull();
      expect(svg.querySelector('.dgmo-plot-rect')).toBeNull();
      detach.destroy();
      host.remove();
    }
  });
});

// #2391: hovering ANY facet panel — not only the first — shows the hover at
// the same x in every panel, whether the panels share a y range or not.
describe('facet panels share the hover (#2391)', () => {
  const LINE = `line Downloads
facet
series
  Mac
  Windows
  Linux
  Other

1.0 12 180 5 40
1.1 15 220 7 35
1.2 14 250 9 30`;
  const BAR = `bar Downloads
facet
group
  Mac
  Windows
  Linux

A 12 180 5
B 15 220 7
C 14 250 9`;

  /** Offset of `el`'s user space from the root's: nested svg x/y + translates. */
  const offset = (el: Element): { dx: number; dy: number } => {
    let dx = 0;
    let dy = 0;
    for (let n: Element | null = el; n; n = n.parentElement) {
      if (
        n.tagName.toLowerCase() === 'svg' &&
        n.parentElement?.closest('svg')
      ) {
        dx += parseFloat(n.getAttribute('x') ?? '0');
        dy += parseFloat(n.getAttribute('y') ?? '0');
      }
      const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(
        n.getAttribute('transform') ?? ''
      );
      if (m) {
        dx += parseFloat(m[1]!);
        dy += parseFloat(m[2]!);
      }
    }
    return { dx, dy };
  };

  /** jsdom has no layout: give every element a CTM from its offsets. */
  async function mountWithLayout(src: string) {
    host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = await renderDataChartD3(src, 'light', undefined, {
      width: 900,
      height: 600,
    });
    svg = host.querySelector('svg')!;
    for (const el of [svg, ...svg.querySelectorAll('*')])
      (el as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({
        inverse: () => offset(el),
      });
    (svg as unknown as { createSVGPoint: () => unknown }).createSVGPoint =
      () => ({
        x: 0,
        y: 0,
        matrixTransform(m: { dx: number; dy: number }) {
          return { x: this.x - m.dx, y: this.y - m.dy };
        },
      });
    detach = attachDataChartInteractions(svg, {});
  }

  const panels = () => [...svg.querySelectorAll('g.dgmo-facet-panel')];

  // `facet-free-y` rides beside `facet`: each panel its own y range.
  for (const flag of ['facet', 'facet\nfacet-free-y'])
    it(`line \`${flag.replace('\n', ' + ')}\`: hovering a later panel draws the crosshair in every panel`, async () => {
      await mountWithLayout(LINE.replace('facet', flag));
      const ps = panels();
      expect(ps.length).toBe(4);
      // hover the LAST panel's middle point, in screen (root) coordinates
      const pt = ps[3]!.querySelector<SVGCircleElement>(
        '.dgmo-pt[data-x-index="1"]'
      )!;
      const o = offset(pt);
      svg.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: parseFloat(pt.getAttribute('cx')!) + o.dx,
          clientY: parseFloat(pt.getAttribute('cy')!) + o.dy,
        })
      );
      for (const p of ps) {
        const layer = p.querySelector('.dgmo-hover-layer');
        expect(layer, p.getAttribute('data-series')!).not.toBeNull();
        const own = p.querySelector<SVGCircleElement>(
          '.dgmo-pt[data-x-index="1"]'
        )!;
        const vertical = [...layer!.querySelectorAll('.dgmo-axline')].find(
          (l) => l.getAttribute('x1') === l.getAttribute('x2')
        )!;
        expect(parseFloat(vertical.getAttribute('x1')!)).toBeCloseTo(
          parseFloat(own.getAttribute('cx')!),
          6
        );
        expect(layer!.textContent).toContain('1.1');
        expect(layer!.textContent).toContain(own.getAttribute('data-value')!);
        expect(parseFloat(own.getAttribute('r')!)).toBeGreaterThan(3.5);
      }
      svg.dispatchEvent(new MouseEvent('mouseleave'));
      expect(svg.querySelectorAll('.dgmo-hover-layer *').length).toBe(0);
    });

  // `facet-free-y` rides beside `facet`: each panel its own y range.
  for (const flag of ['facet', 'facet\nfacet-free-y'])
    it(`bar \`${flag.replace('\n', ' + ')}\`: hovering a later panel's bar lights that category in every panel`, async () => {
      await mountWithLayout(BAR.replace('facet', flag));
      const ps = panels();
      expect(ps.length).toBe(3);
      const bar = ps[2]!.querySelector<SVGElement>(
        '.dgmo-datum[data-emph-key="B"]'
      )!;
      bar.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      for (const p of ps) {
        const bars = [...p.querySelectorAll('.dgmo-datum[data-emph-key]')];
        expect(bars.length).toBe(3);
        for (const b of bars)
          expect(b.classList.contains('dgmo-dim')).toBe(
            b.getAttribute('data-emph-key') !== 'B'
          );
      }
    });
});
