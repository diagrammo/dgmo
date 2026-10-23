// ============================================================
// mindmap/export.ts — this chart's export handler, moved out of d3.ts (#1362).
// d3.ts dispatches to it through DIAGRAM_EXPORT_HANDLERS.
// ============================================================

import {
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from '../utils/d3-helpers';
import { ctxTagOverride, type ExportContext } from '../utils/export-context';
import { resolveActiveTagGroup } from '../utils/tag-groups';

export async function exportMindmap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseMindmap } = await import('./parser');
  const { layoutMindmap } = await import('./layout');
  const { collapseMindmapTree } = await import('./collapse');
  const { renderMindmap } = await import('./renderer');

  const isDark = ctx.isDark;
  const effectivePalette = await resolveExportPalette(theme, palette);

  const mmParsed = parseMindmap(content, effectivePalette);
  if (mmParsed.error) return '';

  // Collapse set = runtime view-state (`cg`) ∪ source-authored `collapsed: true`
  // markers (node.collapsed). Honoring the source markers is what lets any
  // consumer (CLI, remark-dgmo, Obsidian, embeds) reproduce the app's collapsed
  // view from the `.dgmo` text alone. `cg` is additive here (the mindmap share
  // path emits no `cg` today); true cg-vs-source precedence is a later concern.
  const collapsedNodes = new Set<string>(viewState?.cg ?? []);
  const collectCollapsed = (nodes: typeof mmParsed.roots): void => {
    for (const n of nodes) {
      if (n.collapsed) collapsedNodes.add(n.id);
      if (n.children.length) collectCollapsed(n.children);
    }
  };
  collectCollapsed(mmParsed.roots);
  const activeTagGroup = resolveActiveTagGroup(
    mmParsed.tagGroups,
    mmParsed.options['active-tag'],
    ctxTagOverride(ctx)
  );
  const hideDescriptions =
    mmParsed.options['no-descriptions'] === 'true' || viewState?.hd === true;

  const { roots: effectiveRoots, hiddenCounts } =
    collapsedNodes && collapsedNodes.size > 0
      ? collapseMindmapTree(mmParsed.roots, collapsedNodes)
      : { roots: mmParsed.roots, hiddenCounts: new Map<string, number>() };

  const effectiveParsed = { ...mmParsed, roots: effectiveRoots };

  const mmLayout = layoutMindmap(effectiveParsed, effectivePalette, {
    interactive: false,
    ...(hiddenCounts.size > 0 && { hiddenCounts }),
    activeTagGroup,
    hideDescriptions,
  });

  const PADDING = 20;
  const titleOffset = effectiveParsed.title ? 30 : 0;
  const exportWidth = mmLayout.width + PADDING * 2;
  const exportHeight = mmLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  // Colour-by-depth from the source `color-by-depth` flag, with an interactive
  // `viewState.cbd` override.
  const colorByDepth =
    viewState?.cbd ?? mmParsed.options['color-by-depth'] === 'on';

  renderMindmap(
    container,
    effectiveParsed,
    mmLayout,
    effectivePalette,
    isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    undefined,
    hideDescriptions,
    colorByDepth ? null : activeTagGroup,
    colorByDepth ? { colorByDepth: true, exportMode } : { exportMode }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
