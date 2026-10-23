// ============================================================
// venn/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import { finalizeSvgExport, resolveExportPalette } from '../utils/d3-helpers';
import { beginVizExport, type ExportContext } from '../utils/export-context';
import { parseVenn } from './parser';
import { renderVenn } from './renderer';

export async function exportVenn(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseVenn(content, palette);
  if (parsed.error || parsed.vennSets.length < 2) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport(ctx);
  renderVenn(container, parsed, effectivePalette, ctx.isDark, undefined, dims);
  return finalizeSvgExport(container, theme, effectivePalette);
}
