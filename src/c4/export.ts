// ============================================================
// c4/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';
import { resolveActiveTagGroup } from '../utils/tag-groups';

export async function exportC4(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseC4 } = await import('./parser');
  const {
    layoutC4Context,
    layoutC4Containers,
    layoutC4Components,
    layoutC4Deployment,
  } = await import('./layout');
  const { renderC4Context, renderC4Containers } = await import('./renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const c4Parsed = parseC4(content, effectivePalette);
  if (c4Parsed.error || c4Parsed.elements.length === 0) return '';

  // Container/component-level rendering (viewState fallback for share links)
  const c4Level =
    ctx.options?.c4Level ??
    (viewState?.c4l as
      | 'context'
      | 'containers'
      | 'components'
      | 'deployment'
      | undefined) ??
    'context';
  const c4System = ctx.options?.c4System ?? viewState?.c4s;
  const c4Container = ctx.options?.c4Container ?? viewState?.c4c;

  const c4Layout =
    c4Level === 'deployment'
      ? layoutC4Deployment(c4Parsed)
      : c4Level === 'components' && c4System && c4Container
        ? layoutC4Components(c4Parsed, c4System, c4Container)
        : c4Level === 'containers' && c4System
          ? layoutC4Containers(c4Parsed, c4System)
          : layoutC4Context(c4Parsed);

  if (c4Layout.nodes.length === 0) return '';

  const PADDING = 20;
  const titleOffset = c4Parsed.title ? 40 : 0;
  const exportWidth = c4Layout.width + PADDING * 2;
  const exportHeight = c4Layout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  const renderFn =
    c4Level === 'deployment' ||
    (c4Level === 'components' && c4System && c4Container) ||
    (c4Level === 'containers' && c4System)
      ? renderC4Containers
      : renderC4Context;

  renderFn(
    container,
    c4Parsed,
    c4Layout,
    effectivePalette,
    ctx.isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    resolveActiveTagGroup(
      c4Parsed.tagGroups,
      c4Parsed.options['active-tag'],
      ctxTagOverride(ctx)
    ),
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
