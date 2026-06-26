// ============================================================
// Framework-agnostic interaction adapter for hand-rendered data-chart SVGs —
// SPIKE (interaction de-risk, generalized across all chart families).
//
// Replaces the ECharts-instance interaction model (dispatchAction /
// convertToPixel / setOption graphic) with plain DOM events over the semantic
// SVG the D3 renderers emit. No ECharts, no d3, no framework — just an
// SVGSVGElement + the `data-*` attributes the renderers wrote via tagDatum().
// Returns a detach function.
//
// Two universal modes, auto-detected from the markup present:
//   • element-hover  — any `.dgmo-datum` (bars, slices, cells, nodes, links,
//     points, paths): hover → emphasize same `data-emph-key`, dim others,
//     show a name/value tooltip. (pie/bar/heatmap/sankey/chord/funnel/…)
//   • crosshair      — cartesian charts that emit `.dgmo-plot-rect` + `.dgmo-pt`
//     (line/area): snap a vertical line to the nearest x, show every series'
//     value. (supersedes per-point hover there)
// Plus universal click-to-source via `data-line-number` (the same mechanism
// the app's generic diagram interactivity already uses).
// ============================================================

export interface DataChartInteractionOpts {
  onNavigate?: (line: number) => void;
  mutedColor?: string;
  surface?: string;
  text?: string;
}

const STYLE_ID = 'dgmo-chart-interactions-style';
const NS = 'http://www.w3.org/2000/svg';

function ensureStyle(svg: SVGSVGElement, muted: string): void {
  const doc = svg.ownerDocument;
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElementNS(NS, 'style');
  style.id = STYLE_ID;
  style.textContent = `
    .dgmo-series,.dgmo-datum{transition:opacity .12s ease}
    .dgmo-series.dgmo-dim,.dgmo-datum.dgmo-dim{opacity:.2}
    .dgmo-datum{cursor:pointer}
    .dgmo-crosshair{stroke:${muted};stroke-width:1;stroke-dasharray:4 4;pointer-events:none}
  `;
  svg.insertBefore(style, svg.firstChild);
}

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

  const container = svg.parentElement;
  if (container && getComputedStyle(container).position === 'static')
    container.style.position = 'relative';

  // ── shared tooltip ────────────────────────────────────────
  let tip: HTMLDivElement | null = null;
  if (container) {
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
  const showTip = (html: string, e: MouseEvent) => {
    if (!tip || !container) return;
    tip.innerHTML = html;
    tip.style.display = 'block';
    const rect = container.getBoundingClientRect();
    let lx = e.clientX - rect.left + 14;
    let ly = e.clientY - rect.top + 14;
    if (lx + tip.offsetWidth > rect.width) lx = e.clientX - rect.left - tip.offsetWidth - 14;
    if (ly + tip.offsetHeight > rect.height) ly = rect.height - tip.offsetHeight - 4;
    tip.style.left = `${lx}px`;
    tip.style.top = `${ly}px`;
  };
  const hideTip = () => {
    if (tip) tip.style.display = 'none';
  };
  const swatch = (c: string) =>
    `<span style="width:9px;height:9px;border-radius:50%;background:${c};display:inline-block;margin-right:6px"></span>`;

  // ── element-hover mode (universal) ────────────────────────
  const datums = Array.from(svg.querySelectorAll<SVGElement>('.dgmo-datum'));
  let curDatum: Element | null = null;
  const clearDatum = () => {
    for (const d of datums) d.classList.remove('dgmo-emph', 'dgmo-dim');
    curDatum = null;
    hideTip();
  };
  const enterDatum = (el: SVGElement) => {
    const key = el.getAttribute('data-emph-key');
    for (const d of datums) {
      const dk = d.getAttribute('data-emph-key');
      if (key) {
        d.classList.toggle('dgmo-emph', dk === key);
        d.classList.toggle('dgmo-dim', dk !== null && dk !== key);
      } else {
        d.classList.toggle('dgmo-emph', d === el);
      }
    }
    curDatum = el;
  };
  const datumTip = (el: SVGElement): string => {
    const name = el.getAttribute('data-name') ?? '';
    const value = el.getAttribute('data-value');
    const color = el.getAttribute('data-color') ?? muted;
    return (
      `<div style="display:flex;align-items:center">${swatch(color)}<b>${name}</b></div>` +
      (value ? `<div style="margin-top:2px">${value}</div>` : '')
    );
  };

  // ── crosshair mode (cartesian: line/area) ─────────────────
  const plot = svg.querySelector<SVGRectElement>('.dgmo-plot-rect');
  const circles = Array.from(svg.querySelectorAll<SVGCircleElement>('.dgmo-pt'));
  const seriesGroups = Array.from(svg.querySelectorAll<SVGGElement>('.dgmo-series'));
  const crosshairOn = !!plot && circles.length > 0;

  let vline: SVGLineElement | null = null;
  let activePts: { el: SVGCircleElement; r: number }[] = [];
  let onPlotMove: ((e: MouseEvent) => void) | null = null;
  let onPlotLeave: (() => void) | null = null;

  if (crosshairOn) {
    const top = parseFloat(plot!.getAttribute('y') || '0');
    const bottom = top + parseFloat(plot!.getAttribute('height') || '0');
    const byX = new Map<number, SVGCircleElement[]>();
    for (const el of circles) {
      const xi = parseInt(el.getAttribute('data-x-index') || '0', 10);
      (byX.get(xi) ?? byX.set(xi, []).get(xi)!).push(el);
    }
    const slots = [...byX.entries()]
      .map(([, pts]) => ({ cx: parseFloat(pts[0]!.getAttribute('cx') || '0'), pts }))
      .sort((a, b) => a.cx - b.cx);

    const clearActive = () => {
      for (const p of activePts) p.el.setAttribute('r', String(p.r));
      activePts = [];
    };
    onPlotMove = (e: MouseEvent) => {
      const { x, y } = toUserSpace(svg, e);
      let slot = slots[0]!;
      let best = Infinity;
      for (const s of slots) {
        const d = Math.abs(s.cx - x);
        if (d < best) { best = d; slot = s; }
      }
      let nearest = slot.pts[0]!;
      let bestY = Infinity;
      for (const p of slot.pts) {
        const cy = parseFloat(p.getAttribute('cy') || '0');
        const d = Math.abs(cy - y);
        if (d < bestY) { bestY = d; nearest = p; }
      }
      const nearSeries = nearest.getAttribute('data-series-name');
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
      clearActive();
      for (const p of slot.pts) {
        const base = parseFloat(p.getAttribute('r') || '3.5');
        activePts.push({ el: p, r: base });
        p.setAttribute('r', String(base + (p === nearest ? 3 : 1.5)));
      }
      for (const g of seriesGroups)
        g.classList.toggle('dgmo-dim', seriesGroups.length > 1 && g.getAttribute('data-series-name') !== nearSeries);
      const rows = slot.pts
        .map((p) => {
          const nm = p.getAttribute('data-series-name') ?? '';
          const c = p.getAttribute('data-color') ?? muted;
          const v = p.getAttribute('data-value') ?? '';
          return `<div style="display:flex;align-items:center;${p === nearest ? 'font-weight:600' : ''}">${swatch(c)}<span style="flex:1">${nm}</span><span style="margin-left:10px">${v}</span></div>`;
        })
        .join('');
      showTip(`<div style="font-weight:600;margin-bottom:4px">${nearest.getAttribute('data-x-label') ?? ''}</div>${rows}`, e);
    };
    onPlotLeave = () => {
      if (vline) vline.style.display = 'none';
      clearActive();
      for (const g of seriesGroups) g.classList.remove('dgmo-dim');
      hideTip();
    };
    plot!.addEventListener('mousemove', onPlotMove);
    plot!.addEventListener('mouseleave', onPlotLeave);
  }

  // ── universal listeners ───────────────────────────────────
  const onSvgMove = (e: MouseEvent) => {
    const el = (e.target as Element).closest?.('.dgmo-datum') as SVGElement | null;
    if (el) {
      if (el !== curDatum) {
        clearDatum();
        enterDatum(el);
      }
      showTip(datumTip(el), e);
    } else if (curDatum) {
      clearDatum();
    }
  };
  const onLeave = () => clearDatum();
  const onClick = (e: MouseEvent) => {
    const line = walkUpForLine(e.target as Element, svg);
    if (line !== null && opts.onNavigate) opts.onNavigate(line);
  };
  if (datums.length > 0) svg.addEventListener('mousemove', onSvgMove);
  svg.addEventListener('mouseleave', onLeave);
  svg.addEventListener('click', onClick);

  return () => {
    if (onPlotMove) plot!.removeEventListener('mousemove', onPlotMove);
    if (onPlotLeave) plot!.removeEventListener('mouseleave', onPlotLeave);
    svg.removeEventListener('mousemove', onSvgMove);
    svg.removeEventListener('mouseleave', onLeave);
    svg.removeEventListener('click', onClick);
    if (vline) vline.remove();
    if (tip) tip.remove();
  };
}
