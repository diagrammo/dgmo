// ============================================================
// Framework-agnostic interaction adapter for hand-rendered data-chart SVGs.
//
// Replaces the ECharts-instance interaction model (dispatchAction /
// convertToPixel / setOption graphic) with plain DOM events over the semantic
// SVG the D3 renderers emit. No ECharts, no d3, no framework — just an
// SVGSVGElement + the `data-*` attributes the renderers wrote.
//
// Interaction model (NO tooltips): hovering a figure draws dotted leader lines
// to the axis/axes associated with it, prints that figure's value ON the axis
// (axis-pointer style), and dims the other figures. Charts without axes
// (pie/funnel/sankey/…) just emphasize the hovered figure and dim the rest —
// their values already live in static labels.
//
// Three auto-detected modes:
//   • crosshair   — line/area (`.dgmo-plot-rect` + `.dgmo-pt`): snap a vertical
//     leader to the nearest x, project the nearest series point to the y-axis.
//   • projection  — figures carrying `data-axval-x`/`data-axval-y` (scatter
//     points, plain and grouped bars):
//     dotted leaders to BOTH axes + on-axis value pills.
//   • emphasis    — any other `.dgmo-datum`: emphasize + dim siblings.
// Plus universal click-to-source via `data-line-number`.
// ============================================================

import { GRID_DASH } from '../utils/visual-conventions';

export interface DataChartInteractionOpts {
  onNavigate?: (line: number) => void;
  mutedColor?: string;
  surface?: string;
  text?: string;
}

export interface DataChartController {
  /** Remove all listeners + overlays. */
  destroy: () => void;
  /** Emphasize the chart element(s) on the given source line (editor cursor
   *  sync); pass null to clear. No-op while the pointer is actively hovering. */
  highlight: (line: number | null) => void;
}

const NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'dgmo-chart-interactions-style';

function ensureStyle(svg: SVGSVGElement, muted: string): void {
  const doc = svg.ownerDocument;
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElementNS(NS, 'style');
  style.id = STYLE_ID;
  style.textContent = `
    .dgmo-series,.dgmo-series-band,.dgmo-datum,.dgmo-tick,.dgmo-ptlabel{transition:opacity .12s ease}
    [data-legend-entry]{transition:opacity .12s ease}
    .dgmo-series.dgmo-dim,.dgmo-series-band.dgmo-dim,.dgmo-datum.dgmo-dim,.dgmo-ptlabel.dgmo-dim,.dgmo-series-extra.dgmo-dim,[data-legend-entry].dgmo-dim{opacity:.18}
    .dgmo-pt,.dgmo-datum{transition:opacity .12s ease}
    .dgmo-pt.dgmo-region-out,.dgmo-datum.dgmo-region-out{opacity:.18}
    .dgmo-pt.dgmo-region-in{r:4.5px}
    .dgmo-tick.dgmo-faded{opacity:.22}
    .dgmo-axis-title{transition:opacity .12s ease}.dgmo-axis-title.dgmo-faded{opacity:.22}
    .dgmo-datum{cursor:pointer}
    .dgmo-axis-label{cursor:pointer}
    .dgmo-axis-label.dgmo-axis-active{font-weight:bold}
    .dgmo-axis-label{transition:opacity .12s ease}.dgmo-axis-label.dgmo-faded{opacity:.22}
    .dgmo-axline{stroke:${muted};stroke-width:1;stroke-dasharray:${GRID_DASH};pointer-events:none}
  `;
  svg.insertBefore(style, svg.firstChild);
}

function toUserSpace(
  svg: SVGSVGElement,
  e: MouseEvent,
  space: SVGGraphicsElement = svg
): { x: number; y: number } {
  const ctm = space.getScreenCTM?.();
  if (!ctm) return { x: 0, y: 0 };
  const p = svg.createSVGPoint();
  p.x = e.clientX;
  p.y = e.clientY;
  const u = p.matrixTransform(ctm.inverse());
  return { x: u.x, y: u.y };
}

function walkUpForLine(target: Element | null, root: Element): number | null {
  let el: Element | null = target;
  while (el && el !== root.parentElement) {
    const a = el.getAttribute('data-line-number');
    if (a) return parseInt(a, 10);
    el = el.parentElement;
  }
  return null;
}

interface Plot {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function attachDataChartInteractions(
  svg: SVGSVGElement,
  opts: DataChartInteractionOpts = {}
): DataChartController {
  const muted = opts.mutedColor ?? '#94a3b8';
  const text = opts.text ?? '#1f2933';
  ensureStyle(svg, muted);
  const doc = svg.ownerDocument;

  const plotOf = (r: SVGRectElement): Plot => {
    const x = parseFloat(r.getAttribute('x') ?? '0');
    const y = parseFloat(r.getAttribute('y') ?? '0');
    return {
      left: x,
      top: y,
      right: x + parseFloat(r.getAttribute('width') ?? '0'),
      bottom: y + parseFloat(r.getAttribute('height') ?? '0'),
    };
  };
  // A `facet` grid (#1853) draws one plot rect per panel; the first is the
  // one every single-plot mode below reads.
  const plotRects = Array.from(
    svg.querySelectorAll<SVGRectElement>('.dgmo-plot-rect')
  );
  const plotRect = plotRects[0] ?? null;
  const plot: Plot | null = plotRect ? plotOf(plotRect) : null;

  // The chart-frame wraps the drawing in a translated group (header height),
  // so the plot rect, points and ticks live in THAT space, not the root's. The
  // overlay and the pointer must be measured in it too, or every leader sits a
  // header-height off the point (#2079).
  const space = (plotRect?.parentNode ?? svg) as SVGGraphicsElement;

  const seriesGroups = Array.from(
    svg.querySelectorAll<SVGGElement>('.dgmo-series')
  );
  // A line chart's uncertainty bands (line.ts) carry the band label as
  // data-series-name and have their own legend entry (#2099).
  const seriesBands = Array.from(
    svg.querySelectorAll<SVGGElement>('.dgmo-series-band')
  );
  const datums = Array.from(svg.querySelectorAll<SVGElement>('.dgmo-datum'));
  // What a series owns outside its group (#2216): its mean, median, trend
  // and average, its high and low, their labels and leaders, its printed
  // values and its end-of-line name. Each carries the series' name, and
  // dims whenever that series' group does.
  // Only names a series group carries, so marks other code dims (scatter's
  // point names, a bar's datums) are never touched here.
  // A bar chart's series are datums, not groups (#2097): its value labels
  // follow the series its bars carry.
  const groupNames = new Set(
    Array.from(
      svg.querySelectorAll(
        '.dgmo-series, .dgmo-series-band, .dgmo-datum[data-series-name]'
      ),
      (g) => g.getAttribute('data-series-name')
    )
  );
  const seriesExtras = Array.from(
    svg.querySelectorAll<SVGElement>('[data-series-name]')
  ).filter(
    (el) =>
      groupNames.has(el.getAttribute('data-series-name')) &&
      !el.matches(
        '.dgmo-series, .dgmo-series-band, .dgmo-datum, .dgmo-pt, .dgmo-ptlabel, [data-legend-entry]'
      ) &&
      !el.parentElement?.closest('.dgmo-series, .chart-legend')
  );
  for (const el of seriesExtras) el.classList.add('dgmo-series-extra');
  const mirrorExtras = () => {
    if (!seriesExtras.length) return;
    const dimmed = new Set<string>();
    const lit = new Set<string>();
    for (const g of svg.querySelectorAll<SVGElement>(
      '.dgmo-series[data-series-name], .dgmo-series-band[data-series-name], .dgmo-datum[data-series-name]'
    ))
      (g.classList.contains('dgmo-dim') ? dimmed : lit).add(
        g.getAttribute('data-series-name')!
      );
    for (const el of seriesExtras) {
      const n = el.getAttribute('data-series-name')!;
      el.classList.toggle('dgmo-dim', dimmed.has(n) && !lit.has(n));
    }
  };
  // The injected series legend (utils/legend-svg.ts). Read here rather than at
  // the legend-hover block below because the MARK→legend mirror (#852) needs
  // it too, and that runs from the datum handlers further up.
  const legendEntries = Array.from(
    svg.querySelectorAll<SVGGElement>('.chart-legend [data-legend-entry]')
  );
  const circles = Array.from(
    svg.querySelectorAll<SVGCircleElement>('.dgmo-pt')
  );
  const ticks = Array.from(svg.querySelectorAll<SVGTextElement>('.dgmo-tick'));
  // A dual-axis line tags each value tick and axis title with its side
  // (#2240), so a hovered series can light its own axis and fade the other.
  const sideMarks = Array.from(
    svg.querySelectorAll<SVGElement>(
      '.dgmo-tick[data-axis-side], .dgmo-axis-title[data-axis-side]'
    )
  );
  const dualAxis = sideMarks.length > 0;
  const fadeTicks = () => ticks.forEach((t) => t.classList.add('dgmo-faded'));
  const unfadeTicks = () => {
    ticks.forEach((t) => t.classList.remove('dgmo-faded'));
    sideMarks.forEach((t) => t.classList.remove('dgmo-faded'));
  };
  /** Light one value axis (ticks + title) and fade the other; null restores. */
  const lightAxis = (side: string | null | undefined) => {
    for (const el of sideMarks)
      el.classList.toggle(
        'dgmo-faded',
        side != null && el.getAttribute('data-axis-side') !== side
      );
  };
  /** The value axis a series is drawn against, on a dual-axis line. */
  const sideOfSeries = (name: string | null): string | null => {
    if (!dualAxis || name == null) return null;
    for (const g of seriesGroups)
      if (g.getAttribute('data-series-name') === name)
        return g.getAttribute('data-axis');
    return null;
  };

  // ── transient overlay (leader lines + on-axis value pills) ────────────
  // One overlay per coordinate space: a facet grid's crosshair draws in every
  // panel at once (#2391), each in its own panel's space. `drawSpace` is the
  // space the next mark goes into.
  const overlays = new Map<SVGGraphicsElement, SVGGElement>();
  let drawSpace: SVGGraphicsElement = space;
  const getOverlay = (): SVGGElement => {
    let overlay = overlays.get(drawSpace);
    if (!overlay) {
      overlay = doc.createElementNS(NS, 'g');
      overlay.setAttribute('class', 'dgmo-overlay dgmo-hover-layer');
      overlay.setAttribute('pointer-events', 'none');
      overlays.set(drawSpace, overlay);
    }
    drawSpace.appendChild(overlay); // keep on top, in the plot's coordinate space
    return overlay;
  };
  const clearOverlay = () => {
    for (const overlay of overlays.values())
      while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
    unfadeTicks();
  };

  const dottedLine = (x1: number, y1: number, x2: number, y2: number) => {
    const l = doc.createElementNS(NS, 'line');
    l.setAttribute('class', 'dgmo-axline');
    l.setAttribute('x1', String(x1));
    l.setAttribute('y1', String(y1));
    l.setAttribute('x2', String(x2));
    l.setAttribute('y2', String(y2));
    getOverlay().appendChild(l);
  };

  // The active value drawn ON an axis — styled as an emphasized tick (chart
  // text color, a little bigger + bold), NOT a tooltip chip. Sits where the
  // axis tick label would; the other ticks fade so this one reads as active.
  // side 'x' → below x-axis (centered, at the x-tick row); side 'y' → left of
  // the y-axis (right-aligned, at the y-tick column); 'y-right' → right of a
  // dual-axis line's right axis (left-aligned, #2240).
  const axisValue = (
    cx: number,
    cy: number,
    label: string,
    side: 'x' | 'y' | 'y-right'
  ) => {
    const t = doc.createElementNS(NS, 'text');
    t.setAttribute('font-size', '15');
    t.setAttribute('font-weight', 'bold');
    t.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    t.setAttribute('fill', text);
    t.textContent = label;
    // A rotated category axis (#2210): the value takes the ticks' own slant
    // and baseline, so it reads in place rather than as a flat overlay.
    const slant =
      side === 'x'
        ? /translate\([^,]+,\s*([-\d.]+)\)\s*rotate\(([-\d.]+)\)/.exec(
            ticks
              .map((k) => k.getAttribute('transform') ?? '')
              .find((tr) => tr.includes('rotate')) ?? ''
          )
        : null;
    if (slant) {
      const tickFont = parseFloat(
        ticks
          .find((k) => k.hasAttribute('transform'))
          ?.getAttribute('font-size') ?? '11'
      );
      t.setAttribute('font-size', String(tickFont + 1));
      t.setAttribute('text-anchor', 'end');
      t.setAttribute(
        'transform',
        `translate(${cx},${slant[1]}) rotate(${slant[2]})`
      );
    } else if (side === 'x') {
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('x', String(cx));
      t.setAttribute('y', String(cy + 19));
    } else if (side === 'y-right') {
      t.setAttribute('text-anchor', 'start');
      t.setAttribute('x', String(cx + 10));
      t.setAttribute('y', String(cy + 5));
    } else {
      t.setAttribute('text-anchor', 'end');
      t.setAttribute('x', String(cx - 10));
      t.setAttribute('y', String(cy + 5));
    }
    getOverlay().appendChild(t);
  };

  // A value with no axis to project onto (scatter bubble size) — a two-line
  // block near the hovered point: the big number nearest the bubble (slightly
  // faded so its size doesn't shout), the small label stacked beyond it, both
  // on the same vertical axis. Positions are baked by the renderer
  // (data-sizeval-*) so the block clears static name labels.
  const pointValue = (
    cx: number,
    numY: number,
    lblY: number,
    label: string,
    value: string,
    anchor: 'middle' | 'start' | 'end' = 'middle',
    color?: string
  ) => {
    const fill = color ?? text;
    const mk = (
      content: string,
      y: number,
      font: number,
      weight: number,
      opacity: number
    ) => {
      const t = doc.createElementNS(NS, 'text');
      t.setAttribute('class', 'dgmo-pointval');
      t.setAttribute('font-size', String(font));
      t.setAttribute('font-weight', String(weight));
      t.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      t.setAttribute('fill', fill);
      t.setAttribute('fill-opacity', String(opacity));
      t.setAttribute('text-anchor', anchor);
      t.setAttribute('x', String(cx));
      t.setAttribute('y', String(y));
      t.textContent = content;
      getOverlay().appendChild(t);
    };
    mk(value, numY, 20, 700, 0.75);
    mk(label, lblY, 11, 500, 0.85);
  };

  // Static point-name labels + their leader lines (scatter). Fade with the
  // datums so only the hovered point's name stays prominent.
  const ptLabels = Array.from(
    svg.querySelectorAll<SVGElement>('.dgmo-ptlabel')
  );
  // ── mark hover → emphasize its legend entry (diagrammo/diagrammo#852) ───
  // The mirror of the legend→mark pairing below. The legend entry carries the
  // same RAW `data-series-name` the mark does (legend-svg.ts), so the two pair
  // exactly; a chart whose marks key off something the legend never names is
  // left alone rather than dimmed whole — the same rule the baked-CSS path
  // states as "values are read off the marks, never off the legend".
  const dimLegendExcept = (el: Element | null) => {
    const name =
      el?.getAttribute('data-series-name') ??
      el?.getAttribute('data-emph-key') ??
      null;
    const paired =
      name != null &&
      legendEntries.some((e) => e.getAttribute('data-series-name') === name);
    for (const e of legendEntries)
      e.classList.toggle(
        'dgmo-dim',
        paired && e.getAttribute('data-series-name') !== name
      );
  };
  const dimDatumsExcept = (el: Element | null) => {
    for (const d of datums) d.classList.toggle('dgmo-dim', d !== el);
    mirrorExtras();
    const line = el?.getAttribute('data-line-number');
    for (const l of ptLabels)
      l.classList.toggle(
        'dgmo-dim',
        line == null || l.getAttribute('data-line-number') !== line
      );
    dimLegendExcept(el);
  };
  const dimByKey = (el: SVGElement) => {
    const key = el.getAttribute('data-emph-key');
    for (const d of datums) {
      const dk = d.getAttribute('data-emph-key');
      if (key) d.classList.toggle('dgmo-dim', dk !== key);
      else d.classList.toggle('dgmo-dim', d !== el);
    }
    mirrorExtras();
    // Side labels paired to a mark by line (funnel, #2439) recede with the
    // other marks.
    const line = el.getAttribute('data-line-number');
    for (const l of ptLabels)
      l.classList.toggle(
        'dgmo-dim',
        line == null || l.getAttribute('data-line-number') !== line
      );
    dimLegendExcept(el);
  };
  // ── band / era hover → light the points inside it (#2098) ──────────────
  // A band or era carries its pixel span (annotations/draw.ts tagRegion). A
  // mark is in when its centre lies in the span, edges included; every other
  // mark recedes and the lines between stay as drawn. Classes only, so it
  // coexists with the crosshair and the series hover instead of fighting
  // them. The plot rect covers the band, so the pointer is tested against
  // the spans too, not only the element under it.
  const regions = Array.from(
    svg.querySelectorAll<SVGElement>('.dgmo-region')
  ).map((el) => ({
    el,
    axis: el.getAttribute('data-region-axis'),
    lo: parseFloat(el.getAttribute('data-region-lo') ?? 'NaN'),
    hi: parseFloat(el.getAttribute('data-region-hi') ?? 'NaN'),
    side: el.getAttribute('data-region-side'),
  }));
  const regionMarks = Array.from(
    svg.querySelectorAll<SVGElement>('.dgmo-pt, .dgmo-datum[cx][cy]')
  );
  // Pixel slack for a mark whose position the renderer rounded.
  const REGION_SLACK = 0.5;
  let region: (typeof regions)[number] | null = null;
  const setRegion = (next: (typeof regions)[number] | null) => {
    if (next === region) return;
    region = next;
    for (const m of regionMarks) {
      if (!next) {
        m.classList.remove('dgmo-region-out', 'dgmo-region-in');
        continue;
      }
      const c = parseFloat(m.getAttribute(next.axis === 'x' ? 'cx' : 'cy')!);
      const axis = m.closest('.dgmo-series')?.getAttribute('data-axis');
      const inside =
        c >= next.lo - REGION_SLACK &&
        c <= next.hi + REGION_SLACK &&
        (!next.side || !axis || axis === next.side);
      m.classList.toggle('dgmo-region-in', inside);
      m.classList.toggle('dgmo-region-out', !inside);
    }
  };
  const regionAt = (
    target: Element,
    pt: { x: number; y: number } | null
  ): (typeof regions)[number] | null => {
    const hit = target.closest?.('.dgmo-region');
    if (hit) return regions.find((r) => r.el === hit) ?? null;
    if (!pt || !plot) return null;
    if (pt.x < plot.left || pt.x > plot.right) return null;
    if (pt.y < plot.top || pt.y > plot.bottom) return null;
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i]!;
      const v = r.axis === 'x' ? pt.x : pt.y;
      if (v >= r.lo && v <= r.hi) return r;
    }
    return null;
  };
  const clearDim = () => {
    for (const d of datums) d.classList.remove('dgmo-dim');
    for (const g of seriesGroups) g.classList.remove('dgmo-dim');
    mirrorExtras();
    for (const l of ptLabels) l.classList.remove('dgmo-dim');
    for (const e of legendEntries) e.classList.remove('dgmo-dim');
    reapplyAxisPin();
  };

  // ── axis-label hover/click → emphasize that row/column ─────────────────
  // Renderers tag axis labels with data-filter-attr (the datum attribute to
  // match, e.g. data-emph-key / data-col-key) + data-filter-value (heatmap
  // row/column labels). Hovering a label dims every non-matching datum
  // transiently; clicking pins the same dim. Clicking the same label again —
  // or empty space — unpins. Datum hover still wins while active; the pin
  // reasserts when the hover clears.
  let axisPin: { attr: string; value: string; el: Element } | null = null;
  const axisLabels = Array.from(
    svg.querySelectorAll<SVGElement>('[data-filter-attr]')
  );
  const applyAxisFilter = (attr: string, value: string) => {
    for (const d of datums)
      d.classList.toggle('dgmo-dim', d.getAttribute(attr) !== value);
  };
  function reapplyAxisPin(): void {
    if (axisPin) applyAxisFilter(axisPin.attr, axisPin.value);
  }
  const setAxisPin = (next: typeof axisPin) => {
    if (axisPin) axisPin.el.classList.remove('dgmo-axis-active');
    axisPin = next;
    if (axisPin) axisPin.el.classList.add('dgmo-axis-active');
    if (!axisPin) for (const d of datums) d.classList.remove('dgmo-dim');
    reapplyAxisPin();
  };
  const axisLabelListeners: Array<[SVGElement, string, EventListener]> = [];
  for (const el of axisLabels) {
    const attr = el.getAttribute('data-filter-attr');
    const value = el.getAttribute('data-filter-value');
    if (!attr || value == null) continue;
    const onEnter: EventListener = () => applyAxisFilter(attr, value);
    const onExit: EventListener = () => {
      for (const d of datums) d.classList.remove('dgmo-dim');
      reapplyAxisPin();
    };
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onExit);
    axisLabelListeners.push([el, 'mouseenter', onEnter]);
    axisLabelListeners.push([el, 'mouseleave', onExit]);
  }

  // ── crosshair (line / area) ───────────────────────────────────────────
  // A pane is one plot rect and the points drawn in it. A plain line has one;
  // a `facet` grid has one per panel, and hovering any panel draws the
  // crosshair at the same x in every panel (#2391). The shared quantity is
  // the x index, so panels with their own y ranges (`facet-free-y`) line up.
  type Slot = { xi: number; cx: number; pts: SVGCircleElement[] };
  interface Pane {
    plot: Plot;
    space: SVGGraphicsElement;
    groups: SVGGElement[];
    slots: Slot[];
  }
  const slotsOf = (pts: SVGCircleElement[]): Slot[] => {
    const byX = new Map<number, SVGCircleElement[]>();
    for (const el of pts) {
      const xi = parseInt(el.getAttribute('data-x-index') ?? '0', 10);
      (byX.get(xi) ?? byX.set(xi, []).get(xi)!).push(el);
    }
    return [...byX.entries()]
      .map(([xi, p]) => ({
        xi,
        cx: parseFloat(p[0]!.getAttribute('cx') ?? '0'),
        pts: p,
      }))
      .sort((a, b) => a.cx - b.cx);
  };
  const faceted = plotRects.length > 1;
  const panes: Pane[] = [];
  if (plotRect && circles.length > 0) {
    if (!faceted)
      panes.push({
        plot: plot!,
        space,
        groups: seriesGroups,
        slots: slotsOf(circles),
      });
    else
      for (const r of plotRects) {
        const root = r.closest('.dgmo-facet-panel') ?? r.parentElement!;
        const pts = circles.filter((c) => root.contains(c));
        if (!pts.length) continue;
        panes.push({
          plot: plotOf(r),
          space: (r.parentNode ?? svg) as SVGGraphicsElement,
          groups: seriesGroups.filter((g) => root.contains(g)),
          slots: slotsOf(pts),
        });
      }
  }
  const crosshairOn = panes.length > 0;
  let activePts: { el: SVGCircleElement; r: number }[] = [];
  const restorePt = () => {
    for (const p of activePts) p.el.setAttribute('r', String(p.r));
    activePts = [];
  };

  /** The pane under the pointer and the pointer in its space, or null. */
  const paneAt = (
    e: MouseEvent
  ): { pane: Pane; x: number; y: number } | null => {
    for (const pane of panes) {
      const ctm = pane.space.getScreenCTM?.();
      const { x, y } = toUserSpace(svg, e, pane.space);
      if (
        !ctm ||
        (x >= pane.plot.left - 2 &&
          x <= pane.plot.right + 2 &&
          y >= pane.plot.top - 2 &&
          y <= pane.plot.bottom + 2)
      )
        return { pane, x, y };
    }
    return null;
  };

  /** One pane's crosshair at `slot`, its leader from the point nearest `y`. */
  const drawPaneCrosshair = (pane: Pane, slot: Slot, y: number): void => {
    const { plot } = pane;
    let nearest = slot.pts[0]!;
    let bestY = Infinity;
    for (const p of slot.pts) {
      const cy = parseFloat(p.getAttribute('cy') ?? '0');
      const d = Math.abs(cy - y);
      if (d < bestY) {
        bestY = d;
        nearest = p;
      }
    }
    drawSpace = pane.space;
    // vertical leader at the category x + x-axis value
    dottedLine(slot.cx, plot.top, slot.cx, plot.bottom);
    axisValue(
      slot.cx,
      plot.bottom,
      nearest.getAttribute('data-x-label') ?? '',
      'x'
    );
    // horizontal leader from nearest point to ITS y-axis + the value there:
    // a right-axis series reads off the right axis (#2240).
    const ny = parseFloat(nearest.getAttribute('cy') ?? '0');
    const side = dualAxis
      ? nearest.closest('[data-axis]')?.getAttribute('data-axis')
      : null;
    const edge = side === 'right' ? plot.right : plot.left;
    dottedLine(edge, ny, slot.cx, ny);
    axisValue(
      edge,
      ny,
      nearest.getAttribute('data-value') ?? '',
      side === 'right' ? 'y-right' : 'y'
    );
    drawSpace = space;
    if (side) {
      // Its own axis stays lit except the ticks the value would sit on; the
      // other axis fades, and the x ticks fade for the x value as before.
      for (const t of ticks)
        if (!t.hasAttribute('data-axis-side')) t.classList.add('dgmo-faded');
      lightAxis(side);
      for (const t of ticks)
        if (
          t.getAttribute('data-axis-side') === side &&
          Math.abs(parseFloat(t.getAttribute('y') ?? '0') - 4 - ny) < 14
        )
          t.classList.add('dgmo-faded');
    } else fadeTicks();
    // emphasize nearest point + its series, dim the pane's others
    const base = parseFloat(nearest.getAttribute('r') ?? '3.5');
    activePts.push({ el: nearest, r: base });
    nearest.setAttribute('r', String(base + 3));
    const ns = nearest.getAttribute('data-series-name');
    for (const g of pane.groups)
      g.classList.toggle(
        'dgmo-dim',
        pane.groups.length > 1 && g.getAttribute('data-series-name') !== ns
      );
  };

  const drawCrosshair = (hit: Pane, x: number, y: number): void => {
    if (hit.slots.length === 0) return;
    let slot = hit.slots[0]!;
    let best = Infinity;
    for (const s of hit.slots) {
      const d = Math.abs(s.cx - x);
      if (d < best) {
        best = d;
        slot = s;
      }
    }
    clearOverlay();
    restorePt();
    drawPaneCrosshair(hit, slot, y);
    for (const pane of panes) {
      if (pane === hit) continue;
      const same = pane.slots.find((s) => s.xi === slot.xi);
      if (same) drawPaneCrosshair(pane, same, y);
    }
    mirrorExtras();
  };
  const clearCrosshair = (): void => {
    clearOverlay();
    restorePt();
    for (const g of seriesGroups) g.classList.remove('dgmo-dim');
    mirrorExtras();
  };

  // ── heatmap cell hover → its row and column names (#2445) ──────────────
  // A cell carries data-row-key / data-col-key; the names are the axis labels
  // filtering on those attributes. Hovering a cell bolds both names at full
  // length — drawing a thinned (hidden) one for the moment — fades the other
  // names on each axis, and draws a faint crosshair along its row and column.
  const rowNames = axisLabels.filter(
    (l) => l.getAttribute('data-filter-attr') === 'data-row-key'
  );
  const colNames = axisLabels.filter(
    (l) => l.getAttribute('data-filter-attr') === 'data-col-key'
  );
  const cellRects = datums.filter(
    (d) =>
      d.tagName.toLowerCase() === 'rect' &&
      d.hasAttribute('data-row-key') &&
      d.hasAttribute('data-col-key')
  );
  const num = (el: Element, a: string) => parseFloat(el.getAttribute(a) ?? '0');
  let markedNames: { el: SVGElement; text: string | null; hidden: boolean }[] =
    [];
  const unmarkCell = () => {
    for (const m of markedNames) {
      m.el.classList.remove('dgmo-axis-active');
      const node = m.el.firstChild;
      if (m.text !== null && node?.nodeType === 3) node.textContent = m.text;
      if (m.hidden) m.el.setAttribute('visibility', 'hidden');
    }
    markedNames = [];
    for (const n of [...rowNames, ...colNames])
      n.classList.remove('dgmo-faded');
  };
  const markCell = (el: SVGElement) => {
    const row = el.getAttribute('data-row-key');
    const col = el.getAttribute('data-col-key');
    if (row === null || col === null || cellRects.length === 0) return;
    for (const [names, key] of [
      [rowNames, row],
      [colNames, col],
    ] as const) {
      const hit = names.find(
        (n) => n.getAttribute('data-filter-value') === key
      );
      if (!hit) continue;
      for (const n of names) if (n !== hit) n.classList.add('dgmo-faded');
      const full = hit.getAttribute('data-full-text');
      const node = hit.firstChild;
      const text =
        full !== null && node?.nodeType === 3 ? node.textContent : null;
      if (text !== null) node!.textContent = full;
      const hidden = hit.getAttribute('visibility') === 'hidden';
      if (hidden) hit.setAttribute('visibility', 'visible');
      hit.classList.add('dgmo-axis-active');
      markedNames.push({ el: hit, text, hidden });
    }
    const inRow = cellRects.find((c) => c.getAttribute('data-row-key') === row);
    const inCol = cellRects.find((c) => c.getAttribute('data-col-key') === col);
    if (!inRow || !inCol) return;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const c of cellRects) {
      x0 = Math.min(x0, num(c, 'x'));
      x1 = Math.max(x1, num(c, 'x') + num(c, 'width'));
      y0 = Math.min(y0, num(c, 'y'));
      y1 = Math.max(y1, num(c, 'y') + num(c, 'height'));
    }
    const cy = num(inRow, 'y') + num(inRow, 'height') / 2;
    const cx = num(inCol, 'x') + num(inCol, 'width') / 2;
    const prev = drawSpace;
    drawSpace = (inRow.parentNode ?? svg) as SVGGraphicsElement;
    clearOverlay();
    dottedLine(x0, cy, x1, cy);
    dottedLine(cx, y0, cx, y1);
    drawSpace = prev;
  };

  // ── element hover (projection for points w/ axis values, else emphasis) ─
  let curDatum: Element | null = null;
  const clearDatum = () => {
    clearOverlay();
    unmarkCell();
    clearDim();
    curDatum = null;
  };
  const enterDatum = (el: SVGElement) => {
    const axX = el.getAttribute('data-axval-x');
    const axY = el.getAttribute('data-axval-y');
    if (plot && (axX !== null || axY !== null)) {
      // projection mode (scatter): leaders to both axes + on-axis pills
      // A bar is a rect with no centre of its own; it bakes its anchor in
      // data-cx/data-cy (#2307).
      const cx = parseFloat(
        el.getAttribute('data-cx') ?? el.getAttribute('cx') ?? '0'
      );
      const cy = parseFloat(
        el.getAttribute('data-cy') ?? el.getAttribute('cy') ?? '0'
      );
      clearOverlay();
      if (axX !== null) {
        dottedLine(cx, cy, cx, plot.bottom);
        axisValue(cx, plot.bottom, axX, 'x');
      }
      if (axY !== null) {
        dottedLine(plot.left, cy, cx, cy);
        axisValue(plot.left, cy, axY, 'y');
      }
      const sz = el.getAttribute('data-size');
      if (sz !== null) {
        const label = el.getAttribute('data-size-label') ?? 'size';
        const vx = el.getAttribute('data-sizeval-x');
        const vy = el.getAttribute('data-sizeval-y');
        const vly = el.getAttribute('data-sizeval-ly');
        const va = el.getAttribute('data-sizeval-anchor');
        const color = el.getAttribute('data-color') ?? undefined;
        if (vx !== null && vy !== null && vly !== null) {
          pointValue(
            parseFloat(vx),
            parseFloat(vy),
            parseFloat(vly),
            label,
            sz,
            va === 'start' || va === 'end' ? va : 'middle',
            color
          );
        } else {
          const r = parseFloat(el.getAttribute('r') ?? '0');
          pointValue(cx, cy + r + 22, cy + r + 37, label, sz, 'middle', color);
        }
      }
      fadeTicks();
      dimDatumsExcept(el);
    } else {
      dimByKey(el);
      markCell(el);
      // A figure with no axis that bakes a readout position (sankey's
      // alluvial bands and nodes, #1858) prints its value block there.
      const sz = el.getAttribute('data-size');
      const vx = el.getAttribute('data-sizeval-x');
      const vy = el.getAttribute('data-sizeval-y');
      const vly = el.getAttribute('data-sizeval-ly');
      if (sz !== null && vx !== null && vy !== null && vly !== null) {
        clearOverlay();
        const va = el.getAttribute('data-sizeval-anchor');
        pointValue(
          parseFloat(vx),
          parseFloat(vy),
          parseFloat(vly),
          el.getAttribute('data-size-label') ?? '',
          sz,
          va === 'start' || va === 'end' ? va : 'middle'
        );
      }
    }
    curDatum = el;
  };

  let crosshairActive = false;
  const onSvgMove = (e: MouseEvent) => {
    const t = e.target as Element;
    if (regions.length)
      setRegion(
        regionAt(
          t,
          plot && space.getScreenCTM?.() ? toUserSpace(svg, e, space) : null
        )
      );
    let el = t.closest?.<SVGElement>('.dgmo-datum');
    // Hovering a point's name label or its leader line (scatter) highlights the
    // point itself: labels/leaders carry the same data-line-number as their
    // datum but are `.dgmo-ptlabel`, not `.dgmo-datum`, so resolve back.
    // A `.dgmo-datum-hit` strip (a box plot's whisker span, #2424) stands in
    // for its group's first datum the same way.
    if (!el) {
      const lbl = t.closest?.('.dgmo-ptlabel, .dgmo-datum-hit');
      const ln = lbl?.getAttribute('data-line-number');
      if (ln != null)
        el =
          datums.find((d) => d.getAttribute('data-line-number') === ln) ?? null;
    }
    if (el) {
      if (el !== curDatum) {
        clearDatum();
        enterDatum(el);
      }
      return;
    }
    if (curDatum) clearDatum();
    // Crosshair fires anywhere inside the plot region — over the area fill, the
    // line, or the dots, not just empty space (the whole point of the change).
    if (crosshairOn) {
      const at = paneAt(e);
      if (at) {
        drawCrosshair(at.pane, at.x, at.y);
        crosshairActive = true;
      } else if (crosshairActive) {
        clearCrosshair();
        crosshairActive = false;
      }
    }
  };
  const onLeave = () => {
    setRegion(null);
    clearDatum();
    if (crosshairActive) {
      clearCrosshair();
      crosshairActive = false;
    }
  };
  const onClick = (e: MouseEvent) => {
    const label = (e.target as Element).closest?.<SVGElement>(
      '[data-filter-attr]'
    );
    if (label && axisLabels.includes(label)) {
      const attr = label.getAttribute('data-filter-attr');
      const value = label.getAttribute('data-filter-value');
      if (attr && value != null) {
        const same = axisPin?.attr === attr && axisPin.value === value;
        setAxisPin(same ? null : { attr, value, el: label });
        return;
      }
    }
    const line = walkUpForLine(e.target as Element, svg);
    if (line !== null && opts.onNavigate) {
      opts.onNavigate(line);
      return;
    }
    if (axisPin) setAxisPin(null); // background click unpins
  };

  // ── cursor-driven highlight (editor cursor → chart element) ───────────
  let pinned: { el: SVGCircleElement; r: number }[] = [];
  const clearHighlight = () => {
    for (const p of pinned) p.el.setAttribute('r', String(p.r));
    pinned = [];
    for (const d of datums) d.classList.remove('dgmo-dim');
    for (const g of seriesGroups) g.classList.remove('dgmo-dim');
    mirrorExtras();
    reapplyAxisPin();
  };
  const highlightLine = (line: number | null) => {
    if (curDatum || crosshairActive) return; // hover wins
    clearHighlight();
    if (line == null) return;
    const ls = String(line);
    const md = datums.filter((d) => d.getAttribute('data-line-number') === ls);
    const ms = seriesGroups.filter(
      (g) => g.getAttribute('data-line-number') === ls
    );
    const mp = circles.filter((c) => c.getAttribute('data-line-number') === ls);
    if (!md.length && !ms.length && !mp.length) return;
    if (md.length)
      for (const d of datums) d.classList.toggle('dgmo-dim', !md.includes(d));
    if (ms.length)
      for (const g of seriesGroups)
        g.classList.toggle('dgmo-dim', !ms.includes(g));
    mirrorExtras();
    for (const c of mp) {
      const r = parseFloat(c.getAttribute('r') ?? '3.5');
      pinned.push({ el: c, r });
      c.setAttribute('r', String(r + 3));
    }
  };

  if (datums.length > 0 || crosshairOn || regions.length > 0)
    svg.addEventListener('mousemove', onSvgMove);
  svg.addEventListener('mouseleave', onLeave);
  svg.addEventListener('click', onClick);

  // ── legend hover → emphasize the hovered series, dim the rest ──────────
  // The injected series legend (utils/legend-svg.ts) tags each entry with
  // data-series-name matching the series groups' data-series-name. Hovering an
  // entry dims every OTHER series (group + its datums); leaving restores. Only
  // series-tagged elements are touched, so charts without series groups are
  // untouched. Dimming the g.dgmo-series fades its polygon, points, and labels.
  const emphasizeSeries = (name: string | null) => {
    for (const g of [...seriesGroups, ...seriesBands]) {
      const sn = g.getAttribute('data-series-name');
      if (sn != null)
        g.classList.toggle('dgmo-dim', name != null && sn !== name);
    }
    lightAxis(sideOfSeries(name));
    for (const d of datums) {
      const sn = d.getAttribute('data-series-name');
      if (sn != null)
        d.classList.toggle('dgmo-dim', name != null && sn !== name);
    }
    mirrorExtras();
  };
  const legendListeners: Array<[SVGGElement, string, EventListener]> = [];
  // Series charts have >1 `.dgmo-series` group — counting a line's bands, so
  // one line plus its band qualifies (#2099); category charts (scatter) have
  // none but tag individual datums with `data-series-name` instead. Either is
  // enough to emphasize a legend-hovered group.
  const datumsHaveSeries = datums.some(
    (d) => d.getAttribute('data-series-name') != null
  );
  if (
    legendEntries.length > 0 &&
    (seriesGroups.length + seriesBands.length > 1 || datumsHaveSeries)
  ) {
    for (const entry of legendEntries) {
      const name = entry.getAttribute('data-series-name');
      if (name == null) continue;
      const onEnter: EventListener = () => {
        // The pointer is on the legend (outside the plot interior), so any
        // lingering crosshair/datum hover must yield — clear it first, else a
        // stale flag from the plot→legend move would suppress the emphasis.
        clearDatum();
        if (crosshairActive) {
          clearCrosshair();
          crosshairActive = false;
        }
        emphasizeSeries(name);
      };
      const onExit: EventListener = () => emphasizeSeries(null);
      entry.addEventListener('mouseenter', onEnter);
      entry.addEventListener('mouseleave', onExit);
      legendListeners.push([entry, 'mouseenter', onEnter]);
      legendListeners.push([entry, 'mouseleave', onExit]);
    }
  }

  // ── axis-legend hover → emphasize the series on that axis ──────────────
  // Dual-axis charts (line.ts) tag each axis strip (title + ticks) with
  // data-axis-legend="left"|"right" and each series group with data-axis.
  // Hovering an axis dims every series NOT on it, so the colour-tinted axis
  // reads as a legend for its line(s). Same dim mechanism as series legends.
  const emphasizeAxis = (axis: string | null) => {
    for (const g of seriesGroups) {
      const a = g.getAttribute('data-axis');
      if (a != null) g.classList.toggle('dgmo-dim', axis != null && a !== axis);
    }
    lightAxis(axis);
    mirrorExtras();
  };
  const axisLegends = Array.from(
    svg.querySelectorAll<SVGElement>('[data-axis-legend]')
  );
  if (axisLegends.length > 0 && seriesGroups.length > 1) {
    for (const el of axisLegends) {
      const axis = el.getAttribute('data-axis-legend');
      if (axis == null) continue;
      const onEnter: EventListener = () => {
        // Axis strip is outside the plot interior — clear any lingering plot
        // hover (stale crosshair/datum from the move that landed here would
        // otherwise suppress the emphasis) before dimming the other axis.
        clearDatum();
        if (crosshairActive) {
          clearCrosshair();
          crosshairActive = false;
        }
        emphasizeAxis(axis);
      };
      const onExit: EventListener = () => emphasizeAxis(null);
      el.addEventListener('mouseenter', onEnter);
      el.addEventListener('mouseleave', onExit);
      legendListeners.push([el as SVGGElement, 'mouseenter', onEnter]);
      legendListeners.push([el as SVGGElement, 'mouseleave', onExit]);
    }
  }

  return {
    destroy: () => {
      svg.removeEventListener('mousemove', onSvgMove);
      svg.removeEventListener('mouseleave', onLeave);
      svg.removeEventListener('click', onClick);
      for (const [el, ev, fn] of legendListeners)
        el.removeEventListener(ev, fn);
      for (const [el, ev, fn] of axisLabelListeners)
        el.removeEventListener(ev, fn);
      for (const overlay of overlays.values()) overlay.remove();
      restorePt();
      setAxisPin(null);
      clearHighlight();
      clearDim();
    },
    highlight: highlightLine,
  };
}
