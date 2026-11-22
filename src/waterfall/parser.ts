// ============================================================
// Waterfall parser — signed steps and running totals (#1850)
// ============================================================
//
//   waterfall Revenue bridge, FY24 → FY25 ($k)
//
//   FY24 1200 total
//   New logos +340
//   Churn -180
//   H1 subtotal total
//   FY25 total
//
// A row is `Label N` (a step: a bare number is a change, `+` is optional, `-`
// subtracts), `Label N total` (a total bar from zero at N, which SETS the
// running total) or `Label total` (a total bar at the running total so far).
// A trailing colour word on the label overrides the bar's hue (§1.5).
// Header options: `direction down`, `no-connectors`, `no-value`,
// `orientation-horizontal` (or `horizontal`), `format` / `unit` / `locale`,
// and the chart frame lines.

import { emit, formatDgmoError, makeFail, suggest } from '../diagnostics';
import { withPaletteLifted } from '../palettes/directive';
import type {
  DgmoError,
  DiagnosticParams,
  DiagnosticSpec,
} from '../diagnostics';
import type { Writable } from '../utils/brand';
import {
  parseChartFrameLine,
  takeFootnoteBlock,
} from '../utils/chart-frame-parse';
import { parseNumberFormatLine } from '../utils/number-format';
import { extractColor, parseFirstLine } from '../utils/parsing';
import { WATERFALL_DX } from './diagnostics';
import type { ParsedWaterfall, WaterfallRow } from './types';

const BOOLEAN_OPTIONS = new Set([
  'no-connectors',
  'no-value',
  'no-title',
  'orientation-horizontal',
  'horizontal',
]);
const OPTION_WORDS = [
  ...BOOLEAN_OPTIONS,
  'direction',
  'format',
  'unit',
  'locale',
  'palette',
];

/** A signed number: `340`, `+340`, `-180`, `−180` (true minus), `12.5`. */
const NUMBER_RE = /^([+\-−])?(\d+(?:\.\d*)?|\.\d+)$/;

/** Running totals are sums of decimals; round off the float noise. */
const tidy = (n: number): number => Math.round(n * 1e9) / 1e9;

export function parseWaterfall(content: string): ParsedWaterfall {
  return withPaletteLifted(content, (lifted) => parseWaterfallRaw(lifted));
}

function parseWaterfallRaw(content: string): ParsedWaterfall {
  const options: Record<string, string> = {};
  const result: Writable<ParsedWaterfall> & {
    diagnostics: DgmoError[];
    rows: WaterfallRow[];
  } = {
    type: 'waterfall',
    rows: [],
    directionDown: false,
    connectors: true,
    values: true,
    horizontal: false,
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
  let firstLineSeen = false;
  let running = 0;
  let rowsSeen = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    if (!firstLineSeen) {
      firstLineSeen = true;
      const firstLine = parseFirstLine(trimmed);
      if (firstLine) {
        if (firstLine.chartType !== 'waterfall') {
          let msg = `Expected chart type "waterfall", got "${firstLine.chartType}"`;
          const hint = suggest(firstLine.chartType, ['waterfall']);
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

    const tokens = trimmed.split(/\s+/);
    const word = tokens[0]!;
    const rest = trimmed.slice(word.length).trim();

    // ── Header options (lowercase, as every option is) ─────────
    if (BOOLEAN_OPTIONS.has(word) && !rest) {
      options[word] = 'on';
      if (word === 'no-connectors') result.connectors = false;
      else if (word === 'no-value') result.values = false;
      else if (word === 'orientation-horizontal' || word === 'horizontal')
        result.horizontal = true;
      continue;
    }
    if (word === 'direction') {
      if (rest.toLowerCase() === 'down') {
        result.directionDown = true;
        options['direction'] = 'down';
      } else {
        report(WATERFALL_DX.BAD_DIRECTION, lineNumber, { value: rest });
      }
      continue;
    }

    // ── A row: <label> [colour] [N] [total] ────────────────────
    const body = [...tokens];
    const isTotal = body.length >= 2 && body[body.length - 1] === 'total';
    if (isTotal) body.pop();
    const numMatch =
      body.length >= 2 ? NUMBER_RE.exec(body[body.length - 1]!) : null;
    const numToken = numMatch ? body.pop()! : null;
    if (!isTotal && !numToken) {
      const hint = tokens.length === 1 ? suggest(word, OPTION_WORDS) : null;
      report(WATERFALL_DX.BAD_VALUE, lineNumber, {
        line: hint ? `${trimmed}' (${hint})` : trimmed,
      });
      continue;
    }
    const { label, color } = extractColor(
      body.join(' '),
      undefined,
      diagnostics,
      lineNumber
    );
    const signed = numMatch?.[1];
    const magnitude = numMatch ? Number(numMatch[2]) : 0;
    const value = signed === '-' || signed === '−' ? -magnitude : magnitude;
    const first = rowsSeen === 0;
    rowsSeen++;

    let row: WaterfallRow;
    if (isTotal) {
      let level = running;
      if (numToken !== null) {
        if (signed)
          report(WATERFALL_DX.SIGNED_TOTAL, lineNumber, {
            label,
            value: numToken,
          });
        level = value;
        // A total after the first row that disagrees with the walk is drawn
        // as written, and reported: the bridge does not add up.
        if (!first && tidy(level) !== tidy(running))
          report(WATERFALL_DX.RECONCILE, lineNumber, {
            label,
            value: String(tidy(level)),
            running: String(tidy(running)),
          });
      }
      running = tidy(level);
      row = {
        label,
        kind: 'total',
        value: running,
        from: 0,
        to: running,
        lineNumber,
      };
    } else {
      const from = running;
      running = tidy(running + value);
      row = {
        label,
        kind: value < 0 ? 'fall' : 'rise',
        value,
        from,
        to: running,
        lineNumber,
      };
    }
    // The colour NAME is kept: it resolves against the palette at render time.
    if (color !== undefined) row = { ...row, color: body[body.length - 1]! };
    result.rows.push(row);
  }

  if (result.rows.length === 0 && result.error === null)
    report(WATERFALL_DX.NO_ROWS, 1, {});
  return result;
}
