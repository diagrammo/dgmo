// ============================================================
// bar — the category limit (#2419, owner's decision 2026-11-26)
// ============================================================
//
// Past BAR_MAX_CATEGORIES a bar chart draws hair-width bars and unreadable
// labels. The parser keeps the first BAR_MAX_CATEGORIES categories and raises
// an error naming the count. Not author-tunable: crowding is the renderer's
// decision (dgmo/CLAUDE.md → Output rules).

import type { DiagnosticSpec } from '../diagnostics';

/** Most categories one bar chart draws. Grouped and stacked count categories, not bars. */
export const BAR_MAX_CATEGORIES = 50;

export const BAR_DX = {
  TOO_MANY_CATEGORIES: {
    code: 'E_BAR_TOO_MANY_CATEGORIES',
    severity: 'error',
    chartType: 'bar',
    title: 'Too many categories',
    message: (p) =>
      `This bar chart has ${(p.count as number) ?? 'too many'} categories; only the first ${BAR_MAX_CATEGORIES} are drawn. Split the data into several charts, or group the small ones.`,
    hint: `Keep a bar chart to ${BAR_MAX_CATEGORIES} categories or fewer: split it into several charts, or add the small categories up into one row.`,
    example: `bar Sales by region\n\nNorth 120\nSouth 95\nEast 80`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const BAR_DIAGNOSTICS: DiagnosticSpec[] = Object.values(BAR_DX);
