// ============================================================
// Dot parser — values as dots on one scale (#1849)
// ============================================================
//
//   dot Engagement score by department
//   series 2020, 2025
//   sort gap
//   gap
//
//   Engineering 71 78
//   Sales 64 61
//
// A row is `Label v1 [v2 …]`: one value per `series` name, or a single value
// with no `series` line. One value draws a dot plot, two a dumbbell, three or
// more a strip. Header options: `series` (one line or an indented block,
// colour words allowed), `sort gap|name|<series>`, `gap`,
// `connector direction [down]`, `x-axis <min>..<max> [log]`,
// `format` / `unit` / `locale`, `no-title`, and the chart frame lines.

import { emit, formatDgmoError, makeFail, suggest } from '../diagnostics';
import { withPaletteLifted } from '../palettes/directive';
import type {
  DgmoError,
  DiagnosticParams,
  DiagnosticSpec,
} from '../diagnostics';
import {
  parseAxisLine,
  settleAxisSpec,
  type AxisName,
  type AxisSpecs,
} from '../utils/axis-spec';
import type { Writable } from '../utils/brand';
import {
  parseChartFrameLine,
  takeFootnoteBlock,
} from '../utils/chart-frame-parse';
import { parseNumberFormatLine } from '../utils/number-format';
import {
  collectIndentedValues,
  extractColor,
  parseFirstLine,
} from '../utils/parsing';
import { DOT_DX } from './diagnostics';
import type { DotRow, DotSeries, DotSort, ParsedDot } from './types';

const OPTION_WORDS = [
  'series',
  'sort',
  'gap',
  'connector',
  'x-axis',
  'format',
  'unit',
  'locale',
  'no-title',
  'palette',
];

/** A number: `71`, `-3`, `−3` (true minus), `12.5`, `1,200`. */
const NUMBER_RE = /^([+\-−])?(\d[\d,]*(?:\.\d*)?|\.\d+)$/;
const X_ONLY: ReadonlySet<AxisName> = new Set<AxisName>(['x']);

function toNumber(token: string): number | null {
  const m = NUMBER_RE.exec(token);
  if (!m) return null;
  const n = Number(m[2]!.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return m[1] === '-' || m[1] === '−' ? -n : n;
}

/** Last value minus first: the gap `gap` prints and `sort gap` orders by. */
export function dotGap(row: Pick<DotRow, 'values'>): number {
  const v = row.values;
  return v.length < 2 ? 0 : v[v.length - 1]! - v[0]!;
}

export function parseDot(content: string): ParsedDot {
  return withPaletteLifted(content, (lifted) => parseDotRaw(lifted));
}

function parseDotRaw(content: string): ParsedDot {
  const options: Record<string, string> = {};
  const result: Writable<ParsedDot> & {
    diagnostics: DgmoError[];
    rows: DotRow[];
    series: DotSeries[];
  } = {
    type: 'dot',
    series: [],
    rows: [],
    gap: false,
    connector: 'grey',
    options,
    diagnostics: [],
    error: null,
  };
  const diagnostics = result.diagnostics;
  const fail = makeFail(result);

  const report = (
    spec: DiagnosticSpec,
    line: number,
    params: DiagnosticParams
  ): void => {
    const diag = emit(spec, line, params);
    diagnostics.push(diag);
    if (diag.severity === 'error') result.error ??= formatDgmoError(diag);
  };

  if (!content?.trim()) return fail(0, 'No content provided');

  const lines = content.split('\n');
  takeFootnoteBlock(result, lines, diagnostics);
  const axes: AxisSpecs = {};
  let firstLineSeen = false;
  let sortWord: { value: string; lineNumber: number } | undefined;
  let gapLine: number | undefined;
  let connectorLine: number | undefined;
  /** Rows as read, before the value count is checked against `series`. */
  const read: (DotRow & { raw?: string[] })[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!firstLineSeen) {
      firstLineSeen = true;
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        if (firstLine.chartType !== 'dot') {
          let msg = `Expected chart type "dot", got "${firstLine.chartType}"`;
          const hint = suggest(firstLine.chartType, ['dot']);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        if (firstLine.title) {
          result.title = firstLine.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
    }

    if (parseChartFrameLine(result, line, lineNumber, diagnostics)) continue;
    if (parseNumberFormatLine(trimmed, lineNumber, result, diagnostics))
      continue;
    if (parseAxisLine(trimmed, lineNumber, axes, X_ONLY, diagnostics)) continue;

    const tokens = trimmed.split(/\s+/);
    const word = tokens[0]!;
    const rest = trimmed.slice(word.length).trim();

    // ── Header options (lowercase, as every option is) ─────────
    if (word === 'no-title' && !rest) {
      options['no-title'] = 'on';
      continue;
    }
    if (word === 'gap' && !rest) {
      options['gap'] = 'on';
      result.gap = true;
      gapLine = lineNumber;
      continue;
    }
    if (word === 'series') {
      const names = rest
        ? rest
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : null;
      let raw: string[];
      let at: number[];
      if (names) {
        raw = names;
        at = names.map(() => lineNumber);
      } else {
        const block = collectIndentedValues(lines, i);
        i = block.newIndex;
        raw = block.values;
        at = block.lineNumbers;
      }
      result.series = raw.map((r, k) => {
        const { label, color } = extractColor(r, undefined, diagnostics, at[k]);
        return {
          name: label,
          // The colour NAME is kept: it resolves against the palette when drawn.
          ...(color !== undefined && { color: r.split(/\s+/).pop()! }),
          lineNumber: at[k]!,
        };
      });
      options['series'] = result.series.map((s) => s.name).join(', ');
      continue;
    }
    if (word === 'sort' && rest) {
      sortWord = { value: rest, lineNumber };
      continue;
    }
    if (word === 'connector') {
      const v = rest.toLowerCase().replace(/\s+/g, ' ');
      if (v === 'direction' || v === 'direction down') {
        result.connector = v === 'direction' ? 'direction' : 'direction-down';
        options['connector'] = v;
        connectorLine = lineNumber;
      } else {
        report(DOT_DX.BAD_CONNECTOR, lineNumber, { value: rest });
      }
      continue;
    }

    // ── A row: <label> <v1> [v2 …] ─────────────────────────────
    const values: number[] = [];
    const raw: string[] = [];
    while (tokens.length > 1) {
      const n = toNumber(tokens[tokens.length - 1]!);
      if (n === null) break;
      values.unshift(n);
      raw.unshift(tokens.pop()!);
    }
    if (values.length === 0) {
      const hint = tokens.length === 1 ? suggest(word, OPTION_WORDS) : null;
      report(DOT_DX.BAD_VALUE, lineNumber, {
        line: hint ? `${trimmed}' (${hint})` : trimmed,
      });
      continue;
    }
    read.push({ label: tokens.join(' '), values, raw, lineNumber });
  }

  // ── Every row carries one value per series ───────────────────
  const expected = Math.max(1, result.series.length);
  for (const r of read) {
    const { raw, ...base } = r;
    let row: DotRow = base;
    // A label may end in a number (`Windows 11 45 50` under two series):
    // once `series` fixes the count, leading extras belong to the label.
    // With no `series` line the count is a guess, so it stays a warning.
    if (result.series.length > 0 && row.values.length > expected && raw) {
      const extra = row.values.length - expected;
      row = {
        ...row,
        label: [row.label, ...raw.slice(0, extra)].join(' '),
        values: row.values.slice(extra),
      };
    }
    if (row.values.length === expected) result.rows.push(row);
    else
      report(DOT_DX.VALUE_COUNT, row.lineNumber, {
        label: row.label,
        count: row.values.length,
        expected,
      });
  }

  // ── Options that need two series ─────────────────────────────
  const multi = expected >= 2;
  if (!multi && gapLine !== undefined) {
    report(DOT_DX.GAP_ONE_SERIES, gapLine, { directive: 'gap' });
    result.gap = false;
    delete options['gap'];
  }
  if (!multi && connectorLine !== undefined) {
    report(DOT_DX.CONNECTOR_ONE_SERIES, connectorLine, {});
    result.connector = 'grey';
    delete options['connector'];
  }

  // ── Sort ─────────────────────────────────────────────────────
  if (sortWord) {
    const v = sortWord.value;
    let sort: DotSort | undefined;
    if (v === 'gap') {
      if (multi) sort = { by: 'gap' };
      else
        report(DOT_DX.GAP_ONE_SERIES, sortWord.lineNumber, {
          directive: 'sort gap',
        });
    } else if (v === 'name') {
      sort = { by: 'name' };
    } else {
      const index = result.series.findIndex((s) => s.name === v);
      if (index >= 0) sort = { by: 'series', index };
      else
        report(DOT_DX.SORT_UNKNOWN_SERIES, sortWord.lineNumber, { value: v });
    }
    if (sort) {
      result.sort = sort;
      options['sort'] = v;
      const key = (r: DotRow): number =>
        sort.by === 'gap'
          ? dotGap(r)
          : sort.by === 'series'
            ? r.values[sort.index]!
            : 0;
      // Array.prototype.sort is stable, so ties keep their written order.
      result.rows.sort(
        sort.by === 'name'
          ? (a, b) => a.label.localeCompare(b.label)
          : (a, b) => key(b) - key(a)
      );
    }
  }

  // ── The x-axis range, settled against every value drawn ──────
  if (axes.x) {
    settleAxisSpec(
      'x',
      axes.x,
      result.rows.flatMap((r) => r.values),
      diagnostics
    );
    result.xAxis = axes.x;
  }

  if (result.rows.length === 0 && result.error === null)
    report(DOT_DX.NO_ROWS, 1, {});
  return result;
}
