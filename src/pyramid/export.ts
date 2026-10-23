// ============================================================
// pyramid/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportPyramid(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parsePyramid } = await import('./parser');
  const { renderPyramidForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const pyramidParsed = parsePyramid(content);
  if (pyramidParsed.error || pyramidParsed.layers.length === 0) return '';

  const container = createExportContainer(ctx.width, ctx.height);
  renderPyramidForExport(
    container,
    pyramidParsed,
    effectivePalette,
    ctx.isDark,
    { width: ctx.width, height: ctx.height }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
