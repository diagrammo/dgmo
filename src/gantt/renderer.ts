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
  LEGEND_ICON_W,
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

  if (resolved.error || resolved.tasks.length === 0) return;

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

  // Compute left margin based on longest visible label
  const allLabels = isTagMode
    ? [
        ...rows.filter((r): r is LaneHeaderRow => r.type === 'lane-header').map(r => r.laneName),
        ...rows.filter((r): r is TaskRow => r.type === 'task').map(r => r.task.task.label),
      ]
    : [
        ...resolved.tasks.map(t => t.task.label),
        ...resolved.groups.map(g => '  '.repeat(g.depth) + g.name),
      ];
  const maxLabelLen = Math.max(...allLabels.map(l => l.length), 10);
  const leftMargin = Math.max(MIN_LEFT_MARGIN, maxLabelLen * 7 + 30);

  const totalRows = rows.length;

  // Vertical layout — matches timeline pattern (d3.ts:3649-3655)
  const title = resolved.options.title;
  const titleHeight = title ? 50 : 20;
  const tagLegendReserve = resolved.tagGroups.length > 0 ? LEGEND_HEIGHT + 8 : 0;
  const topDateLabelReserve = 22; // tick (6) + gap (4) + label height (~12)

  const marginTop = titleHeight + tagLegendReserve + topDateLabelReserve;

  // Content area
  const contentH = isTagMode
    ? totalRows * (BAR_H + ROW_GAP)
    : totalRows * (BAR_H + ROW_GAP) + GROUP_GAP * resolved.groups.length;
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

  const hasCriticalPath = resolved.options.criticalPath && resolved.tasks.some(t => t.isCriticalPath);

  function drawLegend() {
    svg.selectAll('.gantt-tag-legend-container').remove();
    if (resolved.tagGroups.length > 0 || hasCriticalPath) {
      const legendY = titleHeight;
      renderTagLegend(
        svg, g, resolved.tagGroups, currentActiveGroup, leftMargin, innerWidth,
        legendY, palette, isDark, hasCriticalPath, criticalPathActive,
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
  // Track collapsed group bar positions so hidden-task arrows redirect there
  const groupPositions = new Map<string, { x1: number; x2: number; y: number }>();
  let yOffset = 0;

  for (const row of rows) {
    if (row.type === 'lane-header') {
      // ── Lane header (tag swimlane mode) ──
      const laneColor = row.laneColor === '#999999' ? palette.textMuted : row.laneColor;
      const toggleIcon = row.isCollapsed ? '►' : '▼';
      const labelX = 10;
      const labelG = svg
        .append('g')
        .attr('class', 'gantt-lane-header')
        .attr(`data-tag-${row.tagKey}`, row.laneName.toLowerCase())
        .attr('data-lane', row.laneName)
        .style('cursor', onToggleLane ? 'pointer' : 'default')
        .on('click', () => {
          if (onToggleLane) onToggleLane(row.laneName);
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

      if (row.isCollapsed) {
        // Collapsed: summary bar with aggregate progress
        const barFill = mix(laneColor, palette.bg, 30);
        g.append('rect')
          .attr('class', 'gantt-lane-band')
          .attr('x', 0)
          .attr('y', yOffset)
          .attr('width', innerWidth)
          .attr('height', BAR_H)
          .attr('rx', 4)
          .attr('fill', barFill)
          .attr('stroke', laneColor)
          .attr('stroke-width', 1);

        if (row.aggregateProgress !== null && row.aggregateProgress > 0) {
          g.append('rect')
            .attr('class', 'gantt-lane-progress')
            .attr('x', 0)
            .attr('y', yOffset)
            .attr('width', innerWidth * Math.min(row.aggregateProgress / 100, 1))
            .attr('height', BAR_H)
            .attr('rx', 4)
            .attr('fill', laneColor)
            .attr('opacity', 0.5);
        }
      } else {
        // Expanded: subtle background band
        g.append('rect')
          .attr('class', 'gantt-lane-band')
          .attr('x', 0)
          .attr('y', yOffset)
          .attr('width', innerWidth)
          .attr('height', BAR_H)
          .attr('fill', laneColor)
          .attr('opacity', 0.06)
          .attr('pointer-events', 'none');
      }

      // 4px accent bar on left edge (always)
      g.append('rect')
        .attr('class', 'gantt-lane-accent')
        .attr('x', 0)
        .attr('y', yOffset)
        .attr('width', 4)
        .attr('height', BAR_H)
        .attr('fill', laneColor)
        .attr('opacity', 1);

      yOffset += BAR_H + ROW_GAP;
    } else if (row.type === 'group') {
      const group = row.group;
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
              .attr('opacity', 0.5);
          }

          // Track collapsed group position for dependency arrow redirection
          groupPositions.set(group.name, { x1: gx1, x2: gx1 + barWidth, y: yOffset + BAR_H / 2 });
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
      const rt = row.task;
      const task = rt.task;

      // Task label on the left (left-aligned with indent; flat in tag mode)
      const taskLabelX = isTagMode ? 20 : 10 + rt.groupPath.length * 14 + 16;
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
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .text(task.label)
        .on('click', () => {
          if (onClickItem) onClickItem(task.lineNumber);
        });

      // Tag attributes on label for legend hover matching
      for (const [key, value] of Object.entries(rt.effectiveMetadata)) {
        taskLabel.attr(`data-tag-${key}`, value.toLowerCase());
      }
      if (rt.isCriticalPath) {
        taskLabel.attr('data-critical-path', 'true');
      }

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
              if (criticalPathActive) {
                // Restore critical path highlighting after dep hover
                g.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
                  const el = d3Selection.select(this);
                  el.attr('opacity', el.attr('data-critical-path') === 'true' ? 1 : FADE_OPACITY);
                });
                g.selectAll<SVGGElement, unknown>('.gantt-milestone').attr('opacity', FADE_OPACITY);
              } else {
                resetHighlight(g);
              }
            }
          });

        // Set tag attributes
        for (const [key, value] of Object.entries(rt.effectiveMetadata)) {
          taskG.attr(`data-tag-${key}`, value.toLowerCase());
        }

        // Uncertainty gradient — fade out the trailing edge unless progress > 80%
        const showUncertainFade = task.uncertain && (task.progress === null || task.progress <= 80);
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
            .attr('rx', 4)
            .attr('fill', progressFill)
            .attr('opacity', 0.5);
        }

        // Critical path data attribute (for legend hover highlighting)
        if (rt.isCriticalPath) {
          taskG.attr('data-critical-path', 'true');
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

  if (!isTagMode && resolved.options.dependencies) {
    renderDependencyArrows(g, resolved, taskPositions, groupPositions, collapsedGroups, palette, isDark);
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

function renderDependencyArrows(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  resolved: ResolvedSchedule,
  taskPositions: Map<string, { x1: number; x2: number; y: number }>,
  groupPositions: Map<string, { x1: number; x2: number; y: number }>,
  collapsedGroups: Set<string> | undefined,
  palette: PaletteColors,
  _isDark: boolean,
): void {
  // Deduplicate arrows that collapse to the same source→target position
  const drawnArrows = new Set<string>();

  // Build arrow list from task dependencies
  for (const rt of resolved.tasks) {
    const sourcePos = taskPositions.get(rt.task.id)
      ?? findCollapsedGroupPos(rt, collapsedGroups, groupPositions);
    if (!sourcePos) continue;

    for (const dep of rt.task.dependencies) {
      // Find target task
      const targetTask = resolved.tasks.find(t => t.task.label === dep.targetName ||
        `${t.groupPath.join('.')}.${t.task.label}`.endsWith(dep.targetName));
      if (!targetTask) continue;

      const targetPos = taskPositions.get(targetTask.task.id)
        ?? findCollapsedGroupPos(targetTask, collapsedGroups, groupPositions);
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
  svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', FADE_OPACITY);
  chartG.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent').attr('opacity', FADE_OPACITY);
}

function resetHighlightAll(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  chartG: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
) {
  chartG.selectAll<SVGGElement, unknown>('.gantt-task, .gantt-milestone').attr('opacity', 1);
  chartG.selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary').attr('opacity', 1);
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').attr('opacity', 1);
  svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', 1);
  svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', 1);
  chartG.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent').attr('opacity', 1);
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
  onToggle?: (groupName: string) => void,
  onToggleCriticalPath?: () => void,
  currentSwimlaneGroup?: string | null,
  onSwimlaneChange?: (group: string | null) => void,
  legendViewMode?: boolean,
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

  // Compute per-group widths
  const groupWidths: number[] = [];
  let totalW = 0;
  for (const group of visibleGroups) {
    const isActive = activeGroupName?.toLowerCase() === group.name.toLowerCase();
    const isSwimlane = currentSwimlaneGroup?.toLowerCase() === group.name.toLowerCase();
    const showIcon = !legendViewMode && tagGroups.length > 0;
    const iconReserve = showIcon ? LEGEND_ICON_W : 0;
    const pillW = group.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD + iconReserve;
    let groupW = pillW;
    if (isActive) {
      let entriesW = 0;
      for (const entry of group.entries) {
        entriesW += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + entry.value.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
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
  const cpPillW = cpLabel.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
  if (hasCriticalPath) {
    if (visibleGroups.length > 0) totalW += LEGEND_GROUP_GAP;
    totalW += cpPillW;
  }

  // Center over chart area (not full container)
  const legendX = chartLeftMargin + (chartInnerWidth - totalW) / 2;

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
    const pillW = group.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD + iconReserve;
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

    // Pill text (offset to leave room for icon on right)
    const textW = group.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
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

    // Entries (when active — expanded color group)
    if (isActive) {
      const tagKey = group.name.toLowerCase();
      let ex = pillXOff + pillW + LEGEND_CAPSULE_PAD + 4;
      for (const entry of group.entries) {
        const entryValue = entry.value.toLowerCase();

        // Wrap dot + label in a <g> for hover targeting
        const entryG = gEl.append('g')
          .attr('class', 'gantt-legend-entry')
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

        ex += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + entry.value.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
      }
    }

    cursorX += groupW + LEGEND_GROUP_GAP;
  }

  // Critical Path pill
  if (hasCriticalPath) {
    const cpG = legendRow.append('g')
      .attr('transform', `translate(${cursorX}, 0)`)
      .attr('class', 'gantt-legend-critical-path')
      .style('cursor', 'pointer')
      .on('click', () => { if (onToggleCriticalPath) onToggleCriticalPath(); });

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

type GroupRow = { type: 'group'; group: ResolvedGroup };
type TaskRow = { type: 'task'; task: ResolvedTask };
type LaneHeaderRow = { type: 'lane-header'; laneName: string; laneColor: string; aggregateProgress: number | null; tagKey: string; isCollapsed: boolean };
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

  // Emit lanes in tag entry declaration order
  for (const entry of tagGroup.entries) {
    const entryKey = entry.value.toLowerCase();
    const tasks = buckets.get(entryKey) ?? [];
    // Sort tasks within lane by start date
    tasks.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    // Compute aggregate progress
    const progressValues = tasks
      .map(t => t.task.progress)
      .filter((p): p is number => p !== null);
    const aggregateProgress = progressValues.length > 0
      ? progressValues.reduce((a, b) => a + b, 0) / progressValues.length
      : null;

    const isCollapsed = collapsedLanes?.has(entry.value) ?? false;
    rows.push({
      type: 'lane-header',
      laneName: entry.value,
      laneColor: entry.color,
      aggregateProgress,
      tagKey,
      isCollapsed,
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
    const progressValues = unbucketed
      .map(t => t.task.progress)
      .filter((p): p is number => p !== null);
    const aggregateProgress = progressValues.length > 0
      ? progressValues.reduce((a, b) => a + b, 0) / progressValues.length
      : null;

    const noLaneName = `No ${tagGroup.name}`;
    const isCollapsed = collapsedLanes?.has(noLaneName) ?? false;
    rows.push({
      type: 'lane-header',
      laneName: noLaneName,
      laneColor: '#999999',
      aggregateProgress,
      tagKey,
      isCollapsed,
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
