import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { CompactViewState } from '../sharing';
import { parseInlineMarkdown } from '../utils/inline-markdown';
import { safeHref } from '../utils/safe-href';
import type {
  ParsedTechRadar,
  QuadrantPosition,
  TechRadarRenderOptions,
} from './types';
import {
  computeRadarLayout,
  getRadarGeometry,
  getQuadrantArc,
  POSITION_ORDER,
} from './layout';
import {
  resolveQuadrantColor,
  renderTrendIndicator,
  DIM_OPACITY,
  TREND_ITEMS,
} from './shared';
import { renderQuadrantFocus } from './interactive';
import { renderLegendD3 } from '../utils/legend-d3';
import { LEGEND_HEIGHT } from '../utils/legend-constants';
import type {
  LegendConfig,
  LegendState,
  LegendCallbacks,
  LegendPalette,
} from '../utils/legend-types';

// ============================================================
// Constants
// ============================================================

const BLIP_RADIUS = 12;
const BLIP_FONT_SIZE = 9;
const RING_LABEL_FONT_SIZE = 13;
const QUADRANT_LABEL_FONT_SIZE = 18;
const TITLE_FONT_SIZE = 18;
const LISTING_FONT_SIZE = 12;
const LISTING_HEADER_FONT_SIZE = 13;
const LISTING_TOP_MARGIN = 24;
const LISTING_COL_GAP = 16;
const LISTING_LINE_HEIGHT = 24;

// ============================================================
// SVG Init (local, matches d3.ts pattern)
// ============================================================

function initRadarSvg(
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
  const textColor = palette.text;
  const mutedColor = palette.border;
  const bgColor = palette.bg;
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', bgColor);
  return { svg, width, height, textColor, mutedColor, bgColor };
}

// ============================================================
// Main Renderer
// ============================================================

export function renderTechRadar(
  container: HTMLDivElement,
  parsed: ParsedTechRadar,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions,
  viewState?: CompactViewState,
  options?: TechRadarRenderOptions
): void {
  if (parsed.quadrants.length === 0 || parsed.rings.length === 0) return;

  // If a quadrant is focused, delegate to the interactive module
  // (but NOT for export — always export the full radar with blip legend)
  if (viewState?.rq && !exportDims) {
    renderQuadrantFocus(
      container,
      parsed,
      viewState.rq as QuadrantPosition,
      palette,
      isDark,
      onClickItem,
      exportDims,
      options
    );
    return;
  }

  // Determine if listing is visible — always show for export (blip legend is essential).
  // Otherwise: runtime option wins; falls back to the `show-blip-legend` directive in source.
  const directiveOn = parsed.options['show-blip-legend'] === 'on';
  const showListing = exportDims ? true : (options?.showListing ?? directiveOn);
  const listingHeight = showListing ? estimateListingHeight(parsed) : 0;

  const init = initRadarSvg(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, mutedColor } = init;

  const radarHeight = Math.max(
    200,
    height - listingHeight - (showListing ? LISTING_TOP_MARGIN : 0)
  );
  const radarWidth = width;

  // ── Title ──
  const titleY = 24;
  if (parsed.title) {
    svg
      .append('text')
      .attr('x', radarWidth / 2)
      .attr('y', titleY)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(parsed.title);
  }

  // ── Legend controls (centered, standard legend system) ──
  let legendReservedHeight = 0;
  if (!exportDims && options?.onToggleListing) {
    const legendY = parsed.title ? titleY + 8 : 4;
    const legendG = svg
      .append('g')
      .attr('transform', `translate(0, ${legendY})`);

    const legendConfig: LegendConfig = {
      groups: [
        {
          name: 'Trends',
          entries: TREND_ITEMS.map((item) => ({
            value: item.label,
            color: palette.textMuted,
          })),
        },
      ],
      position: { placement: 'top-center', titleRelation: 'below-title' },
      mode: 'fixed',
      controlsGroup: {
        toggles: [
          {
            id: 'blip-legend',
            type: 'toggle',
            label: 'Blip Legend',
            active: showListing,
            onToggle: (active: boolean) => options.onToggleListing!(active),
          },
        ],
      },
    };
    const legendState: LegendState = {
      activeGroup: options?.activeLegendGroup ?? null,
      controlsExpanded: options.controlsExpanded,
    };
    const legendPalette: LegendPalette = {
      text: palette.text,
      textMuted: palette.textMuted,
      bg: palette.bg,
      surface: palette.surface,
      primary: palette.primary,
    };
    const legendCallbacks: LegendCallbacks = {
      onGroupToggle: options.onLegendGroupToggle,
      onControlsExpand: options.onToggleControlsExpand,
      onControlsToggle: (id, active) => {
        if (id === 'blip-legend' && options.onToggleListing) {
          options.onToggleListing(active);
        }
      },
      onEntryHover: (_groupName, entryValue) => {
        if (!entryValue) {
          // Hover out — restore all
          svg
            .selectAll<SVGElement, unknown>('[data-trend]')
            .style('opacity', '1');
          return;
        }
        // Map entry label back to trend value
        const item = TREND_ITEMS.find((t) => t.label === entryValue);
        if (!item) return;
        const trendVal = item.trend ?? 'stable';
        svg
          .selectAll<SVGElement, unknown>('[data-trend]')
          .style('opacity', function () {
            return this.getAttribute('data-trend') === trendVal
              ? '1'
              : String(DIM_OPACITY);
          });
      },
    };

    renderLegendD3(
      legendG,
      legendConfig,
      legendState,
      legendPalette,
      isDark,
      legendCallbacks,
      width
    );
    legendReservedHeight = LEGEND_HEIGHT + 8;
  }

  const radarTop = (parsed.title ? titleY + 16 : 8) + legendReservedHeight;
  const radarAreaHeight = radarHeight - radarTop;
  const radarAreaWidth = radarWidth;

  const { cx, cy, maxRadius, ringBandWidth } = getRadarGeometry(
    radarAreaWidth,
    radarAreaHeight,
    parsed.rings.length
  );
  const offsetY = radarTop;

  const radarGroup = svg
    .append('g')
    .attr('transform', `translate(0, ${offsetY})`);

  // ── Ring segments (per quadrant arc slices for hover highlighting) ──
  for (let ri = parsed.rings.length - 1; ri >= 0; ri--) {
    const innerR = ri * ringBandWidth;
    const outerR = (ri + 1) * ringBandWidth;
    const fillColor =
      ri % 2 === 0 ? palette.bg : mix(palette.bg, palette.border, 0.15);
    const ringName = parsed.rings[ri].name;

    for (const quadrant of parsed.quadrants) {
      const { startAngle, endAngle } = getQuadrantArc(quadrant.position);
      const path = buildArcSlicePath(
        cx,
        cy,
        innerR,
        outerR,
        startAngle,
        endAngle
      );

      radarGroup
        .append('path')
        .attr('d', path)
        .attr('fill', fillColor)
        .attr('stroke', mutedColor)
        .attr('stroke-width', 0.5)
        .attr('data-ring-segment', '')
        .attr('data-quadrant', quadrant.position)
        .attr('data-ring', ringName);
    }
  }

  // ── Quadrant divider lines ──
  radarGroup
    .append('line')
    .attr('x1', cx - maxRadius)
    .attr('y1', cy)
    .attr('x2', cx + maxRadius)
    .attr('y2', cy)
    .attr('stroke', mutedColor)
    .attr('stroke-width', 1);
  radarGroup
    .append('line')
    .attr('x1', cx)
    .attr('y1', cy - maxRadius)
    .attr('x2', cx)
    .attr('y2', cy + maxRadius)
    .attr('stroke', mutedColor)
    .attr('stroke-width', 1);

  // ── Ring labels (along vertical axis, centered — avoids horizontal collision) ──
  for (let ri = 0; ri < parsed.rings.length; ri++) {
    const rCenter = (ri + 0.5) * ringBandWidth;

    if (ri === 0) {
      // Innermost ring: dead center
      radarGroup
        .append('text')
        .attr('x', cx)
        .attr('y', cy)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', textColor)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', RING_LABEL_FONT_SIZE)
        .attr('font-weight', '600')
        .attr('opacity', 0.5)
        .text(parsed.rings[ri].name);
    } else {
      // Above center
      radarGroup
        .append('text')
        .attr('x', cx)
        .attr('y', cy - rCenter)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', textColor)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', RING_LABEL_FONT_SIZE)
        .attr('font-weight', '600')
        .attr('opacity', 0.5)
        .text(parsed.rings[ri].name);

      // Below center (mirrored)
      radarGroup
        .append('text')
        .attr('x', cx)
        .attr('y', cy + rCenter)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', textColor)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', RING_LABEL_FONT_SIZE)
        .attr('font-weight', '600')
        .attr('opacity', 0.5)
        .text(parsed.rings[ri].name);
    }
  }

  // ── Quadrant labels in corners ──
  for (const quadrant of parsed.quadrants) {
    const qColor = resolveQuadrantColor(
      quadrant.position,
      quadrant.color,
      palette
    );
    const {
      x: labelX,
      y: labelY,
      anchor,
    } = getQuadrantLabelPosition(quadrant.position, cx, cy, maxRadius);
    const labelGroup = radarGroup
      .append('g')
      .attr('data-line-number', quadrant.lineNumber)
      .style('cursor', 'pointer');

    renderQuadrantLabel(
      labelGroup,
      quadrant.name,
      labelX,
      labelY,
      anchor,
      qColor,
      maxRadius * 0.9
    );
  }

  // ── Interactive ring×quadrant hover hit areas (rendered before blips so blips sit on top) ──
  if (!exportDims) {
    renderRingHoverAreas(
      radarGroup,
      svg,
      parsed,
      palette,
      cx,
      cy,
      ringBandWidth,
      maxRadius
    );
  }

  // ── Compute layout and render blips ──
  const layoutPoints = computeRadarLayout(
    parsed,
    radarAreaWidth,
    radarAreaHeight
  );

  // Rich popover for blip details
  const popover = createBlipPopover(container, palette, isDark);
  let pinnedLineNum: string | null = null;

  function showBlipHighlight(
    lineNum: string,
    bx: number,
    by: number,
    blipGroup: d3Selection.Selection<SVGGElement, unknown, null, undefined>
  ) {
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
  }

  function clearBlipHighlight() {
    svg
      .selectAll<SVGElement, unknown>('[data-line-number]')
      .style('opacity', '1')
      .attr('transform', null);
  }

  for (const point of layoutPoints) {
    const quadrant = parsed.quadrants.find((q) =>
      q.blips.includes(point.blip)
    )!;
    const qColor = resolveQuadrantColor(
      quadrant.position,
      quadrant.color,
      palette
    );

    const blipGroup = radarGroup
      .append('g')
      .attr('data-line-number', point.blip.lineNumber)
      .attr('data-quadrant', quadrant.position)
      .attr('data-ring', point.blip.ring)
      .attr('data-trend', point.blip.trend ?? 'stable')
      .style('cursor', 'pointer');

    // Angle from blip toward radar center in SVG coords (Y-down)
    const angleToCenter = Math.atan2(cy - point.y, cx - point.x);

    // Trend indicator + circle
    renderTrendIndicator(
      blipGroup,
      point.blip.trend,
      qColor,
      point.x,
      point.y,
      BLIP_RADIUS,
      angleToCenter
    );

    // Blip number
    blipGroup
      .append('text')
      .attr('x', point.x)
      .attr('y', point.y + 3)
      .attr('text-anchor', 'middle')
      .attr('fill', isDark ? '#000' : '#fff')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', BLIP_FONT_SIZE)
      .attr('font-weight', 'bold')
      .text(point.blip.globalNumber);

    // Hover: show rich popover + highlight
    const lineNum = String(point.blip.lineNumber);
    const bx = point.x;
    const by = point.y;
    blipGroup
      .on('mouseenter', (event: MouseEvent) => {
        if (pinnedLineNum) return; // don't interfere with pinned popover
        showBlipPopover(
          popover,
          point.blip,
          qColor,
          palette,
          isDark,
          event,
          parsed.options['solid-fill'] === 'on'
        );
        showBlipHighlight(lineNum, bx, by, blipGroup);
      })
      .on('mousemove', (event: MouseEvent) => {
        if (pinnedLineNum) return;
        positionPopover(popover, event);
      })
      .on('mouseleave', () => {
        if (pinnedLineNum) return;
        hideBlipPopover(popover);
        clearBlipHighlight();
      });

    // Click: pin/unpin the popover (don't stopPropagation so the
    // interactivity hook's document listener can fire for editor navigation)
    blipGroup.on('click', (event: MouseEvent) => {
      (event as MouseEvent & { _blipClick?: boolean })._blipClick = true;
      if (pinnedLineNum === lineNum) {
        // Unpin
        pinnedLineNum = null;
        hideBlipPopover(popover);
        clearBlipHighlight();
      } else {
        // Pin this blip — enable pointer events so links are clickable
        pinnedLineNum = lineNum;
        showBlipPopover(
          popover,
          point.blip,
          qColor,
          palette,
          isDark,
          event,
          parsed.options['solid-fill'] === 'on'
        );
        popover.style.pointerEvents = 'auto';
        showBlipHighlight(lineNum, bx, by, blipGroup);
      }
    });
  }

  // Click on empty space clears pinned popover (ignore blip clicks)
  svg.on('click', (event: MouseEvent) => {
    if ((event as MouseEvent & { _blipClick?: boolean })._blipClick) return;
    if (pinnedLineNum) {
      pinnedLineNum = null;
      hideBlipPopover(popover);
      clearBlipHighlight();
    }
  });

  // ── Active line from editor cursor → show popover for that blip ──
  if (options?.activeLine && !pinnedLineNum) {
    const activeLn = options.activeLine;
    // Find the blip that matches this line (or whose description contains this line)
    for (const point of layoutPoints) {
      const blip = point.blip;
      const isOnBlip = blip.lineNumber === activeLn;
      const isOnDesc =
        blip.description.length > 0 &&
        activeLn > blip.lineNumber &&
        activeLn <= blip.lineNumber + blip.description.length;

      if (isOnBlip || isOnDesc) {
        const quadrant = parsed.quadrants.find((q) => q.blips.includes(blip))!;
        const qColor = resolveQuadrantColor(
          quadrant.position,
          quadrant.color,
          palette
        );
        // Show popover at the blip's position
        const svgRect = (svg.node() as SVGSVGElement)?.getBoundingClientRect();
        if (svgRect) {
          const fakeEvent = {
            clientX: svgRect.left + point.x,
            clientY: svgRect.top + offsetY + point.y,
          } as MouseEvent;
          showBlipPopover(
            popover,
            blip,
            qColor,
            palette,
            isDark,
            fakeEvent,
            parsed.options['solid-fill'] === 'on'
          );
        }
        // Scale up and dim
        const lineNum = String(blip.lineNumber);
        const blipEl = svg.select(`[data-line-number="${lineNum}"]`);
        if (!blipEl.empty()) {
          blipEl.attr(
            'transform',
            `translate(${point.x},${point.y}) scale(1.5) translate(${-point.x},${-point.y})`
          );
        }
        svg
          .selectAll<SVGElement, unknown>('[data-line-number]')
          .style('opacity', function () {
            return this.getAttribute('data-line-number') === lineNum
              ? '1'
              : String(DIM_OPACITY);
          });
        break;
      }
    }
  }

  // ── Four-column blip listing below radar ──
  if (showListing) {
    renderBlipListing(
      svg,
      parsed,
      palette,
      isDark,
      textColor,
      radarHeight + LISTING_TOP_MARGIN,
      width,
      onClickItem
    );
  }
}

// ============================================================
// Four-Column Listing
// ============================================================

const LISTING_BLIP_R = 11;

function renderBlipListing(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  parsed: ParsedTechRadar,
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  startY: number,
  totalWidth: number,
  onClickItem?: (lineNumber: number) => void
): void {
  const colCount = parsed.quadrants.length;
  if (colCount === 0) return;

  const colWidth = (totalWidth - LISTING_COL_GAP * (colCount + 1)) / colCount;

  // Sort quadrants in POSITION_ORDER
  const sortedQuadrants = [...parsed.quadrants].sort(
    (a, b) =>
      POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position)
  );

  for (let ci = 0; ci < sortedQuadrants.length; ci++) {
    const quadrant = sortedQuadrants[ci];
    const qColor = resolveQuadrantColor(
      quadrant.position,
      quadrant.color,
      palette
    );
    const colX = LISTING_COL_GAP + ci * (colWidth + LISTING_COL_GAP);
    let y = startY;

    // Column header — hover highlights entire quadrant on radar
    const headerText = svg
      .append('text')
      .attr('x', colX)
      .attr('y', y)
      .attr('fill', qColor)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', LISTING_HEADER_FONT_SIZE)
      .attr('font-weight', 'bold')
      .style('cursor', 'pointer')
      .text(quadrant.name);

    const qPos = quadrant.position;
    headerText
      .on('mouseenter', () => {
        // Dim everything except this quadrant's blips + ring segments
        svg
          .selectAll<SVGElement, unknown>('[data-quadrant][data-ring]')
          .style('opacity', function () {
            return this.getAttribute('data-quadrant') === qPos
              ? '1'
              : String(DIM_OPACITY);
          });
      })
      .on('mouseleave', () => {
        svg
          .selectAll<SVGElement, unknown>('[data-quadrant][data-ring]')
          .style('opacity', '1');
      });

    y += LISTING_LINE_HEIGHT + 6;

    // Sort blips by globalNumber
    const sortedBlips = [...quadrant.blips].sort(
      (a, b) => a.globalNumber - b.globalNumber
    );

    for (const blip of sortedBlips) {
      const itemGroup = svg
        .append('g')
        .attr('data-line-number', blip.lineNumber)
        .attr('data-quadrant', quadrant.position)
        .attr('data-ring', blip.ring)
        .attr('data-trend', blip.trend ?? 'stable')
        .style('cursor', onClickItem ? 'pointer' : 'default');

      const blipCx = colX + LISTING_BLIP_R;
      const blipCy = y - LISTING_BLIP_R + 2;

      // Mini blip circle with trend indicator
      // angleToCenter convention: "up" means center is above (angle = -π/2 in SVG)
      // "down" means center is below (angle = π/2 in SVG)
      // The shared renderer flips for "down", so we pass the "toward center" angle
      const trendAngle = -Math.PI / 2; // "center" is always up for listing context
      renderTrendIndicator(
        itemGroup,
        blip.trend,
        qColor,
        blipCx,
        blipCy,
        LISTING_BLIP_R,
        trendAngle
      );

      // Number inside the circle
      itemGroup
        .append('text')
        .attr('x', blipCx)
        .attr('y', blipCy + 3)
        .attr('text-anchor', 'middle')
        .attr('fill', isDark ? '#000' : '#fff')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', 9)
        .attr('font-weight', 'bold')
        .text(blip.globalNumber);

      // Blip name + ring — truncated to fit column width
      const textX = colX + LISTING_BLIP_R * 2 + 6;
      const availableWidth = colWidth - LISTING_BLIP_R * 2 - 8;
      const fullLabel = `${blip.name} (${blip.ring})`;
      const label = truncateLabel(fullLabel, availableWidth, LISTING_FONT_SIZE);

      itemGroup
        .append('text')
        .attr('x', textX)
        .attr('y', y)
        .attr('fill', textColor)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', LISTING_FONT_SIZE)
        .text(label);

      // Cross-highlight: hover listing blip → highlight + scale up radar blip
      const ln = String(blip.lineNumber);
      itemGroup
        .on('mouseenter', () => {
          svg
            .selectAll<SVGElement, unknown>('[data-line-number]')
            .style('opacity', function () {
              const isMatch = this.getAttribute('data-line-number') === ln;
              // Scale up the matching radar blip (not listing items)
              if (
                isMatch &&
                this.getAttribute('data-quadrant') &&
                this.closest('g[transform]')
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
        itemGroup.on('click', () => onClickItem(blip.lineNumber));
      }

      y += LISTING_LINE_HEIGHT;
    }
  }
}

/** Estimate max characters that fit in `availablePx` at the given font size. */
function truncateLabel(
  text: string,
  availablePx: number,
  fontSize: number
): string {
  // Average character width ≈ 0.58 × fontSize for Helvetica/Inter
  const avgCharWidth = fontSize * 0.58;
  const maxChars = Math.floor(availablePx / avgCharWidth);
  if (maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 1) + '\u2026';
}

// ============================================================
// Ring×Quadrant Hover Interactivity
// ============================================================

/**
 * Render transparent arc hit areas for each ring×quadrant slice.
 * On hover, dims all blips (radar + listing) except those in the hovered slice.
 */
function renderRingHoverAreas(
  radarGroup: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  parsed: ParsedTechRadar,
  palette: PaletteColors,
  cx: number,
  cy: number,
  ringBandWidth: number,
  _maxRadius: number
): void {
  for (const quadrant of parsed.quadrants) {
    const { startAngle, endAngle } = getQuadrantArc(quadrant.position);
    const qColor = resolveQuadrantColor(
      quadrant.position,
      quadrant.color,
      palette
    );

    for (let ri = 0; ri < parsed.rings.length; ri++) {
      const innerR = ri * ringBandWidth;
      const outerR = (ri + 1) * ringBandWidth;
      const ringName = parsed.rings[ri].name;

      const path = buildArcSlicePath(
        cx,
        cy,
        innerR,
        outerR,
        startAngle,
        endAngle
      );

      const hitArea = radarGroup
        .append('path')
        .attr('d', path)
        .attr('fill', 'transparent')
        .style('cursor', 'pointer');

      hitArea
        .on('mouseenter', () => {
          // Tint the hovered slice via the overlay
          hitArea.attr('fill', qColor).attr('opacity', 0.15);
          // Dim all blips/listing except matching ring+quadrant
          svg
            .selectAll<SVGElement, unknown>('[data-quadrant][data-ring]')
            .style('opacity', function () {
              const q = this.getAttribute('data-quadrant');
              const r = this.getAttribute('data-ring');
              return q === quadrant.position && r === ringName
                ? '1'
                : String(DIM_OPACITY);
            });
        })
        .on('mouseleave', () => {
          // Remove overlay tint
          hitArea.attr('fill', 'transparent').attr('opacity', 1);
          // Restore all opacities
          svg
            .selectAll<SVGElement, unknown>('[data-quadrant][data-ring]')
            .style('opacity', '1');
        });
    }
  }
}

/** Build an SVG arc-slice path between inner and outer radius for a quadrant arc. */
function buildArcSlicePath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number
): string {
  // Convert math angles to SVG coordinates (negate sin for Y-down)
  const ox1 = cx + outerR * Math.cos(startAngle);
  const oy1 = cy - outerR * Math.sin(startAngle);
  const ox2 = cx + outerR * Math.cos(endAngle);
  const oy2 = cy - outerR * Math.sin(endAngle);
  const ix1 = cx + innerR * Math.cos(endAngle);
  const iy1 = cy - innerR * Math.sin(endAngle);
  const ix2 = cx + innerR * Math.cos(startAngle);
  const iy2 = cy - innerR * Math.sin(startAngle);

  if (innerR === 0) {
    // Pie wedge from center
    return `M${cx},${cy} L${ox1},${oy1} A${outerR},${outerR} 0 0,0 ${ox2},${oy2} Z`;
  }

  return `M${ox1},${oy1} A${outerR},${outerR} 0 0,0 ${ox2},${oy2} L${ix1},${iy1} A${innerR},${innerR} 0 0,1 ${ix2},${iy2} Z`;
}

// ============================================================
// Trend Items (used by legend group entries)
// ============================================================

function estimateListingHeight(parsed: ParsedTechRadar): number {
  const maxBlipsInQuadrant = Math.max(
    0,
    ...parsed.quadrants.map((q) => q.blips.length)
  );
  return (
    LISTING_LINE_HEIGHT * (maxBlipsInQuadrant + 1) +
    LISTING_LINE_HEIGHT +
    LISTING_TOP_MARGIN
  );
}

// ============================================================
// Rich Blip Popover (B&L-style node card)
// ============================================================

import type { TechRadarBlip } from './types';

function createBlipPopover(
  container: HTMLElement,
  palette: PaletteColors,
  isDark: boolean
): HTMLDivElement {
  container.style.position = 'relative';
  const existing = container.querySelector<HTMLDivElement>(
    '[data-blip-popover]'
  );
  if (existing) {
    existing.style.display = 'none';
    return existing;
  }
  const el = document.createElement('div');
  el.setAttribute('data-blip-popover', '');
  el.style.position = 'absolute';
  el.style.display = 'none';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '20';
  el.style.maxWidth = '280px';
  el.style.fontFamily = FONT_FAMILY;
  el.style.fontSize = '12px';
  el.style.lineHeight = '1.5';
  el.style.borderRadius = '6px';
  el.style.overflow = 'hidden';
  el.style.boxShadow = isDark
    ? '0 4px 12px rgba(0,0,0,0.4)'
    : '0 4px 12px rgba(0,0,0,0.12)';
  container.appendChild(el);
  return el;
}

function showBlipPopover(
  popover: HTMLDivElement,
  blip: TechRadarBlip,
  qColor: string,
  palette: PaletteColors,
  isDark: boolean,
  event: MouseEvent,
  solid?: boolean
): void {
  const fillColor = shapeFill(palette, qColor, isDark, { solid });
  const hasDesc = blip.description.length > 0;
  const onFillText = contrastText(
    fillColor,
    palette.textOnFillLight,
    palette.textOnFillDark
  );

  let html = `<div style="background:${fillColor}; border: 1.5px solid ${qColor}; border-radius: 6px; overflow: hidden;">`;
  html += `<div style="padding: 8px 12px; font-weight: 600; color: ${onFillText};">${escapeHtml(blip.name)}</div>`;

  if (hasDesc) {
    html += `<div style="border-top: 1px solid ${qColor}; opacity: 0.3;"></div>`;
    html += `<div style="padding: 6px 12px 8px; color: ${palette.textMuted}; font-size: 11px; line-height: 1.6;">`;
    // Join consecutive prose lines into paragraphs; bullets stay separate
    const paragraphs = joinDescriptionParagraphs(blip.description);
    for (const para of paragraphs) {
      html += renderDescriptionLine(para, palette);
    }
    html += `</div>`;
  }

  html += `</div>`;

  popover.innerHTML = html;
  popover.style.display = 'block';
  positionPopover(popover, event);
}

function positionPopover(popover: HTMLDivElement, event: MouseEvent): void {
  const container = popover.parentElement!;
  const rect = container.getBoundingClientRect();
  const tipW = popover.offsetWidth;
  const tipH = popover.offsetHeight;
  const cursorX = event.clientX - rect.left;
  const cursorY = event.clientY - rect.top;
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  // Position toward the center of the diagram relative to the blip
  let left = cursorX < centerX ? cursorX + 16 : cursorX - tipW - 16;
  let top = cursorY < centerY ? cursorY + 16 : cursorY - tipH - 16;

  // Clamp to container bounds
  if (left + tipW > rect.width - 4) left = rect.width - tipW - 4;
  if (left < 4) left = 4;
  if (top + tipH > rect.height - 4) top = rect.height - tipH - 4;
  if (top < 4) top = 4;

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function hideBlipPopover(popover: HTMLDivElement): void {
  popover.style.display = 'none';
  popover.style.pointerEvents = 'none';
}

/**
 * Join consecutive prose lines into single paragraphs.
 * Bullets (lines starting with -, *, •) stay as separate entries.
 * Blank lines create paragraph breaks.
 */
function joinDescriptionParagraphs(lines: string[]): string[] {
  const result: string[] = [];
  let currentPara = '';

  for (const line of lines) {
    const trimmed = line.trim();
    const isBullet = /^[-*•]\s+/.test(trimmed);

    if (isBullet) {
      // Flush any accumulated paragraph
      if (currentPara) {
        result.push(currentPara);
        currentPara = '';
      }
      result.push(trimmed);
    } else if (!trimmed) {
      // Blank line — paragraph break
      if (currentPara) {
        result.push(currentPara);
        currentPara = '';
      }
    } else {
      // Prose line — join with previous
      currentPara = currentPara ? `${currentPara} ${trimmed}` : trimmed;
    }
  }

  if (currentPara) result.push(currentPara);
  return result;
}

function renderDescriptionLine(line: string, palette: PaletteColors): string {
  const trimmed = line.trim();
  const isBullet = /^[-*•]\s+/.test(trimmed);
  const content = isBullet ? trimmed.replace(/^[-*•]\s+/, '') : trimmed;

  const spans = parseInlineMarkdown(content);
  let spanHtml = '';
  for (const span of spans) {
    let text = escapeHtml(span.text);
    if (span.bold) text = `<strong>${text}</strong>`;
    if (span.italic) text = `<em>${text}</em>`;
    if (span.code)
      text = `<code style="background:${palette.surface}; padding: 1px 4px; border-radius: 3px; font-size: 10px;">${text}</code>`;
    if (span.href) {
      const safe = safeHref(span.href);
      if (safe !== null) {
        text = `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" style="color: ${palette.primary ?? palette.text}; text-decoration: underline;">${text}</a>`;
      }
      // else: drop the anchor, render plain text.
    }
    spanHtml += text;
  }

  if (isBullet) {
    return `<div style="padding-left: 12px; text-indent: -10px; margin: 1px 0;">• ${spanHtml}</div>`;
  }
  return `<div style="margin: 2px 0;">${spanHtml}</div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// Quadrant Label Positioning
// ============================================================

/**
 * Render a quadrant label, wrapping to multiple lines if needed and
 * scaling font down if the text is too wide for the available space.
 */
function renderQuadrantLabel(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  name: string,
  x: number,
  y: number,
  anchor: string,
  color: string,
  maxWidth: number
): void {
  const avgCharWidth = QUADRANT_LABEL_FONT_SIZE * 0.58;
  const maxCharsPerLine = Math.floor(maxWidth / avgCharWidth);

  // Split into words and wrap
  const words = name.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length > maxCharsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  // Scale font down if any line is still too wide
  const longestLine = Math.max(...lines.map((l) => l.length));
  const estimatedWidth = longestLine * avgCharWidth;
  const fontSize =
    estimatedWidth > maxWidth
      ? Math.max(12, QUADRANT_LABEL_FONT_SIZE * (maxWidth / estimatedWidth))
      : QUADRANT_LABEL_FONT_SIZE;

  const lineHeight = fontSize * 1.2;

  for (let i = 0; i < lines.length; i++) {
    g.append('text')
      .attr('x', x)
      .attr('y', y + i * lineHeight)
      .attr('text-anchor', anchor)
      .attr('fill', color)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', fontSize)
      .attr('font-weight', 'bold')
      .text(lines[i]);
  }
}

function getQuadrantLabelPosition(
  position: QuadrantPosition,
  cx: number,
  cy: number,
  maxRadius: number
): { x: number; y: number; anchor: string } {
  const margin = 8;
  switch (position) {
    case 'top-left':
      return {
        x: cx - maxRadius + margin,
        y: cy - maxRadius + 16,
        anchor: 'start',
      };
    case 'top-right':
      return {
        x: cx + maxRadius - margin,
        y: cy - maxRadius + 16,
        anchor: 'end',
      };
    case 'bottom-left':
      return {
        x: cx - maxRadius + margin,
        y: cy + maxRadius - 8,
        anchor: 'start',
      };
    case 'bottom-right':
      return {
        x: cx + maxRadius - margin,
        y: cy + maxRadius - 8,
        anchor: 'end',
      };
  }
}

// ============================================================
// Export Renderer (for static SVG/PNG export)
// ============================================================

export function renderTechRadarForExport(
  container: HTMLDivElement,
  parsed: ParsedTechRadar,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  viewState?: CompactViewState
): void {
  renderTechRadar(
    container,
    parsed,
    palette,
    isDark,
    undefined,
    exportDims,
    viewState
  );
}
