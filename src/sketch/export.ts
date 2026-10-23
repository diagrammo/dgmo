// ============================================================
// sketch/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';

export async function exportSketch(ctx: ExportContext): Promise<string> {
  const { content, theme, viewState, exportMode } = ctx;
  const { parseSketch } = await import('./parser');
  const effectivePalette = await resolveExportPalette(theme, ctx.palette);
  const parsed = parseSketch(content, effectivePalette);
  if (
    parsed.error ||
    (parsed.nodes.length === 0 && parsed.boxes.length === 0)
  ) {
    return '';
  }
  const { layoutSketch } = await import('./layout');
  const { renderSketchForExport } = await import('./renderer');
  // Authored `collapsed` flags are the default; an explicit viewState set
  // (share links, app fold state) wins when supplied — the #30 convention.
  const collapsedBoxes = viewState?.cg ? new Set(viewState.cg) : undefined;
  const skLayout = layoutSketch(parsed, {
    ...(collapsedBoxes !== undefined && { collapsedBoxes }),
  });
  const PADDING = 20;
  const titleOffset = parsed.title ? 40 : 0;
  const exportWidth = skLayout.width + PADDING * 2;
  const exportHeight = skLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);
  const skTagOverride = ctxTagOverride(ctx);
  renderSketchForExport(
    container,
    parsed,
    skLayout,
    effectivePalette,
    ctx.isDark,
    {
      ...(skTagOverride !== undefined && { activeTagGroup: skTagOverride }),
      ...(exportMode !== undefined && { exportMode }),
      ...(viewState?.hd !== undefined && { hideDescriptions: viewState.hd }),
    }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
