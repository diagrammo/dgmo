// ============================================================
// family/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';
import { resolveActiveTagGroup } from '../utils/tag-groups';

export async function exportFamily(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseFamily } = await import('./parser');
  const { layoutFamily } = await import('./layout');
  const { renderFamilyForExport } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const parsed = parseFamily(content, effectivePalette);
  if (parsed.error || parsed.persons.size === 0) return '';

  const layout = layoutFamily(parsed);
  const PADDING = 20;
  const titleOffset = parsed.title ? 40 : 0;
  const exportWidth = layout.width + PADDING * 2;
  const exportHeight = layout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderFamilyForExport(
    container,
    parsed,
    layout,
    effectivePalette,
    ctx.isDark,
    {
      exportDims: { width: exportWidth, height: exportHeight },
      activeTagGroup: resolveActiveTagGroup(
        parsed.tagGroups,
        parsed.options['active-tag'],
        ctxTagOverride(ctx)
      ),
      exportMode: ctx.exportMode,
    }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
