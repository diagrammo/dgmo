// ============================================================
// Calendar heatmap renderer — weeks across, weekdays down (#1855)
// ============================================================
//
// One column per week and seven weekday rows; week one holds the span's first
// day. Month names sit above the first week of each month, weekday labels show
// Mon, Wed and Fri only. Five shades: grey for zero, then four equal-count
// bands (quartiles of the non-zero days), or four equal ranges up to `max N`.
// A day's fill encodes data, so the `fill-*` family does not apply.
// Tag mode (#1877) colours each day by its tag value instead, and the legend
// lists the values and "Not logged".

import * as d3Selection from 'd3-selection';
import { resolveColor } from '../colors';
import { escapeHtml } from '../embed/escape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { mix } from '../palettes/color-utils';
import { growChartFrame } from '../utils/chart-frame';
import type { ChartFrame } from '../utils/chart-frame-parse';
import { createTooltip, hideTooltip, showTooltip } from '../utils/d3-helpers';
import { legendSuppressed } from '../utils/parsing';
import type { Writable } from '../utils/brand';
import {
  AUTO_TAG_COLOR_SENTINEL,
  assignAutoTagColors,
} from '../utils/tag-groups';
import type { TagGroup } from '../utils/tag-groups';
import { measureText } from '../utils/text-measure';
import {
  FRAME_BODY_TOP,
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import {
  amount,
  busiestDay,
  calendarSummary,
  fullDate,
  LABELLED_WEEKDAYS,
  MONTHS,
  parts,
  shadeLevels,
  weekday,
  WEEKDAYS,
} from './format';
import { dayToIso } from './parser';
import type { DayNumber, ParsedCalendarHeatmap } from './types';

export interface CalendarHeatmapRenderOptions {
  exportMode?: boolean;
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
const LEGEND_TOP_GAP = 12;
const LEGEND_CELL = 11;
const LEGEND_TEXT_GAP = 5;
const LEGEND_ITEM_GAP = 14;
const LEGEND_ROW_GAP = 6;
const NOT_LOGGED = 'Not logged';

/** Each tag value's fill in this palette, keyed by the value. The parser has
 *  no palette, so colours resolve here: an authored name re-resolves, and a
 *  bare value takes the next free categorical colour. */
function tagFills(
  groups: readonly TagGroup[],
  palette: PaletteColors
): Map<string, string> {
  const fills = new Map<string, string>();
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
    for (const e of copy.entries)
      if (!fills.has(e.value)) fills.set(e.value, e.color);
  }
  return fills;
}

/** The five fills, zero first. */
function shadeFills(palette: PaletteColors): string[] {
  const hue = palette.colors.green;
  return [
    mix(palette.textMuted, palette.bg, 16),
    mix(hue, palette.bg, 30),
    mix(hue, palette.bg, 55),
    mix(hue, palette.bg, 80),
    hue,
  ];
}

export function renderCalendarHeatmap(
  container: HTMLElement,
  parsed: ParsedCalendarHeatmap,
  palette: PaletteColors,
  isDark: boolean,
  options?: CalendarHeatmapRenderOptions
): void {
  const exportMode = options?.exportMode ?? false;
  const showTitle = !!parsed.title && parsed.options['no-title'] !== 'on';
  const showLegend = !legendSuppressed(parsed.options);
  const tagMode = parsed.mode === 'tag';
  const tagFill = tagMode ? tagFills(parsed.tagGroups, palette) : null;

  const { start, end, weekStart } = parsed;
  // Past one year of weeks the grid wraps into one band per calendar year,
  // stacked, so width stays about a year wide whatever the span (#2089).
  // Otherwise type shrinks with the canvas when it is fitted to a pane.
  const spanWeeks =
    Math.floor((end - start + ((weekday(start) - weekStart + 7) % 7)) / 7) + 1;
  const bands: { year: number; first: DayNumber; last: DayNumber }[] = [];
  if (spanWeeks <= 53) {
    bands.push({ year: parts(start).year, first: start, last: end });
  } else {
    for (let y = parts(start).year; y <= parts(end).year; y++) {
      bands.push({
        year: y,
        first: Math.max(start, Math.round(Date.UTC(y, 0, 1) / 86_400_000)),
        last: Math.min(end, Math.round(Date.UTC(y, 11, 31) / 86_400_000)),
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
  const gridLeft =
    DIAGRAM_PADDING + Math.max(weekdayLabelWidth, yearLabelWidth);
  const gridWidth = weeks * pitch - GAP;
  const top = showTitle ? FRAME_BODY_TOP : DIAGRAM_PADDING;
  const gridTop = top + MONTH_BAND;
  const bandHeight = 7 * pitch - GAP;
  const bandPitch = bandHeight + MONTH_BAND + BAND_GAP;
  const bandTop = (i: number): number => gridTop + i * bandPitch;
  const gridHeight = bandTop(bands.length - 1) - gridTop + bandHeight;
  const legendTop = gridTop + gridHeight + LEGEND_TOP_GAP;

  // Tag mode: one swatch per value, then "Not logged", wrapped to the grid.
  const tagLegend: { label: string; fill?: string; x: number; row: number }[] =
    [];
  let tagLegendWidth = 0;
  if (tagMode && showLegend) {
    const items: { label: string; fill?: string }[] = [];
    for (const [label, fill] of tagFill!) items.push({ label, fill });
    items.push({ label: NOT_LOGGED });
    let x = 0;
    let row = 0;
    for (const item of items) {
      const w =
        LEGEND_CELL +
        LEGEND_TEXT_GAP +
        measureText(item.label, LABEL_FONT_SIZE);
      if (x > 0 && x + w > gridWidth) {
        x = 0;
        row++;
      }
      tagLegend.push({ ...item, x, row });
      tagLegendWidth = Math.max(tagLegendWidth, x + w);
      x += w + LEGEND_ITEM_GAP;
    }
  }
  const legendRows = tagLegend.length
    ? tagLegend[tagLegend.length - 1]!.row + 1
    : 1;
  const legendHeight =
    legendRows * LEGEND_CELL + (legendRows - 1) * LEGEND_ROW_GAP;
  const bottom = showLegend ? legendTop + legendHeight : gridTop + gridHeight;

  const titleWidth = showTitle
    ? measureText(parsed.title, TITLE_FONT_SIZE, { bold: true })
    : 0;
  const width = Math.ceil(
    DIAGRAM_PADDING +
      Math.max(
        gridLeft - DIAGRAM_PADDING + Math.max(gridWidth, tagLegendWidth),
        titleWidth
      ) +
      DIAGRAM_PADDING
  );
  const height = Math.ceil(bottom + DIAGRAM_PADDING);

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

  // ── Month and weekday labels ───────────────────────────────
  const labels = svg.append('g').attr('class', 'calendar-heatmap-labels');
  bands.forEach((band, bi) => {
    const yTop = bandTop(bi);
    if (stacked) {
      labels
        .append('text')
        .attr('class', 'calendar-heatmap-year')
        .attr('x', DIAGRAM_PADDING)
        .attr('y', yTop - 5)
        .attr('font-size', LABEL_FONT_SIZE)
        .attr('font-weight', 'bold')
        .attr('fill', palette.text)
        .text(String(band.year));
    }
    let lastMonthRight = -Infinity;
    for (let day = band.first; day <= band.last; ) {
      const p = parts(day);
      const x = gridLeft + columnOf(day) * pitch;
      const name = MONTHS[p.month - 1]!.slice(0, 3);
      if (x >= lastMonthRight + MONTH_LABEL_GAP) {
        labels
          .append('text')
          .attr('class', 'calendar-heatmap-month')
          .attr('data-month', exportMode ? null : dayToIso(day).slice(0, 7))
          .attr('x', x)
          .attr('y', yTop - 5)
          .attr('font-size', LABEL_FONT_SIZE)
          .attr('fill', palette.textMuted)
          .text(name);
        lastMonthRight = x + measureText(name, LABEL_FONT_SIZE);
      }
      // First day of the next month.
      const next = Date.UTC(p.year, p.month, 1) / 86_400_000;
      day = Math.round(next);
    }
    for (let row = 0; row < 7; row++) {
      const wd = (row + weekStart) % 7;
      if (!LABELLED_WEEKDAYS.has(wd)) continue;
      labels
        .append('text')
        .attr('class', 'calendar-heatmap-weekday')
        .attr('x', gridLeft - WEEKDAY_GAP)
        .attr('y', yTop + row * pitch + cell / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'central')
        .attr('font-size', LABEL_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .text(WEEKDAYS[wd]!.slice(0, 3));
    }
  });

  // ── Days ───────────────────────────────────────────────────
  const byDay = new Map(parsed.days.map((d) => [d.day, d]));
  const level = shadeLevels(
    parsed.days.map((d) => d.value),
    parsed.max
  );
  const fills = shadeFills(palette);
  // Tag mode draws a day with no entry as an empty cell, not the zero grey, so a
  // tag coloured `gray` still reads apart from "Not logged".
  const notLogged = palette.bg;
  const notLoggedStroke = mix(palette.textMuted, palette.bg, 35);
  const outline = isDark
    ? mix(palette.text, palette.bg, 8)
    : mix(palette.text, palette.bg, 6);
  const tooltip = exportMode ? null : createTooltip(container, palette, isDark);
  const tips = new Map<string, string>();

  const grid = svg
    .append('g')
    .attr('class', 'calendar-heatmap-days')
    .attr('role', 'list');
  for (let day = start; day <= end; day++) {
    const entry = byDay.get(day);
    const value = entry?.value ?? 0;
    const tag = tagMode ? entry?.tag : undefined;
    const shade = tagMode ? (tag === undefined ? 0 : -1) : level(value);
    const fill =
      tag !== undefined
        ? (tagFill!.get(tag) ?? notLogged)
        : tagMode
          ? notLogged
          : fills[shade]!;
    const shown = tagMode ? (tag ?? NOT_LOGGED) : amount(value, parsed.unit);
    const label = `${fullDate(day)}: ${shown}`;
    const rect = grid
      .append('rect')
      .attr('class', 'calendar-heatmap-day')
      .attr('data-date', dayToIso(day))
      .attr('data-value', value)
      .attr('data-level', shade < 0 ? null : shade)
      .attr('data-tag', tag ?? null)
      .attr('x', gridLeft + columnOf(day) * pitch)
      .attr('y', bandTop(bandOf(day)) + rowOf(day) * pitch)
      .attr('width', cell)
      .attr('height', cell)
      .attr('rx', CELL_RADIUS)
      .attr('fill', fill)
      .attr('stroke', tagMode && tag === undefined ? notLoggedStroke : outline)
      .attr('stroke-width', 0.5)
      .attr('role', 'listitem')
      .attr('aria-label', label);
    if (entry) rect.attr('data-line-number', entry.lineNumber);
    if (!tooltip) continue;
    const tipHtml = `<strong>${escapeHtml(shown)}</strong><br>${escapeHtml(fullDate(day))}`;
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
        const r = this.getBoundingClientRect();
        showTooltip(tooltip, tipHtml, {
          clientX: r.right,
          clientY: r.top,
        } as MouseEvent);
      })
      .on('blur', () => hideTooltip(tooltip));
  }

  // ── Tag legend: one swatch per value, then "Not logged" ────
  if (showLegend && tagMode) {
    const legend = svg.append('g').attr('class', 'calendar-heatmap-legend');
    for (const item of tagLegend) {
      const y = legendTop + item.row * (LEGEND_CELL + LEGEND_ROW_GAP);
      const g = legend
        .append('g')
        .attr('class', 'calendar-heatmap-legend-tag')
        .attr('data-tag', item.fill ? item.label : null);
      g.append('rect')
        .attr('x', gridLeft + item.x)
        .attr('y', y)
        .attr('width', LEGEND_CELL)
        .attr('height', LEGEND_CELL)
        .attr('rx', CELL_RADIUS)
        .attr('fill', item.fill ?? notLogged)
        .attr('stroke', item.fill ? outline : notLoggedStroke)
        .attr('stroke-width', 0.5);
      g.append('text')
        .attr('x', gridLeft + item.x + LEGEND_CELL + LEGEND_TEXT_GAP)
        .attr('y', y + LEGEND_CELL / 2)
        .attr('dominant-baseline', 'central')
        .attr('font-size', LABEL_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .text(item.label);
    }
  }

  // ── Legend: Less ▢▢▢▢▢ More, bottom right ──────────────────
  if (showLegend && !tagMode) {
    const legend = svg.append('g').attr('class', 'calendar-heatmap-legend');
    const moreWidth = measureText('More', LABEL_FONT_SIZE);
    const lessWidth = measureText('Less', LABEL_FONT_SIZE);
    const right = gridLeft + gridWidth;
    const squaresLeft =
      right - moreWidth - LEGEND_TEXT_GAP - 5 * (LEGEND_CELL + GAP) + GAP;
    const mid = legendTop + LEGEND_CELL / 2;
    legend
      .append('text')
      .attr('x', squaresLeft - LEGEND_TEXT_GAP - lessWidth)
      .attr('y', mid)
      .attr('dominant-baseline', 'central')
      .attr('font-size', LABEL_FONT_SIZE)
      .attr('fill', palette.textMuted)
      .text('Less');
    fills.forEach((fill, i) => {
      legend
        .append('rect')
        .attr('class', 'calendar-heatmap-legend-step')
        .attr('data-level', i)
        .attr('x', squaresLeft + i * (LEGEND_CELL + GAP))
        .attr('y', legendTop)
        .attr('width', LEGEND_CELL)
        .attr('height', LEGEND_CELL)
        .attr('rx', CELL_RADIUS)
        .attr('fill', fill)
        .attr('stroke', outline)
        .attr('stroke-width', 0.5);
    });
    legend
      .append('text')
      .attr('x', right - moreWidth)
      .attr('y', mid)
      .attr('dominant-baseline', 'central')
      .attr('font-size', LABEL_FONT_SIZE)
      .attr('fill', palette.textMuted)
      .text('More');
  }

  // The summary rides the shared subtitle line unless the author wrote one.
  let frame: ChartFrame | undefined = parsed.frame;
  if (!frame?.subtitle && parsed.options['no-summary'] !== 'on') {
    const summary = calendarSummary(parsed);
    if (summary) frame = { ...frame, subtitle: summary };
  }
  growChartFrame(svg.node(), frame, palette, { size: 'grow' });

  if (tooltip)
    attachSpanHovers(svg.node()!, {
      pitch,
      color: palette.text,
      busiest: frame === parsed.frame ? null : busiestDay(parsed),
      showTip: (el, html) => {
        const r = el.getBoundingClientRect();
        showTooltip(tooltip, html, {
          clientX: r.right,
          clientY: r.top,
        } as MouseEvent);
      },
      hideTip: () => hideTooltip(tooltip),
      tips,
    });
}

/** Days outside a hovered span fade to this, the same as a series chart's
 *  legend hover (`.dgmo-dim` in `charts-d3/interactions.ts`). */
const HOVER_DIM_OPACITY = 0.18;
const HOVER_FADE = 'opacity .12s ease';
/** The faint outline traced around a hovered span (#2091). */
const SPAN_OUTLINE_OPACITY = 0.45;
const SPAN_OUTLINE_WIDTH = 1.25;

/**
 * Hovers that find days (#2090, #2091): a month name dims every other day and
 * outlines the month's ragged block; a legend shade dims days at other
 * shades; the summary's "busiest day" rings that day and shows its value.
 * Focus does what hover does. Interactive renders only.
 */
function attachSpanHovers(
  svg: SVGSVGElement,
  o: {
    pitch: number;
    color: string;
    busiest: { day: DayNumber; phrase: string } | null;
    showTip: (el: Element, html: string) => void;
    hideTip: () => void;
    tips: Map<string, string>;
  }
): void {
  const days = [
    ...svg.querySelectorAll<SVGRectElement>('.calendar-heatmap-day'),
  ];
  for (const d of days) d.style.transition = HOVER_FADE;
  // Inside the days group: the frame shifts the body below the title and
  // summary, so a path on the root would sit that far above the squares.
  const span = d3Selection
    .select(svg.querySelector<SVGGElement>('.calendar-heatmap-days')!)
    .append('path')
    .attr('class', 'calendar-heatmap-span')
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
    span.attr('d', outline ? spanOutline(kept, o.pitch) : '');
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
  for (const label of svg.querySelectorAll('.calendar-heatmap-month')) {
    const month = label.getAttribute('data-month');
    if (month)
      bind(label, () =>
        focus((d) => d.getAttribute('data-date')!.startsWith(month), true)
      );
  }
  for (const step of svg.querySelectorAll('.calendar-heatmap-legend-step')) {
    const lv = step.getAttribute('data-level');
    bind(step, () => focus((d) => d.getAttribute('data-level') === lv, false));
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
  phrase.setAttribute('class', 'calendar-heatmap-busiest');
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

/** The outer edge of a set of grid squares: every side whose neighbour one
 *  pitch away is not in the set, drawn half a gap outside the square. */
function spanOutline(cells: Element[], pitch: number): string {
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  const at = cells.map((c) => [
    Number(c.getAttribute('x')),
    Number(c.getAttribute('y')),
  ]);
  const set = new Set(at.map(([x, y]) => key(x!, y!)));
  const half = GAP / 2;
  const size = pitch - GAP;
  const path: string[] = [];
  for (const [x, y] of at) {
    const l = x! - half;
    const r = x! + size + half;
    const t = y! - half;
    const b = y! + size + half;
    if (!set.has(key(x!, y! - pitch))) path.push(`M${l},${t}H${r}`);
    if (!set.has(key(x!, y! + pitch))) path.push(`M${l},${b}H${r}`);
    if (!set.has(key(x! - pitch, y!))) path.push(`M${l},${t}V${b}`);
    if (!set.has(key(x! + pitch, y!))) path.push(`M${r},${t}V${b}`);
  }
  return path.join('');
}
