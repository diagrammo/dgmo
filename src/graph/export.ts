// ============================================================
// graph/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import type { ExportContext } from '../utils/export-context';

export async function exportFlowchart(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseFlowchart } = await import('./flowchart-parser');
  const { layoutGraph } = await import('./layout');
  const { renderFlowchart } = await import('./flowchart-renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const fcParsed = parseFlowchart(content, effectivePalette);
  if (fcParsed.error || fcParsed.nodes.length === 0) return '';

  const layout = layoutGraph(fcParsed);
  const container = createExportContainer(ctx.width, ctx.height);

  renderFlowchart(
    container,
    fcParsed,
    layout,
    effectivePalette,
    ctx.isDark,
    undefined,
    { width: ctx.width, height: ctx.height }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

export async function exportState(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState } = ctx;
  const { parseState } = await import('./state-parser');
  const { layoutGraph } = await import('./layout');
  const { renderState } = await import('./state-renderer');
  const { collapseStateGroups } = await import('./state-collapse');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const stateParsed = parseState(content, effectivePalette);
  if (stateParsed.error || stateParsed.nodes.length === 0) return '';

  // Union source-declared collapsed groups (`[Group] collapsed: true`) with any
  // interactive viewState.cg, so a plain export honors the source marker.
  const sourceCollapsed = (stateParsed.groups ?? [])
    .filter((g) => g.collapsed)
    .map((g) => g.id);
  const collapsedGroups = new Set([
    ...sourceCollapsed,
    ...(viewState?.cg ?? []),
  ]);
  const {
    parsed: effectiveParsed,
    collapsedChildCounts,
    originalGroups,
  } = collapsedGroups.size > 0
    ? collapseStateGroups(stateParsed, collapsedGroups)
    : {
        parsed: stateParsed,
        collapsedChildCounts: new Map<string, number>(),
        originalGroups: stateParsed.groups ?? [],
      };

  const layout = layoutGraph(effectiveParsed, {
    collapsedChildCounts,
    originalGroups,
  });
  const container = createExportContainer(ctx.width, ctx.height);

  renderState(
    container,
    effectiveParsed,
    layout,
    effectivePalette,
    ctx.isDark,
    undefined,
    { width: ctx.width, height: ctx.height }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
