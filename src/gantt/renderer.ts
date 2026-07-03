// ============================================================
// Gantt Chart Renderer
// ============================================================

import { tagAttrKey } from '../utils/tag-groups';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import { getSeriesColors } from '../palettes';
import { contrastText, mix, shapeFill } from '../palettes/color-utils';
import { normalizeName } from '../utils/name-normalize';
import { resolveTagColor, resolveActiveTagGroup } from '../utils/tag-groups';
import { ScaleContext } from '../utils/scaling';
import { computeTimeTicks, MONTH_ABBR } from '../utils/time-ticks';
import {
  measureText,
  truncateText,
  CHAR_WIDTH_RATIO,
} from '../utils/text-measure';
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
  LEGEND_GEAR_PILL_W,
  measureLegendText,
  truncateLegendText,
} from '../utils/legend-constants';
import { renderIntegratedLegend } from '../utils/legend-integration';
import {
  controlsGroupCapsuleWidth,
  getMaxLegendReservedHeight,
} from '../utils/legend-layout';
import type { LegendCallbacks } from '../utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type {
  ResolvedSchedule,
  ResolvedTask,
  ResolvedGroup,
  Weekday,
} from './types';
import type { TagGroup, TagEntry } from '../utils/tag-groups';

// ── Constants ───────────────────────────────────────────────

const BAR_H = 22;
const ROW_GAP = 6;
const GROUP_GAP = 14;
const MILESTONE_SIZE = 10;
const MIN_LEFT_MARGIN = 120;
const BOTTOM_MARGIN = 40;
const RIGHT_MARGIN = 20;
const LABEL_PAD = 8; // inner padding to decide if label fits inside bar
const LABEL_GAP = 5; // gap between bar edge and external label

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
  onFillColor?: string,
  fontSize = 10,
  labelPad = LABEL_PAD,
  labelGap = LABEL_GAP
): BarLabelPlacement | null {
  const textWidth = measureText(label, fontSize);
  const x2 = x1 + barWidth;

  if (textWidth < barWidth - labelPad) {
    return {
      x: x1 + 6,
      anchor: 'start',
      fill: onFillColor ?? textColor,
      text: label,
    };
  }

  if (x2 + labelGap + textWidth <= innerWidth) {
    return { x: x2 + labelGap, anchor: 'start', fill: textColor, text: label };
  }

  if (x1 - labelGap - textWidth >= 0) {
    return { x: x1 - labelGap, anchor: 'end', fill: textColor, text: label };
  }

  const availWidth = x1 - labelGap;
  // Roughly three average glyphs' worth of room before truncation is worthwhile.
  if (availWidth > fontSize * CHAR_WIDTH_RATIO * 3) {
    const truncated = truncateText(label, fontSize, availWidth);
    if (!truncated) return null;
    return {
      x: x1 - labelGap,
      anchor: 'end',
      fill: textColor,
      text: truncated,
    };
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
  isDark: boolean,
  cssPrefix: 'group' | 'lane',
  dataAttr?: { key: string; value: string },
  solid?: boolean,
  barH = BAR_H,
  bandRadius = BAND_RADIUS,
  bandAccentW = BAND_ACCENT_W
): void {
  const bandX = 5;
  const bandW = leftMargin - 7;
  const bandY = y - barH / 2;
  const clipId = `gantt-band-clip-${bandClipCounter++}`;

  svg
    .append('clipPath')
    .attr('id', clipId)
    .append('rect')
    .attr('x', bandX)
    .attr('y', bandY)
    .attr('width', bandW)
    .attr('height', barH)
    .attr('rx', bandRadius);

  const tint = svg
    .append('rect')
    .attr('class', `gantt-${cssPrefix}-band-bg`)
    .attr('x', bandX)
    .attr('y', bandY)
    .attr('width', bandW)
    .attr('height', barH)
    .attr('rx', bandRadius)
    .attr(
      'fill',
      shapeFill(palette, color, isDark, {
        ...(solid !== undefined && { solid }),
      })
    )
    .style('pointer-events', 'none');

  const accent = svg
    .append('rect')
    .attr('class', `gantt-${cssPrefix}-band-accent`)
    .attr('x', bandX)
    .attr('y', bandY)
    .attr('width', bandAccentW)
    .attr('height', barH)
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
  textColor: string
): void {
  const icon = isMilestone ? '◆' : '●';
  textEl.append('tspan').attr('fill', iconColor).text(icon);
  textEl
    .append('tspan')
    .attr('fill', textColor)
    .text(' ' + label);
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
  exportMode?: boolean;
  /**
   * Where the Critical Path / Dependencies controls are hosted. Default
   * `'inline'` draws the gear pill inside the SVG legend. `'app'` suppresses
   * the inline gear so the desktop app can surface the same toggles in its
   * unified ControlsStrip ("settings pull-down tab"); the toggle state is then
   * driven by `criticalPathActive`/`dependenciesActive` below (re-render on
   * change), matching every other ControlsStrip-hosted chart type.
   */
  controlsHost?: 'app' | 'inline';
  /** Initial Critical Path highlight state (used when `controlsHost` is `'app'`). */
  criticalPathActive?: boolean;
  /** Initial Dependencies-arrow visibility (used when `controlsHost` is `'app'`). */
  dependenciesActive?: boolean;
}

// ── Main Renderer ───────────────────────────────────────────

export function renderGantt(
  container: HTMLDivElement,
  resolved: ResolvedSchedule,
  palette: PaletteColors,
  isDark: boolean,
  options?: GanttInteractiveOptions,
  exportDims?: D3ExportDimensions
): void {
  // Clear previous content
  container.innerHTML = '';
  bandClipCounter = 0;

  if (resolved.tasks.length === 0) return;
  // Gantt INTENTIONALLY ignores `solid-fill` — the partial-tint vs full-saturation
  // split inside each bar IS the progress visualization (e.g. "Blockade 72%" =
  // 72% saturated + 28% lighter). Solid mode would destroy that signal. Hardcode
  // false so all `shapeFill()` calls in this renderer keep using the 25% tint.
  const solid = false;

  // ── Destructure options ─────────────────────────────────

  const onClickItem = options?.onClickItem;
  // Fall back to the groups declared collapsed in source (`[Group] collapsed:
  // true`) when no interactive set is supplied — so a bare render honors the
  // source marker. Interactive callers (the app) pass their own set, seeded
  // from source and expandable.
  const collapsedGroups =
    options?.collapsedGroups ??
    new Set(resolved.groups.filter((g) => g.collapsed).map((g) => g.name));
  const onToggleGroup = options?.onToggleGroup;
  const viewMode = options?.viewMode ?? false;
  const currentSwimlaneGroup = options?.currentSwimlaneGroup ?? null;
  const onSwimlaneChange = options?.onSwimlaneChange;
  const onActiveGroupChange = options?.onActiveGroupChange;
  const collapsedLanes = options?.collapsedLanes;
  const onToggleLane = options?.onToggleLane;
  const controlsHost = options?.controlsHost ?? 'inline';

  // ── Compute layout dimensions ───────────────────────────

  const seriesColors = getSeriesColors(palette);
  let currentActiveGroup: string | null = resolveActiveTagGroup(
    resolved.tagGroups,
    resolved.options.activeTag ?? undefined,
    options?.currentActiveGroup
  );
  // Seeded from options so app-hosted controls (controlsHost: 'app') render the
  // correct state on the very first draw; in inline mode these stay false until
  // the user clicks the gear (existing behavior).
  let criticalPathActive = options?.criticalPathActive ?? false;
  let dependenciesActive = options?.dependenciesActive ?? false;
  let controlsExpanded = false;

  // ── Build row list (structural vs tag mode) ─────────────

  const tagRows = currentSwimlaneGroup
    ? buildTagLaneRowList(resolved, currentSwimlaneGroup, collapsedLanes)
    : null;
  const rows = tagRows ?? buildRowList(resolved, collapsedGroups);
  const isTagMode = tagRows !== null;

  // Compute left margin based on longest visible label (include ● /◆  prefix
  // for tasks). Labels render at font 11; group labels carry a pixel indent.
  const LABEL_FONT = 11;
  const labelWidths = isTagMode
    ? [
        ...rows
          .filter((r): r is LaneHeaderRow => r.type === 'lane-header')
          .map((r) => measureText(r.laneName, LABEL_FONT)),
        ...rows
          .filter((r): r is TaskRow => r.type === 'task')
          .map((r) => measureText('● ' + r.task.task.label, LABEL_FONT)),
      ]
    : [
        ...resolved.tasks.map((t) =>
          measureText('● ' + t.task.label, LABEL_FONT)
        ),
        ...resolved.groups.map((g) => {
          const indentPx =
            g.depth <= 2 ? g.depth * 14 : 2 * 14 + (g.depth - 2) * 8;
          return indentPx + measureText(g.name, LABEL_FONT);
        }),
      ];
  // Floor on a 10-char label so very short schedules still get a usable gutter.
  const maxLabelWidth = Math.max(
    ...labelWidths,
    measureText('0000000000', LABEL_FONT)
  );
  const leftMargin = Math.max(MIN_LEFT_MARGIN, maxLabelWidth + 30);

  const totalRows = rows.length;

  // Pre-compute critical path / dependency flags (needed for legend height reservation)
  const hasCriticalPath =
    resolved.options.criticalPath &&
    resolved.tasks.some((t) => t.isCriticalPath);
  const hasDependencies =
    resolved.options.dependencies &&
    resolved.tasks.some((t) => t.task.dependencies.length > 0);

  // Resolve today-marker date early so we can decide whether to reserve a row.
  // Each label-bearing element gets its own horizontal row, reserved only when
  // present in the DGMO. Stack (top → bottom): title, legend, eras, markers,
  // today, dates. Within-row collisions (long labels on adjacent items) are a
  // separate concern.
  let resolvedTodayDate: Date | null = null;
  if (resolved.options.todayMarker !== 'off') {
    const d =
      resolved.options.todayMarker === 'on'
        ? new Date()
        : new Date(resolved.options.todayMarker + 'T00:00:00');
    if (d >= resolved.startDate && d <= resolved.endDate) {
      resolvedTodayDate = d;
    }
  }

  // Vertical layout — matches timeline pattern (d3.ts:3649-3655)
  const title = resolved.options.title;
  const showTitle = !!title && !resolved.options.noTitle;
  const titleHeight = showTitle ? 50 : 20;
  const containerWidth = exportDims?.width ?? (container.clientWidth || 800);
  const hasTagLegend =
    resolved.tagGroups.length > 0 || hasCriticalPath || hasDependencies;
  const tagLegendReserve = hasTagLegend
    ? getMaxLegendReservedHeight(
        {
          groups: resolved.tagGroups.map((tg) => ({
            name: tg.name,
            entries: tg.entries,
          })),
          position: { placement: 'top-center', titleRelation: 'below-title' },
          mode: 'preview',
          capsulePillAddonWidth: LEGEND_ICON_W,
        },
        containerWidth
      ) + 8
    : 0;
  const topDateLabelReserve = 22; // tick (6) + gap (4) + label height (~12)
  const HEADER_ROW_H = 18; // height per reserved label row
  const eraReserve = resolved.eras.length > 0 ? HEADER_ROW_H : 0;
  const markerReserve = resolved.markers.length > 0 ? HEADER_ROW_H : 0;
  const todayReserve = resolvedTodayDate ? HEADER_ROW_H : 0;
  const sprintLabelReserve = resolved.sprints.length > 0 ? 16 : 0; // sprint hover label above date labels
  const CONTENT_TOP_PAD = 16; // breathing room between scale labels and first row

  const idealWidth = leftMargin + totalRows * 20 + RIGHT_MARGIN + 200;
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(containerWidth, idealWidth);

  const sBarH = ctx.structural(BAR_H);
  const sRowGap = ctx.structural(ROW_GAP);
  const sGroupGap = ctx.structural(GROUP_GAP);
  const sMilestoneSize = ctx.structural(MILESTONE_SIZE);
  const sBottomMargin = ctx.aesthetic(BOTTOM_MARGIN);
  const sRightMargin = ctx.aesthetic(RIGHT_MARGIN);
  const sLabelPad = ctx.structural(LABEL_PAD);
  const sLabelGap = ctx.structural(LABEL_GAP);
  const sBandAccentW = ctx.structural(BAND_ACCENT_W);
  const sBandRadius = ctx.structural(BAND_RADIUS);
  const sTitleFontSize = ctx.text(TITLE_FONT_SIZE);
  const sTitleY = ctx.aesthetic(TITLE_Y);
  const sHeaderRowH = ctx.structural(HEADER_ROW_H);
  const sContentTopPad = ctx.aesthetic(CONTENT_TOP_PAD);
  const sTopDateLabelReserve = ctx.structural(topDateLabelReserve);
  const sSprintLabelReserve = ctx.structural(sprintLabelReserve);
  const sTitleHeight = ctx.aesthetic(titleHeight);
  const sTagLegendReserve = ctx.structural(tagLegendReserve);
  const sEraReserve = ctx.structural(eraReserve);
  const sMarkerReserve = ctx.structural(markerReserve);
  const sTodayReserve = ctx.structural(todayReserve);
  const sFont10 = ctx.text(10);
  const sFont11 = ctx.text(11);

  const sMarginTop =
    sTitleHeight +
    sTagLegendReserve +
    sEraReserve +
    sMarkerReserve +
    sTodayReserve +
    sTopDateLabelReserve +
    sSprintLabelReserve;

  const sTodayLabelY = sTodayReserve
    ? -(sTopDateLabelReserve + sHeaderRowH / 2)
    : 0;
  const sMarkerLabelY = sMarkerReserve
    ? -(sTopDateLabelReserve + sTodayReserve + sHeaderRowH / 2)
    : 0;
  const sEraLabelY = sEraReserve
    ? -(sTopDateLabelReserve + sTodayReserve + sMarkerReserve + sHeaderRowH / 2)
    : 0;

  const sContentH = isTagMode
    ? totalRows * (sBarH + sRowGap)
    : totalRows * (sBarH + sRowGap) + sGroupGap * resolved.groups.length;
  const sInnerHeight = sContentTopPad + sContentH;
  const sOuterHeight = sMarginTop + sInnerHeight + sBottomMargin;

  // Extra right margin when sprints present so hover date labels aren't clipped
  const sprintRightPad = resolved.sprints.length > 0 ? 50 : 0;
  const innerWidth =
    containerWidth - leftMargin - sRightMargin - sprintRightPad;

  // ── Create SVG ──────────────────────────────────────────

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('viewBox', `0 0 ${containerWidth} ${sOuterHeight}`)
    .attr('width', exportDims ? containerWidth : '100%')
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('font-family', FONT_FAMILY)
    .style('overflow', 'visible');

  const g = svg
    .append('g')
    .attr('transform', `translate(${leftMargin}, ${sMarginTop})`);

  if (showTitle) {
    svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', containerWidth / 2)
      .attr('y', sTitleY)
      .attr('text-anchor', 'middle')
      .attr('font-size', sTitleFontSize)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .text(title);
  }

  // ── Tag legend (interactive) ────────────────────────────

  function drawLegend() {
    svg.selectAll('.gantt-tag-legend-container').remove();
    if (resolved.tagGroups.length > 0 || hasCriticalPath || hasDependencies) {
      const legendY = sTitleHeight;
      renderTagLegend(
        svg,
        g,
        resolved.tagGroups,
        currentActiveGroup,
        leftMargin,
        innerWidth,
        legendY,
        palette,
        isDark,
        hasCriticalPath,
        criticalPathActive,
        resolved.options.optionLineNumbers,
        (groupName) => {
          // Toggle active group
          currentActiveGroup =
            currentActiveGroup?.toLowerCase() === groupName.toLowerCase()
              ? null
              : groupName;
          if (onActiveGroupChange) onActiveGroupChange(currentActiveGroup);
          drawLegend();
          recolorBars();
        },
        () => {
          controlsExpanded = !controlsExpanded;
          drawLegend();
        },
        currentSwimlaneGroup,
        onSwimlaneChange,
        viewMode,
        resolved.tasks,
        controlsExpanded,
        hasDependencies,
        dependenciesActive,
        (toggleId, active) => {
          if (toggleId === 'critical-path') {
            criticalPathActive = active;
            if (active) {
              applyCriticalPathHighlight(svg, g);
            } else {
              svg.attr('data-critical-path-active', null);
              resetHighlightAll(svg, g);
            }
          } else if (toggleId === 'dependencies') {
            dependenciesActive = active;
            // Show/hide dependency arrows
            g.selectAll<SVGElement, unknown>(
              '.gantt-dep-arrow, .gantt-dep-arrowhead, .gantt-dep-label'
            ).attr('display', active ? null : 'none');
          }
          drawLegend();
        },
        options?.exportMode ?? false,
        controlsHost
      );
    }
  }

  function restoreHighlight() {
    if (criticalPathActive) {
      applyCriticalPathHighlight(svg, g);
    } else {
      svg.attr('data-critical-path-active', null);
      resetHighlight(g, svg);
    }
  }

  function recolorBars() {
    g.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
      const el = d3Selection.select(this);
      const taskId = el.attr('data-task-id');
      const rt = resolved.tasks.find((t) => t.task.id === taskId);
      if (!rt) return;
      const color = resolveTaskColor(
        rt,
        currentActiveGroup,
        resolved,
        seriesColors,
        palette
      );
      const fillColor = shapeFill(palette, color, isDark, { solid });
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
  renderTimeScaleHorizontal(g, xScale, innerWidth, sInnerHeight, palette.text);

  renderWeekendBands(g, resolved, xScale, sInnerHeight, palette, isDark);
  renderHolidayBands(
    g,
    svg,
    resolved,
    xScale,
    sInnerHeight,
    palette,
    isDark,
    sMarginTop - 4,
    leftMargin,
    onClickItem
  );
  renderErasAndMarkers(
    g,
    svg,
    resolved,
    xScale,
    sInnerHeight,
    palette,
    sEraLabelY,
    sMarkerLabelY
  );
  renderSprintBands(g, svg, resolved, xScale, sInnerHeight, palette);

  // ── Today marker (line rendered before rows so it paints behind task bars) ──

  const todayDate: Date | null = resolvedTodayDate;
  let todayX = -1;
  const todayColor = palette.accent || '#e74c3c';
  const todayMarkerLineNum = resolved.options.optionLineNumbers['today-marker'];
  if (todayDate) {
    todayX = xScale(dateToFractionalYear(todayDate));
    if (todayX >= 0 && todayX <= innerWidth) {
      const todayLine = g
        .append('line')
        .attr('class', 'gantt-today')
        .attr('x1', todayX)
        .attr('y1', 0)
        .attr('x2', todayX)
        .attr('y2', sInnerHeight + 10)
        .attr('stroke', todayColor)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '6 4')
        .attr('opacity', 0.7)
        .attr('pointer-events', 'none');
      if (todayMarkerLineNum)
        todayLine.attr('data-line-number', String(todayMarkerLineNum));

      const todayLabel = g
        .append('text')
        .attr('class', 'gantt-today')
        .attr('x', todayX)
        .attr('y', sTodayLabelY)
        .attr('text-anchor', 'middle')
        .attr('font-size', `${sFont10}px`)
        .attr('fill', todayColor)
        .attr('opacity', 0.7)
        .attr('pointer-events', 'none')
        .text('Today');
      if (todayMarkerLineNum)
        todayLabel.attr('data-line-number', String(todayMarkerLineNum));
    }
  }

  // ── Render rows ─────────────────────────────────────────

  // Track task positions for dependency arrows
  const taskPositions = new Map<
    string,
    { x1: number; x2: number; y: number }
  >();
  // Track collapsed group bar positions so hidden-task arrows redirect there
  const groupPositions = new Map<
    string,
    { x1: number; x2: number; y: number }
  >();
  // Track lane header positions for collapsed lane arrow redirection (tag mode)
  const lanePositions = new Map<
    string,
    { x1: number; x2: number; y: number }
  >();
  // Map task ID → lane name for collapsed lane lookup (tag mode)
  const taskLaneMap = new Map<string, string>();
  if (isTagMode && currentSwimlaneGroup) {
    const tagGroup = resolved.tagGroups.find(
      (tg) => tg.name.toLowerCase() === currentSwimlaneGroup.toLowerCase()
    );
    if (tagGroup) {
      const tagKey = tagAttrKey(tagGroup.name);
      for (const rt of resolved.tasks) {
        let value = rt.effectiveMetadata[tagKey];
        if (!value && tagGroup.defaultValue) value = tagGroup.defaultValue;
        if (value) {
          const entry = tagGroup.entries.find(
            (e) => e.value.toLowerCase() === value!.toLowerCase()
          );
          if (entry) taskLaneMap.set(rt.task.id, entry.value);
        }
      }
    }
  }
  let yOffset = sContentTopPad;

  for (const row of rows) {
    if (row.type === 'lane-header') {
      const laneColor =
        row.laneColor === '#999999' ? palette.textMuted : row.laneColor;
      const toggleIcon = row.isCollapsed ? '▶' : '▼';
      const labelX = 10;

      let lx1 = 0;
      let lx2 = innerWidth; // eslint-disable-line no-useless-assignment
      let laneBarWidth = innerWidth;
      if (row.laneStartDate && row.laneEndDate) {
        lx1 = xScale(dateToFractionalYear(row.laneStartDate));
        lx2 = xScale(dateToFractionalYear(row.laneEndDate));
        laneBarWidth = Math.max(lx2 - lx1, 2);
      }

      lanePositions.set(row.laneName, {
        x1: lx1,
        x2: lx1 + laneBarWidth,
        y: yOffset + sBarH / 2,
      });

      renderLabelBand(
        svg,
        sMarginTop + yOffset + sBarH / 2,
        leftMargin,
        laneColor,
        palette,
        isDark,
        'lane',
        { key: 'data-lane', value: row.laneName },
        solid,
        sBarH,
        sBandRadius,
        sBandAccentW
      );
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
            showGanttDateIndicators(
              g,
              xScale,
              row.laneStartDate,
              row.laneEndDate,
              sInnerHeight,
              laneColor
            );
          }
        })
        .on('mouseleave', () => {
          restoreHighlight();
          hideGanttDateIndicators(g);
        });

      labelG
        .append('text')
        .attr('x', labelX)
        .attr('y', sMarginTop + yOffset + sBarH / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('font-size', `${sFont11}px`)
        .attr('font-weight', 'bold')
        .attr('fill', laneColor)
        .text(
          toggleIcon +
            ' ' +
            row.laneName +
            (row.aggregateProgress !== null
              ? ` ${Math.round(row.aggregateProgress)}%`
              : '')
        );

      if (laneBarWidth > 0) {
        const barFill = shapeFill(palette, laneColor, isDark, { solid });
        const laneBandG = g
          .append('g')
          .attr('class', 'gantt-lane-band-group')
          .attr('data-lane', row.laneName)
          .on('mouseenter', () => {
            highlightLane(g, svg, row.tagKey, row.laneName);
            if (row.laneStartDate && row.laneEndDate) {
              showGanttDateIndicators(
                g,
                xScale,
                row.laneStartDate,
                row.laneEndDate,
                sInnerHeight,
                laneColor
              );
            }
          })
          .on('mouseleave', () => {
            resetHighlight(g, svg);
            hideGanttDateIndicators(g);
          });

        laneBandG
          .append('rect')
          .attr('class', 'gantt-lane-band')
          .attr('x', lx1)
          .attr('y', yOffset)
          .attr('width', laneBarWidth)
          .attr('height', sBarH)
          .attr('rx', 4)
          .attr('fill', barFill)
          .attr('stroke', laneColor)
          .attr('stroke-width', 2);

        if (row.aggregateProgress !== null && row.aggregateProgress > 0) {
          laneBandG
            .append('rect')
            .attr('class', 'gantt-lane-progress')
            .attr('x', lx1)
            .attr('y', yOffset)
            .attr(
              'width',
              laneBarWidth * Math.min(row.aggregateProgress / 100, 1)
            )
            .attr('height', sBarH)
            .attr('fill', laneColor)
            .attr('opacity', 0.5)
            .attr('pointer-events', 'none');
        }
      }

      yOffset += sBarH + sRowGap;
    } else if (row.type === 'group') {
      const group = row.group;
      const isCollapsed = collapsedGroups?.has(group.name) ?? false;
      const toggleIcon = isCollapsed ? '▶' : '▼';

      // Group label with toggle — resolve tag color from group metadata
      const tagColor = resolveTagColor(
        group.metadata,
        resolved.tagGroups,
        currentActiveGroup,
        true
      );
      const groupColor =
        tagColor && tagColor !== '#999999'
          ? tagColor
          : group.color || palette.textMuted;
      renderLabelBand(
        svg,
        sMarginTop + yOffset + sBarH / 2,
        leftMargin,
        groupColor,
        palette,
        isDark,
        'group',
        { key: 'data-group', value: group.name },
        solid,
        sBarH,
        sBandRadius,
        sBandAccentW
      );
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
          showGanttDateIndicators(
            g,
            xScale,
            group.startDate,
            group.endDate,
            sInnerHeight,
            groupColor
          );
        })
        .on('mouseleave', () => {
          resetHighlight(g, svg);
          hideGanttDateIndicators(g);
        });

      const groupIndent =
        group.depth <= 2 ? group.depth * 14 : 2 * 14 + (group.depth - 2) * 8;
      const labelX = 10 + groupIndent;
      labelG
        .append('text')
        .attr('x', labelX)
        .attr('y', sMarginTop + yOffset + sBarH / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('font-size', `${sFont11}px`)
        .attr('font-weight', 'bold')
        .attr('fill', palette.text)
        .text(
          toggleIcon +
            ' ' +
            group.name +
            (group.progress !== null ? ` ${Math.round(group.progress)}%` : '')
        );

      // Group bar
      const gStart = dateToFractionalYear(group.startDate);
      const gEnd = dateToFractionalYear(group.endDate);
      const gx1 = xScale(gStart);
      const gx2 = xScale(gEnd);

      if (gx2 > gx1) {
        if (isCollapsed) {
          // Summary bar (full height, shows aggregate progress)
          const barWidth = Math.max(gx2 - gx1, 2);
          const summaryG = g
            .append('g')
            .attr('class', 'gantt-group-summary')
            .attr('data-group', group.name)
            .attr('data-line-number', String(group.lineNumber))
            .on('mouseenter', () => {
              highlightGroup(g, svg, group.name);
              showGanttDateIndicators(
                g,
                xScale,
                group.startDate,
                group.endDate,
                sInnerHeight,
                groupColor
              );
            })
            .on('mouseleave', () => {
              resetHighlight(g, svg);
              hideGanttDateIndicators(g);
            });

          summaryG
            .append('rect')
            .attr('x', gx1)
            .attr('y', yOffset)
            .attr('width', barWidth)
            .attr('height', sBarH)
            .attr('rx', 4)
            .attr('fill', shapeFill(palette, groupColor, isDark, { solid }))
            .attr('stroke', groupColor)
            .attr('stroke-width', 2);

          if (group.progress !== null && group.progress > 0) {
            summaryG
              .append('rect')
              .attr('x', gx1)
              .attr('y', yOffset)
              .attr('width', barWidth * Math.min(group.progress / 100, 1))
              .attr('height', sBarH)
              .attr('fill', groupColor)
              .attr('opacity', 0.5);
          }

          const summaryLabel =
            group.name +
            (group.progress !== null ? ` ${Math.round(group.progress)}%` : '');
          const summaryPlacement = computeBarLabel(
            summaryLabel,
            gx1,
            barWidth,
            innerWidth,
            palette.text,
            contrastText(
              shapeFill(palette, groupColor, isDark, { solid }),
              palette.textOnFillLight,
              palette.textOnFillDark
            ),
            sFont10,
            sLabelPad,
            sLabelGap
          );
          if (summaryPlacement) {
            summaryG
              .append('text')
              .attr('x', summaryPlacement.x)
              .attr('y', yOffset + sBarH / 2)
              .attr('dy', '0.35em')
              .attr('font-size', `${sFont10}px`)
              .attr('font-weight', 'bold')
              .attr('text-anchor', summaryPlacement.anchor)
              .attr('fill', summaryPlacement.fill)
              .attr('pointer-events', 'none')
              .text(summaryPlacement.text);
          }

          groupPositions.set(group.name, {
            x1: gx1,
            x2: gx1 + barWidth,
            y: yOffset + sBarH / 2,
          });
        } else {
          const groupBarWidth = Math.max(gx2 - gx1, 2);
          const bandFill = shapeFill(palette, groupColor, isDark, { solid });
          const groupBarG = g
            .append('g')
            .attr('class', 'gantt-group-bar')
            .attr('data-group', group.name)
            .attr('data-line-number', String(group.lineNumber))
            .on('mouseenter', () => {
              highlightGroup(g, svg, group.name);
              showGanttDateIndicators(
                g,
                xScale,
                group.startDate,
                group.endDate,
                sInnerHeight,
                groupColor
              );
            })
            .on('mouseleave', () => {
              resetHighlight(g, svg);
              hideGanttDateIndicators(g);
            });

          groupBarG
            .append('rect')
            .attr('x', gx1)
            .attr('y', yOffset)
            .attr('width', groupBarWidth)
            .attr('height', sBarH)
            .attr('rx', 4)
            .attr('fill', bandFill)
            .attr('stroke', groupColor)
            .attr('stroke-width', 2);

          if (group.progress !== null && group.progress > 0) {
            groupBarG
              .append('rect')
              .attr('class', 'gantt-group-progress')
              .attr('x', gx1)
              .attr('y', yOffset)
              .attr('width', groupBarWidth * Math.min(group.progress / 100, 1))
              .attr('height', sBarH)
              .attr('fill', groupColor)
              .attr('opacity', 0.5);
          }

          const expandedLabel =
            group.name +
            (group.progress !== null ? ` ${Math.round(group.progress)}%` : '');
          const expandedPlacement = computeBarLabel(
            expandedLabel,
            gx1,
            groupBarWidth,
            innerWidth,
            palette.text,
            contrastText(
              shapeFill(palette, groupColor, isDark, { solid }),
              palette.textOnFillLight,
              palette.textOnFillDark
            ),
            sFont10,
            sLabelPad,
            sLabelGap
          );
          if (expandedPlacement) {
            groupBarG
              .append('text')
              .attr('x', expandedPlacement.x)
              .attr('y', yOffset + sBarH / 2)
              .attr('dy', '0.35em')
              .attr('font-size', `${sFont10}px`)
              .attr('font-weight', 'bold')
              .attr('text-anchor', expandedPlacement.anchor)
              .attr('fill', expandedPlacement.fill)
              .attr('pointer-events', 'none')
              .text(expandedPlacement.text);
          }
        }
      }

      yOffset += sBarH + sRowGap;
    } else if (row.type === 'task') {
      const rt = row.task;
      const task = rt.task;

      const barColor = resolveTaskColor(
        rt,
        currentActiveGroup,
        resolved,
        seriesColors,
        palette
      );

      const depth = rt.groupPath.length;
      const indent = depth <= 2 ? depth * 14 : 2 * 14 + (depth - 2) * 8;
      const taskLabelX = isTagMode ? 20 : 6 + indent;
      const topGroup = rt.groupPath.length > 0 ? rt.groupPath[0]! : null;
      const taskLabel = svg
        .append('text')
        .attr('class', 'gantt-task-label')
        .attr('x', taskLabelX)
        .attr('y', sMarginTop + yOffset + sBarH / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('font-size', `${sFont11}px`)
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

      appendTaskIcon(
        taskLabel,
        task.label,
        rt.isMilestone,
        barColor,
        palette.text
      );

      // Tag attributes on label for legend hover matching
      for (const [key, value] of Object.entries(rt.effectiveMetadata)) {
        taskLabel.attr(`data-tag-${key}`, value.toLowerCase());
      }
      if (rt.isCriticalPath) {
        taskLabel.attr('data-critical-path', 'true');
      }

      if (rt.isMilestone) {
        const mx = xScale(dateToFractionalYear(rt.startDate));
        const my = yOffset + sBarH / 2;
        g.append('polygon')
          .attr('class', 'gantt-milestone')
          .attr('points', diamondPoints(mx, my, sMilestoneSize))
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
            showGanttDateIndicators(
              g,
              xScale,
              rt.startDate,
              null,
              sInnerHeight,
              barColor
            );
            g.append('text')
              .attr('class', 'gantt-milestone-hover-label')
              .attr('x', mx - sMilestoneSize - 4)
              .attr('y', my)
              .attr('dy', '0.35em')
              .attr('text-anchor', 'end')
              .attr('font-size', `${sFont10}px`)
              .attr('fill', barColor)
              .attr('font-weight', '600')
              .text(task.label);
          })
          .on('mouseleave', () => {
            restoreHighlight();
            hideGanttDateIndicators(g);
            g.selectAll('.gantt-milestone-hover-label').remove();
          });

        taskPositions.set(task.id, { x1: mx, x2: mx, y: my });
      } else {
        // Render bar
        const tStart = dateToFractionalYear(rt.startDate);
        const tEnd = dateToFractionalYear(rt.endDate);
        const x1 = xScale(tStart);
        const x2 = xScale(tEnd);
        const barWidth = Math.max(x2 - x1, 2);

        const fillColor = shapeFill(palette, barColor, isDark, { solid });

        const taskG = g
          .append('g')
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
            showGanttDateIndicators(
              g,
              xScale,
              rt.startDate,
              rt.endDate,
              sInnerHeight,
              barColor
            );
          })
          .on('mouseleave', () => {
            if (resolved.options.dependencies) {
              restoreHighlight();
            }
            resetTaskLabels(svg);
            hideGanttDateIndicators(g);
          });

        // Set tag attributes
        for (const [key, value] of Object.entries(rt.effectiveMetadata)) {
          taskG.attr(`data-tag-${key}`, value.toLowerCase());
        }

        // Uncertainty gradient — fade out the trailing edge unless progress > 80%
        const showUncertainFade =
          rt.isUncertain && (task.progress === null || task.progress <= 80);
        let barFill: string = fillColor;
        let barStroke: string = barColor;
        if (showUncertainFade) {
          const defs = svg.select('defs').empty()
            ? svg.append('defs')
            : svg.select<SVGDefsElement>('defs');

          const fillGradId = `gantt-uncertain-fill-${task.id}`;
          const fillGrad = defs
            .append('linearGradient')
            .attr('id', fillGradId)
            .attr('x1', '0')
            .attr('x2', '1')
            .attr('y1', '0')
            .attr('y2', '0');
          fillGrad
            .append('stop')
            .attr('offset', '0%')
            .attr('stop-color', fillColor)
            .attr('stop-opacity', 1);
          fillGrad
            .append('stop')
            .attr('offset', '50%')
            .attr('stop-color', fillColor)
            .attr('stop-opacity', 1);
          fillGrad
            .append('stop')
            .attr('offset', '100%')
            .attr('stop-color', fillColor)
            .attr('stop-opacity', 0);

          const strokeGradId = `gantt-uncertain-stroke-${task.id}`;
          const strokeGrad = defs
            .append('linearGradient')
            .attr('id', strokeGradId)
            .attr('x1', '0')
            .attr('x2', '1')
            .attr('y1', '0')
            .attr('y2', '0');
          strokeGrad
            .append('stop')
            .attr('offset', '0%')
            .attr('stop-color', barColor)
            .attr('stop-opacity', 1);
          strokeGrad
            .append('stop')
            .attr('offset', '50%')
            .attr('stop-color', barColor)
            .attr('stop-opacity', 1);
          strokeGrad
            .append('stop')
            .attr('offset', '100%')
            .attr('stop-color', barColor)
            .attr('stop-opacity', 0);

          barFill = `url(#${fillGradId})`;
          barStroke = `url(#${strokeGradId})`;
        }

        taskG
          .append('rect')
          .attr('x', x1)
          .attr('y', yOffset)
          .attr('width', barWidth)
          .attr('height', sBarH)
          .attr('rx', 4)
          .attr('fill', barFill)
          .attr('stroke', barStroke)
          .attr('stroke-width', 2);

        if (task.progress !== null && task.progress > 0) {
          const progressWidth = barWidth * Math.min(task.progress / 100, 1);
          let progressFill: string = barColor;
          if (showUncertainFade) {
            const ratio = barWidth / progressWidth;
            const fadeStart = Math.min(50 * ratio, 100);
            const defs = svg.select<SVGDefsElement>('defs');
            const progGradId = `gantt-uncertain-progress-${task.id}`;
            const progGrad = defs
              .append('linearGradient')
              .attr('id', progGradId)
              .attr('x1', '0')
              .attr('x2', '1')
              .attr('y1', '0')
              .attr('y2', '0');
            progGrad
              .append('stop')
              .attr('offset', '0%')
              .attr('stop-color', barColor)
              .attr('stop-opacity', 1);
            progGrad
              .append('stop')
              .attr('offset', `${fadeStart}%`)
              .attr('stop-color', barColor)
              .attr('stop-opacity', 1);
            progGrad
              .append('stop')
              .attr('offset', '100%')
              .attr('stop-color', barColor)
              .attr('stop-opacity', 0);
            progressFill = `url(#${progGradId})`;
          }
          taskG
            .append('rect')
            .attr('class', 'gantt-progress')
            .attr('x', x1)
            .attr('y', yOffset)
            .attr('width', progressWidth)
            .attr('height', sBarH)
            .attr('fill', progressFill)
            .attr('opacity', 0.5);
        }

        if (rt.isCriticalPath) {
          taskG.attr('data-critical-path', 'true');
        }

        const labelPlacement = computeBarLabel(
          task.label,
          x1,
          barWidth,
          innerWidth,
          palette.text,
          contrastText(
            shapeFill(palette, barColor, isDark, { solid }),
            palette.textOnFillLight,
            palette.textOnFillDark
          ),
          sFont10,
          sLabelPad,
          sLabelGap
        );
        if (labelPlacement) {
          taskG
            .append('text')
            .attr('x', labelPlacement.x)
            .attr('y', yOffset + sBarH / 2)
            .attr('dy', '0.35em')
            .attr('font-size', `${sFont10}px`)
            .attr('text-anchor', labelPlacement.anchor)
            .attr('fill', labelPlacement.fill)
            .attr('pointer-events', 'none')
            .text(labelPlacement.text);
        }

        taskPositions.set(task.id, {
          x1,
          x2: x1 + barWidth,
          y: yOffset + sBarH / 2,
        });
      }

      yOffset += sBarH + sRowGap;
    }
  }

  if (todayDate && todayX >= 0 && todayX <= innerWidth) {
    const todayHoverG = g
      .append('g')
      .attr('class', 'gantt-today-hover')
      .style('cursor', 'pointer');

    todayHoverG
      .append('rect')
      .attr('x', todayX - 10)
      .attr('y', -6)
      .attr('width', 20)
      .attr('height', sInnerHeight + 16)
      .attr('fill', 'transparent')
      .attr('pointer-events', 'all');

    const todayDateObj = todayDate;
    todayHoverG
      .on('mouseenter', () => {
        // Fade everything
        g.selectAll<SVGGElement, unknown>('.gantt-task').attr(
          'opacity',
          FADE_OPACITY
        );
        g.selectAll<SVGElement, unknown>('.gantt-milestone').attr(
          'opacity',
          FADE_OPACITY
        );
        g.selectAll<SVGElement, unknown>(
          '.gantt-group-bar, .gantt-group-summary'
        ).attr('opacity', FADE_OPACITY);
        svg
          .selectAll<SVGGElement, unknown>('.gantt-group-label')
          .attr('opacity', FADE_OPACITY);
        svg
          .selectAll<SVGTextElement, unknown>('.gantt-task-label')
          .attr('opacity', FADE_OPACITY);
        svg
          .selectAll<SVGGElement, unknown>('.gantt-lane-header')
          .attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>(
          '.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group'
        ).attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>(
          '.gantt-dep-arrow, .gantt-dep-arrowhead'
        ).attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-era-group').attr(
          'opacity',
          FADE_OPACITY
        );
        g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr(
          'opacity',
          FADE_OPACITY
        );
        showGanttDateIndicators(
          g,
          xScale,
          todayDateObj,
          null,
          sInnerHeight,
          todayColor
        );
      })
      .on('mouseleave', () => {
        resetHighlight(g, svg);
        hideGanttDateIndicators(g);
      });
  }

  // ── Dependency arrows ───────────────────────────────────

  if (resolved.options.dependencies) {
    renderDependencyArrows(
      g,
      resolved,
      taskPositions,
      groupPositions,
      collapsedGroups,
      palette,
      isDark,
      isTagMode,
      lanePositions,
      collapsedLanes,
      taskLaneMap
    );
    if (!dependenciesActive) {
      g.selectAll<SVGElement, unknown>(
        '.gantt-dep-arrow, .gantt-dep-arrowhead, .gantt-dep-label'
      ).attr('display', 'none');
    }
  }
}

// ── Weekend Band Rendering ──────────────────────────────────

const JS_DAY_TO_WEEKDAY: Weekday[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
];

function renderWeekendBands(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  resolved: ResolvedSchedule,
  xScale: d3Scale.ScaleLinear<number, number>,
  innerHeight: number,
  palette: PaletteColors,
  isDark: boolean
): void {
  const workweek = new Set(resolved.holidays.workweek);
  const start = new Date(resolved.startDate);
  start.setDate(start.getDate() - 1); // start one day before
  const end = new Date(resolved.endDate);
  end.setDate(end.getDate() + 1); // end one day after

  const current = new Date(start);
  let bandStart: Date | null = null;

  while (current <= end) {
    // getDay() returns 0-6; JS_DAY_TO_WEEKDAY has 7 entries.
    const dayName = JS_DAY_TO_WEEKDAY[current.getDay()]!;
    const isWeekend = !workweek.has(dayName);

    if (isWeekend && !bandStart) {
      bandStart = new Date(current);
    } else if (!isWeekend && bandStart) {
      // Draw band from bandStart to current
      drawBand(
        g,
        xScale,
        bandStart,
        current,
        innerHeight,
        palette,
        isDark,
        'gantt-weekend-band',
        0.04
      );
      bandStart = null;
    }
    current.setDate(current.getDate() + 1);
  }
  // Close any trailing band
  if (bandStart) {
    drawBand(
      g,
      xScale,
      bandStart,
      current,
      innerHeight,
      palette,
      isDark,
      'gantt-weekend-band',
      0.04
    );
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
  onClickItem?: (lineNumber: number) => void
): void {
  for (const h of resolved.holidays.dates) {
    const start = new Date(h.date + 'T00:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    drawHolidayBand(
      g,
      svg,
      xScale,
      start,
      end,
      innerHeight,
      palette,
      isDark,
      h.label,
      h.lineNumber,
      headerY,
      chartLeftMargin,
      onClickItem
    );
  }

  for (const r of resolved.holidays.ranges) {
    const start = new Date(r.startDate + 'T00:00:00');
    const end = new Date(r.endDate + 'T00:00:00');
    end.setDate(end.getDate() + 1);
    drawHolidayBand(
      g,
      svg,
      xScale,
      start,
      end,
      innerHeight,
      palette,
      isDark,
      r.label,
      r.lineNumber,
      headerY,
      chartLeftMargin,
      onClickItem
    );
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
  opacity: number
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
  onClickItem?: (lineNumber: number) => void
): void {
  const x1 = xScale(dateToFractionalYear(start));
  const x2 = xScale(dateToFractionalYear(end));
  if (x2 <= x1) return;

  const bandW = Math.max(x2 - x1, 4);
  const baseOpacity = 0.08;
  const hoverOpacity = 0.18;

  const bandG = g
    .append('g')
    .attr('class', 'gantt-holiday-band')
    .attr('data-line-number', String(lineNumber))
    .style('cursor', onClickItem ? 'pointer' : 'default');

  // Band rect
  const bandRect = bandG
    .append('rect')
    .attr('x', x1)
    .attr('y', 0)
    .attr('width', bandW)
    .attr('height', height)
    .attr('fill', palette.text)
    .attr('opacity', baseOpacity);

  // Hover label in SVG-space (date header row) — hidden by default
  // Background rect to mask date labels underneath
  const labelX = chartLeftMargin + x1 + bandW / 2;
  const textLen = measureText(label, 10) + 8;
  const labelBg = svg
    .append('rect')
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

  const labelText = svg
    .append('text')
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
  groupPositions: Map<string, { x1: number; x2: number; y: number }>
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
  lanePositions: Map<string, { x1: number; x2: number; y: number }>
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
  taskLaneMap: Map<string, string>
): void {
  // Deduplicate arrows that collapse to the same source→target position
  const drawnArrows = new Set<string>();

  // Build arrow list from task dependencies
  for (const rt of resolved.tasks) {
    const sourcePos =
      taskPositions.get(rt.task.id) ??
      (isTagMode
        ? findCollapsedLanePos(rt, collapsedLanes, taskLaneMap, lanePositions)
        : findCollapsedGroupPos(rt, collapsedGroups, groupPositions));
    if (!sourcePos) continue;

    for (const dep of rt.task.dependencies) {
      // Find target task — forgiving normalization per universal name handling
      const depKey = normalizeName(dep.targetName);
      const targetTask = resolved.tasks.find(
        (t) =>
          normalizeName(t.task.label) === depKey ||
          normalizeName(`${t.groupPath.join('.')}.${t.task.label}`).endsWith(
            depKey
          )
      );
      if (!targetTask) continue;

      const targetPos =
        taskPositions.get(targetTask.task.id) ??
        (isTagMode
          ? findCollapsedLanePos(
              targetTask,
              collapsedLanes,
              taskLaneMap,
              lanePositions
            )
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

      // Label at midpoint of the dependency path
      if (dep.label) {
        const midX = (sx + tx) / 2;
        const midY = (sy + ty) / 2;
        // Background rect for readability
        const labelEl = g
          .append('text')
          .attr('class', 'gantt-dep-label')
          .attr('data-dep-from', rt.task.id)
          .attr('data-dep-to', targetTask.task.id)
          .attr('x', midX)
          .attr('y', midY - 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', 10)
          .attr('font-family', FONT_FAMILY)
          .attr('fill', palette.text)
          .attr('opacity', 0.7)
          .text(dep.label);
        // Insert a background rect behind the text for contrast
        const bbox = (labelEl.node() as SVGTextElement)?.getBBox?.();
        if (bbox && bbox.width > 0) {
          g.insert('rect', '.gantt-dep-label:last-of-type')
            .attr('class', 'gantt-dep-label-bg')
            .attr('x', bbox.x - 2)
            .attr('y', bbox.y - 1)
            .attr('width', bbox.width + 4)
            .attr('height', bbox.height + 2)
            .attr('fill', palette.bg)
            .attr('opacity', 0.8)
            .attr('rx', 2);
        }
      }
    }
  }
}

function arrowheadPoints(
  x: number,
  y: number,
  size: number,
  angle: number
): string {
  const a1 = angle + Math.PI * 0.8;
  const a2 = angle - Math.PI * 0.8;
  return `${x},${y} ${x + size * Math.cos(a1)},${y + size * Math.sin(a1)} ${x + size * Math.cos(a2)},${y + size * Math.sin(a2)}`;
}

// ── Tag Legend Rendering ─────────────────────────────────────

function applyCriticalPathHighlight(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  chartG: d3Selection.Selection<SVGGElement, unknown, null, undefined>
) {
  svg.attr('data-critical-path-active', 'true');
  chartG.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
    const el = d3Selection.select(this);
    el.attr(
      'opacity',
      el.attr('data-critical-path') === 'true' ? 1 : FADE_OPACITY
    );
  });
  chartG
    .selectAll<SVGElement, unknown>('.gantt-milestone')
    .attr('opacity', FADE_OPACITY);
  chartG
    .selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary')
    .attr('opacity', FADE_OPACITY);
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').each(function () {
    const el = d3Selection.select(this);
    el.attr(
      'opacity',
      el.attr('data-critical-path') === 'true' ? 1 : FADE_OPACITY
    );
  });
  svg
    .selectAll<SVGGElement, unknown>('.gantt-group-label')
    .attr('opacity', FADE_OPACITY);
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-group-band-bg, .gantt-group-band-accent')
    .attr('opacity', FADE_OPACITY);
  svg
    .selectAll<SVGGElement, unknown>('.gantt-lane-header')
    .attr('opacity', FADE_OPACITY);
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-lane-band-bg, .gantt-lane-band-accent')
    .attr('opacity', FADE_OPACITY);
  chartG
    .selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent')
    .attr('opacity', FADE_OPACITY);
  // Show critical path arrows at full opacity, fade others
  chartG
    .selectAll<SVGElement, unknown>('.gantt-dep-arrow, .gantt-dep-arrowhead')
    .each(function () {
      const el = d3Selection.select(this);
      el.attr(
        'opacity',
        el.attr('data-critical-path') === 'true' ? 0.7 : FADE_OPACITY
      );
    });
}

function resetHighlightAll(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  chartG: d3Selection.Selection<SVGGElement, unknown, null, undefined>
) {
  chartG
    .selectAll<SVGGElement, unknown>('.gantt-task, .gantt-milestone')
    .attr('opacity', 1);
  chartG
    .selectAll<SVGElement, unknown>('.gantt-group-bar, .gantt-group-summary')
    .attr('opacity', 1);
  svg
    .selectAll<SVGTextElement, unknown>('.gantt-task-label')
    .attr('opacity', 1);
  svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', 1);
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-group-band-bg, .gantt-group-band-accent')
    .attr('opacity', 1);
  svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', 1);
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-lane-band-bg, .gantt-lane-band-accent')
    .attr('opacity', 1);
  chartG
    .selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent')
    .attr('opacity', 1);
  chartG
    .selectAll<SVGElement, unknown>('.gantt-dep-arrow, .gantt-dep-arrowhead')
    .attr('opacity', 0.5);
}

// ── Swimlane Icon Helper ─────────────────────────────────────

function drawSwimlaneIcon(
  parent: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  x: number,
  y: number,
  isActive: boolean,
  palette: PaletteColors
): d3Selection.Selection<SVGGElement, unknown, null, undefined> {
  const iconG = parent
    .append('g')
    .attr('class', 'gantt-swimlane-icon')
    .attr('transform', `translate(${x}, ${y})`);

  // Transparent hit area so the whole icon (not just the 2px bars) is clickable
  iconG
    .append('rect')
    .attr('x', -5)
    .attr('y', -5)
    .attr('width', 22)
    .attr('height', 18)
    .attr('fill', 'transparent');

  const color = isActive ? palette.primary : palette.textMuted;
  const opacity = isActive ? 1 : 0.35;
  const barWidths = [8, 12, 6];
  const barH = 2;
  const gap = 3;

  for (let i = 0; i < barWidths.length; i++) {
    iconG
      .append('rect')
      .attr('x', 0)
      .attr('y', i * gap)
      .attr('width', barWidths[i]!) // In-bounds by loop guard.
      .attr('height', barH)
      .attr('rx', 1)
      .attr('fill', color)
      .attr('opacity', opacity);
  }

  return iconG;
}

function buildControlsToggles(
  hasCriticalPath: boolean,
  criticalPathActive: boolean,
  hasDependencies: boolean,
  dependenciesActive: boolean
): import('../utils/legend-types').ControlsGroupToggle[] {
  const toggles: import('../utils/legend-types').ControlsGroupToggle[] = [];
  if (hasCriticalPath) {
    toggles.push({
      id: 'critical-path',
      type: 'toggle',
      label: 'Critical Path',
      active: criticalPathActive,
      onToggle: () => {},
    });
  }
  if (hasDependencies) {
    toggles.push({
      id: 'dependencies',
      type: 'toggle',
      label: 'Dependencies',
      active: dependenciesActive,
      onToggle: () => {},
    });
  }
  return toggles;
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
  _optionLineNumbers: Record<string, number>,
  onToggle?: (groupName: string) => void,
  onToggleControlsExpand?: () => void,
  currentSwimlaneGroup?: string | null,
  onSwimlaneChange?: (group: string | null) => void,
  legendViewMode?: boolean,
  resolvedTasks?: ResolvedTask[],
  controlsExpanded = false,
  hasDependencies = false,
  dependenciesActive = false,
  onControlsToggle?: (toggleId: string, active: boolean) => void,
  exportMode = false,
  controlsHost: 'app' | 'inline' = 'inline'
): void {
  // Build visible groups: active group expanded + swimlane group as compact pill
  let visibleGroups: TagGroup[];
  if (activeGroupName) {
    const activeGroup = tagGroups.filter(
      (g) => g.name.toLowerCase() === activeGroupName.toLowerCase()
    );
    const swimlaneGroup =
      currentSwimlaneGroup &&
      currentSwimlaneGroup.toLowerCase() !== activeGroupName.toLowerCase()
        ? tagGroups.filter(
            (g) => g.name.toLowerCase() === currentSwimlaneGroup.toLowerCase()
          )
        : [];
    visibleGroups = [...swimlaneGroup, ...activeGroup];
  } else {
    visibleGroups = tagGroups;
  }

  // Build set of used tag values per group from resolved tasks
  const usedValues = new Map<string, Set<string>>();
  if (resolvedTasks) {
    for (const group of visibleGroups) {
      const key = tagAttrKey(group.name);
      const used = new Set<string>();
      for (const rt of resolvedTasks) {
        const val = rt.effectiveMetadata[key];
        if (val) used.add(val.toLowerCase());
      }
      usedValues.set(key, used);
    }
  }

  // Filter entries to only those used in the current view
  const filteredEntries = new Map<string, readonly TagEntry[]>();
  for (const group of visibleGroups) {
    const key = tagAttrKey(group.name);
    const used = usedValues.get(key);
    if (used && used.size > 0) {
      filteredEntries.set(
        key,
        group.entries.filter((e) => used.has(e.value.toLowerCase()))
      );
    } else {
      filteredEntries.set(key, group.entries);
    }
  }

  // Compute per-group widths
  const groupWidths: number[] = [];
  let totalW = 0;
  for (const group of visibleGroups) {
    const isActive =
      activeGroupName?.toLowerCase() === group.name.toLowerCase();
    const isSwimlane =
      currentSwimlaneGroup?.toLowerCase() === group.name.toLowerCase();
    const showIcon = !legendViewMode && tagGroups.length > 0;
    const iconReserve = showIcon && isActive ? LEGEND_ICON_W : 0;
    const pillW =
      measureLegendText(group.name, LEGEND_PILL_FONT_SIZE) +
      LEGEND_PILL_PAD +
      iconReserve;
    let groupW = pillW;
    if (isActive) {
      const entries =
        filteredEntries.get(tagAttrKey(group.name)) ?? group.entries;
      let entriesW = 0;
      for (const entry of entries) {
        entriesW +=
          LEGEND_DOT_R * 2 +
          LEGEND_ENTRY_DOT_GAP +
          measureLegendText(entry.value, LEGEND_ENTRY_FONT_SIZE) +
          LEGEND_ENTRY_TRAIL;
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

  // Controls group width — replaces standalone critical path pill
  const hasControls = hasCriticalPath || hasDependencies;
  const controlsToggleLabels: Array<{ label: string }> = [];
  if (hasCriticalPath) controlsToggleLabels.push({ label: 'Critical Path' });
  if (hasDependencies) controlsToggleLabels.push({ label: 'Dependencies' });
  if (hasControls) {
    if (visibleGroups.length > 0) totalW += LEGEND_GROUP_GAP;
    totalW += controlsExpanded
      ? controlsGroupCapsuleWidth(controlsToggleLabels)
      : LEGEND_GEAR_PILL_W;
  }

  // Center over full container (matching title centering)
  const containerWidth = chartLeftMargin + chartInnerWidth + RIGHT_MARGIN;
  const legendX = (containerWidth - totalW) / 2;

  const legendRow = svg
    .append('g')
    .attr('class', 'gantt-tag-legend-container')
    .attr('transform', `translate(${legendX}, ${legendY})`);

  // Render tag groups via centralized legend system
  if (visibleGroups.length > 0) {
    const showIcon = !legendViewMode && tagGroups.length > 0;
    const iconReserve = showIcon ? LEGEND_ICON_W : 0;

    // Build groups with filtered entries
    const legendGroups = visibleGroups.map((g) => {
      const key = g.name.toLowerCase();
      const entries = filteredEntries.get(key) ?? g.entries;
      return {
        name: g.name,
        entries: entries.map((e) => ({ value: e.value, color: e.color })),
      };
    });

    const controlsToggles = buildControlsToggles(
      hasCriticalPath,
      criticalPathActive,
      hasDependencies,
      dependenciesActive
    );

    let tagGroupsW =
      // In-bounds: groupWidths has one entry per visibleGroups item.
      visibleGroups.reduce((s, _, i) => s + groupWidths[i]!, 0) +
      Math.max(0, (visibleGroups.length - 1) * LEGEND_GROUP_GAP);
    // Add controls group space to the renderLegendD3 container width
    if (hasControls) {
      if (visibleGroups.length > 0) tagGroupsW += LEGEND_GROUP_GAP;
      tagGroupsW += controlsExpanded
        ? controlsGroupCapsuleWidth(controlsToggleLabels)
        : LEGEND_GEAR_PILL_W;
    }
    const tagGroupG = legendRow.append('g');

    const legendCallbacks: LegendCallbacks = {
      ...(onToggle !== undefined && { onGroupToggle: onToggle }),
      ...(onToggleControlsExpand !== undefined && {
        onControlsExpand: onToggleControlsExpand,
      }),
      ...(onControlsToggle !== undefined && { onControlsToggle }),
      onEntryHover: (groupName, entryValue) => {
        const tagKey = tagAttrKey(groupName);
        if (entryValue) {
          const ev = entryValue.toLowerCase();
          chartG
            .selectAll<SVGGElement, unknown>('.gantt-task')
            .each(function () {
              const el = d3Selection.select(this);
              el.attr(
                'opacity',
                el.attr(`data-tag-${tagKey}`) === ev ? 1 : FADE_OPACITY
              );
            });
          chartG
            .selectAll<SVGElement, unknown>('.gantt-milestone')
            .attr('opacity', FADE_OPACITY);
          chartG
            .selectAll<
              SVGElement,
              unknown
            >('.gantt-group-bar, .gantt-group-summary')
            .attr('opacity', FADE_OPACITY);
          svg
            .selectAll<SVGTextElement, unknown>('.gantt-task-label')
            .each(function () {
              const el = d3Selection.select(this);
              el.attr(
                'opacity',
                el.attr(`data-tag-${tagKey}`) === ev ? 1 : FADE_OPACITY
              );
            });
          svg
            .selectAll<SVGGElement, unknown>('.gantt-group-label')
            .attr('opacity', FADE_OPACITY);
          svg
            .selectAll<SVGGElement, unknown>('.gantt-lane-header')
            .each(function () {
              const el = d3Selection.select(this);
              el.attr(
                'opacity',
                el.attr(`data-tag-${tagKey}`) === ev ? 1 : FADE_OPACITY
              );
            });
          chartG
            .selectAll<
              SVGElement,
              unknown
            >('.gantt-lane-band, .gantt-lane-accent')
            .attr('opacity', FADE_OPACITY);
        } else {
          if (criticalPathActive) {
            applyCriticalPathHighlight(svg, chartG);
          } else {
            resetHighlightAll(svg, chartG);
          }
        }
      },
      onGroupRendered: (groupName, groupEl, _isActive) => {
        // Add swimlane icon and data attributes
        const group = visibleGroups.find((g) => g.name === groupName);
        if (group) {
          groupEl
            .attr('data-tag-group', group.name)
            .attr('data-line-number', String(group.lineNumber));
        }
        if (showIcon && _isActive) {
          const isSwimlane =
            currentSwimlaneGroup?.toLowerCase() === groupName.toLowerCase();
          const textW =
            measureLegendText(groupName, LEGEND_PILL_FONT_SIZE) +
            LEGEND_PILL_PAD;
          const pillXOff = LEGEND_CAPSULE_PAD;
          const iconX = pillXOff + textW + 3;
          const iconY = (LEGEND_HEIGHT - 10) / 2;
          const iconEl = drawSwimlaneIcon(
            groupEl,
            iconX,
            iconY,
            isSwimlane,
            palette
          );
          iconEl.append('title').text(`Group by ${groupName}`);
          iconEl.style('cursor', 'pointer').on('click', (event: Event) => {
            event.stopPropagation();
            if (onSwimlaneChange) {
              onSwimlaneChange(
                currentSwimlaneGroup?.toLowerCase() === groupName.toLowerCase()
                  ? null
                  : groupName
              );
            }
          });
        }
      },
    };

    renderIntegratedLegend(tagGroupG, {
      groups: legendGroups,
      palette,
      isDark,
      width: tagGroupsW,
      mode: exportMode ? 'export' : 'preview',
      capsulePillAddonWidth: iconReserve,
      ...(controlsToggles.length > 0 && {
        controlsGroup: { toggles: controlsToggles },
      }),
      // 'app' suppresses the inline gear so the desktop ControlsStrip hosts the
      // Critical Path / Dependencies toggles instead (export keeps inline).
      ...(controlsHost === 'app' && !exportMode && { controlsHost: 'app' }),
      activeGroup: activeGroupName,
      controlsExpanded,
      callbacks: legendCallbacks,
    });
  } else if (hasControls) {
    // No tag groups, but controls group needs rendering
    const controlsToggles = buildControlsToggles(
      hasCriticalPath,
      criticalPathActive,
      hasDependencies,
      dependenciesActive
    );

    const tagGroupG = legendRow.append('g');
    renderIntegratedLegend(tagGroupG, {
      groups: [],
      palette,
      isDark,
      width: totalW,
      mode: exportMode ? 'export' : 'preview',
      controlsGroup: { toggles: controlsToggles },
      ...(controlsHost === 'app' && !exportMode && { controlsHost: 'app' }),
      activeGroup: null,
      controlsExpanded,
      callbacks: {
        ...(onToggleControlsExpand !== undefined && {
          onControlsExpand: onToggleControlsExpand,
        }),
        ...(onControlsToggle !== undefined && { onControlsToggle }),
      },
    });
  }

  // Apply persistent critical path highlighting when active
  if (criticalPathActive) {
    applyCriticalPathHighlight(svg, chartG);
  }
}

// ── Era & Marker Rendering ──────────────────────────────────

const ERA_COLORS = ['#3b6ea5', '#5b9357', '#c9a227', '#cc7a33', '#7d5ba6'];

function renderErasAndMarkers(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  resolved: ResolvedSchedule,
  xScale: d3Scale.ScaleLinear<number, number>,
  innerHeight: number,
  palette: PaletteColors,
  eraLabelY: number,
  markerLabelY: number
): void {
  // Eras: semi-transparent background bands
  for (let i = 0; i < resolved.eras.length; i++) {
    const era = resolved.eras[i];
    if (!era) continue; // In-bounds by loop guard; appeases TS.
    // In-bounds: ERA_COLORS has 5 entries and i % 5 is always 0-4.
    const color = era.color || ERA_COLORS[i % ERA_COLORS.length]!;
    const sx = xScale(parseDateToFractionalYear(era.startDate));
    const ex = xScale(parseDateToFractionalYear(era.endDate));
    if (ex <= sx) continue;

    const baseEraOpacity = 0.08;
    const hoverEraOpacity = 0.16;
    const eraStartDate = parseDateStringToDate(era.startDate);
    const eraEndDate = parseDateStringToDate(era.endDate);

    const eraG = g
      .append('g')
      .attr('class', 'gantt-era-group')
      .attr('data-line-number', String(era.lineNumber));

    const eraRect = eraG
      .append('rect')
      .attr('class', 'gantt-era')
      .attr('x', sx)
      .attr('y', 0)
      .attr('width', ex - sx)
      .attr('height', innerHeight)
      .attr('fill', color)
      .attr('opacity', baseEraOpacity);

    // Era label sits in the era row (one row above markers when both present).
    // Truncate to fit the era's own span (with breathing room) so labels stay
    // confined to their tinted band. Full text is restored on hover.
    const eraLabelMaxW = Math.max(0, ex - sx - 8);
    const eraDisplayLabel = truncateLegendText(era.label, 10, eraLabelMaxW);
    const eraTruncated = eraDisplayLabel !== era.label;
    const eraLabel = eraG
      .append('text')
      .attr('class', 'gantt-era-label')
      .attr('x', (sx + ex) / 2)
      .attr('y', eraLabelY)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', color)
      .attr('opacity', 0.7)
      .style('cursor', 'pointer')
      .text(eraDisplayLabel);

    eraG
      .on('mouseenter', () => {
        // Fade everything
        g.selectAll<SVGGElement, unknown>('.gantt-task').attr(
          'opacity',
          FADE_OPACITY
        );
        g.selectAll<SVGElement, unknown>('.gantt-milestone').attr(
          'opacity',
          FADE_OPACITY
        );
        g.selectAll<SVGElement, unknown>(
          '.gantt-group-bar, .gantt-group-summary'
        ).attr('opacity', FADE_OPACITY);
        svg
          .selectAll<SVGGElement, unknown>('.gantt-group-label')
          .attr('opacity', FADE_OPACITY);
        svg
          .selectAll<SVGTextElement, unknown>('.gantt-task-label')
          .attr('opacity', FADE_OPACITY);
        svg
          .selectAll<SVGGElement, unknown>('.gantt-lane-header')
          .attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>(
          '.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group'
        ).attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>(
          '.gantt-dep-arrow, .gantt-dep-arrowhead'
        ).attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr(
          'opacity',
          FADE_OPACITY
        );
        // Highlight this era
        eraRect.attr('opacity', hoverEraOpacity);
        if (eraTruncated) eraLabel.text(era.label);
        showGanttDateIndicators(
          g,
          xScale,
          eraStartDate,
          eraEndDate,
          innerHeight,
          color
        );
      })
      .on('mouseleave', () => {
        resetHighlight(g, svg);
        eraRect.attr('opacity', baseEraOpacity);
        if (eraTruncated) eraLabel.text(eraDisplayLabel);
        hideGanttDateIndicators(g);
      });
  }

  // Markers: label → diamond → dashed line (same layout as timeline).
  // Pre-compute x positions so each marker can size its label based on the
  // distance to its nearest neighbor — symmetric truncation lets crowded
  // labels meet in the middle of the gap rather than overlapping.
  const markerXs = resolved.markers.map((m) =>
    xScale(parseDateToFractionalYear(m.date))
  );
  // d3 scale.range() returns a 2-element array.
  const innerWidth = xScale.range()[1]!;
  for (let i = 0; i < resolved.markers.length; i++) {
    const marker = resolved.markers[i];
    if (!marker) continue; // In-bounds by loop guard; appeases TS.
    const color = marker.color || palette.accent || '#3a9188';
    // In-bounds: markerXs.length === resolved.markers.length.
    const mx = markerXs[i]!;
    const markerDate = parseDateStringToDate(marker.date);
    const diamondSize = 5;
    const labelY = markerLabelY;
    const diamondY = -2; // below date indicator labels

    // Available label width: distance to nearest neighbor (or chart edge),
    // minus a small padding. Both labels truncate symmetrically and meet
    // in the middle of the gap.
    let nearestDist = Math.min(mx, innerWidth - mx);
    for (let j = 0; j < markerXs.length; j++) {
      if (j === i) continue;
      // In-bounds by loop guard.
      const d = Math.abs(markerXs[j]! - mx);
      if (d < nearestDist) nearestDist = d;
    }
    const markerLabelMaxW = Math.max(0, nearestDist - 8);
    const markerDisplayLabel = truncateLegendText(
      marker.label,
      11,
      markerLabelMaxW
    );
    const markerTruncated = markerDisplayLabel !== marker.label;

    const markerG = g
      .append('g')
      .attr('class', 'gantt-marker-group')
      .attr('data-line-number', String(marker.lineNumber))
      .style('cursor', 'pointer');

    // Invisible hit rect for easier clicking/hovering
    markerG
      .append('rect')
      .attr('x', mx - 40)
      .attr('y', labelY - 12)
      .attr('width', 80)
      .attr('height', innerHeight - labelY + 12)
      .attr('fill', 'transparent')
      .attr('pointer-events', 'all');

    // Label above diamond
    const markerLabelEl = markerG
      .append('text')
      .attr('class', 'gantt-marker-label')
      .attr('x', mx)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .attr('fill', color)
      .text(markerDisplayLabel);

    // Diamond below label
    markerG
      .append('path')
      .attr(
        'd',
        `M${mx},${diamondY - diamondSize} l${diamondSize},${diamondSize} l-${diamondSize},${diamondSize} l-${diamondSize},-${diamondSize} Z`
      )
      .attr('fill', color)
      .attr('opacity', 0.9);

    // Dashed line from diamond down
    markerG
      .append('line')
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
        g.selectAll<SVGGElement, unknown>('.gantt-task').attr(
          'opacity',
          FADE_OPACITY
        );
        g.selectAll<SVGElement, unknown>('.gantt-milestone').attr(
          'opacity',
          FADE_OPACITY
        );
        g.selectAll<SVGElement, unknown>(
          '.gantt-group-bar, .gantt-group-summary'
        ).attr('opacity', FADE_OPACITY);
        svg
          .selectAll<SVGGElement, unknown>('.gantt-group-label')
          .attr('opacity', FADE_OPACITY);
        svg
          .selectAll<SVGTextElement, unknown>('.gantt-task-label')
          .attr('opacity', FADE_OPACITY);
        svg
          .selectAll<SVGGElement, unknown>('.gantt-lane-header')
          .attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>(
          '.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group'
        ).attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>(
          '.gantt-dep-arrow, .gantt-dep-arrowhead'
        ).attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-era-group').attr(
          'opacity',
          FADE_OPACITY
        );
        // Fade other markers but keep this one highlighted
        g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr(
          'opacity',
          FADE_OPACITY
        );
        markerG.attr('opacity', 1);
        markerLine.attr('opacity', 0.8);
        markerDiamond.attr('opacity', 0);
        if (markerTruncated) markerLabelEl.text(marker.label);
        showGanttDateIndicators(
          g,
          xScale,
          markerDate,
          null,
          innerHeight,
          color,
          { skipStartLine: true }
        );
      })
      .on('mouseleave', () => {
        resetHighlight(g, svg);
        markerLine.attr('opacity', 0.5);
        markerDiamond.attr('opacity', 0.9);
        if (markerTruncated) markerLabelEl.text(markerDisplayLabel);
        hideGanttDateIndicators(g);
      });
  }
}

// ── Sprint band rendering ──────────────────────────────────

const SPRINT_BAND_OPACITY = 0.05;
const SPRINT_HOVER_OPACITY = 0.12;
const SPRINT_BOUNDARY_OPACITY = 0.3;

function renderSprintBands(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  resolved: ResolvedSchedule,
  xScale: d3Scale.ScaleLinear<number, number>,
  innerHeight: number,
  palette: PaletteColors
): void {
  if (resolved.sprints.length === 0) return;

  // When both eras and sprints defined, eras win — don't render sprint bands
  if (resolved.eras.length > 0) return;

  const bandColor = palette.textMuted || palette.text || '#888';

  // Chart content area starts at x=0 in the g coordinate space
  const chartMinX = 0;

  for (let i = 0; i < resolved.sprints.length; i++) {
    const sprint = resolved.sprints[i];
    if (!sprint) continue; // In-bounds by loop guard; appeases TS.
    const rawSx = xScale(dateToFractionalYear(sprint.startDate));
    const rawEx = xScale(dateToFractionalYear(sprint.endDate));
    if (rawEx <= rawSx) continue;

    // Clip to chart content area — prevent bands from extending into swimlane margin
    const sx = Math.max(rawSx, chartMinX);
    const ex = rawEx;
    const bandWidth = ex - sx;
    if (bandWidth <= 0) continue;

    const sprintG = g
      .append('g')
      .attr('class', 'gantt-sprint-group')
      .style('cursor', 'pointer');

    // Alternating shaded bands (consistent by sprint number)
    const sprintRect = sprintG
      .append('rect')
      .attr('class', 'gantt-sprint-band')
      .attr('x', sx)
      .attr('y', 0)
      .attr('width', bandWidth)
      .attr('height', innerHeight)
      .attr('fill', bandColor)
      .attr('opacity', sprint.number % 2 === 0 ? SPRINT_BAND_OPACITY : 0);

    // Invisible hit rect for hover on unshaded bands
    if (sprint.number % 2 !== 0) {
      sprintG
        .append('rect')
        .attr('x', sx)
        .attr('y', 0)
        .attr('width', bandWidth)
        .attr('height', innerHeight)
        .attr('fill', 'transparent');
    }

    // Persistent sprint number label — always visible, turns into "Sprint X" on hover
    const sprintLabel = sprintG
      .append('text')
      .attr('class', 'gantt-sprint-label')
      .attr('x', (sx + ex) / 2)
      .attr('y', -22)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('fill', bandColor)
      .attr('opacity', 0.4)
      .text(String(sprint.number));

    // Dashed boundary line at sprint start (skip for first visible band)
    if (i > 0 && rawSx >= chartMinX) {
      sprintG
        .append('line')
        .attr('class', 'gantt-sprint-boundary')
        .attr('x1', sx)
        .attr('y1', -6)
        .attr('x2', sx)
        .attr('y2', innerHeight)
        .attr('stroke', bandColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3 3')
        .attr('opacity', SPRINT_BOUNDARY_OPACITY);
    }

    // Determine which tasks and groups overlap this sprint (start-inclusive, end-exclusive)
    const sprintStartMs = sprint.startDate.getTime();
    const sprintEndMs = sprint.endDate.getTime();
    const overlappingTaskIds = new Set<string>();
    for (const rt of resolved.tasks) {
      const taskStart = rt.startDate.getTime();
      const taskEnd = rt.endDate.getTime();
      // Task overlaps sprint if it starts before sprint ends AND ends after sprint starts
      if (taskStart < sprintEndMs && taskEnd > sprintStartMs) {
        overlappingTaskIds.add(rt.task.id);
      }
      // Milestones (zero duration): include if they fall within [sprintStart, sprintEnd)
      if (
        taskStart === taskEnd &&
        taskStart >= sprintStartMs &&
        taskStart < sprintEndMs
      ) {
        overlappingTaskIds.add(rt.task.id);
      }
    }
    const overlappingGroupNames = new Set<string>();
    for (const rg of resolved.groups) {
      const gStart = rg.startDate.getTime();
      const gEnd = rg.endDate.getTime();
      if (gStart < sprintEndMs && gEnd > sprintStartMs) {
        overlappingGroupNames.add(rg.name);
      }
    }

    // Hover: highlight band, keep overlapping tasks visible, show dates + sprint label
    const baseOpacity = sprint.number % 2 === 0 ? SPRINT_BAND_OPACITY : 0;
    sprintG
      .on('mouseenter', () => {
        // Dim tasks NOT in this sprint, keep overlapping ones visible
        g.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
          const el = d3Selection.select(this);
          const id = el.attr('data-task-id');
          el.attr(
            'opacity',
            id && overlappingTaskIds.has(id) ? 1 : FADE_OPACITY
          );
        });
        g.selectAll<SVGElement, unknown>('.gantt-milestone').each(function () {
          const el = d3Selection.select(this);
          const id = el.attr('data-task-id');
          el.attr(
            'opacity',
            id && overlappingTaskIds.has(id) ? 1 : FADE_OPACITY
          );
        });
        svg
          .selectAll<SVGTextElement, unknown>('.gantt-task-label')
          .each(function () {
            const el = d3Selection.select(this);
            const id = el.attr('data-task-id');
            el.attr(
              'opacity',
              id && overlappingTaskIds.has(id) ? 1 : FADE_OPACITY
            );
          });
        g.selectAll<SVGElement, unknown>(
          '.gantt-group-bar, .gantt-group-summary'
        ).each(function () {
          const el = d3Selection.select(this);
          const name = el.attr('data-group');
          el.attr(
            'opacity',
            name && overlappingGroupNames.has(name) ? 1 : FADE_OPACITY
          );
        });
        svg
          .selectAll<SVGGElement, unknown>('.gantt-group-label')
          .each(function () {
            const el = d3Selection.select(this);
            const name = el.attr('data-group');
            el.attr(
              'opacity',
              name && overlappingGroupNames.has(name) ? 1 : FADE_OPACITY
            );
          });
        svg
          .selectAll<SVGGElement, unknown>('.gantt-lane-header')
          .attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>(
          '.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group'
        ).attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>(
          '.gantt-dep-arrow, .gantt-dep-arrowhead'
        ).attr('opacity', FADE_OPACITY);
        g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr(
          'opacity',
          FADE_OPACITY
        );
        sprintRect.attr('opacity', SPRINT_HOVER_OPACITY);
        // Only show start date indicator if it's within the visible chart area
        const startVisible = rawSx >= chartMinX;
        if (startVisible) {
          showGanttDateIndicators(
            g,
            xScale,
            sprint.startDate,
            sprint.endDate,
            innerHeight,
            bandColor
          );
        } else {
          // Only show end date indicator (start is clipped/off-screen)
          showGanttDateIndicators(
            g,
            xScale,
            sprint.endDate,
            null,
            innerHeight,
            bandColor
          );
        }
        // Swap persistent label to full "Sprint X" on hover
        const accentColor = palette.accent || palette.text || bandColor;
        sprintLabel
          .text(`Sprint ${sprint.number}`)
          .attr('font-size', '13px')
          .attr('font-weight', '700')
          .attr('fill', accentColor)
          .attr('opacity', 1);
      })
      .on('mouseleave', () => {
        resetHighlight(g, svg);
        sprintRect.attr('opacity', baseOpacity);
        sprintLabel
          .text(String(sprint.number))
          .attr('font-size', '10px')
          .attr('font-weight', '600')
          .attr('fill', bandColor)
          .attr('opacity', 0.4);
        hideGanttDateIndicators(g);
      });
  }

  // Boundary line at end of last sprint
  // In-bounds: early return above when sprints.length === 0.
  const lastSprint = resolved.sprints[resolved.sprints.length - 1]!;
  const lastEx = xScale(dateToFractionalYear(lastSprint.endDate));
  g.append('line')
    .attr('class', 'gantt-sprint-boundary')
    .attr('x1', lastEx)
    .attr('y1', -6)
    .attr('x2', lastEx)
    .attr('y2', innerHeight)
    .attr('stroke', bandColor)
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3 3')
    .attr('opacity', SPRINT_BOUNDARY_OPACITY);
}

/**
 * Parse a date string (YYYY, YYYY-MM, YYYY-MM-DD) to a Date object.
 * Used for eras and markers which store dates as strings.
 */
function parseDateStringToDate(s: string): Date {
  const parts = s.split('-').map((p) => parseInt(p, 10));
  // In-bounds: split() returns at least one element.
  const year = parts[0]!;
  const month = parts.length >= 2 ? parts[1]! - 1 : 0;
  const day = parts.length >= 3 ? parts[2]! : 1;
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
  resolved: ResolvedSchedule
): void {
  // Find immediate predecessors and successors
  const related = new Set<string>([taskId]);
  const task = resolved.tasks.find((t) => t.task.id === taskId);
  if (!task) return;

  // Predecessors: tasks whose deps point to this task
  for (const rt of resolved.tasks) {
    for (const dep of rt.task.dependencies) {
      // Check if this dep points to our task (forgiving normalization)
      const depKey = normalizeName(dep.targetName);
      if (
        depKey === normalizeName(task.task.label) ||
        normalizeName(
          `${task.groupPath.join('.')}.${task.task.label}`
        ).endsWith(depKey)
      ) {
        related.add(rt.task.id);
      }
    }
  }
  // Successors: tasks this task has deps pointing to
  for (const dep of task.task.dependencies) {
    const target = resolved.tasks.find(
      (t) =>
        t.task.label === dep.targetName ||
        `${t.groupPath.join('.')}.${t.task.label}`.endsWith(dep.targetName)
    );
    if (target) related.add(target.task.id);
  }

  // Fade all tasks not in related set
  g.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
    const el = d3Selection.select(this);
    const id = el.attr('data-task-id');
    el.attr('opacity', id && related.has(id) ? 1 : FADE_OPACITY);
  });
  g.selectAll<SVGGElement, unknown>('.gantt-milestone').attr(
    'opacity',
    FADE_OPACITY
  );
  g.selectAll<SVGElement, unknown>(
    '.gantt-group-bar, .gantt-group-summary'
  ).attr('opacity', FADE_OPACITY);
  svg
    .selectAll<SVGGElement, unknown>('.gantt-group-label')
    .attr('opacity', FADE_OPACITY);
  svg
    .selectAll<SVGGElement, unknown>('.gantt-lane-header')
    .attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent').attr(
    'opacity',
    FADE_OPACITY
  );

  // Fade dependency arrows not connected to related tasks
  g.selectAll<SVGElement, unknown>(
    '.gantt-dep-arrow, .gantt-dep-arrowhead'
  ).each(function () {
    const el = d3Selection.select(this);
    const from = el.attr('data-dep-from');
    const to = el.attr('data-dep-to');
    const isRelated = (from && related.has(from)) || (to && related.has(to));
    el.attr('opacity', isRelated ? 0.5 : FADE_OPACITY);
  });
  // Fade markers
  g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr(
    'opacity',
    FADE_OPACITY
  );
}

function highlightGroup(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  groupName: string
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
  g.selectAll<SVGElement, unknown>(
    '.gantt-group-bar, .gantt-group-summary'
  ).each(function () {
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
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-group-band-bg, .gantt-group-band-accent')
    .each(function () {
      const el = d3Selection.select(this);
      el.attr(
        'opacity',
        el.attr('data-group') === groupName ? 1 : FADE_OPACITY
      );
    });
  // Fade lane elements
  svg
    .selectAll<SVGGElement, unknown>('.gantt-lane-header')
    .attr('opacity', FADE_OPACITY);
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-lane-band-bg, .gantt-lane-band-accent')
    .attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>('.gantt-lane-band, .gantt-lane-accent').attr(
    'opacity',
    FADE_OPACITY
  );
  // Fade markers
  g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr(
    'opacity',
    FADE_OPACITY
  );
}

function highlightLane(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  tagKey: string,
  laneName: string
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
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-lane-band-bg, .gantt-lane-band-accent')
    .each(function () {
      const el = d3Selection.select(this);
      el.attr('opacity', el.attr('data-lane') === laneName ? 1 : FADE_OPACITY);
    });
  // Fade group elements (not relevant in lane mode)
  g.selectAll<SVGElement, unknown>(
    '.gantt-group-bar, .gantt-group-summary'
  ).attr('opacity', FADE_OPACITY);
  svg
    .selectAll<SVGGElement, unknown>('.gantt-group-label')
    .attr('opacity', FADE_OPACITY);
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-group-band-bg, .gantt-group-band-accent')
    .attr('opacity', FADE_OPACITY);
  // Fade markers
  g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr(
    'opacity',
    FADE_OPACITY
  );
}

function highlightTask(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  taskId: string
): void {
  // Fade tasks not matching
  g.selectAll<SVGGElement, unknown>('.gantt-task').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-task-id') === taskId ? 1 : FADE_OPACITY);
  });
  // Fade milestones not matching
  g.selectAll<SVGElement, unknown>('.gantt-milestone').attr(
    'opacity',
    FADE_OPACITY
  );
  // Fade task labels not matching
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-task-id') === taskId ? 1 : FADE_OPACITY);
  });
  // Fade group/lane elements
  g.selectAll<SVGElement, unknown>(
    '.gantt-group-bar, .gantt-group-summary'
  ).attr('opacity', FADE_OPACITY);
  svg
    .selectAll<SVGGElement, unknown>('.gantt-group-label')
    .attr('opacity', FADE_OPACITY);
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-group-band-bg, .gantt-group-band-accent')
    .attr('opacity', FADE_OPACITY);
  svg
    .selectAll<SVGGElement, unknown>('.gantt-lane-header')
    .attr('opacity', FADE_OPACITY);
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-lane-band-bg, .gantt-lane-band-accent')
    .attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>(
    '.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group'
  ).attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>(
    '.gantt-dep-arrow, .gantt-dep-arrowhead'
  ).attr('opacity', FADE_OPACITY);
  // Fade markers
  g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr(
    'opacity',
    FADE_OPACITY
  );
}

function highlightMilestone(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  taskId: string
): void {
  // Fade tasks
  g.selectAll<SVGGElement, unknown>('.gantt-task').attr(
    'opacity',
    FADE_OPACITY
  );
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
  g.selectAll<SVGElement, unknown>(
    '.gantt-group-bar, .gantt-group-summary'
  ).attr('opacity', FADE_OPACITY);
  svg
    .selectAll<SVGGElement, unknown>('.gantt-group-label')
    .attr('opacity', FADE_OPACITY);
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-group-band-bg, .gantt-group-band-accent')
    .attr('opacity', FADE_OPACITY);
  svg
    .selectAll<SVGGElement, unknown>('.gantt-lane-header')
    .attr('opacity', FADE_OPACITY);
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-lane-band-bg, .gantt-lane-band-accent')
    .attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>(
    '.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group'
  ).attr('opacity', FADE_OPACITY);
  g.selectAll<SVGElement, unknown>(
    '.gantt-dep-arrow, .gantt-dep-arrowhead'
  ).attr('opacity', FADE_OPACITY);
  // Fade markers
  g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr(
    'opacity',
    FADE_OPACITY
  );
}

function highlightTaskLabel(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  lineNumber: number
): void {
  const ln = String(lineNumber);
  svg.selectAll<SVGTextElement, unknown>('.gantt-task-label').each(function () {
    const el = d3Selection.select(this);
    el.attr('opacity', el.attr('data-line-number') === ln ? 1 : FADE_OPACITY);
  });
}

function resetTaskLabels(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>
): void {
  svg
    .selectAll<SVGTextElement, unknown>('.gantt-task-label')
    .attr('opacity', 1);
}

function resetHighlight(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>
): void {
  // If critical path is actively toggled ON, restore its highlight instead of full reset
  if (svg.attr('data-critical-path-active') === 'true') {
    applyCriticalPathHighlight(svg, g);
    return;
  }
  g.selectAll<SVGGElement, unknown>('.gantt-task, .gantt-milestone').attr(
    'opacity',
    1
  );
  g.selectAll<SVGElement, unknown>(
    '.gantt-group-bar, .gantt-group-summary'
  ).attr('opacity', 1);
  svg.selectAll<SVGGElement, unknown>('.gantt-group-label').attr('opacity', 1);
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-group-band-bg, .gantt-group-band-accent')
    .attr('opacity', 1);
  svg
    .selectAll<SVGTextElement, unknown>('.gantt-task-label')
    .attr('opacity', 1);
  svg.selectAll<SVGGElement, unknown>('.gantt-lane-header').attr('opacity', 1);
  svg
    .selectAll<
      SVGElement,
      unknown
    >('.gantt-lane-band-bg, .gantt-lane-band-accent')
    .attr('opacity', 1);
  g.selectAll<SVGElement, unknown>(
    '.gantt-lane-band, .gantt-lane-accent, .gantt-lane-band-group'
  ).attr('opacity', 1);
  g.selectAll<SVGElement, unknown>(
    '.gantt-dep-arrow, .gantt-dep-arrowhead'
  ).attr('opacity', 0.5);
  g.selectAll<SVGElement, unknown>('.gantt-marker-group').attr('opacity', 1);
  g.selectAll<SVGElement, unknown>('.gantt-era-group').attr('opacity', 1);
}

// ── Row Building ────────────────────────────────────────────

type GroupRow = { type: 'group'; group: ResolvedGroup };
type TaskRow = { type: 'task'; task: ResolvedTask };
type LaneHeaderRow = {
  type: 'lane-header';
  laneName: string;
  laneColor: string;
  aggregateProgress: number | null;
  tagKey: string;
  isCollapsed: boolean;
  laneStartDate: Date | null;
  laneEndDate: Date | null;
};
type Row = GroupRow | TaskRow | LaneHeaderRow;

// Public type aliases (prefixed to avoid collisions in consumer code)
export type {
  GroupRow as GanttGroupRow,
  TaskRow as GanttTaskRow,
  LaneHeaderRow as GanttLaneHeaderRow,
  Row as GanttRow,
};

function buildRowList(
  resolved: ResolvedSchedule,
  collapsedGroups?: Set<string>
): Row[] {
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
    const isHidden = rt.groupPath.some((g) => collapsedGroups?.has(g));
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
      if (groupName === undefined) continue; // In-bounds by loop guard; appeases TS.
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
  collapsedLanes?: Set<string>
): Row[] | null {
  const tagGroup = resolved.tagGroups.find(
    (g) => g.name.toLowerCase() === swimlaneGroup.toLowerCase()
  );
  if (!tagGroup) return null;

  const tagKey = tagAttrKey(tagGroup.name);
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
    const laneStartDate =
      tasks.length > 0
        ? new Date(Math.min(...tasks.map((t) => t.startDate.getTime())))
        : null;
    const laneEndDate =
      tasks.length > 0
        ? new Date(Math.max(...tasks.map((t) => t.endDate.getTime())))
        : null;

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

    const noLaneStartDate =
      unbucketed.length > 0
        ? new Date(Math.min(...unbucketed.map((t) => t.startDate.getTime())))
        : null;
    const noLaneEndDate =
      unbucketed.length > 0
        ? new Date(Math.max(...unbucketed.map((t) => t.endDate.getTime())))
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
  return hasProgress && totalDuration > 0
    ? totalProgress / totalDuration
    : null;
}

function dateToFractionalYear(d: Date): number {
  const y = d.getFullYear();
  const startOfYear = new Date(y, 0, 1);
  const endOfYear = new Date(y + 1, 0, 1);
  const fraction =
    (d.getTime() - startOfYear.getTime()) /
    (endOfYear.getTime() - startOfYear.getTime());
  return y + fraction;
}

function diamondPoints(cx: number, cy: number, size: number): string {
  const half = size / 2;
  return `${cx},${cy - half} ${cx + half},${cy} ${cx},${cy + half} ${cx - half},${cy}`;
}

// ── Hover Date Indicators ───────────────────────────────────

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
  options?: { skipStartLine?: boolean }
): void {
  // Fade existing scale ticks and today marker
  g.selectAll('.gantt-scale-tick').attr('opacity', 0.05);
  g.selectAll('.gantt-today').attr('opacity', 0.05);

  // Wrap all hover indicators in a group that ignores pointer events,
  // so they don't steal mouseleave from the element being hovered.
  const hg = g
    .append('g')
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
    hg.selectAll<SVGTextElement, unknown>('text.gantt-hover-date').each(
      function () {
        const el = d3Selection.select(this);
        if (el.text() === startLabel) {
          el.attr('x', startLabelX).attr('text-anchor', startAnchor);
        }
      }
    );

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
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>
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
  palette: PaletteColors
): string {
  // Try tag-based coloring first
  const tagColor = resolveTagColor(
    rt.effectiveMetadata,
    resolved.tagGroups,
    activeTagGroup
  );
  if (tagColor && tagColor !== '#999999') return tagColor;

  // Fall back to group-based coloring
  if (rt.groupPath.length > 0) {
    // In-bounds by length check above.
    const topGroup = rt.groupPath[0]!;
    const groupIdx = resolved.groups.findIndex((g) => g.name === topGroup);
    if (groupIdx >= 0) {
      // In-bounds: findIndex >= 0 means index is valid.
      const group = resolved.groups[groupIdx]!;
      if (group.color) return group.color;
      // In-bounds: i % n is always 0..n-1 for n > 0; seriesColors is non-empty here.
      return seriesColors[groupIdx % seriesColors.length]!;
    }
  }

  // Default
  return palette.accent || seriesColors[0] || '#4a90d9';
}

function renderTimeScaleHorizontal(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  scale: d3Scale.ScaleLinear<number, number>,
  _innerWidth: number,
  innerHeight: number,
  textColor: string
): void {
  const domain = scale.domain();
  // In-bounds: d3 ScaleLinear.domain() returns at least 2 elements.
  const domainMin = domain[0]!;
  const domainMax = domain[1]!;
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
