// ============================================================
// bracket/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportBracket(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseBracket } = await import('./parser');
  const { renderBracketForExport, bracketExportDimensions } =
    await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const parsed = parseBracket(content, effectivePalette);
  if (parsed.error) return '';

  // Size the canvas to the bracket (fits at scale 1) instead of a fixed box, so
  // a small bracket isn't marooned in dead space nor a large one clipped.
  const { width, height } = bracketExportDimensions(parsed, effectivePalette);
  const container = createExportContainer(width, height);
  renderBracketForExport(container, parsed, effectivePalette, ctx.isDark, {
    width,
    height,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}
