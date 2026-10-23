// ============================================================
// boxes-and-lines/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';

export async function exportBoxesAndLines(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseBoxesAndLines } = await import('./parser');
  const effectivePalette = await resolveExportPalette(theme, palette);
  const blParsed = parseBoxesAndLines(content, effectivePalette);
  if (blParsed.error || blParsed.nodes.length === 0) return '';

  // Convert viewState.htv (Record<string, string[]>) to Map<string, Set<string>>
  let blHiddenTagValues: Map<string, Set<string>> | undefined;
  if (viewState?.htv) {
    blHiddenTagValues = new Map();
    for (const [k, v] of Object.entries(viewState.htv)) {
      blHiddenTagValues.set(k, new Set(v));
    }
  }

  const { renderBoxesAndLinesForExport } = await import('./renderer');
  const { layoutBoxesAndLines } = await import('./layout');
  const blLayout = await layoutBoxesAndLines(blParsed);
  const PADDING = 20;
  const titleOffset = blParsed.title ? 40 : 0;
  const exportWidth = blLayout.width + PADDING * 2;
  const exportHeight = blLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  const blActiveTagGroup = ctxTagOverride(ctx);
  renderBoxesAndLinesForExport(
    container,
    blParsed,
    blLayout,
    effectivePalette,
    ctx.isDark,
    {
      exportDims: { width: exportWidth, height: exportHeight },
      ...(blActiveTagGroup !== undefined && {
        activeTagGroup: blActiveTagGroup,
      }),
      ...(blHiddenTagValues !== undefined && {
        hiddenTagValues: blHiddenTagValues,
      }),
      exportMode,
    }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
