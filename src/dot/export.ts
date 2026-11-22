// ============================================================
// dot/export.ts — this chart's export handler (#1849). d3.ts dispatches
// to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import { finalizeSvgExport, resolveExportPalette } from '../utils/d3-helpers';
import { beginVizExport, type ExportContext } from '../utils/export-context';
import { parseDot } from './parser';
import { renderDot } from './renderer';

export async function exportDot(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseDot(content);
  if (parsed.error || parsed.rows.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport(ctx);
  renderDot(container, parsed, effectivePalette, ctx.isDark, undefined, dims);
  return finalizeSvgExport(container, theme, effectivePalette);
}
