// ============================================================
// kanban/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import { finalizeSvgExport, resolveExportPalette } from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';
import { resolveActiveTagGroup } from '../utils/tag-groups';

export async function exportKanban(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseKanban } = await import('./parser');
  const { renderKanban } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const kanbanParsed = parseKanban(content, effectivePalette);
  if (kanbanParsed.error || kanbanParsed.columns.length === 0) return '';

  // Kanban renderer self-sizes — no explicit width/height needed
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  const kanbanCollapsedLanes = viewState?.cl
    ? new Set(viewState.cl)
    : undefined;
  // Union source-declared collapsed columns (`[Column] collapsed: true`) with
  // any interactive `viewState.cc`, so a plain export honors the source marker.
  const sourceCollapsedColumns = kanbanParsed.columns
    .filter((c) => c.collapsed)
    .map((c) => c.id);
  const kanbanCollapsedColumns =
    viewState?.cc || sourceCollapsedColumns.length > 0
      ? new Set([...sourceCollapsedColumns, ...(viewState?.cc ?? [])])
      : undefined;
  renderKanban(container, kanbanParsed, effectivePalette, ctx.isDark, {
    activeTagGroup: resolveActiveTagGroup(
      kanbanParsed.tagGroups,
      kanbanParsed.options['active-tag'],
      ctxTagOverride(ctx)
    ),
    currentSwimlaneGroup:
      viewState?.swim ?? kanbanParsed.options['lane-by'] ?? null,
    ...(kanbanCollapsedLanes !== undefined && {
      collapsedLanes: kanbanCollapsedLanes,
    }),
    ...(kanbanCollapsedColumns !== undefined && {
      collapsedColumns: kanbanCollapsedColumns,
    }),
    ...(viewState?.cm !== undefined && { compactMeta: viewState.cm }),
    exportMode,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}
