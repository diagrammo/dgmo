// ============================================================
// wordcloud/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import { finalizeSvgExport, resolveExportPalette } from '../utils/d3-helpers';
import { beginVizExport, type ExportContext } from '../utils/export-context';
import { parseWordcloud } from './parser';
import { renderWordCloudAsync } from './renderer';

export async function exportWordcloud(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseWordcloud(content, palette);
  if (parsed.error || parsed.words.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport(ctx);
  await renderWordCloudAsync(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
