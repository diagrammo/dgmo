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
//   • projection  — points carrying `data-axval-x`/`data-axval-y` (scatter):
//     dotted leaders to BOTH axes + on-axis value pills.
//   • emphasis    — any other `.dgmo-datum`: emphasize + dim siblings.
// Plus universal click-to-source via `data-line-number`.
// ============================================================

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
    .dgmo-series,.dgmo-datum,.dgmo-tick,.dgmo-ptlabel{transition:opacity .12s ease}
    .dgmo-series.dgmo-dim,.dgmo-datum.dgmo-dim,.dgmo-ptlabel.dgmo-dim{opacity:.18}
    .dgmo-tick.dgmo-faded{opacity:.22}
    .dgmo-datum{cursor:pointer}
    .dgmo-axis-label{cursor:pointer}
    .dgmo-axis-label.dgmo-axis-active{font-weight:700}
    .dgmo-axline{stroke:${muted};stroke-width:1;stroke-dasharray:4 4;pointer-events:none}
  `;
  svg.insertBefore(style, svg.firstChild);
}

function toUserSpace(
  svg: SVGSVGElement,
  e: MouseEvent
): { x: number; y: number } {
  const ctm = svg.getScreenCTM?.();
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

  const plotRect = svg.querySelector<SVGRectElement>('.dgmo-plot-rect');
  const plot: Plot | null = plotRect
    ? {
        left: parseFloat(plotRect.getAttribute('x') ?? '0'),
        top: parseFloat(plotRect.getAttribute('y') ?? '0'),
        right:
          parseFloat(plotRect.getAttribute('x') ?? '0') +
          parseFloat(plotRect.getAttribute('width') ?? '0'),
        bottom:
          parseFloat(plotRect.getAttribute('y') ?? '0') +
          parseFloat(plotRect.getAttribute('height') ?? '0'),
      }
    : null;

  const seriesGroups = Array.from(
    svg.querySelectorAll<SVGGElement>('.dgmo-series')
  );
  const datums = Array.from(svg.querySelectorAll<SVGElement>('.dgmo-datum'));
  const circles = Array.from(
    svg.querySelectorAll<SVGCircleElement>('.dgmo-pt')
  );
  const ticks = Array.from(svg.querySelectorAll<SVGTextElement>('.dgmo-tick'));
  const fadeTicks = () => ticks.forEach((t) => t.classList.add('dgmo-faded'));
  const unfadeTicks = () =>
    ticks.forEach((t) => t.classList.remove('dgmo-faded'));

  // ── transient overlay (leader lines + on-axis value pills) ────────────
  let overlay: SVGGElement | null = null;
  const getOverlay = (): SVGGElement => {
    if (!overlay) {
      overlay = doc.createElementNS(NS, 'g');
      overlay.setAttribute('class', 'dgmo-overlay');
      overlay.setAttribute('pointer-events', 'none');
    }
    svg.appendChild(overlay); // keep on top
    return overlay;
  };
  const clearOverlay = () => {
    if (overlay)
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
  // the y-axis (right-aligned, at the y-tick column).
  const axisValue = (
    cx: number,
    cy: number,
    label: string,
    side: 'x' | 'y'
  ) => {
    const t = doc.createElementNS(NS, 'text');
    t.setAttribute('font-size', '15');
    t.setAttribute('font-weight', '700');
    t.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    t.setAttribute('fill', text);
    t.textContent = label;
    if (side === 'x') {
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('x', String(cx));
      t.setAttribute('y', String(cy + 19));
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
  const dimDatumsExcept = (el: Element | null) => {
    for (const d of datums) d.classList.toggle('dgmo-dim', d !== el);
    const line = el?.getAttribute('data-line-number');
    for (const l of ptLabels)
      l.classList.toggle(
        'dgmo-dim',
        line == null || l.getAttribute('data-line-number') !== line
      );
  };
  const dimByKey = (el: SVGElement) => {
    const key = el.getAttribute('data-emph-key');
    for (const d of datums) {
      const dk = d.getAttribute('data-emph-key');
      if (key) d.classList.toggle('dgmo-dim', dk !== key);
      else d.classList.toggle('dgmo-dim', d !== el);
    }
  };
  const clearDim = () => {
    for (const d of datums) d.classList.remove('dgmo-dim');
    for (const g of seriesGroups) g.classList.remove('dgmo-dim');
    for (const l of ptLabels) l.classList.remove('dgmo-dim');
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
  const crosshairOn = !!plot && circles.length > 0;
  let activePt: { el: SVGCircleElement; r: number } | null = null;
  const restorePt = () => {
    if (activePt) activePt.el.setAttribute('r', String(activePt.r));
    activePt = null;
  };
  let slots: { cx: number; pts: SVGCircleElement[] }[] = [];
  if (crosshairOn) {
    const byX = new Map<number, SVGCircleElement[]>();
    for (const el of circles) {
      const xi = parseInt(el.getAttribute('data-x-index') ?? '0', 10);
      (byX.get(xi) ?? byX.set(xi, []).get(xi)!).push(el);
    }
    slots = [...byX.values()]
      .map((pts) => ({
        cx: parseFloat(pts[0]!.getAttribute('cx') ?? '0'),
        pts,
      }))
      .sort((a, b) => a.cx - b.cx);
  }

  const drawCrosshair = (x: number, y: number): void => {
    if (!plot || slots.length === 0) return;
    let slot = slots[0]!;
    let best = Infinity;
    for (const s of slots) {
      const d = Math.abs(s.cx - x);
      if (d < best) {
        best = d;
        slot = s;
      }
    }
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
    clearOverlay();
    // vertical leader at the category x + x-axis value
    dottedLine(slot.cx, plot.top, slot.cx, plot.bottom);
    axisValue(
      slot.cx,
      plot.bottom,
      nearest.getAttribute('data-x-label') ?? '',
      'x'
    );
    // horizontal leader from nearest point to the y-axis + y-axis value
    const ny = parseFloat(nearest.getAttribute('cy') ?? '0');
    dottedLine(plot.left, ny, slot.cx, ny);
    axisValue(plot.left, ny, nearest.getAttribute('data-value') ?? '', 'y');
    fadeTicks();
    // emphasize nearest point + its series, dim the others
    restorePt();
    const base = parseFloat(nearest.getAttribute('r') ?? '3.5');
    activePt = { el: nearest, r: base };
    nearest.setAttribute('r', String(base + 3));
    const ns = nearest.getAttribute('data-series-name');
    for (const g of seriesGroups)
      g.classList.toggle(
        'dgmo-dim',
        seriesGroups.length > 1 && g.getAttribute('data-series-name') !== ns
      );
  };
  const clearCrosshair = (): void => {
    clearOverlay();
    restorePt();
    for (const g of seriesGroups) g.classList.remove('dgmo-dim');
  };

  // ── element hover (projection for points w/ axis values, else emphasis) ─
  let curDatum: Element | null = null;
  const clearDatum = () => {
    clearOverlay();
    clearDim();
    curDatum = null;
  };
  const enterDatum = (el: SVGElement) => {
    const axX = el.getAttribute('data-axval-x');
    const axY = el.getAttribute('data-axval-y');
    if (plot && (axX !== null || axY !== null)) {
      // projection mode (scatter): leaders to both axes + on-axis pills
      const cx = parseFloat(el.getAttribute('cx') ?? '0');
      const cy = parseFloat(el.getAttribute('cy') ?? '0');
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
    }
    curDatum = el;
  };

  let crosshairActive = false;
  const onSvgMove = (e: MouseEvent) => {
    const el = (e.target as Element).closest?.(
      '.dgmo-datum'
    ) as SVGElement | null;
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
    if (crosshairOn && plot) {
      const ctm = svg.getScreenCTM?.();
      const { x, y } = toUserSpace(svg, e);
      const inside =
        !ctm ||
        (x >= plot.left - 2 &&
          x <= plot.right + 2 &&
          y >= plot.top - 2 &&
          y <= plot.bottom + 2);
      if (inside) {
        drawCrosshair(x, y);
        crosshairActive = true;
      } else if (crosshairActive) {
        clearCrosshair();
        crosshairActive = false;
      }
    }
  };
  const onLeave = () => {
    clearDatum();
    if (crosshairActive) {
      clearCrosshair();
      crosshairActive = false;
    }
  };
  const onClick = (e: MouseEvent) => {
    const label = (e.target as Element).closest?.(
      '[data-filter-attr]'
    ) as SVGElement | null;
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
    for (const c of mp) {
      const r = parseFloat(c.getAttribute('r') ?? '3.5');
      pinned.push({ el: c, r });
      c.setAttribute('r', String(r + 3));
    }
  };

  if (datums.length > 0 || crosshairOn)
    svg.addEventListener('mousemove', onSvgMove);
  svg.addEventListener('mouseleave', onLeave);
  svg.addEventListener('click', onClick);

  // ── legend hover → emphasize the hovered series, dim the rest ──────────
  // The injected series legend (utils/legend-svg.ts) tags each entry with
  // data-series-name matching the series groups' data-series-name. Hovering an
  // entry dims every OTHER series (group + its datums); leaving restores. Only
  // series-tagged elements are touched, so charts without series groups are
  // untouched. Dimming the g.dgmo-series fades its polygon, points, and labels.
  const legendEntries = Array.from(
    svg.querySelectorAll<SVGGElement>('.chart-legend [data-legend-entry]')
  );
  const emphasizeSeries = (name: string | null) => {
    for (const g of seriesGroups) {
      const sn = g.getAttribute('data-series-name');
      if (sn != null)
        g.classList.toggle('dgmo-dim', name != null && sn !== name);
    }
    for (const d of datums) {
      const sn = d.getAttribute('data-series-name');
      if (sn != null)
        d.classList.toggle('dgmo-dim', name != null && sn !== name);
    }
  };
  const legendListeners: Array<[SVGGElement, string, EventListener]> = [];
  // Series charts have >1 `.dgmo-series` group; category charts (scatter) have
  // none but tag individual datums with `data-series-name` instead. Either is
  // enough to emphasize a legend-hovered group.
  const datumsHaveSeries = datums.some(
    (d) => d.getAttribute('data-series-name') != null
  );
  if (
    legendEntries.length > 0 &&
    (seriesGroups.length > 1 || datumsHaveSeries)
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
      if (overlay) overlay.remove();
      restorePt();
      setAxisPin(null);
      clearHighlight();
      clearDim();
    },
    highlight: highlightLine,
  };
}
