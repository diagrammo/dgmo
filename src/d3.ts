import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import * as d3Array from 'd3-array';
import cloud from 'd3-cloud';
import { FONT_FAMILY } from './fonts';

// ============================================================
// Types
// ============================================================

export type D3ChartType =
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

export type TimelineSort = 'time' | 'group';

export interface TimelineEvent {
  date: string;
  endDate: string | null;
  label: string;
  group: string | null;
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
}

export interface TimelineMarker {
  date: string;
  label: string;
  color: string | null;
  lineNumber: number;
}

export interface VennSet {
  name: string;
  size: number;
  color: string | null;
  label: string | null;
  lineNumber: number;
}

export interface VennOverlap {
  sets: string[];
  size: number;
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

export interface ParsedD3 {
  type: D3ChartType | null;
  title: string | null;
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
  timelineSort: TimelineSort;
  timelineScale: boolean;
  timelineSwimlanes: boolean;
  gridlines: boolean;
  vennSets: VennSet[];
  vennOverlaps: VennOverlap[];
  vennShowValues: boolean;
  // Quadrant chart fields
  quadrantLabels: QuadrantLabels;
  quadrantPoints: QuadrantPoint[];
  quadrantXAxis: [string, string] | null;
  quadrantXAxisLineNumber: number | null;
  quadrantYAxis: [string, string] | null;
  quadrantYAxisLineNumber: number | null;
  quadrantTitleLineNumber: number | null;
  error: string | null;
}

// ============================================================
// Color Imports
// ============================================================

import { resolveColor } from './colors';
import type { PaletteColors } from './palettes';
import { getSeriesColors } from './palettes';

// ============================================================
// Timeline Date Helper
// ============================================================

/**
 * Converts a date string (YYYY, YYYY-MM, YYYY-MM-DD) to a fractional year number.
 */
export function parseTimelineDate(s: string): number {
  const parts = s.split('-').map((p) => parseInt(p, 10));
  const year = parts[0];
  const month = parts.length >= 2 ? parts[1] : 1;
  const day = parts.length >= 3 ? parts[2] : 1;
  return year + (month - 1) / 12 + (day - 1) / 365;
}

/**
 * Adds a duration to a date string and returns the resulting date string.
 * Supports: d (days), w (weeks), m (months), y (years)
 * Supports decimals up to 2 places (e.g., 1.25y = 1 year 3 months)
 * Preserves the precision of the input date (YYYY, YYYY-MM, or YYYY-MM-DD).
 */
export function addDurationToDate(
  startDate: string,
  amount: number,
  unit: 'd' | 'w' | 'm' | 'y'
): string {
  const parts = startDate.split('-').map((p) => parseInt(p, 10));
  const year = parts[0];
  const month = parts.length >= 2 ? parts[1] : 1;
  const day = parts.length >= 3 ? parts[2] : 1;

  const date = new Date(year, month - 1, day);

  switch (unit) {
    case 'd':
      // Round days to nearest integer
      date.setDate(date.getDate() + Math.round(amount));
      break;
    case 'w':
      // Convert weeks to days, round to nearest integer
      date.setDate(date.getDate() + Math.round(amount * 7));
      break;
    case 'm': {
      // Add whole months, then remaining days
      const wholeMonths = Math.floor(amount);
      const fractionalDays = Math.round((amount - wholeMonths) * 30);
      date.setMonth(date.getMonth() + wholeMonths);
      if (fractionalDays > 0) {
        date.setDate(date.getDate() + fractionalDays);
      }
      break;
    }
    case 'y': {
      // Add whole years, then remaining months
      const wholeYears = Math.floor(amount);
      const fractionalMonths = Math.round((amount - wholeYears) * 12);
      date.setFullYear(date.getFullYear() + wholeYears);
      if (fractionalMonths > 0) {
        date.setMonth(date.getMonth() + fractionalMonths);
      }
      break;
    }
  }

  // Preserve original precision
  const endYear = date.getFullYear();
  const endMonth = String(date.getMonth() + 1).padStart(2, '0');
  const endDay = String(date.getDate()).padStart(2, '0');

  if (parts.length === 1) {
    return String(endYear);
  } else if (parts.length === 2) {
    return `${endYear}-${endMonth}`;
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
export function parseD3(content: string, palette?: PaletteColors): ParsedD3 {
  const result: ParsedD3 = {
    type: null,
    title: null,
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
    timelineSort: 'time',
    timelineScale: true,
    timelineSwimlanes: false,
    gridlines: true,
    vennSets: [],
    vennOverlaps: [],
    vennShowValues: false,
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
    error: null,
  };

  if (!content || !content.trim()) {
    result.error = 'Empty content';
    return result;
  }

  const lines = content.split('\n');
  const freeformLines: string[] = [];
  let currentArcGroup: string | null = null;
  let currentTimelineGroup: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNumber = i + 1;

    // Skip empty lines
    if (!line) continue;

    // ## Section headers for arc diagram node grouping (before # comment check)
    const sectionMatch = line.match(/^#{2,}\s+(.+?)(?:\s*\(([^)]+)\))?\s*$/);
    if (sectionMatch) {
      if (result.type === 'arc') {
        const name = sectionMatch[1].trim();
        const color = sectionMatch[2]
          ? resolveColor(sectionMatch[2].trim(), palette)
          : null;
        result.arcNodeGroups.push({ name, nodes: [], color, lineNumber });
        currentArcGroup = name;
      } else if (result.type === 'timeline') {
        const name = sectionMatch[1].trim();
        const color = sectionMatch[2]
          ? resolveColor(sectionMatch[2].trim(), palette)
          : null;
        result.timelineGroups.push({ name, color, lineNumber });
        currentTimelineGroup = name;
      }
      continue;
    }

    // Skip comments
    if (line.startsWith('#') || line.startsWith('//')) {
      continue;
    }

    // Arc link line: source -> target(color): weight
    if (result.type === 'arc') {
      const linkMatch = line.match(
        /^(.+?)\s*->\s*(.+?)(?:\(([^)]+)\))?\s*(?::\s*(\d+(?:\.\d+)?))?$/
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

    // Timeline era lines: era YYYY->YYYY: Label (color)
    if (result.type === 'timeline') {
      const eraMatch = line.match(
        /^era\s+(\d{4}(?:-\d{2})?(?:-\d{2})?)\s*->\s*(\d{4}(?:-\d{2})?(?:-\d{2})?)\s*:\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/
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
        });
        continue;
      }

      // Timeline marker lines: marker YYYY: Label (color)
      const markerMatch = line.match(
        /^marker\s+(\d{4}(?:-\d{2})?(?:-\d{2})?)\s*:\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/
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
      // Duration event: 2026-07-15->30d: description (d=days, w=weeks, m=months, y=years)
      // Supports decimals up to 2 places (e.g., 1.25y = 1 year 3 months)
      // Supports uncertain end with ? prefix (e.g., ->?3m fades out the last 20%)
      const durationMatch = line.match(
        /^(\d{4}(?:-\d{2})?(?:-\d{2})?)\s*->\s*(\?)?(\d+(?:\.\d{1,2})?)([dwmy])\s*:\s*(.+)$/
      );
      if (durationMatch) {
        const startDate = durationMatch[1];
        const uncertain = durationMatch[2] === '?';
        const amount = parseFloat(durationMatch[3]);
        const unit = durationMatch[4] as 'd' | 'w' | 'm' | 'y';
        const endDate = addDurationToDate(startDate, amount, unit);
        result.timelineEvents.push({
          date: startDate,
          endDate,
          label: durationMatch[5].trim(),
          group: currentTimelineGroup,
          lineNumber,
          uncertain,
        });
        continue;
      }

      // Range event: 1655->1667: description (supports uncertain end: 1655->?1667)
      const rangeMatch = line.match(
        /^(\d{4}(?:-\d{2})?(?:-\d{2})?)\s*->\s*(\?)?(\d{4}(?:-\d{2})?(?:-\d{2})?)\s*:\s*(.+)$/
      );
      if (rangeMatch) {
        result.timelineEvents.push({
          date: rangeMatch[1],
          endDate: rangeMatch[3],
          label: rangeMatch[4].trim(),
          group: currentTimelineGroup,
          lineNumber,
          uncertain: rangeMatch[2] === '?',
        });
        continue;
      }

      // Point event: 1718: description
      const pointMatch = line.match(
        /^(\d{4}(?:-\d{2})?(?:-\d{2})?)\s*:\s*(.+)$/
      );
      if (pointMatch) {
        result.timelineEvents.push({
          date: pointMatch[1],
          endDate: null,
          label: pointMatch[2].trim(),
          group: currentTimelineGroup,
          lineNumber,
        });
        continue;
      }
    }

    // Venn overlap line: "A & B: size" or "A & B & C: size \"label\""
    if (result.type === 'venn') {
      const overlapMatch = line.match(
        /^(.+?&.+?)\s*:\s*(\d+(?:\.\d+)?)\s*(?:"([^"]*)")?\s*$/
      );
      if (overlapMatch) {
        const sets = overlapMatch[1]
          .split('&')
          .map((s) => s.trim())
          .filter(Boolean)
          .sort();
        const size = parseFloat(overlapMatch[2]);
        const label = overlapMatch[3] ?? null;
        result.vennOverlaps.push({ sets, size, label, lineNumber });
        continue;
      }

      // Venn set line: "Name: size" or "Name(color): size \"label\""
      const setMatch = line.match(
        /^(.+?)(?:\(([^)]+)\))?\s*:\s*(\d+(?:\.\d+)?)\s*(?:"([^"]*)")?\s*$/
      );
      if (setMatch) {
        const name = setMatch[1].trim();
        const color = setMatch[2]
          ? resolveColor(setMatch[2].trim(), palette)
          : null;
        const size = parseFloat(setMatch[3]);
        const label = setMatch[4] ?? null;
        result.vennSets.push({ name, size, color, label, lineNumber });
        continue;
      }
    }

    // Quadrant-specific parsing
    if (result.type === 'quadrant') {
      // x-axis: Low, High
      const xAxisMatch = line.match(/^x-axis\s*:\s*(.+)/i);
      if (xAxisMatch) {
        const parts = xAxisMatch[1].split(',').map((s) => s.trim());
        if (parts.length >= 2) {
          result.quadrantXAxis = [parts[0], parts[1]];
          result.quadrantXAxisLineNumber = lineNumber;
        }
        continue;
      }

      // y-axis: Low, High
      const yAxisMatch = line.match(/^y-axis\s*:\s*(.+)/i);
      if (yAxisMatch) {
        const parts = yAxisMatch[1].split(',').map((s) => s.trim());
        if (parts.length >= 2) {
          result.quadrantYAxis = [parts[0], parts[1]];
          result.quadrantYAxisLineNumber = lineNumber;
        }
        continue;
      }

      // Quadrant position labels: top-right: Label (color)
      const quadrantLabelRe =
        /^(top-right|top-left|bottom-left|bottom-right)\s*:\s*(.+)/i;
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

      // Data points: Label: x, y
      const pointMatch = line.match(
        /^(.+?):\s*([0-9]*\.?[0-9]+)\s*,\s*([0-9]*\.?[0-9]+)\s*$/
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

    // Check for metadata lines
    const colonIndex = line.indexOf(':');

    if (colonIndex !== -1) {
      const rawKey = line.substring(0, colonIndex).trim();
      const key = rawKey.toLowerCase();

      // Check for color annotation in raw key: "Label(color)"
      const colorMatch = rawKey.match(/^(.+?)\(([^)]+)\)\s*$/);

      if (key === 'chart') {
        const value = line
          .substring(colonIndex + 1)
          .trim()
          .toLowerCase();
        if (
          value === 'slope' ||
          value === 'wordcloud' ||
          value === 'arc' ||
          value === 'timeline' ||
          value === 'venn' ||
          value === 'quadrant' ||
          value === 'sequence'
        ) {
          result.type = value;
        } else {
          result.error = `Unsupported chart type: ${value}. Supported types: slope, wordcloud, arc, timeline, venn, quadrant, sequence`;
          return result;
        }
        continue;
      }

      if (key === 'title') {
        result.title = line.substring(colonIndex + 1).trim();
        if (result.type === 'quadrant') {
          result.quadrantTitleLineNumber = lineNumber;
        }
        continue;
      }

      if (key === 'orientation') {
        const v = line
          .substring(colonIndex + 1)
          .trim()
          .toLowerCase();
        if (v === 'horizontal' || v === 'vertical') {
          result.orientation = v;
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

      if (key === 'sort') {
        const v = line
          .substring(colonIndex + 1)
          .trim()
          .toLowerCase();
        if (v === 'time' || v === 'group') {
          result.timelineSort = v;
        }
        continue;
      }

      if (key === 'swimlanes') {
        const v = line
          .substring(colonIndex + 1)
          .trim()
          .toLowerCase();
        if (v === 'on') {
          result.timelineSwimlanes = true;
        } else if (v === 'off') {
          result.timelineSwimlanes = false;
        }
        continue;
      }

      if (key === 'gridlines') {
        const v = line
          .substring(colonIndex + 1)
          .trim()
          .toLowerCase();
        if (v === 'off' || v === 'false' || v === 'no') {
          result.gridlines = false;
        }
        continue;
      }

      if (key === 'values') {
        const v = line
          .substring(colonIndex + 1)
          .trim()
          .toLowerCase();
        if (v === 'off') {
          result.vennShowValues = false;
        } else if (v === 'on') {
          result.vennShowValues = true;
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
        // For wordcloud, single numeric value = word weight
        if (result.type === 'wordcloud' && numericValues.length === 1) {
          result.words.push({
            text: labelPart,
            weight: numericValues[0],
            lineNumber,
          });
        } else {
          result.data.push({
            label: labelPart,
            values: numericValues,
            color: colorPart,
            lineNumber,
          });
        }
        continue;
      }
    }

    // For wordcloud: collect non-metadata lines for freeform fallback
    if (result.type === 'wordcloud') {
      if (colonIndex === -1 && !line.includes(' ')) {
        // Single bare word — structured mode
        result.words.push({ text: line, weight: 10, lineNumber });
      } else {
        // Multi-word line or non-numeric colon line — freeform text
        freeformLines.push(line);
      }
      continue;
    }

    // Period line: comma-separated labels with no colon before first comma
    // e.g., "2020, 2024" or "Q1 2023, Q2 2023, Q3 2023"
    if (
      result.periods.length === 0 &&
      line.includes(',') &&
      !line.includes(':')
    ) {
      const periods = line
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (periods.length >= 2) {
        result.periods = periods;
        continue;
      }
    }
  }

  // Validation
  if (!result.type) {
    result.error = 'Missing required "chart:" line (e.g., "chart: slope")';
    return result;
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
      result.error =
        'No words found. Add words as "word: weight", one per line, or paste freeform text';
      return result;
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
      result.error =
        'No links found. Add links as "Source -> Target: weight" (e.g., "Alice -> Bob: 5")';
      return result;
    }
    // Validate arc ordering vs groups
    if (result.arcNodeGroups.length > 0) {
      if (result.arcOrder === 'name' || result.arcOrder === 'degree') {
        result.error = `Cannot use "order: ${result.arcOrder}" with ## section headers. Use "order: group" or remove section headers.`;
        return result;
      }
      if (result.arcOrder === 'appearance') {
        result.arcOrder = 'group';
      }
    }
    return result;
  }

  if (result.type === 'timeline') {
    if (result.timelineEvents.length === 0) {
      result.error =
        'No events found. Add events as "YYYY: description" or "YYYY->YYYY: description"';
      return result;
    }
    return result;
  }

  if (result.type === 'venn') {
    if (result.vennSets.length < 2) {
      result.error =
        'At least 2 sets are required. Add sets as "Name: size" (e.g., "Math: 100")';
      return result;
    }
    if (result.vennSets.length > 3) {
      result.error = 'At most 3 sets are supported. Remove extra sets.';
      return result;
    }
    // Validate overlap references and sizes
    const setMap = new Map(result.vennSets.map((s) => [s.name, s.size]));
    for (const ov of result.vennOverlaps) {
      for (const setName of ov.sets) {
        if (!setMap.has(setName)) {
          result.error = `Overlap references unknown set "${setName}". Define it first as "${setName}: <size>"`;
          return result;
        }
      }
      const minSetSize = Math.min(...ov.sets.map((s) => setMap.get(s)!));
      if (ov.size > minSetSize) {
        result.error = `Overlap size ${ov.size} exceeds smallest constituent set size ${minSetSize}`;
        return result;
      }
    }
    return result;
  }

  if (result.type === 'quadrant') {
    if (result.quadrantPoints.length === 0) {
      result.error =
        'No data points found. Add points as "Label: x, y" (e.g., "Item A: 0.5, 0.7")';
      return result;
    }
    return result;
  }

  // Slope chart validation
  if (result.periods.length < 2) {
    result.error =
      'Missing or invalid periods line. Provide at least 2 comma-separated period labels (e.g., "2020, 2024")';
    return result;
  }

  if (result.data.length === 0) {
    result.error =
      'No data lines found. Add data as "Label: value1, value2" (e.g., "Apple: 25, 35")';
    return result;
  }

  // Validate value counts match period count
  for (const item of result.data) {
    if (item.values.length !== result.periods.length) {
      result.error = `Data item "${item.label}" has ${item.values.length} value(s) but ${result.periods.length} period(s) are defined`;
      return result;
    }
  }

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

const SLOPE_MARGIN = { top: 80, bottom: 40, left: 80 };
const SLOPE_LABEL_FONT_SIZE = 12;
const SLOPE_CHAR_WIDTH = 7; // approximate px per character at 12px

/**
 * Renders a slope chart into the given container using D3.
 */
export function renderSlopeChart(
  container: HTMLDivElement,
  parsed: ParsedD3,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  // Clear existing content
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const { periods, data, title } = parsed;
  if (data.length === 0 || periods.length < 2) return;

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  // Compute right margin from the longest end-of-line label
  const maxLabelText = data.reduce((longest, item) => {
    const text = `${item.values[item.values.length - 1]} — ${item.label}`;
    return text.length > longest.length ? text : longest;
  }, '');
  const estimatedLabelWidth = maxLabelText.length * SLOPE_CHAR_WIDTH;
  const maxRightMargin = Math.floor(width * 0.35);
  const rightMargin = Math.min(
    Math.max(estimatedLabelWidth + 20, 100),
    maxRightMargin
  );

  const innerWidth = width - SLOPE_MARGIN.left - rightMargin;
  const innerHeight = height - SLOPE_MARGIN.top - SLOPE_MARGIN.bottom;

  // Theme colors
  const textColor = palette.text;
  const mutedColor = palette.border;
  const bgColor = palette.overlay;
  const colors = getSeriesColors(palette);

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

  // SVG
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', bgColor);

  const g = svg
    .append('g')
    .attr('transform', `translate(${SLOPE_MARGIN.left},${SLOPE_MARGIN.top})`);

  // Tooltip
  const tooltip = createTooltip(container, palette, isDark);

  // Title
  if (title) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '18px')
      .attr('font-weight', '700')
      .text(title);
  }

  // Period column headers
  for (const period of periods) {
    const x = xScale(period)!;
    g.append('text')
      .attr('x', x)
      .attr('y', -15)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '13px')
      .attr('font-weight', '600')
      .text(period);

    if (parsed.gridlines !== false) {
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
  }

  if (parsed.gridlines !== false) {
    // Horizontal reference lines at Y-axis ticks
    const yTicks = yScale.ticks(5);
    for (const tick of yTicks) {
      g.append('text')
        .attr('x', -8)
        .attr('y', yScale(tick))
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('fill', mutedColor)
        .attr('font-size', '11px')
        .text(tick);

      g.append('line')
        .attr('x1', 0)
        .attr('y1', yScale(tick))
        .attr('x2', innerWidth)
        .attr('y2', yScale(tick))
        .attr('stroke', mutedColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4');
    }
  }

  // Line generator
  const lineGen = d3Shape
    .line<number>()
    .x((_d, i) => xScale(periods[i])!)
    .y((d) => yScale(d));

  // Render each data series
  data.forEach((item, idx) => {
    const color = item.color ?? colors[idx % colors.length];

    // Tooltip content – overall change for this series
    const firstVal = item.values[0];
    const lastVal = item.values[item.values.length - 1];
    const absChange = lastVal - firstVal;
    const pctChange = firstVal !== 0 ? (absChange / firstVal) * 100 : null;
    const sign = absChange > 0 ? '+' : '';
    const pctPart =
      pctChange !== null ? ` (${sign}${pctChange.toFixed(1)}%)` : '';
    const tipHtml =
      `<strong>${item.label}</strong><br>` +
      `${periods[0]}: ${firstVal} → ${periods[periods.length - 1]}: ${lastVal}<br>` +
      `Change: ${sign}${absChange}${pctPart}`;

    // Line
    g.append('path')
      .datum(item.values)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2.5)
      .attr('d', lineGen);

    // Invisible wider path for easier hover targeting
    g.append('path')
      .datum(item.values)
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 14)
      .attr('d', lineGen)
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .on('mouseenter', (event: MouseEvent) =>
        showTooltip(tooltip, tipHtml, event)
      )
      .on('mousemove', (event: MouseEvent) =>
        showTooltip(tooltip, tipHtml, event)
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
      g.append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', 4)
        .attr('fill', color)
        .attr('stroke', bgColor)
        .attr('stroke-width', 1.5)
        .style('cursor', onClickItem ? 'pointer' : 'default')
        .on('mouseenter', (event: MouseEvent) =>
          showTooltip(tooltip, tipHtml, event)
        )
        .on('mousemove', (event: MouseEvent) =>
          showTooltip(tooltip, tipHtml, event)
        )
        .on('mouseleave', () => hideTooltip(tooltip))
        .on('click', () => {
          if (onClickItem && item.lineNumber) onClickItem(item.lineNumber);
        });

      // Value label — skip last point (shown in series label instead)
      const isFirst = i === 0;
      const isLast = i === periods.length - 1;
      if (!isLast) {
        g.append('text')
          .attr('x', isFirst ? x - 10 : x)
          .attr('y', y)
          .attr('dy', '0.35em')
          .attr('text-anchor', isFirst ? 'end' : 'middle')
          .attr('fill', textColor)
          .attr('font-size', '12px')
          .text(val.toString());
      }
    });

    // Series label with value at end of line — wraps if it exceeds available space
    const lastX = xScale(periods[periods.length - 1])!;
    const lastY = yScale(lastVal);
    const labelText = `${lastVal} — ${item.label}`;
    const availableWidth = rightMargin - 15;
    const maxChars = Math.floor(availableWidth / SLOPE_CHAR_WIDTH);

    const labelEl = g
      .append('text')
      .attr('x', lastX + 10)
      .attr('y', lastY)
      .attr('text-anchor', 'start')
      .attr('fill', color)
      .attr('font-size', `${SLOPE_LABEL_FONT_SIZE}px`)
      .attr('font-weight', '500');

    if (labelText.length <= maxChars) {
      labelEl.attr('dy', '0.35em').text(labelText);
    } else {
      // Wrap into lines that fit the available width
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

      const lineHeight = SLOPE_LABEL_FONT_SIZE * 1.2;
      const totalHeight = (lines.length - 1) * lineHeight;
      const startDy = -totalHeight / 2;

      lines.forEach((line, li) => {
        labelEl
          .append('tspan')
          .attr('x', lastX + 10)
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
  parsed: ParsedD3,
  palette: PaletteColors,
  _isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const { links, title, orientation, arcOrder, arcNodeGroups } = parsed;
  if (links.length === 0) return;

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

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

  // Theme colors
  const textColor = palette.text;
  const mutedColor = palette.border;
  const bgColor = palette.overlay;
  const colors = getSeriesColors(palette);

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

  // SVG
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', bgColor);

  const g = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Title
  if (title) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '18px')
      .attr('font-weight', '700')
      .text(title);
  }

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
      0.08
    );
    g.selectAll<SVGTextElement, unknown>('.arc-group-label').attr(
      'fill-opacity',
      0.7
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
        const bandColor = group.color ?? mutedColor;

        g.append('rect')
          .attr('class', 'arc-group-band')
          .attr('data-group', group.name)
          .attr('x', baseX - bandHalfW)
          .attr('y', minY)
          .attr('width', bandHalfW * 2)
          .attr('height', maxY - minY)
          .attr('rx', 4)
          .attr('fill', bandColor)
          .attr('fill-opacity', 0.08)
          .style('cursor', 'pointer')
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });

        g.append('text')
          .attr('class', 'arc-group-label')
          .attr('data-group', group.name)
          .attr('x', baseX - bandHalfW + 6)
          .attr('y', minY + 12)
          .attr('fill', bandColor)
          .attr('font-size', '10px')
          .attr('font-weight', '600')
          .attr('fill-opacity', 0.7)
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
      // Find the first link involving this node
      const nodeLink = onClickItem
        ? links.find((l) => l.source === node || l.target === node)
        : undefined;

      const nodeG = g
        .append('g')
        .attr('class', 'arc-node')
        .attr('data-node', node)
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
        const bandColor = group.color ?? mutedColor;

        g.append('rect')
          .attr('class', 'arc-group-band')
          .attr('data-group', group.name)
          .attr('x', minX)
          .attr('y', baseY - bandHalfH)
          .attr('width', maxX - minX)
          .attr('height', bandHalfH * 2)
          .attr('rx', 4)
          .attr('fill', bandColor)
          .attr('fill-opacity', 0.08)
          .style('cursor', 'pointer')
          .on('mouseenter', () => handleGroupEnter(group.name))
          .on('mouseleave', handleMouseLeave)
          .on('click', () => {
            if (onClickItem) onClickItem(group.lineNumber);
          });

        g.append('text')
          .attr('class', 'arc-group-label')
          .attr('data-group', group.name)
          .attr('x', (minX + maxX) / 2)
          .attr('y', baseY + bandHalfH - 4)
          .attr('text-anchor', 'middle')
          .attr('fill', bandColor)
          .attr('font-size', '10px')
          .attr('font-weight', '600')
          .attr('fill-opacity', 0.7)
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
      // Find the first link involving this node
      const nodeLink = onClickItem
        ? links.find((l) => l.source === node || l.target === node)
        : undefined;

      const nodeG = g
        .append('g')
        .attr('class', 'arc-node')
        .attr('data-node', node)
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
 * Converts a DSL date string (YYYY, YYYY-MM, YYYY-MM-DD) to a human-readable label.
 *   '1718'       → '1718'
 *   '1718-05'    → 'May 1718'
 *   '1718-05-22' → 'May 22, 1718'
 */
export function formatDateLabel(dateStr: string): string {
  const parts = dateStr.split('-');
  const year = parts[0];
  if (parts.length === 1) return year;
  const month = MONTH_ABBR[parseInt(parts[1], 10) - 1];
  if (parts.length === 2) return `${month} ${year}`;
  const day = parseInt(parts[2], 10);
  return `${month} ${day}, ${year}`;
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
    for (let y = firstYear; y <= lastYear; y++) {
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
  parsed: ParsedD3,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
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

  const tooltip = createTooltip(container, palette, isDark);

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const isVertical = orientation === 'vertical';

  // Theme colors
  const textColor = palette.text;
  const mutedColor = palette.border;
  const bgColor = palette.overlay;
  const colors = getSeriesColors(palette);

  // Assign colors to groups
  const groupColorMap = new Map<string, string>();
  timelineGroups.forEach((grp, i) => {
    groupColorMap.set(grp.name, grp.color ?? colors[i % colors.length]);
  });

  function eventColor(ev: TimelineEvent): string {
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
      '.tl-event, .tl-legend-item, .tl-lane-header, .tl-marker'
    ).attr('opacity', 1);
    g.selectAll<SVGGElement, unknown>('.tl-era').attr('opacity', 1);
  }

  // ================================================================
  // VERTICAL orientation (time flows top→bottom)
  // ================================================================
  if (isVertical) {
    if (timelineSort === 'group' && timelineGroups.length > 0) {
      // === GROUPED: one column/lane per group, vertical ===
      const groupNames = timelineGroups.map((gr) => gr.name);
      const ungroupedEvents = timelineEvents.filter(
        (ev) => ev.group === null || !groupNames.includes(ev.group)
      );
      const laneNames =
        ungroupedEvents.length > 0 ? [...groupNames, '(Other)'] : groupNames;

      const laneCount = laneNames.length;
      const scaleMargin = timelineScale ? 40 : 0;
      const markerMargin = timelineMarkers.length > 0 ? 30 : 0;
      const margin = {
        top: 104 + markerMargin,
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
        .attr('width', width)
        .attr('height', height)
        .style('background', bgColor);

      const g = svg
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      if (title) {
        svg
          .append('text')
          .attr('x', width / 2)
          .attr('y', 30)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-size', '18px')
          .attr('font-weight', '700')
          .text(title);
      }

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
          formatDateLabel(earliestStartDateStr),
          formatDateLabel(latestEndDateStr)
        );
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

        const laneEvents = timelineEvents.filter((ev) =>
          laneName === '(Other)'
            ? ev.group === null || !groupNames.includes(ev.group)
            : ev.group === laneName
        );

        for (const ev of laneEvents) {
          const y = yScale(parseTimelineDate(ev.date));
          const evG = g
            .append('g')
            .attr('class', 'tl-event')
            .attr('data-group', laneName)
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

          if (ev.endDate) {
            const y2 = yScale(parseTimelineDate(ev.endDate));
            const rectH = Math.max(y2 - y, 4);
            evG
              .append('rect')
              .attr('x', laneCenter - 6)
              .attr('y', y)
              .attr('width', 12)
              .attr('height', rectH)
              .attr('rx', 4)
              .attr('fill', laneColor);
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
              .attr('fill', laneColor)
              .attr('stroke', bgColor)
              .attr('stroke-width', 1.5);
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
        top: 104 + markerMargin,
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
        .attr('width', width)
        .attr('height', height)
        .style('background', bgColor);

      const g = svg
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      if (title) {
        svg
          .append('text')
          .attr('x', width / 2)
          .attr('y', 30)
          .attr('text-anchor', 'middle')
          .attr('fill', textColor)
          .attr('font-size', '18px')
          .attr('font-weight', '700')
          .text(title);
      }

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
          formatDateLabel(earliestStartDateStr),
          formatDateLabel(latestEndDateStr)
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

        if (ev.endDate) {
          const y2 = yScale(parseTimelineDate(ev.endDate));
          const rectH = Math.max(y2 - y, 4);
          evG
            .append('rect')
            .attr('x', axisX - 6)
            .attr('y', y)
            .attr('width', 12)
            .attr('height', rectH)
            .attr('rx', 4)
            .attr('fill', color);
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
            .attr('fill', color)
            .attr('stroke', bgColor)
            .attr('stroke-width', 1.5);
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

  if (timelineSort === 'group' && timelineGroups.length > 0) {
    // === GROUPED: swim-lanes stacked vertically, events on own rows ===
    const groupNames = timelineGroups.map((gr) => gr.name);
    const ungroupedEvents = timelineEvents.filter(
      (ev) => ev.group === null || !groupNames.includes(ev.group)
    );
    const laneNames =
      ungroupedEvents.length > 0 ? [...groupNames, '(Other)'] : groupNames;

    // Build lane data
    const lanes = laneNames.map((name) => ({
      name,
      events: timelineEvents.filter((ev) =>
        name === '(Other)'
          ? ev.group === null || !groupNames.includes(ev.group)
          : ev.group === name
      ),
    }));

    const totalEventRows = lanes.reduce((s, l) => s + l.events.length, 0);
    const scaleMargin = timelineScale ? 24 : 0;
    const markerMargin = timelineMarkers.length > 0 ? 30 : 0;
    // Calculate left margin based on longest group name (~7px per char + padding)
    const maxGroupNameLen = Math.max(...lanes.map((l) => l.name.length));
    const dynamicLeftMargin = Math.max(120, maxGroupNameLen * 7 + 30);
    // Group-sorted doesn't need legend space (group names shown on left)
    const baseTopMargin = title ? 50 : 20;
    const margin = {
      top: baseTopMargin + (timelineScale ? 40 : 0) + markerMargin,
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

    if (title) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', 30)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', '18px')
        .attr('font-weight', '700')
        .text(title);
    }

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
        formatDateLabel(earliestStartDateStr),
        formatDateLabel(latestEndDateStr)
      );
    }

    // Offset events below marker area when markers are present
    let curY = markerMargin;

    // Render swimlane backgrounds first (so they appear behind events)
    // Extend into left margin to include group names
    if (timelineSwimlanes) {
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

        if (ev.endDate) {
          const x2 = xScale(parseTimelineDate(ev.endDate));
          const rectW = Math.max(x2 - x, 4);
          // Estimate label width (~7px per char at 13px font) + padding
          const estLabelWidth = ev.label.length * 7 + 16;
          const labelFitsInside = rectW >= estLabelWidth;

          let fill: string = laneColor;
          if (ev.uncertain) {
            // Create gradient for uncertain end - fades last 20%
            const gradientId = `uncertain-${ev.lineNumber}`;
            const defs = svg.select('defs').node() || svg.append('defs').node();
            d3Selection
              .select(defs as Element)
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
              .attr('stop-color', laneColor)
              .attr('stop-opacity', (d) => d.opacity);
            fill = `url(#${gradientId})`;
          }

          evG
            .append('rect')
            .attr('x', x)
            .attr('y', y - BAR_H / 2)
            .attr('width', rectW)
            .attr('height', BAR_H)
            .attr('rx', 4)
            .attr('fill', fill);

          if (labelFitsInside) {
            // Text inside bar - always white for readability
            evG
              .append('text')
              .attr('x', x + 8)
              .attr('y', y)
              .attr('dy', '0.35em')
              .attr('text-anchor', 'start')
              .attr('fill', '#ffffff')
              .attr('font-size', '13px')
              .attr('font-weight', '500')
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
            .attr('fill', laneColor)
            .attr('stroke', bgColor)
            .attr('stroke-width', 1.5);
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
      top: 104 + (timelineScale ? 40 : 0) + markerMargin,
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

    if (title) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', 30)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', '18px')
        .attr('font-weight', '700')
        .text(title);
    }

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
        formatDateLabel(earliestStartDateStr),
        formatDateLabel(latestEndDateStr)
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

      if (ev.endDate) {
        const x2 = xScale(parseTimelineDate(ev.endDate));
        const rectW = Math.max(x2 - x, 4);
        // Estimate label width (~7px per char at 13px font) + padding
        const estLabelWidth = ev.label.length * 7 + 16;
        const labelFitsInside = rectW >= estLabelWidth;

        let fill: string = color;
        if (ev.uncertain) {
          // Create gradient for uncertain end - fades last 20%
          const gradientId = `uncertain-ts-${ev.lineNumber}`;
          const defs = svg.select('defs').node() || svg.append('defs').node();
          d3Selection
            .select(defs as Element)
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
            .attr('stop-color', color)
            .attr('stop-opacity', (d) => d.opacity);
          fill = `url(#${gradientId})`;
        }

        evG
          .append('rect')
          .attr('x', x)
          .attr('y', y - BAR_H / 2)
          .attr('width', rectW)
          .attr('height', BAR_H)
          .attr('rx', 4)
          .attr('fill', fill);

        if (labelFitsInside) {
          // Text inside bar - always white for readability
          evG
            .append('text')
            .attr('x', x + 8)
            .attr('y', y)
            .attr('dy', '0.35em')
            .attr('text-anchor', 'start')
            .attr('fill', '#ffffff')
            .attr('font-size', '13px')
            .attr('font-weight', '500')
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
          .attr('fill', color)
          .attr('stroke', bgColor)
          .attr('stroke-width', 1.5);
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
  parsed: ParsedD3,
  palette: PaletteColors,
  _isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const { words, title, cloudOptions } = parsed;
  if (words.length === 0) return;

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const titleHeight = title ? 40 : 0;
  const cloudHeight = height - titleHeight;

  const textColor = palette.text;
  const bgColor = palette.overlay;
  const colors = getSeriesColors(palette);

  const { minSize, maxSize } = cloudOptions;
  const weights = words.map((w) => w.weight);
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const range = maxWeight - minWeight || 1;

  const fontSize = (weight: number): number => {
    const t = (weight - minWeight) / range;
    return minSize + t * (maxSize - minSize);
  };

  const rotateFn = getRotateFn(cloudOptions.rotate);

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', bgColor);

  if (title) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', 28)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '18px')
      .attr('font-weight', '700')
      .text(title);
  }

  const g = svg
    .append('g')
    .attr(
      'transform',
      `translate(${width / 2},${titleHeight + cloudHeight / 2})`
    );

  cloud<WordCloudWord & cloud.Word>()
    .size([width, cloudHeight])
    .words(words.map((w) => ({ ...w, size: fontSize(w.weight) })))
    .padding(4)
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
  parsed: ParsedD3,
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
    const bgColor = palette.overlay;
    const colors = getSeriesColors(palette);

    const { minSize, maxSize } = cloudOptions;
    const weights = words.map((w) => w.weight);
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const range = maxWeight - minWeight || 1;

    const fontSize = (weight: number): number => {
      const t = (weight - minWeight) / range;
      return minSize + t * (maxSize - minSize);
    };

    const rotateFn = getRotateFn(cloudOptions.rotate);

    const svg = d3Selection
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('background', bgColor);

    if (title) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', 28)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', '18px')
        .attr('font-weight', '700')
        .text(title);
    }

    const g = svg
      .append('g')
      .attr(
        'transform',
        `translate(${width / 2},${titleHeight + cloudHeight / 2})`
      );

    cloud<WordCloudWord & cloud.Word>()
      .size([width, cloudHeight])
      .words(words.map((w) => ({ ...w, size: fontSize(w.weight) })))
      .padding(4)
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

function radiusFromArea(area: number): number {
  return Math.sqrt(area / Math.PI);
}

function circleOverlapArea(r1: number, r2: number, d: number): number {
  // No overlap
  if (d >= r1 + r2) return 0;
  // Full containment
  if (d + Math.min(r1, r2) <= Math.max(r1, r2)) {
    return Math.PI * Math.min(r1, r2) ** 2;
  }
  const part1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const part2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const part3 =
    0.5 *
    Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return part1 + part2 - part3;
}

function distanceForOverlap(
  r1: number,
  r2: number,
  targetArea: number
): number {
  if (targetArea <= 0) return r1 + r2;
  const minR = Math.min(r1, r2);
  if (targetArea >= Math.PI * minR * minR) return Math.abs(r1 - r2);
  let lo = Math.abs(r1 - r2);
  let hi = r1 + r2;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (circleOverlapArea(r1, r2, mid) > targetArea) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

interface Point {
  x: number;
  y: number;
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

function thirdCirclePosition(
  ax: number,
  ay: number,
  dAC: number,
  bx: number,
  by: number,
  dBC: number
): Point {
  const dx = bx - ax;
  const dy = by - ay;
  const dAB = Math.sqrt(dx * dx + dy * dy);
  if (dAB === 0) return { x: ax + dAC, y: ay };
  const cosA = (dAB * dAB + dAC * dAC - dBC * dBC) / (2 * dAB * dAC);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const ux = dx / dAB;
  const uy = dy / dAB;
  // Place C above the AB line
  return {
    x: ax + dAC * (cosA * ux - sinA * uy),
    y: ay + dAC * (cosA * uy + sinA * ux),
  };
}

function fitCirclesToContainer(
  circles: Circle[],
  w: number,
  h: number,
  margin: number
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
  const availW = w - 2 * margin;
  const availH = h - 2 * margin;
  const scale = Math.min(availW / bw, availH / bh) * 0.85;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const tx = w / 2;
  const ty = h / 2;
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
  // Sample points and average those matching the region
  const N = 500;
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
  let sx = 0,
    sy = 0,
    count = 0;
  for (let i = 0; i < N; i++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
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

function blendColors(hexColors: string[]): string {
  let r = 0,
    g = 0,
    b = 0;
  for (const hex of hexColors) {
    const h = hex.replace('#', '');
    r += parseInt(h.substring(0, 2), 16);
    g += parseInt(h.substring(2, 4), 16);
    b += parseInt(h.substring(4, 6), 16);
  }
  const n = hexColors.length;
  return `#${Math.round(r / n)
    .toString(16)
    .padStart(2, '0')}${Math.round(g / n)
    .toString(16)
    .padStart(2, '0')}${Math.round(b / n)
    .toString(16)
    .padStart(2, '0')}`;
}

function circlePathD(cx: number, cy: number, r: number): string {
  return `M${cx - r},${cy} A${r},${r} 0 1,0 ${cx + r},${cy} A${r},${r} 0 1,0 ${cx - r},${cy} Z`;
}

export function renderVenn(
  container: HTMLDivElement,
  parsed: ParsedD3,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const { vennSets, vennOverlaps, vennShowValues, title } = parsed;
  if (vennSets.length < 2) return;

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const textColor = palette.text;
  const bgColor = palette.overlay;
  const colors = getSeriesColors(palette);
  const titleHeight = title ? 40 : 0;

  // Compute radii
  const radii = vennSets.map((s) => radiusFromArea(s.size));

  // Build overlap map keyed by sorted set names
  const overlapMap = new Map<string, number>();
  for (const ov of vennOverlaps) {
    overlapMap.set(ov.sets.join('&'), ov.size);
  }

  // Layout circles
  let rawCircles: Circle[];
  const n = vennSets.length;

  if (n === 2) {
    const d = distanceForOverlap(
      radii[0],
      radii[1],
      overlapMap.get([vennSets[0].name, vennSets[1].name].sort().join('&')) ?? 0
    );
    rawCircles = [
      { x: -d / 2, y: 0, r: radii[0] },
      { x: d / 2, y: 0, r: radii[1] },
    ];
  } else {
    // 3 sets: place A and B, then compute C position
    const names = vennSets.map((s) => s.name);
    const pairKey = (i: number, j: number) =>
      [names[i], names[j]].sort().join('&');

    const dAB = distanceForOverlap(
      radii[0],
      radii[1],
      overlapMap.get(pairKey(0, 1)) ?? 0
    );
    const dAC = distanceForOverlap(
      radii[0],
      radii[2],
      overlapMap.get(pairKey(0, 2)) ?? 0
    );
    const dBC = distanceForOverlap(
      radii[1],
      radii[2],
      overlapMap.get(pairKey(1, 2)) ?? 0
    );

    const ax = -dAB / 2;
    const bx = dAB / 2;
    const cPos = thirdCirclePosition(ax, 0, dAC, bx, 0, dBC);

    rawCircles = [
      { x: ax, y: 0, r: radii[0] },
      { x: bx, y: 0, r: radii[1] },
      { x: cPos.x, y: cPos.y, r: radii[2] },
    ];
  }

  const drawH = height - titleHeight;
  const labelMargin = 100; // extra margin for external labels
  const circles = fitCirclesToContainer(
    rawCircles,
    width,
    drawH,
    labelMargin
  ).map((c) => ({ ...c, y: c.y + titleHeight }));

  // Resolve colors for each set
  const setColors = vennSets.map(
    (s, i) => s.color ?? colors[i % colors.length]
  );

  // SVG
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', bgColor);

  // Tooltip
  const tooltip = createTooltip(container, palette, isDark);

  // Title
  if (title) {
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', 28)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '18px')
      .attr('font-weight', '700')
      .text(title);
  }

  // ── Clip-path definitions ──
  // For each circle: a clip-path to include it, and one to exclude it (hole)
  const defs = svg.append('defs');
  const pad = 20;
  circles.forEach((c, i) => {
    // Include clip: just the circle
    defs
      .append('clipPath')
      .attr('id', `venn-in-${i}`)
      .append('circle')
      .attr('cx', c.x)
      .attr('cy', c.y)
      .attr('r', c.r);

    // Exclude clip: large rect with circle punched out via evenodd
    defs
      .append('clipPath')
      .attr('id', `venn-out-${i}`)
      .append('path')
      .attr(
        'd',
        `M${-pad},${-pad} H${width + pad} V${height + pad} H${-pad} Z ` +
          circlePathD(c.x, c.y, c.r)
      )
      .attr('clip-rule', 'evenodd');
  });

  // Helper: nest clip-path groups and append a filled rect
  function drawClippedRegion(
    parent: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
    clipIds: string[],
    fill: string
  ): d3Selection.Selection<SVGGElement, unknown, null, undefined> {
    let g = parent;
    for (const id of clipIds) {
      g = g
        .append('g')
        .attr('clip-path', `url(#${id})`) as d3Selection.Selection<
        SVGGElement,
        unknown,
        null,
        undefined
      >;
    }
    g.append('rect')
      .attr('x', -pad)
      .attr('y', -pad)
      .attr('width', width + 2 * pad)
      .attr('height', height + 2 * pad)
      .attr('fill', fill);
    return g;
  }

  // ── Draw opaque regions ──
  // Track region groups by which circle indices they relate to (for hover dimming)
  const regionGroups: {
    g: d3Selection.Selection<SVGGElement, unknown, null, undefined>;
    circleIdxs: number[];
  }[] = [];

  // Exclusive regions: inside circle i, outside all others
  const regionsParent = svg.append('g');
  for (let i = 0; i < n; i++) {
    const clips = [`venn-in-${i}`];
    for (let j = 0; j < n; j++) {
      if (j !== i) clips.push(`venn-out-${j}`);
    }
    const g = regionsParent.append('g') as d3Selection.Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >;
    drawClippedRegion(g, clips, setColors[i]);
    regionGroups.push({ g, circleIdxs: [i] });
  }

  // Pairwise overlap regions (excluding any third circle)
  const pairIndices: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairIndices.push([i, j]);
    }
  }
  for (const [i, j] of pairIndices) {
    const clips = [`venn-in-${i}`, `venn-in-${j}`];
    for (let k = 0; k < n; k++) {
      if (k !== i && k !== j) clips.push(`venn-out-${k}`);
    }
    const blended = blendColors([setColors[i], setColors[j]]);
    const g = regionsParent.append('g') as d3Selection.Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >;
    drawClippedRegion(g, clips, blended);
    regionGroups.push({ g, circleIdxs: [i, j] });
  }

  // Triple overlap region (if 3 sets)
  if (n === 3) {
    const clips = [`venn-in-0`, `venn-in-1`, `venn-in-2`];
    const blended = blendColors([setColors[0], setColors[1], setColors[2]]);
    const g = regionsParent.append('g') as d3Selection.Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    >;
    drawClippedRegion(g, clips, blended);
    regionGroups.push({ g, circleIdxs: [0, 1, 2] });
  }

  // ── Circle outlines ──
  const outlineGroup = svg.append('g');
  circles.forEach((c, i) => {
    outlineGroup
      .append('circle')
      .attr('cx', c.x)
      .attr('cy', c.y)
      .attr('r', c.r)
      .attr('fill', 'none')
      .attr('stroke', setColors[i])
      .attr('stroke-width', 2)
      .style('pointer-events', 'none');
  });

  // ── External labels with leader lines (pie-chart style) ──
  interface LabelEntry {
    centroid: Point;
    text: string;
    involvedIdxs: number[]; // which circle indices this label belongs to
  }
  const labelEntries: LabelEntry[] = [];

  // Global center of all circles (for projecting outward)
  const gcx = circles.reduce((s, c) => s + c.x, 0) / n;
  const gcy = circles.reduce((s, c) => s + c.y, 0) / n;

  // Set name labels (exclusive regions)
  circles.forEach((_c, i) => {
    const inside = circles.map((_, j) => j === i);
    const centroid = regionCentroid(circles, inside);
    const displayName = vennSets[i].label ?? vennSets[i].name;
    const text = vennShowValues
      ? `${displayName} (${vennSets[i].size})`
      : displayName;
    labelEntries.push({ centroid, text, involvedIdxs: [i] });
  });

  // Overlap labels
  for (const ov of vennOverlaps) {
    const idxs = ov.sets.map((s) => vennSets.findIndex((vs) => vs.name === s));
    if (idxs.some((i) => i < 0)) continue;
    if (!ov.label && !vennShowValues) continue;

    const inside = circles.map((_, j) => idxs.includes(j));
    const centroid = regionCentroid(circles, inside);
    let text = '';
    if (ov.label && vennShowValues) text = `${ov.label} (${ov.size})`;
    else if (ov.label) text = ov.label;
    else text = String(ov.size);
    labelEntries.push({ centroid, text, involvedIdxs: idxs });
  }

  // Helper: ray-circle exit distance (positive = forward along direction)
  function rayCircleExit(
    ox: number,
    oy: number,
    dx: number,
    dy: number,
    c: Circle
  ): number {
    const lx = ox - c.x;
    const ly = oy - c.y;
    const b = lx * dx + ly * dy;
    const det = b * b - (lx * lx + ly * ly - c.r * c.r);
    if (det < 0) return 0;
    return -b + Math.sqrt(det);
  }

  const stubLen = 20;
  const edgePad = 8; // clearance from circle edge
  const labelGroup = svg.append('g').style('pointer-events', 'none');

  for (const entry of labelEntries) {
    const { centroid, text } = entry;

    // Direction from global center to centroid
    let dx = centroid.x - gcx;
    let dy = centroid.y - gcy;
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag < 1e-6) {
      dx = 1;
      dy = 0;
    } else {
      dx /= mag;
      dy /= mag;
    }

    // Exit at the farthest circle edge so the label lands in white space
    let exitT = 0;
    for (const c of circles) {
      const t = rayCircleExit(centroid.x, centroid.y, dx, dy, c);
      if (t > exitT) exitT = t;
    }

    // Edge point: outside the exit boundary with padding
    const edgeX = centroid.x + dx * (exitT + edgePad);
    const edgeY = centroid.y + dy * (exitT + edgePad);

    // Stub end point
    const stubX = edgeX + dx * stubLen;
    const stubY = edgeY + dy * stubLen;

    // For overlap regions (2+ sets), draw leader from centroid into the region
    // For exclusive regions (single set), just draw from edge outward
    const isOverlap = entry.involvedIdxs.length > 1;
    const lineStartX = isOverlap ? centroid.x : edgeX;
    const lineStartY = isOverlap ? centroid.y : edgeY;

    labelGroup
      .append('line')
      .attr('x1', lineStartX)
      .attr('y1', lineStartY)
      .attr('x2', stubX)
      .attr('y2', stubY)
      .attr('stroke', textColor)
      .attr('stroke-width', 1);

    // Text positioned right after the stub
    const isRight = stubX >= gcx;
    const textAnchor = isRight ? 'start' : 'end';
    const textX = stubX + (isRight ? 4 : -4);

    labelGroup
      .append('text')
      .attr('x', textX)
      .attr('y', stubY)
      .attr('text-anchor', textAnchor)
      .attr('dominant-baseline', 'central')
      .attr('fill', textColor)
      .attr('font-size', '14px')
      .attr('font-weight', 'bold')
      .text(text);
  }

  // ── Invisible hover targets (full circles) + interactions ──
  const hoverGroup = svg.append('g');
  circles.forEach((c, i) => {
    const tipName = vennSets[i].label
      ? `${vennSets[i].label} (${vennSets[i].name})`
      : vennSets[i].name;
    const tipHtml = `<strong>${tipName}</strong><br>Size: ${vennSets[i].size}`;

    hoverGroup
      .append('circle')
      .attr('cx', c.x)
      .attr('cy', c.y)
      .attr('r', c.r)
      .attr('fill', 'transparent')
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .on('mouseenter', (event: MouseEvent) => {
        for (const rg of regionGroups) {
          rg.g.style('opacity', rg.circleIdxs.includes(i) ? '1' : '0.25');
        }
        showTooltip(tooltip, tipHtml, event);
      })
      .on('mousemove', (event: MouseEvent) => {
        showTooltip(tooltip, tipHtml, event);
      })
      .on('mouseleave', () => {
        for (const rg of regionGroups) {
          rg.g.style('opacity', '1');
        }
        hideTooltip(tooltip);
      })
      .on('click', () => {
        if (onClickItem && vennSets[i].lineNumber)
          onClickItem(vennSets[i].lineNumber);
      });
  });
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
  parsed: ParsedD3,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

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

  const width = exportDims?.width ?? container.clientWidth;
  const height = exportDims?.height ?? container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const textColor = palette.text;
  const mutedColor = palette.textMuted;
  const bgColor = palette.overlay;
  const borderColor = palette.border;

  // Default quadrant colors with alpha
  const defaultColors = [
    palette.colors.blue,
    palette.colors.green,
    palette.colors.yellow,
    palette.colors.purple,
  ];

  // Margins
  const margin = { top: title ? 60 : 30, right: 30, bottom: 50, left: 60 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;

  // Scales: data uses 0-1 range
  const xScale = d3Scale.scaleLinear().domain([0, 1]).range([0, chartWidth]);
  const yScale = d3Scale.scaleLinear().domain([0, 1]).range([chartHeight, 0]);

  // Create SVG
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .style('background', bgColor);

  // Tooltip
  const tooltip = createTooltip(container, palette, isDark);

  // Title
  if (title) {
    const titleText = svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('fill', textColor)
      .attr('font-size', '18px')
      .attr('font-weight', '700')
      .style(
        'cursor',
        onClickItem && quadrantTitleLineNumber ? 'pointer' : 'default'
      )
      .text(title);

    if (onClickItem && quadrantTitleLineNumber) {
      titleText
        .on('click', () => onClickItem(quadrantTitleLineNumber))
        .on('mouseenter', function () {
          d3Selection.select(this).attr('opacity', 0.7);
        })
        .on('mouseleave', function () {
          d3Selection.select(this).attr('opacity', 1);
        });
    }
  }

  // Chart group (translated by margins)
  const chartG = svg
    .append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);

  // Get fill color for each quadrant (solid, no transparency)
  const getQuadrantFill = (
    label: QuadrantLabel | null,
    defaultIdx: number
  ): string => {
    return label?.color ?? defaultColors[defaultIdx % defaultColors.length];
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
    .attr('stroke', borderColor)
    .attr('stroke-width', 0.5);

  // Contrast color for text/points on colored backgrounds
  const contrastColor = isDark ? '#ffffff' : '#333333';
  const shadowColor = isDark ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)';

  // Draw quadrant labels (large, centered, contrasting color for readability)
  const quadrantLabelTexts = chartG
    .selectAll('text.quadrant-label')
    .data(quadrantDefs.filter((d) => d.label !== null))
    .enter()
    .append('text')
    .attr('class', 'quadrant-label')
    .attr('x', (d) => d.labelX)
    .attr('y', (d) => d.labelY)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', contrastColor)
    .attr('font-size', '16px')
    .attr('font-weight', '600')
    .style('text-shadow', `0 1px 2px ${shadowColor}`)
    .style('cursor', (d) =>
      onClickItem && d.label?.lineNumber ? 'pointer' : 'default'
    )
    .text((d) => d.label!.text);

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

  // X-axis labels
  if (quadrantXAxis) {
    // Low label (left)
    const xLowLabel = svg
      .append('text')
      .attr('x', margin.left)
      .attr('y', height - 15)
      .attr('text-anchor', 'start')
      .attr('fill', textColor)
      .attr('font-size', '12px')
      .style(
        'cursor',
        onClickItem && quadrantXAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantXAxis[0]);

    // High label (right)
    const xHighLabel = svg
      .append('text')
      .attr('x', width - margin.right)
      .attr('y', height - 15)
      .attr('text-anchor', 'end')
      .attr('fill', textColor)
      .attr('font-size', '12px')
      .style(
        'cursor',
        onClickItem && quadrantXAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantXAxis[1]);

    // Arrow in the middle
    svg
      .append('text')
      .attr('x', width / 2)
      .attr('y', height - 15)
      .attr('text-anchor', 'middle')
      .attr('fill', mutedColor)
      .attr('font-size', '12px')
      .text('→');

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

  // Y-axis labels
  if (quadrantYAxis) {
    // Low label (bottom)
    const yLowLabel = svg
      .append('text')
      .attr('x', 15)
      .attr('y', height - margin.bottom)
      .attr('text-anchor', 'start')
      .attr('fill', textColor)
      .attr('font-size', '12px')
      .attr('transform', `rotate(-90, 15, ${height - margin.bottom})`)
      .style(
        'cursor',
        onClickItem && quadrantYAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantYAxis[0]);

    // High label (top)
    const yHighLabel = svg
      .append('text')
      .attr('x', 15)
      .attr('y', margin.top)
      .attr('text-anchor', 'end')
      .attr('fill', textColor)
      .attr('font-size', '12px')
      .attr('transform', `rotate(-90, 15, ${margin.top})`)
      .style(
        'cursor',
        onClickItem && quadrantYAxisLineNumber ? 'pointer' : 'default'
      )
      .text(quadrantYAxis[1]);

    // Arrow in the middle
    svg
      .append('text')
      .attr('x', 15)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', mutedColor)
      .attr('font-size', '12px')
      .attr('transform', `rotate(-90, 15, ${height / 2})`)
      .text('→');

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

    const pointG = pointsG.append('g').attr('class', 'point-group');

    // Circle (contrasting fill with colored border for visibility)
    pointG
      .append('circle')
      .attr('cx', cx)
      .attr('cy', cy)
      .attr('r', 6)
      .attr('fill', contrastColor)
      .attr('stroke', pointColor)
      .attr('stroke-width', 2);

    // Label (contrasting color with shadow for readability)
    pointG
      .append('text')
      .attr('x', cx)
      .attr('y', cy - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', contrastColor)
      .attr('font-size', '11px')
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
 * Renders a D3 chart to an SVG string for export.
 * Creates a detached DOM element, renders into it, extracts the SVG, then cleans up.
 */
export async function renderD3ForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors
): Promise<string> {
  const parsed = parseD3(content, palette);
  // Allow sequence diagrams through even if parseD3 errors —
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

  const isDark = theme === 'dark';

  // Fall back to Nord palette if none provided
  const { getPalette } = await import('./palettes');
  const effectivePalette =
    palette ?? (isDark ? getPalette('nord').dark : getPalette('nord').light);

  // Create a temporary offscreen container
  const container = document.createElement('div');
  container.style.width = `${EXPORT_WIDTH}px`;
  container.style.height = `${EXPORT_HEIGHT}px`;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  const dims: D3ExportDimensions = { width: EXPORT_WIDTH, height: EXPORT_HEIGHT };

  try {
    if (parsed.type === 'sequence') {
      const { parseSequenceDgmo } = await import('./sequence/parser');
      const { renderSequenceDiagram } = await import('./sequence/renderer');
      const seqParsed = parseSequenceDgmo(content);
      if (seqParsed.error || seqParsed.participants.length === 0) return '';
      renderSequenceDiagram(container, seqParsed, effectivePalette, isDark, undefined, {
        exportWidth: EXPORT_WIDTH,
      });
    } else if (parsed.type === 'wordcloud') {
      await renderWordCloudAsync(container, parsed, effectivePalette, isDark, dims);
    } else if (parsed.type === 'arc') {
      renderArcDiagram(container, parsed, effectivePalette, isDark, undefined, dims);
    } else if (parsed.type === 'timeline') {
      renderTimeline(container, parsed, effectivePalette, isDark, undefined, dims);
    } else if (parsed.type === 'venn') {
      renderVenn(container, parsed, effectivePalette, isDark, undefined, dims);
    } else if (parsed.type === 'quadrant') {
      renderQuadrant(container, parsed, effectivePalette, isDark, undefined, dims);
    } else {
      renderSlopeChart(container, parsed, effectivePalette, isDark, undefined, dims);
    }

    const svgEl = container.querySelector('svg');
    if (!svgEl) return '';

    // For transparent theme, remove the background
    if (theme === 'transparent') {
      svgEl.style.background = 'none';
    }

    // Add xmlns for standalone SVG
    svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svgEl.style.fontFamily = FONT_FAMILY;

    return svgEl.outerHTML;
  } finally {
    document.body.removeChild(container);
  }
}
