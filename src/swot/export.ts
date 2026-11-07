// ============================================================
// swot/export.ts — this chart's export handler. d3.ts dispatches to it through
// DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import { finalizeSvgExport, resolveExportPalette } from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';
import { resolveActiveTagGroup } from '../utils/tag-groups';

export async function exportSwot(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, exportMode } = ctx;
  const { parseSwot } = await import('./parser');
  const { renderSwot } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const parsed = parseSwot(content, effectivePalette);
  if (parsed.error) return '';

  // The renderer sizes itself from its content, so no width or height is passed.
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  renderSwot(container, parsed, effectivePalette, ctx.isDark, {
    activeTagGroup: resolveActiveTagGroup(
      parsed.tagGroups,
      parsed.options['active-tag'],
      ctxTagOverride(ctx)
    ),
    exportMode,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}
