// ============================================================
// clock/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportClock(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseClock } = await import('./parser');
  const { renderClockForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const parsed = parseClock(content, effectivePalette);
  // Renders even without a valid row (only a hard first-line failure sets error).
  if (parsed.error) return '';

  const container = createExportContainer(ctx.width, ctx.height);
  renderClockForExport(container, parsed, effectivePalette, ctx.isDark, {
    width: ctx.width,
    height: ctx.height,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}
