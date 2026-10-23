// ============================================================
// block/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportBlock(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseBlock } = await import('./parser');
  const { renderBlockForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const blockParsed = parseBlock(content, effectivePalette);
  if (blockParsed.error || blockParsed.top.rows.length === 0) return '';

  const container = createExportContainer(ctx.width, ctx.height);
  renderBlockForExport(container, blockParsed, effectivePalette, ctx.isDark, {
    width: ctx.width,
    height: ctx.height,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}
