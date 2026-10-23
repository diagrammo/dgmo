// ============================================================
// infra/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';
import { resolveActiveTagGroup } from '../utils/tag-groups';

export async function exportInfra(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState } = ctx;
  const { parseInfra } = await import('./parser');
  const { computeInfra } = await import('./compute');
  const { layoutInfra } = await import('./layout');
  const { renderInfra, computeInfraLegendGroups } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const infraParsed = parseInfra(content);
  if (infraParsed.error || infraParsed.nodes.length === 0) return '';

  const infraComputed = computeInfra(infraParsed);
  const infraLayout = layoutInfra(infraComputed);
  const activeTagGroup = resolveActiveTagGroup(
    infraParsed.tagGroups,
    infraParsed.options['active-tag'],
    ctxTagOverride(ctx)
  );

  const showInfraTitle =
    !!infraParsed.title && infraParsed.options['no-title'] !== 'on';
  const titleOffset = showInfraTitle ? 40 : 0;
  const infraTagGroups = [...infraParsed.tagGroups];
  const legendGroups = computeInfraLegendGroups(
    infraLayout.nodes,
    infraTagGroups,
    effectivePalette
  );
  const legendOffset =
    legendGroups.length > 0 && infraParsed.options['no-legend'] !== 'on'
      ? 28
      : 0;
  const exportWidth = infraLayout.width;
  const exportHeight = infraLayout.height + titleOffset + legendOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderInfra(
    container,
    infraLayout,
    effectivePalette,
    ctx.isDark,
    showInfraTitle ? infraParsed.title : null,
    showInfraTitle ? infraParsed.titleLineNumber : null,
    infraTagGroups,
    activeTagGroup,
    false,
    null,
    null,
    true,
    viewState?.cg ? new Set(viewState.cg) : null
  );
  // Restore explicit pixel dimensions for resvg (renderer uses 100%/viewBox for app scaling)
  const infraSvg = container.querySelector('svg');
  if (infraSvg) {
    infraSvg.setAttribute('width', String(exportWidth));
    infraSvg.setAttribute('height', String(exportHeight));
  }
  return finalizeSvgExport(container, theme, effectivePalette);
}
