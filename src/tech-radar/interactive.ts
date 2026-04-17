import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { mix } from '../palettes/color-utils';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type {
  ParsedTechRadar,
  QuadrantPosition,
  TechRadarRenderOptions,
} from './types';
import { getQuadrantArc } from './layout';
import {
  resolveQuadrantColor,
  renderTrendIndicator,
  createTooltip,
  showTooltip,
  hideTooltip,
  DIM_OPACITY,
} from './shared';

// ============================================================
// Constants
// ============================================================

const BLIP_RADIUS = 11;
const BLIP_FONT_SIZE = 9;
const TITLE_FONT_SIZE = 16;
const PANEL_RING_FONT_SIZE = 13;
const PANEL_BLIP_FONT_SIZE = 12;
const PANEL_DESC_FONT_SIZE = 11;
const NARROW_BREAKPOINT = 600;

// ============================================================
// SVG Init
// ============================================================

function initSvg(
  container: HTMLDivElement,
  palette: PaletteColors,
  exportDims?: D3ExportDimensions
): {
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>;
  width: number;
  height: number;
  textColor: string;
  mutedColor: string;
  bgColor: string;
} | null {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return null;
  return {
    svg: d3Selection
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('background', palette.bg),
    width,
    height,
    textColor: palette.text,
    mutedColor: palette.border,
    bgColor: palette.bg,
  };
}

// ============================================================
// Quadrant Focus Renderer
// ============================================================

export function renderQuadrantFocus(
  container: HTMLDivElement,
  parsed: ParsedTechRadar,
  quadrantPosition: QuadrantPosition,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions,
  _options?: TechRadarRenderOptions
): void {
  const quadrant = parsed.quadrants.find(
    (q) => q.position === quadrantPosition
  );
  if (!quadrant) return;

  const init = initSvg(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, mutedColor } = init;

  const isNarrow = width < NARROW_BREAKPOINT;
  const qColor = resolveQuadrantColor(
    quadrant.position,
    quadrant.color,
    palette
  );

  // ── Layout: radar slice (left/top) + side panel (right/bottom) ──
  const radarWidth = isNarrow ? width : width * 0.55;
  const radarHeight = isNarrow ? height * 0.4 : height - 40;
  const panelX = isNarrow ? 0 : radarWidth;
  const panelY = isNarrow ? radarHeight + 8 : 40;
  const panelWidth = isNarrow ? width : width - radarWidth;

  // ── Breadcrumb title ──
  const titleY = 24;
  const titleGroup = svg.append('g');

  // Chart title (clickable, navigates back) — data-line-number on <g> wrapper
  const titleClickGroup = titleGroup
    .append('g')
    .attr('data-line-number', parsed.titleLineNumber)
    .style('cursor', onClickItem ? 'pointer' : 'default');

  titleClickGroup
    .append('text')
    .attr('x', 12)
    .attr('y', titleY)
    .attr('fill', textColor)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', TITLE_FONT_SIZE)
    .attr('font-weight', 'bold')
    .text(parsed.title || 'Tech Radar');

  if (onClickItem) {
    titleClickGroup.on('click', () => onClickItem(parsed.titleLineNumber));
  }

  // Breadcrumb separator + quadrant name
  const titleTextNode = titleClickGroup.select('text').node() as SVGTextElement;
  const titleBBox = titleTextNode?.getBBox?.();
  const sepX = titleBBox ? 12 + titleBBox.width + 8 : 120;

  titleGroup
    .append('text')
    .attr('x', sepX)
    .attr('y', titleY)
    .attr('fill', mutedColor)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', TITLE_FONT_SIZE)
    .text('>');

  titleGroup
    .append('text')
    .attr('x', sepX + 16)
    .attr('y', titleY)
    .attr('fill', qColor)
    .attr('font-family', FONT_FAMILY)
    .attr('font-size', TITLE_FONT_SIZE)
    .attr('font-weight', 'bold')
    .text(quadrant.name);

  // ── Quarter-circle radar slice ──
  const sliceGroup = svg
    .append('g')
    .attr('transform', `translate(0, ${isNarrow ? 32 : 40})`);

  const tooltip = createTooltip(container, palette, isDark);

  renderQuarterCircle(
    sliceGroup,
    svg,
    parsed,
    quadrant,
    qColor,
    palette,
    isDark,
    radarWidth,
    radarHeight - (isNarrow ? 32 : 0),
    textColor,
    mutedColor,
    tooltip,
    onClickItem
  );

  // ── Side panel (blip listing with ring headers) ──
  renderSidePanel(
    svg,
    parsed,
    quadrant,
    qColor,
    palette,
    isDark,
    textColor,
    mutedColor,
    panelX,
    panelY,
    panelWidth,
    onClickItem
  );
}

// ============================================================
// Quarter-Circle Rendering
// ============================================================

function renderQuarterCircle(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  parsed: ParsedTechRadar,
  quadrant: ParsedTechRadar['quadrants'][number],
  qColor: string,
  palette: PaletteColors,
  isDark: boolean,
  width: number,
  height: number,
  textColor: string,
  mutedColor: string,
  tooltip: HTMLDivElement,
  onClickItem?: (lineNumber: number) => void
): void {
  const padding = 16;
  const size = Math.min(width - padding * 2, height - padding * 2);
  const maxRadius = size * 0.85;
  const ringCount = parsed.rings.length;
  const ringBandWidth = maxRadius / ringCount;

  // Position center at the corner opposite to the quadrant
  const { startAngle, endAngle } = getQuadrantArc(quadrant.position);
  let cx: number, cy: number;

  switch (quadrant.position) {
    case 'top-right':
      cx = padding;
      cy = size + padding;
      break;
    case 'top-left':
      cx = width - padding;
      cy = size + padding;
      break;
    case 'bottom-left':
      cx = width - padding;
      cy = padding;
      break;
    case 'bottom-right':
      cx = padding;
      cy = padding;
      break;
  }

  // Ring arcs with zebra shading
  const arcGen = (innerR: number, outerR: number) =>
    `M${cx + outerR * Math.cos(startAngle)},${cy - outerR * Math.sin(startAngle)} A${outerR},${outerR} 0 0,0 ${cx + outerR * Math.cos(endAngle)},${cy - outerR * Math.sin(endAngle)} L${cx + innerR * Math.cos(endAngle)},${cy - innerR * Math.sin(endAngle)} A${innerR},${innerR} 0 0,1 ${cx + innerR * Math.cos(startAngle)},${cy - innerR * Math.sin(startAngle)} Z`;

  for (let ri = parsed.rings.length - 1; ri >= 0; ri--) {
    const innerR = ri * ringBandWidth;
    const outerR = (ri + 1) * ringBandWidth;
    const fillColor =
      ri % 2 === 0 ? palette.bg : mix(palette.bg, palette.border, 0.15);

    g.append('path')
      .attr('d', arcGen(innerR, outerR))
      .attr('fill', fillColor)
      .attr('stroke', mutedColor)
      .attr('stroke-width', 0.5);
  }

  // Ring labels — large watermark text centered in each ring arc
  const bisectAngle = (startAngle + endAngle) / 2;
  for (let ri = 0; ri < parsed.rings.length; ri++) {
    const rLabel = (ri + 0.5) * ringBandWidth;
    const labelX = cx + rLabel * Math.cos(bisectAngle);
    const labelY = cy - rLabel * Math.sin(bisectAngle);
    // Scale font based on ring band width, larger in outer rings
    const fontSize = Math.min(16, Math.max(11, ringBandWidth * 0.18));

    g.append('text')
      .attr('x', labelX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', palette.textMuted)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', fontSize)
      .attr('font-weight', '700')
      .attr('opacity', 0.6)
      .text(parsed.rings[ri].name);
  }

  // Blip dots
  const ringOrder = parsed.rings.map((r) => r.name);
  const angularPadding = 0.08;
  const radialPadding = ringBandWidth * 0.12;
  const usableArcStart = startAngle + angularPadding;
  const usableArcEnd = endAngle - angularPadding;
  const arcSpan = usableArcEnd - usableArcStart;

  const blipsByRing = new Map<string, typeof quadrant.blips>();
  for (const blip of quadrant.blips) {
    const list = blipsByRing.get(blip.ring) ?? [];
    list.push(blip);
    blipsByRing.set(blip.ring, list);
  }

  for (const [ringName, blips] of blipsByRing) {
    const ringIndex = ringOrder.indexOf(ringName);
    if (ringIndex < 0) continue;
    const rInner = ringIndex * ringBandWidth + radialPadding;
    const rOuter = (ringIndex + 1) * ringBandWidth - radialPadding;
    const rMid = (rInner + rOuter) / 2;

    for (let bi = 0; bi < blips.length; bi++) {
      const blip = blips[bi];
      const angle =
        blips.length === 1
          ? (usableArcStart + usableArcEnd) / 2
          : usableArcStart + ((bi + 0.5) / blips.length) * arcSpan;

      const radius =
        blips.length <= 3
          ? rMid
          : rInner +
            BLIP_RADIUS +
            ((bi % 3) / 2) * (rOuter - rInner - BLIP_RADIUS * 2);

      const bx = cx + radius * Math.cos(angle);
      const by = cy - radius * Math.sin(angle);

      const blipGroup = g
        .append('g')
        .attr('data-line-number', blip.lineNumber)
        .attr('data-ring', blip.ring)
        .attr('data-trend', blip.trend ?? 'stable')
        .style('cursor', onClickItem ? 'pointer' : 'default');

      const angleToCenter = Math.atan2(cy - by, cx - bx);
      renderTrendIndicator(
        blipGroup,
        blip.trend,
        qColor,
        bx,
        by,
        BLIP_RADIUS,
        angleToCenter
      );

      blipGroup
        .append('text')
        .attr('x', bx)
        .attr('y', by + 3)
        .attr('text-anchor', 'middle')
        .attr('fill', isDark ? '#000' : '#fff')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', BLIP_FONT_SIZE)
        .attr('font-weight', 'bold')
        .text(blip.globalNumber);

      // Tooltip + cross-highlight with side panel + scale-up
      const lineNum = String(blip.lineNumber);
      blipGroup
        .on('mouseenter', (event: MouseEvent) => {
          showTooltip(tooltip, blip.name, event);
          blipGroup.attr(
            'transform',
            `translate(${bx},${by}) scale(1.5) translate(${-bx},${-by})`
          );
          svg
            .selectAll<SVGElement, unknown>('[data-line-number]')
            .style('opacity', function () {
              return this.getAttribute('data-line-number') === lineNum
                ? '1'
                : String(DIM_OPACITY);
            });
        })
        .on('mousemove', (event: MouseEvent) => {
          showTooltip(tooltip, blip.name, event);
        })
        .on('mouseleave', () => {
          hideTooltip(tooltip);
          blipGroup.attr('transform', null);
          svg
            .selectAll<SVGElement, unknown>('[data-line-number]')
            .style('opacity', '1');
        });

      if (onClickItem) {
        blipGroup.on('click', () => onClickItem(blip.lineNumber));
      }
    }
  }
}

// ============================================================
// Side Panel (ring-grouped blip listing)
// ============================================================

function renderSidePanel(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  parsed: ParsedTechRadar,
  quadrant: ParsedTechRadar['quadrants'][number],
  qColor: string,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  panelX: number,
  panelY: number,
  panelWidth: number,
  onClickItem?: (lineNumber: number) => void
): void {
  const panelGroup = svg
    .append('g')
    .attr('transform', `translate(${panelX}, ${panelY})`);

  const ringOrder = parsed.rings.map((r) => r.name);
  let y = 0;
  const ringHeaderGap = 20; // space below ring header text before first node
  const ringGroupGap = 16; // space between ring groups
  const nodeGap = 6; // space between nodes within a ring
  const descLineH = 16;
  const indent = 8;

  for (const ringName of ringOrder) {
    const blips = quadrant.blips.filter((b) => b.ring === ringName);
    if (blips.length === 0) continue;

    // Ring header
    y += PANEL_RING_FONT_SIZE + 4;
    panelGroup
      .append('text')
      .attr('x', 8)
      .attr('y', y)
      .attr('fill', palette.textMuted)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', PANEL_RING_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(ringName);
    y += ringHeaderGap;

    // Blips under this ring — rectangular nodes with optional description section
    const titleRowH = 28;
    const nodePadX = 10;
    const descPadTop = 6;
    const descPadBottom = 6;
    for (const blip of blips) {
      const nodeWidth = Math.min(panelWidth - indent - 16, 320);
      const hasDesc = blip.description.length > 0;
      const descHeight = hasDesc
        ? descPadTop + blip.description.length * descLineH + descPadBottom
        : 0;
      const totalNodeH = titleRowH + descHeight;
      const nodeTop = y;

      const nodeGroup = panelGroup
        .append('g')
        .attr('data-line-number', blip.lineNumber)
        .attr('data-ring', blip.ring)
        .attr('data-trend', blip.trend ?? 'stable')
        .style('cursor', onClickItem ? 'pointer' : 'default');

      // Rectangle background
      nodeGroup
        .append('rect')
        .attr('x', indent)
        .attr('y', nodeTop)
        .attr('width', nodeWidth)
        .attr('height', totalNodeH)
        .attr('rx', 4)
        .attr('fill', mix(qColor, isDark ? palette.surface : palette.bg, 30))
        .attr('stroke', qColor)
        .attr('stroke-width', 1.5);

      // Mini circle indicator with number
      const circleR = 8;
      const circleCx = indent + nodePadX + circleR;
      const circleCy = nodeTop + titleRowH / 2;
      const indicatorG = nodeGroup.append('g') as d3Selection.Selection<
        SVGGElement,
        unknown,
        null,
        undefined
      >;
      renderTrendIndicator(
        indicatorG,
        blip.trend,
        qColor,
        circleCx,
        circleCy,
        circleR,
        -Math.PI / 2
      );
      nodeGroup
        .append('text')
        .attr('x', circleCx)
        .attr('y', circleCy + 3)
        .attr('text-anchor', 'middle')
        .attr('fill', isDark ? '#000' : '#fff')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', 7)
        .attr('font-weight', 'bold')
        .text(blip.globalNumber);

      // Blip name
      nodeGroup
        .append('text')
        .attr('x', circleCx + circleR + 8)
        .attr('y', nodeTop + titleRowH / 2 + 4)
        .attr('fill', textColor)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', PANEL_BLIP_FONT_SIZE)
        .text(blip.name);

      // Description section (below separator line)
      if (hasDesc) {
        const sepY = nodeTop + titleRowH;

        // Thin separator line
        nodeGroup
          .append('line')
          .attr('x1', indent + 6)
          .attr('y1', sepY)
          .attr('x2', indent + nodeWidth - 6)
          .attr('y2', sepY)
          .attr('stroke', qColor)
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1);

        // Description text lines
        let descY = sepY + descPadTop + descLineH - 4;
        for (const descLine of blip.description) {
          nodeGroup
            .append('text')
            .attr('x', indent + nodePadX)
            .attr('y', descY)
            .attr('fill', palette.textMuted)
            .attr('font-family', FONT_FAMILY)
            .attr('font-size', PANEL_DESC_FONT_SIZE)
            .text(descLine);
          descY += descLineH;
        }
      }

      // Cross-highlight: hover side panel blip → highlight dot on radar + scale up
      const ln = String(blip.lineNumber);
      nodeGroup
        .on('mouseenter', () => {
          svg
            .selectAll<SVGElement, unknown>('[data-line-number]')
            .style('opacity', function () {
              const isMatch = this.getAttribute('data-line-number') === ln;
              if (
                isMatch &&
                this.closest('g[transform]') &&
                !this.closest('[data-line-number]')?.closest(
                  `g[transform^="translate(${panelX}"]`
                )
              ) {
                const bbox = (this as SVGGraphicsElement).getBBox?.();
                if (bbox) {
                  const bx = bbox.x + bbox.width / 2;
                  const by = bbox.y + bbox.height / 2;
                  this.setAttribute(
                    'transform',
                    `translate(${bx},${by}) scale(1.5) translate(${-bx},${-by})`
                  );
                }
              }
              return isMatch ? '1' : String(DIM_OPACITY);
            });
        })
        .on('mouseleave', () => {
          svg
            .selectAll<SVGElement, unknown>('[data-line-number]')
            .style('opacity', '1')
            .attr('transform', null);
        });

      if (onClickItem) {
        nodeGroup.on('click', () => onClickItem(blip.lineNumber));
      }

      y += totalNodeH + nodeGap;
    }

    y += ringGroupGap;
  }
}
