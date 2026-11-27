// ============================================================
// slope — the row limit (#2465)
// ============================================================
//
// Every slope row draws a label at each end, stacked down the plot. Past
// MAX_SLOPE_ROWS the stack cannot fit at the smallest readable size, so the
// labels run past the top and bottom of the canvas and the lines form a
// tangle no row can be followed through. The parser keeps the first
// MAX_SLOPE_ROWS rows and raises an error on the first row over it. Not
// author-tunable: crowding is the renderer's decision (dgmo/CLAUDE.md →
// Output rules).

import type { DiagnosticSpec } from '../diagnostics';
import { MIN_READABLE_TYPE_PX } from '../utils/text-measure';

/**
 * Smallest end-label font the renderer steps down to: the shared readable
 * floor (MIN_READABLE_TYPE_PX, 11px).
 */
export const SLOPE_MIN_LABEL_PX = MIN_READABLE_TYPE_PX;

/**
 * Most rows one slope chart draws. How it was chosen (2026-11-27): a titled
 * chart on the default sheet (EXPORT_HEIGHT 800) starts its plot at
 * FRAME_BODY_TOP 60 + period header 15 + period font 18 = 93px and keeps a
 * 40px bottom margin, so the plot is 667px tall. One end label at the floor
 * takes 11 × 1.4 = 15.4px plus a 4px gap, and N labels need
 * N × 19.4 − 4 ≤ 667: N ≤ 34.6. 34 rows fit; 35 take 675px and push the top
 * label above the plot (tests/slope-row-limit.test.ts measures both).
 */
export const MAX_SLOPE_ROWS = 34;

export const SLOPE_DX = {
  TOO_MANY_ROWS: {
    code: 'E_SLOPE_TOO_MANY_ROWS',
    severity: 'error',
    chartType: 'slope',
    title: 'Too many rows',
    message: (p) =>
      `This slope chart has ${(p.count as number) ?? 'too many'} rows; only the first ${MAX_SLOPE_ROWS} are drawn. Keep the rows that matter and mark a few with highlight, or use a line chart for many series.`,
    hint: `Keep a slope chart to ${MAX_SLOPE_ROWS} rows or fewer: cut it to the rows that matter and mark a few with highlight, or use a line chart.`,
    example: `slope Market share\nhighlight Acme\nperiod 2020 2025\n\nAcme 12 31\nOrbit 28 22\nSummit 18 15`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const SLOPE_DIAGNOSTICS: DiagnosticSpec[] = Object.values(SLOPE_DX);
