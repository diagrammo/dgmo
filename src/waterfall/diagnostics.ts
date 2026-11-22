// ============================================================
// Waterfall diagnostic catalog (#1850)
// ============================================================
//
// Every coded diagnostic the waterfall parser emits, reached through
// `emit(WATERFALL_DX.<KEY>, line, params)`. Every message builder tolerates `{}`.

import type { DiagnosticSpec } from '../diagnostics';

export const WATERFALL_DX = {
  BAD_VALUE: {
    code: 'E_WATERFALL_BAD_VALUE',
    severity: 'error',
    chartType: 'waterfall',
    title: 'Value is not a number',
    message: (p) =>
      `'${(p.line as string) ?? 'line'}' has no number, and it is not a total.`,
    hint: 'End each step with a change (`Churn -180`), or write `total` to draw the running total (`FY25 total`).',
    example: `waterfall Revenue bridge\n\nFY24 1200 total\nChurn -180\nFY25 total`,
  },
  SIGNED_TOTAL: {
    code: 'W_WATERFALL_SIGNED_TOTAL',
    severity: 'warning',
    chartType: 'waterfall',
    title: 'A total carries a sign',
    message: (p) =>
      `'${(p.label as string) ?? 'This total'}' is a total, so ${(p.value as string) ?? 'its number'} is a level, not a change.`,
    hint: 'Drop the sign from a total row (`FY24 1200 total`), or drop `total` to make the row a step.',
    example: `waterfall Revenue bridge\n\nFY24 +1200 total`,
  },
  BAD_DIRECTION: {
    code: 'W_WATERFALL_BAD_DIRECTION',
    severity: 'warning',
    chartType: 'waterfall',
    title: 'Direction not understood',
    message: (p) =>
      `\`direction ${(p.value as string) ?? ''}\` is not a waterfall direction, so the line is ignored.`,
    hint: 'Write `direction down` for a cost bridge, where a rise is red and a fall green.',
    example: `waterfall Cost bridge\ndirection down\n\nBudget 820 total\nHeadcount +140`,
  },
  RECONCILE: {
    code: 'W_WATERFALL_RECONCILE',
    severity: 'warning',
    chartType: 'waterfall',
    title: 'The steps do not add up to the total',
    message: (p) =>
      `${(p.label as string) ?? 'This total'} is ${(p.value as string) ?? 'its number'} but the steps add up to ${(p.running as string) ?? 'another number'}.`,
    hint: 'Correct a step or the total, or write the total with no number (`FY25 total`) to draw the running total.',
    example: `waterfall Revenue bridge\n\nFY24 1200 total\nNew logos +340\nFY25 1500 total`,
  },
  NO_ROWS: {
    code: 'E_WATERFALL_NO_ROWS',
    severity: 'error',
    chartType: 'waterfall',
    title: 'Nothing to draw',
    message: () => 'The chart has no rows.',
    hint: 'Add a starting total and its steps, one per line: `FY24 1200 total`, then `New logos +340`.',
    example: `waterfall Revenue bridge\n\nFY24 1200 total\nNew logos +340\nFY25 total`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const WATERFALL_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(WATERFALL_DX);
