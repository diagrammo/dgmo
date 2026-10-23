// ============================================================
// sitemap/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import {
  ctxTagOverride,
  type ExportContext,
  unionHiddenAttributes,
} from '../utils/export-context';
import { resolveActiveTagGroup } from '../utils/tag-groups';

export async function exportSitemap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseSitemap } = await import('./parser');
  const { layoutSitemap } = await import('./layout');
  const { collapseSitemapTree } = await import('./collapse');
  const { renderSitemap } = await import('./renderer');

  const isDark = ctx.isDark;
  const effectivePalette = await resolveExportPalette(theme, palette);

  const sitemapParsed = parseSitemap(content, effectivePalette);
  if (sitemapParsed.error || sitemapParsed.roots.length === 0) return '';

  // Apply interactive collapse state when provided (read from unified viewState)
  const collapsedNodes = viewState?.cg ? new Set(viewState.cg) : undefined;
  const activeTagGroup = resolveActiveTagGroup(
    sitemapParsed.tagGroups,
    sitemapParsed.options['active-tag'],
    ctxTagOverride(ctx)
  );
  const hiddenAttributes = unionHiddenAttributes(
    sitemapParsed.options['hide'],
    viewState?.ha
  );

  const { parsed: effectiveParsed, hiddenCounts } =
    collapsedNodes && collapsedNodes.size > 0
      ? collapseSitemapTree(sitemapParsed, collapsedNodes)
      : { parsed: sitemapParsed, hiddenCounts: new Map<string, number>() };

  const sitemapLayout = layoutSitemap(
    effectiveParsed,
    hiddenCounts.size > 0 ? hiddenCounts : undefined,
    activeTagGroup,
    hiddenAttributes,
    true
  );

  const PADDING = 20;
  const titleOffset = effectiveParsed.title ? 30 : 0;
  // Layout appends a legend band to its height whenever tag groups exist; with
  // `no-legend` nothing renders there, so drop the band from the canvas too.
  const {
    LEGEND_HEIGHT: SITEMAP_LEGEND_HEIGHT,
    LEGEND_GROUP_GAP: SITEMAP_LEGEND_GROUP_GAP,
  } = await import('../utils/legend-constants');
  const suppressedLegendBand =
    sitemapLayout.legend.length > 0 &&
    effectiveParsed.options['no-legend'] === 'on'
      ? SITEMAP_LEGEND_HEIGHT + SITEMAP_LEGEND_GROUP_GAP
      : 0;
  const exportWidth = sitemapLayout.width + PADDING * 2;
  const exportHeight =
    sitemapLayout.height + PADDING * 2 + titleOffset - suppressedLegendBand;
  const container = createExportContainer(exportWidth, exportHeight);

  renderSitemap(
    container,
    effectiveParsed,
    sitemapLayout,
    effectivePalette,
    isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    activeTagGroup,
    hiddenAttributes,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
