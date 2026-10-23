// ============================================================
// class/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportClass(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, exportMode } = ctx;
  const { parseClassDiagram } = await import('./parser');
  const { layoutClassDiagram } = await import('./layout');
  const { renderClassDiagram } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const classParsed = parseClassDiagram(content, effectivePalette);
  if (classParsed.error || classParsed.classes.length === 0) return '';

  const classLayout = layoutClassDiagram(classParsed);
  const PADDING = 20;
  const titleOffset = classParsed.title ? 40 : 0;
  const exportWidth = classLayout.width + PADDING * 2;
  const exportHeight = classLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderClassDiagram(
    container,
    classParsed,
    classLayout,
    effectivePalette,
    ctx.isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    undefined,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
