// ============================================================
// er/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';
import { resolveActiveTagGroup } from '../utils/tag-groups';

export async function exportEr(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseERDiagram } = await import('./parser');
  const { layoutERDiagram } = await import('./layout');
  const { renderERDiagram } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const erParsed = parseERDiagram(content, effectivePalette);
  if (erParsed.error || erParsed.tables.length === 0) return '';

  const erLayout = layoutERDiagram(erParsed);
  const PADDING = 20;
  const titleOffset = erParsed.title ? 40 : 0;
  const exportWidth = erLayout.width + PADDING * 2;
  const exportHeight = erLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderERDiagram(
    container,
    erParsed,
    erLayout,
    effectivePalette,
    ctx.isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    resolveActiveTagGroup(
      erParsed.tagGroups,
      erParsed.options['active-tag'],
      ctxTagOverride(ctx)
    ),
    // Semantic colors are on by default; the source `no-semantic-colors` flag
    // suppresses them. An interactive `viewState.sem` overrides source.
    viewState?.sem ??
      (erParsed.options['no-semantic-colors'] === 'on' ? false : undefined),
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
