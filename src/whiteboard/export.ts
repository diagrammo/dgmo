// ============================================================
// whiteboard/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportWhiteboard(ctx: ExportContext): Promise<string> {
  const { content, theme } = ctx;
  const { parseWhiteboard } = await import('./parser');
  const effectivePalette = await resolveExportPalette(theme, ctx.palette);
  const parsed = parseWhiteboard(content, effectivePalette);
  if (parsed.error || parsed.elements.length === 0) return '';
  const { renderWhiteboard } = await import('./renderer');
  // The renderer crops to the content, so the canvas size is its own.
  const container = createExportContainer(1, 1);
  const resolveImage = ctx.options?.resolveImage;
  const showNotes = ctx.options?.showNotes;
  renderWhiteboard(container, parsed, effectivePalette, ctx.isDark, {
    ...(resolveImage !== undefined && { resolveImage }),
    ...(showNotes !== undefined && { showNotes }),
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}
