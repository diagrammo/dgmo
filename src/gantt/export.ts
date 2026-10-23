// ============================================================
// gantt/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';
import { resolveActiveTagGroup } from '../utils/tag-groups';

export async function exportGantt(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseGantt } = await import('./parser');
  const { calculateSchedule } = await import('./calculator');
  const { renderGantt } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const ganttParsed = parseGantt(content, effectivePalette);
  const resolved = calculateSchedule(ganttParsed);
  if (resolved.tasks.length === 0) return '';

  const EXPORT_W = ctx.width;
  const EXPORT_H = ctx.height;
  const container = createExportContainer(EXPORT_W, EXPORT_H);

  // Union source-declared collapsed groups (`[Group] collapsed: true`) with any
  // interactive `viewState.cg`, so a plain export honors the source marker.
  const sourceCollapsedGroups = resolved.groups
    .filter((g) => g.collapsed)
    .map((g) => g.name);
  const ganttCollapsedGroups =
    viewState?.cg || sourceCollapsedGroups.length > 0
      ? new Set([...sourceCollapsedGroups, ...(viewState?.cg ?? [])])
      : undefined;
  // Swimlane axis from source (`lane-by <group>` / `sort tag:<group>` →
  // defaultSwimlaneGroup when sort is 'tag'), with a viewState.swim override.
  const sourceSwimlane =
    resolved.options.sort === 'tag'
      ? (resolved.options.defaultSwimlaneGroup ?? undefined)
      : undefined;
  const ganttSwimlaneGroup = viewState?.swim ?? sourceSwimlane;
  const ganttCollapsedLanes = viewState?.cl ? new Set(viewState.cl) : undefined;
  renderGantt(
    container,
    resolved,
    effectivePalette,
    ctx.isDark,
    {
      ...(ganttCollapsedGroups !== undefined && {
        collapsedGroups: ganttCollapsedGroups,
      }),
      ...(ganttSwimlaneGroup !== undefined && {
        currentSwimlaneGroup: ganttSwimlaneGroup,
      }),
      ...(ganttCollapsedLanes !== undefined && {
        collapsedLanes: ganttCollapsedLanes,
      }),
      currentActiveGroup: resolveActiveTagGroup(
        resolved.tagGroups,
        resolved.options.activeTag ?? undefined,
        ctxTagOverride(ctx)
      ),
      exportMode,
    },
    { width: EXPORT_W, height: EXPORT_H }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
