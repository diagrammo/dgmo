// ============================================================
// Data-chart parser + types + legend-group helpers.
// Extracted from the former echarts.ts when ECharts was removed — this is
// the pure DGMO→ParsedExtendedChart parser (no rendering, no ECharts). The
// hand-built D3 renderers in charts-d3/ consume these types + parsers.
// ============================================================

import type { LegendGroupData } from './utils/legend-types';

// ============================================================
// Types
// ============================================================

export type ExtendedChartType =
  | 'sankey'
  | 'chord'
  | 'function'
  | 'scatter'
  | 'heatmap'
  | 'funnel';

interface ExtendedChartDataPoint {
  label: string;
  value: number;
  color?: string;
  lineNumber: number;
}

interface ParsedSankeyLink {
  source: string;
  target: string;
  value: number;
  color?: string;
  directed?: boolean;
  lineNumber: number;
}

interface ParsedFunction {
  name: string;
  expression: string;
  color?: string;
  lineNumber: number;
}

interface ParsedScatterPoint {
  name: string;
  x: number;
  y: number;
  size?: number;
  color?: string;
  category?: string;
  lineNumber: number;
}

interface ParsedHeatmapRow {
  label: string;
  values: number[];
  lineNumber: number;
}

import type { DgmoError } from './diagnostics';

// ============================================================
// Discriminated union — Story 109.2a (arch-review). Each extended data-chart
// carries only its own type-specific fields; the parser fills a fat
// `ParsedExtendedChartFull` accumulator and returns it narrowed (type-only,
// runtime-identical). Shared fields live on ParsedExtendedBase.
// ============================================================

/** Fields shared by every extended data-chart. */
export interface ParsedExtendedBase {
  title?: string;
  titleLineNumber?: number;
  series?: string;
  seriesLineNumber?: number;
  seriesNames?: string[];
  seriesNameLineNumbers?: number[];
  seriesNameColors?: (string | undefined)[];
  data: ExtendedChartDataPoint[];
  xlabel?: string;
  xlabelLineNumber?: number;
  ylabel?: string;
  ylabelLineNumber?: number;
  /** X-axis range — read by both function plots and scatter. */
  xRange?: { min: number; max: number };
  noName?: boolean;
  noValue?: boolean;
  noPercent?: boolean;
  shade?: boolean;
  /** §1.9 fill family: `'solid'` = full intent saturation, `'outline'` =
   *  theme-background fill with color on the stroke. Absent ⇒ 25% tint. */
  fillMode?: 'solid' | 'outline';
  /** Cross-chart-type: when true, the renderer suppresses the chart title. */
  noTitle?: boolean;
  /** Cross-chart-type: when true, the renderer suppresses the legend and the
   *  vertical band it would occupy (#48). */
  noLegend?: boolean;
  categoryColors?: Record<string, string>;
  categoryLineNumbers?: Record<string, number>;
  nodeColors?: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}

export interface ParsedSankey extends ParsedExtendedBase {
  type: 'sankey';
  links?: ParsedSankeyLink[];
}

export interface ParsedChord extends ParsedExtendedBase {
  type: 'chord';
  links?: ParsedSankeyLink[];
  /** `layout arc|chord` override (#26). `arc` re-renders the same edges as a
   *  linear arc; absent ⇒ the `chord` circular preset. */
  layout?: 'arc' | 'chord';
}

export interface ParsedFunctionChart extends ParsedExtendedBase {
  type: 'function';
  functions?: ParsedFunction[];
}

export interface ParsedScatter extends ParsedExtendedBase {
  type: 'scatter';
  scatterPoints?: ParsedScatterPoint[];
  sizelabel?: string;
}

export interface ParsedHeatmap extends ParsedExtendedBase {
  type: 'heatmap';
  heatmapRows?: ParsedHeatmapRow[];
  columns?: string[];
  rows?: string[];
}

export interface ParsedFunnel extends ParsedExtendedBase {
  type: 'funnel';
}

/** What `parseExtendedChart` returns: discriminated on `type`. */
export type ParsedExtendedChart =
  | ParsedSankey
  | ParsedChord
  | ParsedFunctionChart
  | ParsedScatter
  | ParsedHeatmap
  | ParsedFunnel;

/**
 * The parser's mutable accumulator — every type-specific field present, so the
 * single state machine can populate whichever the detected type needs.
 * `parseExtendedChart` returns this narrowed to {@link ParsedExtendedChart}; the
 * object is a structural superset of every variant, so the narrowing is sound
 * and changes nothing at runtime.
 */
export interface ParsedExtendedChartFull extends ParsedExtendedBase {
  type: ExtendedChartType;
  links?: ParsedSankeyLink[];
  layout?: 'arc' | 'chord';
  functions?: ParsedFunction[];
  scatterPoints?: ParsedScatterPoint[];
  heatmapRows?: ParsedHeatmapRow[];
  columns?: string[];
  rows?: string[];
  xRange?: { min: number; max: number };
  sizelabel?: string;
}

// ============================================================
// Nord Colors for Charts
// ============================================================

import type { PaletteColors } from './palettes';
import type { ParsedChart } from './chart';
import {
  makeDgmoError,
  formatDgmoError,
  suggest,
  emit,
  TITLE_DIRECTIVE_DX,
} from './diagnostics';
import { resolveColorWithDiagnostic } from './colors';
import {
  collectIndentedValues,
  extractColor,
  fillModeFromToken,
  measureIndent,
  normalizeNumericToken,
  parseFirstLine,
  parseSeriesNames,
} from './utils/parsing';
import { parseDataRowValues } from './chart';

// ============================================================
// Shared Constants
// ============================================================

const VALID_EXTENDED_TYPES = new Set<ExtendedChartType>([
  'sankey',
  'chord',
  'function',
  'scatter',
  'heatmap',
  'funnel',
]);

/** Known option keywords for the extended chart parser. */
const KNOWN_EXTENDED_OPTIONS = new Set([
  'chart',
  'title',
  'series',
  'x-label',
  'y-label',
  'size-label',
  'layout',
  'no-name',
  'no-value',
  'no-percent',
  'columns',
  'rows',
  'x',
]);

/**
 * Parse a scatter data row: "Name x, y[, size]" or "Name(color) x, y[, size]"
 * Returns a ParsedScatterPoint or null if the line doesn't match.
 */
function parseScatterRow(
  line: string,
  palette: PaletteColors | undefined,
  currentCategory: string,
  lineNumber: number,
  diagnostics: DgmoError[]
): ParsedScatterPoint | null {
  const dataRow = parseDataRowValues(line, { multiValue: true });
  if (!dataRow || dataRow.values.length < 2) return null;
  const { label: rawLabel, color: pointColor } = extractColor(
    dataRow.label,
    palette,
    diagnostics,
    lineNumber
  );
  return {
    name: rawLabel,
    // In-bounds by length >= 2 guard above.
    x: dataRow.values[0]!,
    y: dataRow.values[1]!,
    ...(dataRow.values[2] !== undefined && { size: dataRow.values[2] }),
    ...(pointColor && { color: pointColor }),
    ...(currentCategory !== 'Default' && { category: currentCategory }),
    lineNumber,
  };
}

/**
 * Parses extended chart content into a structured object.
 *
 * Format (colon-free):
 * ```
 * scatter My Chart
 * xlabel Weight
 *
 * Alice 165, 60
 * Bob 180, 85
 * ```
 */
export function parseExtendedChart(
  content: string,
  palette?: PaletteColors
): ParsedExtendedChart {
  return parseExtendedChartFull(content, palette) as ParsedExtendedChart;
}

// ============================================================
// Per-type parser doors — Story 109.2a (arch-review). Each extended data-chart's
// typed entry point into the shared parse state machine, returning its narrowed
// variant. The registry binds each id to its own door; `isExtendedChartParser`
// recognises them by set membership (they replace the old single-identity check).
// ============================================================

export function parseSankey(
  content: string,
  palette?: PaletteColors
): ParsedSankey {
  return parseExtendedChart(content, palette) as ParsedSankey;
}

export function parseChord(
  content: string,
  palette?: PaletteColors
): ParsedChord {
  return parseExtendedChart(content, palette) as ParsedChord;
}

export function parseFunctionChart(
  content: string,
  palette?: PaletteColors
): ParsedFunctionChart {
  return parseExtendedChart(content, palette) as ParsedFunctionChart;
}

export function parseScatter(
  content: string,
  palette?: PaletteColors
): ParsedScatter {
  return parseExtendedChart(content, palette) as ParsedScatter;
}

export function parseHeatmap(
  content: string,
  palette?: PaletteColors
): ParsedHeatmap {
  return parseExtendedChart(content, palette) as ParsedHeatmap;
}

export function parseFunnel(
  content: string,
  palette?: PaletteColors
): ParsedFunnel {
  return parseExtendedChart(content, palette) as ParsedFunnel;
}

/** The six extended-data-chart parser doors, for `isExtendedChartParser`. */
export const EXTENDED_CHART_DOORS = new Set<unknown>([
  parseSankey,
  parseChord,
  parseFunctionChart,
  parseScatter,
  parseHeatmap,
  parseFunnel,
]);

function parseExtendedChartFull(
  content: string,
  palette?: PaletteColors
): ParsedExtendedChartFull {
  const lines = content.split('\n');
  const result: ParsedExtendedChartFull = {
    type: 'scatter',
    data: [],
    diagnostics: [],
    error: null,
  };

  // Track current category for grouped scatter charts
  let currentCategory = 'Default';

  // Sankey indentation state: stack of source nodes by indent level
  const sankeyStack: { name: string; indent: number }[] = [];
  let firstLineParsed = false;

  // Per-parse alias literal → canonical node name (TD-18). Per C8.
  // Used by sankey + chord link slots.
  const nameAliasMap = new Map<string, string>();
  /** Peel `as <alias>` and resolve bare alias references in one pass. */
  function resolveSlot(raw: string): string {
    const trimmed = raw.trim();
    const m = trimmed.match(/^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/);
    if (m) {
      // Regex capture groups [1] and [2] are non-optional in the pattern.
      const canonical = m[1]!.trim();
      nameAliasMap.set(m[2]!, canonical);
      return canonical;
    }
    const aliased = nameAliasMap.get(trimmed);
    return aliased !== undefined ? aliased : trimmed;
  }

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const trimmed = lines[i]!.trim();
    const lineNumber = i + 1;

    // Skip empty lines
    if (!trimmed) continue;

    // Reject legacy ## category syntax
    if (/^#{2,}\s+/.test(trimmed)) {
      const name = trimmed
        .replace(/^#{2,}\s+/, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
      result.diagnostics.push(
        makeDgmoError(
          lineNumber,
          `'## ${name}' is no longer supported. Use '[${name}]' instead`
        )
      );
      continue;
    }

    // Skip comments
    if (trimmed.startsWith('//')) continue;

    // First non-empty, non-comment line: chart type + optional title
    if (!firstLineParsed) {
      firstLineParsed = true;
      const firstLine = parseFirstLine(trimmed);
      // The extended-chart parser owns its own type vocabulary. `chord` is no
      // longer a top-level chart-type keyword (decision #29), so parseFirstLine
      // won't return it — but the arc `layout chord` override re-emits canonical
      // `chord …` content that must still parse here. Recognize an extended type
      // directly from the first token when parseFirstLine declines.
      if (!firstLine) {
        const rawType = trimmed.split(/\s+/)[0]!.toLowerCase();
        if (VALID_EXTENDED_TYPES.has(rawType as ExtendedChartType)) {
          result.type = rawType as ExtendedChartType;
          const rest = trimmed.slice(rawType.length).trim();
          if (rest) {
            result.title = rest;
            result.titleLineNumber = lineNumber;
          }
          continue;
        }
      }
      if (firstLine) {
        const chartType =
          firstLine.chartType.toLowerCase() as ExtendedChartType;
        if (VALID_EXTENDED_TYPES.has(chartType)) {
          result.type = chartType;
          if (firstLine.title) {
            result.title = firstLine.title;
            result.titleLineNumber = lineNumber;
          }
          continue;
        } else {
          const validTypes = [...VALID_EXTENDED_TYPES];
          let msg = `Unsupported chart type: ${firstLine.chartType}. Supported types: ${validTypes.join(', ')}.`;
          const hint = suggest(chartType, validTypes);
          if (hint) msg += ` ${hint}`;
          const diag = makeDgmoError(lineNumber, msg);
          result.diagnostics.push(diag);
          result.error = formatDgmoError(diag);
          return result;
        }
      }
      // If the first line is a single word (no spaces, no colon, no numbers),
      // treat it as an unrecognized chart type rather than falling through
      if (
        !trimmed.includes(' ') &&
        !trimmed.includes(':') &&
        !/\d/.test(trimmed)
      ) {
        const validTypes = [...VALID_EXTENDED_TYPES];
        let msg = `Unsupported chart type: ${trimmed}. Supported types: ${validTypes.join(', ')}.`;
        const hint = suggest(trimmed.toLowerCase(), validTypes);
        if (hint) msg += ` ${hint}`;
        const diag = makeDgmoError(lineNumber, msg);
        result.diagnostics.push(diag);
        result.error = formatDgmoError(diag);
        return result;
      }
      // Fall through — first line might be a data row or option
    }

    // [Category] container header with optional color: [Category Name] or [Category Name](color)
    // Category brackets with optional trailing-token color (§1.5):
    // `[Name]` or `[Name] color`. Per universal rule, color is a bare token.
    const categoryMatch = trimmed.match(/^\[(.+?)\](?:\s+(\S+))?\s*$/);
    if (categoryMatch) {
      // Regex capture group [1] is non-optional in the pattern.
      const catName = categoryMatch[1]!.trim();
      const rawCatColor = categoryMatch[2]?.trim();
      const catColor = rawCatColor
        ? (resolveColorWithDiagnostic(
            rawCatColor,
            lineNumber,
            result.diagnostics,
            palette
          ) ?? null)
        : null;
      if (catColor) {
        if (!result.categoryColors) result.categoryColors = {};
        result.categoryColors[catName] = catColor;
      }
      if (!result.categoryLineNumbers) result.categoryLineNumbers = {};
      result.categoryLineNumbers[catName] = lineNumber;
      currentCategory = catName;
      continue;
    }

    // Sankey/chord link syntax (§1.5 universal trailing-token):
    //   `Source -> Target value`           (directed, no link color)
    //   `Source -> Target value linkColor` (directed, trailing-token link color)
    //   `Source -- Target value`           (undirected)
    // Link color (if present) must be a recognized lowercase palette word.
    // Source/target labels still accept trailing-token color via extractColor.
    const arrowMatch = trimmed.match(
      /^(.+?)\s*(->|--)\s*(.+?)\s+(-?[\d_]+(?:\.[\d]+)?)(?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/
    );
    if (arrowMatch) {
      const [, rawSource, arrow, rawTarget, rawVal, rawLinkColor] = arrowMatch;
      // Captures 1-4 are non-optional in the regex pattern.
      const val = normalizeNumericToken(rawVal!) ?? rawVal!;
      // TD-18: peel/resolve aliases on source and target before color extraction.
      const sourceResolved = resolveSlot(rawSource!);
      const targetResolved = resolveSlot(rawTarget!);
      const { label: source, color: sourceColor } = extractColor(
        sourceResolved,
        palette,
        result.diagnostics,
        lineNumber
      );
      const { label: target, color: targetColor } = extractColor(
        targetResolved,
        palette,
        result.diagnostics,
        lineNumber
      );
      if (sourceColor || targetColor) {
        if (!result.nodeColors) result.nodeColors = {};
        if (sourceColor) result.nodeColors[source] = sourceColor;
        if (targetColor) result.nodeColors[target] = targetColor;
      }
      const linkColor = rawLinkColor
        ? resolveColorWithDiagnostic(
            rawLinkColor.trim(),
            lineNumber,
            result.diagnostics,
            palette
          )
        : undefined;
      if (!result.links) result.links = [];
      result.links.push({
        source,
        target,
        value: parseFloat(val),
        ...(linkColor && { color: linkColor }),
        directed: arrow === '->',
        lineNumber,
      });
      continue;
    }

    // Sankey: bare label (no numeric value) at any indent = source node for indented children
    if (result.type === 'sankey') {
      // In-bounds by loop guard (i < lines.length).
      const indent = measureIndent(lines[i]!);
      // Sankey indented child: "  Target value (color)" under a source on the stack
      if (indent > 0 && sankeyStack.length > 0) {
        // Pop entries at same or deeper indent to find the parent
        while (sankeyStack.length && sankeyStack.at(-1)!.indent >= indent) {
          sankeyStack.pop();
        }
        if (sankeyStack.length > 0) {
          // Indented sankey child (§1.5 trailing-token):
          //   `TargetName value`                  — link, no link color
          //   `TargetName value linkColor`        — link with link color
          //   `TargetName nodeColor value`        — node-colored child
          //   `TargetName nodeColor value linkColor` — both
          // Strategy: peel a trailing recognized color word (after the value)
          // first, then run parseDataRowValues on the remainder. Trailing
          // tokens that aren't recognized colors stay in the data row.
          const valColorMatch = trimmed.match(
            /(-?[\d_]+(?:\.[\d]+)?)\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white)\s*$/
          );
          const strippedLine = valColorMatch
            ? trimmed.replace(
                /\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white)\s*$/,
                ''
              )
            : trimmed;
          const dataRow = parseDataRowValues(strippedLine);
          if (dataRow?.values.length === 1) {
            const source = sankeyStack.at(-1)!.name;
            const linkColor = valColorMatch?.[2]
              ? resolveColorWithDiagnostic(
                  valColorMatch[2].trim(),
                  lineNumber,
                  result.diagnostics,
                  palette
                )
              : undefined;
            // TD-18: peel/resolve alias on the indented child target name.
            const targetResolved = resolveSlot(dataRow.label);
            const { label: target, color: targetColor } = extractColor(
              targetResolved,
              palette,
              result.diagnostics,
              lineNumber
            );
            if (targetColor) {
              if (!result.nodeColors) result.nodeColors = {};
              result.nodeColors[target] = targetColor;
            }
            if (!result.links) result.links = [];
            result.links.push({
              source,
              target,
              // In-bounds by values.length === 1 guard above.
              value: dataRow.values[0]!,
              ...(linkColor && { color: linkColor }),
              lineNumber,
            });
            sankeyStack.push({ name: target, indent });
            continue;
          }
        }
      }

      // Bare label at indent 0 (or any indent without a value) = new source node.
      // Skip cross-chart bare-keyword options so they're handled by the
      // bare-keyword block below instead of becoming a phantom "solid-fill" node.
      const spaceIdx = trimmed.indexOf(' ');
      const lastTok = trimmed.substring(trimmed.lastIndexOf(' ') + 1);
      const hasNumericSuffix =
        spaceIdx >= 0 &&
        !isNaN(parseFloat(normalizeNumericToken(lastTok) ?? lastTok));
      const isBareKeywordOption =
        spaceIdx < 0 &&
        /^(fill-tint|fill-solid|fill-outline|no-name|no-value|no-percent|shade|no-title)$/i.test(
          trimmed
        );
      // `layout arc|chord` (#26) is a directive, not a node — let it fall through
      // to the valued-option handler below instead of becoming a phantom node.
      const isLayoutDirective =
        spaceIdx >= 0 &&
        trimmed.substring(0, spaceIdx).toLowerCase() === 'layout';
      if (!hasNumericSuffix && !isBareKeywordOption && !isLayoutDirective) {
        while (sankeyStack.length && sankeyStack.at(-1)!.indent >= indent) {
          sankeyStack.pop();
        }
        // TD-18: peel/resolve alias on the bare source node label.
        const trimmedResolved = resolveSlot(trimmed);
        const { label: nodeName, color: nodeColor } = extractColor(
          trimmedResolved,
          palette,
          result.diagnostics,
          lineNumber
        );
        if (nodeColor) {
          if (!result.nodeColors) result.nodeColors = {};
          result.nodeColors[nodeName] = nodeColor;
        }
        sankeyStack.push({ name: nodeName, indent });
        continue;
      }
    }

    // Extract first token to check for known options
    const spaceIdx = trimmed.indexOf(' ');
    const firstToken = (
      spaceIdx >= 0 ? trimmed.substring(0, spaceIdx) : trimmed
    ).toLowerCase();

    // Known option with a value
    if (KNOWN_EXTENDED_OPTIONS.has(firstToken) && spaceIdx >= 0) {
      const value = trimmed.substring(spaceIdx + 1).trim();

      if (firstToken === 'chart') {
        const chartType = value.toLowerCase() as ExtendedChartType;
        if (VALID_EXTENDED_TYPES.has(chartType)) {
          result.type = chartType;
        } else {
          const validTypes = [...VALID_EXTENDED_TYPES];
          let msg = `Unsupported chart type: ${value}. Supported types: ${validTypes.join(', ')}.`;
          const hint = suggest(chartType, validTypes);
          if (hint) msg += ` ${hint}`;
          const diag = makeDgmoError(lineNumber, msg);
          result.diagnostics.push(diag);
          result.error = formatDgmoError(diag);
          return result;
        }
        continue;
      }

      if (firstToken === 'title') {
        // Removed (decision #48): the chart title is line 1. Error + ignore.
        result.diagnostics.push(emit(TITLE_DIRECTIVE_DX, lineNumber));
        continue;
      }

      if (firstToken === 'series') {
        const parsed = parseSeriesNames(value, lines, i, palette);
        i = parsed.newIndex;
        result.series = parsed.series;
        result.seriesLineNumber = lineNumber;
        if (parsed.names.length > 1) {
          result.seriesNames = parsed.names;
          result.seriesNameLineNumbers = parsed.nameLineNumbers;
        }
        if (parsed.nameColors.some(Boolean))
          result.seriesNameColors = parsed.nameColors;
        continue;
      }

      if (firstToken === 'x-label') {
        result.xlabel = value;
        result.xlabelLineNumber = lineNumber;
        continue;
      }
      if (firstToken === 'y-label') {
        result.ylabel = value;
        result.ylabelLineNumber = lineNumber;
        continue;
      }
      if (firstToken === 'size-label') {
        result.sizelabel = value;
        continue;
      }

      // `layout arc|chord` (#26): render the same pairwise edges as the other
      // preset. `arc` → linear arc; default `chord` → circular.
      if (firstToken === 'layout') {
        const v = value.toLowerCase();
        if (v === 'arc' || v === 'chord') result.layout = v;
        continue;
      }

      if (firstToken === 'columns') {
        if (value) {
          result.columns = value.includes(',')
            ? value.split(',').map((s) => s.trim())
            : value.split(/\s+/);
        } else {
          const collected = collectIndentedValues(lines, i);
          i = collected.newIndex;
          result.columns = collected.values;
        }
        continue;
      }

      if (firstToken === 'rows') {
        if (value) {
          result.rows = value.includes(',')
            ? value.split(',').map((s) => s.trim())
            : value.split(/\s+/);
        } else {
          const collected = collectIndentedValues(lines, i);
          i = collected.newIndex;
          result.rows = collected.values;
        }
        continue;
      }

      if (firstToken === 'x') {
        const rangeMatch = value.match(/^(-?[\d.]+)\s+to\s+(-?[\d.]+)$/);
        if (rangeMatch) {
          result.xRange = {
            // Regex capture groups [1] and [2] are non-optional in the pattern.
            min: parseFloat(rangeMatch[1]!),
            max: parseFloat(rangeMatch[2]!),
          };
          continue;
        }
        // The `x` keyword owns ONLY the `x <min> to <max>` range form. A
        // function curve can legitimately start with `x` (e.g. `x / 2: x / 2`);
        // such a colon-bearing line must fall through to the function-curve
        // handler below instead of being silently swallowed here.
        if (!(result.type === 'function' && trimmed.includes(':'))) {
          continue;
        }
      }
    }

    // Bare boolean options
    if (firstToken === 'no-name') {
      result.noName = true;
      continue;
    }
    if (firstToken === 'no-value') {
      result.noValue = true;
      continue;
    }
    if (firstToken === 'no-percent') {
      result.noPercent = true;
      continue;
    }
    if (firstToken === 'shade') {
      result.shade = true;
      continue;
    }
    const fillFamily = fillModeFromToken(firstToken);
    if (fillFamily !== null && spaceIdx < 0) {
      if (fillFamily === 'tint') delete result.fillMode;
      else result.fillMode = fillFamily;
      continue;
    }
    if (firstToken === 'no-title' && spaceIdx < 0) {
      result.noTitle = true;
      continue;
    }
    if (firstToken === 'no-legend' && spaceIdx < 0) {
      result.noLegend = true;
      continue;
    }
    // Silent-ignore unrecognized no-* flags (typos, future flags).
    if (firstToken.startsWith('no-') && spaceIdx < 0) {
      continue;
    }

    // Bare keyword options (no value)
    if (firstToken === 'series' && spaceIdx === -1) {
      const parsed = parseSeriesNames('', lines, i, palette);
      i = parsed.newIndex;
      result.series = parsed.series;
      result.seriesLineNumber = lineNumber;
      if (parsed.names.length > 1) {
        result.seriesNames = parsed.names;
        result.seriesNameLineNumbers = parsed.nameLineNumbers;
      }
      if (parsed.nameColors.some(Boolean))
        result.seriesNameColors = parsed.nameColors;
      continue;
    }

    if (firstToken === 'columns' && spaceIdx === -1) {
      const collected = collectIndentedValues(lines, i);
      i = collected.newIndex;
      result.columns = collected.values;
      continue;
    }

    if (firstToken === 'rows' && spaceIdx === -1) {
      const collected = collectIndentedValues(lines, i);
      i = collected.newIndex;
      result.rows = collected.values;
      continue;
    }

    // Function chart: "name expression" where name may contain parens like f(x)
    // Must use colon to separate name from expression since both can contain spaces
    if (result.type === 'function') {
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex >= 0) {
        const { label: fnName, color: fnColor } = extractColor(
          trimmed.substring(0, colonIndex).trim(),
          palette,
          result.diagnostics,
          lineNumber
        );
        const fnValue = trimmed.substring(colonIndex + 1).trim();
        if (!result.functions) result.functions = [];
        result.functions.push({
          name: fnName,
          expression: fnValue,
          ...(fnColor && { color: fnColor }),
          lineNumber,
        });
        continue;
      }
    }

    // Scatter chart: "Name x, y" or "Name x, y, size"
    if (result.type === 'scatter') {
      // Parse from right: trailing comma-separated numbers are x, y [, size]
      const scatterData = parseScatterRow(
        trimmed,
        palette,
        currentCategory,
        lineNumber,
        result.diagnostics
      );
      if (scatterData) {
        if (!result.scatterPoints) result.scatterPoints = [];
        result.scatterPoints.push(scatterData);
        continue;
      }
    }

    // Heatmap data row: "RowLabel val1, val2, val3, ..." or "RowLabel val1 val2 val3"
    if (result.type === 'heatmap') {
      const dataRow = parseDataRowValues(trimmed, { multiValue: true });
      if (dataRow && dataRow.values.length > 0) {
        if (!result.heatmapRows) result.heatmapRows = [];
        result.heatmapRows.push({
          label: dataRow.label,
          values: dataRow.values,
          lineNumber,
        });
        continue;
      }
    }

    // Funnel / generic data point: "Label value"
    const dataRow = parseDataRowValues(trimmed);
    if (dataRow?.values.length === 1) {
      const { label: rawLabel, color: pointColor } = extractColor(
        dataRow.label,
        palette,
        result.diagnostics,
        lineNumber
      );
      result.data.push({
        label: rawLabel,
        // In-bounds by values.length === 1 guard above.
        value: dataRow.values[0]!,
        ...(pointColor && { color: pointColor }),
        lineNumber,
      });
      continue;
    }

    // Catch-all: nothing matched this line
    result.diagnostics.push(
      makeDgmoError(
        lineNumber,
        `Unexpected line: '${trimmed}'. Expected a data row ('Label value', space-separated) or a known option.`,
        'warning'
      )
    );
  }

  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!result.error) {
    if (result.type === 'sankey') {
      if (!result.links || result.links.length === 0) {
        warn(1, 'No links found. Add links in format: Source -> Target 123');
      }
    } else if (result.type === 'chord') {
      if (!result.links || result.links.length === 0) {
        warn(1, 'No links found. Add links in format: Source -> Target 123');
      }
    } else if (result.type === 'function') {
      if (!result.functions || result.functions.length === 0) {
        warn(
          1,
          'No functions found. Add functions in format: Name: expression'
        );
      }
      if (!result.xRange) {
        result.xRange = { min: -10, max: 10 }; // Default range
      }
    } else if (result.type === 'scatter') {
      if (!result.scatterPoints || result.scatterPoints.length === 0) {
        warn(
          1,
          'No scatter points found. Add points in format: Name: x, y or Name: x, y, size'
        );
      }
    } else if (result.type === 'heatmap') {
      if (!result.heatmapRows || result.heatmapRows.length === 0) {
        warn(
          1,
          'No heatmap data found. Add data in format: RowLabel: val1, val2, val3'
        );
      }
      if (!result.columns || result.columns.length === 0) {
        warn(
          1,
          'No columns defined. Add columns in format: columns: Col1, Col2, Col3'
        );
      }
    } else if (result.type === 'funnel') {
      if (result.data.length === 0) {
        warn(1, 'No data found. Add data in format: Label: value');
      }
    }
  }

  return result;
}

// ============================================================
// ECharts Option Builder
// ============================================================

/**
 * Extracts legend group data from standard chart types (multi-series line/bar).
 * Returns empty array if chart has no multi-series legend.
 */
export function getSimpleChartLegendGroups(
  parsed: ParsedChart,
  colors: string[]
): LegendGroupData[] {
  if (!parsed.seriesNames || parsed.seriesNames.length <= 1) return [];
  return [
    {
      name: 'Series',
      entries: parsed.seriesNames.map((name, i) => ({
        value: name,
        // colors is a non-empty palette array; modulo index is always in-bounds.
        color: parsed.seriesNameColors?.[i] ?? colors[i % colors.length]!,
      })),
    },
  ];
}

/**
 * Extracts legend group data from extended chart types.
 * Supports scatter (categories), chord (nodes), and function (series).
 */
export function getExtendedChartLegendGroups(
  parsed: ParsedExtendedChart,
  colors: string[]
): LegendGroupData[] {
  if (parsed.type === 'scatter') {
    const points = parsed.scatterPoints ?? [];
    const categories = [
      ...new Set(points.map((p) => p.category).filter(Boolean)),
    ] as string[];
    if (categories.length === 0) return [];
    return [
      {
        name: 'Group',
        entries: categories.map((cat, i) => ({
          value: cat,
          // colors is a non-empty palette array; modulo index is always in-bounds.
          color: parsed.categoryColors?.[cat] ?? colors[i % colors.length]!,
        })),
      },
    ];
  }

  if (parsed.type === 'function') {
    const fns = parsed.functions ?? [];
    if (fns.length === 0) return [];
    return [
      {
        name: 'Function',
        entries: fns.map((fn, i) => ({
          value: fn.name,
          // colors is a non-empty palette array; modulo index is always in-bounds.
          color: fn.color ?? colors[i % colors.length]!,
        })),
      },
    ];
  }

  return [];
}
