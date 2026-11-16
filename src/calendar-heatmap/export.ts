// ============================================================
// calendar-heatmap/export.ts — this chart's export handler. d3.ts dispatches
// to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import { finalizeSvgExport, resolveExportPalette } from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportCalendarHeatmap(
  ctx: ExportContext
): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseCalendarHeatmap } = await import('./parser');
  const { renderCalendarHeatmap } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const parsed = parseCalendarHeatmap(content);
  if (parsed.error) return '';

  // The renderer sizes itself from its content, so no width or height is passed.
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  renderCalendarHeatmap(container, parsed, effectivePalette, ctx.isDark, {
    exportMode: true,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}
