// ============================================================
// Data-chart parser + types + legend-group helpers.
// Extracted from the former echarts.ts when ECharts was removed — this is
// the pure DGMO→ParsedExtendedChart parser (no rendering, no ECharts). The
// hand-built D3 renderers in charts-d3/ consume these types + parsers.
// ============================================================

import type {
  ChartAnnotation,
  ChartNote,
  RawAnnotation,
} from './annotations/types';
import { withPaletteLifted } from './palettes/directive';
import {
  malformedAnnotation,
  parseAnnotationLine,
  parseChartNoteLine,
  resolveAnnotations,
} from './annotations/parse';
import {
  anchoredEmphasis,
  anchoredNoteText,
  declaresType,
  highlightColor,
  liftAnchored,
  topLevelMoved,
  warnNoAnchor,
} from './annotations/anchored';

const SCATTER_ONLY: ReadonlySet<string> = new Set(['scatter']);
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
  | 'funnel'
  | 'boxplot'
  | 'histogram';

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
import type { ChartFrame } from './utils/chart-frame-parse';
import {
  parseChartFrameLine,
  takeFootnoteBlock,
} from './utils/chart-frame-parse';
import type { AxisName, AxisSpecs } from './utils/axis-spec';
import {
  AXIS_DIRECTIVE_DX,
  AXIS_OLD_DIRECTIVE_DX,
  parseAxisLine,
  settleAxisSpec,
} from './utils/axis-spec';
import type { NumberFormatSpec } from './utils/number-format';
import { parseNumberFormatLine } from './utils/number-format';

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
  /** `subtitle`, `source`, `footnote`, `byline` (#1827). */
  frame?: ChartFrame;
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
  /** Range and scale from the `x-axis` / `y-axis` lines (decision #60). */
  axes?: AxisSpecs;
  /** `format`, `unit`, `locale` (#1831) on the types that print values. */
  numberFormat?: NumberFormatSpec;
  noName?: boolean;
  noValue?: boolean;
  noPercent?: boolean;
  /** `fill` directive — shade the area below each curve (function charts),
   *  parity with the `line` chart's bare `fill`. Opacity follows `fillMode`. */
  fill?: boolean;
  /** §1.9 fill family: `'solid'` = full intent saturation, `'outline'` =
   *  theme-background fill with color on the stroke. Absent ⇒ 25% tint. */
  fillMode?: 'solid' | 'outline';
  /** Cross-chart-type: when true, the renderer suppresses the chart title. */
  noTitle?: boolean;
  /** Cross-chart-type: when true, the renderer suppresses the legend and the
   *  vertical band it would occupy (#48). */
  noLegend?: boolean;
  /** §1.9 `legend-inline`: title + series legend on one line (see ParsedChart).
   *  Honoured by scatter/function among the extended charts (decision #50). */
  legendInline?: boolean;
  /** §1.11 emphasis family: `highlight <Name>…` / `dim <Name>…`. Chart-level,
   *  mutually exclusive, last-one-wins. Resolved against real element names at
   *  render time via `resolveEmphasis`. */
  emphasis?: EmphasisDirective;
  // The three maps below are keyed by author-written names, so they are
  // created with `Object.create(null)`: a node or category named
  // `constructor` must read `undefined`, not an inherited member (#1866).
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
  /** `marker` and `band` on either axis (#2039). */
  annotations?: ChartAnnotation[];
  /** `note <point> …` (#2039). */
  notes?: ChartNote[];
  /** `no-notes` (#2039). */
  noNotes?: boolean;
  scatterPoints?: ParsedScatterPoint[];
  sizelabel?: string;
  /** Bare `connect` (#1982): join the points in row order, one path per
   *  `[Category]`, with an arrowhead on the last segment. */
  connect?: boolean;
  /** Statistics overlays (#1954): `trend`, one line per `[Category]`. */
  overlays?: ChartOverlay[];
}

export interface ParsedHeatmap extends ParsedExtendedBase {
  type: 'heatmap';
  heatmapRows?: ParsedHeatmapRow[];
  columns?: string[];
  rows?: string[];
  /** `scale diverging [<mid>]` (#1837): two hues meeting at a neutral `mid`. */
  heatmapScale?: { kind: 'diverging'; mid: number };
}

export interface ParsedFunnel extends ParsedExtendedBase {
  type: 'funnel';
}

export interface ParsedBoxplot extends ParsedExtendedBase {
  type: 'boxplot';
  /** The groups in written order; the unnamed group (name '') comes first. */
  boxplotGroups?: BoxplotGroup[];
  /** `points`: every value as a dot beside its box. */
  points?: boolean;
  /** `mean`: a hollow diamond at each group's mean. */
  showMean?: boolean;
  /** `orientation-horizontal`: groups down the left, values across. */
  horizontal?: boolean;
}

export interface ParsedHistogram extends ParsedExtendedBase {
  type: 'histogram';
  /** The groups in written order; the unnamed group (name '') comes first. */
  histogramGroups?: HistogramGroup[];
  /** `bin-width`, `bins`, `bin-start` as settled (#1847). */
  histogramBins?: HistogramBinSpec;
  /** `percent`: y is each group's share, not its count. */
  percent?: boolean;
  /** Statistics overlays (#1954): `mean`, `median`. */
  overlays?: ChartOverlay[];
}

/** What `parseExtendedChart` returns: discriminated on `type`. */
export type ParsedExtendedChart =
  | ParsedSankey
  | ParsedChord
  | ParsedFunctionChart
  | ParsedScatter
  | ParsedHeatmap
  | ParsedFunnel
  | ParsedBoxplot
  | ParsedHistogram;

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
  heatmapScale?: { kind: 'diverging'; mid: number };
  xRange?: { min: number; max: number };
  sizelabel?: string;
  connect?: boolean;
  annotations?: ChartAnnotation[];
  notes?: ChartNote[];
  noNotes?: boolean;
  overlays?: ChartOverlay[];
  boxplotGroups?: BoxplotGroup[];
  points?: boolean;
  showMean?: boolean;
  horizontal?: boolean;
  histogramGroups?: HistogramGroup[];
  histogramBins?: HistogramBinSpec;
  percent?: boolean;
}

// ============================================================
// Nord Colors for Charts
// ============================================================

import type { PaletteColors } from './palettes';
import { AliasRegistry } from './utils/alias-registry';
import type { ChartOverlay } from './overlays/types';
import {
  type BoxplotGroup,
  type BoxplotState,
  boxplotStrayLine,
  openBoxplotGroup,
  parseBoxplotLine,
  settleBoxplot,
} from './charts-d3/boxplot-parse';
import {
  type HistogramBinSpec,
  type HistogramGroup,
  type HistogramState,
  histogramStrayLine,
  openHistogramGroup,
  parseHistogramLine,
  settleHistogram,
} from './charts-d3/histogram-parse';
import {
  parseOverlayLine,
  settleOverlays,
  unknownOverlay,
} from './overlays/parse';
import type { ParsedChart } from './chart';
import {
  makeDgmoError,
  formatDgmoError,
  suggest,
  emit,
  TITLE_DIRECTIVE_DX,
  NEGATIVE_VALUE_DX,
  HEATMAP_SCALE_DX,
} from './diagnostics';
import { resolveColorWithDiagnostic } from './colors';
import {
  collectIndentedValues,
  detectBadChartTypeDeclaration,
  extractColor,
  fillModeFromToken,
  GLOBAL_BOOLEANS,
  measureIndent,
  normalizeNumericToken,
  parseFirstLine,
  parseSeriesNames,
} from './utils/parsing';
import { parseDataRowValues, surplusValueDiagnostic } from './chart';
import {
  type EmphasisDirective,
  isEmphasisToken,
  parseEmphasisDirective,
  resolveHighlightPaths,
} from './utils/emphasis';

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
  'boxplot',
  'histogram',
]);

/** Known option keywords for the extended chart parser. */
const KNOWN_EXTENDED_OPTIONS = new Set([
  'chart',
  'title',
  'series',
  'size-label',
  'layout',
  'no-name',
  'no-value',
  'no-percent',
  'columns',
  'rows',
  'x',
  'highlight',
  'dim',
]);

/**
 * Tokens that may legitimately lead line 1 without being a chart type, so
 * `detectBadChartTypeDeclaration` doesn't mistake a leading option for a
 * botched declaration.
 */
const KNOWN_EXTENDED_FIRST_TOKENS: ReadonlySet<string> = new Set([
  ...KNOWN_EXTENDED_OPTIONS,
  ...GLOBAL_BOOLEANS,
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
  return parseExtendedChartFull(content, palette);
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
  return withPaletteLifted(content, (lifted) =>
    parseSankeyRaw(lifted, palette)
  );
}

function parseSankeyRaw(
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
  return withPaletteLifted(content, (lifted) =>
    parseFunctionChartRaw(lifted, palette)
  );
}

function parseFunctionChartRaw(
  content: string,
  palette?: PaletteColors
): ParsedFunctionChart {
  return parseExtendedChart(content, palette) as ParsedFunctionChart;
}

export function parseScatter(
  content: string,
  palette?: PaletteColors
): ParsedScatter {
  return withPaletteLifted(content, (lifted) =>
    parseScatterRaw(lifted, palette)
  );
}

function parseScatterRaw(
  content: string,
  palette?: PaletteColors
): ParsedScatter {
  return parseExtendedChart(content, palette) as ParsedScatter;
}

export function parseHeatmap(
  content: string,
  palette?: PaletteColors
): ParsedHeatmap {
  return withPaletteLifted(content, (lifted) =>
    parseHeatmapRaw(lifted, palette)
  );
}

function parseHeatmapRaw(
  content: string,
  palette?: PaletteColors
): ParsedHeatmap {
  return parseExtendedChart(content, palette) as ParsedHeatmap;
}

export function parseFunnel(
  content: string,
  palette?: PaletteColors
): ParsedFunnel {
  return withPaletteLifted(content, (lifted) =>
    parseFunnelRaw(lifted, palette)
  );
}

function parseFunnelRaw(
  content: string,
  palette?: PaletteColors
): ParsedFunnel {
  return parseExtendedChart(content, palette) as ParsedFunnel;
}

export function parseBoxplot(
  content: string,
  palette?: PaletteColors
): ParsedBoxplot {
  return withPaletteLifted(content, (lifted) =>
    parseBoxplotRaw(lifted, palette)
  );
}

function parseBoxplotRaw(
  content: string,
  palette?: PaletteColors
): ParsedBoxplot {
  return parseExtendedChart(content, palette) as ParsedBoxplot;
}

export function parseHistogram(
  content: string,
  palette?: PaletteColors
): ParsedHistogram {
  return withPaletteLifted(content, (lifted) =>
    parseHistogramRaw(lifted, palette)
  );
}

function parseHistogramRaw(
  content: string,
  palette?: PaletteColors
): ParsedHistogram {
  return parseExtendedChart(content, palette) as ParsedHistogram;
}

/** The extended-data-chart parser doors, for `isExtendedChartParser`. */
export const EXTENDED_CHART_DOORS = new Set<unknown>([
  parseSankey,
  parseChord,
  parseFunctionChart,
  parseScatter,
  parseHeatmap,
  parseFunnel,
  parseBoxplot,
  parseHistogram,
]);

function parseExtendedChartFull(
  content: string,
  palette?: PaletteColors
): ParsedExtendedChartFull {
  // Scatter's `note` and `highlight` sit indented under their point or
  // `[Group]` (#2078, #2080); lifted here, resolved after the loop.
  // The footnote block and its markdown body (#2093) come out first, so a
  // body line that starts with `note` is never lifted as an annotation.
  const raw = content.split('\n');
  const footnote: { frame?: ChartFrame; diagnostics: DgmoError[] } = {
    diagnostics: [],
  };
  takeFootnoteBlock(footnote, raw, footnote.diagnostics);
  const isScatter = declaresType(raw, SCATTER_ONLY);
  const lifted = isScatter ? liftAnchored(raw) : null;
  const lines = lifted ? lifted.lines : raw;
  const result: ParsedExtendedChartFull = {
    type: 'scatter',
    data: [],
    diagnostics: [],
    error: null,
  };

  // Track current category for grouped scatter charts
  let currentCategory = 'Default';
  const rawAnnotations: RawAnnotation[] = [];
  const rawOverlays: ChartOverlay[] = [];
  const boxplot: BoxplotState = { groups: [] };
  const histogram: HistogramState = { groups: [], bins: {} };

  // Sankey indentation state: stack of source nodes by indent level
  const sankeyStack: { name: string; indent: number }[] = [];
  let firstLineParsed = false;

  // Per-parse alias literal → canonical node name (TD-18). Per C8.
  // Used by sankey + chord link slots.
  const nameAliasMap = new AliasRegistry();
  /** Peel `as <alias>` and resolve bare alias references in one pass. */
  function resolveSlot(raw: string): string {
    const trimmed = raw.trim();
    const m = trimmed.match(/^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/);
    if (m) {
      // Regex capture groups [1] and [2] are non-optional in the pattern.
      const canonical = m[1]!.trim();
      // No line in scope here — the registry's cursor, set once per line in
      // the main loop below, dates both the declaration and the reference.
      nameAliasMap.declare(m[2]!, canonical);
      nameAliasMap.noteCanonical(canonical);
      return canonical;
    }
    const aliased = nameAliasMap.resolve(trimmed);
    return aliased ?? trimmed;
  }

  // The footnote block read before the lift (#2093), joined to the result.
  if (footnote.frame) result.frame = footnote.frame;
  result.diagnostics.push(...footnote.diagnostics);
  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const trimmed = lines[i]!.trim();
    const lineNumber = i + 1;
    nameAliasMap.at(lineNumber);

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
      // First line is an unknown type — bare (`bubble`) or, since decision
      // #48 made line 1 title-bearing, with a title (`bubble Empty`).
      const badType = detectBadChartTypeDeclaration(
        trimmed,
        KNOWN_EXTENDED_FIRST_TOKENS
      );
      if (badType) {
        const validTypes = [...VALID_EXTENDED_TYPES];
        let msg = `Unsupported chart type: ${badType}. Supported types: ${validTypes.join(', ')}.`;
        const hint = suggest(badType.toLowerCase(), validTypes);
        if (hint) msg += ` ${hint}`;
        const diag = makeDgmoError(lineNumber, msg);
        result.diagnostics.push(diag);
        result.error = formatDgmoError(diag);
        return result;
      }
      // Fall through — first line might be a data row or option
    }

    // Box plot rows and flags (#1848). Before the flow-row match, which
    // would read `-3 -2` as a link.
    if (
      result.type === 'boxplot' &&
      parseBoxplotLine(trimmed, lineNumber, boxplot, result.diagnostics)
    )
      continue;
    // Histogram rows and bin directives (#1847). Before the flow-row match,
    // which would read a pre-counted `-10--5 3` as a link.
    if (result.type === 'histogram') {
      if (
        parseHistogramLine(trimmed, lineNumber, histogram, result.diagnostics)
      )
        continue;
      const overlay = parseOverlayLine(trimmed, lineNumber, result.diagnostics);
      if (overlay) {
        if (overlay !== true) rawOverlays.push(overlay);
        continue;
      }
    }

    // Annotations and notes (#2039), scatter only: on sankey or chord a
    // node may be named `note` or `marker`.
    if (result.type === 'scatter') {
      const annotation = parseAnnotationLine(
        trimmed,
        lineNumber,
        result.diagnostics,
        palette
      );
      if (annotation) {
        rawAnnotations.push(annotation);
        continue;
      }
      const malformed = malformedAnnotation(trimmed);
      if (malformed) {
        result.diagnostics.push(
          makeDgmoError(lineNumber, malformed, 'warning')
        );
        continue;
      }
      const noteLine = parseChartNoteLine(
        lines,
        i,
        0,
        result.diagnostics,
        palette
      );
      if (noteLine) {
        // The old top-level form (#2078): a note sits under its point now.
        result.diagnostics.push(
          topLevelMoved(
            'note',
            noteLine.note.text.split('\n')[0] ?? '',
            lineNumber,
            noteLine.note.target || '<point>'
          )
        );
        i = noteLine.lastIndex;
        continue;
      }
      // Statistics overlays (#1954): scatter draws `trend`.
      const overlay = parseOverlayLine(trimmed, lineNumber, result.diagnostics);
      if (overlay) {
        if (overlay !== true) rawOverlays.push(overlay);
        continue;
      }
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
        result.categoryColors ??= Object.create(null) as Record<string, string>;
        result.categoryColors[catName] = catColor;
      }
      result.categoryLineNumbers ??= Object.create(null) as Record<
        string,
        number
      >;
      result.categoryLineNumbers[catName] = lineNumber;
      currentCategory = catName;
      if (result.type === 'boxplot')
        openBoxplotGroup(boxplot, catName, catColor ?? undefined, lineNumber);
      if (result.type === 'histogram')
        openHistogramGroup(
          histogram,
          catName,
          catColor ?? undefined,
          lineNumber
        );
      continue;
    }

    // Sankey/chord link syntax (§1.5 universal trailing-token):
    //   `Source -> Target value`           (directed, no link color)
    //   `Source -> Target value linkColor` (directed, trailing-token link color)
    //   `Source -- Target value`           (undirected)
    // The link-color slot accepts ANY bare word, not just the 11 palette names:
    // `resolveColorWithDiagnostic` below turns an unrecognized one into a
    // "Did you mean…?" warning on this line. Restricting the pattern to valid
    // names instead made the whole line match no link form at all, so it was
    // silently re-read as a bare node and the flow vanished with the only
    // diagnostic being a misleading "No links found" on line 1.
    // Source/target labels still accept trailing-token color via extractColor.
    const arrowMatch = trimmed.match(
      /^(.+?)\s*(->|--)\s*(.+?)\s+(-?[\d,_]+(?:\.[\d]+)?)(?:\s+([A-Za-z][A-Za-z0-9_-]*))?\s*$/
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
        result.nodeColors ??= Object.create(null) as Record<string, string>;
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
      const linkValue = parseFloat(val);
      // A flow's ribbon width encodes magnitude — negative has no visual.
      if (linkValue < 0) {
        result.diagnostics.push(
          emit(NEGATIVE_VALUE_DX, lineNumber, {
            value: linkValue,
            label: `${source} -> ${target}`,
            channel: 'flow widths',
          })
        );
        continue;
      }
      result.links ??= [];
      result.links.push({
        source,
        target,
        value: linkValue,
        ...(linkColor && { color: linkColor }),
        directed: arrow === '->',
        lineNumber,
      });
      continue;
    }

    // Frame directives: subtitle, source, footnote, byline (#1827). After the
    // flow rows, so `source -> Sink 5` stays a flow; before the sankey bare
    // label, which would otherwise read `source Census` as a node.
    if (parseChartFrameLine(result, lines[i]!, lineNumber, result.diagnostics))
      continue;

    // Number format (#1831), on the types that print numbers.
    if (
      FORMATTED_TYPES.has(result.type) &&
      parseNumberFormatLine(trimmed, lineNumber, result, result.diagnostics)
    )
      continue;

    // The axis line (decision #60). Only scatter and function draw numeric
    // axes and axis titles; on the other extended types it warns.
    if (
      parseAxisLine(
        trimmed,
        lineNumber,
        (result.axes ??= {}),
        EXTENDED_AXES[result.type] ?? NO_AXES,
        result.diagnostics,
        EXTENDED_AXES[result.type]
          ? (axis, label, at) => {
              if (axis === 'x') {
                result.xlabel = label;
                result.xlabelLineNumber = at;
              } else {
                result.ylabel = label;
                result.ylabelLineNumber = at;
              }
            }
          : undefined
      )
    )
      continue;

    // Heatmap colour scale (#1837): `scale diverging [<mid>]`. Lowercase at
    // column 1 only, like the number format. A line naming `scale` that cannot
    // be read warns and is consumed, so it never becomes a row named "scale".
    if (result.type === 'heatmap' && /^scale(?:\s|$)/.test(trimmed)) {
      const m = trimmed.match(/^scale\s+diverging(?:\s+(-?\d+(?:\.\d+)?))?$/);
      if (m) {
        result.heatmapScale = {
          kind: 'diverging',
          mid: m[1] !== undefined ? parseFloat(m[1]) : 0,
        };
      } else {
        result.diagnostics.push(emit(HEATMAP_SCALE_DX, lineNumber));
      }
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
          // Strategy: peel a trailing bare word that follows the value, then run
          // parseDataRowValues on the remainder. The peeled word goes through
          // `resolveColorWithDiagnostic`, so a mistyped color ("zzznotacolor")
          // gets a "Did you mean…?" warning on THIS line and the link is still
          // built. Matching only the 11 valid names instead left the line
          // matching no link form, so it was silently re-read as a bare node and
          // the whole flow band disappeared.
          // cspell:ignore zzznotacolor
          const valColorMatch = trimmed.match(
            /(-?[\d,_]+(?:\.[\d]+)?)\s+([A-Za-z][A-Za-z0-9_-]*)\s*$/
          );
          const strippedLine = valColorMatch
            ? trimmed.replace(/\s+[A-Za-z][A-Za-z0-9_-]*\s*$/, '')
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
              result.nodeColors ??= Object.create(null) as Record<
                string,
                string
              >;
              result.nodeColors[target] = targetColor;
            }
            // In-bounds by values.length === 1 guard above.
            const childValue = dataRow.values[0]!;
            if (childValue < 0) {
              result.diagnostics.push(
                emit(NEGATIVE_VALUE_DX, lineNumber, {
                  value: childValue,
                  label: `${source} -> ${target}`,
                  channel: 'flow widths',
                })
              );
              continue;
            }
            result.links ??= [];
            result.links.push({
              source,
              target,
              value: childValue,
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
        /^(fill|fill-tint|fill-solid|fill-outline|no-name|no-value|no-percent|no-title)$/i.test(
          trimmed
        );
      // `layout arc|chord` (#26) and the §1.11 emphasis family (`highlight A`,
      // `dim Losses`) are directives, not nodes — let them fall through to the
      // valued-option handler below instead of becoming phantom nodes. The
      // sankey bare-label branch runs BEFORE the option chain, so every
      // one-word-plus-argument directive needs a seat here.
      const leadToken =
        spaceIdx >= 0 ? trimmed.substring(0, spaceIdx).toLowerCase() : '';
      const isValuedDirective =
        spaceIdx >= 0 && (leadToken === 'layout' || isEmphasisToken(leadToken));
      if (!hasNumericSuffix && !isBareKeywordOption && !isValuedDirective) {
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
          result.nodeColors ??= Object.create(null) as Record<string, string>;
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

      // §1.11 emphasis family. Mutually exclusive with each other and
      // last-one-wins, exactly like the `fill-*` family (#46) — stating both
      // `highlight` and `dim` is contradictory, not additive, so the later line
      // simply replaces the earlier one.
      if (isEmphasisToken(firstToken)) {
        const directive = parseEmphasisDirective(trimmed, lineNumber);
        // On scatter a `highlight` sits under its point or group (#2080).
        if (directive && result.type === 'scatter')
          result.diagnostics.push(
            topLevelMoved('highlight', '', lineNumber, directive.names[0]!)
          );
        else if (directive) result.emphasis = directive;
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
        warnSeriesMarks(result, parsed);
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

      // `x 0 to 250` was the function chart's range before decision #60.
      if (
        result.type === 'function' &&
        /^x\s+-?[\d.]+\s+to\s+-?[\d.]+$/.test(trimmed)
      ) {
        const [, lo, hi] = trimmed.split(/\s+/);
        result.diagnostics.push(
          emit(AXIS_OLD_DIRECTIVE_DX, lineNumber, {
            directive: 'x … to …',
            replacement: `x-axis ${lo}..${hi}`,
          })
        );
        continue;
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
    if (firstToken === 'fill' && spaceIdx < 0) {
      result.fill = true;
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
    if (firstToken === 'legend-inline' && spaceIdx < 0) {
      result.legendInline = true;
      continue;
    }
    if (firstToken === 'connect' && spaceIdx < 0 && result.type === 'scatter') {
      result.connect = true;
      continue;
    }
    if (firstToken === 'no-notes' && spaceIdx < 0) {
      result.noNotes = true;
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
      warnSeriesMarks(result, parsed);
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
        result.functions ??= [];
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
        result.scatterPoints ??= [];
        result.scatterPoints.push(scatterData);
        continue;
      }
    }

    // Heatmap data row: "RowLabel val1, val2, val3, ..." or "RowLabel val1 val2 val3"
    if (result.type === 'heatmap') {
      // `columns` fixes an exact value count, so a row label ending in a digit
      // ("Compound 1 5 4 3") is resolvable rather than ambiguous: take the last
      // N numbers as values and weld the surplus back into the label. Without
      // this the greedy walk eats the "1", shifting every cell one column left
      // and mangling the label, in silence.
      const expected = result.columns?.length;
      const dataRow = parseDataRowValues(trimmed, {
        multiValue: true,
        ...(expected !== undefined && { expectedValues: expected }),
      });
      if (dataRow && dataRow.values.length > 0) {
        if (expected !== undefined) {
          const surplus = surplusValueDiagnostic(dataRow, expected, lineNumber);
          if (surplus) result.diagnostics.push(surplus);
        }
        result.heatmapRows ??= [];
        result.heatmapRows.push({
          label: dataRow.label,
          values: dataRow.values,
          lineNumber,
        });
        continue;
      }
    }

    // Box plot: a row with a word in it, or a line nothing took.
    if (result.type === 'boxplot') {
      if (boxplotStrayLine(trimmed, lineNumber, boxplot, result.diagnostics))
        continue;
      result.diagnostics.push(
        makeDgmoError(
          lineNumber,
          `Unexpected line: '${trimmed}'. Expected numbers (12 15 17.5), a [Group] header or a known option.`,
          'warning'
        )
      );
      continue;
    }

    // Histogram: a row with a word in it, or a line nothing took.
    if (result.type === 'histogram') {
      if (
        histogramStrayLine(trimmed, lineNumber, histogram, result.diagnostics)
      )
        continue;
      const notOverlay = unknownOverlay(trimmed, lineNumber);
      result.diagnostics.push(
        notOverlay ??
          makeDgmoError(
            lineNumber,
            `Unexpected line: '${trimmed}'. Expected numbers (12 15 17.5), a pre-counted row (10-20 31) or a known option.`,
            'warning'
          )
      );
      continue;
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
      // A funnel band's width encodes stage size — negative has no visual.
      if (result.type === 'funnel' && dataRow.values[0]! < 0) {
        result.diagnostics.push(
          emit(NEGATIVE_VALUE_DX, lineNumber, {
            value: dataRow.values[0]!,
            label: rawLabel,
            channel: 'funnel stage sizes',
          })
        );
        continue;
      }
      result.data.push({
        label: rawLabel,
        // In-bounds by values.length === 1 guard above.
        value: dataRow.values[0]!,
        ...(pointColor && { color: pointColor }),
        lineNumber,
      });
      continue;
    }

    // Catch-all: nothing matched this line. On scatter, a word that reads
    // like an overlay says which overlays exist (#1954).
    const notOverlay =
      result.type === 'scatter' ? unknownOverlay(trimmed, lineNumber) : null;
    if (notOverlay) {
      result.diagnostics.push(notOverlay);
      continue;
    }
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
    if (result.type === 'boxplot') {
      settleBoxplot(boxplot, result.diagnostics);
      if (boxplot.groups.length === 0)
        warn(
          1,
          'No values found. Add numbers, any number per line: 12 15 17.5'
        );
      result.boxplotGroups = boxplot.groups;
      if (boxplot.points) result.points = true;
      if (boxplot.mean) result.showMean = true;
      if (boxplot.horizontal) result.horizontal = true;
    } else if (result.type === 'sankey') {
      if (!result.links || result.links.length === 0) {
        warn(1, 'No links found. Add links in format: Source -> Target 123');
      }
      // A `highlight` chain (#2041) that names a flow the chart does not have
      // warns and names that flow, so a typo never silently lights nothing.
      const emph = result.emphasis;
      if (emph && result.links?.length) {
        const paths = resolveHighlightPaths(
          emph,
          result.links.flatMap((l) => [l.source, l.target]),
          result.links.map((l) => ({ from: l.source, to: l.target }))
        );
        for (const missing of paths.unknown.filter((u) => u.includes('->')))
          warn(
            emph.lineNumber,
            `highlight names a flow this chart does not have: ${missing}`
          );
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
      // `x-axis 0..250` sets the sampled range; an open end keeps the
      // default for that end.
      const x = result.axes?.x;
      if (x?.scale === 'log')
        result.diagnostics.push(
          emit(AXIS_DIRECTIVE_DX, x.lineNumber ?? 1, {
            directive: 'x-axis',
            reason: 'a function chart samples x on a linear scale',
          })
        );
      result.xRange = { min: x?.min ?? -10, max: x?.max ?? 10 };
      delete result.axes?.x;
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
    } else if (result.type === 'histogram') {
      settleHistogram(histogram, result.diagnostics);
      if (histogram.groups.length === 0)
        warn(
          1,
          'No values found. Add numbers, any number per line: 12 15 17.5'
        );
      result.histogramGroups = histogram.groups;
      result.histogramBins = histogram.bins;
      if (histogram.percent) result.percent = true;
      const overlays = settleOverlays(
        rawOverlays,
        { type: 'histogram' },
        result.diagnostics
      );
      if (overlays.length) result.overlays = overlays;
    }
  }

  // Alias namespace rules (§2A.2) — decidable only once the whole
  // source has been read.
  result.diagnostics.push(...nameAliasMap.finish());

  // Annotations (#2039): scatter's two axes are both numeric.
  if (result.type === 'scatter') {
    const resolved = resolveAnnotations(
      rawAnnotations,
      { categories: null },
      result.diagnostics
    );
    if (resolved.length) result.annotations = resolved;
    const points = result.scatterPoints ?? [];
    const pointAt = new Map(points.map((p, k) => [p.lineNumber, k]));
    const groupAt = new Map(
      Object.entries(result.categoryLineNumbers ?? {}).map(([name, ln]) => [
        ln,
        name,
      ])
    );
    const notes: ChartNote[] = [];
    const lit: { name: string; color: string | null; lineNumber: number }[] =
      [];
    for (const a of lifted?.anchored ?? []) {
      const k = pointAt.get(a.anchorLine);
      if (a.keyword === 'highlight') {
        const name =
          k !== undefined ? points[k]!.name : groupAt.get(a.anchorLine);
        if (name === undefined) {
          warnNoAnchor(a, 'a point or a [Group] header', result.diagnostics);
          continue;
        }
        lit.push({
          name,
          color: highlightColor(a, result.diagnostics),
          lineNumber: a.lineNumber,
        });
        continue;
      }
      if (a.keyword === 'marker') {
        result.diagnostics.push(
          makeDgmoError(
            a.lineNumber,
            'On scatter a marker is a value on an axis, not a point — write it on its own line: marker 50 Target, or marker x 5 Launch.',
            'warning'
          )
        );
        continue;
      }
      if (k === undefined) {
        warnNoAnchor(a, 'a point', result.diagnostics);
        continue;
      }
      const note = anchoredNoteText(a, result.diagnostics, palette);
      const text = [note.header, note.body].filter(Boolean).join('\n');
      if (!text.trim()) {
        result.diagnostics.push(
          makeDgmoError(
            a.lineNumber,
            'This note has no text — ignored.',
            'warning'
          )
        );
        continue;
      }
      notes.push({
        series: 0,
        index: k,
        text,
        color: note.color,
        lineNumber: a.lineNumber,
      });
    }
    if (notes.length) result.notes = notes;
    const emphasis = lifted?.override ?? anchoredEmphasis(lit);
    if (emphasis) result.emphasis = emphasis;
    const overlays = settleOverlays(
      rawOverlays,
      { type: 'scatter' },
      result.diagnostics
    );
    if (overlays.length) result.overlays = overlays;
  } else delete result.noNotes;

  if (!result.error && result.axes && result.type === 'boxplot') {
    // The value axis is y in either orientation, as on bar.
    settleAxisSpec(
      'y',
      result.axes.y,
      (result.boxplotGroups ?? []).flatMap((g) => g.values),
      result.diagnostics
    );
  } else if (!result.error && result.axes && result.type === 'histogram') {
    // x is the values' own axis; y holds counts, known once binned.
    settleAxisSpec(
      'x',
      result.axes.x,
      (result.histogramGroups ?? []).flatMap((g) => [
        ...g.values,
        ...g.ranges.flatMap((r) => [r.x0, r.x1]),
      ]),
      result.diagnostics
    );
    settleAxisSpec('y', result.axes.y, [], result.diagnostics);
  } else if (!result.error && result.axes) {
    const pts = result.scatterPoints ?? [];
    // A function's values are only known once it is sampled at render time,
    // so only its bounds are checked here.
    settleAxisSpec(
      'y',
      result.axes.y,
      pts.map((p) => p.y),
      result.diagnostics
    );
    settleAxisSpec(
      'x',
      result.axes.x,
      pts.map((p) => p.x),
      result.diagnostics
    );
  }

  return result;
}

const NO_AXES: ReadonlySet<AxisName> = new Set();
/** Extended types whose printed numbers take `format` / `unit` / `locale`. */
const FORMATTED_TYPES: ReadonlySet<ExtendedChartType> = new Set([
  'scatter',
  'function',
  'heatmap',
  'funnel',
  'sankey',
  'boxplot',
  'histogram',
]);
/** The numeric axes each extended chart type has (#1830). */
const EXTENDED_AXES: Partial<Record<ExtendedChartType, ReadonlySet<AxisName>>> =
  {
    scatter: new Set(['x', 'y']),
    function: new Set(['x', 'y']),
    boxplot: new Set(['y']),
    histogram: new Set(['x', 'y']),
  };

// ============================================================
// ECharts Option Builder
// ============================================================

/**
 * `mark:` (#1852) draws a series as a bar, line or step on bar and line
 * charts only; elsewhere it is peeled off the name and ignored, so say so.
 */
function warnSeriesMarks(
  result: { type: string; diagnostics: DgmoError[] },
  parsed: { marks?: unknown[]; nameLineNumbers: number[] }
): void {
  if (!parsed.marks) return;
  const at = parsed.nameLineNumbers[parsed.marks.findIndex(Boolean)] ?? 1;
  result.diagnostics.push(
    makeDgmoError(
      at,
      `\`mark:\` on a series applies only to bar and line charts; every series of "${result.type}" draws in its own mark.`,
      'warning'
    )
  );
}

/**
 * Extracts legend group data from standard chart types (multi-series line/bar).
 * Returns empty array if chart has no multi-series legend.
 */
export function getSimpleChartLegendGroups(
  parsed: ParsedChart,
  colors: string[]
): LegendGroupData[] {
  if (!parsed.seriesNames || parsed.seriesNames.length <= 1) return [];
  // colors is a non-empty palette array; modulo index is always in-bounds.
  const colorOf = (i: number): string =>
    parsed.seriesNameColors?.[i] ?? colors[i % colors.length]!;
  // A band (#1981) takes one entry in its low series' colour; its bounds none.
  const bands = parsed.seriesBands ?? [];
  const bounds = new Set(bands.flatMap((b) => [b.low, b.high]));
  // A combo (#1852) shows each series' mark in its swatch.
  const marks = parsed.seriesMarks?.includes('bar')
    ? parsed.seriesMarks
    : undefined;
  const markOf = (i: number) =>
    marks && {
      mark: marks[i] === 'bar' ? ('bar' as const) : ('line' as const),
    };
  return [
    {
      name: 'Series',
      // The band's entry stands where its low series was declared.
      entries: parsed.seriesNames.flatMap((name, i) =>
        bounds.has(i)
          ? bands
              .filter((b) => b.low === i)
              .map((b) => ({ value: b.label, color: colorOf(i) }))
          : [{ value: name, color: colorOf(i), ...markOf(i) }]
      ),
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

  if (parsed.type === 'histogram') {
    const named = (parsed.histogramGroups ?? []).filter((g) => g.name);
    if (named.length === 0) return [];
    const all = parsed.histogramGroups ?? [];
    return [
      {
        name: 'Group',
        entries: named.map((g) => ({
          value: g.name,
          color: g.color ?? colors[all.indexOf(g) % colors.length]!,
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
