import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import * as d3Array from 'd3-array';
import cloud from 'd3-cloud';
import { FONT_FAMILY } from './fonts';
import { computeQuadrantPointLabels, type LabelRect } from './label-layout';
import { MONTH_ABBR, computeTimeTicks } from './utils/time-ticks';
import type { D3ExportDimensions } from './utils/d3-types';
import { ScaleContext } from './utils/scaling';

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
  | 'sequence'
  | 'tech-radar'
  | 'cycle'
  | 'pyramid'
  | 'ring';

interface D3DataItem {
  label: string;
  values: number[];
  color: string | null;
  lineNumber: number;
}

interface WordCloudWord {
  text: string;
  weight: number;
  lineNumber: number;
}

type WordCloudRotate = 'none' | 'mixed' | 'angled';

interface WordCloudOptions {
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

type ArcOrder = 'appearance' | 'name' | 'group' | 'degree';

export interface ArcNodeGroup {
  name: string;
  nodes: string[];
  color: string | null;
  lineNumber: number;
}

type TimelineSort = 'time' | 'group' | 'tag';

interface TimelineEvent {
  date: string;
  endDate: string | null;
  label: string;
  group: string | null;
  metadata: Record<string, string>;
  lineNumber: number;
  uncertain?: boolean;
}

interface TimelineGroup {
  name: string;
  color: string | null;
  lineNumber: number;
}

interface TimelineEra {
  startDate: string;
  endDate: string;
  label: string;
  color: string | null;
  lineNumber: number;
}

interface TimelineMarker {
  date: string;
  label: string;
  color: string | null;
  lineNumber: number;
}

interface VennSet {
  name: string;
  alias: string | null;
  color: string | null;
  lineNumber: number;
}

interface VennOverlap {
  sets: string[];
  label: string | null;
  lineNumber: number;
}

interface QuadrantLabel {
  text: string;
  color: string | null;
  lineNumber: number;
}

interface QuadrantPoint {
  label: string;
  x: number;
  y: number;
  lineNumber: number;
}

interface QuadrantLabels {
  topRight: QuadrantLabel | null;
  topLeft: QuadrantLabel | null;
  bottomLeft: QuadrantLabel | null;
  bottomRight: QuadrantLabel | null;
}

/** Optional explicit dimensions for CLI/export rendering (bypasses DOM layout). */
export type { D3ExportDimensions } from './utils/d3-types';

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
  // Show-everything-default flags (silent-ignore at parser; per-chart honoring at renderer)
  noName?: boolean;
  noValue?: boolean;
  noPercent?: boolean;
  /** Render with full intent saturation instead of the canonical 25% tint. */
  solidFill?: boolean;
  /** Cross-chart-type: when true, the renderer suppresses the chart title. */
  noTitle?: boolean;
  diagnostics: DgmoError[];
  error: string | null;
}

// ============================================================
// Color Imports
// ============================================================

import { resolveColorWithDiagnostic } from './colors';
import type { PaletteColors } from './palettes';
import { getSeriesColors } from './palettes';
import { mix, shapeFill } from './palettes/color-utils';
import type { DgmoError } from './diagnostics';
import {
  ALIAS_DIAGNOSTIC_CODES,
  formatDgmoError,
  makeDgmoError,
  pipeOperatorRemovedMessage,
  suggest,
  vennAliasKeywordRemovedMessage,
} from './diagnostics';
import {
  collectIndentedValues,
  extractColor,
  normalizeNumericToken,
  parseFirstLine,
  parsePipeMetadata,
  peelTrailingColorName,
  splitNameAndMeta,
  MULTIPLE_PIPE_ERROR,
  warnUnknownMetaKeys,
} from './utils/parsing';
import {
  TIMELINE_REGISTRY,
  withTagAliases,
} from './utils/reserved-key-registry';
import {
  matchTagBlockHeading,
  validateTagValues,
  validateTagGroupNames,
  resolveTagColor,
  resolveActiveTagGroup,
  stripDefaultModifier,
} from './utils/tag-groups';
import type { TagGroup } from './utils/tag-groups';
import type { Writable } from './utils/brand';
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
} from './utils/legend-constants';
import { renderLegendD3 } from './utils/legend-d3';
import type {
  LegendConfig,
  LegendState,
  LegendCallbacks,
} from './utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from './utils/title-constants';

// ============================================================
// Shared Parsing Helpers
// ============================================================

/**
 * Split a timeline event's `label + metadata` segment into a clean
 * label string and a key-value record. Accepts both forms:
 *   - legacy: `label | k: v, k: v`
 *   - new (§1.4): `label k: v, k: v` (cut at first reserved key in
 *     `TIMELINE_REGISTRY` plus declared tag aliases).
 *
 * Multi-pipe lines fire the supplied `reportMultiPipes` callback;
 * the top-of-loop `E_PIPE_OPERATOR_REMOVED` diagnostic is emitted
 * by the caller on first `|` detection.
 */
function parseTimelineLabelAndMeta(
  text: string,
  timelineAliasMap: Map<string, string>,
  reportMultiPipes?: () => void
): { label: string; metadata: Record<string, string> } {
  if (text.includes('|')) {
    const segments = text.split('|');
    const label = segments[0]!.trim();
    const metadata =
      segments.length > 1
        ? parsePipeMetadata(
            ['', ...segments.slice(1)],
            timelineAliasMap,
            reportMultiPipes
          )
        : {};
    return { label, metadata };
  }
  const registry = withTagAliases(
    TIMELINE_REGISTRY,
    new Set(timelineAliasMap.keys())
  );
  const split = splitNameAndMeta(text, registry, timelineAliasMap);
  let label = split.name;
  if (split.color !== undefined) {
    label = `${label} ${split.color}`;
  }
  return { label, metadata: split.meta };
}

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
      // In-bounds by length check above.
      hour = parseInt(timeParts[0]!, 10);
      minute = parseInt(timeParts[1]!, 10);
    }
  }

  const parts = datePart.split('-').map((p) => parseInt(p, 10));
  // parts is always non-empty (split returns at least one element).
  const year = parts[0]!;
  const month = parts.length >= 2 ? parts[1]! : 1;
  const day = parts.length >= 3 ? parts[2]! : 1;
  return (
    year + (month - 1) / 12 + (day - 1) / 365 + hour / 8760 + minute / 525600
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
      // In-bounds by length check above.
      hour = parseInt(tp[0]!, 10);
      minute = parseInt(tp[1]!, 10);
    }
  }

  const parts = datePart.split('-').map((p) => parseInt(p, 10));
  // parts is always non-empty (split returns at least one element).
  const year = parts[0]!;
  const month = parts.length >= 2 ? parts[1]! : 1;
  const day = parts.length >= 3 ? parts[2]! : 1;

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

  if (!content?.trim()) {
    return fail(0, 'Empty content');
  }

  const lines = content.split('\n');
  const freeformLines: string[] = [];
  let currentArcGroup: string | null = null;
  let currentTimelineGroup: string | null = null;
  let currentTimelineTagGroup: Writable<TagGroup> | null = null;
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
    // In-bounds by loop guard.
    const rawLine = lines[i]!;
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
        const newGroup: Writable<TagGroup> = {
          name: tagBlockMatch.name,
          ...(tagBlockMatch.alias !== undefined && {
            alias: tagBlockMatch.alias,
          }),
          entries: [],
          lineNumber,
        };
        currentTimelineTagGroup = newGroup;
        if (tagBlockMatch.alias) {
          timelineAliasMap.set(
            tagBlockMatch.alias.toLowerCase(),
            tagBlockMatch.name.toLowerCase()
          );
        }
        result.timelineTagGroups.push(newGroup);
        continue;
      }
    }

    // Timeline tag group entries (indented under tag heading)
    if (currentTimelineTagGroup && indent > 0) {
      const { text: entryText, isDefault } = stripDefaultModifier(line);
      const { label, color } = extractColor(entryText, palette);
      if (color) {
        if (isDefault) {
          currentTimelineTagGroup.defaultValue = label;
        } else if (currentTimelineTagGroup.entries.length === 0) {
          currentTimelineTagGroup.defaultValue = label;
        }
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

    // [Group] container headers for arc / timeline (§1.5 trailing-token):
    //   `[Group]`           — no color
    //   `[Group] color`     — trailing-token color (recognized palette word)
    const groupMatch = line.match(
      /^\[(.+?)\](?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/
    );
    if (groupMatch) {
      if (result.type === 'arc') {
        // Capture group 1 is guaranteed by the regex match.
        const name = groupMatch[1]!.trim();
        const color = groupMatch[2]
          ? (resolveColorWithDiagnostic(
              groupMatch[2].trim(),
              lineNumber,
              result.diagnostics,
              palette
            ) ?? null)
          : null;
        result.arcNodeGroups.push({ name, nodes: [], color, lineNumber });
        currentArcGroup = name;
      } else if (result.type === 'timeline') {
        // Capture group 1 is guaranteed by the regex match.
        const name = groupMatch[1]!.trim();
        const color = groupMatch[2]
          ? (resolveColorWithDiagnostic(
              groupMatch[2].trim(),
              lineNumber,
              result.diagnostics,
              palette
            ) ?? null)
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

    // Arc link line (§1.5 trailing-token):
    //   `source -> target [color] [weight]` — color before weight
    if (result.type === 'arc') {
      const linkMatch = line.match(
        /^(.+?)\s*->\s*(.+?)(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?(?:\s+(-?[\d,_]+(?:\.[\d]+)?))?$/
      );
      if (linkMatch) {
        // Capture groups 1 and 2 are guaranteed by the regex match.
        const source = linkMatch[1]!.trim();
        const target = linkMatch[2]!.trim();
        if (source.endsWith(':') || target.endsWith(':')) {
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              `Trailing colon is not valid in arc edges — write '${source.replace(/:$/, '')} -> ${target.replace(/:$/, '')}' instead`
            )
          );
          continue;
        }
        const linkColor = linkMatch[3]
          ? (resolveColorWithDiagnostic(
              linkMatch[3].trim(),
              lineNumber,
              result.diagnostics,
              palette
            ) ?? null)
          : null;
        result.links.push({
          source,
          target,
          value: linkMatch[4]
            ? parseFloat(normalizeNumericToken(linkMatch[4]) ?? linkMatch[4])
            : 1,
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
        // Timeline era block entry (\u00a71.5 trailing-token):
        //   `<start> -> <end> Label`           (no color)
        //   `<start> -> <end> Label color`     (trailing color word)
        // Color (group 4) must be a recognized lowercase palette word.
        const eraEntryMatch = line.match(
          /^(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s*(?:->|\u2013>)\s*(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s+(.+?)(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/
        );
        if (eraEntryMatch) {
          const colorAnnotation = eraEntryMatch[4]?.trim() || null;
          result.timelineEras.push({
            // Capture groups 1-3 guaranteed by the regex match.
            startDate: eraEntryMatch[1]!,
            endDate: eraEntryMatch[2]!,
            label: eraEntryMatch[3]!.trim(),
            color: colorAnnotation
              ? (resolveColorWithDiagnostic(
                  colorAnnotation,
                  lineNumber,
                  result.diagnostics,
                  palette
                ) ?? null)
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
        // Timeline marker block entry (§1.5 trailing-token).
        const markerEntryMatch = line.match(
          /^(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s+(.+?)(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/
        );
        if (markerEntryMatch) {
          const colorAnnotation = markerEntryMatch[3]?.trim() || null;
          result.timelineMarkers.push({
            // Capture groups 1-2 guaranteed by the regex match.
            date: markerEntryMatch[1]!,
            label: markerEntryMatch[2]!.trim(),
            color: colorAnnotation
              ? (resolveColorWithDiagnostic(
                  colorAnnotation,
                  lineNumber,
                  result.diagnostics,
                  palette
                ) ?? null)
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

      // Timeline era lines, inline (\u00a71.5 trailing-token):
      //   `era YYYY->YYYY Label`        \u2014 no color
      //   `era YYYY->YYYY Label color`  \u2014 trailing-token color (recognized palette word)
      const eraMatch = line.match(
        /^era\s+(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s*(?:->|\u2013>)\s*(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s+(.+?)(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/
      );
      if (eraMatch) {
        const colorAnnotation = eraMatch[4]?.trim() || null;
        result.timelineEras.push({
          // Capture groups 1-3 guaranteed by the regex match.
          startDate: eraMatch[1]!,
          endDate: eraMatch[2]!,
          label: eraMatch[3]!.trim(),
          color: colorAnnotation
            ? (resolveColorWithDiagnostic(
                colorAnnotation,
                lineNumber,
                result.diagnostics,
                palette
              ) ?? null)
            : null,
          lineNumber,
        });
        continue;
      }

      // Timeline marker lines, inline (§1.5 trailing-token):
      //   `marker YYYY Label`        — no color
      //   `marker YYYY Label color`  — trailing-token color
      const markerMatch = line.match(
        /^marker\s+(\d{4}(?:-\d{2})?(?:-\d{2}(?: \d{2}:\d{2})?)?)\s+(.+?)(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/
      );
      if (markerMatch) {
        const colorAnnotation = markerMatch[3]?.trim() || null;
        result.timelineMarkers.push({
          // Capture groups 1-2 guaranteed by the regex match.
          date: markerMatch[1]!,
          label: markerMatch[2]!.trim(),
          color: colorAnnotation
            ? (resolveColorWithDiagnostic(
                colorAnnotation,
                lineNumber,
                result.diagnostics,
                palette
              ) ?? null)
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
        // Capture groups 1-5 guaranteed by the regex match.
        const startDate = durationMatch[1]!;
        const uncertain = durationMatch[4] === '?';
        const amount = parseFloat(durationMatch[2]!);
        const unit = durationMatch[3] as 'd' | 'w' | 'm' | 'y' | 'h' | 'min';
        const endDate = addDurationToDate(startDate, amount, unit);
        if (durationMatch[5]!.includes('|')) {
          warn(lineNumber, pipeOperatorRemovedMessage());
        }
        const { label, metadata } = parseTimelineLabelAndMeta(
          durationMatch[5]!,
          timelineAliasMap,
          () => warn(lineNumber, MULTIPLE_PIPE_ERROR)
        );
        warnUnknownMetaKeys(
          metadata,
          withTagAliases(TIMELINE_REGISTRY, new Set(timelineAliasMap.keys())),
          (msg) => warn(lineNumber, msg)
        );
        result.timelineEvents.push({
          date: startDate,
          endDate,
          label,
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
        // Capture group 4 guaranteed by the regex match.
        if (rangeMatch[4]!.includes('|')) {
          warn(lineNumber, pipeOperatorRemovedMessage());
        }
        const { label, metadata } = parseTimelineLabelAndMeta(
          rangeMatch[4]!,
          timelineAliasMap,
          () => warn(lineNumber, MULTIPLE_PIPE_ERROR)
        );
        warnUnknownMetaKeys(
          metadata,
          withTagAliases(TIMELINE_REGISTRY, new Set(timelineAliasMap.keys())),
          (msg) => warn(lineNumber, msg)
        );
        result.timelineEvents.push({
          // Capture groups 1-2 guaranteed by the regex match.
          date: rangeMatch[1]!,
          endDate: rangeMatch[2]!,
          label,
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
        // Capture group 2 guaranteed by the regex match.
        if (pointMatch[2]!.includes('|')) {
          warn(lineNumber, pipeOperatorRemovedMessage());
        }
        const { label, metadata } = parseTimelineLabelAndMeta(
          pointMatch[2]!,
          timelineAliasMap,
          () => warn(lineNumber, MULTIPLE_PIPE_ERROR)
        );
        warnUnknownMetaKeys(
          metadata,
          withTagAliases(TIMELINE_REGISTRY, new Set(timelineAliasMap.keys())),
          (msg) => warn(lineNumber, msg)
        );
        result.timelineEvents.push({
          // Capture group 1 guaranteed by the regex match.
          date: pointMatch[1]!,
          endDate: null,
          label,
          group: currentTimelineGroup,
          metadata,
          lineNumber,
        });
        continue;
      }
    }

    // Venn diagram DSL
    if (result.type === 'venn') {
      // Skip cross-chart bare-keyword options so they don't get parsed as
      // a 4th set name (the bare-keyword block at line ~1132 runs AFTER
      // type-specific parsing).
      if (/^(solid-fill|no-name|no-value|no-percent|no-title)$/i.test(line)) {
        // Fall through to the bare-keyword block below.
      } else if (/\+/.test(line)) {
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
          // In-bounds by length check (segments.length >= 2).
          const lastSeg = segments[segments.length - 1]!;

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
            // words is non-empty (split always returns at least one).
            lastSetRef = words[0]!;
            label = words.length > 1 ? words.slice(1).join(' ') : null;
          }
          rawSets.push(lastSetRef);
          result.vennOverlaps.push({ sets: rawSets, label, lineNumber });
          continue;
        }
      }

      // Set declaration (§1.5 universal trailing-token, §2A.2 modifier order):
      //   `Name` / `Name color` / `Name as <alias>` / `Name as <alias> color`
      // Color is the line-trailing token, peeled first; alias follows the name.
      // Legacy `Name alias <token>` emits E_VENN_ALIAS_KEYWORD_REMOVED.
      // Only attempt set parsing if the line wasn't a bare-keyword option (handled above).
      if (!/^(solid-fill|no-name|no-value|no-percent|no-title)$/i.test(line)) {
        // Peel a trailing color word from the whole line first so the
        // remaining text is `Name [alias <alias>]` / `Name [as <alias>]`.
        const { label: lineWithoutColor, colorName } =
          peelTrailingColorName(line);
        let color: string | null = null;
        if (colorName) {
          color =
            resolveColorWithDiagnostic(
              colorName,
              lineNumber,
              result.diagnostics,
              palette
            ) ?? null;
        }

        // Detect legacy `alias` keyword first — graceful degradation parses
        // the rest of the line so the set still appears.
        const legacyAliasMatch = lineWithoutColor.match(
          /^(.+?)\s+alias\s+(\S+)\s*$/i
        );
        if (legacyAliasMatch) {
          // Capture groups 1-2 guaranteed by the regex match.
          const name = legacyAliasMatch[1]!.trim();
          const aliasToken = legacyAliasMatch[2]!.trim();
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              vennAliasKeywordRemovedMessage({ name, alias: aliasToken }),
              'error',
              ALIAS_DIAGNOSTIC_CODES.VENN_ALIAS_KEYWORD_REMOVED
            )
          );
          result.vennSets.push({ name, alias: aliasToken, color, lineNumber });
          continue;
        }

        const setDeclMatch = lineWithoutColor.match(
          /^(.+?)(?:\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11}))?\s*$/i
        );
        if (setDeclMatch) {
          // Capture group 1 guaranteed by the regex match.
          const name = setDeclMatch[1]!.trim();
          const alias = setDeclMatch[2]?.trim() ?? null;
          result.vennSets.push({ name, alias, color, lineNumber });
          continue;
        }
      }
    }

    // Quadrant-specific parsing
    if (result.type === 'quadrant') {
      // x-label Low, High  — or indented multi-line
      const xAxisMatch = line.match(/^x-label\s+(.*)/i);
      if (xAxisMatch) {
        // Capture group 1 guaranteed by the regex match.
        const val = xAxisMatch[1]!.trim();
        let parts: string[];
        if (val) {
          parts = val.split(',').map((s) => s.trim());
        } else {
          const collected = collectIndentedValues(lines, i);
          i = collected.newIndex;
          parts = collected.values;
        }
        if (parts.length >= 2) {
          // In-bounds by length check above.
          result.quadrantXAxis = [parts[0]!, parts[1]!];
          result.quadrantXAxisLineNumber = lineNumber;
        }
        continue;
      }

      // y-label Low, High  — or indented multi-line
      const yAxisMatch = line.match(/^y-label\s+(.*)/i);
      if (yAxisMatch) {
        // Capture group 1 guaranteed by the regex match.
        const val = yAxisMatch[1]!.trim();
        let parts: string[];
        if (val) {
          parts = val.split(',').map((s) => s.trim());
        } else {
          const collected = collectIndentedValues(lines, i);
          i = collected.newIndex;
          parts = collected.values;
        }
        if (parts.length >= 2) {
          // In-bounds by length check above.
          result.quadrantYAxis = [parts[0]!, parts[1]!];
          result.quadrantYAxisLineNumber = lineNumber;
        }
        continue;
      }

      // Quadrant position labels (§1.5 trailing-token):
      //   `top-right Label`        — no color
      //   `top-right Label color`  — trailing-token color (recognized palette word)
      const quadrantLabelRe =
        /^(top-right|top-left|bottom-left|bottom-right)\s+(.+)/i;
      const quadrantMatch = line.match(quadrantLabelRe);
      if (quadrantMatch) {
        // Capture groups 1-2 guaranteed by the regex match.
        const position = quadrantMatch[1]!.toLowerCase();
        const labelPart = quadrantMatch[2]!.trim();
        // Peel trailing recognized color word from the label.
        const { label: text, colorName } = peelTrailingColorName(labelPart);
        const color = colorName
          ? (resolveColorWithDiagnostic(
              colorName,
              lineNumber,
              result.diagnostics,
              palette
            ) ?? null)
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
        /^(.+?)\s+(-?[0-9][0-9,_]*(?:\.[0-9]+)?)\s*[,\s]\s*(-?[0-9][0-9,_]*(?:\.[0-9]+)?)\s*$/
      );
      if (pointMatch) {
        // Capture groups 1-3 guaranteed by the regex match.
        const label = pointMatch[1]!.trim();
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
            x: parseFloat(
              normalizeNumericToken(pointMatch[2]!) ?? pointMatch[2]!
            ),
            y: parseFloat(
              normalizeNumericToken(pointMatch[3]!) ?? pointMatch[3]!
            ),
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
          // In-bounds by length === 2 check.
          parts[0]! < parts[1]!
        ) {
          // In-bounds by length === 2 check.
          result.cloudOptions.minSize = parts[0]!;
          result.cloudOptions.maxSize = parts[1]!;
        }
        continue;
      }
    }

    // ── Bare-keyword no-* flags (show-everything default) ──────
    {
      const bareToken = line.toLowerCase();
      if (bareToken === 'no-name') {
        result.noName = true;
        continue;
      }
      if (bareToken === 'no-value') {
        result.noValue = true;
        continue;
      }
      if (bareToken === 'no-percent') {
        result.noPercent = true;
        continue;
      }
      if (bareToken === 'solid-fill') {
        result.solidFill = true;
        continue;
      }
      if (bareToken === 'no-title') {
        result.noTitle = true;
        continue;
      }
      // Silent-ignore unrecognized no-* flags (typos, future flags).
      if (bareToken.startsWith('no-')) {
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
          // Capture group 1 guaranteed by the regex match.
          const rest = periodMatch[1]!.trim();
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
          // In-bounds by while condition (rightIdx >= 0 && < tokens.length).
          const tok = tokens[rightIdx]!;
          const raw = normalizeNumericToken(tok) ?? tok;
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

        // Color annotation (§1.5 trailing-token): `Label color` → split.
        const { label: labelPart, colorName: colorWord } =
          peelTrailingColorName(joinedLabel);
        const colorPart = colorWord
          ? (resolveColorWithDiagnostic(
              colorWord,
              lineNumber,
              result.diagnostics,
              palette
            ) ?? null)
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
          // In-bounds by length === 2 check.
          parts[0]! < parts[1]!
        ) {
          // In-bounds by length === 2 check.
          result.cloudOptions.minSize = parts[0]!;
          result.cloudOptions.maxSize = parts[1]!;
        }
        continue;
      }

      // Data line: "Label: value1, value2" or "Label(color): value1, value2"
      // Capture groups 1-2 guaranteed by the regex match.
      const labelPart = colorMatch ? colorMatch[1]!.trim() : rawKey;
      const colorPart = colorMatch
        ? (resolveColorWithDiagnostic(
            colorMatch[2]!.trim(),
            lineNumber,
            result.diagnostics,
            palette
          ) ?? null)
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
        const rawWeight = lastSpace >= 0 ? line.substring(lastSpace + 1) : '';
        const maybeWeight =
          lastSpace >= 0
            ? parseFloat(normalizeNumericToken(rawWeight) ?? rawWeight)
            : NaN;
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
    // split always returns at least one element.
    const hint = suggest(
      firstNonEmpty.split(/\s/)[0]!.toLowerCase(),
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
      validateTagGroupNames(
        result.timelineTagGroups,
        (line, msg) =>
          result.diagnostics.push(makeDgmoError(line, msg, 'warning')),
        (line, msg) => {
          const diag = makeDgmoError(line, msg);
          result.diagnostics.push(diag);
          if (!result.error) result.error = formatDgmoError(diag);
        }
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
            // diagnostics non-empty: we just pushed to it.
            result.error = formatDgmoError(
              result.diagnostics[result.diagnostics.length - 1]!
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
  const { periods, data } = parsed;
  const title = parsed.noTitle ? null : parsed.title;
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
    // periods[i] is in-bounds — i comes from d3 line's index callback over the data array.
    .x((_d, i) => xScale(periods[i]!)!)
    .y((d) => yScale(d));

  // Pre-compute per-series data for label collision resolution
  const seriesInfo = data.map((item, idx) => {
    // colors is non-empty; modulo guarantees in-bounds.
    const color = item.color ?? colors[idx % colors.length]!;
    // values is non-empty by parser validation (slope requires P>=2 values per series).
    const firstVal = item.values[0]!;
    const lastVal = item.values[item.values.length - 1]!;
    const absChange = lastVal - firstVal;
    const pctChange = firstVal !== 0 ? (absChange / firstVal) * 100 : null;
    const sign = absChange > 0 ? '+' : '';
    const tipLines = [`${sign}${parseFloat(absChange.toFixed(2))}`];
    if (pctChange !== null) tipLines.push(`${sign}${pctChange.toFixed(1)}%`);
    const tipHtml = tipLines.join('<br>');

    // Compute right-side label text and wrapping info
    // periods is non-empty (slope requires P >= 2 periods).
    const lastX = xScale(periods[periods.length - 1]!)!;
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
      // pi is in-bounds by loop guard against periods.length, and each data row has periods.length values.
      naturalY: yScale(item.values[pi]!),
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
    // seriesInfo was built by data.map() above, so idx is in-bounds.
    const si = seriesInfo[idx]!;
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
      // periods[i] is in-bounds because item.values.length === periods.length (slope contract).
      const x = xScale(periods[i]!)!;
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
        // leftLabelCollisions was set for every i in [0, periods.length-1); idx is in-bounds by data.map.
        const adjustedY = leftLabelCollisions.get(i)![idx]!;
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
    // rightAdjustedY was produced from rightEntries.length === seriesInfo.length === data.length.
    const adjustedLastY = rightAdjustedY[idx]!;

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

const ARC_MARGIN_TOP = 60;
const ARC_MARGIN_RIGHT = 40;
const ARC_MARGIN_BOTTOM = 60;
const ARC_MARGIN_LEFT = 40;
const ARC_MARGIN_LEFT_VERTICAL = 120;
const ARC_NODE_RADIUS = 5;
const ARC_NODE_STROKE_WIDTH = 1.5;
const ARC_NODE_LABEL_FONT = 11;
const ARC_GROUP_LABEL_FONT = 12;
const ARC_BAND_HALF_W = 60;
const ARC_BAND_HALF_H = 40;
const ARC_BAND_RADIUS = 4;
const ARC_BAND_LABEL_X_OFFSET = 6;
const ARC_BAND_LABEL_Y_OFFSET = 14;
const ARC_BAND_LABEL_BOTTOM_OFFSET = 4;
const ARC_NODE_LABEL_X_OFFSET = 14;
const ARC_NODE_LABEL_Y_OFFSET = 20;
const ARC_STROKE_MIN = 1.5;
const ARC_STROKE_MAX = 6;
const ARC_BASELINE_STROKE_WIDTH = 1;

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
  const { links, orientation, arcOrder, arcNodeGroups } = parsed;
  const title = parsed.noTitle ? null : parsed.title;
  if (links.length === 0) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, mutedColor, bgColor, colors } = init;

  const isVertical = orientation === 'vertical';

  const nodes = orderArcNodes(links, arcOrder, arcNodeGroups);

  const idealWidth = isVertical
    ? ARC_MARGIN_LEFT_VERTICAL + ARC_MARGIN_RIGHT + ARC_BAND_HALF_W * 2 + 100
    : nodes.length * 20 + ARC_MARGIN_LEFT + ARC_MARGIN_RIGHT;
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sMarginTop = ctx.aesthetic(ARC_MARGIN_TOP);
  const sMarginRight = ctx.aesthetic(ARC_MARGIN_RIGHT);
  const sMarginBottom = ctx.aesthetic(ARC_MARGIN_BOTTOM);
  const sMarginLeft = isVertical
    ? ctx.aesthetic(ARC_MARGIN_LEFT_VERTICAL)
    : ctx.aesthetic(ARC_MARGIN_LEFT);
  const sNodeRadius = ctx.structural(ARC_NODE_RADIUS);
  const sNodeStrokeWidth = ctx.structural(ARC_NODE_STROKE_WIDTH);
  const sNodeLabelFont = ctx.text(ARC_NODE_LABEL_FONT);
  const sGroupLabelFont = ctx.text(ARC_GROUP_LABEL_FONT);
  const sBandHalfW = ctx.aesthetic(ARC_BAND_HALF_W);
  const sBandHalfH = ctx.aesthetic(ARC_BAND_HALF_H);
  const sBandRadius = ctx.structural(ARC_BAND_RADIUS);
  const sBandLabelXOffset = ctx.structural(ARC_BAND_LABEL_X_OFFSET);
  const sBandLabelYOffset = ctx.structural(ARC_BAND_LABEL_Y_OFFSET);
  const sBandLabelBottomOffset = ctx.structural(ARC_BAND_LABEL_BOTTOM_OFFSET);
  const sNodeLabelXOffset = ctx.structural(ARC_NODE_LABEL_X_OFFSET);
  const sNodeLabelYOffset = ctx.structural(ARC_NODE_LABEL_Y_OFFSET);
  const sStrokeMin = ctx.structural(ARC_STROKE_MIN);
  const sStrokeMax = ctx.structural(ARC_STROKE_MAX);
  const sBaselineDash = `${ctx.structural(4)},${ctx.structural(4)}`;
  const sBaselineStrokeWidth = ctx.structural(ARC_BASELINE_STROKE_WIDTH);

  if (ctx.isBelowFloor) {
    svg.attr('viewBox', `0 0 ${width} ${height}`).attr('width', '100%');
  }

  const margin = {
    top: sMarginTop,
    right: sMarginRight,
    bottom: sMarginBottom,
    left: sMarginLeft,
  };

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

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

  const groupNodeSets = new Map<string, Set<string>>();
  for (const group of arcNodeGroups) {
    groupNodeSets.set(group.name, new Set(group.nodes));
  }

  const values = links.map((l) => l.value);
  const [minVal, maxVal] = d3Array.extent(values) as [number, number];
  const strokeScale = d3Scale
    .scaleLinear()
    .domain([minVal, maxVal])
    .range([sStrokeMin, sStrokeMax]);

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
          .attr('x', baseX - sBandHalfW)
          .attr('y', minY)
          .attr('width', sBandHalfW * 2)
          .attr('height', maxY - minY)
          .attr('rx', sBandRadius)
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
          .attr('x', baseX - sBandHalfW + sBandLabelXOffset)
          .attr('y', minY + sBandLabelYOffset)
          .attr('fill', textColor)
          .attr('font-size', `${sGroupLabelFont}px`)
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
      .attr('stroke-width', sBaselineStrokeWidth)
      .attr('stroke-dasharray', sBaselineDash);

    // Arcs
    links.forEach((link, idx) => {
      const y1 = yScale(link.source)!;
      const y2 = yScale(link.target)!;
      const midY = (y1 + y2) / 2;
      const distance = Math.abs(y2 - y1);
      const controlX = baseX + distance * 0.4;
      // colors is non-empty; modulo guarantees in-bounds.
      const color = link.color ?? colors[idx % colors.length]!;

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
        .attr('r', sNodeRadius)
        .attr('fill', nodeColor)
        .attr('stroke', bgColor)
        .attr('stroke-width', sNodeStrokeWidth);

      nodeG
        .append('text')
        .attr('x', baseX - sNodeLabelXOffset)
        .attr('y', y)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', `${sNodeLabelFont}px`)
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
          .attr('y', baseY - sBandHalfH)
          .attr('width', maxX - minX)
          .attr('height', sBandHalfH * 2)
          .attr('rx', sBandRadius)
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
          .attr('y', baseY + sBandHalfH - sBandLabelBottomOffset)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-size', `${sGroupLabelFont}px`)
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
      .attr('stroke-width', sBaselineStrokeWidth)
      .attr('stroke-dasharray', sBaselineDash);

    // Arcs
    links.forEach((link, idx) => {
      const x1 = xScale(link.source)!;
      const x2 = xScale(link.target)!;
      const midX = (x1 + x2) / 2;
      const distance = Math.abs(x2 - x1);
      const controlY = baseY - distance * 0.4;
      // colors is non-empty; modulo guarantees in-bounds.
      const color = link.color ?? colors[idx % colors.length]!;

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
        .attr('r', sNodeRadius)
        .attr('fill', nodeColor)
        .attr('stroke', bgColor)
        .attr('stroke-width', sNodeStrokeWidth);

      nodeG
        .append('text')
        .attr('x', x)
        .attr('y', baseY + sNodeLabelYOffset)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', `${sNodeLabelFont}px`)
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
    : ['#5e81ac', '#a3be8c', '#ebcb8b', '#d08770', '#b48ead'];
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
  const defaultColor = palette?.accent || '#d08770';

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
      // Diamond stays just below the chart top edge so the dashed line has a
      // clear visual head, regardless of where the label sits.
      const diamondY = useReservedRow ? -2 : labelY + 14;
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
  // split returns at least one element.
  const year = parts[0]!;
  if (parts.length === 1) return year + timeSuffix;
  // In-bounds by length check above.
  const month = MONTH_ABBR[parseInt(parts[1]!, 10) - 1];
  if (parts.length === 2) return `${month} ${year}${timeSuffix}`;
  // In-bounds by length check above.
  const day = parseInt(parts[2]!, 10);
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
  parsed: ParsedVisualization,
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
  const bg = isDark ? palette.surface : palette.bg;
  const colors = getSeriesColors(palette);

  const groupColorMap = new Map<string, string>();
  timelineGroups.forEach((grp, i) => {
    // colors is non-empty; modulo guarantees in-bounds.
    groupColorMap.set(grp.name, grp.color ?? colors[i % colors.length]!);
  });

  let tagLanes: Lane[] | null = null;

  if (resolvedSwimlaneTG) {
    const tagKey = resolvedSwimlaneTG.toLowerCase();
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
  parsed: ParsedVisualization,
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
      const centralState: LegendState = { activeGroup: centralActive };

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
              const tagKey = groupName.toLowerCase();
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
              const groupKey = groupName.toLowerCase();
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
      renderLegendD3(
        legendInnerG,
        centralConfig,
        centralState,
        palette,
        isDark,
        centralCallbacks,
        width
      );
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
  parsed: ParsedVisualization,
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

  const BAR_H = 22;

  // === TIME SORT, horizontal: each event on its own row ===
  const sorted = timelineEvents
    .slice()
    .sort((a, b) => parseTimelineDate(a.date) - parseTimelineDate(b.date));

  const scaleMargin = timelineScale ? 24 : 0;
  // Per-feature header rows: era + marker each get their own row, reserved
  // only when present (mirrors the gantt header stack).
  const ERA_ROW_H = 22;
  const MARKER_ROW_H = 22;
  const eraReserve = timelineEras.length > 0 ? ERA_ROW_H : 0;
  const markerReserve = timelineMarkers.length > 0 ? MARKER_ROW_H : 0;
  const topScaleH = timelineScale ? 40 : 0;
  const margin = {
    top: 104 + topScaleH + eraReserve + markerReserve + tagLegendReserve,
    right: 40,
    bottom: 40 + scaleMargin,
    left: 60,
  };
  const markerLabelY = markerReserve ? -(topScaleH + MARKER_ROW_H / 2) : 0;
  const eraLabelY = eraReserve
    ? -(topScaleH + markerReserve + ERA_ROW_H / 2)
    : 0;
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
    const legendY = timelineScale ? -75 : -55;
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
      // Estimate label width (~7px per char at 13px font) + padding
      const estLabelWidth = ev.label.length * 7 + 16;
      const labelFitsInside = rectW >= estLabelWidth;

      let fill: string = shapeFill(palette, color, isDark, { solid });
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
          .attr('font-size', '13px')
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
        .attr('fill', shapeFill(palette, color, isDark, { solid }))
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

// ============================================================
// Timeline — horizontal-grouped renderer (extracted from renderTimeline)
// ============================================================

function renderTimelineHorizontalGrouped(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
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
    tagLanes,
    eventColor,
    minDate,
    maxDate,
    datePadding,
    earliestStartDateStr,
    latestEndDateStr,
    tagLegendReserve,
  } = setup;
  const { fadeToGroup, fadeToEra, fadeToMarker, fadeReset, setTagAttrs } =
    hovers;
  const {
    timelineEvents,
    timelineGroups,
    timelineEras,
    timelineMarkers,
    timelineScale,
    timelineSwimlanes,
  } = parsed;
  const title = parsed.noTitle ? null : parsed.title;

  const BAR_H = 22;
  const GROUP_GAP = 12;

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
  // Per-feature header rows: era + marker each get their own row, reserved
  // only when present (mirrors the gantt header stack).
  const ERA_ROW_H = 22;
  const MARKER_ROW_H = 22;
  const eraReserve = timelineEras.length > 0 ? ERA_ROW_H : 0;
  const markerReserve = timelineMarkers.length > 0 ? MARKER_ROW_H : 0;
  const topScaleH = timelineScale ? 40 : 0;
  // Calculate left margin based on longest group name (~7px per char + padding)
  const maxGroupNameLen = Math.max(...lanes.map((l) => l.name.length));
  const dynamicLeftMargin = Math.max(120, maxGroupNameLen * 7 + 30);
  // Group-sorted doesn't need legend space (group names shown on left)
  const baseTopMargin = title ? 50 : 20;
  const margin = {
    top:
      baseTopMargin + topScaleH + eraReserve + markerReserve + tagLegendReserve,
    right: 40,
    bottom: 40 + scaleMargin,
    left: dynamicLeftMargin,
  };
  // Y offsets for label rows (negative = above chart's y=0).
  const markerLabelY = markerReserve ? -(topScaleH + MARKER_ROW_H / 2) : 0;
  const eraLabelY = eraReserve
    ? -(topScaleH + markerReserve + ERA_ROW_H / 2)
    : 0;
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

  // Render swimlane backgrounds first (so they appear behind events)
  // Extend into left margin to include group names
  if (timelineSwimlanes || tagLanes) {
    let swimY = 0;
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

        let fill: string = shapeFill(palette, evColor, isDark, { solid });
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
            .attr('font-size', '13px')
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
          .attr('fill', shapeFill(palette, evColor, isDark, { solid }))
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
}

// ============================================================
// Timeline — vertical-orientation renderer (extracted from renderTimeline)
// ============================================================

function renderTimelineVertical(
  container: HTMLDivElement,
  parsed: ParsedVisualization,
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
            .attr('fill', shapeFill(palette, evColor, isDark, { solid }))
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

    // Group legend (pill style)
    if (timelineGroups.length > 0) {
      renderTimelineGroupLegend(
        g,
        timelineGroups,
        groupColorMap,
        textColor,
        palette,
        isDark,
        -55,
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
          .attr('fill', shapeFill(palette, color, isDark, { solid }))
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
}

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
    (parsed.timelineSort === 'group' && parsed.timelineGroups.length > 0);
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
      viewMode
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
  const { words, cloudOptions } = parsed;
  const title = parsed.noTitle ? null : parsed.title;
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
        // colors is non-empty; modulo guarantees in-bounds.
        .style('fill', (_d, i) => colors[i % colors.length]!)
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

    const { words, cloudOptions } = parsed;
    const title = parsed.noTitle ? null : parsed.title;
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
          // colors is non-empty; modulo guarantees in-bounds.
          .style('fill', (_d, i) => colors[i % colors.length]!)
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
        // In-bounds by loop guard.
        const isIn = pointInCircle({ x, y }, circles[j]!);
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
        // In-bounds by loop guard.
        fx += circles[j]!.x;
        fy += circles[j]!.y;
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
  _isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { vennSets, vennOverlaps } = parsed;
  const title = parsed.noTitle ? null : parsed.title;
  if (vennSets.length < 2 || vennSets.length > 3) return;

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
    // colors is non-empty; modulo guarantees in-bounds.
    (s, i) => s.color ?? colors[i % colors.length]!
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
    // In-bounds by loop guard (n === vennSets.length === rawCircles.length).
    const estimatedWidth =
      vennSets[i]!.name.length * 8.5 + stubLen + edgePad + labelTextPad;
    const dx = rawCircles[i]!.x - clusterCx;
    const dy = rawCircles[i]!.y - clusterCy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) marginRight = Math.max(marginRight, estimatedWidth);
      else marginLeft = Math.max(marginLeft, estimatedWidth);
    } else {
      const halfEstimate = estimatedWidth * 0.5;
      if (dy >= 0) marginBottom = Math.max(marginBottom, halfEstimate + 20);
      else marginTop = Math.max(marginTop, halfEstimate + 20);
    }
  }

  // Pre-wrap overlap labels and reserve margin so circles shrink enough
  // to leave readable space outside for leader+text. Wrap target scales
  // with the canvas so labels stay narrow on small windows.
  const OVERLAP_FONT = 13;
  const OVERLAP_CH_W = 7;
  const OVERLAP_LINE_H = 16;
  const OVERLAP_LEADER_PAD = 18;
  const OVERLAP_TEXT_GAP = 6;
  const OVERLAP_MARGIN_PAD = 12;
  const OVERLAP_WRAP_TARGET_W = Math.max(80, Math.min(170, width * 0.18));
  const MAX_WRAP_CHARS = Math.max(
    8,
    Math.floor(OVERLAP_WRAP_TARGET_W / OVERLAP_CH_W)
  );

  function wrapLabel(text: string, maxChars: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const cand = cur ? cur + ' ' + w : w;
      if (cand.length > maxChars && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = cand;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [text];
  }

  function predictOverlapDirRaw(idxs: number[]): { x: number; y: number } {
    const excluded = rawCircles
      .map((_, j) => j)
      .filter((j) => !idxs.includes(j));
    if (excluded.length > 0) {
      let sx = 0,
        sy = 0;
      for (const ei of excluded) {
        // ei comes from rawCircles' index map above.
        sx += rawCircles[ei]!.x;
        sy += rawCircles[ei]!.y;
      }
      sx /= excluded.length;
      sy /= excluded.length;
      let cx = 0,
        cy = 0;
      for (const ci of idxs) {
        // ci is a valid index into rawCircles by caller's contract.
        cx += rawCircles[ci]!.x;
        cy += rawCircles[ci]!.y;
      }
      cx /= idxs.length;
      cy /= idxs.length;
      const dx = cx - sx;
      const dy = cy - sy;
      const m = Math.sqrt(dx * dx + dy * dy);
      if (m >= 1e-6) return { x: dx / m, y: dy / m };
    }
    if (n === 3) return { x: 0, y: -1 };
    return { x: 0, y: 1 };
  }

  const wrappedOverlapLabels = new Map<VennOverlap, string[]>();
  for (const ov of vennOverlaps) {
    if (!ov.label) continue;
    const idxs = ov.sets.map((s) => vennSets.findIndex((vs) => vs.name === s));
    if (idxs.some((idx) => idx < 0)) continue;
    const lines = wrapLabel(ov.label, MAX_WRAP_CHARS);
    wrappedOverlapLabels.set(ov, lines);

    const dir = predictOverlapDirRaw(idxs);
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
    const labelW = longest * OVERLAP_CH_W;
    const labelH = lines.length * OVERLAP_LINE_H;
    const baseLeader =
      OVERLAP_LEADER_PAD + OVERLAP_TEXT_GAP + OVERLAP_MARGIN_PAD;

    if (Math.abs(dir.x) >= Math.abs(dir.y)) {
      const need = labelW + baseLeader;
      if (dir.x >= 0) marginRight = Math.max(marginRight, need);
      else marginLeft = Math.max(marginLeft, need);
      // Multi-line label also reaches vertically; reserve half its height
      const halfH = labelH / 2;
      if (dir.y >= 0) marginBottom = Math.max(marginBottom, halfH + 8);
      else marginTop = Math.max(marginTop, halfH + 8);
    } else {
      // Triple-overlap leader exits the union at the top circle's top
      // edge — exactly where that circle's set label gets placed when
      // it can't fit inside (small canvases). Use a longer leader pad
      // so the triple text clears the set label.
      const isStackedTriple = idxs.length === 3 && n === 3 && dir.y < 0;
      const padBoost = isStackedTriple ? 32 : 0;
      const need = labelH + baseLeader + padBoost;
      if (dir.y >= 0) marginBottom = Math.max(marginBottom, need);
      else marginTop = Math.max(marginTop, need);
    }
  }

  const drawH = height - titleHeight;
  // Cap margins so the figure always keeps a usable share of the canvas.
  // If labels need more space than the cap allows the leader+text logic
  // will clamp them to the viewport instead of letting circles shrink to
  // unreadable.
  const maxSideMarginX = width * 0.32;
  const maxSideMarginY = drawH * 0.4;
  marginLeft = Math.min(marginLeft, maxSideMarginX);
  marginRight = Math.min(marginRight, maxSideMarginX);
  marginTop = Math.min(marginTop, maxSideMarginY);
  marginBottom = Math.min(marginBottom, maxSideMarginY);
  const circles = fitCirclesToContainerAsymmetric(
    rawCircles,
    width,
    drawH,
    marginLeft,
    marginRight,
    marginTop,
    marginBottom
  ).map((c) => ({ ...c, y: c.y + titleHeight }));

  // circles is non-empty: vennSets.length >= 2 guard above ensures rawCircles is sized.
  const scaledR = circles[0]!.r;

  // Suppress WebKit focus ring on interactive SVG elements
  svg
    .append('style')
    .text(
      'circle:focus, circle:focus-visible { outline-solid: none !important; }'
    );

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
      // setColors was built from vennSets via map, so i is in-bounds.
      .attr('fill', setColors[i]!)
      .attr('fill-opacity', 0.35)
      .attr('stroke', setColors[i]!)
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
    // idxs is non-empty by construction in regionIdxSets.
    let clipId = `vcp-${idxs[0]!}`;
    for (let k = 1; k < idxs.length; k++) {
      const nestedId = `vcp-n-${idxs.slice(0, k + 1).join('-')}`;
      // k is in-bounds by loop guard.
      const ci = idxs[k]!;
      defs
        .append('clipPath')
        .attr('id', nestedId)
        .append('circle')
        // ci is a valid index into circles by caller's contract.
        .attr('cx', circles[ci]!.x)
        .attr('cy', circles[ci]!.y)
        .attr('r', circles[ci]!.r)
        .attr('clip-path', `url(#${clipId})`);
      clipId = nestedId;
    }

    // Determine line number for this region (for editor sync)
    let regionLineNumber: number | null = null; // eslint-disable-line no-useless-assignment
    if (idxs.length === 1) {
      // idxs[0] guaranteed by length check above.
      regionLineNumber = vennSets[idxs[0]!]!.lineNumber;
    } else {
      const sortedNames = idxs.map((i) => vennSets[i]!.name).sort();
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
        // excluded is built from circles' indices, so j is in-bounds.
        mask
          .append('circle')
          .attr('cx', circles[j]!.x)
          .attr('cy', circles[j]!.y)
          .attr('r', circles[j]!.r)
          .attr('fill', 'black');
      }
      el.attr('mask', `url(#${maskId})`);
    }

    overlayEls.set(key, el);
  }

  // Registry of label wrapper <g>s keyed by region (sorted idxs joined by
  // '-'), so hovering a shape can dim non-matching labels and hovering a
  // label can highlight the matching shape overlay.
  const labelEls = new Map<
    string,
    d3Selection.Selection<SVGGElement, unknown, null, undefined>[]
  >();
  function registerLabel(
    key: string,
    el: d3Selection.Selection<SVGGElement, unknown, null, undefined>
  ) {
    if (!labelEls.has(key)) labelEls.set(key, []);
    labelEls.get(key)!.push(el);
  }
  function dimLabelsExcept(matchKey: string | null) {
    labelEls.forEach((els, k) => {
      const op = matchKey === null || k === matchKey ? 1 : 0.2;
      els.forEach((el) => el.attr('opacity', op));
    });
  }

  const showRegionOverlay = (idxs: number[]) => {
    const key = [...idxs].sort((a, b) => a - b).join('-');
    overlayEls.forEach((el, k) =>
      el.attr('fill-opacity', k === key ? 0 : 0.55)
    );
    dimLabelsExcept(key);
  };
  const hideAllOverlays = () => {
    overlayEls.forEach((el) => el.attr('fill-opacity', 0));
    dimLabelsExcept(null);
  };

  // ── Labels ──
  const gcx = circles.reduce((s, c) => s + c.x, 0) / n;
  const gcy = circles.reduce((s, c) => s + c.y, 0) / n;

  function exclusiveHSpan(_px: number, py: number, ci: number): number {
    // ci is in-bounds: caller passes a circle index.
    const cci = circles[ci]!;
    const dy = py - cci.y;
    const halfChord = Math.sqrt(Math.max(0, cci.r * cci.r - dy * dy));
    let left = cci.x - halfChord;
    let right = cci.x + halfChord;
    for (let j = 0; j < n; j++) {
      if (j === ci) continue;
      // In-bounds: n === circles.length.
      const cj = circles[j]!;
      const djy = py - cj.y;
      if (Math.abs(djy) >= cj.r) continue;
      const hc = Math.sqrt(cj.r * cj.r - djy * djy);
      const jLeft = cj.x - hc;
      const jRight = cj.x + hc;
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

  const labelGroup = svg.append('g');

  // Bboxes of rendered set labels, used to clip overlap leader lines
  // so they don't draw through the set name text.
  type Bbox = { x: number; y: number; w: number; h: number };
  const setLabelBBoxes: Array<Bbox | null> = circles.map(() => null);

  // Set name labels: prefer inside exclusive region, fall back to external leader line
  circles.forEach((c, i) => {
    // vennSets.length === circles.length by construction.
    const text = vennSets[i]!.name;
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

    const setKey = String(i);
    const labelG = labelGroup
      .append('g')
      .style('cursor', 'default')
      .on('mouseenter', () => showRegionOverlay([i]))
      .on('mouseleave', () => hideAllOverlays());
    registerLabel(setKey, labelG);

    if (fitsInside) {
      labelG
        .append('text')
        .attr('x', centroid.x)
        .attr('y', centroid.y)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', textColor)
        .attr('font-size', `${Math.round(fitFont)}px`)
        .attr('font-weight', 'bold')
        .text(text);
      setLabelBBoxes[i] = {
        x: centroid.x - estTextW / 2,
        y: centroid.y - fitFont / 2,
        w: estTextW,
        h: fitFont,
      };
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

      labelG
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

      const renderedTextY = Math.max(14, Math.min(height - 4, textY));
      labelG
        .append('text')
        .attr('x', textX)
        .attr('y', renderedTextY)
        .attr('text-anchor', textAnchor)
        .attr('dominant-baseline', 'central')
        .attr('fill', textColor)
        .attr('font-size', '14px')
        .attr('font-weight', 'bold')
        .text(text);
      const externalEstW = text.length * 8.5;
      setLabelBBoxes[i] = {
        x: isRight ? textX : textX - externalEstW,
        y: renderedTextY - 7,
        w: externalEstW,
        h: 14,
      };
    }
  });

  // Splits a line into visible segments that skip any of the given rects
  // (with optional padding). Used so overlap leaders don't draw through
  // set name text.
  function clipLineByRects(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    rects: Bbox[],
    pad = 4
  ): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const skips: Array<[number, number]> = [];
    for (const raw of rects) {
      const rx = raw.x - pad;
      const ry = raw.y - pad;
      const rw = raw.w + 2 * pad;
      const rh = raw.h + 2 * pad;
      let tMin = 0;
      let tMax = 1;
      if (Math.abs(dx) < 1e-9) {
        if (x1 < rx || x1 > rx + rw) continue;
      } else {
        const t1 = (rx - x1) / dx;
        const t2 = (rx + rw - x1) / dx;
        tMin = Math.max(tMin, Math.min(t1, t2));
        tMax = Math.min(tMax, Math.max(t1, t2));
      }
      if (Math.abs(dy) < 1e-9) {
        if (y1 < ry || y1 > ry + rh) continue;
      } else {
        const t1 = (ry - y1) / dy;
        const t2 = (ry + rh - y1) / dy;
        tMin = Math.max(tMin, Math.min(t1, t2));
        tMax = Math.min(tMax, Math.max(t1, t2));
      }
      if (tMin < tMax) skips.push([Math.max(0, tMin), Math.min(1, tMax)]);
    }
    skips.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const s of skips) {
      const last = merged[merged.length - 1];
      if (!last || s[0] > last[1]) merged.push([s[0], s[1]]);
      else last[1] = Math.max(last[1], s[1]);
    }
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    let cursor = 0;
    for (const [s, e] of merged) {
      if (s > cursor)
        segs.push({
          x1: x1 + dx * cursor,
          y1: y1 + dy * cursor,
          x2: x1 + dx * s,
          y2: y1 + dy * s,
        });
      cursor = Math.max(cursor, e);
    }
    if (cursor < 1)
      segs.push({
        x1: x1 + dx * cursor,
        y1: y1 + dy * cursor,
        x2: x2,
        y2: y2,
      });
    return segs;
  }

  // ── Overlap labels (leader line from region centroid to outside the region) ──
  function overlapOutwardDir(centroid: Point, idxs: number[]): Point {
    const excluded = circles.map((_, j) => j).filter((j) => !idxs.includes(j));
    if (excluded.length > 0) {
      let sx = 0,
        sy = 0;
      for (const ei of excluded) {
        // excluded was built from circles' indices.
        sx += circles[ei]!.x;
        sy += circles[ei]!.y;
      }
      sx /= excluded.length;
      sy /= excluded.length;
      const dx = centroid.x - sx;
      const dy = centroid.y - sy;
      const m = Math.sqrt(dx * dx + dy * dy);
      if (m >= 1e-6) {
        // Snap floating-point noise to 0 so axis-aligned checks downstream work.
        const nx = Math.abs(dx / m) < 1e-9 ? 0 : dx / m;
        const ny = Math.abs(dy / m) < 1e-9 ? 0 : dy / m;
        return { x: nx, y: ny };
      }
    }
    // Triple overlap in 3-set Venn: point up so the leader doesn't
    // collide with the pair (0,1) leader going down.
    if (n === 3) return { x: 0, y: -1 };
    return { x: 0, y: 1 };
  }

  // Where the ray (c0, dir) crosses the lens boundary — the first idxs
  // circle it leaves. This is the visual touch point for pair leaders.
  function lensExit(c0: Point, dir: Point, idxs: number[]): Point {
    let minT = Infinity;
    for (const i of idxs) {
      // idxs only contains valid circle indices (built from regionIdxSets).
      const c = circles[i]!;
      const dx = c0.x - c.x;
      const dy = c0.y - c.y;
      const B = dx * dir.x + dy * dir.y;
      const C = dx * dx + dy * dy - c.r * c.r;
      const disc = B * B - C;
      if (disc < 0) continue;
      const t = -B + Math.sqrt(disc);
      if (t > 0 && t < minT) minT = t;
    }
    if (!isFinite(minT)) return { x: c0.x, y: c0.y };
    return { x: c0.x + dir.x * minT, y: c0.y + dir.y * minT };
  }

  // Where the ray clears the union's visual silhouette — used to position
  // text (and the stub end) so they don't overlap any circle. Walks until
  // outside every circle and, for axis-aligned leaders, also past the
  // union's bounding box on the travel axis.
  function unionExit(c0: Point, dir: Point, idxs: number[]): Point {
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
    const STEP = 3;
    const MAX_ITERS = 400;
    const axisAligned = dir.x === 0 || dir.y === 0;
    let p = { x: c0.x, y: c0.y };
    let leftOverlap = false;
    for (let i = 0; i < MAX_ITERS; i++) {
      const next = { x: p.x + dir.x * STEP, y: p.y + dir.y * STEP };
      p = next;
      if (!leftOverlap) {
        // ci is a valid circle index by caller's contract.
        leftOverlap = !idxs.every((ci) => pointInCircle(next, circles[ci]!));
        if (!leftOverlap) continue;
      }
      const insideAny = circles.some((c) => pointInCircle(next, c));
      if (insideAny) continue;
      if (axisAligned) {
        const passedX = dir.x > 0 ? next.x >= maxX : next.x <= minX;
        const passedY = dir.y > 0 ? next.y >= maxY : next.y <= minY;
        if (dir.x !== 0 && !passedX) continue;
        if (dir.y !== 0 && !passedY) continue;
      }
      break;
    }
    return p;
  }

  for (const ov of vennOverlaps) {
    if (!ov.label) continue;
    const idxs = ov.sets.map((s) => vennSets.findIndex((vs) => vs.name === s));
    if (idxs.some((idx) => idx < 0)) continue;
    const lines = wrappedOverlapLabels.get(ov) ?? [ov.label];
    const inside = circles.map((_, j) => idxs.includes(j));
    const centroid = regionCentroid(circles, inside);
    const dir = overlapOutwardDir(centroid, idxs);
    const isTriple = idxs.length === 3 && n === 3;
    const padBoost = isTriple && dir.y < 0 ? 32 : 0;
    const leaderPad = OVERLAP_LEADER_PAD + padBoost;
    // Pair leaders touch the lens exactly; stub end sits past the union
    // silhouette so text doesn't overlap circles.
    const lensPt = lensExit(centroid, dir, idxs);
    const farExit = unionExit(centroid, dir, idxs);
    const stubEndX = farExit.x + dir.x * leaderPad;
    const stubEndY = farExit.y + dir.y * leaderPad;

    const horizontal = Math.abs(dir.x) >= Math.abs(dir.y);
    let textAnchor: string;
    let baseline = 'central';
    if (horizontal) {
      textAnchor = dir.x >= 0 ? 'start' : 'end';
    } else {
      textAnchor = 'middle';
      baseline = dir.y >= 0 ? 'hanging' : 'auto';
    }

    // For horizontal-dominated leaders, offset text only horizontally and
    // align it vertically with the leader endpoint — otherwise multi-line
    // text blocks engulf the leader's tip. Mirror logic for vertical.
    let textX: number, textY: number;
    if (horizontal) {
      const sign = dir.x >= 0 ? 1 : -1;
      textX = stubEndX + sign * OVERLAP_TEXT_GAP;
      textY = stubEndY;
    } else {
      const sign = dir.y >= 0 ? 1 : -1;
      textX = stubEndX;
      textY = stubEndY + sign * OVERLAP_TEXT_GAP;
    }

    const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
    const blockW = longest * OVERLAP_CH_W;
    const blockH = lines.length * OVERLAP_LINE_H;

    if (textAnchor === 'start') textX = Math.min(textX, width - blockW - 4);
    else if (textAnchor === 'end') textX = Math.max(textX, blockW + 4);
    else
      textX = Math.max(blockW / 2 + 4, Math.min(width - blockW / 2 - 4, textX));

    let topY: number, bottomY: number;
    if (baseline === 'hanging') {
      topY = textY;
      bottomY = textY + blockH;
    } else if (baseline === 'auto') {
      bottomY = textY;
      topY = textY - blockH;
    } else {
      topY = textY - blockH / 2;
      bottomY = textY + blockH / 2;
    }
    if (topY < titleHeight + 6) textY += titleHeight + 6 - topY;
    else if (bottomY > height - 4) textY -= bottomY - (height - 4);

    const startY =
      baseline === 'hanging'
        ? textY
        : baseline === 'auto'
          ? textY - (lines.length - 1) * OVERLAP_LINE_H
          : textY - ((lines.length - 1) * OVERLAP_LINE_H) / 2;

    // Triple leader runs from the centroid (through the diagram) to the
    // text — preserved per the user's "leave the triple alone" request.
    // Pair leaders start exactly on the lens boundary (analytic), so the
    // line touches the shape it describes.
    const leaderStartX = isTriple ? centroid.x : lensPt.x;
    const leaderStartY = isTriple ? centroid.y : lensPt.y;

    // Tint the leader + text with the average of the constituent set
    // colors so the label visually ties to its overlap region. Mix a bit
    // of the body text color in to keep contrast against the bg.
    // idxs is non-empty; its entries are valid indices into setColors (same length as vennSets).
    let tinted = setColors[idxs[0]!]!;
    for (let k = 1; k < idxs.length; k++) {
      const pct = (k / (k + 1)) * 100;
      // k in-bounds by loop; idxs[k] is a valid setColors index.
      tinted = mix(tinted, setColors[idxs[k]!]!, pct);
    }
    const overlapColor = mix(tinted, textColor, 90);

    const ovKey = [...idxs].sort((a, b) => a - b).join('-');
    const ovLabelG = labelGroup
      .append('g')
      .style('cursor', 'default')
      .on('mouseenter', () => showRegionOverlay(idxs))
      .on('mouseleave', () => hideAllOverlays());
    registerLabel(ovKey, ovLabelG);

    const labelRects = setLabelBBoxes.filter((b): b is Bbox => b !== null);
    const segments = clipLineByRects(
      leaderStartX,
      leaderStartY,
      stubEndX,
      stubEndY,
      labelRects,
      4
    );
    for (const seg of segments) {
      ovLabelG
        .append('line')
        .attr('x1', seg.x1)
        .attr('y1', seg.y1)
        .attr('x2', seg.x2)
        .attr('y2', seg.y2)
        .attr('stroke', overlapColor)
        .attr('stroke-width', 1.25)
        .attr('opacity', 0.85);
    }

    const textEl = ovLabelG
      .append('text')
      .attr('text-anchor', textAnchor)
      .attr('dominant-baseline', baseline)
      .attr('fill', overlapColor)
      .attr('font-size', `${OVERLAP_FONT}px`)
      .attr('font-weight', '600');

    lines.forEach((line, i) => {
      const tspan = textEl.append('tspan').attr('x', textX);
      if (i === 0) tspan.attr('y', startY);
      else tspan.attr('dy', OVERLAP_LINE_H);
      tspan.text(line);
    });
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
      // vennSets[i] in-bounds: circles.length === vennSets.length.
      .attr('data-line-number', String(vennSets[i]!.lineNumber))
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .style('outline-solid', 'none')
      .on('mouseenter', () => {
        showRegionOverlay([i]);
      })
      .on('mouseleave', () => {
        hideAllOverlays();
      })
      .on('click', function () {
        (this as SVGElement).blur?.();
        if (onClickItem && vennSets[i]!.lineNumber)
          onClickItem(vennSets[i]!.lineNumber);
      });
  });

  // Intersection targets: centroid-based circles for all overlap regions (declared + undeclared)
  const overlayR = scaledR * 0.35;

  const subsets: { idxs: number[]; sets: string[] }[] = [];
  if (n === 2) {
    // n === 2 ⇒ vennSets has at least 2 entries.
    subsets.push({
      idxs: [0, 1],
      sets: [vennSets[0]!.name, vennSets[1]!.name].sort(),
    });
  } else {
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        // a and b are valid vennSets indices (n === vennSets.length).
        subsets.push({
          idxs: [a, b],
          sets: [vennSets[a]!.name, vennSets[b]!.name].sort(),
        });
      }
    }
    // n === 3 path ⇒ vennSets has 3 entries.
    subsets.push({
      idxs: [0, 1, 2],
      sets: [vennSets[0]!.name, vennSets[1]!.name, vennSets[2]!.name].sort(),
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
      .style('outline-solid', 'none')
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
    quadrantLabels,
    quadrantPoints,
    quadrantXAxis,
    quadrantYAxis,
    quadrantTitleLineNumber,
    quadrantXAxisLineNumber,
    quadrantYAxisLineNumber,
  } = parsed;
  const title = parsed.noTitle ? null : parsed.title;

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
    const parse = (h: string): [number, number, number] => {
      const r = h.replace('#', '');
      // In-bounds: 3-char path indexes [0],[1],[2].
      const f =
        r.length === 3 ? r[0]! + r[0]! + r[1]! + r[1]! + r[2]! + r[2]! : r;
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
    // defaultColors is non-empty; modulo guarantees in-bounds.
    return label?.color ?? defaultColors[defaultIdx % defaultColors.length]!;
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

  // White text for points; quadrant labels use a muted text color (consistent across all quadrants)
  const shadowColor = 'rgba(0,0,0,0.4)';

  // Single muted shade of textColor — watermark-style, readable against any quadrant fill
  const quadrantLabelColor = mixHex(textColor, bg, 35);

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

  // Renders the original watermark content (quadrant name) into a text element.
  // Extracted so point hover can swap it for a hover state and restore on leave.
  const renderWatermarkOriginal = (
    textEl: SVGTextElement,
    d: (typeof quadrantDefsWithLabel)[number]
  ) => {
    const layout = labelLayouts.get(d.label!.text)!;
    const el = d3Selection.select(textEl);
    el.text(null)
      .attr('font-size', `${layout.fontSize}px`)
      .attr('font-weight', '700');
    if (layout.lines.length === 1) {
      // In-bounds by length === 1 check.
      el.text(layout.lines[0]!);
    } else {
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
  };

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
    .attr('fill', quadrantLabelColor)
    .attr('data-line-number', (d) =>
      d.label?.lineNumber ? String(d.label.lineNumber) : null
    )
    .style('cursor', (d) =>
      onClickItem && d.label?.lineNumber ? 'pointer' : 'default'
    )
    .each(function (d) {
      renderWatermarkOriginal(this as SVGTextElement, d);
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

  // Build obstacle rects from quadrant watermark labels for collision avoidance
  const POINT_RADIUS = 6;
  const POINT_LABEL_FONT_SIZE = 12;
  const quadrantLabelObstacles: LabelRect[] = quadrantDefsWithLabel.map((d) => {
    const layout = labelLayouts.get(d.label!.text)!;
    const totalW =
      Math.max(...layout.lines.map((l) => l.length)) *
      layout.fontSize *
      CHAR_WIDTH_RATIO;
    const totalH = layout.lines.length * layout.fontSize * 1.2;
    return {
      x: d.labelX - totalW / 2,
      y: d.labelY - totalH / 2,
      w: totalW,
      h: totalH,
    };
  });

  // Compute collision-free label positions for all points
  const pointPixels = quadrantPoints.map((point) => ({
    label: point.label,
    cx: xScale(point.x),
    cy: yScale(point.y),
  }));

  const placedPointLabels = computeQuadrantPointLabels(
    pointPixels,
    { left: 0, top: 0, right: chartWidth, bottom: chartHeight },
    quadrantLabelObstacles,
    POINT_RADIUS,
    POINT_LABEL_FONT_SIZE
  );

  // Draw data points (circles and labels)
  const pointsG = chartG.append('g').attr('class', 'points');

  quadrantPoints.forEach((point, i) => {
    const cx = xScale(point.x);
    const cy = yScale(point.y);
    const quadrant = getPointQuadrant(point.x, point.y);
    const quadDef = quadrantDefs.find((d) => d.position === quadrant);
    // defaultColors is non-empty; in-bounds by modulo / fallback to index 0.
    const pointColor =
      quadDef?.label?.color ?? defaultColors[quadDef?.colorIdx ?? 0]!;
    // placedPointLabels was produced by computeQuadrantPointLabels from pointPixels,
    // which has the same length as quadrantPoints.
    const placed = placedPointLabels[i]!;

    const pointG = pointsG
      .append('g')
      .attr('class', 'point-group')
      .attr('data-line-number', String(point.lineNumber));

    // Connector line (drawn first so it renders behind circle and label)
    if (placed.connectorLine) {
      pointG
        .append('line')
        .attr('x1', placed.connectorLine.x1)
        .attr('y1', placed.connectorLine.y1)
        .attr('x2', placed.connectorLine.x2)
        .attr('y2', placed.connectorLine.y2)
        .attr('stroke', pointColor)
        .attr('stroke-width', 1)
        .attr('opacity', 0.5);
    }

    // Circle with white fill and colored border for visibility on opaque quadrants
    pointG
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', POINT_RADIUS)
      .attr('fill', '#ffffff')
      .attr('stroke', pointColor)
      .attr('stroke-width', 2);

    // Label at computed position. Name is always shown; coords sit below
    // (smaller, lighter weight) and only appear on hover.
    const labelText = pointG
      .append('text')
      .attr('x', placed.x)
      .attr('y', placed.y)
      .attr('text-anchor', placed.anchor)
      .attr('dominant-baseline', 'central')
      .attr('fill', textColor)
      .attr('font-size', `${POINT_LABEL_FONT_SIZE}px`)
      .attr('font-weight', '700')
      .style('text-shadow', `0 1px 2px ${shadowColor}`)
      .style('transition', 'y 120ms ease-out');

    labelText.append('tspan').text(point.label);

    const coordsTspan = labelText
      .append('tspan')
      .attr('class', 'point-coords')
      .attr('x', placed.x)
      .attr('dy', `${POINT_LABEL_FONT_SIZE}px`)
      .attr('font-size', '10px')
      .attr('font-weight', '500')
      .attr('opacity', 0)
      .text(`${point.x.toFixed(2)}, ${point.y.toFixed(2)}`);

    // On hover, shift the label away from the dot so the coords line
    // (which sits below the name) doesn't land on the circle.
    const COORDS_LINE_H = 14;
    const bumpDy = placed.y < cy ? -COORDS_LINE_H : COORDS_LINE_H;

    pointG
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .on('mouseenter', () => {
        pointG.select('circle').attr('r', 8);
        labelText.attr('y', placed.y + bumpDy);
        coordsTspan.attr('opacity', 1);
        quadrantRects.attr('opacity', (qd) =>
          qd.position === quadrant ? 1 : 0.3
        );
        quadrantLabelTexts.attr('opacity', (qd) =>
          qd.position === quadrant ? 1 : 0.3
        );
        pointsG
          .selectAll<SVGGElement, unknown>('g.point-group')
          .filter((_, j) => j !== i)
          .attr('opacity', 0.3);
      })
      .on('mouseleave', () => {
        pointG.select('circle').attr('r', POINT_RADIUS);
        labelText.attr('y', placed.y);
        coordsTspan.attr('opacity', 0);
        quadrantRects.attr('opacity', 1);
        quadrantLabelTexts.attr('opacity', 1);
        pointsG.selectAll('g.point-group').attr('opacity', 1);
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
        // selectAll iterates over point-group elements, so i indexes into quadrantPoints.
        const pt = quadrantPoints[i]!;
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
  palette: PaletteColors
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
  viewState?: import('./sharing').CompactViewState,
  options?: {
    c4Level?: 'context' | 'containers' | 'components' | 'deployment';
    c4System?: string;
    c4Container?: string;
    tagGroup?: string;
    exportMode?: boolean;
  }
): Promise<string> {
  const exportMode = options?.exportMode ?? false;
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

    // Apply interactive collapse state when provided (read from unified viewState)
    const collapsedNodes = viewState?.cg ? new Set(viewState.cg) : undefined;
    const activeTagGroup = resolveActiveTagGroup(
      orgParsed.tagGroups,
      orgParsed.options['active-tag'],
      viewState?.tag ?? options?.tagGroup
    );
    const hiddenAttributes = viewState?.ha ? new Set(viewState.ha) : undefined;

    const { parsed: effectiveParsed, hiddenCounts } =
      collapsedNodes && collapsedNodes.size > 0
        ? collapseOrgTree(orgParsed, collapsedNodes)
        : { parsed: orgParsed, hiddenCounts: new Map<string, number>() };

    const orgLayout = layoutOrg(
      effectiveParsed,
      hiddenCounts.size > 0 ? hiddenCounts : undefined,
      activeTagGroup,
      hiddenAttributes,
      false // expandAllLegend off — collapsed-by-default per §1.3
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
      hiddenAttributes,
      undefined,
      exportMode
    );
    return finalizeSvgExport(container, theme, effectivePalette);
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

    // Apply interactive collapse state when provided (read from unified viewState)
    const collapsedNodes = viewState?.cg ? new Set(viewState.cg) : undefined;
    const activeTagGroup = resolveActiveTagGroup(
      sitemapParsed.tagGroups,
      sitemapParsed.options['active-tag'],
      viewState?.tag ?? options?.tagGroup
    );
    const hiddenAttributes = viewState?.ha ? new Set(viewState.ha) : undefined;

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
      hiddenAttributes,
      exportMode
    );
    return finalizeSvgExport(container, theme, effectivePalette);
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

    const kanbanCollapsedLanes = viewState?.cl
      ? new Set(viewState.cl)
      : undefined;
    const kanbanCollapsedColumns = viewState?.cc
      ? new Set(viewState.cc)
      : undefined;
    renderKanban(container, kanbanParsed, effectivePalette, theme === 'dark', {
      activeTagGroup: resolveActiveTagGroup(
        kanbanParsed.tagGroups,
        kanbanParsed.options['active-tag'],
        viewState?.tag ?? options?.tagGroup
      ),
      currentSwimlaneGroup: viewState?.swim ?? null,
      ...(kanbanCollapsedLanes !== undefined && {
        collapsedLanes: kanbanCollapsedLanes,
      }),
      ...(kanbanCollapsedColumns !== undefined && {
        collapsedColumns: kanbanCollapsedColumns,
      }),
      ...(viewState?.cm !== undefined && { compactMeta: viewState.cm }),
      exportMode,
    });
    return finalizeSvgExport(container, theme, effectivePalette);
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
      { width: exportWidth, height: exportHeight },
      undefined,
      exportMode
    );
    return finalizeSvgExport(container, theme, effectivePalette);
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
      resolveActiveTagGroup(
        erParsed.tagGroups,
        erParsed.options['active-tag'],
        viewState?.tag ?? options?.tagGroup
      ),
      viewState?.sem,
      exportMode
    );
    return finalizeSvgExport(container, theme, effectivePalette);
  }

  if (detectedType === 'boxes-and-lines') {
    const { parseBoxesAndLines } = await import('./boxes-and-lines/parser');
    const effectivePalette = await resolveExportPalette(theme, palette);
    const blParsed = parseBoxesAndLines(content);
    if (blParsed.error || blParsed.nodes.length === 0) return '';

    // Convert viewState.htv (Record<string, string[]>) to Map<string, Set<string>>
    let blHiddenTagValues: Map<string, Set<string>> | undefined;
    if (viewState?.htv) {
      blHiddenTagValues = new Map();
      for (const [k, v] of Object.entries(viewState.htv)) {
        blHiddenTagValues.set(k, new Set(v));
      }
    }

    const { renderBoxesAndLinesForExport } =
      await import('./boxes-and-lines/renderer');
    const { layoutBoxesAndLines } = await import('./boxes-and-lines/layout');
    const blLayout = await layoutBoxesAndLines(blParsed);
    const PADDING = 20;
    const titleOffset = blParsed.title ? 40 : 0;
    const exportWidth = blLayout.width + PADDING * 2;
    const exportHeight = blLayout.height + PADDING * 2 + titleOffset;
    const container = createExportContainer(exportWidth, exportHeight);

    const blActiveTagGroup = viewState?.tag ?? options?.tagGroup;
    renderBoxesAndLinesForExport(
      container,
      blParsed,
      blLayout,
      effectivePalette,
      theme === 'dark',
      {
        exportDims: { width: exportWidth, height: exportHeight },
        ...(blActiveTagGroup !== undefined && {
          activeTagGroup: blActiveTagGroup,
        }),
        ...(blHiddenTagValues !== undefined && {
          hiddenTagValues: blHiddenTagValues,
        }),
        exportMode,
      }
    );
    return finalizeSvgExport(container, theme, effectivePalette);
  }

  if (detectedType === 'mindmap') {
    const { parseMindmap } = await import('./mindmap/parser');
    const { layoutMindmap } = await import('./mindmap/layout');
    const { collapseMindmapTree } = await import('./mindmap/collapse');
    const { renderMindmap } = await import('./mindmap/renderer');

    const isDark = theme === 'dark';
    const effectivePalette = await resolveExportPalette(theme, palette);

    const mmParsed = parseMindmap(content, effectivePalette);
    if (mmParsed.error) return '';

    const collapsedNodes = viewState?.cg ? new Set(viewState.cg) : undefined;
    const activeTagGroup = resolveActiveTagGroup(
      mmParsed.tagGroups,
      mmParsed.options['active-tag'],
      viewState?.tag ?? options?.tagGroup
    );
    const hideDescriptions =
      mmParsed.options['no-descriptions'] === 'true' || viewState?.hd === true;

    const { roots: effectiveRoots, hiddenCounts } =
      collapsedNodes && collapsedNodes.size > 0
        ? collapseMindmapTree(mmParsed.roots, collapsedNodes)
        : { roots: mmParsed.roots, hiddenCounts: new Map<string, number>() };

    const effectiveParsed = { ...mmParsed, roots: effectiveRoots };

    const mmLayout = layoutMindmap(effectiveParsed, effectivePalette, {
      interactive: false,
      ...(hiddenCounts.size > 0 && { hiddenCounts }),
      activeTagGroup,
      hideDescriptions,
    });

    const PADDING = 20;
    const titleOffset = effectiveParsed.title ? 30 : 0;
    const exportWidth = mmLayout.width + PADDING * 2;
    const exportHeight = mmLayout.height + PADDING * 2 + titleOffset;
    const container = createExportContainer(exportWidth, exportHeight);

    const colorByDepth = viewState?.cbd === true;

    renderMindmap(
      container,
      effectiveParsed,
      mmLayout,
      effectivePalette,
      isDark,
      undefined,
      { width: exportWidth, height: exportHeight },
      undefined,
      hideDescriptions,
      colorByDepth ? null : activeTagGroup,
      colorByDepth ? { colorByDepth: true, exportMode } : { exportMode }
    );
    return finalizeSvgExport(container, theme, effectivePalette);
  }

  if (detectedType === 'wireframe') {
    const { parseWireframe } = await import('./wireframe/parser');
    const { layoutWireframe } = await import('./wireframe/layout');
    const { renderWireframe } = await import('./wireframe/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const wireframeParsed = parseWireframe(content);
    if (
      wireframeParsed.error ||
      (wireframeParsed.roots.length === 0 &&
        wireframeParsed.modals.length === 0)
    )
      return '';

    const wireframeLayout = layoutWireframe(wireframeParsed);

    const exportWidth = wireframeLayout.width;
    const exportHeight = wireframeLayout.height;
    const container = createExportContainer(exportWidth, exportHeight);

    renderWireframe(
      container,
      wireframeParsed,
      wireframeLayout,
      effectivePalette,
      theme === 'dark',
      undefined,
      { width: exportWidth, height: exportHeight },
      theme
    );
    return finalizeSvgExport(container, theme, effectivePalette);
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

    // Container/component-level rendering (viewState fallback for share links)
    const c4Level =
      options?.c4Level ??
      (viewState?.c4l as
        | 'context'
        | 'containers'
        | 'components'
        | 'deployment'
        | undefined) ??
      'context';
    const c4System = options?.c4System ?? viewState?.c4s;
    const c4Container = options?.c4Container ?? viewState?.c4c;

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
      resolveActiveTagGroup(
        c4Parsed.tagGroups,
        c4Parsed.options['active-tag'],
        viewState?.tag ?? options?.tagGroup
      ),
      exportMode
    );
    return finalizeSvgExport(container, theme, effectivePalette);
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
    return finalizeSvgExport(container, theme, effectivePalette);
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
    const activeTagGroup = resolveActiveTagGroup(
      infraParsed.tagGroups,
      infraParsed.options['active-tag'],
      viewState?.tag ?? options?.tagGroup
    );

    const showInfraTitle =
      !!infraParsed.title && infraParsed.options['no-title'] !== 'on';
    const titleOffset = showInfraTitle ? 40 : 0;
    const infraTagGroups = [...infraParsed.tagGroups];
    const legendGroups = computeInfraLegendGroups(
      infraLayout.nodes,
      infraTagGroups,
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
      showInfraTitle ? infraParsed.title : null,
      showInfraTitle ? infraParsed.titleLineNumber : null,
      infraTagGroups,
      activeTagGroup,
      false,
      null,
      null,
      true,
      viewState?.cg ? new Set(viewState.cg) : null
    );
    // Restore explicit pixel dimensions for resvg (renderer uses 100%/viewBox for app scaling)
    const infraSvg = container.querySelector('svg');
    if (infraSvg) {
      infraSvg.setAttribute('width', String(exportWidth));
      infraSvg.setAttribute('height', String(exportHeight));
    }
    return finalizeSvgExport(container, theme, effectivePalette);
  }

  if (detectedType === 'pert') {
    const { parsePert } = await import('./pert/parser');
    const { analyzePert } = await import('./pert/analyzer');
    const { layoutPert } = await import('./pert/layout');
    const { renderPert, measurePertAnalysisBlock } =
      await import('./pert/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const pertParsed = parsePert(content, { palette: effectivePalette });
    if (pertParsed.error || pertParsed.activities.length === 0) return '';

    const pertResolved = analyzePert(pertParsed);
    const pertLayout = layoutPert(pertResolved);

    const titleHeight =
      pertParsed.title && !pertParsed.options.noTitle ? 80 : 0;
    const PERT_PADDING = 20;
    const analysisOn = viewState?.an === true;
    const fieldLabelsOn = viewState?.fl === true;
    const exportW = pertLayout.width + PERT_PADDING * 2;
    const analysisMeasured =
      analysisOn || fieldLabelsOn
        ? measurePertAnalysisBlock(pertResolved, exportW - 2 * PERT_PADDING, {
            showSummary: false,
            showTornado: analysisOn,
            showScurve: analysisOn,
            showFieldLegend: fieldLabelsOn,
          })
        : { width: 0, height: 0 };
    const exportH =
      pertLayout.height +
      PERT_PADDING * 2 +
      titleHeight +
      analysisMeasured.height;
    const container = createExportContainer(exportW, exportH);

    renderPert(
      container,
      pertResolved,
      pertLayout,
      effectivePalette,
      theme === 'dark',
      {
        title: pertParsed.title,
        exportDims: { width: exportW, height: exportH },
        showSummary: false,
        showTornado: analysisOn,
        showScurve: analysisOn,
        showFieldLegend: fieldLabelsOn,
      }
    );
    return finalizeSvgExport(container, theme, effectivePalette);
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

    const ganttCollapsedGroups = viewState?.cg
      ? new Set(viewState.cg)
      : undefined;
    const ganttSwimlaneGroup = viewState?.swim ?? undefined;
    const ganttCollapsedLanes = viewState?.cl
      ? new Set(viewState.cl)
      : undefined;
    renderGantt(
      container,
      resolved,
      effectivePalette,
      theme === 'dark',
      {
        ...(ganttCollapsedGroups !== undefined && {
          collapsedGroups: ganttCollapsedGroups,
        }),
        ...(ganttSwimlaneGroup !== undefined && {
          currentSwimlaneGroup: ganttSwimlaneGroup,
        }),
        ...(ganttCollapsedLanes !== undefined && {
          collapsedLanes: ganttCollapsedLanes,
        }),
        currentActiveGroup: resolveActiveTagGroup(
          resolved.tagGroups,
          resolved.options.activeTag ?? undefined,
          viewState?.tag ?? options?.tagGroup
        ),
        exportMode,
      },
      { width: EXPORT_W, height: EXPORT_H }
    );
    return finalizeSvgExport(container, theme, effectivePalette);
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
    return finalizeSvgExport(container, theme, effectivePalette);
  }

  if (detectedType === 'tech-radar') {
    const { parseTechRadar } = await import('./tech-radar/parser');
    const { renderTechRadarForExport } = await import('./tech-radar/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const radarParsed = parseTechRadar(content);
    if (radarParsed.error || radarParsed.quadrants.length === 0) return '';

    const RADAR_EXPORT_W = 1300;
    const RADAR_EXPORT_H = 1500;
    const container = createExportContainer(RADAR_EXPORT_W, RADAR_EXPORT_H);
    renderTechRadarForExport(
      container,
      radarParsed,
      effectivePalette,
      theme === 'dark',
      { width: RADAR_EXPORT_W, height: RADAR_EXPORT_H },
      viewState,
      exportMode
    );
    return finalizeSvgExport(container, theme, effectivePalette);
  }

  if (detectedType === 'journey-map') {
    const { parseJourneyMap } = await import('./journey-map/parser');
    const { renderJourneyMap } = await import('./journey-map/renderer');
    const { layoutJourneyMap } = await import('./journey-map/layout');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const jmParsed = parseJourneyMap(content, effectivePalette);
    if (
      jmParsed.error ||
      (jmParsed.phases.length === 0 && jmParsed.steps.length === 0)
    )
      return '';

    const jmLayout = layoutJourneyMap(jmParsed, effectivePalette, {
      isDark: theme === 'dark',
    });
    const container = createExportContainer(
      jmLayout.totalWidth,
      jmLayout.totalHeight
    );
    renderJourneyMap(container, jmParsed, effectivePalette, theme === 'dark', {
      exportDims: { width: jmLayout.totalWidth, height: jmLayout.totalHeight },
      exportMode,
    });
    return finalizeSvgExport(container, theme, effectivePalette);
  }

  if (detectedType === 'cycle') {
    const { parseCycle } = await import('./cycle/parser');
    const { renderCycleForExport } = await import('./cycle/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const cycleParsed = parseCycle(content);
    if (cycleParsed.error || cycleParsed.nodes.length === 0) return '';

    const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
    renderCycleForExport(
      container,
      cycleParsed,
      effectivePalette,
      theme === 'dark',
      { width: EXPORT_WIDTH, height: EXPORT_HEIGHT },
      viewState,
      exportMode
    );
    return finalizeSvgExport(container, theme, effectivePalette);
  }

  if (detectedType === 'pyramid') {
    const { parsePyramid } = await import('./pyramid/parser');
    const { renderPyramidForExport } = await import('./pyramid/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const pyramidParsed = parsePyramid(content);
    if (pyramidParsed.error || pyramidParsed.layers.length === 0) return '';

    const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
    renderPyramidForExport(
      container,
      pyramidParsed,
      effectivePalette,
      theme === 'dark',
      { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
    );
    return finalizeSvgExport(container, theme, effectivePalette);
  }

  if (detectedType === 'ring') {
    const { parseRing } = await import('./ring/parser');
    const { renderRingForExport } = await import('./ring/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const ringParsed = parseRing(content);
    if (ringParsed.error || ringParsed.layers.length === 0) return '';

    const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
    renderRingForExport(
      container,
      ringParsed,
      effectivePalette,
      theme === 'dark',
      { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
    );
    return finalizeSvgExport(container, theme, effectivePalette);
  }

  if (
    detectedType === 'raci' ||
    detectedType === 'rasci' ||
    detectedType === 'daci'
  ) {
    const { parseRaci } = await import('./raci/parser');
    const { renderRaciForExport } = await import('./raci/renderer');

    const effectivePalette = await resolveExportPalette(theme, palette);
    const raciParsed = parseRaci(content, effectivePalette);
    if (raciParsed.error) return '';

    const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
    renderRaciForExport(
      container,
      raciParsed,
      effectivePalette,
      theme === 'dark',
      { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
    );
    return finalizeSvgExport(container, theme, effectivePalette);
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
        ...(options?.tagGroup !== undefined && {
          activeTagGroup: options.tagGroup,
        }),
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
      resolveActiveTagGroup(
        parsed.timelineTagGroups,
        undefined,
        viewState?.tag ?? options?.tagGroup
      ),
      viewState?.swim,
      undefined,
      undefined,
      exportMode
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

  return finalizeSvgExport(container, theme, effectivePalette);
}
