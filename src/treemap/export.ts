// ============================================================
// treemap/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportTreemap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseTreemap } = await import('./parser');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const treemapParsed = parseTreemap(content, effectivePalette);
  if (treemapParsed.error || treemapParsed.roots.length === 0) return '';

  // Headless export: full tree (no depth window), source-declared color mode.
  const container = createExportContainer(ctx.width, ctx.height);
  const dims = { width: ctx.width, height: ctx.height };

  if (treemapParsed.options.radial) {
    // Sunburst mode: parallel lazy imports of the radial layout + renderer.
    const { renderTreemapRadialForExport } = await import('./renderer-radial');
    renderTreemapRadialForExport(
      container,
      treemapParsed,
      effectivePalette,
      ctx.isDark,
      dims
    );
  } else {
    const { renderTreemapForExport } = await import('./renderer');
    renderTreemapForExport(
      container,
      treemapParsed,
      effectivePalette,
      ctx.isDark,
      dims
    );
  }
  return finalizeSvgExport(container, theme, effectivePalette);
}
