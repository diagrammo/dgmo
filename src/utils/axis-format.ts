// ============================================================
// The indented axis block (#2116): an axis line's own number format.
//
//   y-axis Revenue 0..
//     format currency USD
//   y-right-axis Output
//     unit bbl
//
// The children are the chart-wide `format` / `unit` / `locale` lines
// (§15.1.4), read by the same parser, but they set only that axis. A child
// replaces the matching part of the chart-wide format: its `format` replaces
// the chart's format, its `unit` the chart's unit, its `locale` the locale.
// Decision #60: a per-axis setting is an indented child of the axis line,
// never a top-level `x-<thing>` directive.
// ============================================================

import { emit, type DgmoError, type DiagnosticSpec } from '../diagnostics';
import type { AxisName } from './axis-spec';
import {
  isWordUnit,
  parseNumberFormatLine,
  titleWithUnit,
  unitOnAxisTitle,
  type NumberFormatSpec,
} from './number-format';

export type AxisFormats = Partial<Record<AxisName, NumberFormatSpec>>;

/** Where a chart type prints numbers along an axis, and which axis the
 *  chart-wide `format` belongs to. `inherit` lists the other axes that start
 *  from the chart-wide format; an axis not in it starts plain (scatter and
 *  function x, §15.1.4). */
export interface AxisFormatPlan {
  axes: ReadonlySet<AxisName>;
  primary: AxisName;
  inherit?: readonly AxisName[];
}

export const AXIS_FORMAT_PLANS: Readonly<Record<string, AxisFormatPlan>> = {
  bar: { axes: new Set(['y', 'y-right']), primary: 'y', inherit: ['y-right'] },
  line: {
    axes: new Set(['y', 'y-right']),
    primary: 'y',
    inherit: ['y-right'],
  },
  scatter: { axes: new Set(['x', 'y']), primary: 'y' },
  function: { axes: new Set(['x', 'y']), primary: 'y' },
  boxplot: { axes: new Set(['y']), primary: 'y' },
  histogram: { axes: new Set(['x']), primary: 'x' },
  slope: { axes: new Set(['y']), primary: 'y' },
};

export const AXIS_FORMAT_DX: DiagnosticSpec = {
  code: 'W_AXIS_SETTING_INVALID',
  severity: 'warning',
  chartType: null,
  title: 'Axis setting not applied',
  message: (p) =>
    `${p.directive ?? 'y-axis'}: ${p.reason ?? 'not an axis setting'} — the line is ignored.`,
  hint: 'Under an axis line, indent `format …`, `unit …` or `locale …` (§15.1.4). They set that axis only; the range and scale stay on the axis line.',
  example: 'line Sales\ny-axis Revenue\n  ticks 5\nQ1 100',
};

const SETTING_RE = /^(format|unit|locale)(?=\s|$)/;

/** True when `trimmed` is a `format` / `unit` / `locale` line. */
export function isAxisSettingLine(trimmed: string): boolean {
  return SETTING_RE.test(trimmed);
}

/**
 * Read one indented child of `axis`. A setting on an axis that prints no
 * numbers, or a line that is not a setting, warns and is dropped.
 */
export function parseAxisSetting(
  trimmed: string,
  lineNumber: number,
  axis: AxisName,
  holder: { axisFormats?: AxisFormats },
  plan: AxisFormatPlan | undefined,
  diagnostics: DgmoError[]
): void {
  const directive = `${axis}-axis`;
  const warn = (reason: string): void => {
    diagnostics.push(emit(AXIS_FORMAT_DX, lineNumber, { directive, reason }));
  };
  if (!isAxisSettingLine(trimmed)) {
    const word = trimmed.split(/\s+/, 1)[0];
    warn(
      `\`${word}\` is not an axis setting — indent \`format\`, \`unit\` or \`locale\``
    );
    return;
  }
  if (!plan?.axes.has(axis)) {
    warn(
      plan
        ? `this chart type prints no numbers on the ${axis}-axis`
        : 'this chart type prints no numbers on an axis'
    );
    return;
  }
  const slot: { numberFormat?: NumberFormatSpec } = {};
  const own = holder.axisFormats?.[axis];
  if (own) slot.numberFormat = own;
  parseNumberFormatLine(trimmed, lineNumber, slot, diagnostics);
  if (slot.numberFormat) (holder.axisFormats ??= {})[axis] = slot.numberFormat;
}

const indentOf = (line: string): number => {
  const m = line.match(/^[ \t]*/);
  return m ? m[0].replace(/\t/g, '    ').length : 0;
};

/**
 * Consume the indented lines under the axis line at `index`. Returns the
 * index of the last line consumed (`index` itself when there are none). A
 * blank line ends the block.
 */
export function parseAxisBlock(
  lines: readonly string[],
  index: number,
  axis: AxisName,
  holder: { axisFormats?: AxisFormats },
  plan: AxisFormatPlan | undefined,
  diagnostics: DgmoError[]
): number {
  let last = index;
  for (let j = index + 1; j < lines.length; j++) {
    const raw = lines[j]!;
    const trimmed = raw.trim();
    if (!trimmed || indentOf(raw) === 0) break;
    if (trimmed.startsWith('//')) {
      last = j;
      continue;
    }
    parseAxisSetting(trimmed, j + 1, axis, holder, plan, diagnostics);
    last = j;
  }
  return last;
}

/** `over`'s parts replace `base`'s: format with format, unit, locale. */
export function mergeNumberFormat(
  base: NumberFormatSpec | undefined,
  over: NumberFormatSpec | undefined
): NumberFormatSpec | undefined {
  if (!over) return base;
  const out: NumberFormatSpec = { ...base };
  if (over.kind) {
    delete out.currency;
    delete out.decimals;
    delete out.pattern;
    out.kind = over.kind;
    if (over.currency !== undefined) out.currency = over.currency;
    if (over.decimals !== undefined) out.decimals = over.decimals;
    if (over.pattern !== undefined) out.pattern = over.pattern;
  }
  if (over.unit !== undefined) out.unit = over.unit;
  if (over.locale !== undefined) out.locale = over.locale;
  return out;
}

/**
 * Settle the per-axis formats once the file is read. The primary axis's
 * block folds into the chart-wide `numberFormat`, so every renderer and the
 * generated description read it as before. Each other axis keeps a full spec
 * of its own: the chart-wide format with its block on top, or the block
 * alone on an axis that starts plain.
 */
export function resolveAxisFormats(
  holder: { numberFormat?: NumberFormatSpec; axisFormats?: AxisFormats },
  plan: AxisFormatPlan | undefined,
  /** Whether the chart draws `axis`; an inheriting axis it does not draw
   *  needs no format of its own. */
  draws: (axis: AxisName) => boolean = () => true
): void {
  const formats = holder.axisFormats;
  if (!formats || !plan) {
    delete holder.axisFormats;
    return;
  }
  const base = holder.numberFormat;
  const primary = formats[plan.primary];
  delete formats[plan.primary];
  for (const axis of Object.keys(formats) as AxisName[]) {
    if (plan.inherit?.includes(axis))
      formats[axis] = mergeNumberFormat(base, formats[axis])!;
  }
  if (primary) {
    // The chart-wide format now carries the primary axis's block, so an
    // inheriting axis with no block of its own keeps the format as written.
    for (const axis of plan.inherit ?? [])
      if (!formats[axis] && draws(axis)) formats[axis] = { ...base };
    holder.numberFormat = mergeNumberFormat(base, primary)!;
  }
  if (Object.keys(formats).length === 0) delete holder.axisFormats;
}

/**
 * The format one axis prints with: its own when it has one, else the
 * chart-wide one where it inherits, else none (plain numbers).
 */
export function axisNumberFormat(
  chart: {
    numberFormat?: NumberFormatSpec | undefined;
    axisFormats?: AxisFormats | undefined;
  },
  axis: AxisName,
  inherits = true
): NumberFormatSpec | undefined {
  return (
    chart.axisFormats?.[axis] ?? (inherits ? chart.numberFormat : undefined)
  );
}

/** A word unit moves off the numbers; returns the spec without it. */
export function withoutWordUnit(spec: NumberFormatSpec | undefined): {
  spec: NumberFormatSpec | undefined;
  unit?: string;
} {
  const unit = spec?.unit;
  if (!spec || !unit || !isWordUnit(unit)) return { spec };
  const bare = { ...spec };
  delete bare.unit;
  return { spec: bare, unit };
}

type TitleKey = 'xlabel' | 'ylabel' | 'yrlabel';
const TITLE_OF: Partial<Record<AxisName, TitleKey>> = {
  x: 'xlabel',
  y: 'ylabel',
  'y-right': 'yrlabel',
};

/**
 * `unitOnAxisTitle` (#2088) for a chart with per-axis formats (#2116). The
 * chart-wide word unit goes on `axes` as before, except an axis with a format
 * of its own: that axis states its own word unit. An untitled axis gets one
 * when the unit is not already stated on the primary axis, so a right axis
 * in `bbl` beside a left axis in `$` is titled `bbl`.
 */
export function unitsOnAxisTitles<
  T extends {
    numberFormat?: NumberFormatSpec | undefined;
    axisFormats?: AxisFormats | undefined;
    xlabel?: string | undefined;
    ylabel?: string | undefined;
    yrlabel?: string | undefined;
  },
>(chart: T, axes: readonly TitleKey[]): T {
  const own = chart.axisFormats;
  const ownKeys = new Set(
    Object.keys(own ?? {}).map((a) => TITLE_OF[a as AxisName])
  );
  const sharedUnit = chart.numberFormat?.unit;
  const out = unitOnAxisTitle(
    chart,
    axes.filter((k) => !ownKeys.has(k))
  );
  if (!own) return out;
  const formats: AxisFormats = { ...own };
  for (const axis of Object.keys(own) as AxisName[]) {
    const key = TITLE_OF[axis];
    const { spec, unit } = withoutWordUnit(own[axis]);
    if (!unit || !key) continue;
    if (spec) formats[axis] = spec;
    const title = titleWithUnit(chart[key], unit, unit !== sharedUnit);
    if (title !== undefined) out[key] = title;
  }
  return { ...out, axisFormats: formats };
}
