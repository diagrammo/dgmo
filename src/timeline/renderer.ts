// ============================================================
// Timeline renderer — Story 109.2 (arch-review). Extracted from d3.ts.
// ============================================================

import { tagAttrKey } from '../utils/tag-groups';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { MONTH_ABBR, computeTimeTicks } from '../utils/time-ticks';
import type { D3ExportDimensions } from '../utils/d3-types';
import { ScaleContext } from '../utils/scaling';
import {
  createTooltip,
  hideTooltip,
  renderChartTitle,
  showTooltip,
} from '../utils/d3-helpers';
import type { ParsedTimeline } from '../visualizations/types';
import type {
  TimelineEvent,
  TimelineGroup,
  TimelineEra,
  TimelineMarker,
} from '../timeline/types';
import { parseTimelineDate } from '../timeline/parser';
import type { PaletteColors } from '../palettes';
import { getSeriesColors } from '../palettes';
import { mix, shapeFill, themeBaseBg } from '../palettes/color-utils';
import { resolveTagColor } from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import {
  LEGEND_HEIGHT as TL_LEGEND_HEIGHT,
  LEGEND_PILL_PAD as TL_LEGEND_PILL_PAD,
  LEGEND_PILL_FONT_SIZE as TL_LEGEND_PILL_FONT_SIZE,
  LEGEND_CAPSULE_PAD as TL_LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R as TL_LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE as TL_LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_DOT_GAP as TL_LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL as TL_LEGEND_ENTRY_TRAIL,
  measureLegendText,
  truncateLegendText,
} from '../utils/legend-constants';
import { renderIntegratedLegend } from '../utils/legend-integration';
import type { LegendConfig, LegendCallbacks } from '../utils/legend-types';

function getEraColors(palette: PaletteColors): string[] {
  return [
    palette.colors.blue,
    palette.colors.green,
    palette.colors.yellow,
    palette.colors.orange,
    palette.colors.purple,
  ];
}

/**
 * Renders semi-transparent era background bands behind timeline events.
 */
function renderEras(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  eras: TimelineEra[],
  scale: d3Scale.ScaleLinear<number, number>,
  isVertical: boolean,
  innerWidth: number,
  innerHeight: number,
  onEnter: (eraStart: number, eraEnd: number) => void,
  onLeave: () => void,
  hasScale: boolean = false,
  _tooltip: HTMLDivElement | null = null,
  palette?: PaletteColors,
  // When provided (horizontal reserved-row mode), eras render their label
  // in the dedicated header row at this Y, the rect stays inside the chart
  // (rectTop=0), and the label is truncated to fit the era's span. Hover
  // restores the full text.
  reservedLabelY?: number
): void {
  const eraColors = palette
    ? getEraColors(palette)
    : ['#3b6ea5', '#5b9357', '#c9a227', '#cc7a33', '#7d5ba6'];
  eras.forEach((era, i) => {
    const startVal = parseTimelineDate(era.startDate);
    const endVal = parseTimelineDate(era.endDate);
    if (!Number.isFinite(startVal) || !Number.isFinite(endVal)) return;
    const start = scale(startVal);
    const end = scale(endVal);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    // eraColors is non-empty; modulo guarantees in-bounds.
    const color = era.color || eraColors[i % eraColors.length]!;

    const eraG = g
      .append('g')
      .attr('class', 'tl-era')
      .attr('data-line-number', String(era.lineNumber))
      .attr('data-era-start', String(startVal))
      .attr('data-era-end', String(endVal))
      .style('cursor', 'pointer');

    let labelEl: d3Selection.Selection<
      SVGTextElement,
      unknown,
      null,
      undefined
    >;
    let displayLabel = era.label;
    let truncated = false;

    if (isVertical) {
      const y = Math.min(start, end);
      const h = Math.abs(end - start);
      eraG
        .append('rect')
        .attr('x', 0)
        .attr('y', y)
        .attr('width', innerWidth)
        .attr('height', h)
        .attr('fill', color)
        .attr('opacity', 0.08);
      labelEl = eraG
        .append('text')
        .attr('x', 6)
        .attr('y', y + 18)
        .attr('text-anchor', 'start')
        .attr('fill', color)
        .attr('font-size', '13px')
        .attr('font-weight', '600')
        .attr('opacity', 0.8)
        .text(displayLabel);
    } else {
      const x = Math.min(start, end);
      const w = Math.abs(end - start);
      // Reserved-row mode: rect lives inside the chart, label sits in its
      // own row above. Legacy mode (no reserved row): keep the era rect
      // extending above the chart so the label has space when scale is on.
      const useReservedRow = reservedLabelY != null;
      const rectTop = useReservedRow ? 0 : hasScale ? -48 : 0;
      const labelY = useReservedRow ? reservedLabelY! : hasScale ? -32 : 18;
      eraG
        .append('rect')
        .attr('x', x)
        .attr('y', rectTop)
        .attr('width', w)
        .attr('height', innerHeight - rectTop)
        .attr('fill', color)
        .attr('opacity', 0.08);
      if (useReservedRow) {
        // Truncate to era's own span so labels stay inside their tinted band.
        const maxW = Math.max(0, w - 8);
        displayLabel = truncateLegendText(era.label, 13, maxW);
        truncated = displayLabel !== era.label;
      }
      labelEl = eraG
        .append('text')
        .attr('x', x + w / 2)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('fill', color)
        .attr('font-size', '13px')
        .attr('font-weight', '600')
        .attr('opacity', 0.8)
        .text(displayLabel);
    }

    eraG
      .on('mouseenter', function () {
        onEnter(startVal, endVal);
        if (truncated) labelEl.text(era.label);
      })
      .on('mouseleave', function () {
        onLeave();
        if (truncated) labelEl.text(displayLabel);
      });
  });
}

/**
 * Renders timeline markers as dashed vertical lines with diamond indicators and labels.
 */
function renderMarkers(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  markers: TimelineMarker[],
  scale: d3Scale.ScaleLinear<number, number>,
  isVertical: boolean,
  innerWidth: number,
  innerHeight: number,
  onEnter: (markerDate: number) => void,
  onLeave: () => void,
  _hasScale: boolean = false,
  _tooltip: HTMLDivElement | null = null,
  palette?: PaletteColors,
  // When provided (horizontal reserved-row mode), labels render at this Y
  // above the chart edge instead of inside the chart at y=6, and are
  // truncated symmetrically based on neighbor distance.
  reservedLabelY?: number
): void {
  // Default marker color - bright orange/red that "pops"
  const defaultColor = palette?.accent || '#3a9188';

  // Pre-compute marker positions so each can size its label based on the
  // distance to its nearest neighbor (or chart edge).
  const positions = markers.map((m) => {
    const v = parseTimelineDate(m.date);
    return Number.isFinite(v) ? scale(v) : NaN;
  });
  const useReservedRow = reservedLabelY != null && !isVertical;

  markers.forEach((marker, i) => {
    const dateVal = parseTimelineDate(marker.date);
    if (!Number.isFinite(dateVal)) return;
    // positions is produced by markers.map(), so i is in-bounds.
    const pos = positions[i]!;
    if (!Number.isFinite(pos)) return;
    const color = marker.color || defaultColor;
    const lineOpacity = 0.5;
    const diamondSize = 5;

    const markerG = g
      .append('g')
      .attr('class', 'tl-marker')
      .attr('data-marker-date', String(dateVal))
      .attr('data-line-number', String(marker.lineNumber))
      .style('cursor', 'pointer');

    if (isVertical) {
      // Vertical orientation: horizontal dashed line across the chart
      markerG
        .append('line')
        .attr('x1', 0)
        .attr('y1', pos)
        .attr('x2', innerWidth)
        .attr('y2', pos)
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '6 4')
        .attr('opacity', lineOpacity);

      // Label above diamond
      markerG
        .append('text')
        .attr('x', -diamondSize - 8)
        .attr('y', pos - diamondSize - 4)
        .attr('text-anchor', 'middle')
        .attr('fill', color)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .text(marker.label);

      // Diamond at the left edge
      markerG
        .append('path')
        .attr(
          'd',
          `M${-diamondSize - 8},${pos} l${diamondSize},-${diamondSize} l${diamondSize},${diamondSize} l-${diamondSize},${diamondSize} Z`
        )
        .attr('fill', color)
        .attr('opacity', 0.9);

      markerG
        .on('mouseenter', function () {
          onEnter(dateVal);
        })
        .on('mouseleave', function () {
          onLeave();
        });
    } else {
      // Horizontal orientation: vertical dashed line down the chart.
      // Reserved-row mode lifts the label above the chart edge; legacy mode
      // keeps it at y=6 inside the chart top.
      const labelY = useReservedRow ? reservedLabelY! : 6;
      // Diamond sits fully above the chart edge in reserved-row mode so it
      // isn't clipped by group bars that start at y=0; legacy mode keeps the
      // diamond inside the chart top below the label.
      const diamondY = useReservedRow ? -(diamondSize + 1) : labelY + 14;
      const lineTop = diamondY + diamondSize;

      // Compute available label width based on nearest-neighbor distance.
      // Both labels truncate symmetrically and meet in the middle of the gap.
      let displayLabel = marker.label;
      let truncated = false;
      if (useReservedRow) {
        let nearestDist = Math.min(pos, innerWidth - pos);
        for (let j = 0; j < positions.length; j++) {
          if (j === i) continue;
          // In-bounds by loop guard.
          const other = positions[j]!;
          if (!Number.isFinite(other)) continue;
          const d = Math.abs(other - pos);
          if (d < nearestDist) nearestDist = d;
        }
        const maxW = Math.max(0, nearestDist - 8);
        displayLabel = truncateLegendText(marker.label, 11, maxW);
        truncated = displayLabel !== marker.label;
      }

      const labelEl = markerG
        .append('text')
        .attr('x', pos)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('fill', color)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .text(displayLabel);

      // Diamond
      markerG
        .append('path')
        .attr(
          'd',
          `M${pos},${diamondY - diamondSize} l${diamondSize},${diamondSize} l-${diamondSize},${diamondSize} l-${diamondSize},-${diamondSize} Z`
        )
        .attr('fill', color)
        .attr('opacity', 0.9);

      // Dashed line down the chart
      markerG
        .append('line')
        .attr('x1', pos)
        .attr('y1', lineTop)
        .attr('x2', pos)
        .attr('y2', innerHeight)
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '6 4')
        .attr('opacity', lineOpacity);

      markerG
        .on('mouseenter', function () {
          onEnter(dateVal);
          if (truncated) labelEl.text(marker.label);
        })
        .on('mouseleave', function () {
          onLeave();
          if (truncated) labelEl.text(displayLabel);
        });
    }
  });
}

// ============================================================
// Timeline Time Scale
// ============================================================

/**
 * Converts a DSL date string to a human-readable label.
 *   '1718'                 → '1718'
 *   '1718-05'              → 'May 1718'
 *   '1718-05-22'           → 'May 22, 1718'
 *   '2024-06-15 14:30'     → 'Jun 15, 2024 14:30'
 *   '2024-06-15 14:30:45'  → 'Jun 15, 2024 14:30:45'
 *   '-753'                 → '753 BCE'  (BCE years stored signed)
 *   '-0044-03'             → 'Mar 44 BCE'
 */
export function formatDateLabel(dateStr: string): string {
  // A leading '-' marks a BCE year (internal signed form); strip it, format the
  // positive date, then re-attach the era marker.
  let bce = false;
  if (dateStr.startsWith('-')) {
    bce = true;
    dateStr = dateStr.slice(1);
  }
  const era = bce ? ' BCE' : '';

  // Split off optional time component (HH:MM or HH:MM:SS — passed through as-is).
  const spaceIdx = dateStr.indexOf(' ');
  let datePart = dateStr;
  let timeSuffix = '';

  if (spaceIdx !== -1) {
    datePart = dateStr.slice(0, spaceIdx);
    timeSuffix = ' ' + dateStr.slice(spaceIdx + 1);
  }

  const parts = datePart.split('-');
  // split returns at least one element; strip any zero-padding on the year.
  const year = String(parseInt(parts[0]!, 10));
  if (parts.length === 1) return `${year}${timeSuffix}${era}`;
  // In-bounds by length check above.
  const month = MONTH_ABBR[parseInt(parts[1]!, 10) - 1];
  if (parts.length === 2) return `${month} ${year}${timeSuffix}${era}`;
  // In-bounds by length check above.
  const day = parseInt(parts[2]!, 10);
  return `${month} ${day}, ${year}${timeSuffix}${era}`;
}

/**
 * Formats a boundary label for the time axis.
 * When both boundaries fall on the same calendar day and have a time component,
 * returns just the time (e.g. "12:15") to avoid collisions with regular ticks.
 * Otherwise falls back to the full formatDateLabel.
 */
function formatBoundaryLabel(dateStr: string, otherDateStr: string): string {
  const spaceIdx = dateStr.indexOf(' ');
  const otherSpaceIdx = otherDateStr.indexOf(' ');
  // Both must have time components and share the same date portion
  if (spaceIdx !== -1 && otherSpaceIdx !== -1) {
    const datePart = dateStr.slice(0, spaceIdx);
    const otherDatePart = otherDateStr.slice(0, otherSpaceIdx);
    if (datePart === otherDatePart) {
      return dateStr.slice(spaceIdx + 1); // just "HH:MM"
    }
  }
  return formatDateLabel(dateStr);
}

/**
 * Renders adaptive tick marks along the time axis.
 * Optional boundary parameters add ticks at exact data start/end.
 */
function renderTimeScale(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  scale: d3Scale.ScaleLinear<number, number>,
  isVertical: boolean,
  innerWidth: number,
  innerHeight: number,
  textColor: string,
  boundaryStart?: number,
  boundaryEnd?: number,
  boundaryStartLabel?: string,
  boundaryEndLabel?: string
): void {
  // d3 linear scales always return a 2-element domain.
  const [domainMin, domainMax] = scale.domain() as [number, number];
  const ticks = computeTimeTicks(
    domainMin,
    domainMax,
    scale,
    boundaryStart,
    boundaryEnd,
    boundaryStartLabel,
    boundaryEndLabel
  );
  if (ticks.length < 2) return;

  const tickLen = 6;
  const opacity = 0.4;

  const guideOpacity = 0.15;

  for (const tick of ticks) {
    if (isVertical) {
      // Guide line spanning full width
      g.append('line')
        .attr('x1', 0)
        .attr('y1', tick.pos)
        .attr('x2', innerWidth)
        .attr('y2', tick.pos)
        .attr('stroke', textColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 4')
        .attr('opacity', guideOpacity);

      // Left edge
      g.append('line')
        .attr('x1', -tickLen)
        .attr('y1', tick.pos)
        .attr('x2', 0)
        .attr('y2', tick.pos)
        .attr('stroke', textColor)
        .attr('stroke-width', 1)
        .attr('opacity', opacity);

      g.append('text')
        .attr('x', -tickLen - 3)
        .attr('y', tick.pos)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', '10px')
        .attr('opacity', opacity)
        .text(tick.label);

      // Right edge
      g.append('line')
        .attr('x1', innerWidth)
        .attr('y1', tick.pos)
        .attr('x2', innerWidth + tickLen)
        .attr('y2', tick.pos)
        .attr('stroke', textColor)
        .attr('stroke-width', 1)
        .attr('opacity', opacity);

      g.append('text')
        .attr('x', innerWidth + tickLen + 3)
        .attr('y', tick.pos)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', textColor)
        .attr('font-size', '10px')
        .attr('opacity', opacity)
        .text(tick.label);
    } else {
      // Guide line spanning full height
      g.append('line')
        .attr('class', 'tl-scale-tick')
        .attr('x1', tick.pos)
        .attr('y1', 0)
        .attr('x2', tick.pos)
        .attr('y2', innerHeight)
        .attr('stroke', textColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 4')
        .attr('opacity', guideOpacity);

      // Bottom edge
      g.append('line')
        .attr('class', 'tl-scale-tick')
        .attr('x1', tick.pos)
        .attr('y1', innerHeight)
        .attr('x2', tick.pos)
        .attr('y2', innerHeight + tickLen)
        .attr('stroke', textColor)
        .attr('stroke-width', 1)
        .attr('opacity', opacity);

      g.append('text')
        .attr('class', 'tl-scale-tick')
        .attr('x', tick.pos)
        .attr('y', innerHeight + tickLen + 12)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', '10px')
        .attr('opacity', opacity)
        .text(tick.label);

      // Top edge
      g.append('line')
        .attr('class', 'tl-scale-tick')
        .attr('x1', tick.pos)
        .attr('y1', -tickLen)
        .attr('x2', tick.pos)
        .attr('y2', 0)
        .attr('stroke', textColor)
        .attr('stroke-width', 1)
        .attr('opacity', opacity);

      g.append('text')
        .attr('class', 'tl-scale-tick')
        .attr('x', tick.pos)
        .attr('y', -tickLen - 4)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', '10px')
        .attr('opacity', opacity)
        .text(tick.label);
    }
  }
}

// ============================================================
// Timeline Event Date Scale Helpers
// ============================================================

/**
 * Shows event start/end dates on the scale, fading existing scale ticks.
 * For horizontal timelines, displays dates at the top of the scale.
 */
function showEventDatesOnScale(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  scale: d3Scale.ScaleLinear<number, number>,
  startDate: string,
  endDate: string | null,
  innerHeight: number,
  accentColor: string
): void {
  // Fade existing scale ticks
  g.selectAll('.tl-scale-tick').attr('opacity', 0.1);

  const tickLen = 6;
  const startPos = scale(parseTimelineDate(startDate));
  const startLabel = formatDateLabel(startDate);

  // Start date - top
  g.append('line')
    .attr('class', 'tl-event-date')
    .attr('x1', startPos)
    .attr('y1', -tickLen)
    .attr('x2', startPos)
    .attr('y2', innerHeight)
    .attr('stroke', accentColor)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '4 4')
    .attr('opacity', 0.6);

  g.append('text')
    .attr('class', 'tl-event-date')
    .attr('x', startPos)
    .attr('y', -tickLen - 4)
    .attr('text-anchor', 'middle')
    .attr('fill', accentColor)
    .attr('font-size', '10px')
    .attr('font-weight', '600')
    .text(startLabel);

  // Start date - bottom
  g.append('text')
    .attr('class', 'tl-event-date')
    .attr('x', startPos)
    .attr('y', innerHeight + tickLen + 12)
    .attr('text-anchor', 'middle')
    .attr('fill', accentColor)
    .attr('font-size', '10px')
    .attr('font-weight', '600')
    .text(startLabel);

  if (endDate) {
    const endPos = scale(parseTimelineDate(endDate));
    const endLabel = formatDateLabel(endDate);

    // End date - top
    g.append('line')
      .attr('class', 'tl-event-date')
      .attr('x1', endPos)
      .attr('y1', -tickLen)
      .attr('x2', endPos)
      .attr('y2', innerHeight)
      .attr('stroke', accentColor)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 4')
      .attr('opacity', 0.6);

    g.append('text')
      .attr('class', 'tl-event-date')
      .attr('x', endPos)
      .attr('y', -tickLen - 4)
      .attr('text-anchor', 'middle')
      .attr('fill', accentColor)
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .text(endLabel);

    // End date - bottom
    g.append('text')
      .attr('class', 'tl-event-date')
      .attr('x', endPos)
      .attr('y', innerHeight + tickLen + 12)
      .attr('text-anchor', 'middle')
      .attr('fill', accentColor)
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .text(endLabel);
  }
}

/**
 * Hides event dates and restores scale tick visibility.
 */
function hideEventDatesOnScale(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>
): void {
  // Remove event date elements
  g.selectAll('.tl-event-date').remove();

  // Restore scale tick visibility
  g.selectAll('.tl-scale-tick').each(function () {
    const el = d3Selection.select(this);
    // Restore original opacity based on element type
    const isDashed = el.attr('stroke-dasharray');
    el.attr('opacity', isDashed ? 0.15 : 0.4);
  });
}

function buildEventTooltipHtml(ev: TimelineEvent): string {
  const datePart = ev.endDate
    ? `${formatDateLabel(ev.date)} → ${formatDateLabel(ev.endDate)}`
    : formatDateLabel(ev.date);
  return `<strong>${ev.label}</strong><br>${datePart}`;
}

// ============================================================
// Timeline Renderer
// ============================================================

/**
 * Renders timeline group legend as pills (colored dot + text in rounded rect),
 * matching the centralized legend pill style.
 */
function renderTimelineGroupLegend(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  groups: TimelineGroup[],
  groupColorMap: Map<string, string>,
  textColor: string,
  palette: PaletteColors,
  isDark: boolean,
  legendY: number,
  onHover: (name: string) => void,
  onLeave: () => void
): void {
  const PILL_H = 22;
  const DOT_R = 4;
  const DOT_GAP = 4;
  const PAD_X = 10;
  const FONT_SIZE = 11;
  const GAP = 8;
  const pillBg = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);

  let legendX = 0;
  for (const grp of groups) {
    const color = groupColorMap.get(grp.name) ?? textColor;
    const textW = measureLegendText(grp.name, FONT_SIZE);
    const pillW = PAD_X + DOT_R * 2 + DOT_GAP + textW + PAD_X;

    const itemG = g
      .append('g')
      .attr('class', 'tl-legend-item')
      .attr('data-group', grp.name)
      .style('cursor', 'pointer')
      .on('mouseenter', () => onHover(grp.name))
      .on('mouseleave', () => onLeave());

    // Pill background
    itemG
      .append('rect')
      .attr('x', legendX)
      .attr('y', legendY - PILL_H / 2)
      .attr('width', pillW)
      .attr('height', PILL_H)
      .attr('rx', PILL_H / 2)
      .attr('fill', pillBg);

    // Colored dot
    itemG
      .append('circle')
      .attr('cx', legendX + PAD_X + DOT_R)
      .attr('cy', legendY)
      .attr('r', DOT_R)
      .attr('fill', color);

    // Label text
    itemG
      .append('text')
      .attr('x', legendX + PAD_X + DOT_R * 2 + DOT_GAP)
      .attr('y', legendY)
      .attr('dy', '0.35em')
      .attr('fill', textColor)
      .attr('font-size', `${FONT_SIZE}px`)
      .attr('font-family', FONT_FAMILY)
      .text(grp.name);

    legendX += pillW + GAP;
  }
}

// ============================================================
// Timeline — setup helper (extracted from renderTimeline)
// ============================================================

type Lane = { name: string; events: TimelineEvent[] };

type TimelineSetup = {
  width: number;
  height: number;
  isVertical: boolean;
  tooltip: HTMLDivElement;
  solid: boolean;
  textColor: string;
  mutedColor: string;
  bgColor: string;
  bg: string;
  swimlaneTagGroup: string | null;
  groupColorMap: Map<string, string>;
  tagLanes: Lane[] | null;
  eventColor: (ev: TimelineEvent) => string;
  minDate: number;
  maxDate: number;
  datePadding: number;
  earliestStartDateStr: string;
  latestEndDateStr: string;
  tagLegendReserve: number;
  ctx: ScaleContext;
};

/**
 * Computes layout context (dimensions, colors, date domain, tag lanes,
 * event-color resolver) for a timeline before the orientation-specific
 * rendering branch runs. Returns null when there is nothing to render
 * (empty events or zero-sized container).
 *
 * Side effects: clears the container and creates the tooltip element.
 */
function setupTimeline(
  container: HTMLDivElement,
  parsed: ParsedTimeline,
  palette: PaletteColors,
  isDark: boolean,
  exportDims: D3ExportDimensions | undefined,
  activeTagGroup: string | null | undefined,
  swimlaneTagGroup: string | null | undefined
): TimelineSetup | null {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const solid = parsed.solidFill === true;

  const {
    timelineEvents,
    timelineGroups,
    timelineEras,
    timelineMarkers,
    timelineSort,
    orientation,
  } = parsed;
  if (timelineEvents.length === 0) return null;

  let resolvedSwimlaneTG: string | null = swimlaneTagGroup ?? null;
  if (
    resolvedSwimlaneTG == null &&
    timelineSort === 'tag' &&
    parsed.timelineDefaultSwimlaneTG
  ) {
    resolvedSwimlaneTG = parsed.timelineDefaultSwimlaneTG;
  }

  const tooltip = createTooltip(container, palette, isDark);

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return null;

  const isVertical = orientation === 'vertical';

  const textColor = palette.text;
  const mutedColor = palette.border;
  const bgColor = palette.bg;
  const bg = themeBaseBg(palette, isDark);
  const colors = getSeriesColors(palette);

  const groupColorMap = new Map<string, string>();
  timelineGroups.forEach((grp, i) => {
    // colors is non-empty; modulo guarantees in-bounds.
    groupColorMap.set(grp.name, grp.color ?? colors[i % colors.length]!);
  });

  let tagLanes: Lane[] | null = null;

  if (resolvedSwimlaneTG) {
    const tagKey = tagAttrKey(resolvedSwimlaneTG);
    const tagGroup = parsed.timelineTagGroups.find(
      (g) => g.name.toLowerCase() === tagKey
    );
    if (tagGroup) {
      const buckets = new Map<string, TimelineEvent[]>();
      const otherEvents: TimelineEvent[] = [];
      for (const ev of timelineEvents) {
        const val = ev.metadata[tagKey];
        if (val) {
          const list = buckets.get(val) ?? [];
          list.push(ev);
          buckets.set(val, list);
        } else {
          otherEvents.push(ev);
        }
      }

      const laneEntries = [...buckets.entries()].sort((a, b) => {
        const aMin = Math.min(...a[1].map((e) => parseTimelineDate(e.date)));
        const bMin = Math.min(...b[1].map((e) => parseTimelineDate(e.date)));
        return aMin - bMin;
      });

      tagLanes = laneEntries.map(([name, events]) => ({ name, events }));
      if (otherEvents.length > 0) {
        tagLanes.push({ name: '(Other)', events: otherEvents });
      }

      for (const entry of tagGroup.entries) {
        groupColorMap.set(entry.value, entry.color);
      }
    }
  }

  const effectiveColorTG = activeTagGroup ?? resolvedSwimlaneTG ?? null;

  function eventColor(ev: TimelineEvent): string {
    if (effectiveColorTG) {
      const tagColor = resolveTagColor(
        ev.metadata,
        parsed.timelineTagGroups,
        effectiveColorTG
      );
      if (tagColor) return tagColor;
    }
    if (ev.group && groupColorMap.has(ev.group)) {
      return groupColorMap.get(ev.group)!;
    }
    return textColor;
  }

  let minDate = Infinity;
  let maxDate = -Infinity;
  let earliestStartDateStr = '';
  let latestEndDateStr = '';

  for (const ev of timelineEvents) {
    const startNum = parseTimelineDate(ev.date);
    const endNum = ev.endDate ? parseTimelineDate(ev.endDate) : startNum;

    if (startNum < minDate) {
      minDate = startNum;
      earliestStartDateStr = ev.date;
    }
    if (endNum > maxDate) {
      maxDate = endNum;
      latestEndDateStr = ev.endDate ?? ev.date;
    }
  }

  for (const era of timelineEras) {
    const eraStartNum = parseTimelineDate(era.startDate);
    const eraEndNum = parseTimelineDate(era.endDate);
    if (Number.isFinite(eraStartNum) && eraStartNum < minDate) {
      minDate = eraStartNum;
      earliestStartDateStr = era.startDate;
    }
    if (Number.isFinite(eraEndNum) && eraEndNum > maxDate) {
      maxDate = eraEndNum;
      latestEndDateStr = era.endDate;
    }
  }
  for (const marker of timelineMarkers) {
    const markerNum = parseTimelineDate(marker.date);
    if (!Number.isFinite(markerNum)) continue;
    if (markerNum < minDate) {
      minDate = markerNum;
      earliestStartDateStr = marker.date;
    }
    if (markerNum > maxDate) {
      maxDate = markerNum;
      latestEndDateStr = marker.date;
    }
  }
  const datePadding = (maxDate - minDate) * 0.05 || 0.5;

  const tagLegendReserve = parsed.timelineTagGroups.length > 0 ? 36 : 0;

  const idealWidth = isVertical
    ? 500
    : Math.max(600, timelineEvents.length * 40 + 200);
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  return {
    width,
    height,
    isVertical,
    tooltip,
    solid,
    textColor,
    mutedColor,
    bgColor,
    bg,
    swimlaneTagGroup: resolvedSwimlaneTG,
    groupColorMap,
    tagLanes,
    eventColor,
    minDate,
    maxDate,
    datePadding,
    earliestStartDateStr,
    latestEndDateStr,
    tagLegendReserve,
    ctx,
  };
}

// ============================================================
// Timeline — hover helpers (extracted from renderTimeline)
// ============================================================

type TimelineHoverHelpers = {
  FADE_OPACITY: number;
  fadeToGroup: (
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    groupName: string
  ) => void;
  fadeToEra: (
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    eraStart: number,
    eraEnd: number
  ) => void;
  fadeToMarker: (
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    markerDate: number
  ) => void;
  fadeReset: (
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>
  ) => void;
  fadeToTagValue: (
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    tagKey: string,
    tagValue: string
  ) => void;
  setTagAttrs: (
    evG: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    ev: TimelineEvent
  ) => void;
};

/**
 * Shared hover helpers for timeline rendering. Operate on CSS classes,
 * orientation-agnostic. Used by all three rendering branches.
 */
function makeTimelineHoverHelpers(): TimelineHoverHelpers {
  const FADE_OPACITY = 0.1;

  function fadeToGroup(
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    groupName: string
  ) {
    g.selectAll<SVGGElement, unknown>('.tl-event').each(function () {
      const el = d3Selection.select(this);
      const evGroup = el.attr('data-group');
      el.attr('opacity', evGroup === groupName ? 1 : FADE_OPACITY);
    });
    g.selectAll<SVGGElement, unknown>('.tl-legend-item, .tl-lane-header').each(
      function () {
        const el = d3Selection.select(this);
        const name = el.attr('data-group');
        el.attr('opacity', name === groupName ? 1 : FADE_OPACITY);
      }
    );
    g.selectAll<SVGGElement, unknown>('.tl-marker').attr(
      'opacity',
      FADE_OPACITY
    );
  }

  function fadeToEra(
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    eraStart: number,
    eraEnd: number
  ) {
    g.selectAll<SVGGElement, unknown>('.tl-event').each(function () {
      const el = d3Selection.select(this);
      const date = parseFloat(el.attr('data-date')!);
      const endDate = el.attr('data-end-date');
      const evEnd = endDate ? parseFloat(endDate) : date;
      const inside = evEnd >= eraStart && date <= eraEnd;
      el.attr('opacity', inside ? 1 : FADE_OPACITY);
    });
    g.selectAll<SVGGElement, unknown>('.tl-legend-item, .tl-lane-header').attr(
      'opacity',
      FADE_OPACITY
    );
    g.selectAll<SVGGElement, unknown>('.tl-era').each(function () {
      const el = d3Selection.select(this);
      const s = parseFloat(el.attr('data-era-start')!);
      const e = parseFloat(el.attr('data-era-end')!);
      const isSelf = s === eraStart && e === eraEnd;
      el.attr('opacity', isSelf ? 1 : FADE_OPACITY);
    });
    g.selectAll<SVGGElement, unknown>('.tl-marker').each(function () {
      const el = d3Selection.select(this);
      const date = parseFloat(el.attr('data-marker-date')!);
      const inside = date >= eraStart && date <= eraEnd;
      el.attr('opacity', inside ? 1 : FADE_OPACITY);
    });
  }

  function fadeToMarker(
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    markerDate: number
  ) {
    g.selectAll<SVGGElement, unknown>('.tl-event').attr(
      'opacity',
      FADE_OPACITY
    );
    g.selectAll<SVGGElement, unknown>('.tl-era').attr('opacity', FADE_OPACITY);
    g.selectAll<SVGGElement, unknown>('.tl-legend-item, .tl-lane-header').attr(
      'opacity',
      FADE_OPACITY
    );
    g.selectAll<SVGGElement, unknown>('.tl-marker').each(function () {
      const el = d3Selection.select(this);
      const date = parseFloat(el.attr('data-marker-date')!);
      el.attr('opacity', date === markerDate ? 1 : FADE_OPACITY);
    });
  }

  function fadeReset(
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>
  ) {
    g.selectAll<SVGGElement, unknown>(
      '.tl-event, .tl-legend-item, .tl-lane-header, .tl-marker, .tl-tag-legend-entry'
    ).attr('opacity', 1);
    g.selectAll<SVGGElement, unknown>('.tl-era').attr('opacity', 1);
  }

  function fadeToTagValue(
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    tagKey: string,
    tagValue: string
  ) {
    const attrName = `data-tag-${tagKey}`;
    g.selectAll<SVGGElement, unknown>('.tl-event').each(function () {
      const el = d3Selection.select(this);
      const val = el.attr(attrName);
      el.attr('opacity', val === tagValue ? 1 : FADE_OPACITY);
    });
    g.selectAll<SVGGElement, unknown>('.tl-legend-item, .tl-lane-header').attr(
      'opacity',
      FADE_OPACITY
    );
    g.selectAll<SVGGElement, unknown>('.tl-marker').attr(
      'opacity',
      FADE_OPACITY
    );
    g.selectAll<SVGGElement, unknown>('.tl-tag-legend-entry').each(function () {
      const el = d3Selection.select(this);
      const entryValue = el.attr('data-legend-entry');
      if (entryValue === '__group__') return;
      const entryGroup = el.attr('data-tag-group');
      el.attr(
        'opacity',
        entryGroup === tagKey && entryValue === tagValue ? 1 : FADE_OPACITY
      );
    });
  }

  /** Attach data-tag-* attributes on an event group element */
  function setTagAttrs(
    evG: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    ev: TimelineEvent
  ) {
    for (const [key, value] of Object.entries(ev.metadata)) {
      evG.attr(`data-tag-${key}`, value.toLowerCase());
    }
  }

  return {
    FADE_OPACITY,
    fadeToGroup,
    fadeToEra,
    fadeToMarker,
    fadeReset,
    fadeToTagValue,
    setTagAttrs,
  };
}

// ============================================================
// Timeline — tag-legend overlay (extracted from renderTimeline)
// ============================================================

function renderTimelineTagLegendOverlay(
  container: HTMLDivElement,
  parsed: ParsedTimeline,
  palette: PaletteColors,
  isDark: boolean,
  setup: TimelineSetup,
  hovers: TimelineHoverHelpers,
  onClickItem: ((lineNumber: number) => void) | undefined,
  exportDims: D3ExportDimensions | undefined,
  swimlaneTagGroup: string | null | undefined,
  activeTagGroup: string | null | undefined,
  onTagStateChange:
    | ((activeTagGroup: string | null, swimlaneTagGroup: string | null) => void)
    | undefined,
  viewMode: boolean | undefined,
  exportMode?: boolean
): void {
  if (parsed.timelineTagGroups.length === 0) return;

  const { width, textColor, groupColorMap, solid } = setup;
  const { FADE_OPACITY, fadeReset, fadeToTagValue } = hovers;
  const title = parsed.noTitle ? null : parsed.title;
  const { timelineEvents } = parsed;

  const LG_HEIGHT = TL_LEGEND_HEIGHT;
  const LG_PILL_PAD = TL_LEGEND_PILL_PAD;
  const LG_PILL_FONT_SIZE = TL_LEGEND_PILL_FONT_SIZE;
  const LG_CAPSULE_PAD = TL_LEGEND_CAPSULE_PAD;
  const LG_DOT_R = TL_LEGEND_DOT_R;
  const LG_ENTRY_FONT_SIZE = TL_LEGEND_ENTRY_FONT_SIZE;
  const LG_ENTRY_DOT_GAP = TL_LEGEND_ENTRY_DOT_GAP;
  const LG_ENTRY_TRAIL = TL_LEGEND_ENTRY_TRAIL;
  // LG_GROUP_GAP no longer needed — centralized legend handles spacing
  const LG_ICON_W = 20; // swimlane icon area (icon + surrounding space) — local

  const mainSvg = d3Selection.select(container).select<SVGSVGElement>('svg');
  const mainG = mainSvg.select<SVGGElement>('g');
  if (!mainSvg.empty() && !mainG.empty()) {
    // Position legend at top, below title
    const legendY = title ? 50 : 10;

    // Pre-compute group widths (minified and expanded)
    type LegendGroup = {
      group: TagGroup;
      minifiedWidth: number;
      expandedWidth: number;
    };
    const legendGroups: LegendGroup[] = parsed.timelineTagGroups.map((g) => {
      const pillW = measureLegendText(g.name, LG_PILL_FONT_SIZE) + LG_PILL_PAD;
      // Expanded: pill + icon (unless viewMode) + entries
      const iconSpace = viewMode ? 8 : LG_ICON_W + 4;
      let entryX = LG_CAPSULE_PAD + pillW + iconSpace;
      for (const entry of g.entries) {
        const textX = entryX + LG_DOT_R * 2 + LG_ENTRY_DOT_GAP;
        entryX =
          textX +
          measureLegendText(entry.value, LG_ENTRY_FONT_SIZE) +
          LG_ENTRY_TRAIL;
      }
      return {
        group: g,
        minifiedWidth: pillW,
        expandedWidth: entryX + LG_CAPSULE_PAD,
      };
    });

    // Two independent state axes: swimlane source + color source
    let currentActiveGroup: string | null = activeTagGroup ?? null;
    let currentSwimlaneGroup: string | null = swimlaneTagGroup ?? null;

    /** Render the swimlane icon (3 horizontal bars of varying width) */
    function drawSwimlaneIcon(
      parent: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
      x: number,
      y: number,
      isSwimActive: boolean
    ) {
      const iconG = parent
        .append('g')
        .attr('class', 'tl-swimlane-icon')
        .attr('transform', `translate(${x}, ${y})`)
        .style('cursor', 'pointer');

      // Transparent hit area so the whole icon (not just the 2px bars) is clickable
      iconG
        .append('rect')
        .attr('x', -5)
        .attr('y', -5)
        .attr('width', 22)
        .attr('height', 20)
        .attr('fill', 'transparent');

      const barColor = isSwimActive ? palette.primary : palette.textMuted;
      const barOpacity = isSwimActive ? 1 : 0.35;
      const bars = [
        { y: 0, w: 8 },
        { y: 4, w: 12 },
        { y: 8, w: 6 },
      ];
      for (const bar of bars) {
        iconG
          .append('rect')
          .attr('x', 0)
          .attr('y', bar.y)
          .attr('width', bar.w)
          .attr('height', 2)
          .attr('rx', 1)
          .attr('fill', barColor)
          .attr('opacity', barOpacity);
      }
      return iconG;
    }

    /** Full re-render with updated swimlane state */
    function relayout() {
      renderTimeline(
        container,
        parsed,
        palette,
        isDark,
        onClickItem,
        exportDims,
        currentActiveGroup,
        currentSwimlaneGroup,
        onTagStateChange,
        viewMode
      );
    }

    function drawLegend() {
      // Remove previous legend
      mainSvg.selectAll('.tl-tag-legend-group').remove();
      mainSvg.selectAll('.tl-tag-legend-container').remove();

      // Effective color source: explicit color group > swimlane group
      const effectiveColorKey =
        (currentActiveGroup ?? currentSwimlaneGroup)?.toLowerCase() ?? null;

      // In view mode, only show the color-driving tag group (expanded, non-interactive).
      // Skip the swimlane group if it's separate from the color group (lane headers already label it).
      const visibleGroups = viewMode
        ? legendGroups.filter(
            (lg) =>
              effectiveColorKey != null &&
              lg.group.name.toLowerCase() === effectiveColorKey
          )
        : legendGroups;

      if (visibleGroups.length === 0) return;

      // Legend container for data-legend-active attribute
      const legendContainer = mainSvg
        .append('g')
        .attr('class', 'tl-tag-legend-container');
      if (currentActiveGroup) {
        legendContainer.attr(
          'data-legend-active',
          currentActiveGroup.toLowerCase()
        );
      }

      // Render tag groups via centralized legend system
      const iconAddon = viewMode ? 0 : LG_ICON_W;
      const centralGroups = visibleGroups.map((lg) => ({
        name: lg.group.name,
        entries: lg.group.entries.map((e) => ({
          value: e.value,
          color: e.color,
        })),
      }));

      // Determine effective active group for centralized renderer
      const centralActive = viewMode ? effectiveColorKey : currentActiveGroup;

      const centralConfig: LegendConfig = {
        groups: centralGroups,
        position: { placement: 'top-center', titleRelation: 'below-title' },
        mode: exportMode ? 'export' : 'preview',
        capsulePillAddonWidth: iconAddon,
      };
      const centralCallbacks: LegendCallbacks = viewMode
        ? {}
        : {
            onGroupToggle: (groupName) => {
              currentActiveGroup =
                currentActiveGroup === groupName.toLowerCase()
                  ? null
                  : groupName.toLowerCase();
              drawLegend();
              recolorEvents();
              onTagStateChange?.(currentActiveGroup, currentSwimlaneGroup);
            },
            onEntryHover: (groupName, entryValue) => {
              const tagKey = tagAttrKey(groupName);
              if (entryValue) {
                const tagVal = entryValue.toLowerCase();
                fadeToTagValue(mainG, tagKey, tagVal);
                mainSvg
                  .selectAll<SVGGElement, unknown>('[data-legend-entry]')
                  .each(function () {
                    const el = d3Selection.select(this);
                    const ev = el.attr('data-legend-entry');
                    const eg =
                      el.attr('data-tag-group') ??
                      (el.node() as Element)
                        ?.closest?.('[data-tag-group]')
                        ?.getAttribute('data-tag-group');
                    el.attr(
                      'opacity',
                      eg === tagKey && ev === tagVal ? 1 : FADE_OPACITY
                    );
                  });
              } else {
                fadeReset(mainG);
                mainSvg
                  .selectAll<SVGGElement, unknown>('[data-legend-entry]')
                  .attr('opacity', 1);
              }
            },
            onGroupRendered: (groupName, groupEl, isActive) => {
              const groupKey = tagAttrKey(groupName);
              groupEl.attr('data-tag-group', groupKey);
              if (isActive && !viewMode) {
                const isSwimActive =
                  currentSwimlaneGroup?.toLowerCase() === groupKey;
                const pillWidth =
                  measureLegendText(groupName, LG_PILL_FONT_SIZE) + LG_PILL_PAD;
                const pillXOff = LG_CAPSULE_PAD;
                const iconX = pillXOff + pillWidth + 5;
                const iconY = (LG_HEIGHT - 10) / 2;
                const iconEl = drawSwimlaneIcon(
                  groupEl,
                  iconX,
                  iconY,
                  isSwimActive
                );
                iconEl
                  .attr('data-swimlane-toggle', groupKey)
                  .on('click', (event: MouseEvent) => {
                    event.stopPropagation();
                    currentSwimlaneGroup =
                      currentSwimlaneGroup === groupKey ? null : groupKey;
                    onTagStateChange?.(
                      currentActiveGroup,
                      currentSwimlaneGroup
                    );
                    relayout();
                  });
              }
            },
          };

      const legendInnerG = legendContainer
        .append('g')
        .attr('transform', `translate(0, ${legendY})`);
      renderIntegratedLegend(legendInnerG, {
        ...centralConfig,
        palette,
        isDark,
        width,
        activeGroup: centralActive,
        callbacks: centralCallbacks,
      });
    }

    // Build a quick lineNumber→event lookup
    const eventByLine = new Map<string, TimelineEvent>();
    for (const ev of timelineEvents) {
      eventByLine.set(String(ev.lineNumber), ev);
    }

    function recolorEvents() {
      const colorTG = currentActiveGroup ?? swimlaneTagGroup ?? null;
      mainG.selectAll<SVGGElement, unknown>('.tl-event').each(function () {
        const el = d3Selection.select(this);
        const lineNum = el.attr('data-line-number');
        const ev = lineNum ? eventByLine.get(lineNum) : undefined;
        if (!ev) return;

        let color: string;
        if (colorTG) {
          const tagColor = resolveTagColor(
            ev.metadata,
            parsed.timelineTagGroups,
            colorTG
          );
          color =
            tagColor ??
            (ev.group && groupColorMap.has(ev.group)
              ? groupColorMap.get(ev.group)!
              : textColor);
        } else {
          color =
            ev.group && groupColorMap.has(ev.group)
              ? groupColorMap.get(ev.group)!
              : textColor;
        }
        el.selectAll('rect')
          .attr('fill', shapeFill(palette, color, isDark, { solid }))
          .attr('stroke', color);
        el.selectAll('circle:not(.tl-event-point-outline)')
          .attr('fill', shapeFill(palette, color, isDark, { solid }))
          .attr('stroke', color);
      });
    }

    drawLegend();
  }
}

// ============================================================
// Timeline — horizontal-time-sort renderer (extracted from renderTimeline)
// ============================================================

function renderTimelineHorizontalTimeSort(
  container: HTMLDivElement,
  parsed: ParsedTimeline,
  palette: PaletteColors,
  isDark: boolean,
  setup: TimelineSetup,
  hovers: TimelineHoverHelpers,
  onClickItem: ((lineNumber: number) => void) | undefined,
  exportDims: D3ExportDimensions | undefined,
  _swimlaneTagGroup: string | null | undefined,
  _activeTagGroup: string | null | undefined,
  _onTagStateChange:
    | ((activeTagGroup: string | null, swimlaneTagGroup: string | null) => void)
    | undefined,
  _viewMode: boolean | undefined
): void {
  const {
    width,
    height,
    tooltip,
    solid,
    textColor,
    bgColor,
    bg,
    groupColorMap,
    eventColor,
    minDate,
    maxDate,
    datePadding,
    earliestStartDateStr,
    latestEndDateStr,
    tagLegendReserve,
    ctx,
  } = setup;
  const { fadeToGroup, fadeToEra, fadeToMarker, fadeReset, setTagAttrs } =
    hovers;
  const {
    timelineEvents,
    timelineGroups,
    timelineEras,
    timelineMarkers,
    timelineScale,
  } = parsed;
  const title = parsed.noTitle ? null : parsed.title;

  const sBarH = ctx.structural(22);
  const sPointR = ctx.structural(5);
  const sPointStroke = ctx.structural(2);
  const sBarRx = ctx.structural(4);
  const sBarStroke = ctx.structural(2);
  const sEventFont = ctx.text(13);
  const sEventFontSm = ctx.text(12);
  const sCharW = ctx.structural(7);

  // === TIME SORT, horizontal: each event on its own row ===
  const sorted = timelineEvents
    .slice()
    .sort((a, b) => parseTimelineDate(a.date) - parseTimelineDate(b.date));

  const scaleMargin = timelineScale ? ctx.aesthetic(24) : 0;
  const ERA_ROW_H = ctx.structural(22);
  const MARKER_ROW_H = ctx.structural(22);
  const eraReserve = timelineEras.length > 0 ? ERA_ROW_H : 0;
  const markerReserve = timelineMarkers.length > 0 ? MARKER_ROW_H : 0;
  const topScaleH = timelineScale ? ctx.structural(40) : 0;
  const margin = {
    top:
      ctx.aesthetic(104) +
      topScaleH +
      eraReserve +
      markerReserve +
      tagLegendReserve,
    right: ctx.aesthetic(40),
    bottom: ctx.aesthetic(40) + scaleMargin,
    left: ctx.aesthetic(60),
  };
  const markerLabelY = markerReserve ? -(topScaleH + MARKER_ROW_H / 2) : 0;
  const eraLabelY = eraReserve
    ? -(topScaleH + markerReserve + ERA_ROW_H / 2)
    : 0;
  const innerWidth = width - margin.left - margin.right;
  // Each event gets a fixed comfortable row. The old behaviour compressed rowH
  // to fit the container height (`min(28, avail / n)`), but that only ever
  // shrank rows BELOW the 22px bar height — cramming events into overlap when
  // the host surface was shorter than the content required (e.g. the app's
  // fixed-height embedded-diagram surface). A constant rowH never overlaps:
  // when the container is taller than needed the SVG shrinks to the content
  // (top-aligned via preserveAspectRatio); when shorter, the SVG grows past it
  // and the host collapses/expands to the rendered height. This also makes the
  // interactive preview match the exported image, which already used rowH=28.
  const rowH = ctx.structural(28);
  // Draw the era bands and time axis to the content height (not the full
  // container) so the axis sits just below the last event.
  const innerHeight = rowH * sorted.length;
  const usedHeight = margin.top + innerHeight + margin.bottom;

  // On-screen (non-export) the content can be taller than the host pane. Rather
  // than overflow it (forcing the user to scroll), scale the whole SVG down to
  // fit the available height: the viewBox keeps the natural content geometry
  // while the rendered height is clamped to the container, and
  // preserveAspectRatio uniformly shrinks + centers it. Export keeps the full
  // natural height so the image is never compressed.
  const fitToContainer = !exportDims && height > 0 && usedHeight > height;
  const svgHeight = fitToContainer ? height : usedHeight;

  const xScale = d3Scale
    .scaleLinear()
    .domain([minDate - datePadding, maxDate + datePadding])
    .range([0, innerWidth]);

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', svgHeight)
    .attr('viewBox', `0 0 ${width} ${usedHeight}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('background', bgColor);

  if (ctx.isBelowFloor && !fitToContainer) {
    svg.attr('width', '100%');
  }

  const g = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  renderEras(
    g,
    timelineEras,
    xScale,
    false,
    innerWidth,
    innerHeight,
    (s, e) => fadeToEra(g, s, e),
    () => fadeReset(g),
    timelineScale,
    tooltip,
    palette,
    eraReserve ? eraLabelY : undefined
  );

  renderMarkers(
    g,
    timelineMarkers,
    xScale,
    false,
    innerWidth,
    innerHeight,
    (d) => fadeToMarker(g, d),
    () => fadeReset(g),
    timelineScale,
    tooltip,
    palette,
    markerReserve ? markerLabelY : undefined
  );

  if (timelineScale) {
    renderTimeScale(
      g,
      xScale,
      false,
      innerWidth,
      innerHeight,
      textColor,
      minDate,
      maxDate,
      formatBoundaryLabel(earliestStartDateStr, latestEndDateStr),
      formatBoundaryLabel(latestEndDateStr, earliestStartDateStr)
    );
  }

  // Group legend at top-left (pill style)
  if (timelineGroups.length > 0) {
    const legendY = timelineScale ? -ctx.aesthetic(75) : -ctx.aesthetic(55);
    renderTimelineGroupLegend(
      g,
      timelineGroups,
      groupColorMap,
      textColor,
      palette,
      isDark,
      legendY,
      (name) => fadeToGroup(g, name),
      () => fadeReset(g)
    );
  }

  sorted.forEach((ev, i) => {
    // Marker labels live in their reserved row above the chart, so the
    // first event sits at the chart top edge.
    const y = i * rowH + rowH / 2;
    const x = xScale(parseTimelineDate(ev.date));
    const color = eventColor(ev);

    const evG = g
      .append('g')
      .attr('class', 'tl-event')
      .attr('data-group', ev.group || '')
      .attr('data-line-number', String(ev.lineNumber))
      .attr('data-date', String(parseTimelineDate(ev.date)))
      .attr(
        'data-end-date',
        ev.endDate ? String(parseTimelineDate(ev.endDate)) : null
      )
      .style('cursor', 'pointer')
      .on('mouseenter', function (event: MouseEvent) {
        if (ev.group && timelineGroups.length > 0) fadeToGroup(g, ev.group);
        if (timelineScale) {
          showEventDatesOnScale(
            g,
            xScale,
            ev.date,
            ev.endDate,
            innerHeight,
            color
          );
        } else {
          showTooltip(tooltip, buildEventTooltipHtml(ev), event);
        }
      })
      .on('mouseleave', function () {
        fadeReset(g);
        if (timelineScale) {
          hideEventDatesOnScale(g);
        } else {
          hideTooltip(tooltip);
        }
      })
      .on('mousemove', function (event: MouseEvent) {
        if (!timelineScale) {
          showTooltip(tooltip, buildEventTooltipHtml(ev), event);
        }
      })
      .on('click', () => {
        if (onClickItem && ev.lineNumber) onClickItem(ev.lineNumber);
      });
    setTagAttrs(evG, ev);

    if (ev.endDate) {
      const x2 = xScale(parseTimelineDate(ev.endDate));
      const rectW = Math.max(x2 - x, 4);
      const estLabelWidth = ev.label.length * sCharW + ctx.aesthetic(16);
      const labelFitsInside = rectW >= estLabelWidth;

      let fill: string = shapeFill(palette, color, isDark, { solid });
      let stroke: string = color;
      if (ev.uncertain) {
        const gradientId = `uncertain-ts-${ev.lineNumber}`;
        const strokeGradientId = `uncertain-ts-s-${ev.lineNumber}`;
        const defs = svg.select('defs').node() || svg.append('defs').node();
        const defsEl = d3Selection.select(defs as Element);
        defsEl
          .append('linearGradient')
          .attr('id', gradientId)
          .attr('x1', '0%')
          .attr('y1', '0%')
          .attr('x2', '100%')
          .attr('y2', '0%')
          .selectAll('stop')
          .data([
            { offset: '0%', opacity: 1 },
            { offset: '80%', opacity: 1 },
            { offset: '100%', opacity: 0 },
          ])
          .enter()
          .append('stop')
          .attr('offset', (d) => d.offset)
          .attr('stop-color', mix(color, bg, 30))
          .attr('stop-opacity', (d) => d.opacity);
        defsEl
          .append('linearGradient')
          .attr('id', strokeGradientId)
          .attr('x1', '0%')
          .attr('y1', '0%')
          .attr('x2', '100%')
          .attr('y2', '0%')
          .selectAll('stop')
          .data([
            { offset: '0%', opacity: 1 },
            { offset: '80%', opacity: 1 },
            { offset: '100%', opacity: 0 },
          ])
          .enter()
          .append('stop')
          .attr('offset', (d) => d.offset)
          .attr('stop-color', color)
          .attr('stop-opacity', (d) => d.opacity);
        fill = `url(#${gradientId})`;
        stroke = `url(#${strokeGradientId})`;
      }

      evG
        .append('rect')
        .attr('x', x)
        .attr('y', y - sBarH / 2)
        .attr('width', rectW)
        .attr('height', sBarH)
        .attr('rx', sBarRx)
        .attr('fill', fill)
        .attr('stroke', stroke)
        .attr('stroke-width', sBarStroke);

      if (labelFitsInside) {
        evG
          .append('text')
          .attr('x', x + ctx.aesthetic(8))
          .attr('y', y)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'start')
          .attr('fill', textColor)
          .attr('font-size', `${sEventFont}px`)
          .text(ev.label);
      } else {
        const sLabelGap = ctx.aesthetic(6);
        const wouldFlipLeft = x + rectW > innerWidth * 0.6;
        const labelFitsLeft = x - sLabelGap - estLabelWidth > 0;
        const flipLeft = wouldFlipLeft && labelFitsLeft;
        evG
          .append('text')
          .attr('x', flipLeft ? x - sLabelGap : x + rectW + sLabelGap)
          .attr('y', y)
          .attr('dy', '0.35em')
          .attr('text-anchor', flipLeft ? 'end' : 'start')
          .attr('fill', textColor)
          .attr('font-size', `${sEventFont}px`)
          .text(ev.label);
      }
    } else {
      const estLabelWidth = ev.label.length * sCharW;
      const sPointGap = ctx.aesthetic(10);
      const wouldFlipLeft = x > innerWidth * 0.6;
      const labelFitsLeft = x - sPointGap - estLabelWidth > 0;
      const flipLeft = wouldFlipLeft && labelFitsLeft;
      evG
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', sPointR)
        .attr('fill', shapeFill(palette, color, isDark, { solid }))
        .attr('stroke', color)
        .attr('stroke-width', sPointStroke);
      evG
        .append('text')
        .attr('x', flipLeft ? x - sPointGap : x + sPointGap)
        .attr('y', y)
        .attr('dy', '0.35em')
        .attr('text-anchor', flipLeft ? 'end' : 'start')
        .attr('fill', textColor)
        .attr('font-size', `${sEventFontSm}px`)
        .text(ev.label);
    }
  });
}

// ============================================================
// Timeline — horizontal-grouped renderer (extracted from renderTimeline)
// ============================================================

function renderTimelineHorizontalGrouped(
  container: HTMLDivElement,
  parsed: ParsedTimeline,
  palette: PaletteColors,
  isDark: boolean,
  setup: TimelineSetup,
  hovers: TimelineHoverHelpers,
  onClickItem: ((lineNumber: number) => void) | undefined,
  _exportDims: D3ExportDimensions | undefined,
  _swimlaneTagGroup: string | null | undefined,
  _activeTagGroup: string | null | undefined,
  _onTagStateChange:
    | ((activeTagGroup: string | null, swimlaneTagGroup: string | null) => void)
    | undefined,
  _viewMode: boolean | undefined,
  collapsedGroups: Set<string>,
  toggleGroup: (name: string) => void
): void {
  const {
    width,
    height,
    tooltip,
    solid,
    textColor,
    bgColor,
    bg,
    groupColorMap,
    tagLanes,
    eventColor,
    minDate,
    maxDate,
    datePadding,
    earliestStartDateStr,
    latestEndDateStr,
    tagLegendReserve,
    ctx,
  } = setup;
  const { fadeToGroup, fadeToEra, fadeToMarker, fadeReset, setTagAttrs } =
    hovers;
  const {
    timelineEvents,
    timelineGroups,
    timelineEras,
    timelineMarkers,
    timelineScale,
  } = parsed;
  const title = parsed.noTitle ? null : parsed.title;

  const sBarH = ctx.structural(22);
  const sGroupGap = ctx.aesthetic(12);
  const sPointR = ctx.structural(5);
  const sPointStroke = ctx.structural(2);
  const sBarRx = ctx.structural(4);
  const sBarStroke = ctx.structural(2);
  const sEventFont = ctx.text(13);
  const sCharW = ctx.structural(7);
  const sLaneHeaderFont = ctx.text(12);

  // === GROUPED: swim-lanes stacked vertically, events on own rows ===
  let lanes: Lane[];

  if (tagLanes) {
    lanes = tagLanes;
  } else {
    const groupNames = timelineGroups.map((gr) => gr.name);
    const ungroupedEvents = timelineEvents.filter(
      (ev) => ev.group === null || !groupNames.includes(ev.group)
    );
    const laneNames =
      ungroupedEvents.length > 0 ? [...groupNames, '(Other)'] : groupNames;
    lanes = laneNames.map((name) => ({
      name,
      events: timelineEvents.filter((ev) =>
        name === '(Other)'
          ? ev.group === null || !groupNames.includes(ev.group)
          : ev.group === name
      ),
    }));
  }

  const totalRows = lanes.reduce((s, l) => {
    if (collapsedGroups.has(l.name)) return s + 1;
    return s + l.events.length + 1;
  }, 0);
  const scaleMargin = timelineScale ? ctx.aesthetic(24) : 0;
  // Per-feature header rows: era + marker each get their own row, reserved
  // only when present (mirrors the gantt header stack).
  const ERA_ROW_H = ctx.structural(22);
  const MARKER_ROW_H = ctx.structural(22);
  const eraReserve = timelineEras.length > 0 ? ERA_ROW_H : 0;
  const markerReserve = timelineMarkers.length > 0 ? MARKER_ROW_H : 0;
  const topScaleH = timelineScale ? ctx.structural(40) : 0;
  const maxGroupNameLen = Math.max(...lanes.map((l) => l.name.length)) + 2;
  const maxEventLabelLen = Math.max(
    0,
    ...lanes.flatMap((l) => l.events.map((ev) => ev.label.length + 2))
  );
  const maxLeftLabelLen = Math.max(maxGroupNameLen, maxEventLabelLen);
  const dynamicLeftMargin = Math.max(
    ctx.aesthetic(140),
    maxLeftLabelLen * sCharW + ctx.aesthetic(30)
  );
  const baseTopMargin = title ? ctx.aesthetic(50) : ctx.aesthetic(20);
  const margin = {
    top:
      baseTopMargin + topScaleH + eraReserve + markerReserve + tagLegendReserve,
    right: ctx.aesthetic(40),
    bottom: ctx.aesthetic(40) + scaleMargin,
    left: dynamicLeftMargin,
  };
  const markerLabelY = markerReserve ? -(topScaleH + MARKER_ROW_H / 2) : 0;
  const eraLabelY = eraReserve
    ? -(topScaleH + markerReserve + ERA_ROW_H / 2)
    : 0;
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const totalGaps = (lanes.length - 1) * sGroupGap;
  const rowH = Math.min(
    ctx.structural(28),
    (innerHeight - totalGaps) / totalRows
  );

  const xScale = d3Scale
    .scaleLinear()
    .domain([minDate - datePadding, maxDate + datePadding])
    .range([0, innerWidth]);

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('background', bgColor);

  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const g = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  renderEras(
    g,
    timelineEras,
    xScale,
    false,
    innerWidth,
    innerHeight,
    (s, e) => fadeToEra(g, s, e),
    () => fadeReset(g),
    timelineScale,
    tooltip,
    palette,
    eraReserve ? eraLabelY : undefined
  );

  renderMarkers(
    g,
    timelineMarkers,
    xScale,
    false,
    innerWidth,
    innerHeight,
    (d) => fadeToMarker(g, d),
    () => fadeReset(g),
    timelineScale,
    tooltip,
    palette,
    markerReserve ? markerLabelY : undefined
  );

  if (timelineScale) {
    renderTimeScale(
      g,
      xScale,
      false,
      innerWidth,
      innerHeight,
      textColor,
      minDate,
      maxDate,
      formatBoundaryLabel(earliestStartDateStr, latestEndDateStr),
      formatBoundaryLabel(latestEndDateStr, earliestStartDateStr)
    );
  }

  // Marker labels now live in their reserved row above the chart, so
  // events can start at y=0 (chart top edge).
  let curY = 0;

  for (const lane of lanes) {
    const laneColor = groupColorMap.get(lane.name) ?? textColor;
    const isCollapsed = collapsedGroups.has(lane.name);
    const toggleIcon = isCollapsed ? '▶' : '▼';

    // Header label band — gantt-style: spans only the left label column.
    // Band height matches the event bar height (sBarH) instead of the full
    // row stride (rowH), leaving a small gap below — same look as gantt.
    const bandX = -margin.left + 5;
    const bandW = margin.left - 7;
    const bandY = curY;
    const bandH = sBarH;
    const sBandRx = ctx.structural(4);
    const sBandAccentW = ctx.structural(4);

    const clipId = `tl-band-clip-${tlBandClipCounter++}`;
    g.append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', bandX)
      .attr('y', bandY)
      .attr('width', bandW)
      .attr('height', bandH)
      .attr('rx', sBandRx);

    g.append('rect')
      .attr('class', 'tl-group-header-bg')
      .attr('data-group', lane.name)
      .attr('x', bandX)
      .attr('y', bandY)
      .attr('width', bandW)
      .attr('height', bandH)
      .attr('rx', sBandRx)
      .attr('fill', shapeFill(palette, laneColor, isDark, { solid }))
      .style('pointer-events', 'none');

    g.append('rect')
      .attr('class', 'tl-group-header-accent')
      .attr('data-group', lane.name)
      .attr('x', bandX)
      .attr('y', bandY)
      .attr('width', sBandAccentW)
      .attr('height', bandH)
      .attr('fill', laneColor)
      .attr('clip-path', `url(#${clipId})`)
      .style('pointer-events', 'none');

    const headerG = g
      .append('g')
      .attr('class', 'tl-group-header')
      .attr('data-group', lane.name)
      .style('cursor', 'pointer')
      .on('mouseenter', () => fadeToGroup(g, lane.name))
      .on('mouseleave', () => fadeReset(g))
      .on('click', () => toggleGroup(lane.name));

    headerG
      .append('text')
      .attr('x', -margin.left + ctx.aesthetic(10))
      .attr('y', curY + sBarH / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'start')
      .attr('fill', textColor)
      .attr('font-size', `${sLaneHeaderFont}px`)
      .attr('font-weight', '600')
      .text(`${toggleIcon} ${lane.name}`);

    // Group bar in time area — spans min→max event dates, always rendered
    // (expanded and collapsed). Visually identical to gantt's group bar.
    if (lane.events.length > 0) {
      const evDates = lane.events.map((ev) => parseTimelineDate(ev.date));
      const evEndDates = lane.events
        .filter((ev) => ev.endDate)
        .map((ev) => parseTimelineDate(ev.endDate!));
      const laneMinD = Math.min(...evDates);
      const laneMaxD = Math.max(...evDates, ...evEndDates);
      const sx1 = xScale(laneMinD);
      const sx2 = xScale(laneMaxD);
      const groupBarW = Math.max(sx2 - sx1, ctx.structural(20));

      const groupBarG = g
        .append('g')
        .attr('class', isCollapsed ? 'tl-group-summary' : 'tl-group-bar')
        .attr('data-group', lane.name)
        .style('cursor', 'pointer')
        .on('mouseenter', () => fadeToGroup(g, lane.name))
        .on('mouseleave', () => fadeReset(g))
        .on('click', () => toggleGroup(lane.name));

      groupBarG
        .append('rect')
        .attr('x', sx1)
        .attr('y', curY)
        .attr('width', groupBarW)
        .attr('height', sBarH)
        .attr('rx', sBarRx)
        .attr('fill', shapeFill(palette, laneColor, isDark, { solid }))
        .attr('stroke', laneColor)
        .attr('stroke-width', sBarStroke);
    }

    if (isCollapsed) {
      curY += rowH + sGroupGap;
      continue;
    }

    lane.events.forEach((ev, i) => {
      const y = curY + (i + 1) * rowH + rowH / 2;
      const x = xScale(parseTimelineDate(ev.date));

      const evG = g
        .append('g')
        .attr('class', 'tl-event')
        .attr('data-group', lane.name)
        .attr('data-line-number', String(ev.lineNumber))
        .attr('data-date', String(parseTimelineDate(ev.date)))
        .attr(
          'data-end-date',
          ev.endDate ? String(parseTimelineDate(ev.endDate)) : null
        )
        .style('cursor', 'pointer')
        .on('mouseenter', function (event: MouseEvent) {
          fadeToGroup(g, lane.name);
          if (timelineScale) {
            showEventDatesOnScale(
              g,
              xScale,
              ev.date,
              ev.endDate,
              innerHeight,
              laneColor
            );
          } else {
            showTooltip(tooltip, buildEventTooltipHtml(ev), event);
          }
        })
        .on('mouseleave', function () {
          fadeReset(g);
          if (timelineScale) {
            hideEventDatesOnScale(g);
          } else {
            hideTooltip(tooltip);
          }
        })
        .on('mousemove', function (event: MouseEvent) {
          if (!timelineScale) {
            showTooltip(tooltip, buildEventTooltipHtml(ev), event);
          }
        })
        .on('click', () => {
          if (onClickItem && ev.lineNumber) onClickItem(ev.lineNumber);
        });
      setTagAttrs(evG, ev);

      const evColor = eventColor(ev);

      // Left column: event label with colored bullet/diamond icon
      const isPoint = !ev.endDate;
      const icon = isPoint ? '◆' : '●';
      const labelEl = evG
        .append('text')
        .attr('class', 'tl-event-label')
        .attr('x', -margin.left + ctx.aesthetic(20))
        .attr('y', y)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('font-size', `${sEventFont}px`)
        .attr('fill', textColor);
      labelEl.append('tspan').attr('fill', evColor).text(icon);
      labelEl
        .append('tspan')
        .attr('fill', textColor)
        .text(' ' + ev.label);

      // Time area: shape only (no floating label)
      if (ev.endDate) {
        const x2 = xScale(parseTimelineDate(ev.endDate));
        const rectW = Math.max(x2 - x, 4);

        let fill: string = shapeFill(palette, evColor, isDark, { solid });
        let stroke: string = evColor;
        if (ev.uncertain) {
          const gradientId = `uncertain-${ev.lineNumber}`;
          const strokeGradientId = `uncertain-s-${ev.lineNumber}`;
          const defs = svg.select('defs').node() || svg.append('defs').node();
          const defsEl = d3Selection.select(defs as Element);
          defsEl
            .append('linearGradient')
            .attr('id', gradientId)
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '100%')
            .attr('y2', '0%')
            .selectAll('stop')
            .data([
              { offset: '0%', opacity: 1 },
              { offset: '80%', opacity: 1 },
              { offset: '100%', opacity: 0 },
            ])
            .enter()
            .append('stop')
            .attr('offset', (d) => d.offset)
            .attr('stop-color', mix(evColor, bg, 30))
            .attr('stop-opacity', (d) => d.opacity);
          defsEl
            .append('linearGradient')
            .attr('id', strokeGradientId)
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '100%')
            .attr('y2', '0%')
            .selectAll('stop')
            .data([
              { offset: '0%', opacity: 1 },
              { offset: '80%', opacity: 1 },
              { offset: '100%', opacity: 0 },
            ])
            .enter()
            .append('stop')
            .attr('offset', (d) => d.offset)
            .attr('stop-color', evColor)
            .attr('stop-opacity', (d) => d.opacity);
          fill = `url(#${gradientId})`;
          stroke = `url(#${strokeGradientId})`;
        }

        evG
          .append('rect')
          .attr('x', x)
          .attr('y', y - sBarH / 2)
          .attr('width', rectW)
          .attr('height', sBarH)
          .attr('rx', sBarRx)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', sBarStroke);
      } else {
        evG
          .append('circle')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', sPointR)
          .attr('fill', shapeFill(palette, evColor, isDark, { solid }))
          .attr('stroke', evColor)
          .attr('stroke-width', sPointStroke);
      }
    });

    curY += (lane.events.length + 1) * rowH + sGroupGap;
  }
}

// ============================================================
// Timeline — vertical-orientation renderer (extracted from renderTimeline)
// ============================================================

function renderTimelineVertical(
  container: HTMLDivElement,
  parsed: ParsedTimeline,
  palette: PaletteColors,
  isDark: boolean,
  setup: TimelineSetup,
  hovers: TimelineHoverHelpers,
  onClickItem: ((lineNumber: number) => void) | undefined,
  exportDims: D3ExportDimensions | undefined,
  _swimlaneTagGroup: string | null | undefined,
  _activeTagGroup: string | null | undefined,
  _onTagStateChange:
    | ((activeTagGroup: string | null, swimlaneTagGroup: string | null) => void)
    | undefined,
  _viewMode: boolean | undefined
): void {
  const {
    width,
    height,
    tooltip,
    solid,
    textColor,
    mutedColor,
    bgColor,
    bg,
    groupColorMap,
    tagLanes,
    eventColor,
    minDate,
    maxDate,
    datePadding,
    earliestStartDateStr,
    latestEndDateStr,
    tagLegendReserve,
    ctx,
  } = setup;
  const { fadeToGroup, fadeToEra, fadeToMarker, fadeReset, setTagAttrs } =
    hovers;
  const {
    timelineEvents,
    timelineGroups,
    timelineEras,
    timelineMarkers,
    timelineSort,
    timelineScale,
    timelineSwimlanes,
  } = parsed;
  const title = parsed.noTitle ? null : parsed.title;

  const sPointR = ctx.structural(4);
  const sPointStroke = ctx.structural(2);
  const sBarRx = ctx.structural(4);
  const sBarStroke = ctx.structural(2);
  const sBarW = ctx.structural(12);
  const sEventFont = ctx.text(10);
  const sEventFontSm = ctx.text(11);
  const sDateFont = ctx.text(10);
  const sLaneHeaderFont = ctx.text(12);
  const sDash = `${ctx.structural(4)},${ctx.structural(4)}`;

  const useGroupedVertical =
    tagLanes != null || (timelineSort === 'group' && timelineGroups.length > 0);
  if (useGroupedVertical) {
    // === GROUPED: one column/lane per group, vertical ===
    let laneNames: string[];
    let laneEventsByName: Map<string, TimelineEvent[]>;

    if (tagLanes) {
      laneNames = tagLanes.map((l) => l.name);
      laneEventsByName = new Map(tagLanes.map((l) => [l.name, l.events]));
    } else {
      const groupNames = timelineGroups.map((gr) => gr.name);
      const ungroupedEvents = timelineEvents.filter(
        (ev) => ev.group === null || !groupNames.includes(ev.group)
      );
      laneNames =
        ungroupedEvents.length > 0 ? [...groupNames, '(Other)'] : groupNames;
      laneEventsByName = new Map(
        laneNames.map((name) => [
          name,
          timelineEvents.filter((ev) =>
            name === '(Other)'
              ? ev.group === null || !groupNames.includes(ev.group)
              : ev.group === name
          ),
        ])
      );
    }

    const laneCount = laneNames.length;
    const scaleMargin = timelineScale ? ctx.aesthetic(40) : 0;
    const markerMargin = timelineMarkers.length > 0 ? ctx.aesthetic(30) : 0;
    const margin = {
      top: ctx.aesthetic(104) + markerMargin + tagLegendReserve,
      right: ctx.aesthetic(40) + scaleMargin,
      bottom: ctx.aesthetic(40),
      left: ctx.aesthetic(60) + scaleMargin,
    };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const laneWidth = innerWidth / laneCount;

    const yScale = d3Scale
      .scaleLinear()
      .domain([minDate - datePadding, maxDate + datePadding])
      .range([0, innerHeight]);

    const svg = d3Selection
      .select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', exportDims ? width : '100%')
      .attr('preserveAspectRatio', 'xMidYMin meet')
      .style('background', bgColor);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    renderChartTitle(
      svg,
      title,
      parsed.titleLineNumber,
      width,
      textColor,
      onClickItem
    );

    renderEras(
      g,
      timelineEras,
      yScale,
      true,
      innerWidth,
      innerHeight,
      (s, e) => fadeToEra(g, s, e),
      () => fadeReset(g),
      timelineScale,
      tooltip,
      palette
    );

    renderMarkers(
      g,
      timelineMarkers,
      yScale,
      true,
      innerWidth,
      innerHeight,
      (d) => fadeToMarker(g, d),
      () => fadeReset(g),
      timelineScale,
      tooltip,
      palette
    );

    if (timelineScale) {
      renderTimeScale(
        g,
        yScale,
        true,
        innerWidth,
        innerHeight,
        textColor,
        minDate,
        maxDate,
        formatBoundaryLabel(earliestStartDateStr, latestEndDateStr),
        formatBoundaryLabel(latestEndDateStr, earliestStartDateStr)
      );
    }

    // Render swimlane backgrounds for vertical lanes
    if (timelineSwimlanes || tagLanes) {
      laneNames.forEach((laneName, laneIdx) => {
        const laneX = laneIdx * laneWidth;
        const fillColor = laneIdx % 2 === 0 ? textColor : 'transparent';
        g.append('rect')
          .attr('class', 'tl-swimlane')
          .attr('data-group', laneName)
          .attr('x', laneX)
          .attr('y', 0)
          .attr('width', laneWidth)
          .attr('height', innerHeight)
          .attr('fill', fillColor)
          .attr('opacity', 0.06);
      });
    }

    laneNames.forEach((laneName, laneIdx) => {
      const laneX = laneIdx * laneWidth;
      const laneColor = groupColorMap.get(laneName) ?? textColor;
      const laneCenter = laneX + laneWidth / 2;

      const headerG = g
        .append('g')
        .attr('class', 'tl-lane-header')
        .attr('data-group', laneName)
        .style('cursor', 'pointer')
        .on('mouseenter', () => fadeToGroup(g, laneName))
        .on('mouseleave', () => fadeReset(g));

      headerG
        .append('text')
        .attr('x', laneCenter)
        .attr('y', -ctx.structural(15))
        .attr('text-anchor', 'middle')
        .attr('fill', laneColor)
        .attr('font-size', `${sLaneHeaderFont}px`)
        .attr('font-weight', '600')
        .text(laneName);

      g.append('line')
        .attr('x1', laneCenter)
        .attr('y1', 0)
        .attr('x2', laneCenter)
        .attr('y2', innerHeight)
        .attr('stroke', mutedColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', sDash);

      const laneEvents = laneEventsByName.get(laneName) ?? [];

      for (const ev of laneEvents) {
        const y = yScale(parseTimelineDate(ev.date));
        const evG = g
          .append('g')
          .attr('class', 'tl-event')
          .attr('data-group', laneName)
          .attr('data-line-number', String(ev.lineNumber))
          .attr('data-date', String(parseTimelineDate(ev.date)))
          .attr(
            'data-end-date',
            ev.endDate ? String(parseTimelineDate(ev.endDate)) : null
          )
          .style('cursor', 'pointer')
          .on('mouseenter', function (event: MouseEvent) {
            fadeToGroup(g, laneName);
            showTooltip(tooltip, buildEventTooltipHtml(ev), event);
          })
          .on('mouseleave', function () {
            fadeReset(g);
            hideTooltip(tooltip);
          })
          .on('mousemove', function (event: MouseEvent) {
            showTooltip(tooltip, buildEventTooltipHtml(ev), event);
          })
          .on('click', () => {
            if (onClickItem && ev.lineNumber) onClickItem(ev.lineNumber);
          });
        setTagAttrs(evG, ev);

        const evColor = eventColor(ev);

        if (ev.endDate) {
          const y2 = yScale(parseTimelineDate(ev.endDate));
          const rectH = Math.max(y2 - y, 4);

          let fill: string = shapeFill(palette, evColor, isDark, { solid });
          let stroke: string = evColor;
          if (ev.uncertain) {
            const gradientId = `uncertain-vg-${ev.lineNumber}`;
            const strokeGradientId = `uncertain-vg-s-${ev.lineNumber}`;
            const defs = svg.select('defs').node() || svg.append('defs').node();
            const defsEl = d3Selection.select(defs as Element);
            defsEl
              .append('linearGradient')
              .attr('id', gradientId)
              .attr('x1', '0%')
              .attr('y1', '0%')
              .attr('x2', '0%')
              .attr('y2', '100%')
              .selectAll('stop')
              .data([
                { offset: '0%', opacity: 1 },
                { offset: '80%', opacity: 1 },
                { offset: '100%', opacity: 0 },
              ])
              .enter()
              .append('stop')
              .attr('offset', (d) => d.offset)
              .attr('stop-color', mix(laneColor, bg, 30))
              .attr('stop-opacity', (d) => d.opacity);
            defsEl
              .append('linearGradient')
              .attr('id', strokeGradientId)
              .attr('x1', '0%')
              .attr('y1', '0%')
              .attr('x2', '0%')
              .attr('y2', '100%')
              .selectAll('stop')
              .data([
                { offset: '0%', opacity: 1 },
                { offset: '80%', opacity: 1 },
                { offset: '100%', opacity: 0 },
              ])
              .enter()
              .append('stop')
              .attr('offset', (d) => d.offset)
              .attr('stop-color', evColor)
              .attr('stop-opacity', (d) => d.opacity);
            fill = `url(#${gradientId})`;
            stroke = `url(#${strokeGradientId})`;
          }

          evG
            .append('rect')
            .attr('x', laneCenter - sBarW / 2)
            .attr('y', y)
            .attr('width', sBarW)
            .attr('height', rectH)
            .attr('rx', sBarRx)
            .attr('fill', fill)
            .attr('stroke', stroke)
            .attr('stroke-width', sBarStroke);
          evG
            .append('text')
            .attr('x', laneCenter + sBarW + ctx.aesthetic(2))
            .attr('y', y + rectH / 2)
            .attr('dy', '0.35em')
            .attr('fill', textColor)
            .attr('font-size', `${sEventFont}px`)
            .text(ev.label);
        } else {
          evG
            .append('circle')
            .attr('cx', laneCenter)
            .attr('cy', y)
            .attr('r', sPointR)
            .attr('fill', shapeFill(palette, evColor, isDark, { solid }))
            .attr('stroke', evColor)
            .attr('stroke-width', sPointStroke);
          evG
            .append('text')
            .attr('x', laneCenter + ctx.aesthetic(10))
            .attr('y', y)
            .attr('dy', '0.35em')
            .attr('fill', textColor)
            .attr('font-size', `${sEventFont}px`)
            .text(ev.label);
        }
      }
    });
  } else {
    // === TIME SORT, vertical: single vertical axis ===
    const scaleMargin = timelineScale ? ctx.aesthetic(40) : 0;
    const markerMargin = timelineMarkers.length > 0 ? ctx.aesthetic(30) : 0;
    const margin = {
      top: ctx.aesthetic(104) + markerMargin + tagLegendReserve,
      right: ctx.aesthetic(200),
      bottom: ctx.aesthetic(40),
      left: ctx.aesthetic(60) + scaleMargin,
    };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const axisX = ctx.structural(20);

    const yScale = d3Scale
      .scaleLinear()
      .domain([minDate - datePadding, maxDate + datePadding])
      .range([0, innerHeight]);

    const sorted = timelineEvents
      .slice()
      .sort((a, b) => parseTimelineDate(a.date) - parseTimelineDate(b.date));

    const svg = d3Selection
      .select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', exportDims ? width : '100%')
      .attr('preserveAspectRatio', 'xMidYMin meet')
      .style('background', bgColor);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    renderChartTitle(
      svg,
      title,
      parsed.titleLineNumber,
      width,
      textColor,
      onClickItem
    );

    renderEras(
      g,
      timelineEras,
      yScale,
      true,
      innerWidth,
      innerHeight,
      (s, e) => fadeToEra(g, s, e),
      () => fadeReset(g),
      timelineScale,
      tooltip,
      palette
    );

    renderMarkers(
      g,
      timelineMarkers,
      yScale,
      true,
      innerWidth,
      innerHeight,
      (d) => fadeToMarker(g, d),
      () => fadeReset(g),
      timelineScale,
      tooltip,
      palette
    );

    if (timelineScale) {
      renderTimeScale(
        g,
        yScale,
        true,
        innerWidth,
        innerHeight,
        textColor,
        minDate,
        maxDate,
        formatBoundaryLabel(earliestStartDateStr, latestEndDateStr),
        formatBoundaryLabel(latestEndDateStr, earliestStartDateStr)
      );
    }

    if (timelineGroups.length > 0) {
      renderTimelineGroupLegend(
        g,
        timelineGroups,
        groupColorMap,
        textColor,
        palette,
        isDark,
        -ctx.aesthetic(55),
        (name) => fadeToGroup(g, name),
        () => fadeReset(g)
      );
    }

    g.append('line')
      .attr('x1', axisX)
      .attr('y1', 0)
      .attr('x2', axisX)
      .attr('y2', innerHeight)
      .attr('stroke', mutedColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', sDash);

    for (const ev of sorted) {
      const y = yScale(parseTimelineDate(ev.date));
      const color = eventColor(ev);

      const evG = g
        .append('g')
        .attr('class', 'tl-event')
        .attr('data-group', ev.group || '')
        .attr('data-line-number', String(ev.lineNumber))
        .attr('data-date', String(parseTimelineDate(ev.date)))
        .attr(
          'data-end-date',
          ev.endDate ? String(parseTimelineDate(ev.endDate)) : null
        )
        .style('cursor', 'pointer')
        .on('mouseenter', function (event: MouseEvent) {
          if (ev.group && timelineGroups.length > 0) fadeToGroup(g, ev.group);
          showTooltip(tooltip, buildEventTooltipHtml(ev), event);
        })
        .on('mouseleave', function () {
          fadeReset(g);
          hideTooltip(tooltip);
        })
        .on('mousemove', function (event: MouseEvent) {
          showTooltip(tooltip, buildEventTooltipHtml(ev), event);
        })
        .on('click', () => {
          if (onClickItem && ev.lineNumber) onClickItem(ev.lineNumber);
        });
      setTagAttrs(evG, ev);

      if (ev.endDate) {
        const y2 = yScale(parseTimelineDate(ev.endDate));
        const rectH = Math.max(y2 - y, 4);

        let fill: string = shapeFill(palette, color, isDark, { solid });
        let stroke: string = color;
        if (ev.uncertain) {
          const gradientId = `uncertain-v-${ev.lineNumber}`;
          const strokeGradientId = `uncertain-v-s-${ev.lineNumber}`;
          const defs = svg.select('defs').node() || svg.append('defs').node();
          const defsEl = d3Selection.select(defs as Element);
          defsEl
            .append('linearGradient')
            .attr('id', gradientId)
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '0%')
            .attr('y2', '100%')
            .selectAll('stop')
            .data([
              { offset: '0%', opacity: 1 },
              { offset: '80%', opacity: 1 },
              { offset: '100%', opacity: 0 },
            ])
            .enter()
            .append('stop')
            .attr('offset', (d) => d.offset)
            .attr('stop-color', mix(color, bg, 30))
            .attr('stop-opacity', (d) => d.opacity);
          defsEl
            .append('linearGradient')
            .attr('id', strokeGradientId)
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '0%')
            .attr('y2', '100%')
            .selectAll('stop')
            .data([
              { offset: '0%', opacity: 1 },
              { offset: '80%', opacity: 1 },
              { offset: '100%', opacity: 0 },
            ])
            .enter()
            .append('stop')
            .attr('offset', (d) => d.offset)
            .attr('stop-color', color)
            .attr('stop-opacity', (d) => d.opacity);
          fill = `url(#${gradientId})`;
          stroke = `url(#${strokeGradientId})`;
        }

        evG
          .append('rect')
          .attr('x', axisX - sBarW / 2)
          .attr('y', y)
          .attr('width', sBarW)
          .attr('height', rectH)
          .attr('rx', sBarRx)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', sBarStroke);
        evG
          .append('text')
          .attr('x', axisX + sBarW + ctx.aesthetic(4))
          .attr('y', y + rectH / 2)
          .attr('dy', '0.35em')
          .attr('fill', textColor)
          .attr('font-size', `${sEventFontSm}px`)
          .text(ev.label);
      } else {
        evG
          .append('circle')
          .attr('cx', axisX)
          .attr('cy', y)
          .attr('r', sPointR)
          .attr('fill', shapeFill(palette, color, isDark, { solid }))
          .attr('stroke', color)
          .attr('stroke-width', sPointStroke);
        evG
          .append('text')
          .attr('x', axisX + sBarW + ctx.aesthetic(4))
          .attr('y', y)
          .attr('dy', '0.35em')
          .attr('fill', textColor)
          .attr('font-size', `${sEventFontSm}px`)
          .text(ev.label);
      }

      evG
        .append('text')
        .attr('x', axisX - ctx.aesthetic(14))
        .attr(
          'y',
          ev.endDate
            ? yScale(parseTimelineDate(ev.date)) +
                Math.max(
                  yScale(parseTimelineDate(ev.endDate)) -
                    yScale(parseTimelineDate(ev.date)),
                  4
                ) /
                  2
            : y
        )
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', mutedColor)
        .attr('font-size', `${sDateFont}px`)
        .text(ev.date + (ev.endDate ? `→${ev.endDate}` : ''));
    }
  }
}

const timelineCollapseState = new WeakMap<HTMLDivElement, Set<string>>();
let tlBandClipCounter = 0;

export function renderTimeline(
  container: HTMLDivElement,
  parsed: ParsedTimeline,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions,
  activeTagGroup?: string | null,
  swimlaneTagGroup?: string | null,
  onTagStateChange?: (
    activeTagGroup: string | null,
    swimlaneTagGroup: string | null
  ) => void,
  viewMode?: boolean,
  exportMode?: boolean
): void {
  const setup = setupTimeline(
    container,
    parsed,
    palette,
    isDark,
    exportDims,
    activeTagGroup,
    swimlaneTagGroup
  );
  if (!setup) return;
  swimlaneTagGroup = setup.swimlaneTagGroup;

  const { isVertical, tagLanes } = setup;
  const hovers = makeTimelineHoverHelpers();

  let collapsedGroups = timelineCollapseState.get(container);
  if (!collapsedGroups) {
    collapsedGroups = new Set<string>();
    timelineCollapseState.set(container, collapsedGroups);
  }

  function toggleGroup(name: string) {
    if (collapsedGroups!.has(name)) collapsedGroups!.delete(name);
    else collapsedGroups!.add(name);
    renderTimeline(
      container,
      parsed,
      palette,
      isDark,
      onClickItem,
      exportDims,
      activeTagGroup,
      swimlaneTagGroup,
      onTagStateChange,
      viewMode,
      exportMode
    );
  }

  if (isVertical) {
    renderTimelineVertical(
      container,
      parsed,
      palette,
      isDark,
      setup,
      hovers,
      onClickItem,
      exportDims,
      swimlaneTagGroup,
      activeTagGroup,
      onTagStateChange,
      viewMode
    );
    return;
  }

  const useGroupedHorizontal =
    tagLanes != null ||
    (parsed.timelineSort !== 'time' && parsed.timelineGroups.length > 0);
  if (useGroupedHorizontal) {
    renderTimelineHorizontalGrouped(
      container,
      parsed,
      palette,
      isDark,
      setup,
      hovers,
      onClickItem,
      exportDims,
      swimlaneTagGroup,
      activeTagGroup,
      onTagStateChange,
      viewMode,
      collapsedGroups,
      toggleGroup
    );
  } else {
    renderTimelineHorizontalTimeSort(
      container,
      parsed,
      palette,
      isDark,
      setup,
      hovers,
      onClickItem,
      exportDims,
      swimlaneTagGroup,
      activeTagGroup,
      onTagStateChange,
      viewMode
    );
  }

  renderTimelineTagLegendOverlay(
    container,
    parsed,
    palette,
    isDark,
    setup,
    hovers,
    onClickItem,
    exportDims,
    swimlaneTagGroup,
    activeTagGroup,
    onTagStateChange,
    viewMode,
    exportMode
  );
}

// ============================================================
// Word Cloud Helpers
// ============================================================
