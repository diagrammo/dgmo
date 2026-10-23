// ============================================================
// tech-radar/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportTechRadar(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseTechRadar } = await import('./parser');
  const { renderTechRadarForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const radarParsed = parseTechRadar(content);
  if (radarParsed.error || radarParsed.quadrants.length === 0) return '';

  // 1300x1500 is the radar's own natural size, not the shared default — so it
  // takes the caller's request when there is one and its own when there is not.
  const RADAR_EXPORT_W = ctx.requestedWidth ?? 1300;
  const RADAR_EXPORT_H = ctx.requestedHeight ?? 1500;
  const container = createExportContainer(RADAR_EXPORT_W, RADAR_EXPORT_H);
  renderTechRadarForExport(
    container,
    radarParsed,
    effectivePalette,
    ctx.isDark,
    { width: RADAR_EXPORT_W, height: RADAR_EXPORT_H },
    viewState,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
