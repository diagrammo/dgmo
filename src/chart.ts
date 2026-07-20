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
}

export interface ChartEra {
  start: string; // exact category label, e.g. "'77"
  end: string; // exact category label, e.g. "'81"
  label: string; // display name, e.g. "Carter"
  color: string | null; // resolved CSS color, or null → palette default
  lineNumber: number;
}

import type { DgmoError } from './diagnostics';

export interface ParsedChart {
  type: ChartType;
  title?: string;
  titleLineNumber?: number;
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
  /** Bar multi-series layout, set by a `stack` or `group` block header
   *  (consolidation #24). Absent ⇒ single-series bar. Drives stacked vs
   *  clustered rendering in `charts-d3/bar.ts`. */
  barLayout?: 'stack' | 'group';
  /** Pie hole inner-radius ratio (0–0.9), set by a `hole` directive
   *  (bare ⇒ default). Absent ⇒ solid pie. (#23) */
  hole?: number;
  /** Suppress the pie center total (bare `no-center-total`). The total
   *  shows by default whenever a hole is present. (#23) */
  noCenterTotal?: boolean;
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
  /** Line only: opt out of the data-driven y-axis auto-fit and anchor the
   *  baseline at 0 (magnitude honesty / old ECharts-parity behavior). By
   *  default a line chart fits a padded data-min→max window (§15.1). */
  noAutoY?: boolean;
  data: ChartDataPoint[];
  eras?: ChartEra[];
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
} from './diagnostics';
import {
  detectBadChartTypeDeclaration,
  extractColor,
  fillModeFromToken,
  GLOBAL_BOOLEANS,
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
  'no-auto-y',
  'fill',
  'hole',
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
 * Emits a warning (but proceeds) for `stack`/`group` on a non-bar chart.
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
  if ((keyword === 'stack' || keyword === 'group') && result.type !== 'bar') {
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
  const lines = content.split('\n');
  const parsedEras: ChartEra[] = [];
  const rawEras: {
    start: string;
    afterArrow: string;
    color: string | null;
    lineNumber: number;
  }[] = [];
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

    // Extract first token to check for known options
    const spaceIdx = trimmed.indexOf(' ');
    const firstToken = (
      spaceIdx >= 0 ? trimmed.substring(0, spaceIdx) : trimmed
    ).toLowerCase();

    // Bare boolean options (e.g. orientation-horizontal)
    if (KNOWN_BOOLEANS.has(firstToken) && spaceIdx < 0) {
      if (firstToken === 'orientation-horizontal') {
        result.orientation = 'horizontal';
      } else if (fillModeFromToken(firstToken) !== null) {
        const fm = fillModeFromToken(firstToken)!;
        if (fm === 'tint') delete result.fillMode;
        else result.fillMode = fm;
      } else if (firstToken === 'no-title') {
        result.noTitle = true;
      } else if (firstToken === 'no-legend') {
        result.noLegend = true;
      } else if (firstToken === 'no-auto-y') {
        result.noAutoY = true;
      } else if (firstToken === 'fill') {
        result.fill = true;
      } else if (firstToken === 'hole') {
        result.hole = DEFAULT_HOLE;
      }
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
        const parsed = parseSeriesNames(
          value,
          lines,
          i,
          palette,
          rejected ? undefined : result.diagnostics
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
      continue;
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
      // Surplus numbers: the row ends with more numeric tokens than there are
      // series, so the extras get absorbed into the label ("Armor 50 60 70 80"
      // → label "Armor 50 60"). Too-few already warns below; warn here too so
      // the asymmetry can't corrupt an axis label in silence. A quoted label
      // has an explicit boundary, so it is never ambiguous.
      if (
        multiValue &&
        !dataValues.quotedLabel &&
        dataValues.trailingNumericCount > seriesCount
      ) {
        result.diagnostics.push(
          makeDgmoError(
            lineNumber,
            `Data point "${dataValues.bareLabel}" has ${dataValues.trailingNumericCount} value(s), but ${seriesCount} series defined. If the label ends in a number, quote it: "${dataValues.label}" ${dataValues.values.join(' ')}`,
            'warning'
          )
        );
      }
      const { label: rawLabel, color: pointColor } = extractColor(
        dataValues.label,
        palette,
        result.diagnostics,
        lineNumber
      );
      const [first, ...rest] = dataValues.values;
      result.data.push({
        label: rawLabel,
        // parseDataRowValues guarantees values.length >= 1.
        value: first!,
        ...(rest.length > 0 && { extraValues: rest }),
        ...(pointColor && { color: pointColor }),
        lineNumber,
      });
      continue;
    }

    // Catch-all: nothing matched this line
    let msg = `Unexpected line: '${trimmed}'.`;
    const hint = suggest(firstToken, [...KNOWN_OPTIONS, ...KNOWN_BOOLEANS]);
    if (hint) msg += ` ${hint}`;
    result.diagnostics.push(makeDgmoError(lineNumber, msg, 'warning'));
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

  // Eras are only valid for line charts (incl. filled/area and multi-series).
  if (result.type !== 'line') {
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
      if (actualCount !== expectedCount) {
        warn(
          dp.lineNumber,
          `Data point "${dp.label}" has ${actualCount} value(s), but ${expectedCount} series defined. Each row must have ${expectedCount} values.`
        );
      }
    }
    // Filter out mismatched data points so renderers get clean data
    result.data = result.data.filter((dp) => {
      const actualCount = 1 + (dp.extraValues?.length ?? 0);
      return actualCount === expectedCount;
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

  return result;
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
