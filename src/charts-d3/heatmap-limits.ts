// ============================================================
// heatmap — the row and column limits (#2445, owner's decision 2026-11-26)
// ============================================================
//
// Past these limits a heatmap's cells are specks and its row and column
// names cannot be read even thinned. The parser keeps the first
// HEATMAP_MAX_ROWS rows and the first HEATMAP_MAX_COLS columns and raises ONE
// error naming the counts. Not author-tunable: crowding is the renderer's
// decision (dgmo/CLAUDE.md → Output rules).

import type { DiagnosticMessageParams, DiagnosticSpec } from '../diagnostics';

/**
 * Most rows one heatmap draws. At the default canvas (EXPORT_HEIGHT 800, a
 * titled chart with its legend and rotated column names) the grid is about
 * 600px tall, so 50 rows give 12px cells: the row names thin to every other
 * one (renderHeatmap) and a hovered cell names its own row.
 */
export const HEATMAP_MAX_ROWS = 50;
/**
 * Most columns one heatmap draws. At the default canvas (EXPORT_WIDTH 1200)
 * the grid is about 1000px wide, so 50 columns give 20px cells — wider than
 * one rotated column-name line.
 */
export const HEATMAP_MAX_COLS = 50;

const describe = (p: DiagnosticMessageParams): string => {
  const rows = p.rows as number;
  const cols = p.cols as number;
  const parts: string[] = [];
  if (rows > HEATMAP_MAX_ROWS) parts.push(`${rows} rows`);
  if (cols > HEATMAP_MAX_COLS) parts.push(`${cols} columns`);
  const drawn: string[] = [];
  if (rows > HEATMAP_MAX_ROWS) drawn.push(`${HEATMAP_MAX_ROWS} rows`);
  if (cols > HEATMAP_MAX_COLS) drawn.push(`${HEATMAP_MAX_COLS} columns`);
  return `This heatmap has ${parts.join(' and ') || 'too many rows or columns'}; only the first ${drawn.join(' and ') || `${HEATMAP_MAX_ROWS} rows and ${HEATMAP_MAX_COLS} columns`} are drawn. Split the data into several heatmaps, or group rows and columns.`;
};

export const HEATMAP_DX = {
  TOO_LARGE: {
    code: 'E_HEATMAP_TOO_LARGE',
    severity: 'error',
    chartType: 'heatmap',
    title: 'Too many rows or columns',
    message: (p) => describe(p),
    hint: `Keep a heatmap to ${HEATMAP_MAX_ROWS} rows and ${HEATMAP_MAX_COLS} columns or fewer: split it into several heatmaps, or add neighbouring rows or columns up into one.`,
    example: `heatmap Load\ncolumns Mon Tue Wed\n\nWeb 3 5 2\nAPI 4 1 6`,
  },
} satisfies Record<string, DiagnosticSpec>;

export const HEATMAP_DIAGNOSTICS: DiagnosticSpec[] = Object.values(HEATMAP_DX);
