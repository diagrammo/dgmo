import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { mix } from '../palettes/color-utils';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedTechRadar, QuadrantPosition } from './types';
import { getQuadrantArc } from './layout';
import {
  resolveQuadrantColor,
  renderTrendIndicator,
  getTrendChar,
} from './shared';

// ============================================================
// Constants
// ============================================================

const BLIP_RADIUS = 11;
const BLIP_FONT_SIZE = 9;
const RING_LABEL_FONT_SIZE = 11;
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
  exportDims?: D3ExportDimensions
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
  const radarWidth = isNarrow ? width : width * 0.4;
  const radarHeight = isNarrow ? height * 0.4 : height - 40;
  const panelX = isNarrow ? 0 : radarWidth;
  const panelY = isNarrow ? radarHeight + 8 : 40;
  const panelWidth = isNarrow ? width : width - radarWidth;
  const panelHeight = isNarrow ? height - radarHeight - 8 : height - 40;

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

  renderQuarterCircle(
    sliceGroup,
    parsed,
    quadrant,
    qColor,
    palette,
    isDark,
    radarWidth,
    radarHeight - (isNarrow ? 32 : 0),
    mutedColor,
    onClickItem
  );

  // ── Side panel (blip listing with ring headers) ──
  renderSidePanel(
    svg,
    parsed,
    quadrant,
    qColor,
    palette,
    textColor,
    mutedColor,
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    onClickItem
  );
}

// ============================================================
// Quarter-Circle Rendering
// ============================================================

function renderQuarterCircle(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  parsed: ParsedTechRadar,
  quadrant: ParsedTechRadar['quadrants'][number],
  qColor: string,
  palette: PaletteColors,
  isDark: boolean,
  width: number,
  height: number,
  mutedColor: string,
  onClickItem?: (lineNumber: number) => void
): void {
  const size = Math.min(width, height);
  const maxRadius = size * 0.85;
  const ringCount = parsed.rings.length;
  const ringBandWidth = maxRadius / ringCount;

  // Position center at the corner opposite to the quadrant
  const { startAngle, endAngle } = getQuadrantArc(quadrant.position);
  let cx: number, cy: number;

  switch (quadrant.position) {
    case 'top-right':
      cx = 0;
      cy = size;
      break;
    case 'top-left':
      cx = width;
      cy = size;
      break;
    case 'bottom-left':
      cx = width;
      cy = 0;
      break;
    case 'bottom-right':
      cx = 0;
      cy = 0;
      break;
  }

  // Ring arcs with alternate shading
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
      .attr('stroke-width', 0.5)
      .attr('stroke-dasharray', '4,3');
  }

  // Ring labels along the 45-degree line of this quadrant
  for (let ri = 0; ri < parsed.rings.length; ri++) {
    const rCenter = (ri + 0.5) * ringBandWidth;
    const midAngle = (startAngle + endAngle) / 2;
    const labelX = cx + rCenter * Math.cos(midAngle);
    const labelY = cy - rCenter * Math.sin(midAngle);

    g.append('text')
      .attr('x', labelX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', mutedColor)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', RING_LABEL_FONT_SIZE)
      .attr('font-weight', '500')
      .attr('opacity', 0.7)
      .text(parsed.rings[ri].name);
  }

  // Blip dots
  const ringOrder = parsed.rings.map((r) => r.name);
  const angularPadding = 0.08;
  const radialPadding = ringBandWidth * 0.12;
  const usableArcStart = startAngle + angularPadding;
  const usableArcEnd = endAngle - angularPadding;
  const arcSpan = usableArcEnd - usableArcStart;

  // Group by ring
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
        .style('cursor', onClickItem ? 'pointer' : 'default');

      // Angle from blip toward the quarter-circle center in SVG coords (Y-down)
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
  textColor: string,
  mutedColor: string,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  onClickItem?: (lineNumber: number) => void
): void {
  const panelGroup = svg
    .append('g')
    .attr('transform', `translate(${panelX}, ${panelY})`);

  const ringOrder = parsed.rings.map((r) => r.name);
  let y = 8;
  const lineH = 22;
  const descLineH = 16;
  const indent = 16;

  for (const ringName of ringOrder) {
    const blips = quadrant.blips.filter((b) => b.ring === ringName);
    if (blips.length === 0) continue;

    // Ring header
    panelGroup
      .append('text')
      .attr('x', 8)
      .attr('y', y)
      .attr('fill', mutedColor)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', PANEL_RING_FONT_SIZE)
      .attr('font-weight', 'bold')
      .attr('text-transform', 'uppercase')
      .text(ringName);
    y += lineH;

    // Blips under this ring
    for (const blip of blips) {
      // Blip name node (rectangular) — data-line-number on <g> wrapper
      const nodeWidth = panelWidth - indent - 16;
      const nodeHeight = 24;
      const nodeGroup = panelGroup
        .append('g')
        .attr('data-line-number', blip.lineNumber)
        .style('cursor', onClickItem ? 'pointer' : 'default');

      nodeGroup
        .append('rect')
        .attr('x', indent)
        .attr('y', y - 16)
        .attr('width', nodeWidth)
        .attr('height', nodeHeight)
        .attr('rx', 4)
        .attr('fill', mix(palette.bg, qColor, 0.08))
        .attr('stroke', qColor)
        .attr('stroke-width', 1);

      const trendChar = getTrendChar(blip.trend);
      nodeGroup
        .append('text')
        .attr('x', indent + 8)
        .attr('y', y)
        .attr('fill', textColor)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', PANEL_BLIP_FONT_SIZE)
        .text(`${blip.globalNumber}. ${blip.name}${trendChar}`);

      if (onClickItem) {
        nodeGroup.on('click', () => onClickItem(blip.lineNumber));
      }

      y += lineH;

      // Description (if any)
      if (blip.description.length > 0) {
        for (const descLine of blip.description) {
          panelGroup
            .append('text')
            .attr('x', indent + 8)
            .attr('y', y)
            .attr('fill', mutedColor)
            .attr('font-family', FONT_FAMILY)
            .attr('font-size', PANEL_DESC_FONT_SIZE)
            .text(descLine);
          y += descLineH;
        }
        y += 4;
      }
    }

    y += 8; // gap between ring groups
  }
}
