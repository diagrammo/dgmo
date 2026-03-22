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
  LEGEND_PILL_FONT_W,
  LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_FONT_W,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL,
  LEGEND_GROUP_GAP,
} from '../utils/legend-constants';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../d3';
import type { ResolvedSchedule, ResolvedTask, ResolvedGroup, Weekday } from './types';
import type { TagGroup } from '../utils/tag-groups';

// ── Constants ───────────────────────────────────────────────

const BAR_H = 22;
const ROW_GAP = 6;
const GROUP_GAP = 14;
const GROUP_LABEL_GAP = 8;
const MILESTONE_SIZE = 10;
const MIN_LEFT_MARGIN = 120;
const BOTTOM_MARGIN = 40;
const RIGHT_MARGIN = 20;

// ── Main Renderer ───────────────────────────────────────────

export function renderGantt(
  container: HTMLDivElement,
  resolved: ResolvedSchedule,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions,
  viewMode?: boolean,
  collapsedGroups?: Set<string>,
  onToggleGroup?: (groupName: string) => void,
): void {
  // Clear previous content
  container.innerHTML = '';

  if (resolved.error || resolved.tasks.length === 0) return;

  // ── Compute layout dimensions ───────────────────────────

  const seriesColors = getSeriesColors(palette);
  let currentActiveGroup: string | null = resolved.tagGroups.length > 0
    ? resolved.tagGroups[0].name
    : null;

  // Compute left margin based on longest label
  const allLabels = [
    ...resolved.tasks.map(t => t.task.label),
    ...resolved.groups.map(g => '  '.repeat(g.depth) + g.name),
  ];
  const maxLabelLen = Math.max(...allLabels.map(l => l.length), 10);
  const leftMargin = Math.max(MIN_LEFT_MARGIN, maxLabelLen * 7 + 30);

  // Compute rows: build a flat list of rows (groups + tasks in order)
  const rows = buildRowList(resolved, collapsedGroups);
  const totalRows = rows.length;

  // Vertical layout — matches timeline pattern (d3.ts:3649-3655)
  const title = resolved.options.title;
  const titleHeight = title ? 50 : 20;
  const tagLegendReserve = resolved.tagGroups.length > 0 ? LEGEND_HEIGHT + 8 : 0;
  const topDateLabelReserve = 22; // tick (6) + gap (4) + label height (~12)

  const marginTop = titleHeight + tagLegendReserve + topDateLabelReserve;

  // Content area
  const contentH = totalRows * (BAR_H + ROW_GAP) + GROUP_GAP * resolved.groups.length;
  const innerHeight = contentH;
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
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('font-size', '20px')
      .attr('font-weight', '700')
      .attr('fill', palette.text)
      .text(title);
  }

  // ── Tag legend (interactive) ────────────────────────────

  function drawLegend() {
    svg.selectAll('.gantt-tag-legend-container').remove();
    if (resolved.tagGroups.length > 0) {
      const legendY = titleHeight;
      renderTagLegend(
        svg, resolved.tagGroups, currentActiveGroup, leftMargin, innerWidth,
        legendY, palette, isDark,
        (groupName) => {
          // Toggle active group
          currentActiveGroup = currentActiveGroup?.toLowerCase() === groupName.toLowerCase()
            ? null : groupName;
          drawLegend();
          recolorBars();
        },
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
  renderErasAndMarkers(g, resolved, xScale, innerHeight, palette);

  // ── Render rows ─────────────────────────────────────────

  // Track task positions for dependency arrows
  const taskPositions = new Map<string, { x1: number; x2: number; y: number }>();
  let yOffset = 0;

  for (const row of rows) {
    if (row.type === 'group') {
      const group = row.group!;
      const isCollapsed = collapsedGroups?.has(group.name) ?? false;
      const indent = '  '.repeat(group.depth);
      const toggleIcon = isCollapsed ? '►' : '▼';

      // Group label with toggle
      const labelG = svg
        .append('g')
        .attr('class', 'gantt-group-label')
        .attr('data-group', group.name)
        .style('cursor', onToggleGroup ? 'pointer' : 'default')
        .on('click', () => {
          if (onToggleGroup) onToggleGroup(group.name);
        });

      const labelX = 10 + group.depth * 14;
      labelG
        .append('text')
        .attr('x', labelX)
        .attr('y', marginTop + yOffset + BAR_H / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('font-size', '11px')
        .attr('font-weight', 'bold')
        .attr('fill', palette.text)
        .text(toggleIcon + ' ' + group.name);

      // Group bar
      const gStart = dateToFractionalYear(group.startDate);
      const gEnd = dateToFractionalYear(group.endDate);
      const gx1 = xScale(gStart);
      const gx2 = xScale(gEnd);
      const groupColor = group.color || palette.textMuted;

      if (gx2 > gx1) {
        if (isCollapsed) {
          // Summary bar (full height, shows aggregate progress)
          const barWidth = Math.max(gx2 - gx1, 2);
          const summaryG = g.append('g')
            .attr('class', 'gantt-group-summary')
            .attr('data-line-number', String(group.lineNumber));

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
              .attr('rx', 4)
              .attr('fill', groupColor)
              .attr('opacity', 0.3);
          }
        } else {
          // Expanded: thin spanning header bar
          g.append('rect')
            .attr('class', 'gantt-group-bar')
            .attr('x', gx1)
            .attr('y', yOffset + BAR_H / 2 - 2)
            .attr('width', Math.max(gx2 - gx1, 2))
            .attr('height', 4)
            .attr('rx', 2)
            .attr('fill', groupColor)
            .attr('opacity', 0.5)
            .attr('data-line-number', String(group.lineNumber));
        }
      }

      yOffset += BAR_H + ROW_GAP;
    } else if (row.type === 'task') {
      const rt = row.task!;
      const task = rt.task;

      // Task label on the left (left-aligned with indent)
      const taskLabelX = 10 + rt.groupPath.length * 14 + 16; // extra offset under group toggle
      svg
        .append('text')
        .attr('class', 'gantt-task-label')
        .attr('x', taskLabelX)
        .attr('y', marginTop + yOffset + BAR_H / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('font-size', '11px')
        .attr('fill', palette.text)
        .attr('data-line-number', String(task.lineNumber))
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .text(task.label)
        .on('click', () => {
          if (onClickItem) onClickItem(task.lineNumber);
        });

      // Determine color
      let barColor = resolveTaskColor(rt, currentActiveGroup, resolved, seriesColors, palette);

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
          .style('cursor', onClickItem ? 'pointer' : 'default')
          .on('click', () => {
            if (onClickItem) onClickItem(task.lineNumber);
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
          .style('cursor', onClickItem ? 'pointer' : 'default')
          .on('click', () => {
            if (onClickItem) onClickItem(task.lineNumber);
          })
          .on('mouseenter', () => {
            if (resolved.options.dependencies) {
              highlightDeps(g, task.id, resolved);
            }
          })
          .on('mouseleave', () => {
            if (resolved.options.dependencies) {
              resetHighlight(g);
            }
          });

        // Set tag attributes
        for (const [key, value] of Object.entries(rt.effectiveMetadata)) {
          taskG.attr(`data-tag-${key}`, value.toLowerCase());
        }

        // Main bar
        taskG
          .append('rect')
          .attr('x', x1)
          .attr('y', yOffset)
          .attr('width', barWidth)
          .attr('height', BAR_H)
          .attr('rx', 4)
          .attr('fill', fillColor)
          .attr('stroke', barColor)
          .attr('stroke-width', 2);

        // Progress fill
        if (task.progress !== null && task.progress > 0) {
          const progressWidth = barWidth * Math.min(task.progress / 100, 1);
          taskG
            .append('rect')
            .attr('class', 'gantt-progress')
            .attr('x', x1)
            .attr('y', yOffset)
            .attr('width', progressWidth)
            .attr('height', BAR_H)
            .attr('rx', 4)
            .attr('fill', barColor)
            .attr('opacity', 0.3);
        }

        // Critical path styling
        if (rt.isCriticalPath) {
          taskG
            .append('rect')
            .attr('x', x1 - 2)
            .attr('y', yOffset - 2)
            .attr('width', barWidth + 4)
            .attr('height', BAR_H + 4)
            .attr('rx', 6)
            .attr('fill', 'none')
            .attr('stroke', barColor)
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '4 2')
            .attr('opacity', 0.6);
        }

        // Uncertainty gradient (last 20%)
        if (task.uncertain) {
          const gradId = `gantt-uncertain-${task.id}`;
          const defs = svg.select('defs').empty()
            ? svg.append('defs')
            : svg.select<SVGDefsElement>('defs');

          const grad = defs.append('linearGradient')
            .attr('id', gradId)
            .attr('x1', '0')
            .attr('x2', '1')
            .attr('y1', '0')
            .attr('y2', '0');
          grad.append('stop').attr('offset', '0%').attr('stop-color', fillColor).attr('stop-opacity', 1);
          grad.append('stop').attr('offset', '80%').attr('stop-color', fillColor).attr('stop-opacity', 1);
          grad.append('stop').attr('offset', '100%').attr('stop-color', fillColor).attr('stop-opacity', 0);

          // Overlay gradient on bar
          taskG
            .append('rect')
            .attr('x', x1)
            .attr('y', yOffset)
            .attr('width', barWidth)
            .attr('height', BAR_H)
            .attr('rx', 4)
            .attr('fill', `url(#${gradId})`);
        }

        // Label inside bar (if fits)
        const textWidth = task.label.length * 6.5;
        if (textWidth < barWidth - 8) {
          taskG
            .append('text')
            .attr('x', x1 + 6)
            .attr('y', yOffset + BAR_H / 2)
            .attr('dy', '0.35em')
            .attr('font-size', '10px')
            .attr('fill', palette.text)
            .attr('pointer-events', 'none')
            .text(task.label);
        }

        // Track bar position for arrows
        taskPositions.set(task.id, { x1, x2: x1 + barWidth, y: yOffset + BAR_H / 2 });
      }

      yOffset += BAR_H + ROW_GAP;
    }
  }

  // ── Today marker ────────────────────────────────────────

  if (resolved.options.todayMarker !== 'off') {
    let todayDate: Date;
    if (resolved.options.todayMarker === 'on') {
      todayDate = new Date();
    } else {
      todayDate = new Date(resolved.options.todayMarker + 'T00:00:00');
    }
    const todayX = xScale(dateToFractionalYear(todayDate));
    if (todayX >= 0 && todayX <= innerWidth) {
      g.append('line')
        .attr('class', 'gantt-today')
        .attr('x1', todayX)
        .attr('y1', 0)
        .attr('x2', todayX)
        .attr('y2', innerHeight + 10)
        .attr('stroke', palette.accent || '#e74c3c')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '6 4')
        .attr('opacity', 0.7);

      g.append('text')
        .attr('x', todayX + 4)
        .attr('y', innerHeight + 24)
        .attr('text-anchor', 'start')
        .attr('font-size', '10px')
        .attr('fill', palette.accent || '#e74c3c')
        .attr('opacity', 0.7)
        .text('Today');
    }
  }

  // ── Dependency arrows ───────────────────────────────────

  if (resolved.options.dependencies) {
    renderDependencyArrows(g, resolved, taskPositions, palette, isDark);
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
    .attr('x', labelX)
    .attr('y', headerY)
    .attr('text-anchor', 'middle')
    .attr('font-size', '10px')
    .attr('font-weight', '500')
    .attr('fill', palette.text)
    .attr('opacity', 0)
    .attr('pointer-events', 'none')
    .text(label);

  // Hover: highlight band + show label in header
  bandG
    .on('mouseenter', () => {
      bandRect.attr('opacity', hoverOpacity);
      labelBg.attr('opacity', 1);
      labelText.attr('opacity', 1);
    })
    .on('mouseleave', () => {
      bandRect.attr('opacity', baseOpacity);
      labelBg.attr('opacity', 0);
      labelText.attr('opacity', 0);
    })
    .on('click', () => {
      if (onClickItem) onClickItem(lineNumber);
    });
}

// ── Dependency Arrow Rendering ──────────────────────────────

function renderDependencyArrows(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  resolved: ResolvedSchedule,
  taskPositions: Map<string, { x1: number; x2: number; y: number }>,
  palette: PaletteColors,
  _isDark: boolean,
): void {
  // Build arrow list from task dependencies
  for (const rt of resolved.tasks) {
    const sourcePos = taskPositions.get(rt.task.id);
    if (!sourcePos) continue;

    for (const dep of rt.task.dependencies) {
      // Find target task
      const targetTask = resolved.tasks.find(t => t.task.label === dep.targetName ||
        `${t.groupPath.join('.')}.${t.task.label}`.endsWith(dep.targetName));
      if (!targetTask) continue;

      const targetPos = taskPositions.get(targetTask.task.id);
      if (!targetPos) continue;

      // Arrow from source end to target start
      const sx = sourcePos.x2;
      const sy = sourcePos.y;
      const tx = targetPos.x1;
      const ty = targetPos.y;

      // Simple bezier curve
      const dx = Math.abs(tx - sx);
      const cpOffset = Math.max(dx * 0.3, 15);

      const path = `M ${sx} ${sy} C ${sx + cpOffset} ${sy}, ${tx - cpOffset} ${ty}, ${tx} ${ty}`;

      const arrowColor = mix(palette.text, palette.bg, 50);

      g.append('path')
        .attr('class', 'gantt-dep-arrow')
        .attr('d', path)
        .attr('fill', 'none')
        .attr('stroke', arrowColor)
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.5);

      // Arrowhead
      const headSize = 5;
      const angle = Math.atan2(ty - sy, tx - (tx - cpOffset));
      g.append('polygon')
        .attr('class', 'gantt-dep-arrowhead')
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

function renderTagLegend(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  tagGroups: TagGroup[],
  activeGroupName: string | null,
  chartLeftMargin: number,
  chartInnerWidth: number,
  legendY: number,
  palette: PaletteColors,
  isDark: boolean,
  onToggle?: (groupName: string) => void,
): void {
  const groupBg = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.surface, palette.bg, 30);

  // Compute per-group widths (all groups visible: active expanded, others collapsed)
  const groupWidths: number[] = [];
  let totalW = 0;
  for (const group of tagGroups) {
    const isActive = activeGroupName?.toLowerCase() === group.name.toLowerCase();
    const pillW = group.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
    let groupW = pillW;
    if (isActive) {
      let entriesW = 0;
      for (const entry of group.entries) {
        entriesW += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + entry.value.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
      }
      groupW = LEGEND_CAPSULE_PAD * 2 + pillW + 4 + entriesW;
    }
    groupWidths.push(groupW);
    totalW += groupW;
  }
  totalW += Math.max(0, (tagGroups.length - 1) * LEGEND_GROUP_GAP);

  // Center over chart area (not full container)
  const legendX = chartLeftMargin + (chartInnerWidth - totalW) / 2;

  const legendRow = svg.append('g')
    .attr('class', 'gantt-tag-legend-container')
    .attr('transform', `translate(${legendX}, ${legendY})`);

  let cursorX = 0;

  for (let i = 0; i < tagGroups.length; i++) {
    const group = tagGroups[i];
    const isActive = activeGroupName?.toLowerCase() === group.name.toLowerCase();
    const pillW = group.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
    const pillH = isActive ? LEGEND_HEIGHT - LEGEND_CAPSULE_PAD * 2 : LEGEND_HEIGHT;
    const groupW = groupWidths[i];

    const gEl = legendRow.append('g')
      .attr('transform', `translate(${cursorX}, 0)`)
      .attr('class', 'gantt-tag-legend-group')
      .attr('data-tag-group', group.name)
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

    // Pill text
    gEl.append('text')
      .attr('x', pillXOff + pillW / 2)
      .attr('y', LEGEND_HEIGHT / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2)
      .attr('text-anchor', 'middle')
      .attr('font-size', `${LEGEND_PILL_FONT_SIZE}px`)
      .attr('font-weight', '500')
      .attr('fill', isActive ? palette.text : palette.textMuted)
      .text(group.name);

    // Entries (when active)
    if (isActive) {
      let ex = pillXOff + pillW + LEGEND_CAPSULE_PAD + 4;
      for (const entry of group.entries) {
        // Dot
        gEl.append('circle')
          .attr('cx', ex + LEGEND_DOT_R)
          .attr('cy', LEGEND_HEIGHT / 2)
          .attr('r', LEGEND_DOT_R)
          .attr('fill', entry.color);

        // Label
        gEl.append('text')
          .attr('x', ex + LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP)
          .attr('y', LEGEND_HEIGHT / 2 + LEGEND_ENTRY_FONT_SIZE / 2 - 2)
          .attr('text-anchor', 'start')
          .attr('font-size', `${LEGEND_ENTRY_FONT_SIZE}px`)
          .attr('fill', palette.textMuted)
          .text(entry.value);

        ex += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + entry.value.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
      }
    }

    cursorX += groupW + LEGEND_GROUP_GAP;
  }
}

// ── Era & Marker Rendering ──────────────────────────────────

const ERA_COLORS = ['#5e81ac', '#a3be8c', '#ebcb8b', '#d08770', '#b48ead'];

function renderErasAndMarkers(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
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

    g.append('rect')
      .attr('class', 'gantt-era')
      .attr('x', sx)
      .attr('y', 0)
      .attr('width', ex - sx)
      .attr('height', innerHeight)
      .attr('fill', color)
      .attr('opacity', 0.08)
      .attr('pointer-events', 'none');

    // Era label (inside chart at top)
    g.append('text')
      .attr('class', 'gantt-era-label')
      .attr('x', (sx + ex) / 2)
      .attr('y', 12)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', color)
      .attr('opacity', 0.7)
      .text(era.label);
  }

  // Markers: vertical dashed lines
  for (const marker of resolved.markers) {
    const color = marker.color || palette.accent || '#d08770';
    const mx = xScale(parseDateToFractionalYear(marker.date));

    g.append('line')
      .attr('class', 'gantt-marker')
      .attr('x1', mx)
      .attr('y1', 0)
      .attr('x2', mx)
      .attr('y2', innerHeight)
      .attr('stroke', color)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '6 3')
      .attr('opacity', 0.5);

    // Diamond indicator (at top of chart area)
    g.append('polygon')
      .attr('points', diamondPoints(mx, 6, 8))
      .attr('fill', color)
      .attr('opacity', 0.5);

    // Label (inside chart at top)
    g.append('text')
      .attr('class', 'gantt-marker-label')
      .attr('x', mx + 8)
      .attr('y', 10)
      .attr('font-size', '9px')
      .attr('fill', color)
      .attr('opacity', 0.7)
      .text(marker.label);
  }
}

/**
 * Parse a date string (YYYY, YYYY-MM, YYYY-MM-DD) to fractional year.
 * Used for eras and markers which may have partial dates.
 */
function parseDateToFractionalYear(s: string): number {
  const parts = s.split('-').map(p => parseInt(p, 10));
  const year = parts[0];
  const month = parts.length >= 2 ? parts[1] : 1;
  const day = parts.length >= 3 ? parts[2] : 1;
  return year + (month - 1) / 12 + (day - 1) / 365;
}

// ── Dependency Hover Helpers ─────────────────────────────────

const FADE_OPACITY = 0.1;

function highlightDeps(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
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
}

function resetHighlight(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
): void {
  g.selectAll<SVGGElement, unknown>('.gantt-task, .gantt-milestone').attr('opacity', 1);
}

// ── Row Building ────────────────────────────────────────────

interface Row {
  type: 'group' | 'task';
  group?: ResolvedGroup;
  task?: ResolvedTask;
}

function buildRowList(resolved: ResolvedSchedule, collapsedGroups?: Set<string>): Row[] {
  const rows: Row[] = [];
  const groupMap = new Map<string, ResolvedGroup>();
  for (const g of resolved.groups) {
    groupMap.set(g.name, g);
  }

  // Build a flat display list from the resolved groups and tasks
  // Groups appear before their children. Collapsed groups hide children.
  const seenGroups = new Set<string>();
  for (const rt of resolved.tasks) {
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

// ── Helpers ─────────────────────────────────────────────────

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
