// ============================================================
// event-line/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';

export async function exportEventLine(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseEventLine } = await import('./parser');
  const { renderEventLineForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const parsed = parseEventLine(content, effectivePalette);
  if (parsed.error || parsed.events.length === 0) return '';

  const container = createExportContainer(ctx.width, ctx.height);
  renderEventLineForExport(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    { width: ctx.width, height: ctx.height },
    ctxTagOverride(ctx),
    new Date()
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
