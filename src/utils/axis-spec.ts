// ============================================================
// Axis directives — `y-scale log`, `y-min N`, `y-max N` and the `x-` forms
// (#1830). Shared by the bar/line parser (chart.ts), the extended parser
// (scatter, function) and the visualizations parser (slope). The renderers
// read the result through `buildValueAxis` in charts-d3/value-axis.ts.
// ============================================================

import { emit, type DgmoError, type DiagnosticSpec } from '../diagnostics';

export type AxisName = 'x' | 'y';
export type AxisScaleKind = 'linear' | 'log';

/** What the author asked of one numeric axis. Every field is optional. */
export interface AxisSpec {
  scale?: AxisScaleKind;
  min?: number;
  max?: number;
  /** Line of the first axis directive, for data-check diagnostics. */
  lineNumber?: number;
}

export type AxisSpecs = Partial<Record<AxisName, AxisSpec>>;

export const AXIS_DIRECTIVE_DX: DiagnosticSpec = {
  code: 'W_AXIS_DIRECTIVE_INVALID',
  severity: 'warning',
  chartType: null,
  title: 'Axis directive not applied',
  message: (p) =>
    `${p.directive ?? 'y-min'}: ${p.reason ?? 'expected a number'} — the line is ignored.`,
  hint: 'Write `y-scale log` or `y-scale linear`, and a plain number after `y-min` / `y-max`. `x-` forms exist only where the x-axis is numeric (scatter).',
  example: 'bar Sales\ny-min ten\nQ1 100',
};

export const AXIS_LOG_NOT_POSITIVE_DX: DiagnosticSpec = {
  code: 'W_AXIS_LOG_NOT_POSITIVE',
  severity: 'warning',
  chartType: null,
  title: 'Log axis with zero or negative values',
  message: (p) =>
    `${p.axis ?? 'y'}-scale log needs every value above 0, but ${p.value ?? 0} is not — the axis stays linear.`,
  hint: 'Remove the zero or negative values, or drop the log scale.',
  example: 'line Users\ny-scale log\nJan 0\nFeb 1000',
};

export const AXIS_OUTSIDE_RANGE_DX: DiagnosticSpec = {
  code: 'W_AXIS_DATA_OUTSIDE_RANGE',
  severity: 'warning',
  chartType: null,
  title: 'Values outside the axis range',
  message: (p) =>
    `${p.count ?? 1} value(s) fall outside ${p.axis ?? 'y'}-min / ${p.axis ?? 'y'}-max (${p.value ?? 500}) — they are drawn cut off at the edge.`,
  hint: 'Widen the range, or remove the bound to let the axis fit the data.',
  example: 'bar Sales\ny-max 100\nQ1 500',
};

export const AXIS_DIAGNOSTICS: DiagnosticSpec[] = [
  AXIS_DIRECTIVE_DX,
  AXIS_LOG_NOT_POSITIVE_DX,
  AXIS_OUTSIDE_RANGE_DX,
];

const AXIS_LINE_RE = /^([xy])-(scale|min|max)(?:\s+(.*))?$/;
const NUMBER_RE = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Consume `trimmed` when it is an axis directive. Returns false when the line
 * is not one, so the caller keeps parsing it. `allowed` names the axes this
 * chart type has as numbers; a directive for another axis warns and is
 * consumed. Lowercase only, at column 1, so a data row is never taken.
 */
export function parseAxisLine(
  trimmed: string,
  lineNumber: number,
  axes: AxisSpecs,
  allowed: ReadonlySet<AxisName>,
  diagnostics: DgmoError[]
): boolean {
  const m = trimmed.match(AXIS_LINE_RE);
  if (!m) return false;
  const axis = m[1] as AxisName;
  const field = m[2] as 'scale' | 'min' | 'max';
  const value = (m[3] ?? '').trim();
  const directive = `${axis}-${field}`;
  const warn = (reason: string): true => {
    diagnostics.push(
      emit(AXIS_DIRECTIVE_DX, lineNumber, { directive, reason })
    );
    return true;
  };
  if (!allowed.has(axis)) {
    return warn(
      allowed.size === 0
        ? 'this chart type has no numeric axis'
        : `this chart type has no numeric ${axis}-axis`
    );
  }
  const spec = (axes[axis] ??= {});
  spec.lineNumber ??= lineNumber;
  if (field === 'scale') {
    if (value !== 'log' && value !== 'linear')
      return warn('expected `log` or `linear`');
    spec.scale = value;
    return true;
  }
  const raw = value.replace(/[,_]/g, '');
  if (!NUMBER_RE.test(raw)) return warn('expected a number');
  spec[field] = parseFloat(raw);
  return true;
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
        directive: `${axis}-min`,
        reason: `${axis}-min ${spec.min} is not below ${axis}-max ${spec.max}`,
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
