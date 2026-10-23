// ============================================================
// journey-map/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportJourneyMap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, exportMode } = ctx;
  const { parseJourneyMap } = await import('./parser');
  const { renderJourneyMap } = await import('./renderer');
  const { layoutJourneyMap } = await import('./layout');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const jmParsed = parseJourneyMap(content, effectivePalette);
  if (
    jmParsed.error ||
    (jmParsed.phases.length === 0 && jmParsed.steps.length === 0)
  )
    return '';

  const jmLayout = layoutJourneyMap(jmParsed, effectivePalette, {
    isDark: ctx.isDark,
  });
  const container = createExportContainer(
    jmLayout.totalWidth,
    jmLayout.totalHeight
  );
  renderJourneyMap(container, jmParsed, effectivePalette, ctx.isDark, {
    exportDims: { width: jmLayout.totalWidth, height: jmLayout.totalHeight },
    exportMode,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}
