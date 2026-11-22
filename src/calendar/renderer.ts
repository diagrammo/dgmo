// ============================================================
// Calendar renderer — `layout weeks` and `layout months` (§41.3, #1877)
// ============================================================
//
// weeks:  one column per week, seven weekday rows (the GitHub shape). Week
//         one holds the span's first day; past a year the grid stacks one
//         band per calendar year (#2089).
// months: one strip per month, the day of the month along it. Upright by
//         default (months as columns, days 1–31 down); `orientation-
//         horizontal` makes the months rows. Weekend tiles are tinted.
//
// The legend sits between the title and the grid: one pill per group, the
// open one colours the tiles. A number group shades five steps (grey for
// zero, then quartiles or four bands up to `max`); a tag group colours by
// value, with blank days "Not logged". An event colours its tiles with its
// value in the open group; an event the fill does not show adds a corner
// dot. Names and notes show on hover.

import * as d3Selection from 'd3-selection';
import { resolveColor } from '../colors';
import { escapeHtml } from '../embed/escape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { mix, valueRampColor } from '../palettes/color-utils';
import type { Writable } from '../utils/brand';
import { growChartFrame } from '../utils/chart-frame';
import type { ChartFrame } from '../utils/chart-frame-parse';
import { createTooltip, hideTooltip, showTooltip } from '../utils/d3-helpers';
import { stripInlineMarkdown } from '../utils/inline-markdown';
import { legendInkBottom } from '../utils/legend-constants';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import type { LegendConfig, LegendGroupData } from '../utils/legend-types';
import { legendSuppressed } from '../utils/parsing';
import {
  AUTO_TAG_COLOR_SENTINEL,
  assignAutoTagColors,
  tagAttrKey,
} from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import { measureText } from '../utils/text-measure';
import {
  FRAME_BODY_TOP,
  LEGEND_BODY_GAP,
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { dayNumber, daysInMonth, dayToIso, parts, weekday } from './dates';
import {
  amount,
  busiestDay,
  calendarSummary,
  fullDate,
  LABELLED_WEEKDAYS,
  MONTHS,
  numberGroupOf,
  shadeLevels,
  WEEKDAYS,
} from './format';
import { resolveCalendarActiveGroup } from './parser';
import type {
  CalendarGroupRef,
  CalendarNumberGroup,
  DayNumber,
  ParsedCalendar,
} from './types';

export interface CalendarRenderOptions {
  exportMode?: boolean;
  /**
   * The open legend pill, by group name; `null` draws no colour. Absent →
   * the source's `active-tag`, else the first group (§41.5).
   */
  activeTagGroup?: string | null;
  /**
   * Called with a group's name when a reader clicks its pill. Absent → the
   * chart redraws itself with that pill open.
   */
  onActiveGroupChange?: (groupName: string) => void;
}

const DIAGRAM_PADDING = 20;
const GAP = 3;
const BASE_PITCH = 14;
const MAX_PITCH = 28;
/** A full year's width at the base pitch; a shorter span grows its squares
 *  toward it. */
const TARGET_GRID_WIDTH = 53 * BASE_PITCH;
const CELL_RADIUS = 2;
const LABEL_FONT_SIZE = 10;
const MONTH_BAND = 16;
const BAND_GAP = 10;
const WEEKDAY_GAP = 6;
const MONTH_LABEL_GAP = 4;
/** `layout months`, upright: a month column's tile. */
const STRIP_TILE_W = 26;
const STRIP_TILE_H = 11;
/** `layout months`, horizontal: square tiles along each month row. */
const ROW_TILE = 14;
/** Day-of-month labels along a strip. */
const LABELLED_DATES = new Set([1, 5, 10, 15, 20, 25, 30]);
/** How far below its band a month name's ink starts; the band under a
 *  legend is measured to the ink (#1838). */
const LABEL_INK_TOP = 1.66;
/** Where the legend's first row sits under the title. */
const LEGEND_TITLE_GAP = 10;

/** One day's tile and what it shows. */
interface Cell {
  day: DayNumber;
  x: number;
  y: number;
}

interface Label {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  cls: string;
  bold?: boolean;
  month?: string;
}

interface Geometry {
  cells: Cell[];
  labels: Label[];
  cellW: number;
  cellH: number;
  pitchX: number;
  pitchY: number;
  /** Right and bottom edge of the drawing, in root units. */
  right: number;
  bottom: number;
  /** Tile tinted as a weekend (`layout months`). */
  weekend: (day: DayNumber) => boolean;
}

/** Each tag value's fill in this palette, by group key then value. The
 *  parser has no palette, so colours resolve here: an authored name
 *  re-resolves, and a bare value takes the next free categorical colour. */
function tagFills(
  groups: readonly TagGroup[],
  palette: PaletteColors
): Map<string, Map<string, string>> {
  const fills = new Map<string, Map<string, string>>();
  for (const group of groups) {
    const copy: Writable<TagGroup> = {
      ...group,
      entries: group.entries.map((e) => ({
        ...e,
        color: e.authoredColor
          ? (resolveColor(e.authoredColor, palette) ?? e.color)
          : AUTO_TAG_COLOR_SENTINEL,
      })),
    };
    assignAutoTagColors(copy, palette);
    const m = new Map<string, string>();
    for (const e of copy.entries) if (!m.has(e.value)) m.set(e.value, e.color);
    fills.set(tagAttrKey(group.name), m);
  }
  return fills;
}

/**
 * The five shades: grey for zero, then four steps. `heat <Label> [low]
 * [high]` sets them the way every value ramp does (§13.9): one colour
 * replaces the green, two run the four steps from `low` to `high`.
 */
function shadeFills(
  palette: PaletteColors,
  isDark: boolean,
  heat?: { low?: string; high?: string }
): string[] {
  const zero = mix(palette.textMuted, palette.bg, 16);
  const hue =
    (heat?.high ? resolveColor(heat.high, palette) : null) ??
    palette.colors.green;
  const low = heat?.low ? resolveColor(heat.low, palette) : null;
  if (low)
    return [
      zero,
      ...[0, 1 / 3, 2 / 3, 1].map((t) =>
        valueRampColor(low, hue, t, { isDark })
      ),
    ];
  return [
    zero,
    mix(hue, palette.bg, 30),
    mix(hue, palette.bg, 55),
    mix(hue, palette.bg, 80),
    hue,
  ];
}

/** `layout weeks`: weeks across, weekdays down, one band per year past 53
 *  weeks. */
function weeksGeometry(
  parsed: ParsedCalendar,
  left0: number,
  top: number,
  exportMode: boolean
): Geometry {
  const { start, end, weekStart } = parsed;
  const spanWeeks =
    Math.floor((end - start + ((weekday(start) - weekStart + 7) % 7)) / 7) + 1;
  const bands: { year: number; first: DayNumber; last: DayNumber }[] = [];
  if (spanWeeks <= 53) {
    bands.push({ year: parts(start).year, first: start, last: end });
  } else {
    for (let y = parts(start).year; y <= parts(end).year; y++) {
      bands.push({
        year: y,
        first: Math.max(start, dayNumber(y, 1, 1)!),
        last: Math.min(end, dayNumber(y, 12, 31)!),
      });
    }
  }
  const stacked = bands.length > 1;
  const bandOf = (day: DayNumber): number =>
    stacked ? parts(day).year - bands[0]!.year : 0;
  const columnOf = (day: DayNumber): number => {
    const first = bands[bandOf(day)]!.first;
    const offset = (weekday(first) - weekStart + 7) % 7;
    return Math.floor((day - first + offset) / 7);
  };
  const rowOf = (day: DayNumber): number => (weekday(day) - weekStart + 7) % 7;
  const weeks = Math.max(
    ...bands.map((b) => {
      const offset = (weekday(b.first) - weekStart + 7) % 7;
      return Math.floor((b.last - b.first + offset) / 7) + 1;
    })
  );
  const pitch = Math.max(
    BASE_PITCH,
    Math.min(MAX_PITCH, Math.floor(TARGET_GRID_WIDTH / weeks))
  );
  const cell = pitch - GAP;
  const weekdayLabelWidth =
    Math.max(
      ...[...LABELLED_WEEKDAYS].map((d) =>
        measureText(WEEKDAYS[d]!.slice(0, 3), LABEL_FONT_SIZE)
      )
    ) + WEEKDAY_GAP;
  const yearLabelWidth = stacked
    ? measureText('0000', LABEL_FONT_SIZE, { bold: true }) + WEEKDAY_GAP
    : 0;
  const gridLeft = left0 + Math.max(weekdayLabelWidth, yearLabelWidth);
  const gridWidth = weeks * pitch - GAP;
  const gridTop = top + MONTH_BAND;
  const bandHeight = 7 * pitch - GAP;
  const bandPitch = bandHeight + MONTH_BAND + BAND_GAP;
  const bandTop = (i: number): number => gridTop + i * bandPitch;

  const labels: Label[] = [];
  bands.forEach((band, bi) => {
    const yTop = bandTop(bi);
    if (stacked)
      labels.push({
        text: String(band.year),
        x: left0,
        y: yTop - 5,
        anchor: 'start',
        cls: 'calendar-year',
        bold: true,
      });
    let lastMonthRight = -Infinity;
    for (let day = band.first; day <= band.last; ) {
      const p = parts(day);
      const next = Math.round(Date.UTC(p.year, p.month, 1) / 86_400_000);
      // The name centres over the weeks its month spans in this band, kept
      // inside the grid.
      const name = MONTHS[p.month - 1]!.slice(0, 3);
      const w = measureText(name, LABEL_FONT_SIZE);
      const from = gridLeft + columnOf(day) * pitch;
      const to =
        gridLeft + columnOf(Math.min(next - 1, band.last)) * pitch + cell;
      const left = Math.min(
        Math.max((from + to - w) / 2, gridLeft),
        gridLeft + gridWidth - w
      );
      if (left >= lastMonthRight + MONTH_LABEL_GAP) {
        labels.push({
          text: name,
          x: left + w / 2,
          y: yTop - 5,
          anchor: 'middle',
          cls: 'calendar-month',
          ...(!exportMode && { month: dayToIso(day).slice(0, 7) }),
        });
        lastMonthRight = left + w;
      }
      day = next;
    }
    for (let row = 0; row < 7; row++) {
      const wd = (row + weekStart) % 7;
      if (!LABELLED_WEEKDAYS.has(wd)) continue;
      labels.push({
        text: WEEKDAYS[wd]!.slice(0, 3),
        x: gridLeft - WEEKDAY_GAP,
        y: yTop + row * pitch + cell / 2,
        anchor: 'end',
        cls: 'calendar-weekday',
      });
    }
  });

  const cells: Cell[] = [];
  for (let day = start; day <= end; day++)
    cells.push({
      day,
      x: gridLeft + columnOf(day) * pitch,
      y: bandTop(bandOf(day)) + rowOf(day) * pitch,
    });
  return {
    cells,
    labels,
    cellW: cell,
    cellH: cell,
    pitchX: pitch,
    pitchY: pitch,
    right: gridLeft + gridWidth,
    bottom: bandTop(bands.length - 1) + bandHeight,
    weekend: () => false,
  };
}

/** `layout months`: one strip per month, the day of the month along it. */
function monthsGeometry(
  parsed: ParsedCalendar,
  left0: number,
  top: number,
  exportMode: boolean
): Geometry {
  const { start, end, horizontal } = parsed;
  const months: { year: number; month: number }[] = [];
  const s = parts(start);
  const e = parts(end);
  for (
    let y = s.year, m = s.month;
    y < e.year || (y === e.year && m <= e.month);
  ) {
    months.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  const multiYear = s.year !== e.year;
  const monthName = (k: number): string => {
    const { year, month } = months[k]!;
    const short = MONTHS[month - 1]!.slice(0, 3);
    return multiYear && (k === 0 || month === 1) ? `${short} ${year}` : short;
  };
  const cellW = horizontal ? ROW_TILE : STRIP_TILE_W;
  const cellH = horizontal ? ROW_TILE : STRIP_TILE_H;
  const pitchX = cellW + GAP;
  const pitchY = cellH + GAP;
  const labels: Label[] = [];
  const cells: Cell[] = [];
  const monthKey = (k: number): string =>
    `${months[k]!.year}-${String(months[k]!.month).padStart(2, '0')}`;

  let gridLeft: number;
  let gridTop: number;
  if (horizontal) {
    // Months as rows: names in a left gutter, day numbers along the top.
    const gutter =
      Math.max(
        ...months.map((_, k) => measureText(monthName(k), LABEL_FONT_SIZE))
      ) + WEEKDAY_GAP;
    gridLeft = left0 + gutter;
    gridTop = top + MONTH_BAND;
    for (let d = 1; d <= 31; d++)
      if (LABELLED_DATES.has(d))
        labels.push({
          text: String(d),
          x: gridLeft + (d - 1) * pitchX + cellW / 2,
          y: gridTop - 5,
          anchor: 'middle',
          cls: 'calendar-date-label',
        });
    months.forEach((_, k) =>
      labels.push({
        text: monthName(k),
        x: gridLeft - WEEKDAY_GAP,
        y: gridTop + k * pitchY + cellH / 2,
        anchor: 'end',
        cls: 'calendar-month',
        ...(!exportMode && { month: monthKey(k) }),
      })
    );
  } else {
    // Months as columns: names along the top, day numbers in a left gutter.
    const gutter = measureText('30', LABEL_FONT_SIZE) + WEEKDAY_GAP;
    gridLeft = left0 + gutter;
    gridTop = top + MONTH_BAND;
    months.forEach((_, k) =>
      labels.push({
        text: monthName(k),
        x: gridLeft + k * pitchX + cellW / 2,
        y: gridTop - 5,
        anchor: 'middle',
        cls: 'calendar-month',
        ...(!exportMode && { month: monthKey(k) }),
      })
    );
    for (let d = 1; d <= 31; d++)
      if (LABELLED_DATES.has(d))
        labels.push({
          text: String(d),
          x: gridLeft - WEEKDAY_GAP,
          y: gridTop + (d - 1) * pitchY + cellH / 2,
          anchor: 'end',
          cls: 'calendar-date-label',
        });
  }
  months.forEach(({ year, month }, k) => {
    const n = daysInMonth(year, month);
    for (let d = 1; d <= n; d++) {
      const day = dayNumber(year, month, d)!;
      if (day < start || day > end) continue;
      cells.push(
        horizontal
          ? { day, x: gridLeft + (d - 1) * pitchX, y: gridTop + k * pitchY }
          : { day, x: gridLeft + k * pitchX, y: gridTop + (d - 1) * pitchY }
      );
    }
  });
  // A last month name wider than its column widens the drawing.
  const longest = horizontal
    ? 0
    : Math.max(
        0,
        (measureText(monthName(months.length - 1), LABEL_FONT_SIZE) - cellW) / 2
      );
  const along = horizontal ? 31 : months.length;
  const across = horizontal ? months.length : 31;
  return {
    cells,
    labels,
    cellW,
    cellH,
    pitchX,
    pitchY,
    right: gridLeft + along * pitchX - GAP + longest,
    bottom: gridTop + across * pitchY - GAP,
    weekend: (day) => {
      const wd = weekday(day);
      return wd === 0 || wd === 6;
    },
  };
}

export function renderCalendar(
  container: HTMLElement,
  parsed: ParsedCalendar,
  palette: PaletteColors,
  isDark: boolean,
  options?: CalendarRenderOptions
): void {
  const exportMode = options?.exportMode ?? false;
  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const showNotes = parsed.options['no-notes'] !== 'on';
  const active = resolveCalendarActiveGroup(parsed, options?.activeTagGroup);
  const fillsByTag = tagFills(parsed.tagGroups, palette);

  // ── Colours ────────────────────────────────────────────────
  const outline = isDark
    ? mix(palette.text, palette.bg, 8)
    : mix(palette.text, palette.bg, 6);
  const notLogged = palette.bg;
  const notLoggedStroke = mix(palette.textMuted, palette.bg, 35);
  const weekendZero = mix(palette.textMuted, palette.bg, 26);
  const weekendBlank = mix(palette.textMuted, palette.bg, 9);
  const neutralEvent = mix(palette.textMuted, palette.bg, 70);
  // An events-only chart has no group to colour by: its events take the
  // primary colour.
  const plainEvent =
    parsed.groups.length === 0 ? mix(palette.primary, palette.bg, 75) : null;

  const numberGroup: CalendarNumberGroup | undefined =
    active?.kind === 'number' ? numberGroupOf(parsed, active) : undefined;
  const shades = shadeFills(palette, isDark, numberGroup);
  const level = numberGroup
    ? shadeLevels(
        parsed.days.map((d) => d.numbers[numberGroup.key] ?? 0),
        numberGroup.max
      )
    : () => 0;
  const activeTagFills =
    active?.kind === 'tag' ? fillsByTag.get(active.key) : undefined;
  const eventColor = (tags: Readonly<Record<string, string>>): string | null =>
    activeTagFills && active && tags[active.key] !== undefined
      ? (activeTagFills.get(tags[active.key]!) ?? null)
      : plainEvent;

  // ── Legend: one pill per group ─────────────────────────────
  const showLegend =
    parsed.groups.length > 0 && !legendSuppressed(parsed.options);
  const legendGroups: LegendGroupData[] = parsed.groups.map((ref) =>
    legendGroupFor(ref, parsed, palette, isDark, fillsByTag, notLoggedStroke)
  );

  // ── Geometry ───────────────────────────────────────────────
  const titleWidth = showTitle
    ? measureText(parsed.title, TITLE_FONT_SIZE, { bold: true })
    : 0;
  const legendY = showTitle ? TITLE_Y + LEGEND_TITLE_GAP : DIAGRAM_PADDING;
  // A first pass sizes the grid, so the legend can wrap to its width.
  const probe = geometryFor(parsed, DIAGRAM_PADDING, 0, exportMode);
  const contentWidth = Math.max(probe.right - DIAGRAM_PADDING, titleWidth);
  const legendConfig: LegendConfig = {
    groups: legendGroups,
    position: { placement: 'top-center', titleRelation: 'below-title' },
    mode: exportMode ? 'export' : 'preview',
    showInactivePills: !exportMode,
  };
  const legendHeight = showLegend
    ? getMaxLegendReservedHeight(legendConfig, contentWidth)
    : 0;
  const bodyTop = showLegend
    ? legendY + legendInkBottom(legendHeight) + LEGEND_BODY_GAP - LABEL_INK_TOP
    : showTitle
      ? FRAME_BODY_TOP
      : DIAGRAM_PADDING;
  const geo = geometryFor(parsed, DIAGRAM_PADDING, bodyTop, exportMode);

  const width = Math.ceil(
    DIAGRAM_PADDING +
      Math.max(geo.right - DIAGRAM_PADDING, titleWidth) +
      DIAGRAM_PADDING
  );
  const height = Math.ceil(geo.bottom + DIAGRAM_PADDING);

  container.innerHTML = '';
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('font-family', FONT_FAMILY)
    .attr('data-calendar-layout', parsed.layout)
    .style('background', palette.bg);

  // Fit a narrow container rather than overflow it.
  const containerWidth = container.getBoundingClientRect().width;
  if (containerWidth > 0 && containerWidth < width) {
    svg.attr('width', '100%').attr('height', null);
  }

  if (showTitle) {
    svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('data-line-number', parsed.titleLineNumber ?? 0)
      .attr('x', DIAGRAM_PADDING)
      .attr('y', TITLE_Y)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('fill', palette.text)
      .text(parsed.title);
  }

  if (showLegend) {
    const legendG = svg
      .append('g')
      .attr('class', 'calendar-legend')
      .attr('transform', `translate(${DIAGRAM_PADDING},${legendY})`);
    const onPick = (name: string): void => {
      if (options?.onActiveGroupChange) options.onActiveGroupChange(name);
      else
        renderCalendar(container, parsed, palette, isDark, {
          ...options,
          activeTagGroup: name,
        });
    };
    renderIntegratedLegend(legendG, {
      frame: parsed.frame,
      groups: legendGroups,
      palette,
      isDark,
      width: contentWidth,
      mode: legendConfig.mode,
      position: legendConfig.position,
      activeGroup: active?.name ?? null,
      showInactivePills: !exportMode,
      ...(!exportMode && { callbacks: { onGroupToggle: onPick } }),
    });
  }

  // The open number pill's ramp as five swatches, one per step, so each
  // step can be hovered on its own.
  const ramp = svg
    .node()!
    .querySelector('.calendar-legend .dgmo-legend-gradient-ramp');
  if (ramp && numberGroup) {
    const x = Number(ramp.getAttribute('x'));
    const w = Number(ramp.getAttribute('width')) / 5;
    const parent = d3Selection.select(ramp.parentNode as SVGGElement);
    shades.forEach((fill, lv) => {
      parent
        .append('rect')
        .attr('class', 'calendar-legend-step')
        .attr('data-level', lv)
        .attr('x', x + lv * w)
        .attr('y', ramp.getAttribute('y'))
        .attr('width', w)
        .attr('height', ramp.getAttribute('height'))
        .attr('fill', fill)
        .attr('stroke', outline)
        .attr('stroke-width', 0.5);
    });
  }

  // ── Labels ─────────────────────────────────────────────────
  const labelsG = svg.append('g').attr('class', 'calendar-labels');
  for (const l of geo.labels) {
    const t = labelsG
      .append('text')
      .attr('class', l.cls)
      .attr('x', l.x)
      .attr('y', l.y)
      .attr('text-anchor', l.anchor)
      .attr('font-size', LABEL_FONT_SIZE)
      .attr('fill', l.bold ? palette.text : palette.textMuted)
      .text(l.text);
    if (l.anchor === 'end') t.attr('dominant-baseline', 'central');
    if (l.bold) t.attr('font-weight', 'bold');
    if (l.month) t.attr('data-month', l.month);
  }

  // ── Days ───────────────────────────────────────────────────
  const byDay = new Map(parsed.days.map((d) => [d.day, d]));
  const eventsByDay = new Map<DayNumber, number[]>();
  parsed.events.forEach((e, i) => {
    for (let d = e.start; d <= e.end; d++) {
      const list = eventsByDay.get(d);
      if (list) list.push(i);
      else eventsByDay.set(d, [i]);
    }
  });
  const tooltip = exportMode ? null : createTooltip(container, palette, isDark);
  const tips = new Map<string, string>();
  const dotR = Math.max(1.5, Math.min(geo.cellW, geo.cellH) * 0.18);

  const grid = svg
    .append('g')
    .attr('class', 'calendar-days')
    .attr('role', 'list');
  for (const c of geo.cells) {
    const { day } = c;
    const entry = byDay.get(day);
    const evIdx = eventsByDay.get(day) ?? [];
    const evs = evIdx.map((i) => parsed.events[i]!);
    const weekend = geo.weekend(day);

    let fill: string;
    let stroke = outline;
    let shade: number | null = null;
    let tag: string | undefined;
    let fromEvent = -1;
    if (numberGroup) {
      const v = entry?.numbers[numberGroup.key] ?? 0;
      shade = level(v);
      fill = shade === 0 && weekend ? weekendZero : shades[shade]!;
    } else if (active?.kind === 'tag') {
      tag = entry?.tags[active.key];
      fill = tag !== undefined ? (activeTagFills?.get(tag) ?? notLogged) : '';
      if (!fill) {
        fromEvent = evs.findIndex((e) => e.tags[active.key] !== undefined);
        const ec = fromEvent >= 0 ? eventColor(evs[fromEvent]!.tags) : null;
        if (ec) {
          fill = ec;
          tag = evs[fromEvent]!.tags[active.key];
        } else {
          fromEvent = -1;
          fill = weekend ? weekendBlank : notLogged;
          stroke = notLoggedStroke;
        }
      }
    } else {
      fromEvent = plainEvent && evs.length > 0 ? 0 : -1;
      fill = fromEvent === 0 ? plainEvent! : weekend ? weekendBlank : notLogged;
      if (fromEvent < 0) stroke = notLoggedStroke;
    }

    const shownValue = numberGroup
      ? amount(entry?.numbers[numberGroup.key] ?? 0, numberGroup.unit)
      : active?.kind === 'tag'
        ? (tag ?? parsed.emptyLabel)
        : evs.length > 0
          ? evs.map((e) => e.name).join(', ')
          : 'No entry';
    const rect = grid
      .append('rect')
      .attr('class', 'calendar-day')
      .attr('data-date', dayToIso(day))
      .attr(
        'data-value',
        numberGroup ? (entry?.numbers[numberGroup.key] ?? 0) : null
      )
      .attr('data-level', shade)
      .attr('data-tag', tag ?? null)
      .attr('data-events', evs.length || null)
      .attr('data-weekend', weekend ? '' : null)
      .attr('x', c.x)
      .attr('y', c.y)
      .attr('width', geo.cellW)
      .attr('height', geo.cellH)
      .attr('rx', CELL_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', 0.5)
      .attr('role', 'listitem')
      .attr('aria-label', `${fullDate(day)}: ${shownValue}`);
    for (const g of parsed.tagGroups) {
      const k = tagAttrKey(g.name);
      const v = entry?.tags[k] ?? evs.find((e) => e.tags[k])?.tags[k];
      if (v !== undefined) rect.attr(`data-tag-${k}`, v.toLowerCase());
    }
    const line = entry?.lineNumber ?? evs[0]?.lineNumber;
    if (line !== undefined) rect.attr('data-line-number', line);

    // The event the fill does not show takes the corner dot.
    const dotted = evs.find((_, i) => i !== fromEvent);
    if (dotted) {
      grid
        .append('circle')
        .attr('class', 'calendar-event-dot')
        .attr('data-date', dayToIso(day))
        .attr('cx', c.x + geo.cellW - dotR - 1.5)
        .attr('cy', c.y + dotR + 1.5)
        .attr('r', dotR)
        .attr('fill', eventColor(dotted.tags) ?? neutralEvent)
        .attr('stroke', palette.bg)
        .attr('stroke-width', 0.5)
        .attr('pointer-events', 'none');
    }

    if (!tooltip) continue;
    const tipHtml = dayCard(parsed, day, entry, evs, shownValue, showNotes);
    tips.set(dayToIso(day), tipHtml);
    rect
      .attr('tabindex', 0)
      .on('mouseenter', (event: MouseEvent) =>
        showTooltip(tooltip, tipHtml, event)
      )
      .on('mousemove', (event: MouseEvent) =>
        showTooltip(tooltip, tipHtml, event)
      )
      .on('mouseleave', () => hideTooltip(tooltip))
      .on('focus', function (this: SVGRectElement) {
        showAt(tooltip, this, tipHtml);
      })
      .on('blur', () => hideTooltip(tooltip));
  }

  // The summary rides the shared subtitle line unless the author wrote one.
  let frame: ChartFrame | undefined = parsed.frame;
  if (!frame?.subtitle && parsed.options['no-summary'] !== 'on') {
    const summary = calendarSummary(parsed, active);
    if (summary) frame = { ...frame, subtitle: summary };
  }
  growChartFrame(svg.node(), frame, palette, { size: 'grow' });

  if (tooltip) {
    attachKeyboard(
      svg.node()!,
      geo,
      (el, html) => showAt(tooltip, el, html),
      tips
    );
    attachSpanHovers(svg.node()!, {
      geo,
      color: palette.text,
      busiest:
        frame === parsed.frame || !numberGroup
          ? null
          : busiestDay(parsed, numberGroup.key),
      showTip: (el, html) => showAt(tooltip, el, html),
      hideTip: () => hideTooltip(tooltip),
      tips,
      active,
      emptyLabel: parsed.emptyLabel,
    });
  }
}

function geometryFor(
  parsed: ParsedCalendar,
  left: number,
  top: number,
  exportMode: boolean
): Geometry {
  // TODO(phase 2): layout month — the wall calendar (#1876) draws here; until
  // it lands, `layout month` draws as `layout months`.
  return parsed.layout === 'weeks'
    ? weeksGeometry(parsed, left, top, exportMode)
    : monthsGeometry(parsed, left, top, exportMode);
}

function showAt(
  tooltip: ReturnType<typeof createTooltip>,
  el: Element,
  html: string
): void {
  const r = el.getBoundingClientRect();
  showTooltip(tooltip, html, {
    clientX: r.right,
    clientY: r.top,
  } as MouseEvent);
}

/** The day card: the open group's value, the date, then every other mark
 *  and each event with its notes. */
function dayCard(
  parsed: ParsedCalendar,
  day: DayNumber,
  entry: ParsedCalendar['days'][number] | undefined,
  evs: ParsedCalendar['events'][number][],
  shown: string,
  showNotes: boolean
): string {
  const rows: string[] = [
    `<strong>${escapeHtml(shown)}</strong><br>${escapeHtml(fullDate(day))}`,
  ];
  if (parsed.groups.length > 1 && entry) {
    for (const g of parsed.numberGroups) {
      const v = entry.numbers[g.key];
      if (v !== undefined)
        rows.push(`${escapeHtml(g.name)}: ${escapeHtml(amount(v, g.unit))}`);
    }
    for (const g of parsed.tagGroups) {
      const v = entry.tags[tagAttrKey(g.name)];
      if (v !== undefined) rows.push(`${escapeHtml(g.name)}: ${escapeHtml(v)}`);
    }
  }
  for (const e of evs) {
    rows.push(`<strong>${escapeHtml(e.name)}</strong>`);
    if (showNotes)
      for (const n of e.notes) rows.push(escapeHtml(stripInlineMarkdown(n)));
  }
  return rows.join('<br>');
}

/** The legend data for one group: a tag group's values plus the blank-day
 *  label, or a number group's five steps as Less … More. */
function legendGroupFor(
  ref: CalendarGroupRef,
  parsed: ParsedCalendar,
  palette: PaletteColors,
  isDark: boolean,
  fillsByTag: Map<string, Map<string, string>>,
  blank: string
): LegendGroupData {
  if (ref.kind === 'tag') {
    const fills = fillsByTag.get(ref.key) ?? new Map<string, string>();
    return {
      name: ref.name,
      entries: [
        ...[...fills].map(([value, color]) => ({ value, color })),
        { value: parsed.emptyLabel, color: blank },
      ],
    };
  }
  const group = parsed.numberGroups.find((g) => g.key === ref.key);
  const f = shadeFills(palette, isDark, group);
  const top = Math.max(
    group?.max ?? 0,
    ...parsed.days.map((d) => d.numbers[ref.key] ?? 0)
  );
  return {
    name: ref.name,
    entries: [],
    gradient: {
      min: 0,
      max: top,
      low: f[0]!,
      high: f[4]!,
      // Hard stops: five steps, not a fade.
      stops: f.flatMap((color, i) => [
        { offset: i / 5, color },
        { offset: (i + 1) / 5, color },
      ]),
      minLabel: 'Less',
      maxLabel: 'More',
    },
  };
}

/** Days outside a hovered span fade to this, the same as a series chart's
 *  legend hover (`.dgmo-dim` in `charts-d3/interactions.ts`). */
const HOVER_DIM_OPACITY = 0.18;
const HOVER_FADE = 'opacity .12s ease';
/** The faint outline traced around a hovered span (#2091). */
const SPAN_OUTLINE_OPACITY = 0.45;
const SPAN_OUTLINE_WIDTH = 1.25;

/**
 * Arrow keys move across the grid; Enter shows the focused day's card.
 * Tab still walks the days in date order.
 */
function attachKeyboard(
  svg: SVGSVGElement,
  geo: Geometry,
  show: (el: Element, html: string) => void,
  tips: Map<string, string>
): void {
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  const at = new Map<string, SVGRectElement>();
  for (const r of svg.querySelectorAll<SVGRectElement>('.calendar-day'))
    at.set(key(Number(r.getAttribute('x')), Number(r.getAttribute('y'))), r);
  for (const r of at.values()) {
    r.addEventListener('keydown', (ev: KeyboardEvent) => {
      const x = Number(r.getAttribute('x'));
      const y = Number(r.getAttribute('y'));
      const step: Record<string, [number, number]> = {
        ArrowLeft: [-geo.pitchX, 0],
        ArrowRight: [geo.pitchX, 0],
        ArrowUp: [0, -geo.pitchY],
        ArrowDown: [0, geo.pitchY],
      };
      if (ev.key === 'Enter') {
        show(r, tips.get(r.getAttribute('data-date')!) ?? '');
        ev.preventDefault();
        return;
      }
      const d = step[ev.key];
      if (!d) return;
      const next = at.get(key(x + d[0], y + d[1]));
      if (next) {
        next.focus();
        ev.preventDefault();
      }
    });
  }
}

/**
 * Hovers that find days (#2090, #2091): a month name dims every other day
 * and outlines the month; a legend step or value dims days at other steps or
 * values; the summary's "busiest day" rings that day and shows its value.
 * Focus does what hover does. Interactive renders only.
 */
function attachSpanHovers(
  svg: SVGSVGElement,
  o: {
    geo: Geometry;
    color: string;
    busiest: { day: DayNumber; phrase: string } | null;
    showTip: (el: Element, html: string) => void;
    hideTip: () => void;
    tips: Map<string, string>;
    active: CalendarGroupRef | null;
    emptyLabel: string;
  }
): void {
  const days = [...svg.querySelectorAll<SVGRectElement>('.calendar-day')];
  for (const d of days) d.style.transition = HOVER_FADE;
  // Inside the days group: the frame shifts the body below the title and
  // summary, so a path on the root would sit that far above the squares.
  const span = d3Selection
    .select(svg.querySelector<SVGGElement>('.calendar-days')!)
    .append('path')
    .attr('class', 'calendar-span')
    .attr('fill', 'none')
    .attr('stroke', o.color)
    .attr('stroke-opacity', SPAN_OUTLINE_OPACITY)
    .attr('stroke-width', SPAN_OUTLINE_WIDTH)
    .attr('pointer-events', 'none')
    .attr('d', '');
  const focus = (keep: (d: SVGRectElement) => boolean, outline: boolean) => {
    const kept: SVGRectElement[] = [];
    for (const d of days) {
      const k = keep(d);
      d.style.opacity = k ? '' : String(HOVER_DIM_OPACITY);
      if (k) kept.push(d);
    }
    span.attr('d', outline ? spanOutline(kept, o.geo) : '');
  };
  const clear = () => {
    for (const d of days) d.style.opacity = '';
    span.attr('d', '');
    o.hideTip();
  };
  const bind = (el: Element, on: () => void) => {
    el.setAttribute('tabindex', '0');
    (el as SVGElement).style.cursor = 'pointer';
    el.addEventListener('mouseenter', on);
    el.addEventListener('focus', on);
    el.addEventListener('mouseleave', clear);
    el.addEventListener('blur', clear);
  };
  for (const label of svg.querySelectorAll('.calendar-month')) {
    const month = label.getAttribute('data-month');
    if (month)
      bind(label, () =>
        focus((d) => d.getAttribute('data-date')!.startsWith(month), true)
      );
  }

  // Number pill: each step of the Less … More ramp finds its days.
  for (const step of svg.querySelectorAll('.calendar-legend-step')) {
    const lv = step.getAttribute('data-level');
    bind(step, () => focus((d) => d.getAttribute('data-level') === lv, false));
  }
  // Tag pill: each value finds its days; the blank label finds the blanks.
  if (o.active?.kind === 'tag')
    for (const entry of svg.querySelectorAll(
      '.calendar-legend [data-legend-entry]'
    )) {
      const value = entry.getAttribute('data-series-name') ?? '';
      const blank = value === o.emptyLabel;
      bind(entry, () =>
        focus(
          (d) =>
            blank
              ? !d.hasAttribute('data-tag')
              : d.getAttribute('data-tag') === value,
          false
        )
      );
    }

  if (!o.busiest) return;
  const iso = dayToIso(o.busiest.day);
  const best = days.find((d) => d.getAttribute('data-date') === iso);
  const subtitle = svg.querySelector('.chart-subtitle');
  const text = subtitle?.textContent ?? '';
  const at = text.indexOf(o.busiest.phrase);
  // Only a one-line summary is split; a wrapped one keeps its tspans.
  if (!best || !subtitle || at < 0 || subtitle.children.length) return;
  const doc = svg.ownerDocument;
  const phrase = doc.createElementNS(svg.namespaceURI, 'tspan');
  phrase.setAttribute('class', 'calendar-busiest');
  phrase.textContent = o.busiest.phrase;
  subtitle.textContent = text.slice(0, at);
  subtitle.appendChild(phrase);
  const rest = text.slice(at + o.busiest.phrase.length);
  if (rest) subtitle.appendChild(doc.createTextNode(rest));
  bind(phrase, () => {
    focus((d) => d === best, true);
    o.showTip(best, o.tips.get(iso) ?? '');
  });
}

/** The outer edge of a set of tiles: every side whose neighbour one pitch
 *  away is not in the set, drawn half a gap outside the tile. */
function spanOutline(cells: Element[], geo: Geometry): string {
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  const at = cells.map((c) => [
    Number(c.getAttribute('x')),
    Number(c.getAttribute('y')),
  ]);
  const set = new Set(at.map(([x, y]) => key(x!, y!)));
  const half = GAP / 2;
  const path: string[] = [];
  for (const [x, y] of at) {
    const l = x! - half;
    const r = x! + geo.cellW + half;
    const t = y! - half;
    const b = y! + geo.cellH + half;
    if (!set.has(key(x!, y! - geo.pitchY))) path.push(`M${l},${t}H${r}`);
    if (!set.has(key(x!, y! + geo.pitchY))) path.push(`M${l},${b}H${r}`);
    if (!set.has(key(x! - geo.pitchX, y!))) path.push(`M${l},${t}V${b}`);
    if (!set.has(key(x! + geo.pitchX, y!))) path.push(`M${r},${t}V${b}`);
  }
  return path.join('');
}
