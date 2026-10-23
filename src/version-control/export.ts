// ============================================================
// version-control/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportVersionControl(
  ctx: ExportContext
): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseVersionControl } = await import('./parser');
  const { renderVersionControlForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const parsed = parseVersionControl(content, effectivePalette);
  if (parsed.error || parsed.nodes.length === 0) return '';

  const container = createExportContainer(ctx.width, ctx.height);
  renderVersionControlForExport(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    {
      width: ctx.width,
      height: ctx.height,
    }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
