// ============================================================
// cycle/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportCycle(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseCycle } = await import('./parser');
  const { renderCycleForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const cycleParsed = parseCycle(content);
  if (cycleParsed.error || cycleParsed.nodes.length === 0) return '';

  const container = createExportContainer(ctx.width, ctx.height);
  renderCycleForExport(
    container,
    cycleParsed,
    effectivePalette,
    ctx.isDark,
    { width: ctx.width, height: ctx.height },
    viewState,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
