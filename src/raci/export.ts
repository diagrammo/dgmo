// ============================================================
// raci/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportRaci(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseRaci } = await import('./parser');
  const { renderRaciForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const raciParsed = parseRaci(content, effectivePalette);
  if (raciParsed.error) return '';

  const container = createExportContainer(ctx.width, ctx.height);
  renderRaciForExport(container, raciParsed, effectivePalette, ctx.isDark, {
    width: ctx.width,
    height: ctx.height,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}
