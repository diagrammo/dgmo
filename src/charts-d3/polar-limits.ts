// ============================================================
// polar-area — the wedge limit (#2457, owner's decision 2026-11-26)
// ============================================================
//
// Past MAX_POLAR_AREA_WEDGES a polar-area chart is a starburst of hair-thin
// wedges whose labels pile into an overprinted ring. The parser keeps the
// first MAX_POLAR_AREA_WEDGES wedges and raises an error naming the count.
// A hard limit, not an "Other" wedge: polar-area wedges are not parts of a
// whole. Not author-tunable: crowding is the renderer's decision
// (dgmo/CLAUDE.md → Output rules).

import type { DiagnosticSpec } from '../diagnostics';

/**
 * Most wedges one polar-area chart draws. How it was chosen: the labels sit
 * on one ring at `outerR + 14`, about 345px at the default 1200×800 canvas.
 * Nearest the top and bottom, two neighbouring labels are separated only
 * vertically, by `r·(cos(step/2) − cos(3·step/2))`. At 24 wedges (15° steps)
 * that is ~23px, clear of a 13px label line; at 36 (10°) it is ~10px and the
 * labels overprint. 24 also holds 12 months or 24 hours.
 */
export const MAX_POLAR_AREA_WEDGES = 24;

export const POLAR_AREA_DX = {
  TOO_MANY_WEDGES: {
    code: 'E_POLAR_AREA_TOO_MANY_WEDGES',
    severity: 'error',
    chartType: 'polar-area',
    title: 'Too many wedges',
    message: (p) =>
      `This polar-area chart has ${(p.count as number) ?? 'too many'} wedges; only the first ${MAX_POLAR_AREA_WEDGES} are drawn. Use a bar chart for a long list of categories.`,
    hint: `Keep a polar-area chart to ${MAX_POLAR_AREA_WEDGES} wedges or fewer. For a long list of categories, use a bar chart.`,
    example: `bar Incidents by category\n\nNetwork 42\nStorage 31\nAuth 17`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const POLAR_AREA_DIAGNOSTICS: DiagnosticSpec[] =
  Object.values(POLAR_AREA_DX);
