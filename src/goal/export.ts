// ============================================================
// goal/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportGoal(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseGoal } = await import('./parser');
  const { renderGoalForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const parsed = parseGoal(content, effectivePalette);
  // Renders even without a valid target (0% shell, §3); only a hard parse
  // failure (wrong first line) sets parsed.error.
  if (parsed.error) return '';

  const container = createExportContainer(ctx.width, ctx.height);
  renderGoalForExport(container, parsed, effectivePalette, ctx.isDark, {
    width: ctx.width,
    height: ctx.height,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}
