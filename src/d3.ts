import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import * as d3Array from 'd3-array';
import cloud from 'd3-cloud';
import { FONT_FAMILY } from './fonts';
import { injectBranding } from './branding';

// ============================================================
// Types
// ============================================================

export type VisualizationType =
  | 'slope'
  | 'wordcloud'
  | 'arc'
  | 'timeline'
  | 'venn'
  | 'quadrant'
  | 'sequence';

export interface D3DataItem {
  label: string;
  values: number[];
  color: string | null;
  lineNumber: number;
}

export interface WordCloudWord {
  text: string;
  weight: number;
  lineNumber: number;
}

export type WordCloudRotate = 'none' | 'mixed' | 'angled';

export interface WordCloudOptions {
  rotate: WordCloudRotate;
  max: number;
  minSize: number;
  maxSize: number;
}

const DEFAULT_CLOUD_OPTIONS: WordCloudOptions = {
  rotate: 'none',
  max: 0,
  minSize: 14,
  maxSize: 80,
};

export interface ArcLink {
  source: string;
  target: string;
  value: number;
  color: string | null;
  lineNumber: number;
}

export type ArcOrder = 'appearance' | 'name' | 'group' | 'degree';

export interface ArcNodeGroup {
  name: string;
  nodes: string[];
  color: string | null;
  lineNumber: number;
}

export type TimelineSort = 'time' | 'group' | 'tag';

export interface TimelineEvent {
  date: string;
  endDate: string | null;
  label: string;
  group: string | null;
  metadata: Record<string, string>;
  lineNumber: number;
  uncertain?: boolean;
}

export interface TimelineGroup {
  name: string;
  color: string | null;
  lineNumber: number;
}

export interface TimelineEra {
  startDate: string;
  endDate: string;
  label: string;
  color: string | null;
  lineNumber: number;
}

export interface TimelineMarker {
  date: string;
  label: string;
  color: string | null;
  lineNumber: number;
}

export interface VennSet {
  name: string;
  alias: string | null;
  color: string | null;
  lineNumber: number;
}

export interface VennOverlap {
  sets: string[];
  label: string | null;
  lineNumber: number;
}

export interface QuadrantLabel {
  text: string;
  color: string | null;
  lineNumber: number;
}

export interface QuadrantPoint {
  label: string;
  x: number;
  y: number;
  lineNumber: number;
}

export interface QuadrantLabels {
  topRight: QuadrantLabel | null;
  topLeft: QuadrantLabel | null;
  bottomLeft: QuadrantLabel | null;
  bottomRight: QuadrantLabel | null;
}

/** Optional explicit dimensions for CLI/export rendering (bypasses DOM layout). */
export interface D3ExportDimensions {
  width?: number;
  height?: number;
}

export interface ParsedVisualization {
  type: VisualizationType | null;
  title: string | null;
  titleLineNumber: number | null;
  orientation: 'horizontal' | 'vertical';
  periods: string[];
  data: D3DataItem[];
  words: WordCloudWord[];
  cloudOptions: WordCloudOptions;
  links: ArcLink[];
  arcOrder: ArcOrder;
  arcNodeGroups: ArcNodeGroup[];
  timelineEvents: TimelineEvent[];
  timelineGroups: TimelineGroup[];
  timelineEras: TimelineEra[];
  timelineMarkers: TimelineMarker[];
  timelineTagGroups: TagGroup[];
  timelineSort: TimelineSort;
  timelineDefaultSwimlaneTG?: string;
  timelineScale: boolean;
  timelineSwimlanes: boolean;
  vennSets: VennSet[];
  vennOverlaps: VennOverlap[];
  // Quadrant chart fields
  quadrantLabels: QuadrantLabels;
  quadrantPoints: QuadrantPoint[];
  quadrantXAxis: [string, string] | null;
  quadrantXAxisLineNumber: number | null;
  quadrantYAxis: [string, string] | null;
  quadrantYAxisLineNumber: number | null;
  quadrantTitleLineNumber: number | null;
  diagnostics: DgmoError[];
  error: string | null;
}

// ============================================================
// Color Imports
// ============================================================

import { resolveColor } from './colors';
import type { PaletteColors } from './palettes';
import { getSeriesColors } from './palettes';
import { mix } from './palettes/color-utils';
import type { DgmoError } from './diagnostics';
import { makeDgmoError, formatDgmoError, suggest } from './diagnostics';
import {
  collectIndentedValues,
  extractColor,
  parseFirstLine,
  parsePipeMetadata,
  MULTIPLE_PIPE_ERROR,
} from './utils/parsing';
import {
  matchTagBlockHeading,
  validateTagValues,
  resolveTagColor,
} from './utils/tag-groups';
import type { TagGroup } from './utils/tag-groups';
import {
  LEGEND_HEIGHT as TL_LEGEND_HEIGHT,
  LEGEND_PILL_PAD as TL_LEGEND_PILL_PAD,
  LEGEND_PILL_FONT_SIZE as TL_LEGEND_PILL_FONT_SIZE,
  LEGEND_CAPSULE_PAD as TL_LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R as TL_LEGEND_DOT_R,
  LEGEND_ENTRY_FONT_SIZE as TL_LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_DOT_GAP as TL_LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL as TL_LEGEND_ENTRY_TRAIL,
  LEGEND_GROUP_GAP as TL_LEGEND_GROUP_GAP,
  measureLegendText,
} from './utils/legend-constants';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from './utils/title-constants';

// ============================================================
// Shared Rendering Helpers
// ============================================================

/**
 * Renders a chart title on the SVG with optional click interaction.
 */
function renderChartTitle(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  title: string | undefined | null,
  titleLineNumber: number | undefined | null,
  width: number,
  textColor: string,
  onClickItem?: (lineNumber: number) => void
): void {
  if (!title) return;
  const titleEl = svg
    .append('text')
    .attr('class', 'chart-title')
    .attr('x', width / 2)
    .attr('y', TITLE_Y)
    .attr('text-anchor', 'middle')
    .attr('fill', textColor)
    .attr('font-size', TITLE_FONT_SIZE)
    .attr('font-weight', TITLE_FONT_WEIGHT)
    .style('cursor', onClickItem && titleLineNumber ? 'pointer' : 'default')
    .text(title);
  if (titleLineNumber) {
    titleEl.attr('data-line-number', titleLineNumber);
    if (onClickItem) {
      titleEl
        .on('click', () => onClickItem(titleLineNumber))
        .on('mouseenter', function () {
          d3Selection.select(this).attr('opacity', 0.7);
        })
        .on('mouseleave', function () {
          d3Selection.select(this).attr('opacity', 1);
        });
    }
  }
}

/**
 * Initializes a D3 chart: clears existing content, creates SVG, resolves palette colors.
 * Returns null if the container has zero dimensions.
 */
function initD3Chart(
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
  colors: string[];
} | null {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();
  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return null;
  const textColor = palette.text;
  const mutedColor = palette.border;
  const bgColor = palette.bg;
  const colors = getSeriesColors(palette);
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', bgColor);
  return { svg, width, height, textColor, mutedColor, bgColor, colors };
}

// ============================================================
// Timeline Date Helper
// ============================================================

/**
 * Converts a date string (YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DD HH:MM) to a fractional year number.
 */
export function parseTimelineDate(s: string): number {
  // Split off optional time component
  const spaceIdx = s.indexOf(' ');
  let datePart = s;
  let hour = 0;
  let minute = 0;

  if (spaceIdx !== -1) {
    datePart = s.slice(0, spaceIdx);
    const timePart = s.slice(spaceIdx + 1);
    const timeParts = timePart.split(':');
    if (timeParts.length === 2) {
      hour = parseInt(timeParts[0], 10);
      minute = parseInt(timeParts[1], 10);
    }
  }

  const parts = datePart.split('-').map((p) => parseInt(p, 10));
  const year = parts[0];
  const month = parts.length >= 2 ? parts[1] : 1;
  const day = parts.length >= 3 ? parts[2] : 1;
  return (
    year + (month - 1) / 12 + (day - 1) / 365 + hour / 8760 + minute / 525600
  );
}

/** Convert a fractional year number back to a Date (inverse of parseTimelineDate). */
function fractionalYearToDate(frac: number): Date {
  const year = Math.floor(frac);
  const remainder = frac - year;
  // Inverse of: (month-1)/12 + (day-1)/365 + hour/8760 + minute/525600
  const monthFrac = remainder * 12;
  const month = Math.floor(monthFrac); // 0-based
  const monthRemainder = remainder - month / 12;
  const dayFrac = monthRemainder * 365; // fractional day-of-year offset
  const day = Math.floor(dayFrac) + 1;
  const dayRemainder = dayFrac - Math.floor(dayFrac);
  const hourFrac = dayRemainder * 24;
  const hour = Math.floor(hourFrac);
  const minute = Math.round((hourFrac - hour) * 60);
  return new Date(year, month, day, hour, minute);
}

/** Convert a Date to a fractional year number. */
function dateToFractionalYear(d: Date): number {
  return (
    d.getFullYear() +
    d.getMonth() / 12 +
    (d.getDate() - 1) / 365 +
    d.getHours() / 8760 +
    d.getMinutes() / 525600
  );
}

/**
 * Adds a duration to a date string and returns the resulting date string.
 * Supports: d (days), w (weeks), m (months), y (years), h (hours), min (minutes)
 * Supports decimals up to 2 places (e.g., 1.25y = 1 year 3 months)
 * Preserves the precision of the input date (YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DD HH:MM).
 */
export function addDurationToDate(
  startDate: string,
  amount: number,
  unit: 'd' | 'w' | 'm' | 'y' | 'h' | 'min'
): string {
  // Split off optional time component
  const spaceIdx = startDate.indexOf(' ');
  let datePart = startDate;
  let hour = 0;
  let minute = 0;

  if (spaceIdx !== -1) {
    datePart = startDate.slice(0, spaceIdx);
    const timePart = startDate.slice(spaceIdx + 1);
    const tp = timePart.split(':');
    if (tp.length === 2) {
      hour = parseInt(tp[0], 10);
      minute = parseInt(tp[1], 10);
    }
  }

  const parts = datePart.split('-').map((p) => parseInt(p, 10));
  const year = parts[0];
  const month = parts.length >= 2 ? parts[1] : 1;
  const day = parts.length >= 3 ? parts[2] : 1;

  const date = new Date(year, month - 1, day, hour, minute);

  switch (unit) {
    case 'd':
      date.setDate(date.getDate() + Math.round(amount));
      break;
    case 'w':
      date.setDate(date.getDate() + Math.round(amount * 7));
      break;
    case 'm': {
      const wholeMonths = Math.floor(amount);
      const fractionalDays = Math.round((amount - wholeMonths) * 30);
      date.setMonth(date.getMonth() + wholeMonths);
      if (fractionalDays > 0) {
        date.setDate(date.getDate() + fractionalDays);
      }
      break;
    }
    case 'y': {
      const wholeYears = Math.floor(amount);
      const fractionalMonths = Math.round((amount - wholeYears) * 12);
      date.setFullYear(date.getFullYear() + wholeYears);
      if (fractionalMonths > 0) {
        date.setMonth(date.getMonth() + fractionalMonths);
      }
      break;
    }
    case 'h':
      date.setTime(date.getTime() + amount * 3600000);
      break;
    case 'min':
      date.setTime(date.getTime() + amount * 60000);
      break;
  }

  // Preserve original precision
  const endYear = date.getFullYear();
  const endMonth = String(date.getMonth() + 1).padStart(2, '0');
  const endDay = String(date.getDate()).padStart(2, '0');
  const endHour = String(date.getHours()).padStart(2, '0');
  const endMinute = String(date.getMinutes()).padStart(2, '0');
  const hasTime = unit === 'h' || unit === 'min' || spaceIdx !== -1;

  if (parts.length === 1) {
    return String(endYear);
  } else if (parts.length === 2) {
    return `${endYear}-${endMonth}`;
  } else if (hasTime && (date.getHours() !== 0 || date.getMinutes() !== 0)) {
    return `${endYear}-${endMonth}-${endDay} ${endHour}:${endMinute}`;
  } else {
    return `${endYear}-${endMonth}-${endDay}`;
  }
}

// ============================================================
// Parser
// ============================================================

/**
 * Parses D3 chart text format into structured data.
 */
export function parseVisualization(
  content: string,
  palette?: PaletteColors
): ParsedVisualization {
  const result: ParsedVisualization = {
    type: null,
    title: null,
    titleLineNumber: null,
    orientation: 'horizontal',
    periods: [],
    data: [],
    words: [],
    cloudOptions: { ...DEFAULT_CLOUD_OPTIONS },
    links: [],
    arcOrder: 'appearance',
    arcNodeGroups: [],
    timelineEvents: [],
    timelineGroups: [],
    timelineEras: [],
    timelineMarkers: [],
    timelineTagGroups: [],
    timelineSort: 'time',
    timelineScale: true,
    timelineSwimlanes: false,
    vennSets: [],
    vennOverlaps: [],
    quadrantLabels: {
      topRight: null,
      topLeft: null,
      bottomLeft: null,
      bottomRight: null,
    },
    quadrantPoints: [],
    quadrantXAxis: null,
    quadrantXAxisLineNumber: null,
    quadrantYAxis: null,
    quadrantYAxisLineNumber: null,
    quadrantTitleLineNumber: null,
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedVisualization => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!content || !content.trim()) {
    return fail(0, 'Empty content');
  }

  const lines = content.split('\n');
  const freeformLines: string[] = [];
  let currentArcGroup: string | null = null;
  let currentTimelineGroup: string | null = null;
  let currentTimelineTagGroup: TagGroup | null = null;
  let inTimelineEraBlock = false;
  let timelineEraBlockIndent = 0;
  let inTimelineMarkerBlock = false;
  let timelineMarkerBlockIndent = 0;
  let inSlopePeriodBlock = false;
  const timelineAliasMap = new Map<string, string>();
  const VALID_D3_TYPES = new Set([
    'slope',
    'wordcloud',
    'arc',
    'timeline',
    'venn',
    'quadrant',
    'sequence',
  ]);
  let firstLineParsed = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    const indent = rawLine.length - rawLine.trimStart().length;
    const lineNumber = i + 1;

    // Skip empty lines
    if (!line) continue;

    // Skip comments
    if (line.startsWith('//')) continue;

    // First non-empty, non-comment line: chart type + optional title
    if (!firstLineParsed) {
      firstLineParsed = true;
      const firstLineResult = parseFirstLine(line);
      if (firstLineResult && VALID_D3_TYPES.has(firstLineResult.chartType)) {
        result.type = firstLineResult.chartType as ParsedVisualization['type'];
        if (firstLineResult.title) {
          result.title = firstLineResult.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
      // Not a bare chart type — fall through to normal parsing
    }

    // Timeline tag group heading: `tag Name [alias X]`
    if (result.type === 'timeline' && indent === 0) {
      const tagBlockMatch = matchTagBlockHeading(line);
      if (tagBlockMatch) {
        currentTimelineTagGroup = {
          name: tagBlockMatch.name,
          alias: tagBlockMatch.alias,
          entries: [],
          lineNumber,
        };
        if (tagBlockMatch.alias) {
          timelineAliasMap.set(
            tagBlockMatch.alias.toLowerCase(),
            tagBlockMatch.name.toLowerCase()
          );
        }
        result.timelineTagGroups.push(currentTimelineTagGroup);
        continue;
      }
    }

    // Timeline tag group entries (indented under tag: heading)
    if (currentTimelineTagGroup && indent > 0) {
      const trimmedEntry = line;
      const isDefault = /\bdefault\s*$/.test(trimmedEntry);
      const entryText = isDefault
        ? trimmedEntry.replace(/\s+default\s*$/, '').trim()
        : trimmedEntry;
      const { label, color } = extractColor(entryText, palette);
      if (color) {
        if (isDefault) currentTimelineTagGroup.defaultValue = label;
        currentTimelineTagGroup.entries.push({
          value: label,
          color,
          lineNumber,
        });
        continue;
      }
    }

    // End tag group on non-indented line
    if (currentTimelineTagGroup && indent === 0) {
      currentTimelineTagGroup = null;
    }

    // [Group] container headers for arc diagram node grouping and timeline eras
    const groupMatch = line.match(/^\[(.+?)\](?:\s*\(([^)]+)\))?\s*$/);
    if (groupMatch) {
      if (result.type === 'arc') {
        const name = groupMatch[1].trim();
        const color = groupMatch[2]
          ? resolveColor(groupMatch[2].trim(), palette)
          : null;
        result.arcNodeGroups.push({ name, nodes: [], color, lineNumber });
        currentArcGroup = name;
      } else if (result.type === 'timeline') {
        const name = groupMatch[1].trim();
        const color = groupMatch[2]
          ? resolveColor(groupMatch[2].trim(), palette)
          : null;
        result.timelineGroups.push({ name, color, lineNumber });
        currentTimelineGroup = name;
      }
      continue;
    }

    // Reject legacy ## group syntax
    if (
      /^#{2,}\s+/.test(line) &&
      (result.type === 'arc' || result.type === 'timeline')
    ) {
      const name = line
        .replace(/^#{2,}\s+/, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
      result.diagnostics.push(
        makeDgmoError(
          lineNumber,
          `'## ${name}' is no longer supported. Use '[${name}]' instead`,
          'warning'
        )
      );
      continue;
    }

    // Clear group context on un-indented lines (except [Group] already handled above)
    if (indent === 0) {
      currentArcGroup = null;
      currentTimelineGroup = null;
    }

    // Arc link line: source -> target(color) weight
    if (result.type === 'arc') {
      const linkMatch = line.match(
        /^(.+?)\s*->\s*(.+?)(?:\(([^)]+)\))?\s*(?:\s+(\d+(?:\.\d+)?))?$/
      );
      if (linkMatch) {
        const source = linkMatch[1].trim();
        const target = linkMatch[2].trim();
        const linkColor = linkMatch[3]
          ? resolveColor(linkMatch[3].trim(), palette)
          : null;
        result.links.push({
          source,
          target,
          value: linkMatch[4] ? parseFloat(linkMatch[4]) : 1,
          color: linkColor,
          lineNumber,
        });
        // Assign nodes to current group (first-appearance wins)
        if (currentArcGroup !== null) {
          const group = result.arcNodeGroups.find(
            (g) => g.name === currentArcGroup
          );
          if (group) {
            const allGrouped = new Set(
              result.arcNodeGroups.flatMap((g) => g.nodes)
            );
            if (!allGrouped.has(source)) group.nodes.push(source);
            if (!allGrouped.has(target)) group.nodes.push(target);
          }
        }
        continue;
      }
    }

    // Timeline era block entries (indented under bare `era`)
    if (result.type === 'timeline' && inTimelineEraBlock) {
      if (indent <= timelineEraBlockIndent) {
        inTimelineEraBlock = false;
        // fall through to process this line normally
      } else {
        if (line.startsWith('//')) continue;
        const eraEntryMatch = line.match(
          /^(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s*(?:->|\u2013>)\s*(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s+(.+?)(?:\s*\(([^)]+)\))?\s*$/
        );
        if (eraEntryMatch) {
          const colorAnnotation = eraEntryMatch[4]?.trim() || null;
          result.timelineEras.push({
            startDate: eraEntryMatch[1],
            endDate: eraEntryMatch[2],
            label: eraEntryMatch[3].trim(),
            color: colorAnnotation
              ? resolveColor(colorAnnotation, palette)
              : null,
            lineNumber,
          });
        } else {
          warn(lineNumber, `Unrecognized era entry: "${line}"`);
        }
        continue;
      }
    }

    // Timeline marker block entries (indented under bare `marker`)
    if (result.type === 'timeline' && inTimelineMarkerBlock) {
      if (indent <= timelineMarkerBlockIndent) {
        inTimelineMarkerBlock = false;
        // fall through to process this line normally
      } else {
        if (line.startsWith('//')) continue;
        const markerEntryMatch = line.match(
          /^(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s+(.+?)(?:\s*\(([^)]+)\))?\s*$/
        );
        if (markerEntryMatch) {
          const colorAnnotation = markerEntryMatch[3]?.trim() || null;
          result.timelineMarkers.push({
            date: markerEntryMatch[1],
            label: markerEntryMatch[2].trim(),
            color: colorAnnotation
              ? resolveColor(colorAnnotation, palette)
              : null,
            lineNumber,
          });
        } else {
          warn(lineNumber, `Unrecognized marker entry: "${line}"`);
        }
        continue;
      }
    }

    // Timeline era/marker block starters and inline forms
    if (result.type === 'timeline') {
      // Bare `era` keyword starts a block
      if (line.toLowerCase() === 'era') {
        inTimelineEraBlock = true;
        timelineEraBlockIndent = indent;
        continue;
      }

      // Bare `marker` keyword starts a block
      if (line.toLowerCase() === 'marker') {
        inTimelineMarkerBlock = true;
        timelineMarkerBlockIndent = indent;
        continue;
      }

      // Timeline era lines (inline): era YYYY->YYYY Label (color)
      const eraMatch = line.match(
        /^era\s+(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s*(?:->|\u2013>)\s*(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s+(.+?)(?:\s*\(([^)]+)\))?\s*$/
      );
      if (eraMatch) {
        const colorAnnotation = eraMatch[4]?.trim() || null;
        result.timelineEras.push({
          startDate: eraMatch[1],
          endDate: eraMatch[2],
          label: eraMatch[3].trim(),
          color: colorAnnotation
            ? resolveColor(colorAnnotation, palette)
            : null,
          lineNumber,
        });
        continue;
      }

      // Timeline marker lines (inline): marker YYYY Label (color)
      const markerMatch = line.match(
        /^marker\s+(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s+(.+?)(?:\s*\(([^)]+)\))?\s*$/
      );
      if (markerMatch) {
        const colorAnnotation = markerMatch[3]?.trim() || null;
        result.timelineMarkers.push({
          date: markerMatch[1],
          label: markerMatch[2].trim(),
          color: colorAnnotation
            ? resolveColor(colorAnnotation, palette)
            : null,
          lineNumber,
        });
        continue;
      }
    }

    // Timeline event lines: duration, range, or point
    if (result.type === 'timeline') {
      // Duration event: 2026-07-15->30d: description (d=days, w=weeks, m=months, y=years, h=hours, min=minutes)
      // Supports decimals up to 2 places (e.g., 1.25y = 1 year 3 months)
      // Supports uncertain end with ? suffix (e.g., ->3m?: fades out the last 20%)
      // Accepts both -> (hyphen) and –> (en-dash U+2013)
      const durationMatch = line.match(
        /^(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s*(?:->|\u2013>)\s*(\d+(?:\.\d{1,2})?)(min|[dwmyh])(\?)?\s+(.+)$/
      );
      if (durationMatch) {
        const startDate = durationMatch[1];
        const uncertain = durationMatch[4] === '?';
        const amount = parseFloat(durationMatch[2]);
        const unit = durationMatch[3] as 'd' | 'w' | 'm' | 'y' | 'h' | 'min';
        const endDate = addDurationToDate(startDate, amount, unit);
        const segments = durationMatch[5].split('|');
        const metadata =
          segments.length > 1
            ? parsePipeMetadata(
                ['', ...segments.slice(1)],
                timelineAliasMap,
                () => warn(lineNumber, MULTIPLE_PIPE_ERROR)
              )
            : {};
        result.timelineEvents.push({
          date: startDate,
          endDate,
          label: segments[0].trim(),
          group: currentTimelineGroup,
          metadata,
          lineNumber,
          uncertain,
        });
        continue;
      }

      // Range event: 1655->1667 description (supports uncertain end: 1655->1667?)
      // Also supports YYYY-MM-DD HH:MM in both start and end dates
      // Accepts both -> (hyphen) and –> (en-dash U+2013)
      const rangeMatch = line.match(
        /^(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s*(?:->|\u2013>)\s*(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)(\?)?\s+(.+)$/
      );
      if (rangeMatch) {
        const segments = rangeMatch[4].split('|');
        const metadata =
          segments.length > 1
            ? parsePipeMetadata(
                ['', ...segments.slice(1)],
                timelineAliasMap,
                () => warn(lineNumber, MULTIPLE_PIPE_ERROR)
              )
            : {};
        result.timelineEvents.push({
          date: rangeMatch[1],
          endDate: rangeMatch[2],
          label: segments[0].trim(),
          group: currentTimelineGroup,
          metadata,
          lineNumber,
          uncertain: rangeMatch[3] === '?',
        });
        continue;
      }

      // Point event: 1718 description
      const pointMatch = line.match(/^(\d{4}(?:-\d{2})?(?:-\d{2})?)\s+(.+)$/);
      if (pointMatch) {
        const segments = pointMatch[2].split('|');
        const metadata =
          segments.length > 1
            ? parsePipeMetadata(
                ['', ...segments.slice(1)],
                timelineAliasMap,
                () => warn(lineNumber, MULTIPLE_PIPE_ERROR)
              )
            : {};
        result.timelineEvents.push({
          date: pointMatch[1],
          endDate: null,
          label: segments[0].trim(),
          group: currentTimelineGroup,
          metadata,
          lineNumber,
        });
        continue;
      }
    }

    // Venn diagram DSL
    if (result.type === 'venn') {
      // Intersection line: "A + B Label" / "A + B" / "A + B + C Label"
      // Also accepts deprecated colon syntax: "A + B: Label"
      if (/\+/.test(line)) {
        // Build lookup of known set names and aliases for label extraction
        const knownSetRefs = new Set<string>();
        for (const s of result.vennSets) {
          knownSetRefs.add(s.name.toLowerCase());
          if (s.alias) knownSetRefs.add(s.alias.toLowerCase());
        }

        const segments = line
          .split('+')
          .map((s) => s.trim())
          .filter(Boolean);
        if (segments.length >= 2) {
          // All segments except the last are pure set references
          const rawSets = segments.slice(0, -1);
          const lastSeg = segments[segments.length - 1];

          // For the last segment, extract set reference and optional label.
          // Find where the set reference ends and label begins.
          // Try progressively shorter prefixes against known set names/aliases.
          const words = lastSeg.split(/\s+/);
          let matchLen = 0;
          for (let w = words.length; w >= 1; w--) {
            const candidate = words.slice(0, w).join(' ');
            if (knownSetRefs.has(candidate.toLowerCase())) {
              matchLen = w;
              break;
            }
          }
          let lastSetRef: string;
          let label: string | null;
          if (matchLen > 0) {
            lastSetRef = words.slice(0, matchLen).join(' ');
            label =
              words.length > matchLen ? words.slice(matchLen).join(' ') : null;
          } else {
            // No known set matched — assume first word is the set ref, rest is label
            lastSetRef = words[0];
            label = words.length > 1 ? words.slice(1).join(' ') : null;
          }
          rawSets.push(lastSetRef);
          result.vennOverlaps.push({ sets: rawSets, label, lineNumber });
          continue;
        }
      }

      // Set declaration: "Name(color) alias x" / "Name alias x" / "Name(color)" / "Name"
      const setDeclMatch = line.match(
        /^([^(:]+?)(?:\(([^)]+)\))?(?:\s+alias\s+(\S+))?\s*$/i
      );
      if (setDeclMatch) {
        const name = setDeclMatch[1].trim();
        const colorName = setDeclMatch[2]?.trim() ?? null;
        let color: string | null = null;
        if (colorName) {
          const resolved = resolveColor(colorName, palette);
          if (resolved === null) {
            warn(
              lineNumber,
              `Hex colors are not supported — use named colors (blue, red, green, etc.)`
            );
          } else if (resolved.startsWith('#')) {
            color = resolved;
          } else {
            warn(
              lineNumber,
              `Unknown color "${colorName}" on set "${name}". Using auto-assigned color.`
            );
          }
        }
        const alias = setDeclMatch[3]?.trim() ?? null;
        result.vennSets.push({ name, alias, color, lineNumber });
        continue;
      }
    }

    // Quadrant-specific parsing
    if (result.type === 'quadrant') {
      // x-label Low, High  — or indented multi-line
      const xAxisMatch = line.match(/^x-label\s+(.*)/i);
      if (xAxisMatch) {
        const val = xAxisMatch[1].trim();
        let parts: string[];
        if (val) {
          parts = val.split(',').map((s) => s.trim());
        } else {
          const collected = collectIndentedValues(lines, i);
          i = collected.newIndex;
          parts = collected.values;
        }
        if (parts.length >= 2) {
          result.quadrantXAxis = [parts[0], parts[1]];
          result.quadrantXAxisLineNumber = lineNumber;
        }
        continue;
      }

      // y-label Low, High  — or indented multi-line
      const yAxisMatch = line.match(/^y-label\s+(.*)/i);
      if (yAxisMatch) {
        const val = yAxisMatch[1].trim();
        let parts: string[];
        if (val) {
          parts = val.split(',').map((s) => s.trim());
        } else {
          const collected = collectIndentedValues(lines, i);
          i = collected.newIndex;
          parts = collected.values;
        }
        if (parts.length >= 2) {
          result.quadrantYAxis = [parts[0], parts[1]];
          result.quadrantYAxisLineNumber = lineNumber;
        }
        continue;
      }

      // Quadrant position labels: top-right Label (color)
      const quadrantLabelRe =
        /^(top-right|top-left|bottom-left|bottom-right)\s+(.+)/i;
      const quadrantMatch = line.match(quadrantLabelRe);
      if (quadrantMatch) {
        const position = quadrantMatch[1].toLowerCase();
        const labelPart = quadrantMatch[2].trim();
        // Check for color annotation: "Label (color)" or "Label(color)"
        const labelColorMatch = labelPart.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        const text = labelColorMatch ? labelColorMatch[1].trim() : labelPart;
        const color = labelColorMatch
          ? resolveColor(labelColorMatch[2].trim(), palette)
          : null;
        const label: QuadrantLabel = { text, color, lineNumber };

        if (position === 'top-right') result.quadrantLabels.topRight = label;
        else if (position === 'top-left') result.quadrantLabels.topLeft = label;
        else if (position === 'bottom-left')
          result.quadrantLabels.bottomLeft = label;
        else if (position === 'bottom-right')
          result.quadrantLabels.bottomRight = label;
        continue;
      }

      // Data points: Label x, y  OR  Label x y
      const pointMatch = line.match(
        /^(.+?)\s+([0-9]*\.?[0-9]+)\s*[,\s]\s*([0-9]*\.?[0-9]+)\s*$/
      );
      if (pointMatch) {
        const label = pointMatch[1].trim();
        // Skip if it looks like a quadrant position keyword
        const lowerLabel = label.toLowerCase();
        if (
          lowerLabel !== 'top-right' &&
          lowerLabel !== 'top-left' &&
          lowerLabel !== 'bottom-left' &&
          lowerLabel !== 'bottom-right'
        ) {
          result.quadrantPoints.push({
            label,
            x: parseFloat(pointMatch[2]),
            y: parseFloat(pointMatch[3]),
            lineNumber,
          });
        }
        continue;
      }
    }

    // ── Space-separated options (no colon) ──────────────────
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx >= 0) {
      const firstToken = line.substring(0, spaceIdx).toLowerCase();
      const restValue = line.substring(spaceIdx + 1).trim();

      if (
        firstToken === 'chart' &&
        VALID_D3_TYPES.has(restValue.toLowerCase())
      ) {
        result.type = restValue.toLowerCase() as ParsedVisualization['type'];
        continue;
      }

      if (firstToken === 'title') {
        result.title = restValue;
        result.titleLineNumber = lineNumber;
        if (result.type === 'quadrant') {
          result.quadrantTitleLineNumber = lineNumber;
        }
        continue;
      }

      if (firstToken === 'order') {
        const v = restValue.toLowerCase();
        if (v === 'name' || v === 'group' || v === 'degree') {
          result.arcOrder = v;
        }
        continue;
      }

      if (firstToken === 'rotate') {
        const v = restValue.toLowerCase();
        if (v === 'none' || v === 'mixed' || v === 'angled') {
          result.cloudOptions.rotate = v;
        }
        continue;
      }

      if (firstToken === 'max') {
        const v = parseInt(restValue, 10);
        if (!isNaN(v) && v > 0) {
          result.cloudOptions.max = v;
        }
        continue;
      }

      if (firstToken === 'size') {
        const parts = restValue.split(',').map((s) => parseInt(s.trim(), 10));
        if (
          parts.length === 2 &&
          parts.every((n) => !isNaN(n) && n > 0) &&
          parts[0] < parts[1]
        ) {
          result.cloudOptions.minSize = parts[0];
          result.cloudOptions.maxSize = parts[1];
        }
        continue;
      }
    }

    // ── Slope chart: period directive + right-scan data rows ──
    if (result.type === 'slope') {
      // Period block: indented lines inside `period` block
      // (blank lines are pre-filtered at loop top, so only non-indented lines close the block)
      if (inSlopePeriodBlock) {
        if (indent > 0) {
          result.periods.push(line);
          continue;
        }
        // Non-indented line → close block, fall through to process normally
        inSlopePeriodBlock = false;
      }

      // Period directive: `period Label1 Label2` or bare `period` (block open)
      // Only accept before data rows start (F4: prevent keyword shadowing labels)
      if (result.data.length === 0) {
        const periodMatch = line.match(/^period\b(.*)$/i);
        if (periodMatch) {
          if (result.periods.length > 0 && !inSlopePeriodBlock) {
            // F5: warn on duplicate period directives
            warn(
              lineNumber,
              `Duplicate 'period' directive — periods are already defined`
            );
          }
          const rest = periodMatch[1].trim();
          if (rest) {
            // One-line: `period 1715 1725`
            const periodLabels = rest.split(/\s+/);
            result.periods.push(...periodLabels);
          } else {
            // Block open: bare `period`
            inSlopePeriodBlock = true;
          }
          continue;
        }
      }

      // Migration error: bare period line (old syntax — comma-separated, no keyword)
      // F1: Only fire when ALL comma-separated tokens are short (≤20 chars) and non-empty
      if (
        result.periods.length === 0 &&
        line.includes(',') &&
        !line.includes(':')
      ) {
        const tokens = line
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        const looksLikePeriods =
          tokens.length >= 2 && tokens.every((t) => t.length <= 20);
        if (looksLikePeriods) {
          return fail(
            lineNumber,
            `Period lines require the 'period' keyword — use 'period ${tokens.join(' ')}'`
          );
        }
      }

      // Migration error: old colon syntax in data rows
      // F2: Only fire when content after colon is predominantly numeric (old "Label: val1, val2" pattern)
      if (line.includes(':')) {
        const colonPos = line.indexOf(':');
        const afterColon = line.substring(colonPos + 1).trim();
        const numericTokens = afterColon
          .split(/[,\s]+/)
          .filter((v) => /^-?\d/.test(v));
        // Only trigger if most tokens after the colon are numeric (old data pattern)
        if (numericTokens.length >= 1) {
          const allTokens = afterColon.split(/[,\s]+/).filter(Boolean);
          if (numericTokens.length >= allTokens.length * 0.5) {
            const label = line.substring(0, colonPos).trim();
            return fail(
              lineNumber,
              `Colons are no longer used in slope data rows — use '${label} ${numericTokens.join(' ')}'`
            );
          }
        }
      }

      // Right-scan data row parsing (requires periods to be known)
      if (result.periods.length >= 2) {
        const P = result.periods.length;
        const tokens = line.split(/\s+/);
        const values: number[] = [];

        // Scan from right, capped at P values
        let rightIdx = tokens.length - 1;
        while (rightIdx >= 0 && values.length < P) {
          const raw = tokens[rightIdx].replace(/,/g, '');
          const num = parseFloat(raw);
          if (!isNaN(num) && /^-?\d/.test(raw)) {
            values.unshift(num);
            rightIdx--;
          } else {
            break;
          }
        }

        if (values.length < P) {
          warn(
            lineNumber,
            `Data row has ${values.length} numeric value(s) but ${P} period(s) are defined — expected ${P} values`
          );
          continue;
        }

        // Remaining left tokens = label
        const labelTokens = tokens.slice(0, rightIdx + 1);
        const joinedLabel = labelTokens.join(' ');

        if (!joinedLabel) {
          warn(
            lineNumber,
            `Data row has no label — add a label before the numeric values`
          );
          continue;
        }

        // Color annotation: `Label (color)` → extract color
        const colorMatch = joinedLabel.match(/^(.+?)\(([^)]+)\)\s*$/);
        const labelPart = colorMatch ? colorMatch[1].trim() : joinedLabel;
        const colorPart = colorMatch
          ? resolveColor(colorMatch[2].trim(), palette)
          : null;

        if (!labelPart) {
          warn(
            lineNumber,
            `Data row has no label — add a label before the numeric values`
          );
          continue;
        }

        // F3: Warn on purely numeric labels — likely a mistake
        if (/^\d[\d,.]*$/.test(labelPart)) {
          warn(
            lineNumber,
            `Label '${labelPart}' looks numeric — this may indicate too many values or a missing label`
          );
        }

        result.data.push({
          label: labelPart,
          values,
          color: colorPart,
          lineNumber,
        });
        continue;
      }

      // If we get here in a slope chart, it's an unrecognized line
      if (firstLineParsed) {
        warn(lineNumber, `Unexpected line: '${line}'.`);
      }
      continue;
    }

    // ── Colon-separated metadata / options (legacy + data lines) ──
    const colonIndex = line.indexOf(':');

    if (colonIndex !== -1) {
      const rawKey = line.substring(0, colonIndex).trim();
      const key = rawKey.toLowerCase();

      // Check for color annotation in raw key: "Label(color)"
      const colorMatch = rawKey.match(/^(.+?)\(([^)]+)\)\s*$/);

      if (key === 'title') {
        result.title = line.substring(colonIndex + 1).trim();
        result.titleLineNumber = lineNumber;
        if (result.type === 'quadrant') {
          result.quadrantTitleLineNumber = lineNumber;
        }
        continue;
      }

      if (key === 'order') {
        const v = line
          .substring(colonIndex + 1)
          .trim()
          .toLowerCase();
        if (v === 'name' || v === 'group' || v === 'degree') {
          result.arcOrder = v;
        }
        continue;
      }

      if (key === 'rotate') {
        const v = line
          .substring(colonIndex + 1)
          .trim()
          .toLowerCase();
        if (v === 'none' || v === 'mixed' || v === 'angled') {
          result.cloudOptions.rotate = v;
        }
        continue;
      }

      if (key === 'max') {
        const v = parseInt(line.substring(colonIndex + 1).trim(), 10);
        if (!isNaN(v) && v > 0) {
          result.cloudOptions.max = v;
        }
        continue;
      }

      if (key === 'size') {
        const v = line.substring(colonIndex + 1).trim();
        const parts = v.split(',').map((s) => parseInt(s.trim(), 10));
        if (
          parts.length === 2 &&
          parts.every((n) => !isNaN(n) && n > 0) &&
          parts[0] < parts[1]
        ) {
          result.cloudOptions.minSize = parts[0];
          result.cloudOptions.maxSize = parts[1];
        }
        continue;
      }

      // Data line: "Label: value1, value2" or "Label(color): value1, value2"
      const labelPart = colorMatch ? colorMatch[1].trim() : rawKey;
      const colorPart = colorMatch
        ? resolveColor(colorMatch[2].trim(), palette)
        : null;
      const valuePart = line.substring(colonIndex + 1).trim();
      const values = valuePart.split(',').map((v) => v.trim());

      // Check if this looks like a data line (values should be numeric)
      const numericValues: number[] = [];
      let allNumeric = true;
      for (const v of values) {
        const num = parseFloat(v);
        if (isNaN(num)) {
          allNumeric = false;
          break;
        }
        numericValues.push(num);
      }

      if (allNumeric && numericValues.length > 0) {
        // Wordcloud does not use colon data format — skip to freeform handling
        if (result.type !== 'wordcloud') {
          result.data.push({
            label: labelPart,
            values: numericValues,
            color: colorPart,
            lineNumber,
          });
          continue;
        }
      }
    }

    // For wordcloud: collect non-metadata lines for freeform fallback
    if (result.type === 'wordcloud') {
      if (colonIndex === -1 && !line.includes(' ')) {
        // Single bare word — structured mode
        result.words.push({ text: line, weight: 10, lineNumber });
      } else if (colonIndex === -1) {
        // Try "word weight" or "multi-word-label weight" space-separated format
        const lastSpace = line.lastIndexOf(' ');
        const maybeWeight =
          lastSpace >= 0 ? parseFloat(line.substring(lastSpace + 1)) : NaN;
        if (lastSpace >= 0 && !isNaN(maybeWeight) && maybeWeight > 0) {
          result.words.push({
            text: line.substring(0, lastSpace).trim(),
            weight: maybeWeight,
            lineNumber,
          });
        } else {
          freeformLines.push(line);
        }
      } else {
        // Non-numeric colon line — freeform text
        freeformLines.push(line);
      }
      continue;
    }

    // Catch-all: nothing matched this line
    // Skip on first line — chart type suggestion is handled post-loop
    if (firstLineParsed) {
      warn(lineNumber, `Unexpected line: '${line}'.`);
    }
  }

  // Validation
  if (!result.type) {
    const validD3Types = [...VALID_D3_TYPES];
    const firstNonEmpty =
      lines.find((l) => l.trim() && !l.trim().startsWith('//'))?.trim() ?? '';
    const hint = suggest(
      firstNonEmpty.split(/\s/)[0].toLowerCase(),
      validD3Types
    );
    let msg = `Unsupported chart type: "${firstNonEmpty.split(/\s/)[0]}". Supported types: ${validD3Types.join(', ')}`;
    if (hint) msg += `. ${hint}`;
    return fail(1, msg);
  }

  // Sequence diagrams are parsed by their own dedicated parser
  if (result.type === 'sequence') {
    return result;
  }

  if (result.type === 'wordcloud') {
    // If no structured words were found, parse freeform text as word frequencies
    if (result.words.length === 0 && freeformLines.length > 0) {
      result.words = tokenizeFreeformText(freeformLines.join(' '));
    }
    if (result.words.length === 0) {
      warn(
        1,
        'No words found. Add words as "word weight" (space-separated), one per line, or paste freeform text'
      );
    }
    // Apply max word limit (words are already sorted by weight desc for freeform)
    if (
      result.cloudOptions.max > 0 &&
      result.words.length > result.cloudOptions.max
    ) {
      result.words = result.words
        .slice()
        .sort((a, b) => b.weight - a.weight)
        .slice(0, result.cloudOptions.max);
    }
    return result;
  }

  if (result.type === 'arc') {
    if (result.links.length === 0) {
      warn(
        1,
        'No links found. Add links as "Source -> Target weight" (e.g., "Alice -> Bob 5")'
      );
    }
    // Validate arc ordering vs groups
    if (result.arcNodeGroups.length > 0) {
      if (result.arcOrder === 'name' || result.arcOrder === 'degree') {
        warn(
          1,
          `Cannot use "order ${result.arcOrder}" with [Group] headers. Use "order group" or remove group headers.`
        );
        result.arcOrder = 'group';
      }
      if (result.arcOrder === 'appearance') {
        result.arcOrder = 'group';
      }
    }
    return result;
  }

  if (result.type === 'timeline') {
    if (result.timelineEvents.length === 0) {
      warn(
        1,
        'No events found. Add events as "YYYY: description" or "YYYY->YYYY: description"'
      );
    }
    // Validate tag values and inject defaults
    if (result.timelineTagGroups.length > 0) {
      validateTagValues(
        result.timelineEvents,
        result.timelineTagGroups,
        (line, msg) =>
          result.diagnostics.push(makeDgmoError(line, msg, 'warning')),
        suggest
      );
      for (const group of result.timelineTagGroups) {
        if (!group.defaultValue) continue;
        const key = group.name.toLowerCase();
        for (const event of result.timelineEvents) {
          if (!event.metadata[key]) {
            event.metadata[key] = group.defaultValue;
          }
        }
      }
    }

    return result;
  }

  if (result.type === 'venn') {
    if (result.vennSets.length < 2) {
      return fail(
        1,
        'At least 2 sets are required. Add set names (e.g., "Apples", "Oranges")'
      );
    }
    if (result.vennSets.length > 3) {
      return fail(1, 'Venn diagrams support 2–3 sets');
    }
    // Build lookup: full name (lowercase) and alias → canonical name
    const setNameLower = new Map<string, string>(
      result.vennSets.map((s) => [s.name.toLowerCase(), s.name])
    );
    const aliasLower = new Map<string, string>();
    for (const s of result.vennSets) {
      if (s.alias) aliasLower.set(s.alias.toLowerCase(), s.name);
    }
    const resolveSetRef = (ref: string): string | null =>
      setNameLower.get(ref.toLowerCase()) ??
      aliasLower.get(ref.toLowerCase()) ??
      null;

    // Resolve intersection set references; drop invalid ones with a diagnostic
    const validOverlaps: VennOverlap[] = [];
    for (const ov of result.vennOverlaps) {
      const resolvedSets: string[] = [];
      let valid = true;
      for (const ref of ov.sets) {
        const resolved = resolveSetRef(ref);
        if (!resolved) {
          result.diagnostics.push(
            makeDgmoError(
              ov.lineNumber,
              `Intersection references unknown set or alias "${ref}"`
            )
          );
          if (!result.error)
            result.error = formatDgmoError(
              result.diagnostics[result.diagnostics.length - 1]
            );
          valid = false;
          break;
        }
        resolvedSets.push(resolved);
      }
      if (valid) validOverlaps.push({ ...ov, sets: resolvedSets.sort() });
    }
    result.vennOverlaps = validOverlaps;
    return result;
  }

  if (result.type === 'quadrant') {
    if (result.quadrantPoints.length === 0) {
      warn(
        1,
        'No data points found. Add points as "Label x, y" (e.g., "Item A 0.5, 0.7")'
      );
    }
    return result;
  }

  // Slope chart validation
  if (result.periods.length < 2) {
    return fail(
      1,
      "Missing 'period' directive. Add 'period 2020 2024' before data rows (minimum 2 periods required)"
    );
  }

  if (result.data.length === 0) {
    warn(
      1,
      "No data lines found. Add data as 'Label value1 value2' (e.g., 'Blackbeard 40 4')"
    );
  }

  // Validate value counts match period count — warn and skip mismatched items
  for (const item of result.data) {
    if (item.values.length !== result.periods.length) {
      warn(
        item.lineNumber,
        `Data item "${item.label}" has ${item.values.length} value(s) but ${result.periods.length} period(s) are defined`
      );
    }
  }
  result.data = result.data.filter(
    (item) => item.values.length === result.periods.length
  );

  return result;
}

// ============================================================
// Freeform Text Tokenizer (for word cloud)
// ============================================================

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'me',
  'my',
  'we',
  'us',
  'our',
  'you',
  'your',
  'he',
  'him',
  'his',
  'she',
  'her',
  'they',
  'them',
  'their',
  'what',
  'which',
  'who',
  'whom',
  'how',
  'when',
  'where',
  'why',
  'not',
  'no',
  'nor',
  'so',
  'if',
  'then',
  'than',
  'too',
  'very',
  'just',
  'about',
  'up',
  'out',
  'from',
  'into',
  'over',
  'after',
  'before',
  'between',
  'under',
  'again',
  'there',
  'here',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'only',
  'own',
  'same',
  'also',
  'as',
  'because',
  'until',
  'while',
  'during',
  'through',
]);

function tokenizeFreeformText(text: string): WordCloudWord[] {
  const counts = new Map<string, number>();

  // Split on non-letter/non-apostrophe chars, lowercase everything
  const tokens = text
    .toLowerCase()
    .split(/[^a-zA-Z']+/)
    .filter(Boolean);

  for (const raw of tokens) {
    // Strip leading/trailing apostrophes
    const word = raw.replace(/^'+|'+$/g, '');
    if (word.length < 2 || STOP_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([text, count]) => ({ text, weight: count, lineNumber: 0 }))
    .sort((a, b) => b.weight - a.weight);
}

// ============================================================
// Slope Chart Renderer
// ============================================================

/**
 * Resolves vertical label collisions by nudging overlapping items apart.
 * Takes items with a naturalY (center) and height, returns adjusted center Y positions.
 * Optional maxY clamps the bottom edge so labels don't overflow the chart area.
 */
export function resolveVerticalCollisions(
  items: { naturalY: number; height: number }[],
  minGap: number,
  maxY?: number
): number[] {
  if (items.length === 0) return [];
  const sorted = items
    .map((it, i) => ({ ...it, idx: i }))
    .sort((a, b) => a.naturalY - b.naturalY);
  const adjustedY = new Array<number>(items.length);
  let prevBottom = -Infinity;
  for (const item of sorted) {
    const halfH = item.height / 2;
    let top = Math.max(item.naturalY - halfH, prevBottom + minGap);
    // Clamp so the label bottom doesn't exceed maxY
    if (maxY !== undefined) {
      top = Math.min(top, maxY - item.height);
    }
    adjustedY[item.idx] = top + halfH;
    prevBottom = top + item.height;
  }
  return adjustedY;
}

const SLOPE_MARGIN = { top: 80, bottom: 40, left: 80 };
const SLOPE_LABEL_FONT_SIZE = 14;
const SLOPE_CHAR_WIDTH = 8; // approximate px per character at 14px

/**
 * Renders a slope chart into the given container using D3.
 */
export function renderSlopeChart(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { periods, data, title } = parsed;
  if (data.length === 0 || periods.length < 2) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, mutedColor, bgColor, colors } = init;

  // Compute right margin from the longest end-of-line label
  const maxLabelText = data.reduce((longest, item) => {
    const text = `${item.values[item.values.length - 1]} — ${item.label}`;
    return text.length > longest.length ? text : longest;
  }, '');
  const estimatedLabelWidth = maxLabelText.length * SLOPE_CHAR_WIDTH;
  const maxRightMargin = Math.floor(width * 0.35);
  const rightMargin = Math.min(
    Math.max(estimatedLabelWidth + 30, 120),
    maxRightMargin
  );

  const innerWidth = width - SLOPE_MARGIN.left - rightMargin;
  const innerHeight = height - SLOPE_MARGIN.top - SLOPE_MARGIN.bottom;

  // Scales
  const allValues = data.flatMap((d) => d.values);
  const [minVal, maxVal] = d3Array.extent(allValues) as [number, number];
  const valuePadding = (maxVal - minVal) * 0.1 || 1;

  const yScale = d3Scale
    .scaleLinear()
    .domain([minVal - valuePadding, maxVal + valuePadding])
    .range([innerHeight, 0]);

  const xScale = d3Scale
    .scalePoint<string>()
    .domain(periods)
    .range([0, innerWidth])
    .padding(0);

  const g = svg
    .append('g')
    .attr('transform', `translate(${SLOPE_MARGIN.left},${SLOPE_MARGIN.top})`);

  // Tooltip
  const tooltip = createTooltip(container, palette, isDark);

  // Title
  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  // Period column headers
  for (const period of periods) {
    const x = xScale(period)!;
    g.append('text')
      .attr('x', x)
      .attr('y', -15)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '18px')
      .attr('font-weight', '600')
      .text(period);

    // Vertical guide line
    g.append('line')
      .attr('x1', x)
      .attr('y1', 0)
      .attr('x2', x)
      .attr('y2', innerHeight)
      .attr('stroke', mutedColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');
  }

  // Line generator
  const lineGen = d3Shape
    .line<number>()
    .x((_d, i) => xScale(periods[i])!)
    .y((d) => yScale(d));

  // Pre-compute per-series data for label collision resolution
  const seriesInfo = data.map((item, idx) => {
    const color = item.color ?? colors[idx % colors.length];
    const firstVal = item.values[0];
    const lastVal = item.values[item.values.length - 1];
    const absChange = lastVal - firstVal;
    const pctChange = firstVal !== 0 ? (absChange / firstVal) * 100 : null;
    const sign = absChange > 0 ? '+' : '';
    const tipLines = [`${sign}${parseFloat(absChange.toFixed(2))}`];
    if (pctChange !== null) tipLines.push(`${sign}${pctChange.toFixed(1)}%`);
    const tipHtml = tipLines.join('<br>');

    // Compute right-side label text and wrapping info
    const lastX = xScale(periods[periods.length - 1])!;
    const labelText = `${lastVal} — ${item.label}`;
    const availableWidth = rightMargin - 15;
    const maxChars = Math.floor(availableWidth / SLOPE_CHAR_WIDTH);

    let labelLineCount = 1;
    let wrappedLines: string[] | null = null;
    if (labelText.length > maxChars) {
      const words = labelText.split(/\s+/);
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (test.length > maxChars && current) {
          lines.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);
      labelLineCount = lines.length;
      wrappedLines = lines;
    }
    const lineHeight = SLOPE_LABEL_FONT_SIZE * 1.2;
    const labelHeight =
      labelLineCount === 1
        ? SLOPE_LABEL_FONT_SIZE
        : labelLineCount * lineHeight;

    return {
      item,
      idx,
      color,
      firstVal,
      lastVal,
      tipHtml,
      lastX,
      labelText,
      maxChars,
      wrappedLines,
      labelHeight,
    };
  });

  // --- Resolve left-side label collisions per non-last period column ---
  const leftLabelHeight = 20; // 16px font needs ~20px to avoid glyph overlap
  const leftLabelCollisions: Map<number, number[]> = new Map();
  for (let pi = 0; pi < periods.length - 1; pi++) {
    const entries = data.map((item) => ({
      naturalY: yScale(item.values[pi]),
      height: leftLabelHeight,
    }));
    leftLabelCollisions.set(
      pi,
      resolveVerticalCollisions(entries, 4, innerHeight)
    );
  }

  // --- Resolve right-side label collisions ---
  const rightEntries = seriesInfo.map((si) => ({
    naturalY: yScale(si.lastVal),
    height: Math.max(si.labelHeight, SLOPE_LABEL_FONT_SIZE * 1.4),
  }));
  const rightAdjustedY = resolveVerticalCollisions(
    rightEntries,
    4,
    innerHeight
  );

  // Render each data series
  data.forEach((item, idx) => {
    const si = seriesInfo[idx];
    const color = si.color;

    // Wrap each series in a group with data-line-number for sync adapter
    const seriesG = g
      .append('g')
      .attr('class', 'slope-series')
      .attr('data-line-number', String(item.lineNumber));

    // Line
    seriesG
      .append('path')
      .datum(item.values)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2.5)
      .attr('d', lineGen);

    // Invisible wider path for easier hover targeting
    seriesG
      .append('path')
      .datum(item.values)
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 14)
      .attr('d', lineGen)
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .on('mouseenter', (event: MouseEvent) =>
        showTooltip(tooltip, si.tipHtml, event)
      )
      .on('mousemove', (event: MouseEvent) =>
        showTooltip(tooltip, si.tipHtml, event)
      )
      .on('mouseleave', () => hideTooltip(tooltip))
      .on('click', () => {
        if (onClickItem && item.lineNumber) onClickItem(item.lineNumber);
      });

    // Points and value labels
    item.values.forEach((val, i) => {
      const x = xScale(periods[i])!;
      const y = yScale(val);

      // Point circle
      seriesG
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', 4)
        .attr('fill', color)
        .attr('stroke', bgColor)
        .attr('stroke-width', 1.5)
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .on('mouseenter', (event: MouseEvent) =>
          showTooltip(tooltip, si.tipHtml, event)
        )
        .on('mousemove', (event: MouseEvent) =>
          showTooltip(tooltip, si.tipHtml, event)
        )
        .on('mouseleave', () => hideTooltip(tooltip))
        .on('click', () => {
          if (onClickItem && item.lineNumber) onClickItem(item.lineNumber);
        });

      // Value label — skip last point (shown in series label instead)
      const isFirst = i === 0;
      const isLast = i === periods.length - 1;
      if (!isLast) {
        const adjustedY = leftLabelCollisions.get(i)![idx];
        seriesG
          .append('text')
          .attr('x', isFirst ? x - 10 : x)
          .attr('y', adjustedY)
          .attr('dy', '0.35em')
          .attr('text-anchor', isFirst ? 'end' : 'middle')
          .attr('fill', color)
          .attr('font-size', '16px')
          .text(val.toString());
      }
    });

    // Series label with value at end of line — wraps if it exceeds available space
    const adjustedLastY = rightAdjustedY[idx];

    const labelEl = seriesG
      .append('text')
      .attr('x', si.lastX + 10)
      .attr('y', adjustedLastY)
      .attr('text-anchor', 'start')
      .attr('fill', color)
      .attr('font-size', `${SLOPE_LABEL_FONT_SIZE}px`)
      .attr('font-weight', '500');

    if (!si.wrappedLines) {
      labelEl.attr('dy', '0.35em').text(si.labelText);
    } else {
      const lineHeight = SLOPE_LABEL_FONT_SIZE * 1.2;
      const totalHeight = (si.wrappedLines.length - 1) * lineHeight;
      const startDy = -totalHeight / 2;

      si.wrappedLines.forEach((line, li) => {
        labelEl
          .append('tspan')
          .attr('x', si.lastX + 10)
          .attr(
            'dy',
            li === 0
              ? `${startDy + SLOPE_LABEL_FONT_SIZE * 0.35}px`
              : `${lineHeight}px`
          )
          .text(line);
      });
    }
  });
}

// ============================================================
// Arc Node Ordering
// ============================================================

/**
 * Orders arc diagram nodes based on the selected ordering strategy.
 */
export function orderArcNodes(
  links: ArcLink[],
  order: ArcOrder,
  groups: ArcNodeGroup[]
): string[] {
  // Collect all unique nodes in first-appearance order
  const nodeSet = new Set<string>();
  for (const link of links) {
    nodeSet.add(link.source);
    nodeSet.add(link.target);
  }
  const allNodes = Array.from(nodeSet);

  if (order === 'name') {
    return allNodes.slice().sort((a, b) => a.localeCompare(b));
  }

  if (order === 'degree') {
    const degree = new Map<string, number>();
    for (const node of allNodes) degree.set(node, 0);
    for (const link of links) {
      degree.set(link.source, degree.get(link.source)! + link.value);
      degree.set(link.target, degree.get(link.target)! + link.value);
    }
    return allNodes.slice().sort((a, b) => {
      const diff = degree.get(b)! - degree.get(a)!;
      return diff !== 0 ? diff : a.localeCompare(b);
    });
  }

  if (order === 'group') {
    if (groups.length > 0) {
      // Explicit groups: order by ## header order, appearance within each group
      const ordered: string[] = [];
      const placed = new Set<string>();
      for (const group of groups) {
        for (const node of group.nodes) {
          if (!placed.has(node)) {
            ordered.push(node);
            placed.add(node);
          }
        }
      }
      // Orphans at end in first-appearance order
      for (const node of allNodes) {
        if (!placed.has(node)) {
          ordered.push(node);
          placed.add(node);
        }
      }
      return ordered;
    }
    // No explicit groups: connectivity clustering via BFS
    const adj = new Map<string, Set<string>>();
    for (const node of allNodes) adj.set(node, new Set());
    for (const link of links) {
      adj.get(link.source)!.add(link.target);
      adj.get(link.target)!.add(link.source);
    }

    const degree = new Map<string, number>();
    for (const node of allNodes) degree.set(node, 0);
    for (const link of links) {
      degree.set(link.source, degree.get(link.source)! + link.value);
      degree.set(link.target, degree.get(link.target)! + link.value);
    }

    const visited = new Set<string>();
    const components: string[][] = [];

    const remaining = new Set(allNodes);
    while (remaining.size > 0) {
      // Pick highest-degree unvisited node as BFS root
      let root = '';
      let maxDeg = -1;
      for (const node of remaining) {
        if (degree.get(node)! > maxDeg) {
          maxDeg = degree.get(node)!;
          root = node;
        }
      }
      // BFS
      const component: string[] = [];
      const queue = [root];
      visited.add(root);
      remaining.delete(root);
      while (queue.length > 0) {
        const curr = queue.shift()!;
        component.push(curr);
        for (const neighbor of adj.get(curr)!) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            remaining.delete(neighbor);
            queue.push(neighbor);
          }
        }
      }
      components.push(component);
    }
    // Sort components by size descending
    components.sort((a, b) => b.length - a.length);
    return components.flat();
  }

  // 'appearance' — first-appearance order (default)
  return allNodes;
}

// ============================================================
// Arc Diagram Renderer
// ============================================================

const ARC_MARGIN = { top: 60, right: 40, bottom: 60, left: 40 };

/**
 * Renders an arc diagram into the given container using D3.
 */
export function renderArcDiagram(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  _isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { links, title, orientation, arcOrder, arcNodeGroups } = parsed;
  if (links.length === 0) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, mutedColor, bgColor, colors } = init;

  const isVertical = orientation === 'vertical';
  const margin = isVertical
    ? {
        top: ARC_MARGIN.top,
        right: ARC_MARGIN.right,
        bottom: ARC_MARGIN.bottom,
        left: 120,
      }
    : ARC_MARGIN;

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Order nodes by selected strategy
  const nodes = orderArcNodes(links, arcOrder, arcNodeGroups);

  // Build node color map from group colors
  const nodeColorMap = new Map<string, string>();
  for (const group of arcNodeGroups) {
    if (group.color) {
      for (const node of group.nodes) {
        if (!nodeColorMap.has(node)) {
          nodeColorMap.set(node, group.color);
        }
      }
    }
  }

  // Build group-to-nodes lookup for group hover
  const groupNodeSets = new Map<string, Set<string>>();
  for (const group of arcNodeGroups) {
    groupNodeSets.set(group.name, new Set(group.nodes));
  }

  // Scales
  const values = links.map((l) => l.value);
  const [minVal, maxVal] = d3Array.extent(values) as [number, number];
  const strokeScale = d3Scale
    .scaleLinear()
    .domain([minVal, maxVal])
    .range([1.5, 6]);

  const g = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Title
  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  // Build adjacency map for hover interactions
  const neighbors = new Map<string, Set<string>>();
  for (const node of nodes) neighbors.set(node, new Set());
  for (const link of links) {
    neighbors.get(link.source)!.add(link.target);
    neighbors.get(link.target)!.add(link.source);
  }

  const FADE_OPACITY = 0.1;

  function handleMouseEnter(hovered: string) {
    const connected = neighbors.get(hovered)!;

    g.selectAll<SVGPathElement, unknown>('.arc-link').each(function () {
      const el = d3Selection.select(this);
      const src = el.attr('data-source');
      const tgt = el.attr('data-target');
      const isRelated = src === hovered || tgt === hovered;
      el.attr('stroke-opacity', isRelated ? 0.85 : FADE_OPACITY);
    });

    g.selectAll<SVGGElement, unknown>('.arc-node').each(function () {
      const el = d3Selection.select(this);
      const name = el.attr('data-node');
      const isRelated = name === hovered || connected.has(name!);
      el.attr('opacity', isRelated ? 1 : FADE_OPACITY);
    });
  }

  function handleMouseLeave() {
    g.selectAll<SVGPathElement, unknown>('.arc-link').attr(
      'stroke-opacity',
      0.7
    );
    g.selectAll<SVGGElement, unknown>('.arc-node').attr('opacity', 1);
    g.selectAll<SVGRectElement, unknown>('.arc-group-band').attr(
      'fill-opacity',
      0.06
    );
    g.selectAll<SVGTextElement, unknown>('.arc-group-label').attr(
      'fill-opacity',
      0.5
    );
  }

  function handleGroupEnter(groupName: string) {
    const members = groupNodeSets.get(groupName);
    if (!members) return;

    g.selectAll<SVGPathElement, unknown>('.arc-link').each(function () {
      const el = d3Selection.select(this);
      const isRelated =
        members.has(el.attr('data-source')!) ||
        members.has(el.attr('data-target')!);
      el.attr('stroke-opacity', isRelated ? 0.85 : FADE_OPACITY);
    });

    g.selectAll<SVGGElement, unknown>('.arc-node').each(function () {
      const el = d3Selection.select(this);
      el.attr('opacity', members.has(el.attr('data-node')!) ? 1 : FADE_OPACITY);
    });

    g.selectAll<SVGRectElement, unknown>('.arc-group-band').each(function () {
      const el = d3Selection.select(this);
      el.attr(
        'fill-opacity',
        el.attr('data-group') === groupName ? 0.18 : 0.03
      );
    });

    g.selectAll<SVGTextElement, unknown>('.arc-group-label').each(function () {
      const el = d3Selection.select(this);
      el.attr('fill-opacity', el.attr('data-group') === groupName ? 1 : 0.2);
    });
  }

  if (isVertical) {
    // Vertical layout: nodes along Y axis, arcs curve to the right
    const yScale = d3Scale
      .scalePoint<string>()
      .domain(nodes)
      .range([0, innerHeight])
      .padding(0.5);

    const baseX = innerWidth / 2;

    // Group bands (shaded regions bounding grouped nodes)
    if (arcNodeGroups.length > 0) {
      const bandPad = (yScale.step?.() ?? 20) * 0.4;
      const bandHalfW = 60;
      for (const group of arcNodeGroups) {
        const groupNodes = group.nodes.filter((n) => nodes.includes(n));
        if (groupNodes.length === 0) continue;
        const positions = groupNodes.map((n) => yScale(n)!);
        const minY = Math.min(...positions) - bandPad;
        const maxY = Math.max(...positions) + bandPad;

        g.append('rect')
          .attr('class', 'arc-group-band')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', baseX - bandHalfW)
          .attr('y', minY)
          .attr('width', bandHalfW * 2)
          .attr('height', maxY - minY)
          .attr('rx', 4)
          .attr('fill', textColor)
          .attr('fill-opacity', 0.06)
          .style('cursor', 'pointer')
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });

        g.append('text')
          .attr('class', 'arc-group-label')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', baseX - bandHalfW + 6)
          .attr('y', minY + 14)
          .attr('fill', textColor)
          .attr('font-size', '12px')
          .attr('font-weight', '600')
          .attr('fill-opacity', 0.5)
          .style('cursor', onClickItem ? 'pointer' : 'default')
          .text(group.name)
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });
      }
    }

    // Dashed vertical baseline
    g.append('line')
      .attr('x1', baseX)
      .attr('y1', 0)
      .attr('x2', baseX)
      .attr('y2', innerHeight)
      .attr('stroke', mutedColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');

    // Arcs
    links.forEach((link, idx) => {
      const y1 = yScale(link.source)!;
      const y2 = yScale(link.target)!;
      const midY = (y1 + y2) / 2;
      const distance = Math.abs(y2 - y1);
      const controlX = baseX + distance * 0.4;
      const color = link.color ?? colors[idx % colors.length];

      g.append('path')
        .attr('class', 'arc-link')
        .attr('data-source', link.source)
        .attr('data-target', link.target)
        .attr('data-line-number', String(link.lineNumber))
        .attr('d', `M ${baseX},${y1} Q ${controlX},${midY} ${baseX},${y2}`)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', strokeScale(link.value))
        .attr('stroke-opacity', 0.7)
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .on('click', () => {
          if (onClickItem && link.lineNumber) onClickItem(link.lineNumber);
        });
    });

    // Node circles and labels
    for (const node of nodes) {
      const y = yScale(node)!;
      const nodeColor = nodeColorMap.get(node) ?? textColor;
      // Find the first link involving this node (for line number and click target)
      const nodeLink = links.find(
        (l) => l.source === node || l.target === node
      );

      const nodeG = g
        .append('g')
        .attr('class', 'arc-node')
        .attr('data-node', node)
        .attr(
          'data-line-number',
          nodeLink?.lineNumber ? String(nodeLink.lineNumber) : null
        )
        .style('cursor', 'pointer')
        .on('mouseenter', () => handleMouseEnter(node))
        .on('mouseleave', handleMouseLeave)
        .on('click', () => {
          if (onClickItem && nodeLink?.lineNumber)
            onClickItem(nodeLink.lineNumber);
        });

      nodeG
        .append('circle')
        .attr('cx', baseX)
        .attr('cy', y)
        .attr('r', 5)
        .attr('fill', nodeColor)
        .attr('stroke', bgColor)
        .attr('stroke-width', 1.5);

      // Label to the left of baseline
      nodeG
        .append('text')
        .attr('x', baseX - 14)
        .attr('y', y)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', '11px')
        .text(node);
    }
  } else {
    // Horizontal layout (default): nodes along X axis, arcs curve upward
    const xScale = d3Scale
      .scalePoint<string>()
      .domain(nodes)
      .range([0, innerWidth])
      .padding(0.5);

    const baseY = innerHeight / 2;

    // Group bands (shaded regions bounding grouped nodes)
    if (arcNodeGroups.length > 0) {
      const bandPad = (xScale.step?.() ?? 20) * 0.4;
      const bandHalfH = 40;
      for (const group of arcNodeGroups) {
        const groupNodes = group.nodes.filter((n) => nodes.includes(n));
        if (groupNodes.length === 0) continue;
        const positions = groupNodes.map((n) => xScale(n)!);
        const minX = Math.min(...positions) - bandPad;
        const maxX = Math.max(...positions) + bandPad;

        g.append('rect')
          .attr('class', 'arc-group-band')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', minX)
          .attr('y', baseY - bandHalfH)
          .attr('width', maxX - minX)
          .attr('height', bandHalfH * 2)
          .attr('rx', 4)
          .attr('fill', textColor)
          .attr('fill-opacity', 0.06)
          .style('cursor', 'pointer')
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });

        g.append('text')
          .attr('class', 'arc-group-label')
          .attr('data-group', group.name)
          .attr('data-line-number', String(group.lineNumber))
          .attr('x', (minX + maxX) / 2)
          .attr('y', baseY + bandHalfH - 4)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-size', '12px')
          .attr('font-weight', '600')
          .attr('fill-opacity', 0.5)
          .style('cursor', onClickItem ? 'pointer' : 'default')
          .text(group.name)
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });
      }
    }

    // Dashed horizontal baseline
    g.append('line')
      .attr('x1', 0)
      .attr('y1', baseY)
      .attr('x2', innerWidth)
      .attr('y2', baseY)
      .attr('stroke', mutedColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');

    // Arcs
    links.forEach((link, idx) => {
      const x1 = xScale(link.source)!;
      const x2 = xScale(link.target)!;
      const midX = (x1 + x2) / 2;
      const distance = Math.abs(x2 - x1);
      const controlY = baseY - distance * 0.4;
      const color = link.color ?? colors[idx % colors.length];

      g.append('path')
        .attr('class', 'arc-link')
        .attr('data-source', link.source)
        .attr('data-target', link.target)
        .attr('data-line-number', String(link.lineNumber))
        .attr('d', `M ${x1},${baseY} Q ${midX},${controlY} ${x2},${baseY}`)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', strokeScale(link.value))
        .attr('stroke-opacity', 0.7)
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .on('click', () => {
          if (onClickItem && link.lineNumber) onClickItem(link.lineNumber);
        });
    });

    // Node circles and labels
    for (const node of nodes) {
      const x = xScale(node)!;
      const nodeColor = nodeColorMap.get(node) ?? textColor;
      // Find the first link involving this node (for line number and click target)
      const nodeLink = links.find(
        (l) => l.source === node || l.target === node
      );

      const nodeG = g
        .append('g')
        .attr('class', 'arc-node')
        .attr('data-node', node)
        .attr(
          'data-line-number',
          nodeLink?.lineNumber ? String(nodeLink.lineNumber) : null
        )
        .style('cursor', 'pointer')
        .on('mouseenter', () => handleMouseEnter(node))
        .on('mouseleave', handleMouseLeave)
        .on('click', () => {
          if (onClickItem && nodeLink?.lineNumber)
            onClickItem(nodeLink.lineNumber);
        });

      nodeG
        .append('circle')
        .attr('cx', x)
        .attr('cy', baseY)
        .attr('r', 5)
        .attr('fill', nodeColor)
        .attr('stroke', bgColor)
        .attr('stroke-width', 1.5);

      // Label below baseline
      nodeG
        .append('text')
        .attr('x', x)
        .attr('y', baseY + 20)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', '11px')
        .text(node);
    }
  }
}

// ============================================================
// Timeline Era Bands
// ============================================================

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
  tooltip: HTMLDivElement | null = null,
  palette?: PaletteColors
): void {
  const eraColors = palette
    ? getEraColors(palette)
    : ['#5e81ac', '#a3be8c', '#ebcb8b', '#d08770', '#b48ead'];
  eras.forEach((era, i) => {
    const startVal = parseTimelineDate(era.startDate);
    const endVal = parseTimelineDate(era.endDate);
    const start = scale(startVal);
    const end = scale(endVal);
    const color = era.color || eraColors[i % eraColors.length];

    const eraG = g
      .append('g')
      .attr('class', 'tl-era')
      .attr('data-line-number', String(era.lineNumber))
      .attr('data-era-start', String(startVal))
      .attr('data-era-end', String(endVal))
      .style('cursor', 'pointer')
      .on('mouseenter', function (event: MouseEvent) {
        onEnter(startVal, endVal);
        if (tooltip) showTooltip(tooltip, buildEraTooltipHtml(era), event);
      })
      .on('mouseleave', function () {
        onLeave();
        if (tooltip) hideTooltip(tooltip);
      })
      .on('mousemove', function (event: MouseEvent) {
        if (tooltip) showTooltip(tooltip, buildEraTooltipHtml(era), event);
      });

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
      eraG
        .append('text')
        .attr('x', 6)
        .attr('y', y + 18)
        .attr('text-anchor', 'start')
        .attr('fill', color)
        .attr('font-size', '13px')
        .attr('font-weight', '600')
        .attr('opacity', 0.8)
        .text(era.label);
    } else {
      const x = Math.min(start, end);
      const w = Math.abs(end - start);
      // When scale is on, extend the shading above the chart area
      // so the label sits above the scale marks but inside the band.
      const rectTop = hasScale ? -48 : 0;
      eraG
        .append('rect')
        .attr('x', x)
        .attr('y', rectTop)
        .attr('width', w)
        .attr('height', innerHeight - rectTop)
        .attr('fill', color)
        .attr('opacity', 0.08);
      eraG
        .append('text')
        .attr('x', x + w / 2)
        .attr('y', hasScale ? -32 : 18)
        .attr('text-anchor', 'middle')
        .attr('fill', color)
        .attr('font-size', '13px')
        .attr('font-weight', '600')
        .attr('opacity', 0.8)
        .text(era.label);
    }
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
  _hasScale: boolean = false,
  tooltip: HTMLDivElement | null = null,
  palette?: PaletteColors
): void {
  // Default marker color - bright orange/red that "pops"
  const defaultColor = palette?.accent || '#d08770';

  markers.forEach((marker) => {
    const dateVal = parseTimelineDate(marker.date);
    const pos = scale(dateVal);
    const color = marker.color || defaultColor;
    const lineOpacity = 0.5;
    const diamondSize = 5;

    const markerG = g
      .append('g')
      .attr('class', 'tl-marker')
      .attr('data-marker-date', String(dateVal))
      .attr('data-line-number', String(marker.lineNumber))
      .style('cursor', 'pointer')
      .on('mouseenter', function (event: MouseEvent) {
        if (tooltip) {
          showTooltip(tooltip, formatDateLabel(marker.date), event);
        }
      })
      .on('mouseleave', function () {
        if (tooltip) hideTooltip(tooltip);
      })
      .on('mousemove', function (event: MouseEvent) {
        if (tooltip) {
          showTooltip(tooltip, formatDateLabel(marker.date), event);
        }
      });

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
    } else {
      // Horizontal orientation: vertical dashed line down the chart
      // Label above diamond, diamond below, then dashed line to chart bottom
      const labelY = 6;
      const diamondY = labelY + 14;

      // Label above diamond
      markerG
        .append('text')
        .attr('x', pos)
        .attr('y', labelY)
        .attr('text-anchor', 'middle')
        .attr('fill', color)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .text(marker.label);

      // Diamond below label
      markerG
        .append('path')
        .attr(
          'd',
          `M${pos},${diamondY - diamondSize} l${diamondSize},${diamondSize} l-${diamondSize},${diamondSize} l-${diamondSize},-${diamondSize} Z`
        )
        .attr('fill', color)
        .attr('opacity', 0.9);

      // Line starts from bottom of diamond and goes down to chart bottom
      markerG
        .append('line')
        .attr('x1', pos)
        .attr('y1', diamondY + diamondSize)
        .attr('x2', pos)
        .attr('y2', innerHeight)
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '6 4')
        .attr('opacity', lineOpacity);
    }
  });
}

// ============================================================
// Timeline Time Scale
// ============================================================

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Converts a DSL date string (YYYY, YYYY-MM, YYYY-MM-DD, or YYYY-MM-DD HH:MM) to a human-readable label.
 *   '1718'              → '1718'
 *   '1718-05'           → 'May 1718'
 *   '1718-05-22'        → 'May 22, 1718'
 *   '2024-06-15 14:30'  → 'Jun 15, 2024 14:30'
 */
export function formatDateLabel(dateStr: string): string {
  // Split off optional time component
  const spaceIdx = dateStr.indexOf(' ');
  let datePart = dateStr;
  let timeSuffix = '';

  if (spaceIdx !== -1) {
    datePart = dateStr.slice(0, spaceIdx);
    timeSuffix = ' ' + dateStr.slice(spaceIdx + 1);
  }

  const parts = datePart.split('-');
  const year = parts[0];
  if (parts.length === 1) return year + timeSuffix;
  const month = MONTH_ABBR[parseInt(parts[1], 10) - 1];
  if (parts.length === 2) return `${month} ${year}${timeSuffix}`;
  const day = parseInt(parts[2], 10);
  return `${month} ${day}, ${year}${timeSuffix}`;
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
 * Computes adaptive tick marks for a timeline scale.
 * - Multi-year spans → year ticks
 * - Within ~1 year → month ticks
 * - Within ~3 months → week ticks (1st, 8th, 15th, 22nd)
 *
 * Optional boundary parameters add ticks at exact data start/end:
 * - boundaryStart/boundaryEnd: numeric date values
 * - boundaryStartLabel/boundaryEndLabel: formatted labels for those dates
 */
export function computeTimeTicks(
  domainMin: number,
  domainMax: number,
  scale: d3Scale.ScaleLinear<number, number>,
  boundaryStart?: number,
  boundaryEnd?: number,
  boundaryStartLabel?: string,
  boundaryEndLabel?: string
): { pos: number; label: string }[] {
  const minYear = Math.floor(domainMin);
  const maxYear = Math.floor(domainMax);
  const span = domainMax - domainMin;

  let ticks: { pos: number; label: string }[] = [];

  // Year ticks for multi-year spans (need at least 2 boundaries)
  const firstYear = Math.ceil(domainMin);
  const lastYear = Math.floor(domainMax);
  if (lastYear >= firstYear + 1) {
    // Decimate ticks for long spans so labels don't overlap
    const yearSpan = lastYear - firstYear;
    let step = 1;
    if (yearSpan > 80) step = 20;
    else if (yearSpan > 40) step = 10;
    else if (yearSpan > 20) step = 5;
    else if (yearSpan > 10) step = 2;

    // Align to step boundary so ticks land on round years (1700, 1710, …)
    const alignedFirst = Math.ceil(firstYear / step) * step;
    for (let y = alignedFirst; y <= lastYear; y += step) {
      ticks.push({ pos: scale(y), label: String(y) });
    }
  } else if (span > 0.25) {
    // Month ticks for spans > ~3 months
    const crossesYear = maxYear > minYear;
    for (let y = minYear; y <= maxYear + 1; y++) {
      for (let m = 1; m <= 12; m++) {
        const val = y + (m - 1) / 12;
        if (val > domainMax) break;
        if (val >= domainMin) {
          ticks.push({
            pos: scale(val),
            label: crossesYear
              ? `${MONTH_ABBR[m - 1]} '${String(y).slice(-2)}`
              : MONTH_ABBR[m - 1],
          });
        }
      }
    }
  } else if (span <= 0.000685) {
    // Minute ticks for spans ≤ ~6 hours
    // Adaptive step: >3h → 30min, >1h → 15min, >30min → 10min, else 5min
    let stepMin = 5;
    const spanHours = span * 8760;
    if (spanHours > 3) stepMin = 30;
    else if (spanHours > 1) stepMin = 15;
    else if (spanHours > 0.5) stepMin = 10;

    // Iterate from the start hour boundary
    const startDate = fractionalYearToDate(domainMin);
    // Round down to nearest step boundary
    startDate.setMinutes(
      Math.floor(startDate.getMinutes() / stepMin) * stepMin,
      0,
      0
    );

    while (true) {
      const val = dateToFractionalYear(startDate);
      if (val > domainMax) break;
      if (val >= domainMin) {
        const hh = String(startDate.getHours()).padStart(2, '0');
        const mm = String(startDate.getMinutes()).padStart(2, '0');
        ticks.push({ pos: scale(val), label: `${hh}:${mm}` });
      }
      startDate.setMinutes(startDate.getMinutes() + stepMin);
    }
  } else if (span <= 0.00822) {
    // Hour ticks for spans ≤ ~3 days
    // Adaptive step: >2d → 6h, >1d → 3h, >12h → 2h, else 1h
    let stepHour = 1;
    const spanHours = span * 8760;
    if (spanHours > 48) stepHour = 6;
    else if (spanHours > 24) stepHour = 3;
    else if (spanHours > 12) stepHour = 2;

    // For single-day spans, just show HH:MM without the date prefix
    const singleDay = spanHours <= 24;

    const startDate = fractionalYearToDate(domainMin);
    // Round down to nearest step boundary
    startDate.setHours(
      Math.floor(startDate.getHours() / stepHour) * stepHour,
      0,
      0,
      0
    );

    while (true) {
      const val = dateToFractionalYear(startDate);
      if (val > domainMax) break;
      if (val >= domainMin) {
        const hh = String(startDate.getHours()).padStart(2, '0');
        const mm = String(startDate.getMinutes()).padStart(2, '0');
        if (singleDay) {
          ticks.push({ pos: scale(val), label: `${hh}:${mm}` });
        } else {
          const mon = MONTH_ABBR[startDate.getMonth()];
          const d = startDate.getDate();
          ticks.push({ pos: scale(val), label: `${mon} ${d} ${hh}:${mm}` });
        }
      }
      startDate.setHours(startDate.getHours() + stepHour);
    }
  } else {
    // Week ticks for spans ≤ ~3 months (1st, 8th, 15th, 22nd of each month)
    for (let y = minYear; y <= maxYear + 1; y++) {
      for (let m = 1; m <= 12; m++) {
        for (const d of [1, 8, 15, 22]) {
          const val = y + (m - 1) / 12 + (d - 1) / 365;
          if (val > domainMax) break;
          if (val >= domainMin) {
            ticks.push({
              pos: scale(val),
              label: `${MONTH_ABBR[m - 1]} ${d}`,
            });
          }
        }
      }
    }
  }

  // Add boundary ticks at exact data start/end if provided
  // When a boundary tick collides with a standard tick, replace the standard tick
  const collisionThreshold = 40; // pixels

  if (boundaryStart !== undefined && boundaryStartLabel) {
    const boundaryPos = scale(boundaryStart);
    // Remove any standard ticks that would collide with the start boundary
    ticks = ticks.filter(
      (t) => Math.abs(t.pos - boundaryPos) >= collisionThreshold
    );
    ticks.unshift({ pos: boundaryPos, label: boundaryStartLabel });
  }

  if (boundaryEnd !== undefined && boundaryEndLabel) {
    const boundaryPos = scale(boundaryEnd);
    // Remove any standard ticks that would collide with the end boundary
    ticks = ticks.filter(
      (t) => Math.abs(t.pos - boundaryPos) >= collisionThreshold
    );
    ticks.push({ pos: boundaryPos, label: boundaryEndLabel });
  }

  return ticks;
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
  const [domainMin, domainMax] = scale.domain();
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

// ============================================================
// Timeline Tooltip Helpers
// ============================================================

function createTooltip(
  container: HTMLElement,
  palette: PaletteColors,
  isDark: boolean
): HTMLDivElement {
  container.style.position = 'relative';

  // Reuse existing tooltip element if present (avoids DOM churn on re-renders)
  const existing = container.querySelector<HTMLDivElement>('[data-d3-tooltip]');
  if (existing) {
    existing.style.display = 'none';
    existing.style.background = palette.surface;
    existing.style.color = palette.text;
    existing.style.boxShadow = isDark
      ? '0 2px 6px rgba(0,0,0,0.3)'
      : '0 2px 6px rgba(0,0,0,0.12)';
    return existing;
  }

  const tip = document.createElement('div');
  tip.setAttribute('data-d3-tooltip', '');
  tip.style.position = 'absolute';
  tip.style.display = 'none';
  tip.style.pointerEvents = 'none';
  tip.style.background = palette.surface;
  tip.style.color = palette.text;
  tip.style.padding = '6px 10px';
  tip.style.borderRadius = '4px';
  tip.style.fontSize = '12px';
  tip.style.lineHeight = '1.4';
  tip.style.whiteSpace = 'nowrap';
  tip.style.zIndex = '10';
  tip.style.boxShadow = isDark
    ? '0 2px 6px rgba(0,0,0,0.3)'
    : '0 2px 6px rgba(0,0,0,0.12)';
  container.appendChild(tip);
  return tip;
}

function showTooltip(
  tooltip: HTMLDivElement,
  html: string,
  event: MouseEvent
): void {
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  const container = tooltip.parentElement!;
  const rect = container.getBoundingClientRect();
  let left = event.clientX - rect.left + 12;
  let top = event.clientY - rect.top - 28;
  // Clamp so tooltip stays inside the container
  const tipW = tooltip.offsetWidth;
  const tipH = tooltip.offsetHeight;
  if (left + tipW > rect.width) left = rect.width - tipW - 4;
  if (top < 0) top = event.clientY - rect.top + 16;
  if (top + tipH > rect.height) top = rect.height - tipH - 4;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip(tooltip: HTMLDivElement): void {
  tooltip.style.display = 'none';
}

function buildEventTooltipHtml(ev: TimelineEvent): string {
  const datePart = ev.endDate
    ? `${formatDateLabel(ev.date)} → ${formatDateLabel(ev.endDate)}`
    : formatDateLabel(ev.date);
  return `<strong>${ev.label}</strong><br>${datePart}`;
}

function buildEraTooltipHtml(era: TimelineEra): string {
  return `<strong>${era.label}</strong><br>${formatDateLabel(era.startDate)} → ${formatDateLabel(era.endDate)}`;
}

// ============================================================
// Timeline Renderer
// ============================================================

/**
 * Renders a timeline chart into the given container using D3.
 * Supports horizontal (default) and vertical orientation.
 */
export function renderTimeline(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
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
  viewMode?: boolean
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const {
    timelineEvents,
    timelineGroups,
    timelineEras,
    timelineMarkers,
    timelineSort,
    timelineScale,
    timelineSwimlanes,
    title,
    orientation,
  } = parsed;
  if (timelineEvents.length === 0) return;

  // When sort: tag is set and no explicit swimlane param, use the default
  if (
    swimlaneTagGroup == null &&
    timelineSort === 'tag' &&
    parsed.timelineDefaultSwimlaneTG
  ) {
    swimlaneTagGroup = parsed.timelineDefaultSwimlaneTG;
  }

  const tooltip = createTooltip(container, palette, isDark);

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const isVertical = orientation === 'vertical';

  // Theme colors
  const textColor = palette.text;
  const mutedColor = palette.border;
  const bgColor = palette.bg;
  const bg = isDark ? palette.surface : palette.bg;
  const colors = getSeriesColors(palette);

  // Assign colors to groups
  const groupColorMap = new Map<string, string>();
  timelineGroups.forEach((grp, i) => {
    groupColorMap.set(grp.name, grp.color ?? colors[i % colors.length]);
  });

  // When tag-based swimlanes are active, compute lanes from tag values
  // and populate groupColorMap with tag entry colors for lane headers.
  type Lane = { name: string; events: TimelineEvent[] };
  let tagLanes: Lane[] | null = null;

  if (swimlaneTagGroup) {
    const tagKey = swimlaneTagGroup.toLowerCase();
    const tagGroup = parsed.timelineTagGroups.find(
      (g) => g.name.toLowerCase() === tagKey
    );
    if (tagGroup) {
      // Collect events per tag value
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

      // Order lanes by earliest event date
      const laneEntries = [...buckets.entries()].sort((a, b) => {
        const aMin = Math.min(...a[1].map((e) => parseTimelineDate(e.date)));
        const bMin = Math.min(...b[1].map((e) => parseTimelineDate(e.date)));
        return aMin - bMin;
      });

      tagLanes = laneEntries.map(([name, events]) => ({ name, events }));
      if (otherEvents.length > 0) {
        tagLanes.push({ name: '(Other)', events: otherEvents });
      }

      // Populate groupColorMap from tag entry colors
      for (const entry of tagGroup.entries) {
        groupColorMap.set(entry.value, entry.color);
      }
    }
  }

  // Determine effective color source: explicit colorTG > swimlaneTG > group
  const effectiveColorTG = activeTagGroup ?? swimlaneTagGroup ?? null;

  function eventColor(ev: TimelineEvent): string {
    // Tag color takes priority when a tag group is active
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

  // Convert dates to numeric values and find boundary dates
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
  const datePadding = (maxDate - minDate) * 0.05 || 0.5;

  const FADE_OPACITY = 0.1;

  // ------------------------------------------------------------------
  // Shared hover helpers (operate on CSS classes, orientation-agnostic)
  // ------------------------------------------------------------------

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
    // Fade legend entry dots/labels that don't match (keep group pill visible)
    g.selectAll<SVGGElement, unknown>('.tl-tag-legend-entry').each(function () {
      const el = d3Selection.select(this);
      const entryValue = el.attr('data-legend-entry');
      if (entryValue === '__group__') return; // keep group pill at full opacity
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

  // Reserve space for tag legend at the top of chart content (below title/headers)
  const tagLegendReserve = parsed.timelineTagGroups.length > 0 ? 36 : 0;

  // ================================================================
  // VERTICAL orientation (time flows top→bottom)
  // ================================================================
  if (isVertical) {
    const useGroupedVertical =
      tagLanes != null ||
      (timelineSort === 'group' && timelineGroups.length > 0);
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
      const scaleMargin = timelineScale ? 40 : 0;
      const markerMargin = timelineMarkers.length > 0 ? 30 : 0;
      const margin = {
        top: 104 + markerMargin + tagLegendReserve,
        right: 40 + scaleMargin,
        bottom: 40,
        left: 60 + scaleMargin,
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
          .attr('y', -15)
          .attr('text-anchor', 'middle')
          .attr('fill', laneColor)
          .attr('font-size', '12px')
          .attr('font-weight', '600')
          .text(laneName);

        g.append('line')
          .attr('x1', laneCenter)
          .attr('y1', 0)
          .attr('x2', laneCenter)
          .attr('y2', innerHeight)
          .attr('stroke', mutedColor)
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4,4');

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

            let fill: string = mix(evColor, bg, 30);
            let stroke: string = evColor;
            if (ev.uncertain) {
              const gradientId = `uncertain-vg-${ev.lineNumber}`;
              const strokeGradientId = `uncertain-vg-s-${ev.lineNumber}`;
              const defs =
                svg.select('defs').node() || svg.append('defs').node();
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
              .attr('x', laneCenter - 6)
              .attr('y', y)
              .attr('width', 12)
              .attr('height', rectH)
              .attr('rx', 4)
              .attr('fill', fill)
              .attr('stroke', stroke)
              .attr('stroke-width', 2);
            evG
              .append('text')
              .attr('x', laneCenter + 14)
              .attr('y', y + rectH / 2)
              .attr('dy', '0.35em')
              .attr('fill', textColor)
              .attr('font-size', '10px')
              .text(ev.label);
          } else {
            evG
              .append('circle')
              .attr('cx', laneCenter)
              .attr('cy', y)
              .attr('r', 4)
              .attr('fill', mix(evColor, bg, 30))
              .attr('stroke', evColor)
              .attr('stroke-width', 2);
            evG
              .append('text')
              .attr('x', laneCenter + 10)
              .attr('y', y)
              .attr('dy', '0.35em')
              .attr('fill', textColor)
              .attr('font-size', '10px')
              .text(ev.label);
          }
        }
      });
    } else {
      // === TIME SORT, vertical: single vertical axis ===
      const scaleMargin = timelineScale ? 40 : 0;
      const markerMargin = timelineMarkers.length > 0 ? 30 : 0;
      const margin = {
        top: 104 + markerMargin + tagLegendReserve,
        right: 200,
        bottom: 40,
        left: 60 + scaleMargin,
      };
      const innerWidth = width - margin.left - margin.right;
      const innerHeight = height - margin.top - margin.bottom;
      const axisX = 20;

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

      // Group legend
      if (timelineGroups.length > 0) {
        let legendX = 0;
        const legendY = -55;
        for (const grp of timelineGroups) {
          const color = groupColorMap.get(grp.name) ?? textColor;
          const itemG = g
            .append('g')
            .attr('class', 'tl-legend-item')
            .attr('data-group', grp.name)
            .style('cursor', 'pointer')
            .on('mouseenter', () => fadeToGroup(g, grp.name))
            .on('mouseleave', () => fadeReset(g));

          itemG
            .append('circle')
            .attr('cx', legendX)
            .attr('cy', legendY)
            .attr('r', 5)
            .attr('fill', color);

          itemG
            .append('text')
            .attr('x', legendX + 10)
            .attr('y', legendY)
            .attr('dy', '0.35em')
            .attr('fill', textColor)
            .attr('font-size', '11px')
            .text(grp.name);

          legendX += grp.name.length * 7 + 30;
        }
      }

      g.append('line')
        .attr('x1', axisX)
        .attr('y1', 0)
        .attr('x2', axisX)
        .attr('y2', innerHeight)
        .attr('stroke', mutedColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4');

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

          let fill: string = mix(color, bg, 30);
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
            .attr('x', axisX - 6)
            .attr('y', y)
            .attr('width', 12)
            .attr('height', rectH)
            .attr('rx', 4)
            .attr('fill', fill)
            .attr('stroke', stroke)
            .attr('stroke-width', 2);
          evG
            .append('text')
            .attr('x', axisX + 16)
            .attr('y', y + rectH / 2)
            .attr('dy', '0.35em')
            .attr('fill', textColor)
            .attr('font-size', '11px')
            .text(ev.label);
        } else {
          evG
            .append('circle')
            .attr('cx', axisX)
            .attr('cy', y)
            .attr('r', 4)
            .attr('fill', mix(color, bg, 30))
            .attr('stroke', color)
            .attr('stroke-width', 2);
          evG
            .append('text')
            .attr('x', axisX + 16)
            .attr('y', y)
            .attr('dy', '0.35em')
            .attr('fill', textColor)
            .attr('font-size', '11px')
            .text(ev.label);
        }

        // Date label to the left
        evG
          .append('text')
          .attr('x', axisX - 14)
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
          .attr('font-size', '10px')
          .text(ev.date + (ev.endDate ? `→${ev.endDate}` : ''));
      }
    }

    return; // vertical done
  }

  // ================================================================
  // HORIZONTAL orientation (default — time flows left→right)
  // Each event gets its own row, stacked vertically.
  // ================================================================

  const BAR_H = 22; // range bar thickness (tall enough for text inside)
  const GROUP_GAP = 12; // vertical gap between group swim-lanes

  const useGroupedHorizontal =
    tagLanes != null || (timelineSort === 'group' && timelineGroups.length > 0);
  if (useGroupedHorizontal) {
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

    const totalEventRows = lanes.reduce((s, l) => s + l.events.length, 0);
    const scaleMargin = timelineScale ? 24 : 0;
    const markerMargin = timelineMarkers.length > 0 ? 30 : 0;
    // Calculate left margin based on longest group name (~7px per char + padding)
    const maxGroupNameLen = Math.max(...lanes.map((l) => l.name.length));
    const dynamicLeftMargin = Math.max(120, maxGroupNameLen * 7 + 30);
    // Group-sorted doesn't need legend space (group names shown on left)
    const baseTopMargin = title ? 50 : 20;
    const margin = {
      top:
        baseTopMargin +
        (timelineScale ? 40 : 0) +
        markerMargin +
        tagLegendReserve,
      right: 40,
      bottom: 40 + scaleMargin,
      left: dynamicLeftMargin,
    };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const totalGaps = (lanes.length - 1) * GROUP_GAP;
    const rowH = Math.min(28, (innerHeight - totalGaps) / totalEventRows);

    const xScale = d3Scale
      .scaleLinear()
      .domain([minDate - datePadding, maxDate + datePadding])
      .range([0, innerWidth]);

    const svg = d3Selection
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
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
      xScale,
      false,
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
      xScale,
      false,
      innerWidth,
      innerHeight,
      timelineScale,
      tooltip,
      palette
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

    // Offset events below marker area when markers are present
    let curY = markerMargin;

    // Render swimlane backgrounds first (so they appear behind events)
    // Extend into left margin to include group names
    if (timelineSwimlanes || tagLanes) {
      let swimY = markerMargin;
      lanes.forEach((lane, idx) => {
        const laneSpan = lane.events.length * rowH;
        // Alternate between light gray and transparent for visual separation
        const fillColor = idx % 2 === 0 ? textColor : 'transparent';
        g.append('rect')
          .attr('class', 'tl-swimlane')
          .attr('data-group', lane.name)
          .attr('x', -margin.left)
          .attr('y', swimY)
          .attr('width', innerWidth + margin.left)
          .attr('height', laneSpan + (idx < lanes.length - 1 ? GROUP_GAP : 0))
          .attr('fill', fillColor)
          .attr('opacity', 0.06);
        swimY += laneSpan + GROUP_GAP;
      });
    }

    for (const lane of lanes) {
      const laneColor = groupColorMap.get(lane.name) ?? textColor;
      const laneSpan = lane.events.length * rowH;

      // Group label — left of lane, vertically centred
      const group = timelineGroups.find((grp) => grp.name === lane.name);
      const headerG = g
        .append('g')
        .attr('class', 'tl-lane-header')
        .attr('data-group', lane.name)
        .style('cursor', 'pointer')
        .on('mouseenter', () => fadeToGroup(g, lane.name))
        .on('mouseleave', () => fadeReset(g))
        .on('click', () => {
          if (onClickItem && group?.lineNumber) onClickItem(group.lineNumber);
        });

      headerG
        .append('text')
        .attr('x', -margin.left + 10)
        .attr('y', curY + laneSpan / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('fill', laneColor)
        .attr('font-size', '12px')
        .attr('font-weight', '600')
        .text(lane.name);

      lane.events.forEach((ev, i) => {
        const y = curY + i * rowH + rowH / 2;
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

        if (ev.endDate) {
          const x2 = xScale(parseTimelineDate(ev.endDate));
          const rectW = Math.max(x2 - x, 4);
          // Estimate label width (~7px per char at 13px font) + padding
          const estLabelWidth = ev.label.length * 7 + 16;
          const labelFitsInside = rectW >= estLabelWidth;

          let fill: string = mix(evColor, bg, 30);
          let stroke: string = evColor;
          if (ev.uncertain) {
            // Create gradient for uncertain end - fades last 20%
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
            .attr('y', y - BAR_H / 2)
            .attr('width', rectW)
            .attr('height', BAR_H)
            .attr('rx', 4)
            .attr('fill', fill)
            .attr('stroke', stroke)
            .attr('stroke-width', 2);

          if (labelFitsInside) {
            // Text inside bar - use textColor for readability on muted fill
            evG
              .append('text')
              .attr('x', x + 8)
              .attr('y', y)
              .attr('dy', '0.35em')
              .attr('text-anchor', 'start')
              .attr('fill', textColor)
              .attr('font-size', '14px')
              .attr('font-weight', '700')
              .text(ev.label);
          } else {
            // Text outside bar - check if it fits on left or must go right
            const wouldFlipLeft = x + rectW > innerWidth * 0.6;
            const labelFitsLeft = x - 6 - estLabelWidth > 0;
            const flipLeft = wouldFlipLeft && labelFitsLeft;
            evG
              .append('text')
              .attr('x', flipLeft ? x - 6 : x + rectW + 6)
              .attr('y', y)
              .attr('dy', '0.35em')
              .attr('text-anchor', flipLeft ? 'end' : 'start')
              .attr('fill', textColor)
              .attr('font-size', '13px')
              .text(ev.label);
          }
        } else {
          // Point event (no end date) - render as circle with label
          const estLabelWidth = ev.label.length * 7;
          // Only flip left if past 60% AND label fits without colliding with group name area
          const wouldFlipLeft = x > innerWidth * 0.6;
          const labelFitsLeft = x - 10 - estLabelWidth > 0;
          const flipLeft = wouldFlipLeft && labelFitsLeft;
          evG
            .append('circle')
            .attr('cx', x)
            .attr('cy', y)
            .attr('r', 5)
            .attr('fill', mix(evColor, bg, 30))
            .attr('stroke', evColor)
            .attr('stroke-width', 2);
          evG
            .append('text')
            .attr('x', flipLeft ? x - 10 : x + 10)
            .attr('y', y)
            .attr('dy', '0.35em')
            .attr('text-anchor', flipLeft ? 'end' : 'start')
            .attr('fill', textColor)
            .attr('font-size', '12px')
            .text(ev.label);
        }
      });

      curY += laneSpan + GROUP_GAP;
    }
  } else {
    // === TIME SORT, horizontal: each event on its own row ===
    const sorted = timelineEvents
      .slice()
      .sort((a, b) => parseTimelineDate(a.date) - parseTimelineDate(b.date));

    const scaleMargin = timelineScale ? 24 : 0;
    const markerMargin = timelineMarkers.length > 0 ? 30 : 0;
    const margin = {
      top: 104 + (timelineScale ? 40 : 0) + markerMargin + tagLegendReserve,
      right: 40,
      bottom: 40 + scaleMargin,
      left: 60,
    };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const rowH = Math.min(28, innerHeight / sorted.length);

    const xScale = d3Scale
      .scaleLinear()
      .domain([minDate - datePadding, maxDate + datePadding])
      .range([0, innerWidth]);

    const svg = d3Selection
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
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
      xScale,
      false,
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
      xScale,
      false,
      innerWidth,
      innerHeight,
      timelineScale,
      tooltip,
      palette
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

    // Group legend at top-left
    if (timelineGroups.length > 0) {
      let legendX = 0;
      const legendY = timelineScale ? -75 : -55;
      for (const grp of timelineGroups) {
        const color = groupColorMap.get(grp.name) ?? textColor;
        const itemG = g
          .append('g')
          .attr('class', 'tl-legend-item')
          .attr('data-group', grp.name)
          .style('cursor', 'pointer')
          .on('mouseenter', () => fadeToGroup(g, grp.name))
          .on('mouseleave', () => fadeReset(g));

        itemG
          .append('circle')
          .attr('cx', legendX)
          .attr('cy', legendY)
          .attr('r', 5)
          .attr('fill', color);

        itemG
          .append('text')
          .attr('x', legendX + 10)
          .attr('y', legendY)
          .attr('dy', '0.35em')
          .attr('fill', textColor)
          .attr('font-size', '11px')
          .text(grp.name);

        legendX += grp.name.length * 7 + 30;
      }
    }

    sorted.forEach((ev, i) => {
      // Offset events below marker area when markers are present
      const y = markerMargin + i * rowH + rowH / 2;
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
        // Estimate label width (~7px per char at 13px font) + padding
        const estLabelWidth = ev.label.length * 7 + 16;
        const labelFitsInside = rectW >= estLabelWidth;

        let fill: string = mix(color, bg, 30);
        let stroke: string = color;
        if (ev.uncertain) {
          // Create gradient for uncertain end - fades last 20%
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
          .attr('y', y - BAR_H / 2)
          .attr('width', rectW)
          .attr('height', BAR_H)
          .attr('rx', 4)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', 2);

        if (labelFitsInside) {
          // Text inside bar - use textColor for readability on muted fill
          evG
            .append('text')
            .attr('x', x + 8)
            .attr('y', y)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'start')
            .attr('fill', textColor)
            .attr('font-size', '14px')
            .attr('font-weight', '700')
            .text(ev.label);
        } else {
          // Text outside bar - check if it fits on left or must go right
          const wouldFlipLeft = x + rectW > innerWidth * 0.6;
          const labelFitsLeft = x - 6 - estLabelWidth > 0;
          const flipLeft = wouldFlipLeft && labelFitsLeft;
          evG
            .append('text')
            .attr('x', flipLeft ? x - 6 : x + rectW + 6)
            .attr('y', y)
            .attr('dy', '0.35em')
            .attr('text-anchor', flipLeft ? 'end' : 'start')
            .attr('fill', textColor)
            .attr('font-size', '13px')
            .text(ev.label);
        }
      } else {
        // Point event (no end date) - render as circle with label
        const estLabelWidth = ev.label.length * 7;
        // Only flip left if past 60% AND label fits without going off-chart
        const wouldFlipLeft = x > innerWidth * 0.6;
        const labelFitsLeft = x - 10 - estLabelWidth > 0;
        const flipLeft = wouldFlipLeft && labelFitsLeft;
        evG
          .append('circle')
          .attr('cx', x)
          .attr('cy', y)
          .attr('r', 5)
          .attr('fill', mix(color, bg, 30))
          .attr('stroke', color)
          .attr('stroke-width', 2);
        evG
          .append('text')
          .attr('x', flipLeft ? x - 10 : x + 10)
          .attr('y', y)
          .attr('dy', '0.35em')
          .attr('text-anchor', flipLeft ? 'end' : 'start')
          .attr('fill', textColor)
          .attr('font-size', '12px')
          .text(ev.label);
      }
    });
  }

  // ── Tag Legend (org-chart-style pills) ──
  if (parsed.timelineTagGroups.length > 0) {
    const LG_HEIGHT = TL_LEGEND_HEIGHT;
    const LG_PILL_PAD = TL_LEGEND_PILL_PAD;
    const LG_PILL_FONT_SIZE = TL_LEGEND_PILL_FONT_SIZE;
    const LG_CAPSULE_PAD = TL_LEGEND_CAPSULE_PAD;
    const LG_DOT_R = TL_LEGEND_DOT_R;
    const LG_ENTRY_FONT_SIZE = TL_LEGEND_ENTRY_FONT_SIZE;
    const LG_ENTRY_DOT_GAP = TL_LEGEND_ENTRY_DOT_GAP;
    const LG_ENTRY_TRAIL = TL_LEGEND_ENTRY_TRAIL;
    const LG_GROUP_GAP = TL_LEGEND_GROUP_GAP;
    const LG_ICON_W = 20; // swimlane icon area (icon + surrounding space) — local

    const mainSvg = d3Selection.select(container).select<SVGSVGElement>('svg');
    const mainG = mainSvg.select<SVGGElement>('g');
    if (!mainSvg.empty() && !mainG.empty()) {
      // Position legend at top, below title
      const legendY = title ? 50 : 10;

      const groupBg = isDark
        ? mix(palette.surface, palette.bg, 50)
        : mix(palette.surface, palette.bg, 30);

      // Pre-compute group widths (minified and expanded)
      type LegendGroup = {
        group: TagGroup;
        minifiedWidth: number;
        expandedWidth: number;
      };
      const legendGroups: LegendGroup[] = parsed.timelineTagGroups.map((g) => {
        const pillW =
          measureLegendText(g.name, LG_PILL_FONT_SIZE) + LG_PILL_PAD;
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

        // Compute total width and center horizontally in SVG
        const totalW =
          visibleGroups.reduce((s, lg) => {
            const isActive =
              viewMode ||
              (currentActiveGroup != null &&
                lg.group.name.toLowerCase() ===
                  currentActiveGroup.toLowerCase());
            return s + (isActive ? lg.expandedWidth : lg.minifiedWidth);
          }, 0) +
          (visibleGroups.length - 1) * LG_GROUP_GAP;

        let cx = (width - totalW) / 2;

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

        for (const lg of visibleGroups) {
          const groupKey = lg.group.name.toLowerCase();
          const isActive =
            viewMode ||
            (currentActiveGroup != null &&
              currentActiveGroup.toLowerCase() === groupKey);
          const isSwimActive =
            currentSwimlaneGroup != null &&
            currentSwimlaneGroup.toLowerCase() === groupKey;

          const pillLabel = lg.group.name;
          const pillWidth =
            measureLegendText(pillLabel, LG_PILL_FONT_SIZE) + LG_PILL_PAD;

          const gEl = legendContainer
            .append('g')
            .attr('transform', `translate(${cx}, ${legendY})`)
            .attr('class', 'tl-tag-legend-group tl-tag-legend-entry')
            .attr('data-legend-group', groupKey)
            .attr('data-tag-group', groupKey)
            .attr('data-legend-entry', '__group__');

          if (!viewMode) {
            gEl.style('cursor', 'pointer').on('click', () => {
              currentActiveGroup =
                currentActiveGroup === groupKey ? null : groupKey;
              drawLegend();
              recolorEvents();
              onTagStateChange?.(currentActiveGroup, currentSwimlaneGroup);
            });
          }

          // Outer capsule background (active only)
          if (isActive) {
            gEl
              .append('rect')
              .attr('width', lg.expandedWidth)
              .attr('height', LG_HEIGHT)
              .attr('rx', LG_HEIGHT / 2)
              .attr('fill', groupBg);
          }

          const pillXOff = isActive ? LG_CAPSULE_PAD : 0;
          const pillYOff = isActive ? LG_CAPSULE_PAD : 0;
          const pillH = LG_HEIGHT - (isActive ? LG_CAPSULE_PAD * 2 : 0);

          // Pill background
          gEl
            .append('rect')
            .attr('x', pillXOff)
            .attr('y', pillYOff)
            .attr('width', pillWidth)
            .attr('height', pillH)
            .attr('rx', pillH / 2)
            .attr('fill', isActive ? palette.bg : groupBg);

          // Active pill border
          if (isActive) {
            gEl
              .append('rect')
              .attr('x', pillXOff)
              .attr('y', pillYOff)
              .attr('width', pillWidth)
              .attr('height', pillH)
              .attr('rx', pillH / 2)
              .attr('fill', 'none')
              .attr('stroke', mix(palette.textMuted, palette.bg, 50))
              .attr('stroke-width', 0.75);
          }

          // Pill text
          gEl
            .append('text')
            .attr('x', pillXOff + pillWidth / 2)
            .attr('y', LG_HEIGHT / 2 + LG_PILL_FONT_SIZE / 2 - 2)
            .attr('font-size', LG_PILL_FONT_SIZE)
            .attr('font-weight', '500')
            .attr('font-family', FONT_FAMILY)
            .attr('fill', isActive ? palette.text : palette.textMuted)
            .attr('text-anchor', 'middle')
            .text(pillLabel);

          // Entries + swimlane icon inside capsule (active only)
          if (isActive) {
            // Swimlane icon (skip in view mode — non-interactive)
            let entryX: number;
            if (!viewMode) {
              const iconX = pillXOff + pillWidth + 5;
              const iconY = (LG_HEIGHT - 10) / 2; // vertically centered
              const iconEl = drawSwimlaneIcon(gEl, iconX, iconY, isSwimActive);
              iconEl
                .attr('data-swimlane-toggle', groupKey)
                .on('click', (event: MouseEvent) => {
                  event.stopPropagation();
                  currentSwimlaneGroup =
                    currentSwimlaneGroup === groupKey ? null : groupKey;
                  onTagStateChange?.(currentActiveGroup, currentSwimlaneGroup);
                  relayout();
                });
              entryX = pillXOff + pillWidth + LG_ICON_W + 4;
            } else {
              entryX = pillXOff + pillWidth + 8;
            }

            for (const entry of lg.group.entries) {
              const tagKey = lg.group.name.toLowerCase();
              const tagVal = entry.value.toLowerCase();

              const entryG = gEl
                .append('g')
                .attr('class', 'tl-tag-legend-entry')
                .attr('data-tag-group', tagKey)
                .attr('data-legend-entry', tagVal);

              if (!viewMode) {
                entryG
                  .style('cursor', 'pointer')
                  .on('mouseenter', (event: MouseEvent) => {
                    event.stopPropagation();
                    fadeToTagValue(mainG, tagKey, tagVal);
                    mainSvg
                      .selectAll<SVGGElement, unknown>('.tl-tag-legend-entry')
                      .each(function () {
                        const el = d3Selection.select(this);
                        const ev = el.attr('data-legend-entry');
                        if (ev === '__group__') return;
                        const eg = el.attr('data-tag-group');
                        el.attr(
                          'opacity',
                          eg === tagKey && ev === tagVal ? 1 : FADE_OPACITY
                        );
                      });
                  })
                  .on('mouseleave', (event: MouseEvent) => {
                    event.stopPropagation();
                    fadeReset(mainG);
                    mainSvg
                      .selectAll<SVGGElement, unknown>('.tl-tag-legend-entry')
                      .attr('opacity', 1);
                  })
                  .on('click', (event: MouseEvent) => {
                    event.stopPropagation();
                  });
              }

              entryG
                .append('circle')
                .attr('cx', entryX + LG_DOT_R)
                .attr('cy', LG_HEIGHT / 2)
                .attr('r', LG_DOT_R)
                .attr('fill', entry.color);

              const textX = entryX + LG_DOT_R * 2 + LG_ENTRY_DOT_GAP;
              entryG
                .append('text')
                .attr('x', textX)
                .attr('y', LG_HEIGHT / 2 + LG_ENTRY_FONT_SIZE / 2 - 1)
                .attr('font-size', LG_ENTRY_FONT_SIZE)
                .attr('font-family', FONT_FAMILY)
                .attr('fill', palette.textMuted)
                .text(entry.value);

              entryX =
                textX +
                measureLegendText(entry.value, LG_ENTRY_FONT_SIZE) +
                LG_ENTRY_TRAIL;
            }
          }

          cx += (isActive ? lg.expandedWidth : lg.minifiedWidth) + LG_GROUP_GAP;
        }
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
            .attr('fill', mix(color, bg, 30))
            .attr('stroke', color);
          el.selectAll('circle:not(.tl-event-point-outline)')
            .attr('fill', mix(color, bg, 30))
            .attr('stroke', color);
        });
      }

      drawLegend();
    }
  }
}

// ============================================================
// Word Cloud Helpers
// ============================================================

function getRotateFn(mode: WordCloudRotate): () => number {
  if (mode === 'mixed') return () => (Math.random() > 0.5 ? 0 : 90);
  if (mode === 'angled') return () => Math.round(Math.random() * 30 - 15);
  return () => 0;
}

// ============================================================
// Word Cloud Renderer
// ============================================================

/**
 * Renders a word cloud into the given container using d3-cloud.
 */
export function renderWordCloud(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  _isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { words, title, cloudOptions } = parsed;
  if (words.length === 0) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, colors } = init;

  const titleHeight = title ? 40 : 0;
  const cloudHeight = height - titleHeight;

  const { minSize, maxSize } = cloudOptions;
  const weights = words.map((w) => w.weight);
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const range = maxWeight - minWeight || 1;

  const fontSize = (weight: number): number => {
    const t = (weight - minWeight) / range;
    return minSize + Math.sqrt(t) * (maxSize - minSize);
  };

  const rotateFn = getRotateFn(cloudOptions.rotate);

  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  const g = svg
    .append('g')
    .attr(
      'transform',
      `translate(${width / 2},${titleHeight + cloudHeight / 2})`
    );

  cloud<WordCloudWord & cloud.Word>()
    .size([width, cloudHeight])
    .words(words.map((w) => ({ ...w, size: fontSize(w.weight) })))
    .padding(2)
    .rotate(rotateFn)
    .fontSize((d) => d.size!)
    .font(FONT_FAMILY)
    .on('end', (layoutWords) => {
      g.selectAll('text')
        .data(layoutWords)
        .join('text')
        .style('font-size', (d) => `${d.size}px`)
        .style('font-family', FONT_FAMILY)
        .style('font-weight', '600')
        .style('fill', (_d, i) => colors[i % colors.length])
        .style('cursor', (d) =>
          onClickItem && (d as WordCloudWord).lineNumber ? 'pointer' : 'default'
        )
        .attr('text-anchor', 'middle')
        .attr(
          'transform',
          (d) => `translate(${d.x},${d.y}) rotate(${d.rotate})`
        )
        .attr('data-line-number', (d) => {
          const ln = (d as WordCloudWord).lineNumber;
          return ln ? String(ln) : null;
        })
        .text((d) => d.text!)
        .on('click', (_event, d) => {
          const ln = (d as WordCloudWord).lineNumber;
          if (onClickItem && ln) onClickItem(ln);
        });
    })
    .start();
}

// ============================================================
// Word Cloud Renderer (for export — returns Promise)
// ============================================================

function renderWordCloudAsync(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  _isDark: boolean,
  exportDims?: D3ExportDimensions
): Promise<void> {
  return new Promise((resolve) => {
    d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

    const { words, title, cloudOptions } = parsed;
    if (words.length === 0) {
      resolve();
      return;
    }

    const width = exportDims?.width ?? container.clientWidth;
    const height = exportDims?.height ?? container.clientHeight;
    if (width <= 0 || height <= 0) {
      resolve();
      return;
    }

    const titleHeight = title ? 40 : 0;
    const cloudHeight = height - titleHeight;

    const textColor = palette.text;
    const bgColor = palette.bg;
    const colors = getSeriesColors(palette);

    const { minSize, maxSize } = cloudOptions;
    const weights = words.map((w) => w.weight);
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const range = maxWeight - minWeight || 1;

    const fontSize = (weight: number): number => {
      const t = (weight - minWeight) / range;
      return minSize + Math.sqrt(t) * (maxSize - minSize);
    };

    const rotateFn = getRotateFn(cloudOptions.rotate);

    const svg = d3Selection
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('background', bgColor);

    renderChartTitle(svg, title, parsed.titleLineNumber, width, textColor);

    const g = svg
      .append('g')
      .attr(
        'transform',
        `translate(${width / 2},${titleHeight + cloudHeight / 2})`
      );

    cloud<WordCloudWord & cloud.Word>()
      .size([width, cloudHeight])
      .words(words.map((w) => ({ ...w, size: fontSize(w.weight) })))
      .padding(2)
      .rotate(rotateFn)
      .fontSize((d) => d.size!)
      .font(FONT_FAMILY)
      .on('end', (layoutWords) => {
        g.selectAll('text')
          .data(layoutWords)
          .join('text')
          .style('font-size', (d) => `${d.size}px`)
          .style('font-family', FONT_FAMILY)
          .style('font-weight', '600')
          .style('fill', (_d, i) => colors[i % colors.length])
          .attr('text-anchor', 'middle')
          .attr(
            'transform',
            (d) => `translate(${d.x},${d.y}) rotate(${d.rotate})`
          )
          .text((d) => d.text!);
        resolve();
      })
      .start();
  });
}

// ============================================================
// Venn Diagram Math Helpers
// ============================================================

interface Point {
  x: number;
  y: number;
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

function fitCirclesToContainerAsymmetric(
  circles: Circle[],
  w: number,
  h: number,
  mLeft: number,
  mRight: number,
  mTop: number,
  mBottom: number
): Circle[] {
  if (circles.length === 0) return [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const c of circles) {
    minX = Math.min(minX, c.x - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    minY = Math.min(minY, c.y - c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  const availW = w - mLeft - mRight;
  const availH = h - mTop - mBottom;
  const scale = Math.min(availW / bw, availH / bh);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const tx = mLeft + availW / 2;
  const ty = mTop + availH / 2;
  return circles.map((c) => ({
    x: (c.x - cx) * scale + tx,
    y: (c.y - cy) * scale + ty,
    r: c.r * scale,
  }));
}

function pointInCircle(p: Point, c: Circle): boolean {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return dx * dx + dy * dy <= c.r * c.r + 1e-6;
}

function regionCentroid(circles: Circle[], inside: boolean[]): Point {
  // Deterministic 50×50 grid scan instead of random sampling
  const GRID = 50;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const c of circles) {
    minX = Math.min(minX, c.x - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    minY = Math.min(minY, c.y - c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  const stepX = (maxX - minX) / GRID;
  const stepY = (maxY - minY) / GRID;
  let sx = 0,
    sy = 0,
    count = 0;
  for (let gi = 0; gi <= GRID; gi++) {
    const x = minX + gi * stepX;
    for (let gj = 0; gj <= GRID; gj++) {
      const y = minY + gj * stepY;
      let match = true;
      for (let j = 0; j < circles.length; j++) {
        const isIn = pointInCircle({ x, y }, circles[j]);
        if (isIn !== inside[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        sx += x;
        sy += y;
        count++;
      }
    }
  }
  if (count === 0) {
    // Fallback: centroid of the circles that should be "inside"
    let fx = 0,
      fy = 0,
      fc = 0;
    for (let j = 0; j < circles.length; j++) {
      if (inside[j]) {
        fx += circles[j].x;
        fy += circles[j].y;
        fc++;
      }
    }
    return { x: fx / (fc || 1), y: fy / (fc || 1) };
  }
  return { x: sx / count, y: sy / count };
}

// ============================================================
// Venn Diagram Renderer
// ============================================================

export function renderVenn(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { vennSets, vennOverlaps, title } = parsed;
  if (vennSets.length < 2) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, colors } = init;
  const titleHeight = title ? 40 : 0;
  const n = vennSets.length;

  // ── Equal-radius layout with ~30% overlap depth ──
  // All circles share the same base radius; center distance = 1.4r gives ~30% penetration
  const BASE_R = 100;
  const OVERLAP_DISTANCE = BASE_R * 1.4;

  let rawCircles: Circle[];
  if (n === 2) {
    rawCircles = [
      { x: -OVERLAP_DISTANCE / 2, y: 0, r: BASE_R },
      { x: OVERLAP_DISTANCE / 2, y: 0, r: BASE_R },
    ];
  } else {
    // Equilateral triangle with side = OVERLAP_DISTANCE
    const s = OVERLAP_DISTANCE;
    const h = (Math.sqrt(3) / 2) * s;
    rawCircles = [
      { x: -s / 2, y: h / 3, r: BASE_R },
      { x: s / 2, y: h / 3, r: BASE_R },
      { x: 0, y: -(2 * h) / 3, r: BASE_R },
    ];
  }

  // Resolve colors for each set
  const setColors = vennSets.map(
    (s, i) => s.color ?? colors[i % colors.length]
  );

  // ── Layout-aware centering with label space ──
  const clusterCx = rawCircles.reduce((s, c) => s + c.x, 0) / n;
  const clusterCy = rawCircles.reduce((s, c) => s + c.y, 0) / n;

  let marginLeft = 30,
    marginRight = 30,
    marginTop = 30,
    marginBottom = 30;
  const stubLen = 20;
  const edgePad = 8;
  const labelTextPad = 4;

  for (let i = 0; i < n; i++) {
    const estimatedWidth =
      vennSets[i].name.length * 8.5 + stubLen + edgePad + labelTextPad;
    const dx = rawCircles[i].x - clusterCx;
    const dy = rawCircles[i].y - clusterCy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) marginRight = Math.max(marginRight, estimatedWidth);
      else marginLeft = Math.max(marginLeft, estimatedWidth);
    } else {
      const halfEstimate = estimatedWidth * 0.5;
      if (dy >= 0) marginBottom = Math.max(marginBottom, halfEstimate + 20);
      else marginTop = Math.max(marginTop, halfEstimate + 20);
    }
  }

  const drawH = height - titleHeight;
  const circles = fitCirclesToContainerAsymmetric(
    rawCircles,
    width,
    drawH,
    marginLeft,
    marginRight,
    marginTop,
    marginBottom
  ).map((c) => ({ ...c, y: c.y + titleHeight }));

  const scaledR = circles[0].r;

  // Suppress WebKit focus ring on interactive SVG elements
  svg
    .append('style')
    .text('circle:focus, circle:focus-visible { outline: none !important; }');

  // Title
  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  // ── Semi-transparent filled circles (non-interactive) ──
  const circleEls: d3Selection.Selection<
    SVGCircleElement,
    unknown,
    null,
    undefined
  >[] = [];
  const circleGroup = svg.append('g');
  circles.forEach((c, i) => {
    const el = circleGroup
      .append('circle')
      .attr('cx', c.x)
      .attr('cy', c.y)
      .attr('r', c.r)
      .attr('fill', setColors[i])
      .attr('fill-opacity', 0.35)
      .attr('stroke', setColors[i])
      .attr('stroke-width', 2)
      .style('pointer-events', 'none') as d3Selection.Selection<
      SVGCircleElement,
      unknown,
      null,
      undefined
    >;
    circleEls.push(el);
  });

  // ── Per-region highlight overlays (section-only, not full circles) ──
  // Build SVG defs with clipPaths + masks so each region can be highlighted independently.
  const defs = svg.append('defs');

  // Individual circle clipPaths
  circles.forEach((c, i) => {
    defs
      .append('clipPath')
      .attr('id', `vcp-${i}`)
      .append('circle')
      .attr('cx', c.x)
      .attr('cy', c.y)
      .attr('r', c.r);
  });

  // All region index-sets: exclusive then intersection subsets
  const regionIdxSets: number[][] = circles.map((_, i) => [i]);
  if (n === 2) {
    regionIdxSets.push([0, 1]);
  } else {
    regionIdxSets.push([0, 1], [0, 2], [1, 2], [0, 1, 2]);
  }

  const overlayGroup = svg.append('g').style('pointer-events', 'none');
  const overlayEls = new Map<
    string,
    d3Selection.Selection<SVGRectElement, unknown, null, undefined>
  >();

  for (const idxs of regionIdxSets) {
    const key = idxs.join('-');
    const excluded = Array.from({ length: n }, (_, j) => j).filter(
      (j) => !idxs.includes(j)
    );

    // Build nested clipPath for intersection of all idxs
    let clipId = `vcp-${idxs[0]}`;
    for (let k = 1; k < idxs.length; k++) {
      const nestedId = `vcp-n-${idxs.slice(0, k + 1).join('-')}`;
      const ci = idxs[k];
      defs
        .append('clipPath')
        .attr('id', nestedId)
        .append('circle')
        .attr('cx', circles[ci].x)
        .attr('cy', circles[ci].y)
        .attr('r', circles[ci].r)
        .attr('clip-path', `url(#${clipId})`);
      clipId = nestedId;
    }

    // Determine line number for this region (for editor sync)
    let regionLineNumber: number | null = null; // eslint-disable-line no-useless-assignment
    if (idxs.length === 1) {
      regionLineNumber = vennSets[idxs[0]].lineNumber;
    } else {
      const sortedNames = idxs.map((i) => vennSets[i].name).sort();
      const ov = vennOverlaps.find(
        (o) =>
          o.sets.length === sortedNames.length &&
          o.sets.every((s, k) => s === sortedNames[k])
      );
      regionLineNumber = ov?.lineNumber ?? null;
    }

    const el = overlayGroup
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'white')
      .attr('fill-opacity', 0)
      .attr('class', 'venn-region-overlay')
      .attr(
        'data-line-number',
        regionLineNumber != null ? String(regionLineNumber) : '0'
      )
      .attr('clip-path', `url(#${clipId})`);

    if (excluded.length > 0) {
      // Mask subtracts excluded circles so only the exact region shape highlights
      const maskId = `vvm-${key}`;
      const mask = defs.append('mask').attr('id', maskId);
      mask
        .append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', width)
        .attr('height', height)
        .attr('fill', 'white');
      for (const j of excluded) {
        mask
          .append('circle')
          .attr('cx', circles[j].x)
          .attr('cy', circles[j].y)
          .attr('r', circles[j].r)
          .attr('fill', 'black');
      }
      el.attr('mask', `url(#${maskId})`);
    }

    overlayEls.set(key, el);
  }

  const showRegionOverlay = (idxs: number[]) => {
    const key = [...idxs].sort((a, b) => a - b).join('-');
    overlayEls.forEach((el, k) =>
      el.attr('fill-opacity', k === key ? 0 : 0.55)
    );
  };
  const hideAllOverlays = () => {
    overlayEls.forEach((el) => el.attr('fill-opacity', 0));
  };

  // ── Labels ──
  const gcx = circles.reduce((s, c) => s + c.x, 0) / n;
  const gcy = circles.reduce((s, c) => s + c.y, 0) / n;

  function exclusiveHSpan(px: number, py: number, ci: number): number {
    const dy = py - circles[ci].y;
    const halfChord = Math.sqrt(
      Math.max(0, circles[ci].r * circles[ci].r - dy * dy)
    );
    let left = circles[ci].x - halfChord;
    let right = circles[ci].x + halfChord;
    for (let j = 0; j < n; j++) {
      if (j === ci) continue;
      const djy = py - circles[j].y;
      if (Math.abs(djy) >= circles[j].r) continue;
      const hc = Math.sqrt(circles[j].r * circles[j].r - djy * djy);
      const jLeft = circles[j].x - hc;
      const jRight = circles[j].x + hc;
      if (jLeft <= left && jRight >= right) return 0;
      if (jLeft <= left && jRight > left) left = jRight;
      if (jRight >= right && jLeft < right) right = jLeft;
    }
    return Math.max(0, right - left);
  }

  const CH_RATIO = 0.6;
  const MIN_FONT = 10;
  const MAX_FONT = 22;
  const INTERNAL_PAD = 12;

  const labelGroup = svg.append('g').style('pointer-events', 'none');

  // Set name labels: prefer inside exclusive region, fall back to external leader line
  circles.forEach((c, i) => {
    const text = vennSets[i].name;
    const inside = circles.map((_, j) => j === i);
    const centroid = regionCentroid(circles, inside);

    const availW = exclusiveHSpan(centroid.x, centroid.y, i);
    const fitFont = Math.min(
      MAX_FONT,
      Math.max(MIN_FONT, (availW - INTERNAL_PAD * 2) / (text.length * CH_RATIO))
    );
    const estTextW = text.length * CH_RATIO * fitFont;

    const fitsInside =
      estTextW + INTERNAL_PAD * 2 < availW &&
      pointInCircle({ x: centroid.x, y: centroid.y - fitFont / 2 }, c) &&
      pointInCircle({ x: centroid.x, y: centroid.y + fitFont / 2 }, c);

    if (fitsInside) {
      labelGroup
        .append('text')
        .attr('x', centroid.x)
        .attr('y', centroid.y)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', textColor)
        .attr('font-size', `${Math.round(fitFont)}px`)
        .attr('font-weight', 'bold')
        .text(text);
    } else {
      let dx = c.x - gcx;
      let dy = c.y - gcy;
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag < 1e-6) {
        dx = 1;
        dy = 0;
      } else {
        dx /= mag;
        dy /= mag;
      }

      const exitX = c.x + dx * c.r;
      const exitY = c.y + dy * c.r;
      const edgeX = exitX + dx * edgePad;
      const edgeY = exitY + dy * edgePad;
      const stubEndX = edgeX + dx * stubLen;
      const stubEndY = edgeY + dy * stubLen;

      labelGroup
        .append('line')
        .attr('x1', edgeX)
        .attr('y1', edgeY)
        .attr('x2', stubEndX)
        .attr('y2', stubEndY)
        .attr('stroke', textColor)
        .attr('stroke-width', 1);

      const isRight = stubEndX >= gcx;
      const textAnchor = isRight ? 'start' : 'end';
      let textX = stubEndX + (isRight ? labelTextPad : -labelTextPad);
      const textY = stubEndY;
      const estW = text.length * 8.5;
      if (isRight) textX = Math.min(textX, width - estW - 4);
      else textX = Math.max(textX, estW + 4);

      labelGroup
        .append('text')
        .attr('x', textX)
        .attr('y', Math.max(14, Math.min(height - 4, textY)))
        .attr('text-anchor', textAnchor)
        .attr('dominant-baseline', 'central')
        .attr('fill', textColor)
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .text(text);
    }
  });

  // ── Overlap labels (inline at region centroid) ──
  function overlapHSpan(py: number, idxs: number[]): number {
    let left = -Infinity,
      right = Infinity;
    for (const ci of idxs) {
      const dy = py - circles[ci].y;
      if (Math.abs(dy) >= circles[ci].r) return 0;
      const hc = Math.sqrt(circles[ci].r * circles[ci].r - dy * dy);
      left = Math.max(left, circles[ci].x - hc);
      right = Math.min(right, circles[ci].x + hc);
    }
    if (left >= right) return 0;
    for (let j = 0; j < n; j++) {
      if (idxs.includes(j)) continue;
      const dy = py - circles[j].y;
      if (Math.abs(dy) >= circles[j].r) continue;
      const hc = Math.sqrt(circles[j].r * circles[j].r - dy * dy);
      const jLeft = circles[j].x - hc;
      const jRight = circles[j].x + hc;
      if (jLeft <= left && jRight >= right) return 0;
      if (jLeft <= left && jRight > left) left = jRight;
      if (jRight >= right && jLeft < right) right = jLeft;
    }
    return Math.max(0, right - left);
  }

  for (const ov of vennOverlaps) {
    if (!ov.label) continue;
    const idxs = ov.sets.map((s) => vennSets.findIndex((vs) => vs.name === s));
    if (idxs.some((idx) => idx < 0)) continue;
    const inside = circles.map((_, j) => idxs.includes(j));
    const centroid = regionCentroid(circles, inside);
    const availW = overlapHSpan(centroid.y, idxs);
    const fitFont = Math.min(
      MAX_FONT,
      Math.max(
        MIN_FONT,
        (availW - INTERNAL_PAD * 2) / (ov.label.length * CH_RATIO)
      )
    );
    labelGroup
      .append('text')
      .attr('x', centroid.x)
      .attr('y', centroid.y)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', textColor)
      .attr('font-size', `${Math.round(fitFont)}px`)
      .attr('font-weight', '600')
      .text(ov.label);
  }

  // ── Hover targets ──
  // Exclusive circle targets first (lower z-order), then intersection targets (higher z-order)
  const hoverGroup = svg.append('g');

  circles.forEach((c, i) => {
    hoverGroup
      .append('circle')
      .attr('cx', c.x)
      .attr('cy', c.y)
      .attr('r', c.r)
      .attr('fill', 'transparent')
      .attr('stroke', 'none')
      .attr('class', 'venn-hit-target')
      .attr('data-line-number', String(vennSets[i].lineNumber))
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .style('outline', 'none')
      .on('mouseenter', () => {
        showRegionOverlay([i]);
      })
      .on('mouseleave', () => {
        hideAllOverlays();
      })
      .on('click', function () {
        (this as SVGElement).blur?.();
        if (onClickItem && vennSets[i].lineNumber)
          onClickItem(vennSets[i].lineNumber);
      });
  });

  // Intersection targets: centroid-based circles for all overlap regions (declared + undeclared)
  const overlayR = scaledR * 0.35;

  const subsets: { idxs: number[]; sets: string[] }[] = [];
  if (n === 2) {
    subsets.push({
      idxs: [0, 1],
      sets: [vennSets[0].name, vennSets[1].name].sort(),
    });
  } else {
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        subsets.push({
          idxs: [a, b],
          sets: [vennSets[a].name, vennSets[b].name].sort(),
        });
      }
    }
    subsets.push({
      idxs: [0, 1, 2],
      sets: [vennSets[0].name, vennSets[1].name, vennSets[2].name].sort(),
    });
  }

  for (const subset of subsets) {
    const { idxs, sets } = subset;
    const inside = circles.map((_, j) => idxs.includes(j));
    const centroid = regionCentroid(circles, inside);
    const declaredOv = vennOverlaps.find(
      (ov) =>
        ov.sets.length === sets.length && ov.sets.every((s, k) => s === sets[k])
    );
    hoverGroup
      .append('circle')
      .attr('cx', centroid.x)
      .attr('cy', centroid.y)
      .attr('r', overlayR)
      .attr('fill', 'transparent')
      .attr('stroke', 'none')
      .attr('class', 'venn-hit-target')
      .attr('data-line-number', declaredOv ? String(declaredOv.lineNumber) : '')
      .style('cursor', onClickItem && declaredOv ? 'pointer' : 'default')
      .style('outline', 'none')
      .on('mouseenter', () => {
        showRegionOverlay(idxs);
      })
      .on('mouseleave', () => {
        hideAllOverlays();
      })
      .on('click', function () {
        (this as SVGElement).blur?.();
        if (onClickItem && declaredOv) onClickItem(declaredOv.lineNumber);
      });
  }
}

// ============================================================
// Quadrant Chart Renderer
// ============================================================

type QuadrantPosition =
  | 'top-right'
  | 'top-left'
  | 'bottom-left'
  | 'bottom-right';

/**
 * Renders a quadrant chart using D3.
 * Displays 4 colored quadrant regions, axis labels, quadrant labels, and data points.
 */
export function renderQuadrant(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const {
    title,
    quadrantLabels,
    quadrantPoints,
    quadrantXAxis,
    quadrantYAxis,
    quadrantTitleLineNumber,
    quadrantXAxisLineNumber,
    quadrantYAxisLineNumber,
  } = parsed;

  if (quadrantPoints.length === 0) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor } = init;
  const borderColor = palette.border;

  // Default quadrant colors with alpha
  const defaultColors = [
    palette.colors.blue,
    palette.colors.green,
    palette.colors.yellow,
    palette.colors.purple,
  ];

  // Margins
  const hasXAxis = !!quadrantXAxis;
  const hasYAxis = !!quadrantYAxis;
  const margin = {
    top: title ? 60 : 30,
    right: 30,
    bottom: hasXAxis ? 70 : 40,
    left: hasYAxis ? 80 : 40,
  };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  // Scales: data uses 0-1 range
  const xScale = d3Scale.scaleLinear().domain([0, 1]).range([0, chartWidth]);
  const yScale = d3Scale.scaleLinear().domain([0, 1]).range([chartHeight, 0]);

  // Tooltip
  const tooltip = createTooltip(container, palette, isDark);

  // Title
  renderChartTitle(
    svg,
    title,
    quadrantTitleLineNumber,
    width,
    textColor,
    onClickItem
  );

  // Chart group (translated by margins)
  const chartG = svg
    .append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);

  // Mix two hex colors: pct=100 → all `a`, pct=0 → all `b`
  const mixHex = (a: string, b: string, pct: number): string => {
    const parse = (h: string) => {
      const r = h.replace('#', '');
      const f = r.length === 3 ? r[0] + r[0] + r[1] + r[1] + r[2] + r[2] : r;
      return [
        parseInt(f.substring(0, 2), 16),
        parseInt(f.substring(2, 4), 16),
        parseInt(f.substring(4, 6), 16),
      ];
    };
    const [ar, ag, ab] = parse(a),
      [br, bg, bb] = parse(b),
      t = pct / 100;
    const c = (x: number, y: number) =>
      Math.round(x * t + y * (1 - t))
        .toString(16)
        .padStart(2, '0');
    return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
  };

  const bg = isDark ? palette.surface : palette.bg;

  // Full palette color for a quadrant (used for border and label tinting)
  const getQuadrantColor = (
    label: QuadrantLabel | null,
    defaultIdx: number
  ): string => {
    return label?.color ?? defaultColors[defaultIdx % defaultColors.length];
  };

  // Muted fill: palette color blended 30% toward bg — matches other chart fill style
  const getQuadrantFill = (
    label: QuadrantLabel | null,
    defaultIdx: number
  ): string => {
    return mixHex(getQuadrantColor(label, defaultIdx), bg, 30);
  };

  // Quadrant definitions: position, rect bounds, label position
  const quadrantDefs: {
    position: QuadrantPosition;
    x: number;
    y: number;
    w: number;
    h: number;
    labelX: number;
    labelY: number;
    label: QuadrantLabel | null;
    colorIdx: number;
  }[] = [
    {
      position: 'top-left',
      x: 0,
      y: 0,
      w: chartWidth / 2,
      h: chartHeight / 2,
      labelX: chartWidth / 4,
      labelY: chartHeight / 4,
      label: quadrantLabels.topLeft,
      colorIdx: 1, // green
    },
    {
      position: 'top-right',
      x: chartWidth / 2,
      y: 0,
      w: chartWidth / 2,
      h: chartHeight / 2,
      labelX: (chartWidth * 3) / 4,
      labelY: chartHeight / 4,
      label: quadrantLabels.topRight,
      colorIdx: 0, // blue
    },
    {
      position: 'bottom-left',
      x: 0,
      y: chartHeight / 2,
      w: chartWidth / 2,
      h: chartHeight / 2,
      labelX: chartWidth / 4,
      labelY: (chartHeight * 3) / 4,
      label: quadrantLabels.bottomLeft,
      colorIdx: 2, // yellow
    },
    {
      position: 'bottom-right',
      x: chartWidth / 2,
      y: chartHeight / 2,
      w: chartWidth / 2,
      h: chartHeight / 2,
      labelX: (chartWidth * 3) / 4,
      labelY: (chartHeight * 3) / 4,
      label: quadrantLabels.bottomRight,
      colorIdx: 3, // purple
    },
  ];

  // Draw quadrant rectangles
  const quadrantRects = chartG
    .selectAll('rect.quadrant')
    .data(quadrantDefs)
    .enter()
    .append('rect')
    .attr('class', 'quadrant')
    .attr('x', (d) => d.x)
    .attr('y', (d) => d.y)
    .attr('width', (d) => d.w)
    .attr('height', (d) => d.h)
    .attr('fill', (d) => getQuadrantFill(d.label, d.colorIdx))
    .attr('stroke', (d) => getQuadrantColor(d.label, d.colorIdx))
    .attr('stroke-width', 2);

  // White text for points; quadrant labels use a darkened shade of their fill
  const shadowColor = 'rgba(0,0,0,0.4)';

  // Darken the full palette color (not the muted fill) to create a watermark-style label
  const getQuadrantLabelColor = (d: (typeof quadrantDefs)[number]): string => {
    const color = getQuadrantColor(d.label, d.colorIdx);
    return mixHex('#000000', color, 40);
  };

  // Scale label font size to fit within quadrant bounds, wrapping into multiple lines if needed
  const LABEL_MAX_FONT = 48;
  const LABEL_MIN_FONT = 14;
  const LABEL_PAD = 40;
  const CHAR_WIDTH_RATIO = 0.6;

  const estTextWidth = (text: string, fontSize: number): number =>
    text.length * fontSize * CHAR_WIDTH_RATIO;

  interface QuadrantLabelLayout {
    lines: string[];
    fontSize: number;
  }

  const quadrantLabelLayout = (
    text: string,
    qw: number,
    qh: number
  ): QuadrantLabelLayout => {
    const availW = qw - LABEL_PAD;
    const availH = qh - LABEL_PAD;
    const words = text.split(/\s+/);

    // Try single line first
    if (estTextWidth(text, LABEL_MAX_FONT) <= availW) {
      const fs = Math.min(LABEL_MAX_FONT, availH);
      return {
        lines: [text],
        fontSize: Math.max(LABEL_MIN_FONT, Math.round(fs)),
      };
    }

    // Try wrapping into 2+ lines: greedily pack words so each line fits availW
    const wrapLines = (fs: number): string[] => {
      const result: string[] = [];
      let cur = '';
      for (const w of words) {
        const trial = cur ? `${cur} ${w}` : w;
        if (estTextWidth(trial, fs) > availW && cur) {
          result.push(cur);
          cur = w;
        } else {
          cur = trial;
        }
      }
      if (cur) result.push(cur);
      return result;
    };

    // Binary-search for largest font size where wrapped text fits both width and height
    let lo = LABEL_MIN_FONT;
    let hi = LABEL_MAX_FONT;
    let bestLines = wrapLines(lo);
    let bestFs = lo;
    while (lo <= hi) {
      const mid = Math.round((lo + hi) / 2);
      const lines = wrapLines(mid);
      const totalH = lines.length * mid * 1.2; // line height ~1.2em
      const maxLineW = Math.max(...lines.map((l) => estTextWidth(l, mid)));
      if (maxLineW <= availW && totalH <= availH) {
        bestFs = mid;
        bestLines = lines;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return { lines: bestLines, fontSize: Math.max(LABEL_MIN_FONT, bestFs) };
  };

  // Draw quadrant labels (large, centered, darkened shade of fill — recedes behind points)
  // Pre-compute layout (lines + font size) for each quadrant label
  const qw = chartWidth / 2;
  const qh = chartHeight / 2;
  const quadrantDefsWithLabel = quadrantDefs.filter((d) => d.label !== null);
  const labelLayouts = new Map(
    quadrantDefsWithLabel.map((d) => [
      d.label!.text,
      quadrantLabelLayout(d.label!.text, qw, qh),
    ])
  );

  const quadrantLabelTexts = chartG
    .selectAll('text.quadrant-label')
    .data(quadrantDefsWithLabel)
    .enter()
    .append('text')
    .attr('class', 'quadrant-label')
    .attr('x', (d) => d.labelX)
    .attr('y', (d) => d.labelY)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', (d) => getQuadrantLabelColor(d))
    .attr('font-size', (d) => `${labelLayouts.get(d.label!.text)!.fontSize}px`)
    .attr('font-weight', '700')
    .attr('data-line-number', (d) =>
      d.label?.lineNumber ? String(d.label.lineNumber) : null
    )
    .style('cursor', (d) =>
      onClickItem && d.label?.lineNumber ? 'pointer' : 'default'
    )
    .each(function (d) {
      const layout = labelLayouts.get(d.label!.text)!;
      const el = d3Selection.select(this);
      if (layout.lines.length === 1) {
        el.text(layout.lines[0]);
      } else {
        // Multi-line: use tspan elements, offset from center
        const lineH = layout.fontSize * 1.2;
        const totalH = layout.lines.length * lineH;
        const startY = -totalH / 2 + lineH / 2;
        layout.lines.forEach((line, i) => {
          el.append('tspan')
            .attr('x', d.labelX)
            .attr('dy', i === 0 ? `${startY}px` : `${lineH}px`)
            .text(line);
        });
      }
    });

  if (onClickItem) {
    quadrantLabelTexts
      .on('click', (_, d) => {
        if (d.label?.lineNumber) onClickItem(d.label.lineNumber);
      })
      .on('mouseenter', function () {
        d3Selection.select(this).attr('opacity', 0.7);
      })
      .on('mouseleave', function () {
        d3Selection.select(this).attr('opacity', 1);
      });
  }

  // X-axis labels — centered on left/right halves
  if (quadrantXAxis) {
    // Low label (centered on left half)
    const xLowLabel = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', margin.left + chartWidth / 4)
      .attr('y', height - 20)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '18px')
      .attr(
        'data-line-number',
        quadrantXAxisLineNumber ? String(quadrantXAxisLineNumber) : null
      )
      .style(
        'cursor',
        onClickItem && quadrantXAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantXAxis[0]);

    // High label (centered on right half)
    const xHighLabel = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', margin.left + (chartWidth * 3) / 4)
      .attr('y', height - 20)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '18px')
      .attr(
        'data-line-number',
        quadrantXAxisLineNumber ? String(quadrantXAxisLineNumber) : null
      )
      .style(
        'cursor',
        onClickItem && quadrantXAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantXAxis[1]);

    if (onClickItem && quadrantXAxisLineNumber) {
      [xLowLabel, xHighLabel].forEach((label) => {
        label
          .on('click', () => onClickItem(quadrantXAxisLineNumber))
          .on('mouseenter', function () {
            d3Selection.select(this).attr('opacity', 0.7);
          })
          .on('mouseleave', function () {
            d3Selection.select(this).attr('opacity', 1);
          });
      });
    }
  }

  // Y-axis labels — centered on top/bottom halves
  if (quadrantYAxis) {
    const yMidBottom = margin.top + (chartHeight * 3) / 4;
    const yMidTop = margin.top + chartHeight / 4;

    // Low label (centered on bottom half)
    const yLowLabel = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', 22)
      .attr('y', yMidBottom)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '18px')
      .attr('transform', `rotate(-90, 22, ${yMidBottom})`)
      .attr(
        'data-line-number',
        quadrantYAxisLineNumber ? String(quadrantYAxisLineNumber) : null
      )
      .style(
        'cursor',
        onClickItem && quadrantYAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantYAxis[0]);

    // High label (centered on top half)
    const yHighLabel = svg
      .append('text')
      .attr('class', 'quadrant-axis-label')
      .attr('x', 22)
      .attr('y', yMidTop)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '18px')
      .attr('transform', `rotate(-90, 22, ${yMidTop})`)
      .attr(
        'data-line-number',
        quadrantYAxisLineNumber ? String(quadrantYAxisLineNumber) : null
      )
      .style(
        'cursor',
        onClickItem && quadrantYAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantYAxis[1]);

    if (onClickItem && quadrantYAxisLineNumber) {
      [yLowLabel, yHighLabel].forEach((label) => {
        label
          .on('click', () => onClickItem(quadrantYAxisLineNumber))
          .on('mouseenter', function () {
            d3Selection.select(this).attr('opacity', 0.7);
          })
          .on('mouseleave', function () {
            d3Selection.select(this).attr('opacity', 1);
          });
      });
    }
  }

  // Draw center cross lines
  chartG
    .append('line')
    .attr('x1', chartWidth / 2)
    .attr('y1', 0)
    .attr('x2', chartWidth / 2)
    .attr('y2', chartHeight)
    .attr('stroke', borderColor)
    .attr('stroke-width', 1);

  chartG
    .append('line')
    .attr('x1', 0)
    .attr('y1', chartHeight / 2)
    .attr('x2', chartWidth)
    .attr('y2', chartHeight / 2)
    .attr('stroke', borderColor)
    .attr('stroke-width', 1);

  // Get which quadrant a point belongs to
  const getPointQuadrant = (x: number, y: number): QuadrantPosition => {
    if (x >= 0.5 && y >= 0.5) return 'top-right';
    if (x < 0.5 && y >= 0.5) return 'top-left';
    if (x < 0.5 && y < 0.5) return 'bottom-left';
    return 'bottom-right';
  };

  // Draw data points (circles and labels)
  const pointsG = chartG.append('g').attr('class', 'points');

  quadrantPoints.forEach((point) => {
    const cx = xScale(point.x);
    const cy = yScale(point.y);
    const quadrant = getPointQuadrant(point.x, point.y);
    const quadDef = quadrantDefs.find((d) => d.position === quadrant);
    const pointColor =
      quadDef?.label?.color ?? defaultColors[quadDef?.colorIdx ?? 0];

    const pointG = pointsG
      .append('g')
      .attr('class', 'point-group')
      .attr('data-line-number', String(point.lineNumber));

    // Circle with white fill and colored border for visibility on opaque quadrants
    pointG
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', 6)
      .attr('fill', '#ffffff')
      .attr('stroke', pointColor)
      .attr('stroke-width', 2);

    // Label (palette text color adapts to light/dark mode)
    pointG
      .append('text')
      .attr('x', cx)
      .attr('y', cy - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '12px')
      .attr('font-weight', '700')
      .style('text-shadow', `0 1px 2px ${shadowColor}`)
      .text(point.label);

    // Interactivity
    const tipHtml = `<strong>${point.label}</strong><br>x: ${point.x.toFixed(2)}, y: ${point.y.toFixed(2)}`;

    pointG
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .on('mouseenter', (event: MouseEvent) => {
        showTooltip(tooltip, tipHtml, event);
        pointG.select('circle').attr('r', 8);
      })
      .on('mousemove', (event: MouseEvent) => {
        showTooltip(tooltip, tipHtml, event);
      })
      .on('mouseleave', () => {
        hideTooltip(tooltip);
        pointG.select('circle').attr('r', 6);
      })
      .on('click', () => {
        if (onClickItem && point.lineNumber) onClickItem(point.lineNumber);
      });
  });

  // Quadrant highlighting on hover and click-to-navigate
  quadrantRects
    .style('cursor', onClickItem ? 'pointer' : 'default')
    .on('mouseenter', function (_, d) {
      // Dim other quadrants
      quadrantRects.attr('opacity', (qd) =>
        qd.position === d.position ? 1 : 0.3
      );
      quadrantLabelTexts.attr('opacity', (qd) =>
        qd.position === d.position ? 1 : 0.3
      );
      // Dim points not in this quadrant
      pointsG.selectAll('g.point-group').each(function (_, i) {
        const pt = quadrantPoints[i];
        const ptQuad = getPointQuadrant(pt.x, pt.y);
        d3Selection
          .select(this)
          .attr('opacity', ptQuad === d.position ? 1 : 0.2);
      });
    })
    .on('mouseleave', () => {
      quadrantRects.attr('opacity', 1);
      quadrantLabelTexts.attr('opacity', 1);
      pointsG.selectAll('g.point-group').attr('opacity', 1);
    })
    .on('click', (_, d) => {
      // Navigate to the quadrant label's line in the source
      if (onClickItem && d.label?.lineNumber) {
        onClickItem(d.label.lineNumber);
      }
    });
}

// ============================================================
// Export Renderer
// ============================================================

const EXPORT_WIDTH = 1200;
const EXPORT_HEIGHT = 800;

/**
 * Resolves the palette for export, falling back to Nord light/dark.
 */
async function resolveExportPalette(
  theme: string,
  palette?: PaletteColors
): Promise<PaletteColors> {
  if (palette) return palette;
  const { getPalette } = await import('./palettes');
  return theme === 'dark' ? getPalette('nord').dark : getPalette('nord').light;
}

/**
 * Creates an offscreen container for export rendering.
 */
function createExportContainer(width: number, height: number): HTMLDivElement {
  const container = document.createElement('div');
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);
  return container;
}

/**
 * Extracts the SVG from a container, applies common export styling, and cleans up.
 */
function finalizeSvgExport(
  container: HTMLDivElement,
  theme: string,
  palette: PaletteColors,
  options?: { branding?: boolean }
): string {
  const svgEl = container.querySelector('svg');
  if (!svgEl) return '';
  if (theme === 'transparent') {
    svgEl.style.background = 'none';
  } else if (!svgEl.style.background) {
    svgEl.style.background = palette.bg;
  }
  svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svgEl.style.fontFamily = FONT_FAMILY;
  // Strip elements marked for export exclusion (e.g., inactive legend pills)
  svgEl.querySelectorAll('[data-export-ignore]').forEach((el) => el.remove());
  const svgHtml = svgEl.outerHTML;
  document.body.removeChild(container);
  if (options?.branding !== false) {
    const brandColor = theme === 'transparent' ? '#888' : palette.textMuted;
    return injectBranding(svgHtml, brandColor);
  }
  return svgHtml;
}

/**
 * Renders a D3 chart to an SVG string for export.
 * Creates a detached DOM element, renders into it, extracts the SVG, then cleans up.
 */
export async function renderForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors,
  orgExportState?: {
    collapsedNodes?: Set<string>;
    activeTagGroup?: string | null;
    hiddenAttributes?: Set<string>;
    swimlaneTagGroup?: string | null;
  },
  options?: {
    branding?: boolean;
    c4Level?: 'context' | 'containers' | 'components' | 'deployment';
    c4System?: string;
    c4Container?: string;
    tagGroup?: string;
  }
): Promise<string> {
  // Flowchart and org chart use their own parser pipelines — intercept before parseVisualization()
  const { parseDgmoChartType } = await import('./dgmo-router');
  const detectedType = parseDgmoChartType(content);

  if (detectedType === 'org') {
    const { parseOrg } = await import('./org/parser');
    const { layoutOrg } = await import('./org/layout');
    const { collapseOrgTree } = await import('./org/collapse');
    const { renderOrg } = await import('./org/renderer');

    const isDark = theme === 'dark';
    const effectivePalette = await resolveExportPalette(theme, palette);

    const orgParsed = parseOrg(content, effectivePalette);
    if (orgParsed.error) return '';

    // Apply interactive collapse state when provided
    const collapsedNodes = orgExportState?.collapsedNodes;
    const activeTagGroup =
      orgExportState?.activeTagGroup ?? options?.tagGroup ?? null;
    const hiddenAttributes = orgExportState?.hiddenAttributes;

    const { parsed: effectiveParsed, hiddenCounts } =
      collapsedNodes && collapsedNodes.size > 0
        ? collapseOrgTree(orgParsed, collapsedNodes)
        : { parsed: orgParsed, hiddenCounts: new Map<string, number>() };

    const orgLayout = layoutOrg(
      effectiveParsed,
      hiddenCounts.size > 0 ? hiddenCounts : undefined,
      activeTagGroup,
      hiddenAttributes,
      true // expandAllLegend — show all tag groups expanded in export
    );

    const PADDING = 20;
    const titleOffset = effectiveParsed.title ? 30 : 0;
    const exportWidth = orgLayout.width + PADDING * 2;
    const exportHeight = orgLayout.height + PADDING * 2 + titleOffset;
    const container = createExportContainer(exportWidth, exportHeight);

    renderOrg(
      container,
      effectiveParsed,
      orgLayout,
      effectivePalette,
      isDark,
      undefined,
      { width: exportWidth, height: exportHeight },
      activeTagGroup,
      hiddenAttributes
    );
    return finalizeSvgExport(container, theme, effectivePalette, options);
  }

  if (detectedType === 'sitemap') {
    const { parseSitemap } = await import('./sitemap/parser');
    const { layoutSitemap } = await import('./sitemap/layout');
    const { collapseSitemapTree } = await import('./sitemap/collapse');
    const { renderSitemap } = await import('./sitemap/renderer');

    const isDark = theme === 'dark';
    const effectivePalette = await resolveExportPalette(theme, palette);

    const sitemapParsed = parseSitemap(content, effectivePalette);
    if (sitemapParsed.error || sitemapParsed.roots.length === 0) return '';

    // Apply interactive collapse state when provided
    const collapsedNodes = orgExportState?.collapsedNodes;
    const activeTagGroup =
      orgExportState?.activeTagGroup ?? options?.tagGroup ?? null;
    const hiddenAttributes = orgExportState?.hiddenAttributes;

    const { parsed: effectiveParsed, hiddenCounts } =
      collapsedNodes && collapsedNodes.size > 0
        ? collapseSitemapTree(sitemapParsed, collapsedNodes)
        : { parsed: sitemapParsed, hiddenCounts: new Map<string, number>() };

    const sitemapLayout = layoutSitemap(
      effectiveParsed,
      hiddenCounts.size > 0 ? hiddenCounts : undefined,
      activeTagGroup,
      hiddenAttributes,
      true
    );

    const PADDING = 20;
    const titleOffset = effectiveParsed.title ? 30 : 0;
    const exportWidth = sitemapLayout.width + PADDING * 2;
    const exportHeight = sitemapLayout.height + PADDING * 2 + titleOffset;
    const container = createExportContainer(exportWidth, exportHeight);

    renderSitemap(
      container,
      effectiveParsed,
      sitemapLayout,
      effectivePalette,
      isDark,
      undefined,
      { width: exportWidth, height: exportHeight },
      activeTagGroup,
      hiddenAttributes
    );
    return finalizeSvgExport(container, theme, effectivePalette, options);
  }

  if (detectedType === 'kanban') {
    const { parseKanban } = await import('./kanban/parser');
    const { renderKanban } = await import('./kanban/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const kanbanParsed = parseKanban(content, effectivePalette);
    if (kanbanParsed.error || kanbanParsed.columns.length === 0) return '';

    // Kanban renderer self-sizes — no explicit width/height needed
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    document.body.appendChild(container);

    renderKanban(
      container,
      kanbanParsed,
      effectivePalette,
      theme === 'dark',
      undefined,
      undefined,
      options?.tagGroup
    );
    return finalizeSvgExport(container, theme, effectivePalette, options);
  }

  if (detectedType === 'class') {
    const { parseClassDiagram } = await import('./class/parser');
    const { layoutClassDiagram } = await import('./class/layout');
    const { renderClassDiagram } = await import('./class/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const classParsed = parseClassDiagram(content, effectivePalette);
    if (classParsed.error || classParsed.classes.length === 0) return '';

    const classLayout = layoutClassDiagram(classParsed);
    const PADDING = 20;
    const titleOffset = classParsed.title ? 40 : 0;
    const exportWidth = classLayout.width + PADDING * 2;
    const exportHeight = classLayout.height + PADDING * 2 + titleOffset;
    const container = createExportContainer(exportWidth, exportHeight);

    renderClassDiagram(
      container,
      classParsed,
      classLayout,
      effectivePalette,
      theme === 'dark',
      undefined,
      { width: exportWidth, height: exportHeight }
    );
    return finalizeSvgExport(container, theme, effectivePalette, options);
  }

  if (detectedType === 'er') {
    const { parseERDiagram } = await import('./er/parser');
    const { layoutERDiagram } = await import('./er/layout');
    const { renderERDiagram } = await import('./er/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const erParsed = parseERDiagram(content, effectivePalette);
    if (erParsed.error || erParsed.tables.length === 0) return '';

    const erLayout = layoutERDiagram(erParsed);
    const PADDING = 20;
    const titleOffset = erParsed.title ? 40 : 0;
    const exportWidth = erLayout.width + PADDING * 2;
    const exportHeight = erLayout.height + PADDING * 2 + titleOffset;
    const container = createExportContainer(exportWidth, exportHeight);

    renderERDiagram(
      container,
      erParsed,
      erLayout,
      effectivePalette,
      theme === 'dark',
      undefined,
      { width: exportWidth, height: exportHeight },
      options?.tagGroup
    );
    return finalizeSvgExport(container, theme, effectivePalette, options);
  }

  if (detectedType === 'boxes-and-lines') {
    const { parseBoxesAndLines } = await import('./boxes-and-lines/parser');
    const { layoutBoxesAndLines } = await import('./boxes-and-lines/layout');
    const { renderBoxesAndLinesForExport } =
      await import('./boxes-and-lines/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const blParsed = parseBoxesAndLines(content);
    if (blParsed.error || blParsed.nodes.length === 0) return '';

    const blLayout = layoutBoxesAndLines(blParsed);
    const PADDING = 20;
    const titleOffset = blParsed.title ? 40 : 0;
    const exportWidth = blLayout.width + PADDING * 2;
    const exportHeight = blLayout.height + PADDING * 2 + titleOffset;
    const container = createExportContainer(exportWidth, exportHeight);

    renderBoxesAndLinesForExport(
      container,
      blParsed,
      blLayout,
      effectivePalette,
      theme === 'dark',
      { exportDims: { width: exportWidth, height: exportHeight } }
    );
    return finalizeSvgExport(container, theme, effectivePalette, options);
  }

  if (detectedType === 'initiative-status') {
    const { parseInitiativeStatus } =
      await import('./initiative-status/parser');
    const { layoutInitiativeStatus } =
      await import('./initiative-status/layout');
    const { renderInitiativeStatus } =
      await import('./initiative-status/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const isParsed = parseInitiativeStatus(content);
    if (isParsed.error || isParsed.nodes.length === 0) return '';

    const isLayout = layoutInitiativeStatus(isParsed);
    const PADDING = 20;
    const titleOffset = isParsed.title ? 40 : 0;
    const exportWidth = isLayout.width + PADDING * 2;
    const exportHeight = isLayout.height + PADDING * 2 + titleOffset;
    const container = createExportContainer(exportWidth, exportHeight);

    renderInitiativeStatus(
      container,
      isParsed,
      isLayout,
      effectivePalette,
      theme === 'dark',
      { exportDims: { width: exportWidth, height: exportHeight } }
    );
    return finalizeSvgExport(container, theme, effectivePalette, options);
  }

  if (detectedType === 'c4') {
    const { parseC4 } = await import('./c4/parser');
    const {
      layoutC4Context,
      layoutC4Containers,
      layoutC4Components,
      layoutC4Deployment,
    } = await import('./c4/layout');
    const { renderC4Context, renderC4Containers } =
      await import('./c4/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const c4Parsed = parseC4(content, effectivePalette);
    if (c4Parsed.error || c4Parsed.elements.length === 0) return '';

    // Container/component-level rendering
    const c4Level = options?.c4Level ?? 'context';
    const c4System = options?.c4System;
    const c4Container = options?.c4Container;

    const c4Layout =
      c4Level === 'deployment'
        ? layoutC4Deployment(c4Parsed)
        : c4Level === 'components' && c4System && c4Container
          ? layoutC4Components(c4Parsed, c4System, c4Container)
          : c4Level === 'containers' && c4System
            ? layoutC4Containers(c4Parsed, c4System)
            : layoutC4Context(c4Parsed);

    if (c4Layout.nodes.length === 0) return '';

    const PADDING = 20;
    const titleOffset = c4Parsed.title ? 40 : 0;
    const exportWidth = c4Layout.width + PADDING * 2;
    const exportHeight = c4Layout.height + PADDING * 2 + titleOffset;
    const container = createExportContainer(exportWidth, exportHeight);

    const renderFn =
      c4Level === 'deployment' ||
      (c4Level === 'components' && c4System && c4Container) ||
      (c4Level === 'containers' && c4System)
        ? renderC4Containers
        : renderC4Context;

    renderFn(
      container,
      c4Parsed,
      c4Layout,
      effectivePalette,
      theme === 'dark',
      undefined,
      { width: exportWidth, height: exportHeight },
      options?.tagGroup
    );
    return finalizeSvgExport(container, theme, effectivePalette, options);
  }

  if (detectedType === 'flowchart') {
    const { parseFlowchart } = await import('./graph/flowchart-parser');
    const { layoutGraph } = await import('./graph/layout');
    const { renderFlowchart } = await import('./graph/flowchart-renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const fcParsed = parseFlowchart(content, effectivePalette);
    if (fcParsed.error || fcParsed.nodes.length === 0) return '';

    const layout = layoutGraph(fcParsed);
    const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);

    renderFlowchart(
      container,
      fcParsed,
      layout,
      effectivePalette,
      theme === 'dark',
      undefined,
      { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
    );
    return finalizeSvgExport(container, theme, effectivePalette, options);
  }

  if (detectedType === 'infra') {
    const { parseInfra } = await import('./infra/parser');
    const { computeInfra } = await import('./infra/compute');
    const { layoutInfra } = await import('./infra/layout');
    const { renderInfra, computeInfraLegendGroups } =
      await import('./infra/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const infraParsed = parseInfra(content);
    if (infraParsed.error || infraParsed.nodes.length === 0) return '';

    const infraComputed = computeInfra(infraParsed);
    const infraLayout = layoutInfra(infraComputed);
    const activeTagGroup = options?.tagGroup ?? null;

    const titleOffset = infraParsed.title ? 40 : 0;
    const legendGroups = computeInfraLegendGroups(
      infraLayout.nodes,
      infraParsed.tagGroups,
      effectivePalette
    );
    const legendOffset = legendGroups.length > 0 ? 28 : 0;
    const exportWidth = infraLayout.width;
    const exportHeight = infraLayout.height + titleOffset + legendOffset;
    const container = createExportContainer(exportWidth, exportHeight);

    renderInfra(
      container,
      infraLayout,
      effectivePalette,
      theme === 'dark',
      infraParsed.title,
      infraParsed.titleLineNumber,
      infraParsed.tagGroups,
      activeTagGroup,
      false,
      null,
      null,
      true
    );
    // Restore explicit pixel dimensions for resvg (renderer uses 100%/viewBox for app scaling)
    const infraSvg = container.querySelector('svg');
    if (infraSvg) {
      infraSvg.setAttribute('width', String(exportWidth));
      infraSvg.setAttribute('height', String(exportHeight));
    }
    return finalizeSvgExport(container, theme, effectivePalette, options);
  }

  if (detectedType === 'gantt') {
    const { parseGantt } = await import('./gantt/parser');
    const { calculateSchedule } = await import('./gantt/calculator');
    const { renderGantt } = await import('./gantt/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const ganttParsed = parseGantt(content, effectivePalette);
    const resolved = calculateSchedule(ganttParsed);
    if (resolved.tasks.length === 0) return '';

    const EXPORT_W = 1200;
    const EXPORT_H = 800;
    const container = createExportContainer(EXPORT_W, EXPORT_H);

    renderGantt(
      container,
      resolved,
      effectivePalette,
      theme === 'dark',
      undefined,
      { width: EXPORT_W, height: EXPORT_H }
    );
    return finalizeSvgExport(container, theme, effectivePalette, options);
  }

  if (detectedType === 'state') {
    const { parseState } = await import('./graph/state-parser');
    const { layoutGraph } = await import('./graph/layout');
    const { renderState } = await import('./graph/state-renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const stateParsed = parseState(content, effectivePalette);
    if (stateParsed.error || stateParsed.nodes.length === 0) return '';

    const layout = layoutGraph(stateParsed);
    const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);

    renderState(
      container,
      stateParsed,
      layout,
      effectivePalette,
      theme === 'dark',
      undefined,
      { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
    );
    return finalizeSvgExport(container, theme, effectivePalette, options);
  }

  const parsed = parseVisualization(content, palette);
  // Allow sequence diagrams through even if parseVisualization errors —
  // sequence is parsed by its own dedicated parser (parseSequenceDgmo)
  // and may not have a "chart:" line (auto-detected from arrow syntax).
  if (parsed.error && parsed.type !== 'sequence') {
    // Check if content looks like a sequence diagram (has arrows but no chart: line)
    const looksLikeSequence = /->|~>|<-/.test(content);
    if (!looksLikeSequence) return '';
    parsed.type = 'sequence';
  }
  if (parsed.type === 'wordcloud' && parsed.words.length === 0) return '';
  if (parsed.type === 'slope' && parsed.data.length === 0) return '';
  if (parsed.type === 'arc' && parsed.links.length === 0) return '';
  if (parsed.type === 'timeline' && parsed.timelineEvents.length === 0)
    return '';
  if (parsed.type === 'venn' && parsed.vennSets.length < 2) return '';
  if (parsed.type === 'quadrant' && parsed.quadrantPoints.length === 0)
    return '';

  const effectivePalette = await resolveExportPalette(theme, palette);
  const isDark = theme === 'dark';
  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  const dims: D3ExportDimensions = {
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
  };

  if (parsed.type === 'sequence') {
    const { parseSequenceDgmo } = await import('./sequence/parser');
    const { renderSequenceDiagram } = await import('./sequence/renderer');
    const seqParsed = parseSequenceDgmo(content);
    if (seqParsed.error || seqParsed.participants.length === 0) return '';
    renderSequenceDiagram(
      container,
      seqParsed,
      effectivePalette,
      isDark,
      undefined,
      {
        exportWidth: EXPORT_WIDTH,
        activeTagGroup: options?.tagGroup,
      }
    );
  } else if (parsed.type === 'wordcloud') {
    await renderWordCloudAsync(
      container,
      parsed,
      effectivePalette,
      isDark,
      dims
    );
  } else if (parsed.type === 'arc') {
    renderArcDiagram(
      container,
      parsed,
      effectivePalette,
      isDark,
      undefined,
      dims
    );
  } else if (parsed.type === 'timeline') {
    renderTimeline(
      container,
      parsed,
      effectivePalette,
      isDark,
      undefined,
      dims,
      orgExportState?.activeTagGroup ?? options?.tagGroup,
      orgExportState?.swimlaneTagGroup
    );
  } else if (parsed.type === 'venn') {
    renderVenn(container, parsed, effectivePalette, isDark, undefined, dims);
  } else if (parsed.type === 'quadrant') {
    renderQuadrant(
      container,
      parsed,
      effectivePalette,
      isDark,
      undefined,
      dims
    );
  } else {
    renderSlopeChart(
      container,
      parsed,
      effectivePalette,
      isDark,
      undefined,
      dims
    );
  }

  return finalizeSvgExport(container, theme, effectivePalette, options);
}
