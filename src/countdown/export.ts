// ============================================================
// countdown/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportCountdown(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseCountdown } = await import('./parser');
  const { renderCountdownForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const parsed = parseCountdown(content, effectivePalette);
  // Renders even without a valid target (— shell); only a hard parse failure
  // (wrong first line) sets parsed.error.
  if (parsed.error) return '';

  const container = createExportContainer(ctx.width, ctx.height);
  renderCountdownForExport(container, parsed, effectivePalette, ctx.isDark, {
    width: ctx.width,
    height: ctx.height,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}
