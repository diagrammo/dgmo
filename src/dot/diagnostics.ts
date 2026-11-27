// ============================================================
// Dot diagnostic catalog (#1849)
// ============================================================
//
// Every coded diagnostic the dot parser emits, reached through
// `emit(DOT_DX.<KEY>, line, params)`. Every message builder tolerates `{}`.

import type { DiagnosticSpec } from '../diagnostics';

/**
 * Most rows one dot chart draws (#2432, owner's decision 2026-11-26). Past it
 * the first that many are drawn and an error names the count. Not
 * author-tunable: crowding is the renderer's decision.
 */
export const DOT_MAX_ROWS = 50;

export const DOT_DX = {
  BAD_VALUE: {
    code: 'E_DOT_BAD_VALUE',
    severity: 'error',
    chartType: 'dot',
    title: 'Row has no value',
    message: (p) =>
      `'${(p.line as string) ?? 'line'}' has no number after its name.`,
    hint: 'End each row with its value, or one value per series: `Engineering 71 78`.',
    example: `dot Engagement score\nseries 2020, 2025\n\nEngineering 71 78`,
  },
  VALUE_COUNT: {
    code: 'W_DOT_VALUE_COUNT',
    severity: 'warning',
    chartType: 'dot',
    title: 'Row has the wrong number of values',
    message: (p) =>
      `'${(p.label as string) ?? 'This row'}' has ${(p.count as number) ?? 0} value(s) but the chart has ${(p.expected as number) ?? 1}, so the row is not drawn.`,
    hint: 'Give every row one value per `series` name, or add a `series` line naming each column.',
    example: `dot Engagement score\nseries 2020, 2025\n\nEngineering 71 78\nSales 64`,
  },
  GAP_ONE_SERIES: {
    code: 'W_DOT_GAP_ONE_SERIES',
    severity: 'warning',
    chartType: 'dot',
    title: 'A gap needs two series',
    message: (p) =>
      `\`${(p.directive as string) ?? 'gap'}\` needs two or more series, and this chart has one, so the line is ignored.`,
    hint: 'Add a `series` line naming two columns (`series 2020, 2025`) and a second value on each row.',
    example: `dot Median salary\ngap\n\nStaff engineer 212`,
  },
  SORT_UNKNOWN_SERIES: {
    code: 'W_DOT_SORT_UNKNOWN_SERIES',
    severity: 'warning',
    chartType: 'dot',
    title: 'Sort names no series',
    message: (p) =>
      `\`sort ${(p.value as string) ?? ''}\` names no series, so the rows stay as written.`,
    hint: 'Sort by `gap`, `name`, or one of the `series` names.',
    example: `dot Engagement score\nseries 2020, 2025\nsort 2030\n\nEngineering 71 78`,
  },
  CONNECTOR_ONE_SERIES: {
    code: 'W_DOT_CONNECTOR_ONE_SERIES',
    severity: 'warning',
    chartType: 'dot',
    title: 'A connector needs two series',
    message: () =>
      '`connector direction` needs two or more series, and this chart has one, so the line is ignored.',
    hint: 'Add a `series` line naming two columns and a second value on each row, or drop the line.',
    example: `dot Median salary\nconnector direction\n\nStaff engineer 212`,
  },
  BAD_CONNECTOR: {
    code: 'W_DOT_BAD_CONNECTOR',
    severity: 'warning',
    chartType: 'dot',
    title: 'Connector not understood',
    message: (p) =>
      `\`connector ${(p.value as string) ?? ''}\` is not a connector colour, so the connectors stay grey.`,
    hint: 'Write `connector direction` (a rise green, a fall red), or `connector direction down` when a fall is good.',
    example: `dot Engagement score\nseries 2020, 2025\nconnector direction\n\nEngineering 71 78`,
  },
  NO_ROWS: {
    code: 'E_DOT_NO_ROWS',
    severity: 'error',
    chartType: 'dot',
    title: 'Nothing to draw',
    message: () => 'The chart has no rows.',
    hint: 'Add one row per category, a name and its value: `Staff engineer 212`.',
    example: `dot Median salary ($k)\n\nStaff engineer 212\nDesigner 141`,
  },
  TOO_MANY_ROWS: {
    code: 'E_DOT_TOO_MANY_ROWS',
    severity: 'error',
    chartType: 'dot',
    title: 'Too many rows',
    message: (p) =>
      `This dot chart has ${(p.count as number) ?? 'too many'} rows; only the first ${DOT_MAX_ROWS} are drawn. Split the data into several charts.`,
    hint: `Keep a dot chart to ${DOT_MAX_ROWS} rows or fewer: split it into several charts, or keep the rows that matter most.`,
    example: `dot Median salary ($k)\n\nStaff engineer 212\nDesigner 141`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const DOT_DIAGNOSTICS: DiagnosticSpec[] = Object.values(DOT_DX);
