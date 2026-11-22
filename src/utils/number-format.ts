import { formatLocale, formatSpecifier } from 'd3-format';
import { emit, type DgmoError, type DiagnosticSpec } from '../diagnostics';

// Shared compact number formatting. Used by the map region-value labels and the
// gradient legend's ramp ends so the two read identically (a region printing
// `39.5M` lines up with a legend that ends at `40M`).

/** Compact display of a numeric value:
 *  - integers and |n| < 1000 print bare (non-integers to 1 decimal, matching the
 *    legend's legacy ramp formatting): `0`, `3.2`, `999`, `42`.
 *  - |n| >= 1000 uses magnitude suffixes to 1 significant fraction digit:
 *    `1.1K`, `39.5M`, `2.3B`, `1.4T`.
 *  Negatives keep their sign (`-39.5M`). */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs < 1000) {
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  }
  const sign = n < 0 ? '-' : '';
  const units: ReadonlyArray<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [factor, suffix] of units) {
    if (abs >= factor) {
      // 1 fraction digit, but drop a trailing `.0` (39.0M → 39M).
      const scaled = Math.round((abs / factor) * 10) / 10;
      const body = Number.isInteger(scaled)
        ? String(scaled)
        : scaled.toFixed(1);
      return `${sign}${body}${suffix}`;
    }
  }
  // Unreachable (abs >= 1000 always matches the 1e3 unit), but keep TS happy.
  return String(n);
}

// ============================================================
// Author number formats (#1831): `format currency USD`, `format percent 1`,
// `format compact`, `format "<d3-format>"`, `unit ms`, `locale de-DE`.
// Decided by the owner 2026-11-10 (named formats, d3-format escape hatch).
// One spec per chart; every number the chart prints goes through
// `makeNumberFormatter`, so axis ticks, value labels, hover text and the
// generated description agree.
// ============================================================

export interface NumberFormatSpec {
  kind?: 'currency' | 'percent' | 'compact' | 'pattern';
  /** ISO 4217 code for `format currency`. */
  currency?: string;
  /** Fixed decimal places, when the author gave a count. */
  decimals?: number;
  /** The d3-format string of `format "…"`. */
  pattern?: string;
  /** What the numbers count: `unit ms`. A word unit goes on the value-axis title (#2088), a symbol after every number. */
  unit?: string;
  /** BCP 47 tag for separators and currency placement. Default `en-US`. */
  locale?: string;
}

export const NUMBER_FORMAT_DX: DiagnosticSpec = {
  code: 'W_NUMBER_FORMAT_INVALID',
  severity: 'warning',
  chartType: null,
  title: 'Number format not applied',
  message: (p) =>
    `${p.directive ?? 'format'}: ${p.reason ?? 'not a known format'} — the line is ignored.`,
  hint: 'Use `format currency USD`, `format percent 1`, `format compact`, `format ",.2f"`, `unit ms` or `locale de-DE`.',
  example: 'bar Sales\nformat money\nQ1 100',
};

const DEFAULT_LOCALE = 'en-US';
const LINE_RE = /^(format|unit|locale)(?:\s+(.*))?$/;
const DECIMALS_RE = /^\d{1,2}$/;

/**
 * Consume `trimmed` when it is a `format`, `unit` or `locale` line. Lowercase
 * at column 1 only, so a data row named "Format" stays data. A line that
 * names the keyword but cannot be read warns and is consumed.
 */
export function parseNumberFormatLine(
  trimmed: string,
  lineNumber: number,
  holder: { numberFormat?: NumberFormatSpec },
  diagnostics: DgmoError[]
): boolean {
  const m = trimmed.match(LINE_RE);
  if (!m) return false;
  const directive = m[1]!;
  const rest = (m[2] ?? '').trim();
  const warn = (reason: string): true => {
    diagnostics.push(emit(NUMBER_FORMAT_DX, lineNumber, { directive, reason }));
    return true;
  };
  const spec = (holder.numberFormat ??= {});
  if (directive === 'unit') {
    if (!rest) return warn('expected the unit text, e.g. `unit ms`');
    spec.unit = rest;
    return true;
  }
  if (directive === 'locale') {
    try {
      const [tag] = Intl.getCanonicalLocales(rest);
      if (!tag || Intl.NumberFormat.supportedLocalesOf([tag]).length === 0)
        return warn(`"${rest}" is not a locale this runtime knows`);
      spec.locale = tag;
    } catch {
      return warn(`"${rest}" is not a locale tag such as de-DE`);
    }
    return true;
  }
  // format …
  const quoted = rest.match(/^"(.*)"$/);
  if (quoted) {
    try {
      formatSpecifier(quoted[1]!);
    } catch {
      return warn(`"${quoted[1]}" is not a valid format string`);
    }
    setKind(spec, { kind: 'pattern', pattern: quoted[1]! });
    return true;
  }
  const words = rest.split(/\s+/).filter(Boolean);
  const decimalsOf = (w: string | undefined): number | undefined | null =>
    w === undefined ? undefined : DECIMALS_RE.test(w) ? Number(w) : null;
  if (words[0] === 'currency') {
    const code = words[1]?.toUpperCase();
    if (!code || !/^[A-Z]{3}$/.test(code))
      return warn('expected a currency code, e.g. `format currency USD`');
    try {
      new Intl.NumberFormat(DEFAULT_LOCALE, {
        style: 'currency',
        currency: code,
      });
    } catch {
      return warn(`"${code}" is not a currency code`);
    }
    const decimals = decimalsOf(words[2]);
    if (decimals === null || words.length > 3)
      return warn('expected `format currency <CODE> [decimals]`');
    setKind(spec, { kind: 'currency', currency: code, decimals });
    return true;
  }
  if (words[0] === 'percent' || words[0] === 'compact') {
    const decimals = decimalsOf(words[1]);
    if (decimals === null || words.length > 2)
      return warn(`expected \`format ${words[0]} [decimals]\``);
    setKind(spec, { kind: words[0], decimals });
    return true;
  }
  return warn(
    words.length === 0
      ? 'expected a format'
      : `"${words[0]}" is not a format — use currency, percent, compact or a quoted pattern`
  );
}

/** The last `format` line wins; `unit` and `locale` are kept. */
function setKind(
  spec: NumberFormatSpec,
  next: {
    kind: NonNullable<NumberFormatSpec['kind']>;
    currency?: string | undefined;
    decimals?: number | undefined;
    pattern?: string | undefined;
  }
): void {
  delete spec.currency;
  delete spec.decimals;
  delete spec.pattern;
  Object.assign(spec, next);
  for (const k of ['currency', 'decimals', 'pattern'] as const)
    if (spec[k] === undefined) delete spec[k];
}

/**
 * The function every data chart prints its numbers with. With no spec it is
 * the long-standing default (`fallback`), so a chart without `format` /
 * `unit` / `locale` renders exactly as before.
 *
 * `basis` is the label set one axis prints — its ticks — or, on a chart with
 * no axis, its values. Under `format compact` it fixes ONE unit and ONE
 * decimal count for every number the formatter prints (#2036), so an axis
 * reads `0, 0.4K, 0.8K, 1.2K` rather than `1.2K, 1K, 800`.
 */
export function makeNumberFormatter(
  spec: NumberFormatSpec | undefined,
  fallback: (n: number) => string,
  basis?: readonly number[]
): (n: number) => string {
  if (!spec || (!spec.kind && !spec.unit && !spec.locale)) return fallback;
  const locale = spec.locale ?? DEFAULT_LOCALE;
  const fixed = spec.decimals;
  let body: (n: number) => string;
  switch (spec.kind) {
    case 'currency': {
      const f = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: spec.currency!,
        minimumFractionDigits: fixed ?? 0,
        maximumFractionDigits: fixed ?? 2,
      });
      body = (n) => f.format(n);
      break;
    }
    case 'percent': {
      // Values are percentages as written: 12.5 prints as 12.5%. Data held
      // as fractions (0.125) takes the escape hatch: format ".1%".
      const f = new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: fixed ?? 0,
        maximumFractionDigits: fixed ?? 1,
      });
      body = (n) => f.format(n / 100);
      break;
    }
    case 'compact': {
      const shared = basis?.length
        ? sharedCompact(locale, basis, fixed)
        : undefined;
      if (shared) {
        body = shared;
        break;
      }
      const f = new Intl.NumberFormat(locale, {
        notation: 'compact',
        minimumFractionDigits: fixed ?? 0,
        maximumFractionDigits: fixed ?? 1,
      });
      body = (n) => f.format(n);
      break;
    }
    case 'pattern':
      body = d3LocaleFor(locale).format(spec.pattern!);
      break;
    default: {
      const f = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
      body = (n) => f.format(n);
    }
  }
  const unit = spec.unit;
  if (!unit) return (n) => (Number.isFinite(n) ? body(n) : '');
  // A word unit takes a space (3 ms); a symbol does not (21°, 5‰).
  const sep = isWordUnit(unit) ? ' ' : '';
  return (n) => (Number.isFinite(n) ? `${body(n)}${sep}${unit}` : '');
}

/** A unit that starts with a letter (`votes`, `ms`), not a symbol (`%`, `°`, `$`). */
export function isWordUnit(unit: string): boolean {
  return /^\p{L}/u.test(unit);
}

/**
 * A word unit is stated once, in the value-axis title, not after every tick
 * and bar label (#2088, option 1 decided 2026-11-17). Returns the chart with
 * the unit taken off its numbers and put on the `axes` titles named: a title
 * that already holds the word keeps it as written, any other title gains
 * `(votes)`, and an untitled axis is titled with the unit alone. The first
 * named axis gets a title even when it has none; the others only when the
 * author titled them. A symbol unit (`%`, `°`) stays on every number. The
 * generated description formats from the parsed chart, so it keeps `40 votes`.
 */
export function unitOnAxisTitle<
  T extends {
    numberFormat?: NumberFormatSpec | undefined;
    xlabel?: string | undefined;
    ylabel?: string | undefined;
    yrlabel?: string | undefined;
  },
>(chart: T, axes: readonly ('xlabel' | 'ylabel' | 'yrlabel')[]): T {
  const unit = chart.numberFormat?.unit;
  if (!unit || !isWordUnit(unit)) return chart;
  const bare = { ...chart.numberFormat };
  delete bare.unit;
  const out: T = { ...chart, numberFormat: bare };
  axes.forEach((axis, i) => {
    const title = titleWithUnit(chart[axis], unit, i === 0);
    if (title !== undefined) out[axis] = title;
  });
  return out;
}

/**
 * An axis title that states `unit` once: a title holding the word is kept,
 * another gains `(unit)`, and an untitled axis gets the unit alone when
 * `titleIfEmpty`. Undefined when the axis stays untitled.
 */
export function titleWithUnit(
  title: string | undefined,
  unit: string,
  titleIfEmpty: boolean
): string | undefined {
  if (title) {
    const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const word = new RegExp('(?<!\\p{L})' + escaped + '(?!\\p{L})', 'iu');
    return word.test(title) ? title : `${title} (${unit})`;
  }
  if (!titleIfEmpty) return undefined;
  // `votes` → `Votes`; an abbreviation (`ms`, `kWh`) keeps its case.
  return /^\p{Ll}{3,}$/u.test(unit)
    ? unit[0]!.toUpperCase() + unit.slice(1)
    : unit;
}

/** Most fraction digits a shared compact unit picks on its own. */
const COMPACT_MAX_DECIMALS = 2;

/**
 * One compact unit for a whole label set (#2036, decided 2026-11-16): the unit
 * the locale gives the largest |value|, and the fewest decimals (up to
 * COMPACT_MAX_DECIMALS, default 1 when none is exact) that print every basis
 * value exactly in it. An author's `format compact N` fixes the decimals.
 * Zero prints bare. Returns undefined when the basis has no finite value.
 */
function sharedCompact(
  locale: string,
  basis: readonly number[],
  fixed: number | undefined
): ((n: number) => string) | undefined {
  const finite = basis.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return undefined;
  const ref = Math.max(...finite.map(Math.abs));
  const compact = new Intl.NumberFormat(locale, { notation: 'compact' });
  const suffixOf = (v: number) =>
    compact
      .formatToParts(v)
      .filter((p) => p.type === 'compact')
      .map((p) => p.value)
      .join('');
  // The unit's exponent: the smallest power of ten the locale names with the
  // same word as the reference (K = 3 in en, 万 = 4 in ja).
  let exp = 0;
  let parts: Intl.NumberFormatPart[] = [];
  const unit = ref > 0 ? suffixOf(ref) : '';
  if (unit) {
    for (let e = Math.floor(Math.log10(ref)); e >= 1; e--) {
      if (suffixOf(10 ** e) !== unit) break;
      exp = e;
    }
    parts = compact.formatToParts(10 ** exp);
  }
  const scale = 10 ** exp;
  const isNum = (p: Intl.NumberFormatPart) =>
    p.type === 'integer' ||
    p.type === 'group' ||
    p.type === 'decimal' ||
    p.type === 'fraction';
  const first = parts.findIndex(isNum);
  const last = parts.length - 1 - [...parts].reverse().findIndex(isNum);
  const prefix = parts
    .slice(0, Math.max(0, first))
    .map((p) => p.value)
    .join('');
  const suffix = parts
    .slice(last + 1)
    .map((p) => p.value)
    .join('');
  const exactAt = (d: number) =>
    finite.every((v) => {
      const s = v / scale;
      return Math.abs(Math.round(s * 10 ** d) / 10 ** d - s) < 1e-9 * scale;
    });
  let decimals = fixed;
  if (decimals === undefined) {
    decimals = exp === 0 ? 0 : 1;
    for (let d = 0; d <= COMPACT_MAX_DECIMALS; d++)
      if (exactAt(d)) {
        decimals = d;
        break;
      }
    if (exp === 0 && !exactAt(decimals)) decimals = 1;
  }
  const plain = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (n) => {
    if (n === 0) return plain.format(0).replace(/[.,]0+$/, '');
    if (!unit) return plain.format(n);
    const body = plain.format(Math.abs(n) / scale);
    return `${n < 0 ? '-' : ''}${prefix}${body}${suffix}`;
  };
}

/** A d3-format locale whose separators match `locale` (#1831). */
function d3LocaleFor(locale: string): ReturnType<typeof formatLocale> {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
  const part = (t: string, d: string) =>
    parts.find((p) => p.type === t)?.value ?? d;
  return formatLocale({
    decimal: part('decimal', '.'),
    thousands: part('group', ','),
    grouping: [3],
    currency: ['$', ''],
    minus: '-',
  });
}
