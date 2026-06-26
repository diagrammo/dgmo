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

const NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'dgmo-chart-interactions-style';

function ensureStyle(svg: SVGSVGElement, muted: string): void {
  const doc = svg.ownerDocument;
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElementNS(NS, 'style');
  style.id = STYLE_ID;
  style.textContent = `
    .dgmo-series,.dgmo-datum{transition:opacity .12s ease}
    .dgmo-series.dgmo-dim,.dgmo-datum.dgmo-dim{opacity:.18}
    .dgmo-datum{cursor:pointer}
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
): () => void {
  const muted = opts.mutedColor ?? '#94a3b8';
  const surface = opts.surface ?? '#ffffff';
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

  // Value pill drawn ON an axis. side 'x' → below x-axis (centered);
  // side 'y' → left of y-axis (right-aligned).
  const axisPill = (cx: number, cy: number, label: string, side: 'x' | 'y') => {
    const g = getOverlay();
    const fs = 12;
    const padX = 6;
    const padY = 3;
    const t = doc.createElementNS(NS, 'text');
    t.setAttribute('font-size', String(fs));
    t.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    t.setAttribute('fill', surface);
    t.textContent = label;
    const measured =
      typeof t.getComputedTextLength === 'function'
        ? t.getComputedTextLength()
        : 0;
    const w = (measured > 0 ? measured : label.length * fs * 0.6) + padX * 2;
    const h = fs + padY * 2;
    let rx: number;
    let ry: number;
    if (side === 'x') {
      rx = cx - w / 2;
      ry = cy + 8;
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('x', String(cx));
      t.setAttribute('y', String(ry + h / 2 + fs / 2 - 2));
    } else {
      rx = cx - w - 8;
      ry = cy - h / 2;
      t.setAttribute('text-anchor', 'end');
      t.setAttribute('x', String(rx + w - padX));
      t.setAttribute('y', String(cy + fs / 2 - 2));
    }
    const r = doc.createElementNS(NS, 'rect');
    r.setAttribute('x', String(rx));
    r.setAttribute('y', String(ry));
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(h));
    r.setAttribute('rx', '3');
    r.setAttribute('fill', text);
    g.appendChild(r);
    g.appendChild(t);
  };

  const dimDatumsExcept = (el: Element | null) => {
    for (const d of datums) d.classList.toggle('dgmo-dim', d !== el);
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
  };

  // ── crosshair (line / area) ───────────────────────────────────────────
  const crosshairOn = !!plot && circles.length > 0;
  let activePt: { el: SVGCircleElement; r: number } | null = null;
  const restorePt = () => {
    if (activePt) activePt.el.setAttribute('r', String(activePt.r));
    activePt = null;
  };
  let onPlotMove: ((e: MouseEvent) => void) | null = null;
  let onPlotLeave: (() => void) | null = null;

  if (crosshairOn && plot) {
    const byX = new Map<number, SVGCircleElement[]>();
    for (const el of circles) {
      const xi = parseInt(el.getAttribute('data-x-index') ?? '0', 10);
      (byX.get(xi) ?? byX.set(xi, []).get(xi)!).push(el);
    }
    const slots = [...byX.values()]
      .map((pts) => ({
        cx: parseFloat(pts[0]!.getAttribute('cx') ?? '0'),
        pts,
      }))
      .sort((a, b) => a.cx - b.cx);

    onPlotMove = (e: MouseEvent) => {
      const { x, y } = toUserSpace(svg, e);
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
      // vertical leader at the category x + x-axis value pill
      dottedLine(slot.cx, plot.top, slot.cx, plot.bottom);
      axisPill(
        slot.cx,
        plot.bottom,
        nearest.getAttribute('data-x-label') ?? '',
        'x'
      );
      // horizontal leader from nearest point to the y-axis + y-axis value pill
      const ny = parseFloat(nearest.getAttribute('cy') ?? '0');
      dottedLine(plot.left, ny, slot.cx, ny);
      axisPill(plot.left, ny, nearest.getAttribute('data-value') ?? '', 'y');
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
    onPlotLeave = () => {
      clearOverlay();
      restorePt();
      for (const g of seriesGroups) g.classList.remove('dgmo-dim');
    };
    plotRect!.addEventListener('mousemove', onPlotMove);
    plotRect!.addEventListener('mouseleave', onPlotLeave);
  }

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
        axisPill(cx, plot.bottom, axX, 'x');
      }
      if (axY !== null) {
        dottedLine(plot.left, cy, cx, cy);
        axisPill(plot.left, cy, axY, 'y');
      }
      dimDatumsExcept(el);
    } else {
      dimByKey(el);
    }
    curDatum = el;
  };

  const onSvgMove = (e: MouseEvent) => {
    const el = (e.target as Element).closest?.(
      '.dgmo-datum'
    ) as SVGElement | null;
    if (el) {
      if (el !== curDatum) {
        clearDatum();
        enterDatum(el);
      }
    } else if (curDatum) {
      clearDatum();
    }
  };
  const onLeave = () => {
    clearDatum();
    onPlotLeave?.();
  };
  const onClick = (e: MouseEvent) => {
    const line = walkUpForLine(e.target as Element, svg);
    if (line !== null && opts.onNavigate) opts.onNavigate(line);
  };

  if (datums.length > 0) svg.addEventListener('mousemove', onSvgMove);
  svg.addEventListener('mouseleave', onLeave);
  svg.addEventListener('click', onClick);

  return () => {
    if (onPlotMove) plotRect!.removeEventListener('mousemove', onPlotMove);
    if (onPlotLeave) plotRect!.removeEventListener('mouseleave', onPlotLeave);
    svg.removeEventListener('mousemove', onSvgMove);
    svg.removeEventListener('mouseleave', onLeave);
    svg.removeEventListener('click', onClick);
    if (overlay) overlay.remove();
    restorePt();
    clearDim();
  };
}
