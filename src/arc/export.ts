// ============================================================
// arc/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import { finalizeSvgExport, resolveExportPalette } from '../utils/d3-helpers';
import { beginVizExport, type ExportContext } from '../utils/export-context';
import { parseArc } from './parser';
import { renderArcDiagram } from './renderer';

export async function exportArc(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseArc(content, palette);
  if (parsed.error || parsed.links.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport(ctx);
  renderArcDiagram(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    undefined,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
