// ============================================================
// swimlane/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';
import { resolveActiveTagGroup } from '../utils/tag-groups';

export async function exportSwimlane(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseSwimlane } = await import('./parser');
  const { layoutSwimlane } = await import('./layout');
  const { renderSwimlaneForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const swimParsed = parseSwimlane(content, effectivePalette);
  if (swimParsed.error || swimParsed.nodes.length === 0) return '';

  const swimLayout = layoutSwimlane(swimParsed);
  const PADDING = 20;
  const titleOffset = swimParsed.title ? 40 : 0;
  const exportWidth = swimLayout.width + PADDING * 2;
  const exportHeight = swimLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderSwimlaneForExport(
    container,
    swimParsed,
    swimLayout,
    effectivePalette,
    ctx.isDark,
    {
      exportDims: { width: exportWidth, height: exportHeight },
      activeTagGroup: resolveActiveTagGroup(
        swimParsed.tagGroups,
        swimParsed.options['active-tag'],
        ctxTagOverride(ctx)
      ),
      exportMode: ctx.exportMode,
    }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
