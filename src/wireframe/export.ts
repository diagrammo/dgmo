// ============================================================
// wireframe/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportWireframe(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseWireframe } = await import('./parser');
  const { layoutWireframe } = await import('./layout');
  const { renderWireframe } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const wireframeParsed = parseWireframe(content);
  if (
    wireframeParsed.error ||
    (wireframeParsed.roots.length === 0 && wireframeParsed.modals.length === 0)
  )
    return '';

  const wireframeLayout = layoutWireframe(wireframeParsed);

  const exportWidth = wireframeLayout.width;
  const exportHeight = wireframeLayout.height;
  const container = createExportContainer(exportWidth, exportHeight);

  renderWireframe(
    container,
    wireframeParsed,
    wireframeLayout,
    effectivePalette,
    ctx.isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    theme
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
