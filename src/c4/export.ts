// ============================================================
// c4/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { LEGEND_INK_BOTTOM } from '../utils/legend-constants';
import { FRAME_BODY_TOP, LEGEND_BODY_GAP } from '../utils/title-constants';
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

  // Level precedence (#2328): explicit option → share-link view state → the
  // file's own `level` option → context.
  const fileLevel = c4Parsed.level;
  const c4Level =
    ctx.options?.c4Level ??
    (viewState?.c4l as
      | 'context'
      | 'containers'
      | 'components'
      | 'deployment'
      | undefined) ??
    fileLevel.level;
  const fromFile = c4Level === fileLevel.level;
  const c4System =
    ctx.options?.c4System ??
    viewState?.c4s ??
    (fromFile ? fileLevel.system : undefined);
  const c4Container =
    ctx.options?.c4Container ??
    viewState?.c4c ??
    (fromFile ? fileLevel.container : undefined);

  // Cards colour by the active tag group at every level, as in the app: an
  // explicit override, else `active-tag`, else the first declared group.
  const activeTagGroup = resolveActiveTagGroup(
    c4Parsed.tagGroups,
    c4Parsed.options['active-tag'],
    ctxTagOverride(ctx)
  );

  const c4Layout =
    c4Level === 'deployment'
      ? layoutC4Deployment(c4Parsed, activeTagGroup)
      : c4Level === 'components' && c4System && c4Container
        ? layoutC4Components(c4Parsed, c4System, c4Container, activeTagGroup)
        : c4Level === 'containers' && c4System
          ? layoutC4Containers(c4Parsed, c4System, activeTagGroup)
          : layoutC4Context(c4Parsed, activeTagGroup);

  if (c4Layout.nodes.length === 0) return '';

  const PADDING = 20;
  const titleOffset = c4Parsed.title ? 40 : 0;
  const exportWidth = c4Layout.width + PADDING * 2;
  // Titled: the drawing starts at the shared body top, not under the layout's
  // own 40-unit top margin (#1838).
  const exportHeight =
    c4Parsed.title && c4Parsed.options['no-title'] !== 'on'
      ? c4Layout.height -
        40 +
        (c4Layout.legend.length > 0
          ? PADDING + titleOffset + LEGEND_INK_BOTTOM + LEGEND_BODY_GAP
          : FRAME_BODY_TOP) +
        PADDING
      : c4Layout.height + PADDING * 2 + titleOffset;
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
    activeTagGroup,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
