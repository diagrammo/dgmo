// ============================================================
// Types
// ============================================================

export type ChartType = 'bar' | 'line' | 'pie' | 'polar-area' | 'radar';

export interface ChartDataPoint {
  label: string;
  value: number;
  extraValues?: number[];
  color?: string;
  lineNumber: number;
  /** Clustered-stacked bar (#1879): the category this row is indented
   *  under. The row's own `label` is then its period (free text). */
  cluster?: string;
  /** Marimekko (`widths`, #1872): the column width, the row's first
   *  number. A share when `ParsedChart.widths` is `'share'`, else a size. */
  width?: number;
}

/** A clustered-stacked bar category line (#1879). */
export interface ChartCluster {
  label: string;
  lineNumber: number;
}

export interface ChartEra {
  start: string; // exact category label, e.g. "'77"
  end: string; // exact category label, e.g. "'81"
  label: string; // display name, e.g. "Carter"
  color: string | null; // resolved CSS color, or null → palette default
  lineNumber: number;
}

/** An uncertainty band between two series (#1981). */
export interface SeriesBand {
  label: string;
  /** Series indices of the lower and upper bound. */
  low: number;
  high: number;
  lineNumber: number;
}

/** A two-colour fill between two series (#1997). */
export interface FillBetween {
  /** Series indices. */
  a: number;
  b: number;
  /** Palette colour names: where A is above B, and where B is above A. */
  ahead: string;
  behind: string;
  lineNumber: number;
}

import type { DgmoError } from './diagnostics';
import { withPaletteLifted } from './palettes/directive';
import type { ChartFrame } from './utils/chart-frame-parse';
import {
  parseChartFrameLine,
  takeFootnoteBlock,
} from './utils/chart-frame-parse';
import type { EmphasisDirective } from './utils/emphasis';
import { parseEmphasisDirective } from './utils/emphasis';
import type { AxisName, AxisSpecs } from './utils/axis-spec';
import type { NumberFormatSpec } from './utils/number-format';
import { parseNumberFormatLine } from './utils/number-format';
import type {
  ChartAnnotation,
  ChartNote,
  RawAnnotation,
} from './annotations/types';
import {
  anchoredMarker,
  malformedAnnotation,
  parseAnnotationLine,
  parseChartNoteLine,
  resolveAnnotations,
  warnUnsupported,
} from './annotations/parse';
import {
  anchoredEmphasis,
  anchoredNoteText,
  highlightColor,
  leadingName,
  liftAnchored,
  topLevelMoved,
  warnNoAnchor,
} from './annotations/anchored';
import { divergingSpans } from './utils/diverging';
import type { ChartOverlay } from './overlays/types';
import {
  parseOverlayLine,
  settleOverlays,
  unknownOverlay,
} from './overlays/parse';
import {
  AXIS_DIRECTIVE_DX,
  parseAxisLine,
  settleAxisSpec,
} from './utils/axis-spec';

export interface ParsedChart {
  type: ChartType;
  title?: string;
  titleLineNumber?: number;
  /** `subtitle`, `source`, `footnote`, `byline` (#1827). */
  frame?: ChartFrame;
  series?: string;
  seriesLineNumber?: number;
  xlabel?: string;
  xlabelLineNumber?: number;
  ylabel?: string;
  ylabelLineNumber?: number;
  /** Right (secondary) y-axis label — set by a `y-right-label` option or a
   *  grouped-series axis header (§15.1 dual-axis line charts). */
  yrlabel?: string;
  yrlabelLineNumber?: number;
  seriesNames?: string[];
  seriesNameLineNumbers?: number[];
  seriesNameColors?: (string | undefined)[];
  /** Per-series axis assignment, parallel to seriesNames. Present only when the
   *  series block uses the grouped (dual-axis) form; absent ⇒ all left. */
  seriesAxes?: ('left' | 'right')[];
  /** Multi-series layout, set by a `stack` or `group` block header
   *  (consolidation #24). Absent ⇒ single-series bar. On `bar` it drives
   *  stacked vs clustered rendering in `charts-d3/bar.ts`; on `line`, `stack`
   *  draws stacked areas (#1846) and `group` is ignored. */
  barLayout?: 'stack' | 'group';
  /** `stack 100%` (#1846): each x position is drawn as shares of its total,
   *  on a 0–100% axis. Values stay raw in the source. `bar` and `line`. */
  stackPercent?: boolean;
  /** Marimekko (`widths`, #1872): each row's first number is its column's
   *  width — a share (`42%`, summing to 100) or an absolute size. Implies
   *  `stackPercent`. Set only once the chart passes its checks. */
  widths?: 'share' | 'size';
  /** Line of the `widths` flag, for diagnostics. */
  widthsLineNumber?: number;
  /** Clustered-stacked bar (#1879): categories in source order. Present
   *  when rows are indented under category lines; each data point then
   *  names its `cluster`, and its `label` is the period. */
  clusters?: ChartCluster[];
  /** The periods, in order of first appearance across all categories. A
   *  category missing one leaves that slot empty. */
  periods?: string[];
  /** `stack diverging` (#1980): the stack is centred on 0 — series before
   *  the neutral one grow left (down), series after it grow right (up). */
  diverging?: boolean;
  /** Index of the neutral series of a diverging stack, split half each side
   *  of 0. Absent ⇒ even count, no flag: the split falls between the two
   *  middle series. */
  neutralSeries?: number;
  /** Pie hole inner-radius ratio (0–0.9), set by a `hole` directive
   *  (bare ⇒ default). Absent ⇒ solid pie. (#23) */
  hole?: number;
  /** Draw the pie's rows as a 10×10 waffle grid instead of wedges (bare
   *  `waffle`, #1983). Each cell is one percent of the total. */
  waffle?: boolean;
  /** Suppress the pie center total (bare `no-center-total`). The total
   *  shows by default whenever a hole is present. (#23) */
  noCenterTotal?: boolean;
  /** Pie slice / bar category order (#1978): `sort` / `sort desc` = largest
   *  first, `sort asc` = smallest first. Absent ⇒ source order. */
  sort?: 'asc' | 'desc';
  /** Bar `sort <series name>` (#1978): the series whose values order the
   *  categories. Absent ⇒ the first series (group) or the total (stack). */
  sortSeries?: string;
  /** Line of the `sort` directive, for its diagnostics. */
  sortLineNumber?: number;
  /** Pie `other-below N%`: slices under N% of the total merge into one
   *  trailing "Other" slice. Stored as the percentage N. */
  otherBelow?: number;
  /** Bar (#1979): draw each bar as a thin stem with a dot at its value
   *  (bare `lollipop`). Not with `stack`. */
  lollipop?: boolean;
  /** Line of the `lollipop` flag, for its diagnostics. */
  lollipopLineNumber?: number;
  /** Statistics overlays (#1954): `mean`, `median`, `target N`, `trend`,
   *  `moving-average N`, `extremes`, `pareto`. Only the ones this chart
   *  draws survive parsing. */
  overlays?: ChartOverlay[];
  /** Render a line chart filled, i.e. as an area (bare `fill`). (#25) */
  fill?: boolean;
  orientation?: 'horizontal' | 'vertical';
  color?: string;
  label?: string;
  noName?: boolean;
  noValue?: boolean;
  noPercent?: boolean;
  /** §1.9 fill family: `'solid'` = full intent saturation, `'outline'` =
   *  theme-background fill with color on the stroke. Absent ⇒ 25% tint. */
  fillMode?: 'solid' | 'outline';
  /** Cross-chart-type: when true, the renderer suppresses the chart title. */
  noTitle?: boolean;
  /** Cross-chart-type: when true, the renderer suppresses the legend and the
   *  vertical band it would occupy (#48). */
  noLegend?: boolean;
  /** §1.9 `legend-inline`: render the title and the series legend on one line
   *  (title left, legend right) instead of stacking the legend below a centered
   *  title — reclaims a header row. Honoured by the top-center-legend data
   *  charts (bar/line/radar/scatter/function); a no-op elsewhere. Auto-falls
   *  back to the stacked header when the legend can't fit beside the title on a
   *  single row (decision #50). */
  legendInline?: boolean;
  /** Line only: opt out of the data-driven y-axis auto-fit and anchor the
   *  baseline at 0 (magnitude honesty / old ECharts-parity behavior). By
   *  default a line chart fits a padded data-min→max window (§15.1). */
  noAutoY?: boolean;
  /** Line only (#1880): draw each series as steps. `after` (bare `step`)
   *  starts a value on its own x; `before` (`step-before`) reaches it there. */
  step?: 'after' | 'before';
  /** Line of the step flag, for its diagnostics. */
  stepLineNumber?: number;
  /** Line only (#1981): `band <label> <low> <high>` shades between two
   *  series, which are then not drawn as lines. Indices into the series. */
  seriesBands?: SeriesBand[];
  /** Line only (#1997): `fill-between A B [ahead] [behind]`, in source order. */
  fillBetween?: FillBetween[];
  /** Line of the bare `fill` flag, for its diagnostics. */
  fillLineNumber?: number;
  /** §1.11 emphasis: `highlight <Name>[, <Name>…]` on bar, line and pie
   *  (#1829). Last one wins. Resolved against the categories, series or
   *  slices at render time via `resolveEmphasis`. */
  emphasis?: EmphasisDirective;
  /** `y-scale` / `y-min` / `y-max` on bar and line (#1830). On a dual-axis
   *  line they set the left axis; the right axis keeps its auto-fit. */
  axes?: AxisSpecs;
  /** `format`, `unit`, `locale` (#1831): how every printed number reads. */
  numberFormat?: NumberFormatSpec;
  data: ChartDataPoint[];
  eras?: ChartEra[];
  /** `marker` and `band` (#1832, #2039), bar and line only. */
  annotations?: ChartAnnotation[];
  /** `note <datum> …` (#2039), bar and line only. */
  notes?: ChartNote[];
  /** `no-notes`: draw no `note` (#2039). */
  noNotes?: boolean;
  diagnostics: DgmoError[];
  error: string | null;
}

// ============================================================
// Colors
// ============================================================

import { resolveColorWithDiagnostic, RECOGNIZED_COLOR_NAMES } from './colors';
import type { PaletteColors } from './palettes';
import {
  makeDgmoError,
  formatDgmoError,
  suggest,
  emit,
  TITLE_DIRECTIVE_DX,
  NEGATIVE_VALUE_DX,
} from './diagnostics';

/** Chart types in this parser that take `highlight` (§1.11, #1829). */
const EMPHASIS_TYPES: ReadonlySet<ChartType> = new Set(['bar', 'line', 'pie']);

// Channel wording for the negative-value diagnostic (E_VALUE_NEGATIVE).
const CHANNEL_NAME: Record<string, string> = {
  pie: 'pie slices',
  'polar-area': 'polar-area wedges',
  radar: 'radar axis values',
};
import {
  detectBadChartTypeDeclaration,
  extractColor,
  fillModeFromToken,
  GLOBAL_BOOLEANS,
  measureIndent,
  normalizeNumericToken,
  parseFirstLine,
  parseSeriesNames,
} from './utils/parsing';

// ============================================================
// Parser
// ============================================================

const VALID_TYPES = new Set<ChartType>([
  'bar',
  'line',
  'pie',
  'polar-area',
  'radar',
]);

/** Known option keywords for the simple chart parser. */
const KNOWN_OPTIONS = new Set([
  'chart',
  'title',
  'series',
  'stack',
  'group',
  'hole',
  'x-label',
  'y-label',
  'y-right-label',
  'label',
  'no-name',
  'no-value',
  'no-percent',
  'color',
]);

/** Default doughnut-hole inner-radius ratio when `hole` is given with no value. */
const DEFAULT_HOLE = 0.6;

/** Known boolean options for the simple chart parser. */
const KNOWN_BOOLEANS = new Set([
  'orientation-horizontal',
  'fill-tint',
  'fill-solid',
  'fill-outline',
  'no-title',
  'no-legend',
  'legend-inline',
  'no-auto-y',
  'step',
  'step-before',
  'fill',
  'hole',
  'lollipop',
  'widths',
]);

/**
 * Tokens that may legitimately lead line 1 without being a chart type, so
 * `detectBadChartTypeDeclaration` doesn't mistake a leading option for a
 * botched declaration.
 */
const KNOWN_FIRST_TOKENS: ReadonlySet<string> = new Set([
  ...KNOWN_OPTIONS,
  ...KNOWN_BOOLEANS,
  ...GLOBAL_BOOLEANS,
]);

/**
 * Gate a `series`/`stack`/`group` block header against the chart type.
 * Returns true when the header must be REJECTED (skip collection):
 *  - `series` on a `bar` chart is a hard error → use `stack`/`group` (#24).
 * Emits a warning (but proceeds) for `stack`/`group` on a non-bar chart,
 * except `stack` on `line`, which draws stacked areas (#1846).
 */
function rejectSeriesHeader(
  result: ParsedChart,
  keyword: string,
  lineNumber: number
): boolean {
  if (result.type === 'bar' && keyword === 'series') {
    const diag = makeDgmoError(
      lineNumber,
      "On bar charts, declare multiple series with a 'stack' or 'group' block header, not 'series'."
    );
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return true;
  }
  if (
    (keyword === 'stack' || keyword === 'group') &&
    result.type !== 'bar' &&
    !(keyword === 'stack' && result.type === 'line')
  ) {
    result.diagnostics.push(
      makeDgmoError(
        lineNumber,
        `'${keyword}' is a bar layout header; ${result.type} charts use a 'series' block.`,
        'warning'
      )
    );
  }
  return false;
}

/**
 * Apply the grouped-series (dual-axis) results from parseSeriesNames onto the
 * ParsedChart. The axis headers double as the left/right y-axis labels, and
 * `seriesAxes` is only recorded when a right-axis series actually exists — so a
 * flat series block (or a grouped block with only `y-label` headers) leaves the
 * chart shape identical to single-axis charts.
 */
function applySeriesAxes(
  result: ParsedChart,
  parsed: ReturnType<typeof parseSeriesNames>,
  lineNumber: number
): void {
  if (parsed.leftLabel !== undefined) {
    result.ylabel = parsed.leftLabel;
    result.ylabelLineNumber = lineNumber;
  }
  if (parsed.rightLabel !== undefined) {
    result.yrlabel = parsed.rightLabel;
    result.yrlabelLineNumber = lineNumber;
  }
  if (parsed.axes?.includes('right')) {
    result.seriesAxes = parsed.axes;
  }
}

/**
 * Parses the simple chart text format into a structured object.
 *
 * Format (colon-free):
 * ```
 * bar My Chart
 * series Revenue
 *
 * Jan 120
 * Feb 200
 * Mar 150
 * ```
 */
export function parseChart(
  content: string,
  palette?: PaletteColors
): ParsedChart {
  return withPaletteLifted(content, (lifted) =>
    parseChartUnlifted(lifted, palette)
  );
}

function parseChartUnlifted(
  content: string,
  palette?: PaletteColors
): ParsedChart {
  // `note`, `highlight` and a category `marker` sit indented under the row
  // they belong to (#2078, #2080); lifted here, resolved after the loop.
  // The footnote block and its markdown body (#2093) come out first, so a
  // body line that starts with `note` is never lifted as an annotation.
  const raw = content.split('\n');
  const footnote: { frame?: ChartFrame; diagnostics: DgmoError[] } = {
    diagnostics: [],
  };
  takeFootnoteBlock(footnote, raw, footnote.diagnostics);
  const lifted = liftAnchored(raw);
  const lines = lifted.lines;
  const parsedEras: ChartEra[] = [];
  const pieOnlyLines: [number, string][] = [];
  const annotations: RawAnnotation[] = [];
  const annotationsFromRows: ChartAnnotation[] = [];
  let otherLine = 0;
  let waffleLine = 0;
  const rawEras: {
    start: string;
    afterArrow: string;
    color: string | null;
    lineNumber: number;
  }[] = [];
  const rawSeriesBands: { tokens: string[]; lineNumber: number }[] = [];
  /** Every `series` / `stack` / `group` header, in source order (#1846). */
  const layoutHeaders: { keyword: string; lineNumber: number }[] = [];
  /** Clustered-stacked bar categories and the rows under them (#1879). */
  const rawClusters: ChartCluster[] = [];
  let currentCluster: ChartCluster | null = null;
  let clusteredRows = 0;
  const flatRows: number[] = [];
  /** Marimekko rows (#1872): whether each width was written as a share. */
  const widthForms: { share: boolean; lineNumber: number }[] = [];
  let orientationLine = 1;
  const rawFillBetween: { tokens: string[]; lineNumber: number }[] = [];
  const rawOverlays: ChartOverlay[] = [];
  const result: ParsedChart = {
    type: 'bar',
    data: [],
    eras: parsedEras,
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedChart => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  let firstLineParsed = false;

  // The footnote block read before the lift (#2093), joined to the result.
  if (footnote.frame) result.frame = footnote.frame;
  result.diagnostics.push(...footnote.diagnostics);
  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const trimmed = lines[i]!.trim();
    const lineNumber = i + 1;

    // Skip empty lines
    if (!trimmed) continue;

    // Reject legacy ## section headers
    if (/^#{2,}\s+/.test(trimmed)) {
      result.diagnostics.push(
        makeDgmoError(
          lineNumber,
          `'${trimmed}' removed — use a bracket container '[${trimmed.replace(/^#+\s*/, '')}]' instead (## headers are no longer supported).`
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
      if (firstLine) {
        const raw = firstLine.chartType.toLowerCase();
        const chartType = raw as ChartType;
        if (VALID_TYPES.has(chartType)) {
          result.type = chartType;
          if (firstLine.title) {
            result.title = firstLine.title;
            result.titleLineNumber = lineNumber;
          }
          continue;
        } else {
          let msg = `Unsupported chart type: ${firstLine.chartType}. Supported types: ${[...VALID_TYPES].join(', ')}.`;
          const hint = suggest(raw, [...VALID_TYPES]);
          if (hint) msg += ` ${hint}`;
          return fail(lineNumber, msg);
        }
      }
      // First line is an unknown type — bare (`bubble`) or, since decision
      // #48 made line 1 title-bearing, with a title (`bubble Empty`).
      const badType = detectBadChartTypeDeclaration(
        trimmed,
        KNOWN_FIRST_TOKENS
      );
      if (badType) {
        let msg = `Unsupported chart type: ${badType}. Supported types: ${[...VALID_TYPES].join(', ')}.`;
        const hint = suggest(badType.toLowerCase(), [...VALID_TYPES]);
        if (hint) msg += ` ${hint}`;
        return fail(lineNumber, msg);
      }
      // Fall through — first line might be a data row or option
    }

    // Annotations (#1832, #2039): `marker …`, `band <from>..<to> …`.
    const annotation = parseAnnotationLine(
      trimmed,
      lineNumber,
      result.diagnostics,
      palette
    );
    if (annotation) {
      annotations.push(annotation);
      continue;
    }
    // A malformed one says what it needed. `band 5` (no `..`) is left to
    // parse as a data row named "band".
    const malformed = malformedAnnotation(trimmed);
    if (malformed) {
      result.diagnostics.push(makeDgmoError(lineNumber, malformed, 'warning'));
      continue;
    }
    // The old top-level `note <datum> …` (#2078): a note now sits under its
    // row. The line and its indented body are consumed, and say so.
    const oldNote = parseChartNoteLine(
      lines,
      i,
      0,
      result.diagnostics,
      palette
    );
    if (oldNote) {
      result.diagnostics.push(
        topLevelMoved(
          'note',
          oldNote.note.text.split('\n')[0] ?? '',
          lineNumber,
          oldNote.note.target || '<row>'
        )
      );
      i = oldNote.lastIndex;
      continue;
    }

    // Era line (§1.5 trailing-token):
    //   `era Day 1 -> Day 3 Rough Seas`        (no color)
    //   `era Day 1 -> Day 3 Rough Seas blue`   (trailing color word)
    // Color (if any) is the last whitespace-delimited token of the label.
    const eraMatch = trimmed.match(/^era\s+(.+?)\s*->\s*(.+?)\s*$/);
    if (eraMatch) {
      // Capture group 2 guaranteed present after regex match.
      const afterArrow = eraMatch[2]!.trim();
      const spaceIdx = afterArrow.indexOf(' ');
      if (spaceIdx >= 0) {
        // Peel trailing-token color off the after-arrow label region.
        const lastSpaceIdx = afterArrow.lastIndexOf(' ');
        const trailing = afterArrow.substring(lastSpaceIdx + 1);
        const hasColor = RECOGNIZED_COLOR_NAMES.includes(
          trailing as (typeof RECOGNIZED_COLOR_NAMES)[number]
        );
        const labelPart = hasColor
          ? afterArrow.substring(0, lastSpaceIdx).trimEnd()
          : afterArrow;
        rawEras.push({
          // Capture group 1 guaranteed present after regex match.
          start: eraMatch[1]!.trim(),
          afterArrow: labelPart,
          color: hasColor
            ? (resolveColorWithDiagnostic(
                trailing,
                lineNumber,
                result.diagnostics,
                palette
              ) ?? null)
            : null,
          lineNumber,
        });
      }
      continue;
    }

    // Pie-only directives. Matched case-sensitively on the whole line so a data
    // row labelled "Other 30" or "Sort 5" still parses as data.
    if (trimmed === 'waffle') {
      result.waffle = true;
      waffleLine = lineNumber;
      pieOnlyLines.push([lineNumber, 'waffle']);
      continue;
    }
    // `sort [<series name>] [asc|desc]` (pie, bar — #1978) and the pie-only
    // `other-below`. Matched case-sensitively on the whole line so a data row
    // labelled "Other 30" or "Sort 5" — anything ending in a number — still
    // parses as data.
    const sortMatch = trimmed.match(/^sort(?:\s+(.+))?$/);
    if (sortMatch && !(sortMatch[1] && parseDataRowValues(trimmed))) {
      const words = (sortMatch[1] ?? '').split(/\s+/).filter(Boolean);
      const last = words.at(-1);
      const dir = last === 'asc' || last === 'desc' ? last : undefined;
      if (dir) words.pop();
      result.sort = dir ?? 'desc';
      if (words.length) result.sortSeries = words.join(' ');
      else delete result.sortSeries;
      result.sortLineNumber = lineNumber;
      continue;
    }
    const otherMatch = trimmed.match(/^other-below\s+(\d+(?:\.\d+)?)\s*%?$/);
    if (otherMatch) {
      result.otherBelow = parseFloat(otherMatch[1]!);
      otherLine = lineNumber;
      pieOnlyLines.push([lineNumber, 'other-below']);
      continue;
    }

    // Statistics overlays (#1954): `mean`, `median`, `target N [below]`.
    const overlay = parseOverlayLine(trimmed, lineNumber, result.diagnostics);
    if (overlay) {
      if (overlay !== true) rawOverlays.push(overlay);
      continue;
    }

    // Extract first token to check for known options
    const spaceIdx = trimmed.indexOf(' ');
    const firstToken = (
      spaceIdx >= 0 ? trimmed.substring(0, spaceIdx) : trimmed
    ).toLowerCase();

    // Bare boolean options (e.g. orientation-horizontal)
    if (KNOWN_BOOLEANS.has(firstToken) && spaceIdx < 0) {
      if (firstToken === 'orientation-horizontal') {
        result.orientation = 'horizontal';
        orientationLine = lineNumber;
      } else if (fillModeFromToken(firstToken) !== null) {
        const fm = fillModeFromToken(firstToken)!;
        if (fm === 'tint') delete result.fillMode;
        else result.fillMode = fm;
      } else if (firstToken === 'no-title') {
        result.noTitle = true;
      } else if (firstToken === 'no-legend') {
        result.noLegend = true;
      } else if (firstToken === 'legend-inline') {
        result.legendInline = true;
      } else if (firstToken === 'no-auto-y') {
        result.noAutoY = true;
      } else if (firstToken === 'step' || firstToken === 'step-before') {
        const want = firstToken === 'step' ? 'after' : 'before';
        if (result.step !== undefined && result.step !== want) {
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              '`step` and `step-before` cannot both be set — keep one.',
              'error'
            )
          );
        }
        result.step = want;
        result.stepLineNumber = lineNumber;
      } else if (firstToken === 'lollipop') {
        result.lollipop = true;
        result.lollipopLineNumber = lineNumber;
      } else if (firstToken === 'widths') {
        result.widthsLineNumber = lineNumber;
      } else if (firstToken === 'fill') {
        result.fill = true;
        result.fillLineNumber = lineNumber;
      } else if (firstToken === 'hole') {
        result.hole = DEFAULT_HOLE;
      }
      continue;
    }

    // Frame directives: subtitle, source, footnote, byline (#1827).
    if (parseChartFrameLine(result, lines[i]!, lineNumber, result.diagnostics))
      continue;

    // Number format (#1831): `format …`, `unit …`, `locale …`.
    if (parseNumberFormatLine(trimmed, lineNumber, result, result.diagnostics))
      continue;

    // Axis directives (#1830): `y-scale log`, `y-min N`, `y-max N`.
    if (
      parseAxisLine(
        trimmed,
        lineNumber,
        (result.axes ??= {}),
        AXIS_TYPES[result.type],
        result.diagnostics
      )
    )
      continue;

    // §1.11 emphasis (#1829): `highlight A, B` keeps the named categories,
    // series or slices at full strength and recedes the rest. Only the chart
    // types that adopted it reserve the token; `dim` is not adopted here. The
    // keyword is lowercase, so a category named `Highlight Reel` stays data.
    // A top-level `highlight <name>` is the old form (#2080): the line now
    // sits indented under the row, series or slice it lights.
    if (/^highlight\s/.test(trimmed) && EMPHASIS_TYPES.has(result.type)) {
      const directive = parseEmphasisDirective(trimmed, lineNumber);
      if (directive) {
        result.diagnostics.push(
          topLevelMoved('highlight', '', lineNumber, directive.names[0]!)
        );
        continue;
      }
    }

    // Uncertainty band (#1981): `band <label> <low series> <high series>`.
    // A value band (`band 40..60`) was taken above; a row ending in a number
    // (`band 5`) stays a data row. Names resolve once every series is known.
    if (firstToken === 'band' && spaceIdx >= 0) {
      const tokens = trimmed.split(/\s+/).slice(1);
      if (!isNumericToken(tokens[tokens.length - 1]!)) {
        rawSeriesBands.push({ tokens, lineNumber });
        continue;
      }
    }

    // Fill between two series (#1997): `fill-between A B [ahead] [behind]`.
    if (firstToken === 'fill-between') {
      rawFillBetween.push({
        tokens: spaceIdx >= 0 ? trimmed.split(/\s+/).slice(1) : [],
        lineNumber,
      });
      continue;
    }

    // Known option with a value
    if (KNOWN_OPTIONS.has(firstToken) && spaceIdx >= 0) {
      const value = trimmed.substring(spaceIdx + 1).trim();

      if (firstToken === 'chart') {
        const raw = value.toLowerCase();
        const chartType = raw as ChartType;
        if (VALID_TYPES.has(chartType)) {
          result.type = chartType;
        } else {
          let msg = `Unsupported chart type: ${value}. Supported types: ${[...VALID_TYPES].join(', ')}.`;
          const hint = suggest(raw, [...VALID_TYPES]);
          if (hint) msg += ` ${hint}`;
          return fail(lineNumber, msg);
        }
        continue;
      }

      if (firstToken === 'title') {
        // Removed (decision #48): the chart title is line 1. Error + ignore.
        result.diagnostics.push(emit(TITLE_DIRECTIVE_DX, lineNumber));
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

      if (firstToken === 'y-right-label') {
        result.yrlabel = value;
        result.yrlabelLineNumber = lineNumber;
        continue;
      }

      if (firstToken === 'label') {
        result.label = value;
        continue;
      }

      if (firstToken === 'hole') {
        const ratio = parseFloat(value);
        if (Number.isFinite(ratio) && ratio >= 0 && ratio < 1) {
          result.hole = ratio;
        } else {
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              'hole must be a ratio between 0 and 0.9 (e.g. "hole 0.6"). Using the default.',
              'warning'
            )
          );
          result.hole = DEFAULT_HOLE;
        }
        continue;
      }

      if (firstToken === 'color') {
        const resolvedColor = resolveColorWithDiagnostic(
          value.trim(),
          lineNumber,
          result.diagnostics,
          palette
        );
        if (resolvedColor !== undefined) result.color = resolvedColor;
        continue;
      }

      if (
        firstToken === 'series' ||
        firstToken === 'stack' ||
        firstToken === 'group'
      ) {
        const rejected = rejectSeriesHeader(result, firstToken, lineNumber);
        // `stack diverging` (#1980) and `stack 100%` (#1846) are bare block
        // headers with a mode, not an inline series named after the mode.
        const diverging = firstToken === 'stack' && value === 'diverging';
        const percent = value === '100%' && firstToken !== 'series';
        if (percent && firstToken === 'group')
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              '`group 100%` is not a layout — side-by-side bars have no shares. Use `stack 100%` for bars that each add up to 100%.',
              'error'
            )
          );
        const parsed = parseSeriesNames(
          diverging || percent ? '' : value,
          lines,
          i,
          palette,
          rejected ? undefined : result.diagnostics,
          diverging ? 'neutral' : undefined
        );
        i = parsed.newIndex; // consume the indented block even when rejected
        if (rejected) continue;
        result.series = parsed.series;
        result.seriesLineNumber = lineNumber;
        if (parsed.names.length > 1) {
          result.seriesNames = parsed.names;
          result.seriesNameLineNumbers = parsed.nameLineNumbers;
        }
        if (parsed.nameColors.some(Boolean))
          result.seriesNameColors = parsed.nameColors;
        applySeriesAxes(result, parsed, lineNumber);
        if (firstToken === 'stack' || firstToken === 'group')
          result.barLayout = firstToken;
        layoutHeaders.push({ keyword: firstToken, lineNumber });
        delete result.diverging;
        delete result.neutralSeries;
        delete result.stackPercent;
        if (percent && firstToken === 'stack') result.stackPercent = true;
        if (diverging && result.type === 'bar')
          applyDivergingNeutral(result, parsed, lineNumber);
        else if (diverging)
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              `\`stack diverging\` applies only to bar charts; drawing an ordinary stack on "${result.type}".`,
              'warning'
            )
          );
        continue;
      }
    }

    // Bare boolean options: no-name, no-value, no-percent
    if (firstToken === 'no-name') {
      result.noName = true;
      continue;
    }
    if (firstToken === 'no-value') {
      result.noValue = true;
      continue;
    }
    if (firstToken === 'no-notes') {
      result.noNotes = true;
      continue;
    }
    if (firstToken === 'no-percent') {
      result.noPercent = true;
      continue;
    }
    if (firstToken === 'no-center-total') {
      result.noCenterTotal = true;
      continue;
    }

    // Silent-ignore unrecognized no-* flags (typos, future flags).
    // Per-chart honoring is handled at the renderer; edit-time discovery
    // happens via autocomplete + docs, not parse-time errors.
    if (firstToken.startsWith('no-') && spaceIdx < 0) {
      continue;
    }

    // Bare "series" / "stack" / "group" header — collect indented names.
    if (
      (firstToken === 'series' ||
        firstToken === 'stack' ||
        firstToken === 'group') &&
      spaceIdx === -1
    ) {
      const rejected = rejectSeriesHeader(result, firstToken, lineNumber);
      const parsed = parseSeriesNames('', lines, i, palette);
      i = parsed.newIndex; // consume the indented block even when rejected
      if (rejected) continue;
      result.series = parsed.series;
      result.seriesLineNumber = lineNumber;
      if (parsed.names.length > 1) {
        result.seriesNames = parsed.names;
        result.seriesNameLineNumbers = parsed.nameLineNumbers;
      }
      if (parsed.nameColors.some(Boolean))
        result.seriesNameColors = parsed.nameColors;
      applySeriesAxes(result, parsed, lineNumber);
      if (firstToken === 'stack' || firstToken === 'group')
        result.barLayout = firstToken;
      layoutHeaders.push({ keyword: firstToken, lineNumber });
      delete result.diverging;
      delete result.neutralSeries;
      delete result.stackPercent;
      continue;
    }

    // Clustered-stacked bar (#1879): an unindented line followed by
    // indented rows is a category; each indented row under it is a period.
    const indent = measureIndent(lines[i]!);
    if (result.type === 'bar' && indent === 0) {
      // A category line carries no numbers, and the indented line under it
      // is a period row that does; anything else is not a category.
      const next = nextContentLine(lines, i);
      if (
        next !== null &&
        measureIndent(lines[next]!) > 0 &&
        parseDataRowValues(trimmed) === null &&
        parseDataRowValues(lines[next]!.trim()) !== null
      ) {
        currentCluster = {
          label: trimmed.replace(/^(["'])(.*)\1$/, '$2').trim(),
          lineNumber,
        };
        rawClusters.push(currentCluster);
        continue;
      }
    }
    if (indent === 0) currentCluster = null;

    // Marimekko row (`widths`, #1872): label, the column width, then one
    // segment per `stack` series.
    if (
      result.widthsLineNumber !== undefined &&
      result.type === 'bar' &&
      result.barLayout === 'stack'
    ) {
      const seriesN = result.seriesNames?.length ?? 1;
      const row = parseWidthRow(trimmed, seriesN);
      if (row) {
        const segments = row.values.length;
        if (row.surplus)
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              `"${row.label}" has ${segments + 1 + row.surplus} numbers, but \`widths\` takes one width and ${seriesN} segments. If the label ends in a number, quote it.`,
              'warning'
            )
          );
        else if (segments !== seriesN)
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              `With \`widths\`, the first number is the width, so this row has ${segments} segment${segments === 1 ? '' : 's'} for ${seriesN} series.`,
              'warning'
            )
          );
        const { label: rawLabel, color: pointColor } = extractColor(
          row.label,
          palette,
          result.diagnostics,
          lineNumber
        );
        const [first, ...rest] = row.values;
        result.data.push({
          label: rawLabel,
          value: first ?? 0,
          ...(rest.length > 0 && { extraValues: rest }),
          ...(pointColor && { color: pointColor }),
          lineNumber,
          width: row.width,
          ...(currentCluster && { cluster: currentCluster.label }),
        });
        widthForms.push({ share: row.share, lineNumber });
        if (currentCluster) clusteredRows++;
        else flatRows.push(lineNumber);
        continue;
      }
    }

    // Data row: parse from the right — rightmost numeric token(s) = value(s), everything left = label
    // Supports space-separated multi-values when series are defined: "Jan 100 200 300"
    const seriesCount = result.seriesNames?.length ?? 0;
    const multiValue = seriesCount >= 2;
    const dataValues = parseDataRowValues(trimmed, {
      multiValue,
      ...(multiValue && { expectedValues: seriesCount }),
    });
    if (dataValues) {
      // Surplus numbers: the row ends with more numeric tokens than the chart
      // consumes (one per series, or a single value with no series header), so
      // the extras get absorbed into the label. Warn either way — the
      // single-value case ("Armor 50 60" → axis "Armor 50", value 60) has no
      // series count to check against and would otherwise corrupt an axis label
      // in silence.
      // Only warn in multi-value mode, where the series block fixes an exact
      // expected count and a surplus is genuinely ambiguous. A single-value row
      // like "Day 1 8" or "Q3 2024 40" renders correctly (label "Day 1", value
      // 8) and is the most common axis-labelling pattern there is, so warning on
      // it would be noise on nearly every real line/bar chart.
      // A period row takes exactly one number per series; the rest is its
      // free-text label (`Q1 2025 44 30`, #1879), so it never warns.
      if (multiValue && !currentCluster) {
        const surplus = surplusValueDiagnostic(
          dataValues,
          seriesCount,
          lineNumber
        );
        if (surplus) result.diagnostics.push(surplus);
      }
      const { label: rawLabel, color: pointColor } = extractColor(
        dataValues.label,
        palette,
        result.diagnostics,
        lineNumber
      );
      const [first, ...rest] = dataValues.values;
      // Pie/polar-area/radar encode magnitude (share, radius) — a negative
      // value has no honest visual there. Bars/lines support signed values.
      if (
        result.type === 'pie' ||
        result.type === 'polar-area' ||
        result.type === 'radar'
      ) {
        const neg = dataValues.values.find((v) => v < 0);
        if (neg !== undefined) {
          result.diagnostics.push(
            emit(NEGATIVE_VALUE_DX, lineNumber, {
              value: neg,
              label: rawLabel,
              channel: CHANNEL_NAME[result.type],
            })
          );
          continue;
        }
      }
      result.data.push({
        label: rawLabel,
        // parseDataRowValues guarantees values.length >= 1.
        value: first!,
        ...(rest.length > 0 && { extraValues: rest }),
        ...(pointColor && { color: pointColor }),
        lineNumber,
        ...(currentCluster && { cluster: currentCluster.label }),
      });
      if (currentCluster) clusteredRows++;
      else flatRows.push(lineNumber);
      continue;
    }

    // Catch-all: nothing matched this line. A word that reads like an
    // overlay says which overlays exist (#1954).
    const notOverlay = unknownOverlay(trimmed, lineNumber);
    if (notOverlay) {
      result.diagnostics.push(notOverlay);
      continue;
    }
    let msg = `Unexpected line: '${trimmed}'.`;
    const hint = suggest(firstToken, [...KNOWN_OPTIONS, ...KNOWN_BOOLEANS]);
    if (hint) msg += ` ${hint}`;
    result.diagnostics.push(makeDgmoError(lineNumber, msg, 'warning'));
  }

  // Annotations mark a value axis, which only bar and line have here.
  const anchoredNotes: ChartNote[] = [];
  /** Each note's row, so its index survives `sort` and filtering below. */
  const noteRows: ParsedChart['data'] = [];
  const lit: { name: string; color: string | null; lineNumber: number }[] = [];
  const rowAt = new Map(result.data.map((d, k) => [d.lineNumber, k]));
  const seriesAt = new Map<number, number>();
  // `band <label> <low> <high>` (#1981): a highlight under it lights the band.
  const bandAt = new Map(
    rawSeriesBands
      .filter((b) => b.tokens.length >= 3)
      .map((b) => [b.lineNumber, b.tokens.slice(0, -2).join(' ')])
  );
  // Only the indented block form gives each series a line of its own.
  const nameLines = result.seriesNameLineNumbers ?? [];
  if (new Set(nameLines).size === (result.seriesNames?.length ?? -1))
    nameLines.forEach((ln, s) => seriesAt.set(ln, s));
  const seriesNames = result.seriesNames?.length
    ? result.seriesNames
    : [result.series ?? ''];
  // A plain bar is one series whatever its header says.
  const multiSeries =
    seriesNames.length > 1 &&
    (result.type === 'line' || result.barLayout !== undefined);
  const annotated = result.type === 'bar' || result.type === 'line';
  for (const a of lifted.anchored) {
    const row = rowAt.get(a.anchorLine);
    if (a.keyword === 'highlight') {
      if (!EMPHASIS_TYPES.has(result.type)) {
        warnUnsupported(
          [{ kind: 'highlight', lineNumber: a.lineNumber }],
          'bar, line, pie, scatter and slope charts',
          result.diagnostics
        );
        continue;
      }
      const s = seriesAt.get(a.anchorLine);
      // Line lights a series or a series band; bar and pie a row (bar also
      // a series).
      const name =
        s !== undefined && result.type !== 'pie'
          ? seriesNames[s]
          : row !== undefined && result.type !== 'line'
            ? result.data[row]!.label
            : result.type === 'line'
              ? bandAt.get(a.anchorLine)
              : undefined;
      if (name === undefined) {
        warnNoAnchor(
          a,
          result.type === 'line'
            ? 'a series name in an indented series block, or a series band'
            : result.type === 'pie'
              ? 'a slice'
              : 'a bar row, or a series name in a stack or group block',
          result.diagnostics
        );
        continue;
      }
      lit.push({
        name,
        color: highlightColor(a, result.diagnostics),
        lineNumber: a.lineNumber,
      });
      continue;
    }
    if (!annotated) {
      warnUnsupported(
        [{ kind: a.keyword, lineNumber: a.lineNumber }],
        'bar, line, scatter and slope charts',
        result.diagnostics
      );
      continue;
    }
    if (row === undefined) {
      warnNoAnchor(a, 'a data row', result.diagnostics);
      continue;
    }
    const label = result.data[row]!.label;
    if (a.keyword === 'marker') {
      annotationsFromRows.push(
        anchoredMarker(a.text, label, a.lineNumber, result.diagnostics, palette)
      );
      continue;
    }
    const note = anchoredNoteText(a, result.diagnostics, palette);
    let series = 0;
    let text = note.header;
    if (multiSeries) {
      const hit = leadingName(note.header, seriesNames);
      if (!hit) {
        result.diagnostics.push(
          makeDgmoError(
            a.lineNumber,
            `This note sits on a row of ${seriesNames.length} series — start it with the series it marks: note ${seriesNames[0]} ${note.header || '…'}`,
            'warning'
          )
        );
        continue;
      }
      series = hit.index;
      text = hit.rest;
    }
    const full = [text, note.body].filter(Boolean).join('\n');
    if (!full.trim()) {
      result.diagnostics.push(
        makeDgmoError(
          a.lineNumber,
          'This note has no text — ignored.',
          'warning'
        )
      );
      continue;
    }
    noteRows.push(result.data[row]!);
    anchoredNotes.push({
      series,
      index: row,
      text: full,
      color: note.color,
      lineNumber: a.lineNumber,
    });
  }
  const emphasis = lifted.override ?? anchoredEmphasis(lit);
  if (emphasis) result.emphasis = emphasis;

  if (annotated) {
    const categories = result.data.map((d) => d.label);
    const resolved = [
      ...resolveAnnotations(
        annotations,
        { categories, categoryRows: true },
        result.diagnostics
      ),
      ...annotationsFromRows,
    ];
    if (resolved.length) result.annotations = resolved;
  } else {
    warnUnsupported(
      annotations,
      'bar, line, scatter and slope charts',
      result.diagnostics
    );
  }

  // `sort` orders pie slices and bar categories (#1978); elsewhere it warns.
  if (result.sort && result.type !== 'pie' && result.type !== 'bar') {
    result.diagnostics.push(
      makeDgmoError(
        result.sortLineNumber ?? 1,
        '"sort" is only supported on pie and bar charts; ignoring it.',
        'warning'
      )
    );
    delete result.sort;
  }
  if (result.sortSeries !== undefined && result.type === 'pie') {
    result.diagnostics.push(
      makeDgmoError(
        result.sortLineNumber ?? 1,
        `A pie has no series to sort by — "sort ${result.sortSeries}" sorts the slices by value.`,
        'warning'
      )
    );
    delete result.sortSeries;
  }
  if (result.type !== 'bar') {
    delete result.sortSeries;
    if (result.type !== 'pie') delete result.sortLineNumber;
  }

  // Pie-only directives: warn elsewhere, otherwise bucket small slices and sort.
  if (result.type !== 'pie') {
    for (const [ln, name] of pieOnlyLines) {
      result.diagnostics.push(
        makeDgmoError(
          ln,
          `"${name}" is only supported on pie charts; ignoring it.`,
          'warning'
        )
      );
    }
    delete result.otherBelow;
    delete result.waffle;
  } else {
    if (result.waffle && result.hole !== undefined) {
      result.diagnostics.push(
        makeDgmoError(
          waffleLine,
          '"hole" has no effect on a waffle; ignoring it.',
          'warning'
        )
      );
      delete result.hole;
    }
    if (result.otherBelow !== undefined) {
      const total = result.data.reduce((a, d) => a + d.value, 0);
      const small = result.data.filter(
        (d) => total > 0 && (d.value / total) * 100 < result.otherBelow!
      );
      if (small.length >= 2) {
        const merged = small.reduce((a, d) => a + d.value, 0);
        result.data = [
          ...result.data.filter((d) => !small.includes(d)),
          { label: 'Other', value: merged, lineNumber: otherLine },
        ];
      }
    }
    if (result.sort) {
      const dir = result.sort === 'asc' ? 1 : -1;
      const last = result.otherBelow !== undefined ? result.data.at(-1) : null;
      const keep =
        last?.label === 'Other' && last.lineNumber === otherLine ? last : null;
      const body = keep ? result.data.slice(0, -1) : [...result.data];
      body.sort((a, b) => dir * (a.value - b.value));
      result.data = keep ? [...body, keep] : body;
    }
  }

  // Resolve raw eras against known data labels (longest-prefix match for multi-word labels)
  const knownLabels = new Set(result.data.map((d) => d.label));
  for (const raw of rawEras) {
    // Find the longest prefix of afterArrow that matches a known label
    const words = raw.afterArrow.split(' ');
    let end = '';
    let label = '';
    let matched = false;
    for (let w = words.length - 1; w >= 1; w--) {
      const candidateEnd = words.slice(0, w).join(' ');
      if (knownLabels.has(candidateEnd)) {
        end = candidateEnd;
        label = words.slice(w).join(' ');
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Fallback: first token = end, rest = label
      // String.split always returns at least one element.
      end = words[0]!;
      label = words.slice(1).join(' ');
    }
    parsedEras.push({
      start: raw.start,
      end,
      label,
      color: raw.color,
      lineNumber: raw.lineNumber,
    });
  }

  // Eras span the ordered axis of line and bar charts (#2039).
  if (result.type !== 'line' && result.type !== 'bar') {
    warnUnsupported(
      parsedEras.map((e) => ({ kind: 'era', lineNumber: e.lineNumber })),
      'line and bar charts',
      result.diagnostics
    );
    result.eras = [];
  }

  // Validation
  const warn = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!result.error && result.data.length === 0) {
    warn(1, 'No data points found. Add data in format: Label 123');
  }

  if (!result.error && result.seriesNames) {
    const expectedCount = result.seriesNames.length;
    for (const dp of result.data) {
      const actualCount = 1 + (dp.extraValues?.length ?? 0);
      // A Marimekko row has already warned, and keeps its column (#1872).
      if (dp.width === undefined && actualCount !== expectedCount) {
        warn(
          dp.lineNumber,
          `Data point "${dp.label}" has ${actualCount} value(s), but ${expectedCount} series defined. Each row must have ${expectedCount} values.`
        );
      }
    }
    // Filter out mismatched data points so renderers get clean data
    result.data = result.data.filter((dp) => {
      const actualCount = 1 + (dp.extraValues?.length ?? 0);
      return dp.width !== undefined || actualCount === expectedCount;
    });
  }

  // Dual-axis (§15.1) is only honored by line / multi-line charts. Drop the
  // axis assignment elsewhere so other renderers see plain single-axis data.
  if (!result.error && result.seriesAxes && result.type !== 'line') {
    warn(
      result.seriesLineNumber ?? 1,
      `Dual y-axes (y-right-label) are only supported on line / multi-line charts; ignoring the secondary axis for "${result.type}".`
    );
    delete result.seriesAxes;
    delete result.yrlabel;
  }

  // A right-axis label with nothing assigned to it renders nothing — flag it so
  // the author wraps the intended series in a `y-right-label` group.
  if (
    !result.error &&
    result.yrlabel &&
    !result.seriesAxes?.includes('right')
  ) {
    warn(
      result.yrlabelLineNumber ?? 1,
      `y-right-label is set but no series is assigned to the right axis. Group the series under a "y-right-label" header (see §15.1).`
    );
  }

  if (!result.error && result.widthsLineNumber !== undefined)
    settleWidths(result, widthForms, clusteredRows > 0, warn);

  if (!result.error)
    settleStack(result, layoutHeaders, rawSeriesBands, rawFillBetween);

  if (!result.error && clusteredRows > 0)
    settleClusters(result, rawClusters, flatRows, orientationLine);

  if (rawOverlays.length) {
    const kept = settleOverlays(
      rawOverlays,
      {
        type: result.type,
        stacked:
          result.barLayout === 'stack' || (result.clusters?.length ?? 0) > 0,
        ...(result.barLayout && { layout: result.barLayout }),
      },
      result.diagnostics
    );
    if (kept.length) result.overlays = kept;
    // `pareto` (#1954) sorts the bars largest first and draws columns.
    const pareto = kept.find((o) => o.kind === 'pareto');
    if (pareto) {
      result.sort = 'desc';
      delete result.sortSeries;
      if (result.orientation === 'horizontal') {
        warn(
          pareto.lineNumber,
          '`pareto` draws columns, with its percent axis on the right; ignoring `orientation-horizontal`.'
        );
        delete result.orientation;
      }
    }
  }

  if (!result.error && result.type === 'bar' && result.sort)
    sortBarCategories(result);

  if (!result.error) settleChartAxes(result);

  // `lollipop` redraws bars as stems and dots (#1979). A stack has no single
  // value per bar for a dot to mark, so the pair is an error.
  if (result.lollipop) {
    const ln = result.lollipopLineNumber ?? 1;
    if (result.type !== 'bar') {
      warn(
        ln,
        `\`lollipop\` applies only to bar charts; ignoring it on "${result.type}".`
      );
      delete result.lollipop;
    } else if (result.barLayout === 'stack') {
      result.diagnostics.push(
        makeDgmoError(
          ln,
          '`lollipop` cannot draw a `stack` — a stacked bar has no single value for the dot. Use `group`, or remove `lollipop`.',
          'error'
        )
      );
      delete result.lollipop;
    }
  }

  if (!result.error) settleSeriesFills(result, rawSeriesBands, rawFillBetween);

  // `step` and `step-before` draw a line's segments (#1880); nowhere else.
  if (result.step !== undefined && result.type !== 'line') {
    warn(
      result.stepLineNumber ?? 1,
      `\`${result.step === 'after' ? 'step' : 'step-before'}\` applies only to line charts; ignoring it on "${result.type}".`
    );
    delete result.step;
  }

  // Notes point at rows; `sort` and the settle steps above may have moved
  // or dropped them since (#2078).
  const notes = anchoredNotes.flatMap((n, k) => {
    const index = result.data.indexOf(noteRows[k]!);
    return index < 0 ? [] : [{ ...n, index }];
  });
  if (notes.length) result.notes = notes;

  return result;
}

/**
 * Stacked area and `stack 100%` (#1846). A line chart's `stack` block draws
 * each series on top of the one below; `stack 100%` (bar or line) draws each
 * x position as shares of its total. Rejects what a stack cannot show:
 * negative values in a stacked area or a 100% stack, a second axis, and a
 * `series` block beside the `stack` block.
 */
function settleStack(
  result: ParsedChart,
  headers: readonly { keyword: string; lineNumber: number }[],
  rawBands: { tokens: string[]; lineNumber: number }[],
  rawFills: { tokens: string[]; lineNumber: number }[]
): void {
  if (result.barLayout !== 'stack') {
    delete result.stackPercent;
    return;
  }
  const area = result.type === 'line';
  const err = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'error'));
  };
  if (area) {
    const series = headers.find((h) => h.keyword === 'series');
    const stack = headers.find((h) => h.keyword === 'stack');
    if (series && stack)
      err(
        Math.max(series.lineNumber, stack.lineNumber),
        'A line chart takes a `series` block or a `stack` block, not both. `stack` draws stacked areas; keep one.'
      );
    if (result.yrlabel !== undefined || result.seriesAxes) {
      err(
        result.yrlabelLineNumber ?? result.seriesLineNumber ?? 1,
        'A stacked area has one value axis, so it cannot take `y-right-label`. Remove it, or use a `series` block for two axes.'
      );
      delete result.yrlabel;
      delete result.seriesAxes;
    }
    for (const r of rawBands)
      err(
        r.lineNumber,
        'A series band cannot be drawn on a stacked area, because each band already sits on the one below. Use a `series` block for bands.'
      );
    for (const r of rawFills)
      err(
        r.lineNumber,
        '`fill-between` cannot be drawn on a stacked area, because the areas already touch. Use a `series` block for `fill-between`.'
      );
    rawBands.length = 0;
    rawFills.length = 0;
  }
  if (!area && !result.stackPercent) return;
  // A stacked area or a share of a total has no honest place for a negative
  // value. (A plain stacked bar draws negatives below zero, §15.1.)
  const names = result.seriesNames ?? [result.series ?? ''];
  const channel = result.stackPercent ? '100% stacks' : 'stacked areas';
  result.data = result.data.filter((d) => {
    const values = [d.value, ...(d.extraValues ?? [])];
    const s = values.findIndex((v) => v < 0);
    if (s < 0) return true;
    const series = names[s];
    result.diagnostics.push({
      ...emit(NEGATIVE_VALUE_DX, d.lineNumber, {
        value: values[s]!,
        label: [d.cluster, d.label, series].filter(Boolean).join(' · '),
        channel,
      }),
      hint: result.stackPercent
        ? 'A share of a total cannot be negative. Restate the value as a positive amount, or use `stack` without `100%` on a bar chart, which draws negatives below zero.'
        : 'A stacked area cannot be negative. Restate the value as a positive amount, use a `series` block for lines that cross zero, or a stacked bar, which draws negatives below zero.',
    });
    return false;
  });
}

/** Index of the next non-blank, non-comment line after `i`, or null. */
function nextContentLine(lines: readonly string[], i: number): number | null {
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j]!.trim();
    if (t && !t.startsWith('//')) return j;
  }
  return null;
}

/**
 * Marimekko (`widths`, #1872): a stacked `bar` whose first number on each
 * row is its column's width. Every column fills to 100%, so it rides on
 * `stack 100%` and inherits its negatives rule. Message wording follows the
 * owner-confirmed syntax page (ecosystem docs mockup 2026-11-12).
 */
function settleWidths(
  result: ParsedChart,
  forms: readonly { share: boolean; lineNumber: number }[],
  clustered: boolean,
  warn: (line: number, message: string) => void
): void {
  const ln = result.widthsLineNumber!;
  const err = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'error'));
  };
  if (result.type !== 'bar') {
    warn(
      ln,
      `\`widths\` applies only to bar charts; ignoring it on "${result.type}".`
    );
    return;
  }
  if (result.barLayout === 'group')
    return err(ln, '`widths` needs `stack`, not `group`.');
  if (result.barLayout !== 'stack')
    return err(
      ln,
      '`widths` needs a `stack` block — a Marimekko stacks every column to 100%.'
    );
  if (result.orientation === 'horizontal')
    return err(
      ln,
      '`widths` draws columns only. Remove `orientation-horizontal`.'
    );
  if (result.diverging)
    return err(ln, '`widths` cannot draw `stack diverging`. Use `stack`.');
  if (clustered)
    return err(
      ln,
      '`widths` cannot be grouped by category. Write the rows flat, one column each.'
    );
  if (forms.length === 0) return;
  let ok = true;
  for (const d of result.data)
    if (!(d.width! > 0)) {
      err(d.lineNumber, 'A column width must be more than 0.');
      ok = false;
    }
  const share = forms[0]!.share;
  const odd = forms.find((f) => f.share !== share);
  if (odd) {
    err(
      odd.lineNumber,
      'Mix of shares and sizes. Write every width as a share (`42%`) or every one as a size (`105`).'
    );
    ok = false;
  }
  if (ok && share) {
    const sum = result.data.reduce((a, d) => a + d.width!, 0);
    if (Math.abs(sum - 100) > 0.5) {
      err(
        ln,
        `The widths add up to ${Math.round(sum * 10) / 10}%. Shares must add up to 100%, or drop the \`%\` to use sizes.`
      );
      ok = false;
    }
  }
  if (!ok) return;
  result.widths = share ? 'share' : 'size';
  result.stackPercent = true;
}

/**
 * A Marimekko row: the trailing numbers are the width then one segment per
 * series. The width may carry `%` (a share). Takes at most `series + 1`
 * numbers from the right, so a label may end in a number; any further ones
 * stay in the label and are reported as `surplus`.
 */
function parseWidthRow(
  line: string,
  series: number
): {
  label: string;
  width: number;
  share: boolean;
  values: number[];
  surplus: number;
} | null {
  const quoted = line.match(/^(["'])(.*?)\1\s+(\S.*)$/);
  const head = quoted ? [quoted[2]!.trim()] : [];
  const tokens = quoted ? quoted[3]!.trim().split(/\s+/) : line.split(/\s+/);
  const minIndex = quoted ? 0 : 1;
  const num = (tok: string): { v: number; pct: boolean } | null => {
    const pct = tok.endsWith('%');
    const body = pct ? tok.slice(0, -1) : tok;
    const norm = normalizeNumericToken(body) ?? body;
    const v = parseFloat(norm);
    return isNaN(v) || !isFinite(Number(norm)) ? null : { v, pct };
  };
  let start = tokens.length;
  while (start > minIndex && num(tokens[start - 1]!)) start--;
  if (quoted && start > 0) return null;
  const run = tokens.length - start;
  if (run === 0) return null;
  const take = Math.min(run, series + 1);
  const taken = tokens.slice(tokens.length - take).map((t) => num(t)!);
  const label = quoted
    ? head[0]!
    : tokens.slice(0, tokens.length - take).join(' ');
  if (!label) return null;
  const [w, ...segs] = taken;
  return {
    label,
    width: w!.v,
    share: w!.pct,
    values: segs.map((s) => s.v),
    surplus: run - take,
  };
}

/**
 * Clustered-stacked bar (#1879): rows indented under category lines. Each
 * category draws one stack per period; periods line up across categories
 * in order of first appearance. Needs a `stack` block.
 */
function settleClusters(
  result: ParsedChart,
  rawClusters: readonly ChartCluster[],
  flatRows: readonly number[],
  orientationLine: number
): void {
  const err = (line: number, message: string, sev: 'error' | 'warning') => {
    result.diagnostics.push(makeDgmoError(line, message, sev));
  };
  const first = rawClusters[0]!;
  if (result.barLayout !== 'stack') {
    err(
      first.lineNumber,
      `Rows indented under "${first.label}" draw stacks grouped by category, which need a \`stack\` block. Add one, or write the rows flat.`,
      'error'
    );
    return;
  }
  if (result.diverging) {
    err(
      first.lineNumber,
      '`stack diverging` cannot be grouped by category. Write the rows flat, or use `stack`.',
      'error'
    );
    return;
  }
  for (const line of flatRows)
    err(
      line,
      'This row has no category, but other rows are indented under categories. Indent it under one.',
      'error'
    );
  result.data = result.data.filter((d) => d.cluster !== undefined);
  // A category line with no row left under it draws nothing.
  const used = new Set(result.data.map((d) => d.cluster));
  const clusters: ChartCluster[] = [];
  const seenCluster = new Set<string>();
  for (const c of rawClusters) {
    if (!used.has(c.label)) {
      err(
        c.lineNumber,
        `"${c.label}" has no rows with values under it.`,
        'warning'
      );
      continue;
    }
    if (seenCluster.has(c.label)) {
      err(
        c.lineNumber,
        `"${c.label}" is written twice. Its rows are drawn together, under the first one.`,
        'warning'
      );
      continue;
    }
    seenCluster.add(c.label);
    clusters.push(c);
  }
  // One column per period in each category: a repeat is dropped.
  const seen = new Set<string>();
  result.data = result.data.filter((d) => {
    const key = `${d.cluster}\u0000${d.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      return true;
    }
    err(
      d.lineNumber,
      `"${d.label}" appears twice under "${d.cluster}"; keeping the first.`,
      'warning'
    );
    return false;
  });
  const periods: string[] = [];
  for (const d of result.data)
    if (!periods.includes(d.label)) periods.push(d.label);
  result.clusters = clusters;
  result.periods = periods;
  if (result.sort) {
    err(
      result.sortLineNumber ?? 1,
      '`sort` does not reorder stacks grouped by category; keeping source order.',
      'warning'
    );
    delete result.sort;
    delete result.sortSeries;
  }
  if (result.orientation === 'horizontal') {
    err(
      orientationLine,
      'Stacks grouped by category draw as columns; ignoring `orientation-horizontal`.',
      'warning'
    );
    delete result.orientation;
  }
}

/**
 * `stack diverging` (#1980): pick the neutral series. One `neutral` flag
 * names it; more than one is an error (the first wins). With no flag, an
 * odd count makes the middle series neutral and an even count splits
 * between the two middle series.
 */
function applyDivergingNeutral(
  result: ParsedChart,
  parsed: ReturnType<typeof parseSeriesNames>,
  lineNumber: number
): void {
  result.diverging = true;
  const flagged = parsed.flagged ?? [];
  if (flagged.length > 1) {
    result.diagnostics.push(
      makeDgmoError(
        parsed.nameLineNumbers[flagged[1]!] ?? lineNumber,
        `Only one series can be \`neutral\` in a \`stack diverging\` — ${flagged
          .map((f) => `"${parsed.names[f]}"`)
          .join(', ')} are all flagged. Keep one.`,
        'error'
      )
    );
  }
  const count = parsed.names.length;
  if (flagged.length) result.neutralSeries = flagged[0]!;
  else if (count % 2 === 1) result.neutralSeries = (count - 1) / 2;
}

/**
 * Bar `sort` (#1978): order the categories by one number each — the value
 * (single series), the named series, the first series (`group`), or the
 * total (`stack`). Ties keep source order.
 */
function sortBarCategories(result: ParsedChart): void {
  const names = result.seriesNames ?? [];
  const multi = names.length > 1;
  let index: number | null = null;
  if (result.sortSeries !== undefined) {
    const want = result.sortSeries;
    const known = multi ? names : [result.series ?? ''];
    let at = known.indexOf(want);
    if (at < 0)
      at = known.findIndex((n) => n.toLowerCase() === want.toLowerCase());
    if (at >= 0) index = at;
    else {
      let msg = `"sort ${want}": no series named "${want}"; sorting by the ${
        multi && result.barLayout === 'stack' ? 'total' : 'first series'
      }.`;
      const hint = suggest(want, known.filter(Boolean));
      if (hint) msg += ` ${hint}`;
      result.diagnostics.push(
        makeDgmoError(result.sortLineNumber ?? 1, msg, 'warning')
      );
    }
  }
  const values = (d: ChartDataPoint) => [d.value, ...(d.extraValues ?? [])];
  const key = (d: ChartDataPoint): number => {
    if (index !== null) return values(d)[index] ?? 0;
    if (multi && result.barLayout === 'stack')
      return values(d).reduce(
        (a, v) => a + (result.diverging ? Math.abs(v) : v),
        0
      );
    return d.value;
  };
  const dir = result.sort === 'asc' ? 1 : -1;
  result.data = [...result.data].sort((a, b) => dir * (key(a) - key(b)));
}

/** The numeric axes each simple chart type has (#1830). */
const AXIS_TYPES: Record<ChartType, ReadonlySet<AxisName>> = {
  bar: new Set(['y']),
  line: new Set(['y']),
  pie: new Set(),
  'polar-area': new Set(),
  radar: new Set(),
};

/** Check the axis directives against the values each axis has to show. */
function settleChartAxes(result: ParsedChart): void {
  const y = result.axes?.y;
  if (!y) return;
  const rows = result.data.map((d) => [d.value, ...(d.extraValues ?? [])]);
  let values: number[];
  if (result.barLayout === 'stack' && result.stackPercent) {
    // A 100% stack's axis is fixed at 0–100% (#1846).
    result.diagnostics.push(
      makeDgmoError(
        y.lineNumber ?? 1,
        'A `stack 100%` axis always reads 0–100%, so `y-scale`, `y-min` and `y-max` do nothing here; ignoring them.',
        'warning'
      )
    );
    delete result.axes!.y;
    return;
  }
  if (
    (result.type === 'bar' || result.type === 'line') &&
    result.barLayout === 'stack'
  ) {
    if (y.scale === 'log') {
      result.diagnostics.push(
        emit(AXIS_DIRECTIVE_DX, y.lineNumber ?? 1, {
          directive: 'y-scale',
          reason: `a stacked ${result.type === 'line' ? 'area' : 'bar'} cannot use a log scale, because its segments would not add up`,
        })
      );
      delete y.scale;
    }
    values = result.diverging
      ? rows.flatMap((r) => {
          const spans = divergingSpans(r, result.neutralSeries);
          return [
            Math.min(0, ...spans.map((s) => s[0])),
            Math.max(0, ...spans.map((s) => s[1])),
          ];
        })
      : rows
          .flatMap((r) => [
            r.filter((v) => v > 0).reduce((a, b) => a + b, 0),
            r.filter((v) => v < 0).reduce((a, b) => a + b, 0),
          ])
          .filter((v, i) => i % 2 === 0 || v < 0);
  } else if (result.type === 'line' && result.seriesAxes) {
    const axes = result.seriesAxes;
    values = rows.flatMap((r) => r.filter((_, s) => axes[s] !== 'right'));
  } else {
    values = rows.flat();
  }
  settleAxisSpec('y', y, values, result.diagnostics);
}

// ============================================================
// Data Row Parser
// ============================================================

/**
 * Parse a data row line: everything before the last numeric token(s) is the label,
 * numeric tokens at the end are the values. Values are space-separated.
 *
 * Examples:
 *   "Jan 120"             → { label: "Jan", values: [120] }
 *   "North America 250"   → { label: "North America", values: [250] }
 *   "Q1 10 20 30"         → { label: "Q1", values: [10, 20, 30] }
 *   "Revenue 1_000"       → { label: "Revenue", values: [1000] }
 *   '"Wi-Fi 6" 70 80'     → { label: "Wi-Fi 6", values: [70, 80], quotedLabel: true }
 *
 * A fully-quoted leading label is taken verbatim (quotes stripped) and is never
 * eligible for value peeling — the escape hatch for labels that end in a digit
 * (`"Wi-Fi 6"`, `"Layer 3"`), mirroring the treemap leaf rule.
 *
 * `trailingNumericCount` reports how many consecutive numeric tokens the row
 * actually ends with, which may exceed `values.length` when `expectedValues`
 * caps the walk. Callers use it to flag an over-long row instead of silently
 * absorbing the surplus numbers into the label.
 *
 * Returns null if the line has no numeric value at the end.
 */
export function parseDataRowValues(
  line: string,
  options?: {
    multiValue?: boolean;
    expectedValues?: number;
  }
): {
  label: string;
  values: number[];
  /** Label prefix with every trailing numeric token removed (diagnostics use
   *  this so the message names "Armor", not the corrupted "Armor 50 60"). */
  bareLabel: string;
  trailingNumericCount: number;
  quotedLabel: boolean;
} | null {
  // A fully-quoted leading label fixes the label/value boundary explicitly, so
  // the numeric walk below only ever sees the value region.
  const quoted = line.match(/^(["'])(.*?)\1\s+(\S.*)$/);
  if (quoted) {
    // Capture groups 2 and 3 are non-optional in the pattern.
    const label = quoted[2]!.trim();
    if (!label) return null;
    const valueTokens = quoted[3]!.trim().split(/\s+/);
    const numeric = trailingNumerics(valueTokens, 0);
    // Everything after a quoted label must be values — a stray word means the
    // row isn't a data row at all.
    if (numeric.length !== valueTokens.length) return null;
    const limit = options?.multiValue
      ? (options.expectedValues ?? Infinity)
      : 1;
    return {
      label,
      values: numeric.slice(0, limit),
      bareLabel: label,
      trailingNumericCount: numeric.length,
      quotedLabel: true,
    };
  }

  // Values are space-separated.
  // When multiValue is enabled, walk backward collecting consecutive numeric tokens.
  // Otherwise (default), take only the last token — preserving labels that contain
  // numbers (e.g., "Region 5 300" → label "Region 5", value 300).
  const tokens = line.split(/\s+/);
  if (tokens.length < 2) return null;

  // Trailing numeric run, never consuming token 0 (a row always keeps a label).
  const numeric = trailingNumerics(tokens, 1);
  if (numeric.length === 0) return null;
  const bareLabel = tokens.slice(0, tokens.length - numeric.length).join(' ');

  if (options?.multiValue) {
    const limit = options.expectedValues ?? Infinity;
    // Only the last `limit` numbers are values; any surplus stays in the label.
    // `trailingNumericCount` lets the caller flag that surplus rather than let
    // it corrupt the label silently.
    const take = Math.min(numeric.length, limit);
    const values = numeric.slice(numeric.length - take);
    const label = tokens.slice(0, tokens.length - take).join(' ');
    if (!label) return null;
    return {
      label,
      values,
      bareLabel,
      trailingNumericCount: numeric.length,
      quotedLabel: false,
    };
  }

  // Single-value mode: only the last space-separated token
  // tokens.length >= 2 by the earlier length check.
  const label = tokens.slice(0, -1).join(' ');
  if (!label) return null;

  return {
    label,
    // numeric.length >= 1 by the guard above.
    values: [numeric[numeric.length - 1]!],
    bareLabel,
    trailingNumericCount: numeric.length,
    quotedLabel: false,
  };
}

/**
 * A data row whose label ends in a digit is ambiguous: `Armor 50 60` could mean
 * label "Armor 50" value 60, or "Armor" with a stray extra number. The parser
 * resolves it by taking the last `expectedValues` numbers and welding the
 * surplus into the label — silently. This returns a warning (nudging the quoted
 * escape hatch, `"Armor 50" 60`) whenever that welding actually happened, so a
 * mislabeled axis can't slip through unnoticed.
 *
 * Shared by every single- and multi-value data-chart caller so the two modes
 * flag the same corruption identically. A quoted label has an explicit
 * label/value boundary and is never ambiguous, so it never warns. Returns null
 * when there is nothing to flag.
 */
export function surplusValueDiagnostic(
  row: NonNullable<ReturnType<typeof parseDataRowValues>>,
  expectedValues: number,
  lineNumber: number
): DgmoError | null {
  if (row.quotedLabel || row.trailingNumericCount <= expectedValues)
    return null;
  const expectation =
    expectedValues === 1
      ? 'but only 1 value is expected'
      : `but ${expectedValues} series defined`;
  return makeDgmoError(
    lineNumber,
    `Data point "${row.bareLabel}" has ${row.trailingNumericCount} value(s), ${expectation}. If the label ends in a number, quote it: "${row.label}" ${row.values.join(' ')}`,
    'warning'
  );
}

/**
 * Consecutive numeric tokens at the end of `tokens`, in source order. Stops
 * before index `minIndex` so callers can reserve leading tokens for the label.
 */
function trailingNumerics(tokens: string[], minIndex: number): number[] {
  const values: number[] = [];
  for (let idx = tokens.length - 1; idx >= minIndex; idx--) {
    // In-bounds by the loop guard.
    const tok = tokens[idx]!;
    const normTok = normalizeNumericToken(tok) ?? tok;
    const num = parseFloat(normTok);
    if (isNaN(num) || !isFinite(Number(normTok))) break;
    values.unshift(num);
  }
  return values;
}

/** True when `tok` reads as a data value (`5`, `1_000`, `-2.5`). */
function isNumericToken(tok: string): boolean {
  const norm = normalizeNumericToken(tok) ?? tok;
  return !isNaN(parseFloat(norm)) && isFinite(Number(norm));
}

/**
 * Split `tokens` into two declared series names, first then second. Series
 * names may hold spaces, so every boundary is tried. Returns the indices, or
 * null when no split names two declared series.
 */
function splitTwoSeries(
  tokens: readonly string[],
  index: ReadonlyMap<string, number>
): [number, number] | null {
  for (let k = 1; k < tokens.length; k++) {
    const a = index.get(tokens.slice(0, k).join(' ').toLowerCase());
    const b = index.get(tokens.slice(k).join(' ').toLowerCase());
    if (a !== undefined && b !== undefined) return [a, b];
  }
  return null;
}

/**
 * Resolve `band <label> <low> <high>` (#1981) and `fill-between A B [ahead]
 * [behind]` (#1997) against the declared series. Both are line-only; a name
 * that is not a declared series is an error and drops the line.
 */
function settleSeriesFills(
  result: ParsedChart,
  rawBands: readonly { tokens: string[]; lineNumber: number }[],
  rawFills: readonly { tokens: string[]; lineNumber: number }[]
): void {
  if (rawBands.length === 0 && rawFills.length === 0) return;
  const err = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'error'));
  };
  if (result.type !== 'line') {
    for (const r of rawBands)
      result.diagnostics.push(
        makeDgmoError(
          r.lineNumber,
          `A series band applies only to line charts; ignoring it on "${result.type}".`,
          'warning'
        )
      );
    for (const r of rawFills)
      result.diagnostics.push(
        makeDgmoError(
          r.lineNumber,
          `\`fill-between\` applies only to line charts; ignoring it on "${result.type}".`,
          'warning'
        )
      );
    return;
  }
  const names = result.seriesNames ?? (result.series ? [result.series] : []);
  const index = new Map(names.map((n, i) => [n.toLowerCase(), i] as const));
  const unknown = (tokens: readonly string[]): string => {
    const missing = tokens.filter((t) => !index.has(t.toLowerCase()));
    const listed = (missing.length ? missing : tokens)
      .map((t) => `"${t}"`)
      .join(' and ');
    const hint = missing.length === 1 ? suggest(missing[0]!, names) : null;
    return `${listed} ${missing.length > 1 ? 'are not declared series' : 'is not a declared series'}.${hint ? ` ${hint}` : ''}`;
  };

  const bands: SeriesBand[] = [];
  for (const { tokens, lineNumber } of rawBands) {
    let found: SeriesBand | null = null;
    // The label leads; the last two names are the bounds.
    for (let i = tokens.length - 2; i >= 1 && !found; i--) {
      const pair = splitTwoSeries(tokens.slice(i), index);
      if (pair)
        found = {
          label: tokens.slice(0, i).join(' '),
          low: pair[0],
          high: pair[1],
          lineNumber,
        };
    }
    if (found) bands.push(found);
    else if (tokens.length < 3)
      err(
        lineNumber,
        'A series band needs a label and two series — band Forecast Low High.'
      );
    else err(lineNumber, `band: ${unknown(tokens.slice(-2))}`);
  }
  if (bands.length) result.seriesBands = bands;

  const fills: FillBetween[] = [];
  for (const { tokens, lineNumber } of rawFills) {
    let found: FillBetween | null = null;
    // Up to two trailing colour words; the rest names A then B.
    for (let c = Math.min(2, tokens.length - 2); c >= 0 && !found; c--) {
      const colours = tokens
        .slice(tokens.length - c)
        .map((t) => t.toLowerCase());
      if (
        !colours.every((t) =>
          RECOGNIZED_COLOR_NAMES.includes(
            t as (typeof RECOGNIZED_COLOR_NAMES)[number]
          )
        )
      )
        continue;
      const pair = splitTwoSeries(tokens.slice(0, tokens.length - c), index);
      if (pair)
        found = {
          a: pair[0],
          b: pair[1],
          ahead: colours[0] ?? 'green',
          behind: colours[1] ?? 'red',
          lineNumber,
        };
    }
    if (found) fills.push(found);
    else if (tokens.length < 2)
      err(
        lineNumber,
        '`fill-between` needs two series — fill-between Actual Plan green red.'
      );
    else {
      let end = tokens.length;
      while (
        end > 2 &&
        RECOGNIZED_COLOR_NAMES.includes(
          tokens[
            end - 1
          ]!.toLowerCase() as (typeof RECOGNIZED_COLOR_NAMES)[number]
        )
      )
        end--;
      err(
        lineNumber,
        `fill-between: ${unknown(tokens.slice(0, Math.min(end, 2)))}`
      );
    }
  }
  if (fills.length) {
    result.fillBetween = fills;
    if (result.fill) {
      err(
        result.fillLineNumber ?? fills[0]!.lineNumber,
        '`fill` and `fill-between` cannot both be set — keep one. Ignoring `fill`.'
      );
      delete result.fill;
    }
  }
}
