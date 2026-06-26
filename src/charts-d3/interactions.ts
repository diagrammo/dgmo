// ============================================================
// Framework-agnostic interaction adapter for hand-rendered data-chart SVGs —
// SPIKE (interaction de-risk).
//
// Replaces the ECharts-instance interaction model (dispatchAction /
// convertToPixel / setOption graphic) with plain DOM events over the semantic
// SVG the D3 renderers emit. No ECharts, no d3, no framework — just an
// SVGSVGElement + the `data-*` attributes the renderer wrote. Returns a detach
// function. The app would call this from EChartsPreview's replacement instead
// of wiring useEChartsCursorHighlight + useChartCrosshair to a chart instance.
//
// Covers the two behaviors that genuinely needed the ECharts instance:
//   • series hover emphasis / dim-others
//   • crosshair: snap-to-nearest-x vertical line + value tooltip
// Click-to-source-line already works via the app's generic data-line-number
// path; this adapter also exposes it through onNavigate for standalone use.
// ============================================================

export interface DataChartInteractionOpts {
  /** Called with the source line number when a chart element is clicked. */
  onNavigate?: (line: number) => void;
  /** Crosshair / muted line color. */
  mutedColor?: string;
  /** Tooltip surface + text colors. */
  surface?: string;
  text?: string;
}

interface PtInfo {
  el: SVGCircleElement;
  cx: number;
  cy: number;
  xIndex: number;
  xLabel: string;
  value: string;
  series: string;
  color: string;
  baseR: number;
}

const STYLE_ID = 'dgmo-chart-interactions-style';

function ensureStyle(svg: SVGSVGElement, muted: string): void {
  const doc = svg.ownerDocument;
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.id = STYLE_ID;
  style.textContent = `
    .dgmo-series{transition:opacity .12s ease}
    .dgmo-series.dgmo-dim{opacity:.2}
    .dgmo-crosshair{stroke:${muted};stroke-width:1;stroke-dasharray:4 4;pointer-events:none}
  `;
  svg.insertBefore(style, svg.firstChild);
}

/** Map a pointer event to the SVG's user-space coordinates. */
function toUserSpace(svg: SVGSVGElement, e: MouseEvent): { x: number; y: number } {
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

export function attachDataChartInteractions(
  svg: SVGSVGElement,
  opts: DataChartInteractionOpts = {}
): () => void {
  const muted = opts.mutedColor ?? '#94a3b8';
  const surface = opts.surface ?? '#ffffff';
  const text = opts.text ?? '#1f2933';
  ensureStyle(svg, muted);

  const plot = svg.querySelector<SVGRectElement>('.dgmo-plot-rect');
  const seriesGroups = Array.from(
    svg.querySelectorAll<SVGGElement>('.dgmo-series')
  );
  const circles = Array.from(svg.querySelectorAll<SVGCircleElement>('.dgmo-pt'));
  if (!plot || circles.length === 0) return () => {};

  const top = parseFloat(plot.getAttribute('y') || '0');
  const bottom = top + parseFloat(plot.getAttribute('height') || '0');

  // Group points by x-index.
  const byX = new Map<number, PtInfo[]>();
  for (const el of circles) {
    const info: PtInfo = {
      el,
      cx: parseFloat(el.getAttribute('cx') || '0'),
      cy: parseFloat(el.getAttribute('cy') || '0'),
      xIndex: parseInt(el.getAttribute('data-x-index') || '0', 10),
      xLabel: el.getAttribute('data-x-label') || '',
      value: el.getAttribute('data-value') || '',
      series: el.getAttribute('data-series-name') || '',
      color: el.getAttribute('data-color') || muted,
      baseR: parseFloat(el.getAttribute('r') || '3.5'),
    };
    const arr = byX.get(info.xIndex) ?? [];
    arr.push(info);
    byX.set(info.xIndex, arr);
  }
  const slots = [...byX.entries()]
    .map(([xIndex, pts]) => ({ xIndex, cx: pts[0]!.cx, pts }))
    .sort((a, b) => a.cx - b.cx);

  // Lazily-created overlay elements.
  const NS = 'http://www.w3.org/2000/svg';
  let vline: SVGLineElement | null = null;
  const container = svg.parentElement;
  let tip: HTMLDivElement | null = null;
  if (container) {
    if (getComputedStyle(container).position === 'static')
      container.style.position = 'relative';
    tip = svg.ownerDocument.createElement('div');
    Object.assign(tip.style, {
      position: 'absolute',
      pointerEvents: 'none',
      display: 'none',
      background: surface,
      color: text,
      border: `1px solid ${muted}`,
      borderRadius: '6px',
      padding: '8px 10px',
      font: '12px Inter, system-ui, sans-serif',
      boxShadow: '0 2px 8px rgba(0,0,0,.12)',
      zIndex: '20',
      whiteSpace: 'nowrap',
    } as Partial<CSSStyleDeclaration>);
    container.appendChild(tip);
  }

  let activePts: PtInfo[] = [];
  const clearActive = () => {
    for (const p of activePts) p.el.setAttribute('r', String(p.baseR));
    activePts = [];
  };

  function show(slot: (typeof slots)[number], nearest: PtInfo, e: MouseEvent) {
    // crosshair line
    if (!vline) {
      vline = svg.ownerDocument.createElementNS(NS, 'line');
      vline.setAttribute('class', 'dgmo-crosshair');
      svg.appendChild(vline);
    }
    vline.setAttribute('x1', String(slot.cx));
    vline.setAttribute('x2', String(slot.cx));
    vline.setAttribute('y1', String(top));
    vline.setAttribute('y2', String(bottom));
    vline.style.display = '';

    // enlarge points at this x; emphasize nearest series
    clearActive();
    for (const p of slot.pts) {
      p.el.setAttribute('r', String(p.baseR + (p === nearest ? 3 : 1.5)));
      activePts.push(p);
    }
    for (const g of seriesGroups) {
      const name = g.getAttribute('data-series-name');
      g.classList.toggle('dgmo-dim', seriesGroups.length > 1 && name !== nearest.series);
    }

    // tooltip
    if (tip && container) {
      const rows = slot.pts
        .map(
          (p) =>
            `<div style="display:flex;align-items:center;gap:6px;${p === nearest ? 'font-weight:600' : ''}">` +
            `<span style="width:9px;height:9px;border-radius:50%;background:${p.color};display:inline-block"></span>` +
            `<span style="flex:1">${p.series}</span><span>${p.value}</span></div>`
        )
        .join('');
      tip.innerHTML = `<div style="font-weight:600;margin-bottom:4px">${nearest.xLabel}</div>${rows}`;
      const rect = container.getBoundingClientRect();
      let lx = e.clientX - rect.left + 14;
      let ly = e.clientY - rect.top + 14;
      tip.style.display = 'block';
      if (lx + tip.offsetWidth > rect.width) lx = e.clientX - rect.left - tip.offsetWidth - 14;
      if (ly + tip.offsetHeight > rect.height) ly = rect.height - tip.offsetHeight - 4;
      tip.style.left = `${lx}px`;
      tip.style.top = `${ly}px`;
    }
  }

  function hide() {
    if (vline) vline.style.display = 'none';
    if (tip) tip.style.display = 'none';
    clearActive();
    for (const g of seriesGroups) g.classList.remove('dgmo-dim');
  }

  const onMove = (e: MouseEvent) => {
    const { x, y } = toUserSpace(svg, e);
    // nearest x-slot by cx
    let slot = slots[0]!;
    let best = Infinity;
    for (const s of slots) {
      const d = Math.abs(s.cx - x);
      if (d < best) {
        best = d;
        slot = s;
      }
    }
    // nearest series at that slot by cy
    let nearest = slot.pts[0]!;
    let bestY = Infinity;
    for (const p of slot.pts) {
      const d = Math.abs(p.cy - y);
      if (d < bestY) {
        bestY = d;
        nearest = p;
      }
    }
    show(slot, nearest, e);
  };

  const onClick = (e: MouseEvent) => {
    const line = walkUpForLine(e.target as Element, svg);
    if (line !== null && opts.onNavigate) opts.onNavigate(line);
  };

  plot.addEventListener('mousemove', onMove);
  plot.addEventListener('mouseleave', hide);
  svg.addEventListener('click', onClick);

  return () => {
    plot.removeEventListener('mousemove', onMove);
    plot.removeEventListener('mouseleave', hide);
    svg.removeEventListener('click', onClick);
    if (vline) vline.remove();
    if (tip) tip.remove();
    hide();
  };
}
