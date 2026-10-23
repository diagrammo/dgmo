// ============================================================
// body/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';

export async function exportBody(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseBody } = await import('./parser');
  const { renderBodyForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const parsed = parseBody(content, effectivePalette);
  if (parsed.error) return '';

  const container = createExportContainer(ctx.width, ctx.height);
  renderBodyForExport(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    { width: ctx.width, height: ctx.height },
    ctxTagOverride(ctx)
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
