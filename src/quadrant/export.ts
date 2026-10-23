// ============================================================
// quadrant/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import { finalizeSvgExport, resolveExportPalette } from '../utils/d3-helpers';
import { beginVizExport, type ExportContext } from '../utils/export-context';
import { parseQuadrant } from './parser';
import { renderQuadrant } from './renderer';

export async function exportQuadrant(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseQuadrant(content, palette);
  if (parsed.error || parsed.quadrantPoints.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport(ctx);
  renderQuadrant(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    undefined,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
