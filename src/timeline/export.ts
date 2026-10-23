// ============================================================
// timeline/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import { finalizeSvgExport, resolveExportPalette } from '../utils/d3-helpers';
import {
  beginVizExport,
  ctxTagOverride,
  type ExportContext,
} from '../utils/export-context';
import { resolveActiveTagGroup } from '../utils/tag-groups';
import { renderTimeline } from './renderer';
import { parseTimeline } from './viz-parser';

export async function exportTimeline(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const parsed = parseTimeline(content, palette);
  if (parsed.error || parsed.timelineEvents.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport(ctx);
  renderTimeline(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    undefined,
    dims,
    resolveActiveTagGroup(
      parsed.timelineTagGroups,
      parsed.timelineActiveTag,
      ctxTagOverride(ctx)
    ),
    // Swimlane axis from source (`lane-by <group>` / `sort tag:<group>` →
    // timelineDefaultSwimlaneTG), with a viewState.swim override.
    viewState?.swim ?? parsed.timelineDefaultSwimlaneTG,
    undefined,
    undefined,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
