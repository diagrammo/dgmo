// Data-row comma migration for the `dgmo migrate` tool.
//
// 1.0 freeze: data-chart value separators are space-only and thousands
// commas are dropped (see `dgmo-language-spec-decisions.md` §"Silently-accepted
// dual forms" — Comma-row reconciliation). This module rewrites the VALUE
// region of a data-chart row, stripping value-separator and thousands commas
// while leaving everything else (label, trailing color word, arrow source/
// target, alias) byte-identical.
//
// Surgery, not re-parse: we never reconstruct the line from parsed values, so
// colors, aliases, and arrow endpoints survive verbatim. We only touch the
// trailing run of numeric value tokens.

import { RECOGNIZED_COLOR_NAMES } from '../colors';

/** Data-chart types whose rows carry comma-separable numeric values. */
export const DATA_COMMA_CHART_TYPES = new Set<string>([
  // Simple charts (chart.ts)
  'bar',
  'line',
  'multi-line',
  'pie',
  'doughnut',
  'area',
  'polar-area',
  'radar',
  'bar-stacked',
  // Extended charts (echarts.ts)
  'scatter',
  'heatmap',
  'sankey',
  'chord',
  'funnel',
  // Visualizations (d3 / visualizations/parse.ts)
  'quadrant',
  'slope',
  'arc',
  'wordcloud',
]);

const COLOR_SET = new Set<string>(RECOGNIZED_COLOR_NAMES);

/**
 * A token that is a numeric value, optionally carrying comma/underscore digit
 * grouping. Accepts an optional leading `-`, optional trailing comma (the
 * separator glued to the value, e.g. `400,`), and decimals.
 */
const NUMERIC_VALUE_RE = /^-?\d[\d,_]*(?:\.\d+)?,?$/;

/** True iff `tok` is a bare numeric value token (modulo grouping/separators). */
function isNumericValueToken(tok: string): boolean {
  if (!NUMERIC_VALUE_RE.test(tok)) return false;
  // Must contain at least one digit (guards against `,` alone).
  return /\d/.test(tok);
}

/**
 * Rewrite the value region of a single data-chart row, removing value-separator
 * and thousands commas. Returns the comma-free line plus whether it changed.
 * Lines without a comma in the value region are returned unchanged.
 *
 * The value region is the maximal trailing run of numeric value tokens
 * (whitespace-separated, each optionally comma-grouped or comma-suffixed),
 * optionally preceded — for the trailing-color-after-value forms — by nothing
 * (a trailing color word sits AFTER values and is preserved verbatim because it
 * is not numeric and stops the scan from the right).
 */
export function migrateDataRowCommaLine(line: string): {
  line: string;
  changed: boolean;
} {
  // Preserve exact leading indentation.
  const indentMatch = line.match(/^[ \t]*/);
  const indent = indentMatch ? indentMatch[0] : '';
  const body = line.substring(indent.length);
  if (!body || body.startsWith('//')) return { line, changed: false };

  // Split into whitespace tokens, keeping a simple structure. Commas may be
  // glued to tokens (`400,`) or stand between number tokens after a comma-split
  // — we normalize by splitting on whitespace then handling glued commas.
  const tokens = body.split(/\s+/);
  if (tokens.length < 2) return { line, changed: false };

  // Walk from the right collecting the value region. A trailing color word is
  // allowed as the very last token (sankey link color / data-point color) and
  // is kept verbatim — we resume value collection before it.
  let i = tokens.length - 1;

  // Peel an optional trailing color word (kept as-is, not a value).
  if (i >= 1 && COLOR_SET.has(tokens[i]!)) {
    i--;
  }

  const valueStart = ((): number => {
    let j = i;
    while (j >= 1 && isNumericValueToken(tokens[j]!)) j--;
    return j + 1; // first value-token index
  })();

  // No value region (need at least one numeric token, and a label before it).
  if (valueStart > i || valueStart < 1) return { line, changed: false };

  // The value tokens are tokens[valueStart..i]. Detect any comma among them.
  const valueTokens = tokens.slice(valueStart, i + 1);
  const hasComma = valueTokens.some((t) => t.includes(','));
  if (!hasComma) return { line, changed: false };

  // Strip commas: each numeric token loses its thousands/separator commas.
  // A token like `400,` → `400`; `1,000` → `1000`; `1,234.56` → `1234.56`.
  const cleaned = valueTokens.map((t) => t.replace(/,/g, ''));

  // Rebuild: label (tokens before valueStart) + cleaned values + verbatim tail.
  const labelPart = tokens.slice(0, valueStart);
  const tail = tokens.slice(i + 1); // trailing color word(s), verbatim
  const rebuiltBody = [...labelPart, ...cleaned, ...tail].join(' ');
  return { line: indent + rebuiltBody, changed: rebuiltBody !== body };
}
