// ============================================================
// Gantt Chart Renderer
// ============================================================

import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { getSeriesColors } from '../palettes';
import { mix } from '../palettes/color-utils';
import { resolveTagColor } from '../utils/tag-groups';
import { computeTimeTicks } from '../d3';
import { buildHolidaySet, formatDateKey } from '../utils/duration';
import {
  LEGEND_HEIGHT,
  LEGEND_PILL_PAD,
  LEGEND_PILL_FONT_SIZE,
  LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL,
  LEGEND_GROUP_GAP,
  LEGEND_ICON_W,
  measureLegendText,
} from '../utils/legend-constants';
import { TITLE_FONT_SIZE, TITLE_FONT_WEIGHT, TITLE_Y } from '../utils/title-constants';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../d3';
import type { ResolvedSchedule, ResolvedTask, ResolvedGroup, Weekday } from './types';
import type { TagGroup, TagEntry } from '../utils/tag-groups';

// ── Constants ───────────────────────────────────────────────

const BAR_H = 22;
const ROW_GAP = 6;
const GROUP_GAP = 14;
const GROUP_LABEL_GAP = 8;
const MILESTONE_SIZE = 10;
const MIN_LEFT_MARGIN = 120;
const BOTTOM_MARGIN = 40;
const RIGHT_MARGIN = 20;
const CHAR_W = 6.5;          // estimated px per character for bar labels
const LABEL_PAD = 8;         // inner padding to decide if label fits inside bar
const LABEL_GAP = 5;         // gap between bar edge and external label

// ── Bar label placement ─────────────────────────────────────

type BarLabelPlacement = {
  x: number;
  anchor: 'start' | 'end';
  fill: string;
  text: string;
};

function computeBarLabel(
  label: string,
  x1: number,
  barWidth: number,
  innerWidth: number,
  textColor: string,
): BarLabelPlacement | null {
  const textWidth = label.length * CHAR_W;
  const x2 = x1 + barWidth;

  // 1. Inside
  if (textWidth < barWidth - LABEL_PAD) {
    return { x: x1 + 6, anchor: 'start', fill: textColor, text: label };
  }

  // 2. After (right of bar)
  if (x2 + LABEL_GAP + textWidth <= innerWidth) {
    return { x: x2 + LABEL_GAP, anchor: 'start', fill: textColor, text: label };
  }

  // 3. Before (left of bar)
  if (x1 - LABEL_GAP - textWidth >= 0) {
    return { x: x1 - LABEL_GAP, anchor: 'end', fill: textColor, text: label };
  }

  // 4. Truncate to fit before the bar
  const availWidth = x1 - LABEL_GAP;
  if (availWidth > CHAR_W * 3) {
    const maxChars = Math.floor(availWidth / CHAR_W) - 1;
    return { x: x1 - LABEL_GAP, anchor: 'end', fill: textColor, text: label.slice(0, maxChars) + '\u2026' };
  }

  return null;
}

// ── Left-panel visual helpers ───────────────────────────────

const BAND_ACCENT_W = 4;
const BAND_RADIUS = 4;
let bandClipCounter = 0;

function renderLabelBand(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  y: number,
  leftMargin: number,
  color: string,
  palette: PaletteColors,
  cssPrefix: 'group' | 'lane',
  dataAttr?: { key: string; value: string },
): void {
  const bandX = 5;
  const bandW = leftMargin - 7;
  const bandY = y - BAR_H / 2;
  const clipId = `gantt-band-clip-${bandClipCounter++}`;

  // ClipPath matching the tint band shape
  svg.append('clipPath').attr('id', clipId)
    .append('rect')
    .attr('x', bandX).attr('y', bandY)
    .attr('width', bandW).attr('height', BAR_H)
    .attr('rx', BAND_RADIUS);

  // Tint band
  const tint = svg.append('rect')
    .attr('class', `gantt-${cssPrefix}-band-bg`)
    .attr('x', bandX)
    .attr('y', bandY)
    .attr('width', bandW)
    .attr('height', BAR_H)
    .attr('rx', BAND_RADIUS)
    .attr('fill', mix(color, palette.bg, 20))
    .style('pointer-events', 'none');

  // Accent strip inside the tint, clipped to the band's rounded shape
  const accent = svg.append('rect')
    .attr('class', `gantt-${cssPrefix}-band-accent`)
    .attr('x', bandX)
    .attr('y', bandY)
    .attr('width', BAND_ACCENT_W)
    .attr('height', BAR_H)
    .attr('fill', color)
    .attr('clip-path', `url(#${clipId})`)
    .style('pointer-events', 'none');

  if (dataAttr) {
    tint.attr(dataAttr.key, dataAttr.value);
    accent.attr(dataAttr.key, dataAttr.value);
  }
}

function appendTaskIcon(
  textEl: d3Selection.Selection<SVGTextElement, unknown, null, undefined>,
  label: string,
  isMilestone: boolean,
  iconColor: string,
  textColor: string,
): void {
  const icon = isMilestone ? '◆' : '●';
  textEl.append('tspan').attr('fill', iconColor).text(icon);
  textEl.append('tspan').attr('fill', textColor).text(' ' + label);
}

// ── Interactive Options ─────────────────────────────────────

export interface GanttInteractiveOptions {
  onClickItem?: (lineNumber: number) => void;
  collapsedGroups?: Set<string>;
  onToggleGroup?: (groupName: string) => void;
  currentSwimlaneGroup?: string | null;
  onSwimlaneChange?: (group: string | null) => void;
  currentActiveGroup?: string | null;
  onActiveGroupChange?: (group: string | null) => void;
  collapsedLanes?: Set<string>;
  onToggleLane?: (laneName: string) => void;
  viewMode?: boolean;
}

// ── Main Renderer ───────────────────────────────────────────

export function renderGantt(
  container: HTMLDivElement,
  resolved: ResolvedSchedule,
  palette: PaletteColors,
  isDark: boolean,
  options?: GanttInteractiveOptions,
  exportDims?: D3ExportDimensions,
): void {
  // Clear previous content
  container.innerHTML = '';
  bandClipCounter = 0;

  if (resolved.tasks.length === 0) return;

  // ── Destructure options ─────────────────────────────────

  const onClickItem = options?.onClickItem;
  const collapsedGroups = options?.collapsedGroups;
  const onToggleGroup = options?.onToggleGroup;
  const viewMode = options?.viewMode ?? false;
  const currentSwimlaneGroup = options?.currentSwimlaneGroup ?? null;
  const onSwimlaneChange = options?.onSwimlaneChange;
  const onActiveGroupChange = options?.onActiveGroupChange;
  const collapsedLanes = options?.collapsedLanes;
  const onToggleLane = options?.onToggleLane;

  // ── Compute layout dimensions ───────────────────────────

  const seriesColors = getSeriesColors(palette);
  let currentActiveGroup: string | null = options?.currentActiveGroup !== undefined
    ? options.currentActiveGroup
    : (resolved.tagGroups.length > 0 ? resolved.tagGroups[0].name : null);
  let criticalPathActive = false;

  // ── Build row list (structural vs tag mode) ─────────────

  const tagRows = currentSwimlaneGroup
    ? buildTagLaneRowList(resolved, currentSwimlaneGroup, collapsedLanes)
    : null;
  const rows = tagRows ?? buildRowList(resolved, collapsedGroups);
  const isTagMode = tagRows !== null;

  // Compute left margin based on longest visible label (include ● /◆  prefix for tasks)
  const allLabels = isTagMode
    ? [
        ...rows.filter((r): r is LaneHeaderRow => r.type === 'lane-header').map(r => r.laneName),
        ...rows.filter((r): r is TaskRow => r.type === 'task').map(r => '● ' + r.task.task.label),
      ]
    : [
        ...resolved.tasks.map(t => '● ' + t.task.label),
        ...resolved.groups.map(g => {
          const px = g.depth <= 2 ? g.depth * 14 : 2 * 14 + (g.depth - 2) * 8;
          return ' '.repeat(Math.ceil(px / 7)) + g.name;
        }),
      ];
  const maxLabelLen = Math.max(...allLabels.map(l => l.length), 10);
  const leftMargin = Math.max(MIN_LEFT_MARGIN, maxLabelLen * 7 + 30);

  const totalRows = rows.length;

  // Vertical layout — matches timeline pattern (d3.ts:3649-3655)
  const title = resolved.options.title;
  const titleHeight = title ? 50 : 20;
  const tagLegendReserve = resolved.tagGroups.length > 0 ? LEGEND_HEIGHT + 8 : 0;
  const topDateLabelReserve = 22; // tick (6) + gap (4) + label height (~12)
  const hasOverheadLabels = resolved.markers.length > 0 || resolved.eras.length > 0;
  const markerLabelReserve = hasOverheadLabels ? 18 : 0; // markers/eras extend above date labels
  const CONTENT_TOP_PAD = 16; // breathing room between scale labels and first row

  const marginTop = titleHeight + tagLegendReserve + topDateLabelReserve + markerLabelReserve;

  // Content area
  const contentH = isTagMode
    ? totalRows * (BAR_H + ROW_GAP)
    : totalRows * (BAR_H + ROW_GAP) + GROUP_GAP * resolved.groups.length;
  const innerHeight = CONTENT_TOP_PAD + contentH;
  const outerHeight = marginTop + innerHeight + BOTTOM_MARGIN;

  const containerWidth = exportDims?.width ?? (container.clientWidth || 800);
  const innerWidth = containerWidth - leftMargin - RIGHT_MARGIN;

  // ── Create SVG ──────────────────────────────────────────

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('viewBox', `0 0 ${containerWidth} ${outerHeight}`)
    .attr('width', containerWidth)
    .attr('height', outerHeight)
    .attr('font-family', FONT_FAMILY)
    .style('overflow', 'visible');

  const g = svg
    .append('g')
    .attr('transform', `translate(${leftMargin}, ${marginTop})`);

  // ── Title (y=30, consistent with timeline/initiative-status) ──

  if (title) {
    svg
      .append('text')
      .attr('x', containerWidth / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .text(title);
  }

  // ── Tag legend (interactive) ────────────────────────────

  const hasCriticalPath = resolved.options.criticalPath && resolved.tasks.some(t => t.isCriticalPath);

  function drawLegend() {
    svg.selectAll('.gantt-tag-legend-container').remove();
    if (resolved.tagGroups.length > 0 || hasCriticalPath) {
      const legendY = titleHeight;
      renderTagLegend(
        svg, g, resolved.tagGroups, currentActiveGroup, leftMargin, innerWidth,
        legendY, palette, isDark, hasCriticalPath, criticalPathActive, resolved.options.optionLineNumbers,
        (groupName) => {
          // Toggle active group
          currentActiveGroup = currentActiveGroup?.toLowerCase() === groupName.toLowerCase()
            ? null : groupName;
          if (onActiveGroupChange) onActiveGroupChange(currentActiveGroup);
          drawLegend();
          recolorBars();
        },
        () => {
          criticalPathActive = !criticalPathActive;
          drawLegend();
        },
        currentSwimlaneGroup,
        onSwimlaneChange,
        viewMode,
        resolved.tasks,
      );
    }
  }

  function recolorBars() {
    g.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
      const el = d3Selection.select(this);
      const taskId = el.attr('data-task-id');
      const rt = resolved.tasks.find(t => t.task.id === taskId);
      if (!rt) return;
      const color = resolveTaskColor(rt, currentActiveGroup, resolved, seriesColors, palette);
      const fillColor = mix(color, palette.bg, 30);
      el.select('rect').attr('fill', fillColor).attr('stroke', color);
    });
  }

  drawLegend();

  // ── Time scale ──────────────────────────────────────────

  const startTime = dateToFractionalYear(resolved.startDate);
  const endTime = dateToFractionalYear(resolved.endDate);

  // Add small padding to domain
  const domainPad = Math.max((endTime - startTime) * 0.02, 0.01);
  const domainMin = startTime - domainPad;
  const domainMax = endTime + domainPad;

  const xScale = d3Scale
    .scaleLinear()
    .domain([domainMin, domainMax])
    .range([0, innerWidth]);

  // Render time scale ticks (bottom only)
  renderTimeScaleHorizontal(g, xScale, innerWidth, innerHeight, palette.text);

  // Date labels are rendered at the bottom only (via renderTimeScaleHorizontal)

  // ── Weekend + holiday bands ─────────────────────────────

  renderWeekendBands(g, resolved, xScale, innerHeight, palette, isDark);
  renderHolidayBands(g, svg, resolved, xScale, innerHeight, palette, isDark, marginTop - 4, leftMargin, onClickItem);
  renderErasAndMarkers(g, svg, resolved, xScale, innerHeight, palette);

  // ── Today marker (line rendered before rows so it paints behind task bars) ──

  let todayDate: Date | null = null;
  let todayX = -1;
  const todayColor = palette.accent || '#e74c3c';
  const todayMarkerLineNum = resolved.options.optionLineNumbers['today-marker'];
  if (resolved.options.todayMarker !== 'off') {
    if (resolved.options.todayMarker === 'on') {
      todayDate = new Date();
    } else {
      todayDate = new Date(resolved.options.todayMarker + 'T00:00:00');
    }
    todayX = xScale(dateToFractionalYear(todayDate));
    if (todayX >= 0 && todayX <= innerWidth) {
      const todayLine = g.append('line')
        .attr('class', 'gantt-today')
        .attr('x1', todayX)
        .attr('y1', 0)
        .attr('x2', todayX)
        .attr('y2', innerHeight + 10)
        .attr('stroke', todayColor)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '6 4')
        .attr('opacity', 0.7)
        .attr('pointer-events', 'none');
      if (todayMarkerLineNum) todayLine.attr('data-line-number', String(todayMarkerLineNum));

      const todayLabel = g.append('text')
        .attr('class', 'gantt-today')
        .attr('x', todayX)
        .attr('y', innerHeight + 24)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('fill', todayColor)
        .attr('opacity', 0.7)
        .attr('pointer-events', 'none')
        .text('Today');
      if (todayMarkerLineNum) todayLabel.attr('data-line-number', String(todayMarkerLineNum));
    }
  }

  // ── Render rows ─────────────────────────────────────────

  // Track task positions for dependency arrows
  const taskPositions = new Map<string, { x1: number; x2: number; y: number }>();
  // Track collapsed group bar positions so hidden-task arrows redirect there
  const groupPositions = new Map<string, { x1: number; x2: number; y: number }>();
  // Track lane header positions for collapsed lane arrow redirection (tag mode)
  const lanePositions = new Map<string, { x1: number; x2: number; y: number }>();
  // Map task ID → lane name for collapsed lane lookup (tag mode)
  const taskLaneMap = new Map<string, string>();
  if (isTagMode && currentSwimlaneGroup) {
    const tagGroup = resolved.tagGroups.find(
      tg => tg.name.toLowerCase() === currentSwimlaneGroup.toLowerCase()
    );
    if (tagGroup) {
      const tagKey = tagGroup.name.toLowerCase();
      for (const rt of resolved.tasks) {
        let value = rt.effectiveMetadata[tagKey];
        if (!value && tagGroup.defaultValue) value = tagGroup.defaultValue;
        if (value) {
          const entry = tagGroup.entries.find(e => e.value.toLowerCase() === value!.toLowerCase());
          if (entry) taskLaneMap.set(rt.task.id, entry.value);
        }
      }
    }
  }
  let yOffset = CONTENT_TOP_PAD;

  for (const row of rows) {
    if (row.type === 'lane-header') {
      // ── Lane header (tag swimlane mode) ──
      const laneColor = row.laneColor === '#999999' ? palette.textMuted : row.laneColor;
      const toggleIcon = row.isCollapsed ? '►' : '▼';
      const labelX = 10;

      // Compute lane bar x range from task dates
      let lx1 = 0;
      let lx2 = innerWidth;
      let laneBarWidth = innerWidth;
      if (row.laneStartDate && row.laneEndDate) {
        lx1 = xScale(dateToFractionalYear(row.laneStartDate));
        lx2 = xScale(dateToFractionalYear(row.laneEndDate));
        laneBarWidth = Math.max(lx2 - lx1, 2);
      }

      lanePositions.set(row.laneName, { x1: lx1, x2: lx1 + laneBarWidth, y: yOffset + BAR_H / 2 });

      renderLabelBand(svg, marginTop + yOffset + BAR_H / 2, leftMargin, laneColor, palette, 'lane', { key: 'data-lane', value: row.laneName });
      const labelG = svg
        .append('g')
        .attr('class', 'gantt-lane-header')
        .attr(`data-tag-${row.tagKey}`, row.laneName.toLowerCase())
        .attr('data-lane', row.laneName)
        .style('cursor', onToggleLane ? 'pointer' : 'default')
        .on('click', () => {
          if (onToggleLane) onToggleLane(row.laneName);
        })
        .on('mouseenter', () => {
          highlightLane(g, svg, row.tagKey, row.laneName);
          if (row.laneStartDate && row.laneEndDate) {
            showGanttDateIndicators(g, xScale, row.laneStartDate, row.laneEndDate, innerHeight, laneColor);
          }
        })
        .on('mouseleave', () => {
          resetHighlight(g, svg);
          hideGanttDateIndicators(g);
        });

      // Label with toggle icon
      labelG
        .append('text')
        .attr('x', labelX)
        .attr('y', marginTop + yOffset + BAR_H / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('font-size', '11px')
        .attr('font-weight', 'bold')
        .attr('fill', laneColor)
        .text(toggleIcon + ' ' + row.laneName + (row.aggregateProgress !== null ? ` ${Math.round(row.aggregateProgress)}%` : ''));

      if (laneBarWidth > 0) {
        const barFill = mix(laneColor, palette.bg, 30);
        const laneBandG = g.append('g')
          .attr('class', 'gantt-lane-band-group')
          .attr('data-lane', row.laneName)
          .on('mouseenter', () => {
            highlightLane(g, svg, row.tagKey, row.laneName);
            if (row.laneStartDate && row.laneEndDate) {
              showGanttDateIndicators(g, xScale, row.laneStartDate, row.laneEndDate, innerHeight, laneColor);
            }
          })
          .on('mouseleave', () => {
            resetHighlight(g, svg);
            hideGanttDateIndicators(g);
          });

        laneBandG.append('rect')
          .attr('class', 'gantt-lane-band')
          .attr('x', lx1)
          .attr('y', yOffset)
          .attr('width', laneBarWidth)
          .attr('height', BAR_H)
          .attr('rx', 4)
          .attr('fill', barFill)
          .attr('stroke', laneColor)
          .attr('stroke-width', 2);

        // Aggregate progress fill
        if (row.aggregateProgress !== null && row.aggregateProgress > 0) {
          laneBandG.append('rect')
            .attr('class', 'gantt-lane-progress')
            .attr('x', lx1)
            .attr('y', yOffset)
            .attr('width', laneBarWidth * Math.min(row.aggregateProgress / 100, 1))
            .attr('height', BAR_H)
            .attr('fill', laneColor)
            .attr('opacity', 0.5)
            .attr('pointer-events', 'none');
        }
      }

      yOffset += BAR_H + ROW_GAP;
    } else if (row.type === 'group') {
      const group = row.group;
      const isCollapsed = collapsedGroups?.has(group.name) ?? false;
      const indent = '  '.repeat(group.depth);
      const toggleIcon = isCollapsed ? '►' : '▼';

      // Group label with toggle — resolve tag color from group metadata
      const tagColor = resolveTagColor(group.metadata, resolved.tagGroups, currentActiveGroup, true);
      const groupColor = (tagColor && tagColor !== '#999999') ? tagColor : (group.color || palette.textMuted);
      renderLabelBand(svg, marginTop + yOffset + BAR_H / 2, leftMargin, groupColor, palette, 'group', { key: 'data-group', value: group.name });
      const labelG = svg
        .append('g')
        .attr('class', 'gantt-group-label')
        .attr('data-group', group.name)
        .attr('data-line-number', String(group.lineNumber))
        .style('cursor', onToggleGroup ? 'pointer' : 'default')
        .on('click', () => {
          if (onToggleGroup) onToggleGroup(group.name);
        })
        .on('mouseenter', () => {
          highlightGroup(g, svg, group.name);
          showGanttDateIndicators(g, xScale, group.startDate, group.endDate, innerHeight, groupColor);
        })
        .on('mouseleave', () => {
          resetHighlight(g, svg);
          hideGanttDateIndicators(g);
        });

      const groupIndent = group.depth <= 2 ? group.depth * 14 : 2 * 14 + (group.depth - 2) * 8;
      const labelX = 10 + groupIndent;
      labelG
        .append('text')
        .attr('x', labelX)
        .attr('y', marginTop + yOffset + BAR_H / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('font-size', '11px')
        .attr('font-weight', 'bold')
        .attr('fill', palette.text)
        .text(toggleIcon + ' ' + group.name + (group.progress !== null ? ` ${Math.round(group.progress)}%` : ''));

      // Group bar
      const gStart = dateToFractionalYear(group.startDate);
      const gEnd = dateToFractionalYear(group.endDate);
      const gx1 = xScale(gStart);
      const gx2 = xScale(gEnd);

      if (gx2 > gx1) {
        if (isCollapsed) {
          // Summary bar (full height, shows aggregate progress)
          const barWidth = Math.max(gx2 - gx1, 2);
          const summaryG = g.append('g')
            .attr('class', 'gantt-group-summary')
            .attr('data-group', group.name)
            .attr('data-line-number', String(group.lineNumber))
            .on('mouseenter', () => {
              highlightGroup(g, svg, group.name);
              showGanttDateIndicators(g, xScale, group.startDate, group.endDate, innerHeight, groupColor);
            })
            .on('mouseleave', () => {
              resetHighlight(g, svg);
              hideGanttDateIndicators(g);
            });

          summaryG.append('rect')
            .attr('x', gx1)
            .attr('y', yOffset)
            .attr('width', barWidth)
            .attr('height', BAR_H)
            .attr('rx', 4)
            .attr('fill', mix(groupColor, palette.bg, 30))
            .attr('stroke', groupColor)
            .attr('stroke-width', 2);

          // Aggregate progress fill
          if (group.progress !== null && group.progress > 0) {
            summaryG.append('rect')
              .attr('x', gx1)
              .attr('y', yOffset)
              .attr('width', barWidth * Math.min(group.progress / 100, 1))
              .attr('height', BAR_H)
              .attr('fill', groupColor)
              .attr('opacity', 0.5);
          }

          // Bar label (inside → after → before → truncate)
          const summaryLabel = group.name + (group.progress !== null ? ` ${Math.round(group.progress)}%` : '');
          const summaryPlacement = computeBarLabel(summaryLabel, gx1, barWidth, innerWidth, palette.text);
          if (summaryPlacement) {
            summaryG
              .append('text')
              .attr('x', summaryPlacement.x)
              .attr('y', yOffset + BAR_H / 2)
              .attr('dy', '0.35em')
              .attr('font-size', '10px')
              .attr('font-weight', 'bold')
              .attr('text-anchor', summaryPlacement.anchor)
              .attr('fill', summaryPlacement.fill)
              .attr('pointer-events', 'none')
              .text(summaryPlacement.text);
          }

          // Track collapsed group position for dependency arrow redirection
          groupPositions.set(group.name, { x1: gx1, x2: gx1 + barWidth, y: yOffset + BAR_H / 2 });
        } else {
          // Expanded: bar spanning group date range (matches task bar style)
          const groupBarWidth = Math.max(gx2 - gx1, 2);
          const bandFill = mix(groupColor, palette.bg, 30);
          const groupBarG = g.append('g')
            .attr('class', 'gantt-group-bar')
            .attr('data-group', group.name)
            .attr('data-line-number', String(group.lineNumber))
            .on('mouseenter', () => {
              highlightGroup(g, svg, group.name);
              showGanttDateIndicators(g, xScale, group.startDate, group.endDate, innerHeight, groupColor);
            })
            .on('mouseleave', () => {
              resetHighlight(g, svg);
              hideGanttDateIndicators(g);
            });

          groupBarG.append('rect')
            .attr('x', gx1)
            .attr('y', yOffset)
            .attr('width', groupBarWidth)
            .attr('height', BAR_H)
            .attr('rx', 4)
            .attr('fill', bandFill)
            .attr('stroke', groupColor)
            .attr('stroke-width', 2);

          // Aggregate progress fill
          if (group.progress !== null && group.progress > 0) {
            groupBarG.append('rect')
              .attr('class', 'gantt-group-progress')
              .attr('x', gx1)
              .attr('y', yOffset)
              .attr('width', groupBarWidth * Math.min(group.progress / 100, 1))
              .attr('height', BAR_H)
              .attr('fill', groupColor)
              .attr('opacity', 0.5);
          }

          // Bar label (inside → after → before → truncate)
          const expandedLabel = group.name + (group.progress !== null ? ` ${Math.round(group.progress)}%` : '');
          const expandedPlacement = computeBarLabel(expandedLabel, gx1, groupBarWidth, innerWidth, palette.text);
          if (expandedPlacement) {
            groupBarG
              .append('text')
              .attr('x', expandedPlacement.x)
              .attr('y', yOffset + BAR_H / 2)
              .attr('dy', '0.35em')
              .attr('font-size', '10px')
              .attr('font-weight', 'bold')
              .attr('text-anchor', expandedPlacement.anchor)
              .attr('fill', expandedPlacement.fill)
              .attr('pointer-events', 'none')
              .text(expandedPlacement.text);
          }
        }
      }

      yOffset += BAR_H + ROW_GAP;
    } else if (row.type === 'task') {
      const rt = row.task;
      const task = rt.task;

      // Resolve bar color early so icon tspan can use it
      const barColor = resolveTaskColor(rt, currentActiveGroup, resolved, seriesColors, palette);

      // Task label on the left (left-aligned with indent; flat in tag mode)
      const depth = rt.groupPath.length;
      const indent = depth <= 2 ? depth * 14 : 2 * 14 + (depth - 2) * 8;
      const taskLabelX = isTagMode ? 20 : 6 + indent;
      const topGroup = rt.groupPath.length > 0 ? rt.groupPath[0] : null;
      const taskLabel = svg
        .append('text')
        .attr('class', 'gantt-task-label')
        .attr('x', taskLabelX)
        .attr('y', marginTop + yOffset + BAR_H / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('font-size', '11px')
        .attr('fill', palette.text)
        .attr('data-line-number', String(task.lineNumber))
        .attr('data-task-id', task.id)
        .attr('data-group', topGroup)
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .on('click', () => {
          if (onClickItem) onClickItem(task.lineNumber);
        })
        .on('mouseenter', () => {
          if (rt.isMilestone) {
            highlightMilestone(g, svg, task.id);
          } else {
            highlightTask(g, svg, task.id);
          }
        })
        .on('mouseleave', () => {
          resetHighlight(g, svg);
        });

      appendTaskIcon(taskLabel, task.label, rt.isMilestone, barColor, palette.text);

      // Tag attributes on label for legend hover matching
      for (const [key, value] of Object.entries(rt.effectiveMetadata)) {
        taskLabel.attr(`data-tag-${key}`, value.toLowerCase());
      }
      if (rt.isCriticalPath) {
        taskLabel.attr('data-critical-path', 'true');
      }

      if (rt.isMilestone) {
        // Render diamond
        const mx = xScale(dateToFractionalYear(rt.startDate));
        const my = yOffset + BAR_H / 2;
        g.append('polygon')
          .attr('class', 'gantt-milestone')
          .attr('points', diamondPoints(mx, my, MILESTONE_SIZE))
          .attr('fill', barColor)
          .attr('stroke', barColor)
          .attr('stroke-width', 1.5)
          .attr('data-line-number', String(task.lineNumber))
          .attr('data-task-name', task.label)
          .attr('data-task-id', task.id)
          .attr('data-group', topGroup)
          .style('cursor', onClickItem ? 'pointer' : 'default')
          .on('click', () => {
            if (onClickItem) onClickItem(task.lineNumber);
          })
          .on('mouseenter', () => {
            highlightMilestone(g, svg, task.id);
            showGanttDateIndicators(g, xScale, rt.startDate, null, innerHeight, barColor);
            // Show label next to diamond
            g.append('text')
              .attr('class', 'gantt-milestone-hover-label')
              .attr('x', mx - MILESTONE_SIZE - 4)
              .attr('y', my)
              .attr('dy', '0.35em')
              .attr('text-anchor', 'end')
              .attr('font-size', '10px')
              .attr('fill', barColor)
              .attr('font-weight', '600')
              .text(task.label);
          })
          .on('mouseleave', () => {
            resetHighlight(g, svg);
            hideGanttDateIndicators(g);
            g.selectAll('.gantt-milestone-hover-label').remove();
          });

        // Track milestone position for arrows
        taskPositions.set(task.id, { x1: mx, x2: mx, y: my });
      } else {
        // Render bar
        const tStart = dateToFractionalYear(rt.startDate);
        const tEnd = dateToFractionalYear(rt.endDate);
        const x1 = xScale(tStart);
        const x2 = xScale(tEnd);
        const barWidth = Math.max(x2 - x1, 2);

        const fillColor = mix(barColor, palette.bg, 30);

        const taskG = g.append('g')
          .attr('class', 'gantt-task')
          .attr('data-line-number', String(task.lineNumber))
          .attr('data-task-name', task.label)
          .attr('data-task-id', task.id)
          .attr('data-group', topGroup)
          .style('cursor', onClickItem ? 'pointer' : 'default')
          .on('click', () => {
            if (onClickItem) onClickItem(task.lineNumber);
          })
          .on('mouseenter', () => {
            if (resolved.options.dependencies) {
              highlightDeps(g, svg, task.id, resolved);
            }
            highlightTaskLabel(svg, task.lineNumber);
            showGanttDateIndicators(g, xScale, rt.startDate, rt.endDate, innerHeight, barColor);
          })
          .on('mouseleave', () => {
            if (resolved.options.dependencies) {
              if (criticalPathActive) {
                applyCriticalPathHighlight(svg, g);
              } else {
                resetHighlight(g, svg);
              }
            }
            resetTaskLabels(svg);
            hideGanttDateIndicators(g);
          });

        // Set tag attributes
        for (const [key, value] of Object.entries(rt.effectiveMetadata)) {
          taskG.attr(`data-tag-${key}`, value.toLowerCase());
        }

        // Uncertainty gradient — fade out the trailing edge unless progress > 80%
        const showUncertainFade = rt.isUncertain && (task.progress === null || task.progress <= 80);
        let barFill: string = fillColor;
        let barStroke: string = barColor;
        if (showUncertainFade) {
          const defs = svg.select('defs').empty()
            ? svg.append('defs')
            : svg.select<SVGDefsElement>('defs');

          const fillGradId = `gantt-uncertain-fill-${task.id}`;
          const fillGrad = defs.append('linearGradient')
            .attr('id', fillGradId)
            .attr('x1', '0').attr('x2', '1').attr('y1', '0').attr('y2', '0');
          fillGrad.append('stop').attr('offset', '0%').attr('stop-color', fillColor).attr('stop-opacity', 1);
          fillGrad.append('stop').attr('offset', '50%').attr('stop-color', fillColor).attr('stop-opacity', 1);
          fillGrad.append('stop').attr('offset', '100%').attr('stop-color', fillColor).attr('stop-opacity', 0);

          const strokeGradId = `gantt-uncertain-stroke-${task.id}`;
          const strokeGrad = defs.append('linearGradient')
            .attr('id', strokeGradId)
            .attr('x1', '0').attr('x2', '1').attr('y1', '0').attr('y2', '0');
          strokeGrad.append('stop').attr('offset', '0%').attr('stop-color', barColor).attr('stop-opacity', 1);
          strokeGrad.append('stop').attr('offset', '50%').attr('stop-color', barColor).attr('stop-opacity', 1);
          strokeGrad.append('stop').attr('offset', '100%').attr('stop-color', barColor).attr('stop-opacity', 0);

          barFill = `url(#${fillGradId})`;
          barStroke = `url(#${strokeGradId})`;
        }

        // Main bar
        taskG
          .append('rect')
          .attr('x', x1)
          .attr('y', yOffset)
          .attr('width', barWidth)
          .attr('height', BAR_H)
          .attr('rx', 4)
          .attr('fill', barFill)
          .attr('stroke', barStroke)
          .attr('stroke-width', 2);

        // Progress fill
        if (task.progress !== null && task.progress > 0) {
          const progressWidth = barWidth * Math.min(task.progress / 100, 1);
          let progressFill: string = barColor;
          if (showUncertainFade) {
            // Scale gradient stops relative to progress width within the full bar
            const ratio = barWidth / progressWidth;
            const fadeStart = Math.min(50 * ratio, 100);
            const defs = svg.select<SVGDefsElement>('defs');
            const progGradId = `gantt-uncertain-progress-${task.id}`;
            const progGrad = defs.append('linearGradient')
              .attr('id', progGradId)
              .attr('x1', '0').attr('x2', '1').attr('y1', '0').attr('y2', '0');
            progGrad.append('stop').attr('offset', '0%').attr('stop-color', barColor).attr('stop-opacity', 1);
            progGrad.append('stop').attr('offset', `${fadeStart}%`).attr('stop-color', barColor).attr('stop-opacity', 1);
            progGrad.append('stop').attr('offset', '100%').attr('stop-color', barColor).attr('stop-opacity', 0);
            progressFill = `url(#${progGradId})`;
          }
          taskG
            .append('rect')
            .attr('class', 'gantt-progress')
            .attr('x', x1)
            .attr('y', yOffset)
            .attr('width', progressWidth)
            .attr('height', BAR_H)
            .attr('fill', progressFill)
            .attr('opacity', 0.5);
        }

        // Critical path data attribute (for legend hover highlighting)
        if (rt.isCriticalPath) {
          taskG.attr('data-critical-path', 'true');
        }


        // Bar label (inside → after → before → truncate)
        const labelPlacement = computeBarLabel(task.label, x1, barWidth, innerWidth, palette.text);
        if (labelPlacement) {
          taskG
            .append('text')
            .attr('x', labelPlacement.x)
            .attr('y', yOffset + BAR_H / 2)
            .attr('dy', '0.35em')
            .attr('font-size', '10px')
            .attr('text-anchor', labelPlacement.anchor)
            .attr('fill', labelPlacement.fill)
            .attr('pointer-events', 'none')
            .text(labelPlacement.text);
        }

        // Track bar position for arrows
        taskPositions.set(task.id, { x1, x2: x1 + barWidth, y: yOffset + BAR_H / 2 });
      }

      yOffset += BAR_H + ROW_GAP;
    }
  }

  // ── Today hover overlay (rendered after rows so it receives pointer events) ──

  if (todayDate && todayX >= 0 && todayX <= innerWidth) {
    const todayHoverG = g.append('g')
      .attr('class', 'gantt-today-hover')
      .style('cursor', 'pointer');

    // Invisible wide hit rect for easy hovering
    todayHoverG.append('rect')
      .attr('x', todayX - 10)
      .attr('y', -6)
      .attr('width', 20)
      .attr('height', innerHeight + 16)
      .attr('fill', 'transparent')
      .attr('pointer-events', 'all');

    const todayDateObj = todayDate;
    todayHoverG
      .on('mouseenter', () => {
        // Fade everything
        g.selectAll<SVGGElement, unknown>('.gantt-task').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-milestone').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').attr('opacity', FADE_OPACITY);
        svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', FADE_OPACITY);
        svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').attr('opacity', FADE_OPACITY);
        svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-dep-arrow, .gantt-dep-arrowhead').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-era-group').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr('opacity', FADE_OPACITY);
        showGanttDateIndicators(g, xScale, todayDateObj, null, innerHeight, todayColor);
      })
      .on('mouseleave', () => {
        resetHighlight(g, svg);
        hideGanttDateIndicators(g);
      });
  }

  // ── Dependency arrows ───────────────────────────────────

  if (resolved.options.dependencies) {
    renderDependencyArrows(g, resolved, taskPositions, groupPositions, collapsedGroups, palette, isDark, isTagMode, lanePositions, collapsedLanes, taskLaneMap);
  }
}

// ── Weekend Band Rendering ──────────────────────────────────

const JS_DAY_TO_WEEKDAY: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function renderWeekendBands(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  resolved: ResolvedSchedule,
  xScale: d3Scale.ScaleLinear<number, number>,
  innerHeight: number,
  palette: PaletteColors,
  isDark: boolean,
): void {
  const workweek = new Set(resolved.holidays.workweek);
  const start = new Date(resolved.startDate);
  start.setDate(start.getDate() - 1); // start one day before
  const end = new Date(resolved.endDate);
  end.setDate(end.getDate() + 1); // end one day after

  const current = new Date(start);
  let bandStart: Date | null = null;

  while (current <= end) {
    const dayName = JS_DAY_TO_WEEKDAY[current.getDay()];
    const isWeekend = !workweek.has(dayName);

    if (isWeekend && !bandStart) {
      bandStart = new Date(current);
    } else if (!isWeekend && bandStart) {
      // Draw band from bandStart to current
      drawBand(g, xScale, bandStart, current, innerHeight, palette, isDark, 'gantt-weekend-band', 0.04);
      bandStart = null;
    }
    current.setDate(current.getDate() + 1);
  }
  // Close any trailing band
  if (bandStart) {
    drawBand(g, xScale, bandStart, current, innerHeight, palette, isDark, 'gantt-weekend-band', 0.04);
  }
}

// ── Holiday Band Rendering ──────────────────────────────────

function renderHolidayBands(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  resolved: ResolvedSchedule,
  xScale: d3Scale.ScaleLinear<number, number>,
  innerHeight: number,
  palette: PaletteColors,
  isDark: boolean,
  headerY: number,
  chartLeftMargin: number,
  onClickItem?: (lineNumber: number) => void,
): void {
  for (const h of resolved.holidays.dates) {
    const start = new Date(h.date + 'T00:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    drawHolidayBand(g, svg, xScale, start, end, innerHeight, palette, isDark, h.label, h.lineNumber, headerY, chartLeftMargin, onClickItem);
  }

  for (const r of resolved.holidays.ranges) {
    const start = new Date(r.startDate + 'T00:00:00');
    const end = new Date(r.endDate + 'T00:00:00');
    end.setDate(end.getDate() + 1);
    drawHolidayBand(g, svg, xScale, start, end, innerHeight, palette, isDark, r.label, r.lineNumber, headerY, chartLeftMargin, onClickItem);
  }
}

function drawBand(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  xScale: d3Scale.ScaleLinear<number, number>,
  start: Date,
  end: Date,
  height: number,
  palette: PaletteColors,
  _isDark: boolean,
  className: string,
  opacity: number,
): void {
  const x1 = xScale(dateToFractionalYear(start));
  const x2 = xScale(dateToFractionalYear(end));
  if (x2 <= x1) return;

  g.append('rect')
    .attr('class', className)
    .attr('x', x1)
    .attr('y', 0)
    .attr('width', x2 - x1)
    .attr('height', height)
    .attr('fill', palette.text)
    .attr('opacity', opacity)
    .attr('pointer-events', 'none');
}

function drawHolidayBand(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  xScale: d3Scale.ScaleLinear<number, number>,
  start: Date,
  end: Date,
  height: number,
  palette: PaletteColors,
  _isDark: boolean,
  label: string,
  lineNumber: number,
  headerY: number,
  chartLeftMargin: number,
  onClickItem?: (lineNumber: number) => void,
): void {
  const x1 = xScale(dateToFractionalYear(start));
  const x2 = xScale(dateToFractionalYear(end));
  if (x2 <= x1) return;

  const bandW = Math.max(x2 - x1, 4);
  const baseOpacity = 0.08;
  const hoverOpacity = 0.18;

  const bandG = g.append('g')
    .attr('class', 'gantt-holiday-band')
    .attr('data-line-number', String(lineNumber))
    .style('cursor', onClickItem ? 'pointer' : 'default');

  // Band rect
  const bandRect = bandG.append('rect')
    .attr('x', x1)
    .attr('y', 0)
    .attr('width', bandW)
    .attr('height', height)
    .attr('fill', palette.text)
    .attr('opacity', baseOpacity);

  // Hover label in SVG-space (date header row) — hidden by default
  // Background rect to mask date labels underneath
  const labelX = chartLeftMargin + x1 + bandW / 2;
  const textLen = label.length * 6 + 8;
  const labelBg = svg.append('rect')
    .attr('class', 'gantt-holiday-hover-bg')
    .attr('data-line-number', String(lineNumber))
    .attr('x', labelX - textLen / 2)
    .attr('y', headerY - 11)
    .attr('width', textLen)
    .attr('height', 14)
    .attr('rx', 3)
    .attr('fill', palette.bg)
    .attr('opacity', 0)
    .attr('pointer-events', 'none');

  const labelText = svg.append('text')
    .attr('class', 'gantt-holiday-hover-label')
    .attr('data-line-number', String(lineNumber))
    .attr('x', labelX)
    .attr('y', headerY)
    .attr('text-anchor', 'middle')
    .attr('font-size', '10px')
    .attr('font-weight', '500')
    .attr('fill', palette.text)
    .attr('opacity', 0)
    .attr('pointer-events', 'none')
    .text(label);

  // Hover: highlight band + show label in header + date indicators
  bandG
    .on('mouseenter', () => {
      bandRect.attr('opacity', hoverOpacity);
      labelBg.attr('opacity', 1);
      labelText.attr('opacity', 1);
      showGanttDateIndicators(g, xScale, start, end, height, palette.textMuted);
    })
    .on('mouseleave', () => {
      bandRect.attr('opacity', baseOpacity);
      labelBg.attr('opacity', 0);
      labelText.attr('opacity', 0);
      hideGanttDateIndicators(g);
    })
    .on('click', () => {
      if (onClickItem) onClickItem(lineNumber);
    });
}

// ── Dependency Arrow Rendering ──────────────────────────────

function findCollapsedGroupPos(
  rt: ResolvedTask,
  collapsedGroups: Set<string> | undefined,
  groupPositions: Map<string, { x1: number; x2: number; y: number }>,
): { x1: number; x2: number; y: number } | undefined {
  if (!collapsedGroups) return undefined;
  // Walk the task's group path and find the first collapsed group with a position
  for (const groupName of rt.groupPath) {
    if (collapsedGroups.has(groupName)) {
      return groupPositions.get(groupName);
    }
  }
  return undefined;
}

function findCollapsedLanePos(
  rt: ResolvedTask,
  collapsedLanes: Set<string> | undefined,
  taskLaneMap: Map<string, string>,
  lanePositions: Map<string, { x1: number; x2: number; y: number }>,
): { x1: number; x2: number; y: number } | undefined {
  if (!collapsedLanes) return undefined;
  const laneName = taskLaneMap.get(rt.task.id);
  if (laneName && collapsedLanes.has(laneName)) {
    return lanePositions.get(laneName);
  }
  return undefined;
}

function renderDependencyArrows(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  resolved: ResolvedSchedule,
  taskPositions: Map<string, { x1: number; x2: number; y: number }>,
  groupPositions: Map<string, { x1: number; x2: number; y: number }>,
  collapsedGroups: Set<string> | undefined,
  palette: PaletteColors,
  _isDark: boolean,
  isTagMode: boolean,
  lanePositions: Map<string, { x1: number; x2: number; y: number }>,
  collapsedLanes: Set<string> | undefined,
  taskLaneMap: Map<string, string>,
): void {
  // Deduplicate arrows that collapse to the same source→target position
  const drawnArrows = new Set<string>();

  // Build arrow list from task dependencies
  for (const rt of resolved.tasks) {
    const sourcePos = taskPositions.get(rt.task.id)
      ?? (isTagMode
        ? findCollapsedLanePos(rt, collapsedLanes, taskLaneMap, lanePositions)
        : findCollapsedGroupPos(rt, collapsedGroups, groupPositions));
    if (!sourcePos) continue;

    for (const dep of rt.task.dependencies) {
      // Find target task
      const targetTask = resolved.tasks.find(t => t.task.label === dep.targetName ||
        `${t.groupPath.join('.')}.${t.task.label}`.endsWith(dep.targetName));
      if (!targetTask) continue;

      const targetPos = taskPositions.get(targetTask.task.id)
        ?? (isTagMode
          ? findCollapsedLanePos(targetTask, collapsedLanes, taskLaneMap, lanePositions)
          : findCollapsedGroupPos(targetTask, collapsedGroups, groupPositions));
      if (!targetPos) continue;

      // Skip self-arrows (both source and target collapsed to the same group)
      if (sourcePos === targetPos) continue;

      // Deduplicate: multiple hidden tasks in the same collapsed group → same arrow
      const arrowKey = `${sourcePos.x1},${sourcePos.y}->${targetPos.x1},${targetPos.y}`;
      if (drawnArrows.has(arrowKey)) continue;
      drawnArrows.add(arrowKey);

      // Arrow from source end to target start
      const sx = sourcePos.x2;
      const sy = sourcePos.y;
      const tx = targetPos.x1;
      const ty = targetPos.y;

      // Bezier curve with dy-scaled control points for cross-lane arrows
      const dx = Math.abs(tx - sx);
      const dy = Math.abs(ty - sy);
      const cpOffset = Math.max(dx * 0.3, 15, dy * 0.4);

      const path = `M ${sx} ${sy} C ${sx + cpOffset} ${sy}, ${tx - cpOffset} ${ty}, ${tx} ${ty}`;

      const arrowColor = mix(palette.text, palette.bg, 50);
      const isCpArrow = rt.isCriticalPath && targetTask.isCriticalPath;

      g.append('path')
        .attr('class', 'gantt-dep-arrow')
        .attr('data-dep-from', rt.task.id)
        .attr('data-dep-to', targetTask.task.id)
        .attr('data-line-number', String(dep.lineNumber))
        .attr('data-critical-path', isCpArrow ? 'true' : null)
        .attr('d', path)
        .attr('fill', 'none')
        .attr('stroke', arrowColor)
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.5);

      // Arrowhead — always horizontal arrival (bezier cp2 has same Y as endpoint)
      const headSize = 5;
      const angle = 0;
      g.append('polygon')
        .attr('class', 'gantt-dep-arrowhead')
        .attr('data-dep-from', rt.task.id)
        .attr('data-dep-to', targetTask.task.id)
        .attr('data-line-number', String(dep.lineNumber))
        .attr('data-critical-path', isCpArrow ? 'true' : null)
        .attr('points', arrowheadPoints(tx, ty, headSize, angle))
        .attr('fill', arrowColor)
        .attr('opacity', 0.5);
    }
  }
}

function arrowheadPoints(x: number, y: number, size: number, angle: number): string {
  const a1 = angle + Math.PI * 0.8;
  const a2 = angle - Math.PI * 0.8;
  return `${x},${y} ${x + size * Math.cos(a1)},${y + size * Math.sin(a1)} ${x + size * Math.cos(a2)},${y + size * Math.sin(a2)}`;
}

// ── Tag Legend Rendering ─────────────────────────────────────

function applyCriticalPathHighlight(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  chartG: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
) {
  chartG.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-critical-path') === 'true' ? 1 : FADE_OPACITY);
  });
  chartG.selectAll<SVGElement, unknown>('.gantt-milestone').attr('opacity', FADE_OPACITY);
  chartG.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-critical-path') === 'true' ? 1 : FADE_OPACITY);
  });
  svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGElement, unknown>('.gantt-group-band-bg, .gantt-group-band-accent').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGElement, unknown>('.gantt-lane-band-bg, .gantt-lane-band-accent').attr('opacity', FADE_OPACITY);
  chartG.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent').attr('opacity', FADE_OPACITY);
  // Show critical path arrows at full opacity, fade others
  chartG.selectAll<SVGElement, unknown>('.gantt-dep-arrow, .gantt-dep-arrowhead').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-critical-path') === 'true' ? 0.7 : FADE_OPACITY);
  });
}

function resetHighlightAll(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  chartG: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
) {
  chartG.selectAll<SVGGElement, unknown>('.gantt-task, .gantt-milestone').attr('opacity', 1);
  chartG.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').attr('opacity', 1);
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').attr('opacity', 1);
  svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', 1);
  svg.selectAll<SVGElement, unknown>('.gantt-group-band-bg, .gantt-group-band-accent').attr('opacity', 1);
  svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', 1);
  svg.selectAll<SVGElement, unknown>('.gantt-lane-band-bg, .gantt-lane-band-accent').attr('opacity', 1);
  chartG.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent').attr('opacity', 1);
  chartG.selectAll<SVGElement, unknown>('.gantt-dep-arrow, .gantt-dep-arrowhead').attr('opacity', 0.5);
}

// ── Swimlane Icon Helper ─────────────────────────────────────

function drawSwimlaneIcon(
  parent: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  x: number,
  y: number,
  isActive: boolean,
  palette: PaletteColors,
): d3Selection.Selection<SVGGElement, unknown, null, undefined> {
  const iconG = parent.append('g')
    .attr('class', 'gantt-swimlane-icon')
    .attr('transform', `translate(${x}, ${y})`);

  const color = isActive ? palette.primary : palette.textMuted;
  const opacity = isActive ? 1 : 0.35;
  const barWidths = [8, 12, 6];
  const barH = 2;
  const gap = 3;

  for (let i = 0; i < barWidths.length; i++) {
    iconG.append('rect')
      .attr('x', 0)
      .attr('y', i * gap)
      .attr('width', barWidths[i])
      .attr('height', barH)
      .attr('rx', 1)
      .attr('fill', color)
      .attr('opacity', opacity);
  }

  return iconG;
}

function renderTagLegend(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  chartG: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  tagGroups: TagGroup[],
  activeGroupName: string | null,
  chartLeftMargin: number,
  chartInnerWidth: number,
  legendY: number,
  palette: PaletteColors,
  isDark: boolean,
  hasCriticalPath: boolean,
  criticalPathActive: boolean,
  optionLineNumbers: Record<string, number>,
  onToggle?: (groupName: string) => void,
  onToggleCriticalPath?: () => void,
  currentSwimlaneGroup?: string | null,
  onSwimlaneChange?: (group: string | null) => void,
  legendViewMode?: boolean,
  resolvedTasks?: ResolvedTask[],
): void {
  const groupBg = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);

  // Build visible groups: active group expanded + swimlane group as compact pill
  let visibleGroups: TagGroup[];
  if (activeGroupName) {
    const activeGroup = tagGroups.filter(g => g.name.toLowerCase() === activeGroupName.toLowerCase());
    const swimlaneGroup = currentSwimlaneGroup && currentSwimlaneGroup.toLowerCase() !== activeGroupName.toLowerCase()
      ? tagGroups.filter(g => g.name.toLowerCase() === currentSwimlaneGroup.toLowerCase())
      : [];
    visibleGroups = [...swimlaneGroup, ...activeGroup];
  } else {
    visibleGroups = tagGroups;
  }

  // Build set of used tag values per group from resolved tasks
  const usedValues = new Map<string, Set<string>>();
  if (resolvedTasks) {
    for (const group of visibleGroups) {
      const key = group.name.toLowerCase();
      const used = new Set<string>();
      for (const rt of resolvedTasks) {
        const val = rt.effectiveMetadata[key];
        if (val) used.add(val.toLowerCase());
      }
      usedValues.set(key, used);
    }
  }

  // Filter entries to only those used in the current view
  const filteredEntries = new Map<string, TagEntry[]>();
  for (const group of visibleGroups) {
    const key = group.name.toLowerCase();
    const used = usedValues.get(key);
    if (used && used.size > 0) {
      filteredEntries.set(key, group.entries.filter(e => used.has(e.value.toLowerCase())));
    } else {
      filteredEntries.set(key, group.entries);
    }
  }

  // Compute per-group widths
  const groupWidths: number[] = [];
  let totalW = 0;
  for (const group of visibleGroups) {
    const isActive = activeGroupName?.toLowerCase() === group.name.toLowerCase();
    const isSwimlane = currentSwimlaneGroup?.toLowerCase() === group.name.toLowerCase();
    const showIcon = !legendViewMode && tagGroups.length > 0;
    const iconReserve = showIcon ? LEGEND_ICON_W : 0;
    const pillW = measureLegendText(group.name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD + iconReserve;
    let groupW = pillW;
    if (isActive) {
      const entries = filteredEntries.get(group.name.toLowerCase()) ?? group.entries;
      let entriesW = 0;
      for (const entry of entries) {
        entriesW += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + measureLegendText(entry.value, LEGEND_ENTRY_FONT_SIZE) + LEGEND_ENTRY_TRAIL;
      }
      groupW = LEGEND_CAPSULE_PAD * 2 + pillW + 4 + entriesW;
    } else if (isSwimlane && !isActive) {
      // Compact swimlane pill: name + highlighted icon, no entries
      groupW = pillW;
    }
    groupWidths.push(groupW);
    totalW += groupW;
  }
  totalW += Math.max(0, (visibleGroups.length - 1) * LEGEND_GROUP_GAP);

  // Critical Path pill width
  const cpLabel = 'Critical Path';
  const cpPillW = measureLegendText(cpLabel, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;
  if (hasCriticalPath) {
    if (visibleGroups.length > 0) totalW += LEGEND_GROUP_GAP;
    totalW += cpPillW;
  }

  // Center over full container (matching title centering)
  const containerWidth = chartLeftMargin + chartInnerWidth + RIGHT_MARGIN;
  const legendX = (containerWidth - totalW) / 2;

  const legendRow = svg.append('g')
    .attr('class', 'gantt-tag-legend-container')
    .attr('transform', `translate(${legendX}, ${legendY})`);

  let cursorX = 0;

  for (let i = 0; i < visibleGroups.length; i++) {
    const group = visibleGroups[i];
    const isActive = activeGroupName?.toLowerCase() === group.name.toLowerCase();
    const isSwimlane = currentSwimlaneGroup?.toLowerCase() === group.name.toLowerCase();
    const showIcon = !legendViewMode && tagGroups.length > 0;
    const iconReserve = showIcon ? LEGEND_ICON_W : 0;
    const pillW = measureLegendText(group.name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD + iconReserve;
    const pillH = isActive ? LEGEND_HEIGHT - LEGEND_CAPSULE_PAD * 2 : LEGEND_HEIGHT;
    const groupW = groupWidths[i];

    const gEl = legendRow.append('g')
      .attr('transform', `translate(${cursorX}, 0)`)
      .attr('class', 'gantt-tag-legend-group')
      .attr('data-tag-group', group.name)
      .attr('data-line-number', String(group.lineNumber))
      .style('cursor', 'pointer')
      .on('click', () => { if (onToggle) onToggle(group.name); });

    if (isActive) {
      // Outer capsule background
      gEl.append('rect')
        .attr('width', groupW)
        .attr('height', LEGEND_HEIGHT)
        .attr('rx', LEGEND_HEIGHT / 2)
        .attr('fill', groupBg);
    }

    const pillXOff = isActive ? LEGEND_CAPSULE_PAD : 0;
    const pillYOff = isActive ? LEGEND_CAPSULE_PAD : 0;

    // Pill background
    gEl.append('rect')
      .attr('x', pillXOff)
      .attr('y', pillYOff)
      .attr('width', pillW)
      .attr('height', pillH)
      .attr('rx', pillH / 2)
      .attr('fill', isActive ? palette.bg : groupBg);

    // Active pill border
    if (isActive) {
      gEl.append('rect')
        .attr('x', pillXOff)
        .attr('y', pillYOff)
        .attr('width', pillW)
        .attr('height', pillH)
        .attr('rx', pillH / 2)
        .attr('fill', 'none')
        .attr('stroke', mix(palette.textMuted, palette.bg, 50))
        .attr('stroke-width', 0.75);
    }

    // Pill text (offset to leave room for icon on right)
    const textW = measureLegendText(group.name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;
    gEl.append('text')
      .attr('x', pillXOff + textW / 2)
      .attr('y', LEGEND_HEIGHT / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${LEGEND_PILL_FONT_SIZE}px`)
      .attr('font-weight', '500')
      .attr('fill', isActive || isSwimlane ? palette.text : palette.textMuted)
      .text(group.name);

    // ≡ swimlane icon (after pill name)
    if (showIcon) {
      const iconX = pillXOff + textW + 3;
      const iconY = (LEGEND_HEIGHT - 10) / 2;
      const iconEl = drawSwimlaneIcon(gEl, iconX, iconY, isSwimlane, palette);
      iconEl.append('title').text(`Group by ${group.name}`);
      iconEl
        .style('cursor', 'pointer')
        .on('click', (event: Event) => {
          event.stopPropagation();
          if (onSwimlaneChange) {
            onSwimlaneChange(
              currentSwimlaneGroup?.toLowerCase() === group.name.toLowerCase()
                ? null : group.name
            );
          }
        });
    }

    // Entries (when active — expanded color group, only used values)
    if (isActive) {
      const tagKey = group.name.toLowerCase();
      const entries = filteredEntries.get(tagKey) ?? group.entries;
      let ex = pillXOff + pillW + LEGEND_CAPSULE_PAD + 4;
      for (const entry of entries) {
        const entryValue = entry.value.toLowerCase();

        // Wrap dot + label in a <g> for hover targeting
        const entryG = gEl.append('g')
          .attr('class', 'gantt-legend-entry')
          .attr('data-line-number', String(entry.lineNumber))
          .style('cursor', 'pointer');

        // Dot
        entryG.append('circle')
          .attr('cx', ex + LEGEND_DOT_R)
          .attr('cy', LEGEND_HEIGHT / 2)
          .attr('r', LEGEND_DOT_R)
          .attr('fill', entry.color);

        // Label
        entryG.append('text')
          .attr('x', ex + LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP)
          .attr('y', LEGEND_HEIGHT / 2 + LEGEND_ENTRY_FONT_SIZE / 2 - 2)
          .attr('text-anchor', 'start')
          .attr('font-size', `${LEGEND_ENTRY_FONT_SIZE}px`)
          .attr('fill', palette.textMuted)
          .text(entry.value);

        // Hover: highlight matching tasks + labels + lane headers, fade others
        entryG
          .on('mouseenter', () => {
            chartG.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
              const el = d3Selection.select(this);
              const matches = el.attr(`data-tag-${tagKey}`) === entryValue;
              el.attr('opacity', matches ? 1 : FADE_OPACITY);
            });
            chartG.selectAll<SVGElement, unknown>('.gantt-milestone').attr('opacity', FADE_OPACITY);
            chartG.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').attr('opacity', FADE_OPACITY);
            // Fade left-side task labels
            svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').each(function () {
              const el = d3Selection.select(this);
              const matches = el.attr(`data-tag-${tagKey}`) === entryValue;
              el.attr('opacity', matches ? 1 : FADE_OPACITY);
            });
            // Fade group labels
            svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', FADE_OPACITY);
            // Fade non-matching lane headers + bands + accents
            svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').each(function () {
              const el = d3Selection.select(this);
              const matches = el.attr(`data-tag-${tagKey}`) === entryValue;
              el.attr('opacity', matches ? 1 : FADE_OPACITY);
            });
            chartG.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent').attr('opacity', FADE_OPACITY);
          })
          .on('mouseleave', () => {
            if (criticalPathActive) {
              applyCriticalPathHighlight(svg, chartG);
            } else {
              resetHighlightAll(svg, chartG);
            }
          });

        ex += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + measureLegendText(entry.value, LEGEND_ENTRY_FONT_SIZE) + LEGEND_ENTRY_TRAIL;
      }
    }

    cursorX += groupW + LEGEND_GROUP_GAP;
  }

  // Critical Path pill
  if (hasCriticalPath) {
    const cpLineNum = optionLineNumbers['critical-path'];
    const cpG = legendRow.append('g')
      .attr('transform', `translate(${cursorX}, 0)`)
      .attr('class', 'gantt-legend-critical-path')
      .style('cursor', 'pointer')
      .on('click', () => { if (onToggleCriticalPath) onToggleCriticalPath(); });
    if (cpLineNum) cpG.attr('data-line-number', String(cpLineNum));

    cpG.append('rect')
      .attr('width', cpPillW)
      .attr('height', LEGEND_HEIGHT)
      .attr('rx', LEGEND_HEIGHT / 2)
      .attr('fill', criticalPathActive ? palette.bg : groupBg);

    if (criticalPathActive) {
      cpG.append('rect')
        .attr('width', cpPillW)
        .attr('height', LEGEND_HEIGHT)
        .attr('rx', LEGEND_HEIGHT / 2)
        .attr('fill', 'none')
        .attr('stroke', mix(palette.textMuted, palette.bg, 50))
        .attr('stroke-width', 0.75);
    }

    cpG.append('text')
      .attr('x', cpPillW / 2)
      .attr('y', LEGEND_HEIGHT / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${LEGEND_PILL_FONT_SIZE}px`)
      .attr('font-weight', '500')
      .attr('fill', criticalPathActive ? palette.text : palette.textMuted)
      .text(cpLabel);

    // Apply persistent highlighting when active
    if (criticalPathActive) {
      applyCriticalPathHighlight(svg, chartG);
    }

    cpG
      .on('mouseenter', () => {
        applyCriticalPathHighlight(svg, chartG);
      })
      .on('mouseleave', () => {
        if (!criticalPathActive) {
          resetHighlightAll(svg, chartG);
        }
      });
  }
}

// ── Era & Marker Rendering ──────────────────────────────────

const ERA_COLORS = ['#5e81ac', '#a3be8c', '#ebcb8b', '#d08770', '#b48ead'];

function renderErasAndMarkers(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  resolved: ResolvedSchedule,
  xScale: d3Scale.ScaleLinear<number, number>,
  innerHeight: number,
  palette: PaletteColors,
): void {
  // Eras: semi-transparent background bands
  for (let i = 0; i < resolved.eras.length; i++) {
    const era = resolved.eras[i];
    const color = era.color || ERA_COLORS[i % ERA_COLORS.length];
    const sx = xScale(parseDateToFractionalYear(era.startDate));
    const ex = xScale(parseDateToFractionalYear(era.endDate));
    if (ex <= sx) continue;

    const baseEraOpacity = 0.08;
    const hoverEraOpacity = 0.16;
    const eraStartDate = parseDateStringToDate(era.startDate);
    const eraEndDate = parseDateStringToDate(era.endDate);

    const eraG = g.append('g')
      .attr('class', 'gantt-era-group')
      .attr('data-line-number', String(era.lineNumber));

    const eraRect = eraG.append('rect')
      .attr('class', 'gantt-era')
      .attr('x', sx)
      .attr('y', 0)
      .attr('width', ex - sx)
      .attr('height', innerHeight)
      .attr('fill', color)
      .attr('opacity', baseEraOpacity);

    // Era label (above date scale, same zone as markers)
    eraG.append('text')
      .attr('class', 'gantt-era-label')
      .attr('x', (sx + ex) / 2)
      .attr('y', -24)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', color)
      .attr('opacity', 0.7)
      .style('cursor', 'pointer')
      .text(era.label);

    eraG
      .on('mouseenter', () => {
        // Fade everything
        g.selectAll<SVGGElement, unknown>('.gantt-task').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-milestone').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').attr('opacity', FADE_OPACITY);
        svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', FADE_OPACITY);
        svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').attr('opacity', FADE_OPACITY);
        svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-dep-arrow, .gantt-dep-arrowhead').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr('opacity', FADE_OPACITY);
        // Highlight this era
        eraRect.attr('opacity', hoverEraOpacity);
        showGanttDateIndicators(g, xScale, eraStartDate, eraEndDate, innerHeight, color);
      })
      .on('mouseleave', () => {
        resetHighlight(g, svg);
        eraRect.attr('opacity', baseEraOpacity);
        hideGanttDateIndicators(g);
      });
  }

  // Markers: label → diamond → dashed line (same layout as timeline)
  for (const marker of resolved.markers) {
    const color = marker.color || palette.accent || '#d08770';
    const mx = xScale(parseDateToFractionalYear(marker.date));
    const markerDate = parseDateStringToDate(marker.date);
    const diamondSize = 5;
    const labelY = -24;
    const diamondY = labelY + 14;

    const markerG = g.append('g')
      .attr('class', 'gantt-marker-group')
      .attr('data-line-number', String(marker.lineNumber))
      .style('cursor', 'pointer');

    // Invisible hit rect for easier clicking/hovering
    markerG.append('rect')
      .attr('x', mx - 40)
      .attr('y', labelY - 12)
      .attr('width', 80)
      .attr('height', innerHeight - labelY + 12)
      .attr('fill', 'transparent')
      .attr('pointer-events', 'all');

    // Label above diamond
    markerG.append('text')
      .attr('class', 'gantt-marker-label')
      .attr('x', mx)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('fill', color)
      .text(marker.label);

    // Diamond below label
    markerG.append('path')
      .attr('d', `M${mx},${diamondY - diamondSize} l${diamondSize},${diamondSize} l-${diamondSize},${diamondSize} l-${diamondSize},-${diamondSize} Z`)
      .attr('fill', color)
      .attr('opacity', 0.9);

    // Dashed line from diamond down
    markerG.append('line')
      .attr('class', 'gantt-marker')
      .attr('x1', mx)
      .attr('y1', diamondY + diamondSize)
      .attr('x2', mx)
      .attr('y2', innerHeight)
      .attr('stroke', color)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '6 4')
      .attr('opacity', 0.5);

    // Hide marker line/diamond on hover but keep label visible
    const markerLine = markerG.select('.gantt-marker');
    const markerDiamond = markerG.select('path');
    markerG
      .on('mouseenter', () => {
        // Fade everything
        g.selectAll<SVGGElement, unknown>('.gantt-task').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-milestone').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').attr('opacity', FADE_OPACITY);
        svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', FADE_OPACITY);
        svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').attr('opacity', FADE_OPACITY);
        svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-dep-arrow, .gantt-dep-arrowhead').attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-era-group').attr('opacity', FADE_OPACITY);
        // Fade other markers but keep this one highlighted
        g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr('opacity', FADE_OPACITY);
        markerG.attr('opacity', 1);
        markerLine.attr('opacity', 0.8);
        markerDiamond.attr('opacity', 0);
        showGanttDateIndicators(g, xScale, markerDate, null, innerHeight, color, { skipStartLine: true });
      })
      .on('mouseleave', () => {
        resetHighlight(g, svg);
        markerLine.attr('opacity', 0.5);
        markerDiamond.attr('opacity', 0.9);
        hideGanttDateIndicators(g);
      });
  }
}

/**
 * Parse a date string (YYYY, YYYY-MM, YYYY-MM-DD) to a Date object.
 * Used for eras and markers which store dates as strings.
 */
function parseDateStringToDate(s: string): Date {
  const parts = s.split('-').map(p => parseInt(p, 10));
  const year = parts[0];
  const month = parts.length >= 2 ? parts[1] - 1 : 0;
  const day = parts.length >= 3 ? parts[2] : 1;
  return new Date(year, month, day);
}

/**
 * Parse a date string (YYYY, YYYY-MM, YYYY-MM-DD) to fractional year.
 * Used for eras and markers which may have partial dates.
 */
function parseDateToFractionalYear(s: string): number {
  return dateToFractionalYear(parseDateStringToDate(s));
}

// ── Dependency Hover Helpers ─────────────────────────────────

const FADE_OPACITY = 0.1;

function highlightDeps(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  taskId: string,
  resolved: ResolvedSchedule,
): void {
  // Find immediate predecessors and successors
  const related = new Set<string>([taskId]);
  const task = resolved.tasks.find(t => t.task.id === taskId);
  if (!task) return;

  // Predecessors: tasks whose deps point to this task
  for (const rt of resolved.tasks) {
    for (const dep of rt.task.dependencies) {
      // Check if this dep points to our task
      if (dep.targetName === task.task.label ||
          `${task.groupPath.join('.')}.${task.task.label}`.endsWith(dep.targetName)) {
        related.add(rt.task.id);
      }
    }
  }
  // Successors: tasks this task has deps pointing to
  for (const dep of task.task.dependencies) {
    const target = resolved.tasks.find(t =>
      t.task.label === dep.targetName ||
      `${t.groupPath.join('.')}.${t.task.label}`.endsWith(dep.targetName));
    if (target) related.add(target.task.id);
  }

  // Fade all tasks not in related set
  g.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
    const el = d3Selection.select(this);
    const id = el.attr('data-task-id');
    el.attr('opacity', id && related.has(id) ? 1 : FADE_OPACITY);
  });
  g.selectAll<SVGGElement, unknown>('.gantt-milestone').attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent').attr('opacity', FADE_OPACITY);

  // Fade dependency arrows not connected to related tasks
  g.selectAll<SVGElement, unknown>('.gantt-dep-arrow, .gantt-dep-arrowhead').each(function () {
    const el = d3Selection.select(this);
    const from = el.attr('data-dep-from');
    const to = el.attr('data-dep-to');
    const isRelated = (from && related.has(from)) || (to && related.has(to));
    el.attr('opacity', isRelated ? 0.5 : FADE_OPACITY);
  });
  // Fade markers
  g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr('opacity', FADE_OPACITY);
}

function highlightGroup(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  groupName: string,
): void {
  // Fade tasks not in this group
  g.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-group') === groupName ? 1 : FADE_OPACITY);
  });
  // Fade milestones not in this group
  g.selectAll<SVGElement, unknown>('.gantt-milestone').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-group') === groupName ? 1 : FADE_OPACITY);
  });
  // Fade other group bars
  g.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-group') === groupName ? 1 : FADE_OPACITY);
  });
  // Fade other group labels
  svg.selectAll<SVGGElement, unknown>('.gantt-group-label').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-group') === groupName ? 1 : FADE_OPACITY);
  });
  // Fade task labels not in this group
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-group') === groupName ? 1 : FADE_OPACITY);
  });
  // Fade group bands not matching
  svg.selectAll<SVGElement, unknown>('.gantt-group-band-bg, .gantt-group-band-accent').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-group') === groupName ? 1 : FADE_OPACITY);
  });
  // Fade lane elements
  svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGElement, unknown>('.gantt-lane-band-bg, .gantt-lane-band-accent').attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent').attr('opacity', FADE_OPACITY);
  // Fade markers
  g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr('opacity', FADE_OPACITY);
}

function highlightLane(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  tagKey: string,
  laneName: string,
): void {
  const tagAttr = `data-tag-${tagKey}`;
  const laneValue = laneName.toLowerCase();

  // Fade tasks not in this lane
  g.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr(tagAttr) === laneValue ? 1 : FADE_OPACITY);
  });
  // Fade milestones not in this lane
  g.selectAll<SVGElement, unknown>('.gantt-milestone').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr(tagAttr) === laneValue ? 1 : FADE_OPACITY);
  });
  // Fade task labels not in this lane
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr(tagAttr) === laneValue ? 1 : FADE_OPACITY);
  });
  // Fade other lane headers
  svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-lane') === laneName ? 1 : FADE_OPACITY);
  });
  // Fade other lane band groups
  g.selectAll<SVGElement, unknown>('.gantt-lane-band-group').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-lane') === laneName ? 1 : FADE_OPACITY);
  });
  // Fade lane bands not matching
  svg.selectAll<SVGElement, unknown>('.gantt-lane-band-bg, .gantt-lane-band-accent').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-lane') === laneName ? 1 : FADE_OPACITY);
  });
  // Fade group elements (not relevant in lane mode)
  g.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGElement, unknown>('.gantt-group-band-bg, .gantt-group-band-accent').attr('opacity', FADE_OPACITY);
  // Fade markers
  g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr('opacity', FADE_OPACITY);
}

function highlightTask(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  taskId: string,
): void {
  // Fade tasks not matching
  g.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-task-id') === taskId ? 1 : FADE_OPACITY);
  });
  // Fade milestones not matching
  g.selectAll<SVGElement, unknown>('.gantt-milestone').attr('opacity', FADE_OPACITY);
  // Fade task labels not matching
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-task-id') === taskId ? 1 : FADE_OPACITY);
  });
  // Fade group/lane elements
  g.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGElement, unknown>('.gantt-group-band-bg, .gantt-group-band-accent').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGElement, unknown>('.gantt-lane-band-bg, .gantt-lane-band-accent').attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group').attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>('.gantt-dep-arrow, .gantt-dep-arrowhead').attr('opacity', FADE_OPACITY);
  // Fade markers
  g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr('opacity', FADE_OPACITY);
}

function highlightMilestone(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  taskId: string,
): void {
  // Fade tasks
  g.selectAll<SVGGElement, unknown>('.gantt-task').attr('opacity', FADE_OPACITY);
  // Fade milestones not matching
  g.selectAll<SVGElement, unknown>('.gantt-milestone').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-task-id') === taskId ? 1 : FADE_OPACITY);
  });
  // Fade task labels not matching
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-task-id') === taskId ? 1 : FADE_OPACITY);
  });
  // Fade group/lane elements
  g.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGElement, unknown>('.gantt-group-band-bg, .gantt-group-band-accent').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGElement, unknown>('.gantt-lane-band-bg, .gantt-lane-band-accent').attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group').attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>('.gantt-dep-arrow, .gantt-dep-arrowhead').attr('opacity', FADE_OPACITY);
  // Fade markers
  g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr('opacity', FADE_OPACITY);
}

function highlightTaskLabel(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  lineNumber: number,
): void {
  const ln = String(lineNumber);
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-line-number') === ln ? 1 : FADE_OPACITY);
  });
}

function resetTaskLabels(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
): void {
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').attr('opacity', 1);
}

function resetHighlight(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
): void {
  g.selectAll<SVGGElement, unknown>('.gantt-task, .gantt-milestone').attr('opacity', 1);
  g.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').attr('opacity', 1);
  svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', 1);
  svg.selectAll<SVGElement, unknown>('.gantt-group-band-bg, .gantt-group-band-accent').attr('opacity', 1);
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').attr('opacity', 1);
  svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', 1);
  svg.selectAll<SVGElement, unknown>('.gantt-lane-band-bg, .gantt-lane-band-accent').attr('opacity', 1);
  g.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group').attr('opacity', 1);
  g.selectAll<SVGElement, unknown>('.gantt-dep-arrow, .gantt-dep-arrowhead').attr('opacity', 0.5);
  g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr('opacity', 1);
  g.selectAll<SVGElement, unknown>('.gantt-era-group').attr('opacity', 1);
}

// ── Row Building ────────────────────────────────────────────

type GroupRow = { type: 'group'; group: ResolvedGroup };
type TaskRow = { type: 'task'; task: ResolvedTask };
type LaneHeaderRow = { type: 'lane-header'; laneName: string; laneColor: string; aggregateProgress: number | null; tagKey: string; isCollapsed: boolean; laneStartDate: Date | null; laneEndDate: Date | null };
type Row = GroupRow | TaskRow | LaneHeaderRow;

// Public type aliases (prefixed to avoid collisions in consumer code)
export type { GroupRow as GanttGroupRow, TaskRow as GanttTaskRow, LaneHeaderRow as GanttLaneHeaderRow, Row as GanttRow };

function buildRowList(resolved: ResolvedSchedule, collapsedGroups?: Set<string>): Row[] {
  const rows: Row[] = [];
  const groupMap = new Map<string, ResolvedGroup>();
  for (const g of resolved.groups) {
    groupMap.set(g.name, g);
  }

  // Sort tasks by group order so tasks from the same group are contiguous.
  // resolved.groups is in parse-tree order; use that as the sort key.
  // Tasks with no group come first, then tasks grouped by their groupPath.
  const groupOrder = new Map<string, number>();
  resolved.groups.forEach((g, i) => groupOrder.set(g.name, i));

  const sortedTasks = [...resolved.tasks].sort((a, b) => {
    const maxLen = Math.max(a.groupPath.length, b.groupPath.length);
    for (let i = 0; i < maxLen; i++) {
      const ga = a.groupPath[i];
      const gb = b.groupPath[i];
      if (ga === gb) continue;
      // Task with shorter path (no group at this level) comes first
      if (ga === undefined) return -1;
      if (gb === undefined) return 1;
      const oa = groupOrder.get(ga) ?? 0;
      const ob = groupOrder.get(gb) ?? 0;
      if (oa !== ob) return oa - ob;
    }
    return 0; // same group — preserve original (topo-sort) order
  });

  // Build a flat display list from the resolved groups and tasks
  // Groups appear before their children. Collapsed groups hide children.
  const seenGroups = new Set<string>();
  for (const rt of sortedTasks) {
    // Check if any group in this task's path is collapsed
    const isHidden = rt.groupPath.some(g => collapsedGroups?.has(g));
    if (isHidden) {
      // Still insert collapsed group headers if not seen
      for (const groupName of rt.groupPath) {
        if (!seenGroups.has(groupName)) {
          seenGroups.add(groupName);
          const group = groupMap.get(groupName);
          if (group) {
            rows.push({ type: 'group', group });
          }
        }
        if (collapsedGroups?.has(groupName)) break; // stop at collapsed group
      }
      continue; // skip task row
    }

    // Insert group rows for any groups in the path not yet seen
    for (let i = 0; i < rt.groupPath.length; i++) {
      const groupName = rt.groupPath[i];
      if (!seenGroups.has(groupName)) {
        seenGroups.add(groupName);
        const group = groupMap.get(groupName);
        if (group) {
          rows.push({ type: 'group', group });
        }
      }
    }
    rows.push({ type: 'task', task: rt });
  }

  return rows;
}

// ── Tag Lane Row Building ──────────────────────────────────

export function buildTagLaneRowList(
  resolved: ResolvedSchedule,
  swimlaneGroup: string,
  collapsedLanes?: Set<string>,
): Row[] | null {
  const tagGroup = resolved.tagGroups.find(
    g => g.name.toLowerCase() === swimlaneGroup.toLowerCase()
  );
  if (!tagGroup) return null;

  const tagKey = tagGroup.name.toLowerCase();
  const rows: Row[] = [];

  // Bucket tasks by tag value
  const buckets = new Map<string, ResolvedTask[]>();
  const unbucketed: ResolvedTask[] = [];

  for (const rt of resolved.tasks) {
    let value = rt.effectiveMetadata[tagKey];
    if (!value && tagGroup.defaultValue) {
      value = tagGroup.defaultValue;
    }
    if (value) {
      const key = value.toLowerCase();
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(rt);
    } else {
      unbucketed.push(rt);
    }
  }

  // Emit lanes in tag entry declaration order (skip empty lanes)
  for (const entry of tagGroup.entries) {
    const entryKey = entry.value.toLowerCase();
    const tasks = buckets.get(entryKey) ?? [];
    if (tasks.length === 0) continue;
    // Sort tasks within lane by start date
    tasks.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    // Compute duration-weighted aggregate progress (tasks without progress count as 0%)
    const aggregateProgress = durationWeightedProgress(tasks);

    // Compute lane date range from tasks
    const laneStartDate = tasks.length > 0 ? new Date(Math.min(...tasks.map(t => t.startDate.getTime()))) : null;
    const laneEndDate = tasks.length > 0 ? new Date(Math.max(...tasks.map(t => t.endDate.getTime()))) : null;

    const isCollapsed = collapsedLanes?.has(entry.value) ?? false;
    rows.push({
      type: 'lane-header',
      laneName: entry.value,
      laneColor: entry.color,
      aggregateProgress,
      tagKey,
      isCollapsed,
      laneStartDate,
      laneEndDate,
    });
    if (!isCollapsed) {
      for (const rt of tasks) {
        rows.push({ type: 'task', task: rt });
      }
    }
  }

  // Append unbucketed tasks as "No {GroupName}" lane
  if (unbucketed.length > 0) {
    unbucketed.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    const aggregateProgress = durationWeightedProgress(unbucketed);

    const noLaneStartDate = unbucketed.length > 0 ? new Date(Math.min(...unbucketed.map(t => t.startDate.getTime()))) : null;
    const noLaneEndDate = unbucketed.length > 0 ? new Date(Math.max(...unbucketed.map(t => t.endDate.getTime()))) : null;

    const noLaneName = `No ${tagGroup.name}`;
    const isCollapsed = collapsedLanes?.has(noLaneName) ?? false;
    rows.push({
      type: 'lane-header',
      laneName: noLaneName,
      laneColor: '#999999',
      aggregateProgress,
      tagKey,
      isCollapsed,
      laneStartDate: noLaneStartDate,
      laneEndDate: noLaneEndDate,
    });
    if (!isCollapsed) {
      for (const rt of unbucketed) {
        rows.push({ type: 'task', task: rt });
      }
    }
  }

  return rows;
}

// ── Helpers ─────────────────────────────────────────────────

/** Duration-weighted progress: tasks without explicit progress count as 0%. Returns null if no task has progress. */
function durationWeightedProgress(tasks: ResolvedTask[]): number | null {
  let totalDuration = 0;
  let totalProgress = 0;
  let hasProgress = false;
  for (const rt of tasks) {
    const dur = rt.endDate.getTime() - rt.startDate.getTime();
    totalDuration += dur;
    if (rt.task.progress !== null) {
      totalProgress += rt.task.progress * dur;
      hasProgress = true;
    }
  }
  return hasProgress && totalDuration > 0 ? totalProgress / totalDuration : null;
}

function dateToFractionalYear(d: Date): number {
  const y = d.getFullYear();
  const startOfYear = new Date(y, 0, 1);
  const endOfYear = new Date(y + 1, 0, 1);
  const fraction = (d.getTime() - startOfYear.getTime()) / (endOfYear.getTime() - startOfYear.getTime());
  return y + fraction;
}

function diamondPoints(cx: number, cy: number, size: number): string {
  const half = size / 2;
  return `${cx},${cy - half} ${cx + half},${cy} ${cx},${cy + half} ${cx - half},${cy}`;
}

// ── Hover Date Indicators ───────────────────────────────────

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatGanttDate(d: Date): string {
  const base = `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  if (d.getHours() === 0 && d.getMinutes() === 0) return base;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${base} ${hh}:${mm}`;
}

function showGanttDateIndicators(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  xScale: d3Scale.ScaleLinear<number, number>,
  startDate: Date,
  endDate: Date | null,
  innerHeight: number,
  color: string,
  options?: { skipStartLine?: boolean },
): void {
  // Fade existing scale ticks and today marker
  g.selectAll('.gantt-scale-tick').attr('opacity', 0.05);
  g.selectAll('.gantt-today').attr('opacity', 0.05);

  // Wrap all hover indicators in a group that ignores pointer events,
  // so they don't steal mouseleave from the element being hovered.
  const hg = g.append('g')
    .attr('class', 'gantt-hover-date')
    .attr('pointer-events', 'none');

  const tickLen = 6;
  const startPos = xScale(dateToFractionalYear(startDate));
  const startLabel = formatGanttDate(startDate);

  // Start date — dashed vertical line (skip when caller already shows its own line)
  if (!options?.skipStartLine) {
    hg.append('line')
      .attr('class', 'gantt-hover-date')
      .attr('x1', startPos)
      .attr('y1', -tickLen)
      .attr('x2', startPos)
      .attr('y2', innerHeight)
      .attr('stroke', color)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 4')
      .attr('opacity', 0.6);
  }

  // Start date — top label
  hg.append('text')
    .attr('class', 'gantt-hover-date')
    .attr('x', startPos)
    .attr('y', -tickLen - 4)
    .attr('text-anchor', 'middle')
    .attr('fill', color)
    .attr('font-size', '10px')
    .attr('font-weight', '600')
    .text(startLabel);

  // Start date — bottom label
  hg.append('text')
    .attr('class', 'gantt-hover-date')
    .attr('x', startPos)
    .attr('y', innerHeight + tickLen + 12)
    .attr('text-anchor', 'middle')
    .attr('fill', color)
    .attr('font-size', '10px')
    .attr('font-weight', '600')
    .text(startLabel);

  if (endDate && endDate.getTime() !== startDate.getTime()) {
    const endPos = xScale(dateToFractionalYear(endDate));
    const endLabel = formatGanttDate(endDate);

    // When dates are close, push labels apart so they don't overlap.
    // ~90px is roughly the width of a date label like "Aug 12, 2026" at 10px.
    const minLabelGap = 90;
    const gap = endPos - startPos;
    let startLabelX = startPos;
    let endLabelX = endPos;
    let startAnchor = 'middle';
    let endAnchor = 'middle';
    if (gap < minLabelGap) {
      const mid = (startPos + endPos) / 2;
      startLabelX = mid - minLabelGap / 2;
      endLabelX = mid + minLabelGap / 2;
      startAnchor = 'middle';
      endAnchor = 'middle';
    }

    // End date — dashed vertical line
    hg.append('line')
      .attr('class', 'gantt-hover-date')
      .attr('x1', endPos)
      .attr('y1', -tickLen)
      .attr('x2', endPos)
      .attr('y2', innerHeight)
      .attr('stroke', color)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 4')
      .attr('opacity', 0.6);

    // Reposition start labels to avoid overlap
    hg.selectAll<SVGTextElement, unknown>('text.gantt-hover-date').each(function () {
      const el = d3Selection.select(this);
      if (el.text() === startLabel) {
        el.attr('x', startLabelX).attr('text-anchor', startAnchor);
      }
    });

    // End date — top label
    hg.append('text')
      .attr('class', 'gantt-hover-date')
      .attr('x', endLabelX)
      .attr('y', -tickLen - 4)
      .attr('text-anchor', endAnchor)
      .attr('fill', color)
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .text(endLabel);

    // End date — bottom label
    hg.append('text')
      .attr('class', 'gantt-hover-date')
      .attr('x', endLabelX)
      .attr('y', innerHeight + tickLen + 12)
      .attr('text-anchor', endAnchor)
      .attr('fill', color)
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .text(endLabel);
  }
}

function hideGanttDateIndicators(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
): void {
  g.selectAll('.gantt-hover-date').remove();
  // Restore scale tick opacity
  g.selectAll('.gantt-scale-tick').each(function () {
    const el = d3Selection.select(this);
    const isDashed = el.attr('stroke-dasharray');
    el.attr('opacity', isDashed ? 0.15 : 0.4);
  });
  // Restore today marker opacity
  g.selectAll('.gantt-today').attr('opacity', 0.7);
}

function resolveTaskColor(
  rt: ResolvedTask,
  activeTagGroup: string | null,
  resolved: ResolvedSchedule,
  seriesColors: string[],
  palette: PaletteColors,
): string {
  // Try tag-based coloring first
  const tagColor = resolveTagColor(
    rt.effectiveMetadata,
    resolved.tagGroups,
    activeTagGroup,
  );
  if (tagColor && tagColor !== '#999999') return tagColor;

  // Fall back to group-based coloring
  if (rt.groupPath.length > 0) {
    const topGroup = rt.groupPath[0];
    const groupIdx = resolved.groups.findIndex(g => g.name === topGroup);
    if (groupIdx >= 0) {
      const group = resolved.groups[groupIdx];
      if (group.color) return group.color;
      return seriesColors[groupIdx % seriesColors.length];
    }
  }

  // Default
  return palette.accent || seriesColors[0] || '#4a90d9';
}

function renderTimeScaleHorizontal(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  scale: d3Scale.ScaleLinear<number, number>,
  innerWidth: number,
  innerHeight: number,
  textColor: string,
): void {
  const [domainMin, domainMax] = scale.domain();
  const ticks = computeTimeTicks(domainMin, domainMax, scale);
  if (ticks.length < 2) return;

  const tickLen = 6;
  const opacity = 0.4;
  const guideOpacity = 0.15;

  for (const tick of ticks) {
    // Guide line
    g.append('line')
      .attr('class', 'gantt-scale-tick')
      .attr('x1', tick.pos)
      .attr('y1', 0)
      .attr('x2', tick.pos)
      .attr('y2', innerHeight)
      .attr('stroke', textColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4 4')
      .attr('opacity', guideOpacity);

    // Top tick
    g.append('line')
      .attr('class', 'gantt-scale-tick')
      .attr('x1', tick.pos)
      .attr('y1', 0)
      .attr('x2', tick.pos)
      .attr('y2', -tickLen)
      .attr('stroke', textColor)
      .attr('stroke-width', 1)
      .attr('opacity', opacity);

    // Top label
    g.append('text')
      .attr('class', 'gantt-scale-tick')
      .attr('x', tick.pos)
      .attr('y', -tickLen - 4)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'auto')
      .attr('font-size', '10px')
      .attr('fill', textColor)
      .attr('opacity', opacity)
      .text(tick.label);

    // Bottom tick
    g.append('line')
      .attr('class', 'gantt-scale-tick')
      .attr('x1', tick.pos)
      .attr('y1', innerHeight)
      .attr('x2', tick.pos)
      .attr('y2', innerHeight + tickLen)
      .attr('stroke', textColor)
      .attr('stroke-width', 1)
      .attr('opacity', opacity);

    g.append('text')
      .attr('class', 'gantt-scale-tick')
      .attr('x', tick.pos)
      .attr('y', innerHeight + tickLen + 12)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', textColor)
      .attr('opacity', opacity)
      .text(tick.label);
  }
}
