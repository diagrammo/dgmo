// ============================================================
// Statistics overlays — parsing and settling (#1954)
// ============================================================
//
// Overlay lines are lowercase and matched at column 1, so a data row named
// `Target 120` or `Mean time 40` stays data.

import type { DgmoError, DiagnosticSpec } from '../diagnostics';
import { emit, suggest } from '../diagnostics';
import { isRecognizedColorName } from '../colors';
import { normalizeNumericToken } from '../utils/parsing';
import type { ChartOverlay, OverlayKind } from './types';

/** The chart types each overlay draws on. */
export const OVERLAY_CHARTS: Readonly<Record<OverlayKind, readonly string[]>> =
  {
    mean: ['line', 'bar', 'histogram'],
    median: ['line', 'bar', 'histogram'],
    target: ['line', 'bar'],
    trend: ['line', 'bar', 'scatter'],
    'moving-average': ['line'],
    extremes: ['line'],
    pareto: ['bar'],
  };

/** How each overlay is written, for messages and completion. */
export const OVERLAY_FORMS: Readonly<Record<OverlayKind, string>> = {
  mean: 'mean',
  median: 'median',
  target: 'target N',
  trend: 'trend',
  'moving-average': 'moving-average N',
  extremes: 'extremes',
  pareto: 'pareto',
};

/** `extremes` is drawn by default on line charts and never written (#2213);
 *  `no-extremes` turns it off. */
const KINDS = (Object.keys(OVERLAY_CHARTS) as OverlayKind[]).filter(
  (k) => k !== 'extremes'
);
const formList = (): string =>
  KINDS.map((k) => `\`${OVERLAY_FORMS[k]}\``).join(', ');

/**
 * Words an author may reach for that are not overlays. `average` is not a
 * synonym for `mean`, and mode is not offered (owner, 2026-11-12).
 */
const NEAR_MISSES: Readonly<Record<string, string | undefined>> = {
  average: 'mean',
  avg: 'mean',
  mode: undefined,
  'mean-line': 'mean',
  'median-line': 'median',
  goal: 'target',
  trendline: 'trend',
  'trend-line': 'trend',
  regression: 'trend',
  'moving-avg': 'moving-average',
  'rolling-average': 'moving-average',
  extremes: undefined,
  extreme: undefined,
  extrema: undefined,
  'min-max': undefined,
  'pareto-chart': 'pareto',
};

export const OVERLAY_UNKNOWN_DX: DiagnosticSpec = {
  code: 'W_OVERLAY_UNKNOWN',
  severity: 'warning',
  chartType: null,
  title: 'Unknown statistics overlay',
  message: (p) =>
    `"${p.word ?? 'average'}" is not a statistics overlay; the line is ignored. The overlays are ${formList()}.${p.hint ? ` ${p.hint}` : ''}`,
  hint: 'Write one overlay per line, by its exact name: `mean`, not `average`.',
  example: 'line Sign-ups\naverage\nJan 310\nFeb 295',
};

export const OVERLAY_UNSUPPORTED_DX: DiagnosticSpec = {
  code: 'W_OVERLAY_UNSUPPORTED',
  severity: 'warning',
  chartType: null,
  title: 'Overlay on a chart that does not take it',
  message: (p) =>
    `\`${p.overlay ?? 'mean'}\` draws on ${p.supported ?? 'line and bar'} charts, not on ${p.chart ?? 'pie'}; ignoring it.`,
  hint: 'Remove the overlay, or change the chart type to one it draws on.',
  example: 'pie Budget\nmean\nRent 1200\nFood 400',
};

export const OVERLAY_BAD_N_DX: DiagnosticSpec = {
  code: 'E_OVERLAY_BAD_N',
  severity: 'error',
  chartType: null,
  title: 'Overlay number missing or invalid',
  message: (p) =>
    `\`${p.overlay ?? 'target'}\` needs ${p.need ?? 'a number'}: write \`${p.form ?? 'target 100'}\`. The line is ignored.`,
  hint: 'Put the number right after the overlay name, as in `target 100`.',
  example: 'bar Sales\ntarget lots\nNorth 118',
};

export const OVERLAY_PARETO_SERIES_DX: DiagnosticSpec = {
  code: 'E_OVERLAY_PARETO_SERIES',
  severity: 'error',
  chartType: 'bar',
  title: 'pareto on a stacked or grouped bar',
  message: (p) =>
    `\`pareto\` needs one value per bar, so it cannot draw a \`${p.layout ?? 'stack'}\`; ignoring it.`,
  hint: 'Remove the `stack` or `group` block and give each row one value, or remove `pareto`.',
  example: 'bar Defects\npareto\nstack\n  A\n  B\nX 1 2',
};

export const OVERLAY_DIAGNOSTICS: DiagnosticSpec[] = [
  OVERLAY_UNKNOWN_DX,
  OVERLAY_UNSUPPORTED_DX,
  OVERLAY_BAD_N_DX,
  OVERLAY_PARETO_SERIES_DX,
];

const num = (tok: string | undefined): number | null => {
  if (tok === undefined) return null;
  const norm = normalizeNumericToken(tok) ?? tok;
  const v = Number(norm);
  return norm.trim() !== '' && Number.isFinite(v) ? v : null;
};

/**
 * Read one overlay line. Returns the overlay, `true` when the line was an
 * overlay but malformed (its diagnostic is pushed), or null when the line is
 * not an overlay at all.
 */
export function parseOverlayLine(
  trimmed: string,
  lineNumber: number,
  diagnostics: DgmoError[]
): ChartOverlay | true | null {
  const tokens = trimmed.split(/\s+/);
  const head = tokens[0]!;
  if (!(head in OVERLAY_CHARTS) || head === 'extremes') return null;
  const kind = head as OverlayKind;
  if (kind === 'target') {
    const value = num(tokens[1]);
    let tail = tokens.slice(2);
    // A trailing colour word, as on `highlight`: `target 100 green`.
    const colorWord = tail[tail.length - 1]?.toLowerCase();
    const color =
      colorWord !== undefined && isRecognizedColorName(colorWord)
        ? colorWord
        : undefined;
    if (color) tail = tail.slice(0, -1);
    const below = tail.length === 1 && tail[0] === 'below';
    if (value === null || (tail.length > 0 && !below)) {
      diagnostics.push(
        emit(OVERLAY_BAD_N_DX, lineNumber, {
          overlay: 'target',
          need: 'a value, then `below` if lower is better, then a colour name',
          form: 'target 100 below green',
        })
      );
      return true;
    }
    return {
      kind,
      value,
      ...(below && { below }),
      ...(color && { color }),
      lineNumber,
    };
  }
  if (kind === 'moving-average') {
    const n = num(tokens[1]);
    if (tokens.length !== 2 || n === null || !Number.isInteger(n) || n < 2) {
      diagnostics.push(
        emit(OVERLAY_BAD_N_DX, lineNumber, {
          overlay: 'moving-average',
          need: 'a whole number of points, 2 or more',
          form: 'moving-average 3',
        })
      );
      return true;
    }
    return { kind, value: n, lineNumber };
  }
  // A bare overlay takes nothing after it; a number makes it a data row.
  if (tokens.length > 1) return null;
  return { kind, lineNumber };
}

/**
 * A bare lowercase word that reads like an overlay but is not one. Called on
 * a line nothing else took, so it never steals a data row.
 */
export function unknownOverlay(
  trimmed: string,
  lineNumber: number
): DgmoError | null {
  if (!/^[a-z][a-z-]*$/.test(trimmed)) return null;
  const known = Object.prototype.hasOwnProperty.call(NEAR_MISSES, trimmed);
  const close = known ? null : suggest(trimmed, KINDS);
  if (!known && !close) return null;
  const to = known ? NEAR_MISSES[trimmed] : undefined;
  const highLow = ['extremes', 'extreme', 'extrema', 'min-max'].includes(
    trimmed
  );
  return emit(OVERLAY_UNKNOWN_DX, lineNumber, {
    word: trimmed,
    hint: highLow
      ? 'A line chart marks each series’ high and low by default; `no-extremes` hides them.'
      : to
        ? `Did you mean '${to}'?`
        : (close ?? ''),
  });
}

/** What a chart's layout says about which overlays it can take. */
export interface OverlayHost {
  readonly type: string;
  /** A stacked layout: the drawn heights are running totals. */
  readonly stacked?: boolean;
  /** The bar's `stack` / `group` block, if any. */
  readonly layout?: 'stack' | 'group';
}

/**
 * Keep the overlays the chart can draw. One per kind; a repeated one
 * replaces the earlier. A stacked chart takes none: its drawn heights are
 * running totals, so a per-series line would not sit on anything drawn.
 */
export function settleOverlays(
  overlays: readonly ChartOverlay[],
  host: OverlayHost,
  diagnostics: DgmoError[]
): ChartOverlay[] {
  const kept = new Map<OverlayKind, ChartOverlay>();
  for (const o of overlays) {
    const charts = OVERLAY_CHARTS[o.kind];
    if (!charts.includes(host.type)) {
      diagnostics.push(
        emit(OVERLAY_UNSUPPORTED_DX, o.lineNumber, {
          overlay: o.kind,
          supported: joinAnd(charts),
          chart: host.type,
        })
      );
      continue;
    }
    if (o.kind === 'pareto' && host.layout) {
      diagnostics.push(
        emit(OVERLAY_PARETO_SERIES_DX, o.lineNumber, { layout: host.layout })
      );
      continue;
    }
    if (host.stacked) {
      diagnostics.push(
        emit(OVERLAY_UNSUPPORTED_DX, o.lineNumber, {
          overlay: o.kind,
          supported: `unstacked ${joinAnd(charts)}`,
          chart: `a stacked ${host.type}`,
        })
      );
      continue;
    }
    kept.delete(o.kind);
    kept.set(o.kind, o);
  }
  return [...kept.values()];
}

function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
