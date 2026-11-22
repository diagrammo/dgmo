// ============================================================
// waterfall/export.ts — this chart's export handler (#1850). d3.ts dispatches
// to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import { finalizeSvgExport, resolveExportPalette } from '../utils/d3-helpers';
import { beginVizExport, type ExportContext } from '../utils/export-context';
import { parseWaterfall } from './parser';
import { renderWaterfall } from './renderer';

export async function exportWaterfall(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseWaterfall(content);
  if (parsed.error || parsed.rows.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport(ctx);
  renderWaterfall(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    undefined,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
