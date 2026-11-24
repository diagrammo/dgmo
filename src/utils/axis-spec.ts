// ============================================================
// The axis line — `x-axis | y-axis | y-right-axis [label] [range] [scale]`
// (decision #60, #2115). One line sets an axis's title, range and scale:
// `y-axis Range (yards) 0.1..100,000 log`. Shared by the bar/line parser
// (chart.ts), the extended parser (scatter, function) and the
// visualizations parser (slope). Renderers read the range and scale through
// `buildValueAxis` in charts-d3/value-axis.ts.
// ============================================================

import { emit, type DgmoError, type DiagnosticSpec } from '../diagnostics';

export type AxisName = 'x' | 'y' | 'y-right';
export type AxisScaleKind = 'linear' | 'log';

/** What the author asked of one numeric axis. Every field is optional. */
export interface AxisSpec {
  scale?: AxisScaleKind;
  min?: number;
  max?: number;
  /** Line of the axis directive, for data-check diagnostics. */
  lineNumber?: number;
}

export type AxisSpecs = Partial<Record<AxisName, AxisSpec>>;

export const AXIS_DIRECTIVE_DX: DiagnosticSpec = {
  code: 'W_AXIS_DIRECTIVE_INVALID',
  severity: 'warning',
  chartType: null,
  title: 'Axis directive not applied',
  message: (p) =>
    `${p.directive ?? 'y-axis'}: ${p.reason ?? 'this chart type has no numeric x-axis'} — the range and scale are ignored.`,
  hint: 'Write the axis as `y-axis <title> <min>..<max> <log|linear>`; every part is optional. A range or scale on x works only where the x-axis is numeric (scatter, function).',
  example: 'bar Sales\nx-axis 0..10\nQ1 100',
};

export const AXIS_LOG_NOT_POSITIVE_DX: DiagnosticSpec = {
  code: 'W_AXIS_LOG_NOT_POSITIVE',
  severity: 'warning',
  chartType: null,
  title: 'Log axis with zero or negative values',
  message: (p) =>
    `${p.axis ?? 'y'}-axis log needs every value above 0, but ${p.value ?? 0} is not — the axis stays linear.`,
  hint: 'Remove the zero or negative values, or drop the log scale.',
  example: 'line Users\ny-axis log\nJan 0\nFeb 1000',
};

export const AXIS_OUTSIDE_RANGE_DX: DiagnosticSpec = {
  code: 'W_AXIS_DATA_OUTSIDE_RANGE',
  severity: 'warning',
  chartType: null,
  title: 'Values outside the axis range',
  message: (p) =>
    `${p.count ?? 1} value(s) fall outside the ${p.axis ?? 'y'}-axis range (${p.value ?? 500}) — they are drawn cut off at the edge.`,
  hint: 'Widen the range, or remove the bound to let the axis fit the data.',
  example: 'bar Sales\ny-axis ..100\nQ1 500',
};

export const AXIS_STACK_PAST_RANGE_DX: DiagnosticSpec = {
  code: 'E_STACK_PAST_AXIS_RANGE',
  severity: 'error',
  chartType: 'bar',
  title: 'Stacked column past the axis range',
  message: (p) =>
    `A stacked column cannot be cut by the axis: ${p.columns ?? 'Mar (total 260)'} ${p.bound ?? 'is past the y-axis max of 100'}. Its segments above the cut would draw with no height, so the chart is not drawn.`,
  hint: 'Raise the `y-axis` max (or lower its min) past every column total, or remove the bound to let the axis fit the data.',
  example: 'bar Sales\nstack\nseries A, B\ny-axis 0..100\nQ1 80 70',
};

/** An eight-directive axis form from before decision #60. */
export const AXIS_OLD_DIRECTIVE_DX: DiagnosticSpec = {
  code: 'E_AXIS_OLD_DIRECTIVE',
  severity: 'error',
  chartType: null,
  title: 'Old axis directive',
  message: (p) =>
    `\`${p.directive ?? 'y-min'}\` is gone — write \`${p.replacement ?? 'y-axis 0..'}\` instead. The line is ignored.`,
  hint: 'One line sets an axis: `y-axis <title> <min>..<max> <log|linear>`. Every part is optional, so `y-axis 0..` sets only the floor.',
  example: 'bar Sales\ny-min 0\nQ1 100',
};

export const AXIS_DIAGNOSTICS: DiagnosticSpec[] = [
  AXIS_DIRECTIVE_DX,
  AXIS_OLD_DIRECTIVE_DX,
  AXIS_LOG_NOT_POSITIVE_DX,
  AXIS_OUTSIDE_RANGE_DX,
  AXIS_STACK_PAST_RANGE_DX,
];

const AXIS_LINE_RE = /^(x|y|y-right)-axis(?:\s+(.*))?$/;
const OLD_AXIS_RE =
  /^(x|y)-(scale|min|max|label)(?=\s|$)|^y-right-label(?=\s|$)/;
const NUMBER_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const RANGE_RE = /^(-?[\d.,_]*\d)?\.\.(-?[\d.,_]*\d)?$/;

/** One axis line, read from the end: scale, then range, then the title. */
export interface AxisLine {
  axis: AxisName;
  label?: string;
  min?: number;
  max?: number;
  scale?: AxisScaleKind;
  /** Set when a part could not be read; that part is dropped. */
  problem?: string;
}

function toNumber(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  const clean = raw.replace(/[,_]/g, '');
  return NUMBER_RE.test(clean) ? parseFloat(clean) : null;
}

/**
 * Read `x-axis …` / `y-axis …` / `y-right-axis …`, or return null when the
 * line is not an axis line. Lowercase only, at column 1, so a data row is
 * never taken. A title that is literally `log` / `linear`, or ends in a
 * range, is quoted: `y-axis "log"`.
 */
export function readAxisLine(trimmed: string): AxisLine | null {
  const m = trimmed.match(AXIS_LINE_RE);
  if (!m) return null;
  const out: AxisLine = { axis: m[1] as AxisName };
  let rest = (m[2] ?? '').trim();
  const take = (): string | undefined => {
    const t = rest.match(/(?:^|\s)(\S+)$/);
    return t ? t[1] : undefined;
  };
  const drop = (tok: string): void => {
    rest = rest.slice(0, rest.length - tok.length).trimEnd();
  };
  let tok = take();
  if (tok === 'log' || tok === 'linear') {
    out.scale = tok;
    drop(tok);
    tok = take();
  }
  // Any unquoted last word holding `..` is a range attempt: a malformed one
  // warns rather than quietly becoming part of the title.
  if (tok && tok.includes('..') && !tok.endsWith('"')) {
    drop(tok);
    const range = tok.match(RANGE_RE);
    const lo = range ? toNumber(range[1]) : null;
    const hi = range ? toNumber(range[2]) : null;
    if (lo === null || hi === null) {
      out.problem = `\`${tok}\` is not a range of two numbers`;
    } else if (lo === undefined && hi === undefined) {
      out.problem = '`..` needs a number on at least one side';
    } else {
      if (lo !== undefined) out.min = lo;
      if (hi !== undefined) out.max = hi;
    }
  }
  const quoted = rest.match(/^"(.*)"$/);
  if (quoted) rest = quoted[1]!;
  if (rest) out.label = rest;
  return out;
}

/**
 * The new form for an old axis directive (`y-min 0` → `y-axis 0..`), or null
 * when `trimmed` is not one. Every parser that once read the old directives
 * calls this so the old line errors instead of becoming data.
 */
export function oldAxisReplacement(trimmed: string): {
  directive: string;
  replacement: string;
} | null {
  const m = trimmed.match(OLD_AXIS_RE);
  if (!m) return null;
  const directive = m[0];
  const value = trimmed.slice(directive.length).trim();
  if (directive === 'y-right-label')
    return { directive, replacement: `y-right-axis ${value}`.trim() };
  const axis = m[1]!;
  const field = m[2]!;
  const v = value.replace(/[,_]/g, '');
  const replacement =
    field === 'label'
      ? `${axis}-axis ${value}`
      : field === 'scale'
        ? `${axis}-axis ${value || 'log'}`
        : field === 'min'
          ? `${axis}-axis ${v || '0'}..`
          : `${axis}-axis ..${v || '100'}`;
  return { directive, replacement: replacement.trim() };
}

/** Push the old-directive error when `trimmed` is one; true when it was. */
export function rejectOldAxisLine(
  trimmed: string,
  lineNumber: number,
  diagnostics: DgmoError[]
): boolean {
  const old = oldAxisReplacement(trimmed);
  if (!old) return false;
  diagnostics.push(emit(AXIS_OLD_DIRECTIVE_DX, lineNumber, old));
  return true;
}

/**
 * Consume `trimmed` when it is an axis line (or an old axis directive, which
 * errors). Returns false when the line is neither, so the caller keeps
 * parsing it. `allowed` names the axes this chart type has as numbers; a
 * range or scale on another axis warns and is dropped. The title goes to
 * `onLabel`; a chart type that draws no axis titles passes none, and a title
 * there warns.
 */
export function parseAxisLine(
  trimmed: string,
  lineNumber: number,
  axes: AxisSpecs,
  allowed: ReadonlySet<AxisName>,
  diagnostics: DgmoError[],
  onLabel?: (axis: AxisName, label: string, lineNumber: number) => void
): boolean {
  if (rejectOldAxisLine(trimmed, lineNumber, diagnostics)) return true;
  const line = readAxisLine(trimmed);
  if (!line) return false;
  applyAxisLine(line, lineNumber, axes, allowed, diagnostics, onLabel);
  return true;
}

/** Apply one read axis line: title to `onLabel`, range and scale to `axes`. */
export function applyAxisLine(
  line: AxisLine,
  lineNumber: number,
  axes: AxisSpecs,
  allowed: ReadonlySet<AxisName>,
  diagnostics: DgmoError[],
  onLabel?: (axis: AxisName, label: string, lineNumber: number) => void
): void {
  const { axis } = line;
  const directive = `${axis}-axis`;
  const warn = (reason: string): void => {
    diagnostics.push(
      emit(AXIS_DIRECTIVE_DX, lineNumber, { directive, reason })
    );
  };
  if (line.label !== undefined) {
    if (onLabel) onLabel(axis, line.label, lineNumber);
    else warn('this chart type draws no axis titles');
  }
  if (line.problem) warn(line.problem);
  const ranged = line.min !== undefined || line.max !== undefined || line.scale;
  if (!ranged) return;
  if (!allowed.has(axis)) {
    warn(
      allowed.size === 0
        ? 'this chart type has no numeric axis'
        : `this chart type has no numeric ${axis}-axis`
    );
    return;
  }
  const spec: AxisSpec = { lineNumber };
  if (line.scale) spec.scale = line.scale;
  if (line.min !== undefined) spec.min = line.min;
  if (line.max !== undefined) spec.max = line.max;
  axes[axis] = spec;
}

/**
 * Settle one axis after the whole file is read: drop a min/max pair that is
 * inverted, a log scale over non-positive values or bounds, and warn on values
 * the bounds cut off. Mutates `spec`; call once per axis with every value the
 * axis must show (stack totals, not segments, on a stacked bar).
 */
export function settleAxisSpec(
  axis: AxisName,
  spec: AxisSpec | undefined,
  values: readonly number[],
  diagnostics: DgmoError[]
): void {
  if (!spec) return;
  const line = spec.lineNumber ?? 1;
  if (
    spec.min !== undefined &&
    spec.max !== undefined &&
    spec.min >= spec.max
  ) {
    diagnostics.push(
      emit(AXIS_DIRECTIVE_DX, line, {
        directive: `${axis}-axis`,
        reason: `${spec.min}..${spec.max} runs backwards — the low end comes first`,
      })
    );
    delete spec.min;
    delete spec.max;
  }
  if (spec.scale === 'log') {
    const bad =
      values.find((v) => !(v > 0)) ??
      (spec.min !== undefined && !(spec.min > 0) ? spec.min : undefined) ??
      (spec.max !== undefined && !(spec.max > 0) ? spec.max : undefined);
    if (bad !== undefined) {
      diagnostics.push(
        emit(AXIS_LOG_NOT_POSITIVE_DX, line, { axis, value: bad })
      );
      delete spec.scale;
    }
  }
  const outside = values.filter(
    (v) =>
      (spec.min !== undefined && v < spec.min) ||
      (spec.max !== undefined && v > spec.max)
  );
  if (outside.length > 0) {
    diagnostics.push(
      emit(AXIS_OUTSIDE_RANGE_DX, line, {
        axis,
        count: outside.length,
        value: outside[0],
      })
    );
  }
}
