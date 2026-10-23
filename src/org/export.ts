// ============================================================
// org/export.ts — this chart's export handler, moved out of d3.ts (#1362).
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
import type { AncestorInfo } from './collapse';

export async function exportOrg(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseOrg, findOrgNodeIdByName } = await import('./parser');
  const { layoutOrg } = await import('./layout');
  const { collapseOrgTree, focusOrgTree, unionCollapsedOrgNodes } =
    await import('./collapse');
  const { renderOrg, ancestorTrailReserve } = await import('./renderer');

  const isDark = ctx.isDark;
  const effectivePalette = await resolveExportPalette(theme, palette);

  const orgParsed = parseOrg(content, effectivePalette);
  if (orgParsed.error) return '';

  // Collapsed nodes come from the source `collapsed: true` markers UNIONed with
  // any interactive `viewState.cg` (share link / app). Source alone must
  // collapse on a plain render — parity with the app, which seeds from the same
  // marker — which is why this is a union rather than a viewState-only read.
  const collapsedNodes = unionCollapsedOrgNodes(orgParsed, viewState?.cg);
  const activeTagGroup = resolveActiveTagGroup(
    orgParsed.tagGroups,
    orgParsed.options['active-tag'],
    ctxTagOverride(ctx)
  );
  // Hidden attributes come from the source `hide` directive UNIONed with any
  // interactive `viewState.ha` (share link / app). Source alone must hide on a
  // plain render — parity with the app, which seeds the same directive.
  const hiddenAttributes = unionHiddenAttributes(
    orgParsed.options['hide'],
    viewState?.ha
  );

  const collapseResult =
    collapsedNodes && collapsedNodes.size > 0
      ? collapseOrgTree(orgParsed, collapsedNodes)
      : { parsed: orgParsed, hiddenCounts: new Map<string, number>() };
  const { hiddenCounts } = collapseResult;
  let effectiveParsed = collapseResult.parsed;

  // `focus <name>` (source directive) re-roots the export to that person's
  // (or team's) subtree with the ancestor breadcrumb trail — parity with the
  // app's focused view, which seeds from the same directive. Resolved against
  // the collapse-pruned tree, mirroring the app's collapse-then-focus order;
  // an unresolved name falls back to the whole chart (parse warning).
  let ancestorPath: AncestorInfo[] | undefined;
  const focusName = orgParsed.options['focus'];
  if (focusName) {
    const focusId = findOrgNodeIdByName(effectiveParsed.roots, focusName);
    const focused = focusId ? focusOrgTree(effectiveParsed, focusId) : null;
    if (focused) {
      effectiveParsed = focused.parsed;
      ancestorPath = focused.ancestorPath;
    }
  }

  const orgLayout = layoutOrg(
    effectiveParsed,
    hiddenCounts.size > 0 ? hiddenCounts : undefined,
    activeTagGroup,
    hiddenAttributes,
    false // expandAllLegend off — collapsed-by-default per §1.3
  );

  const PADDING = 20;
  const titleOffset = effectiveParsed.title ? 30 : 0;
  // Only the part of the breadcrumb trail that overshoots the space already
  // above the focused root grows the canvas — the layout's top margin, and the
  // legend band when the legend draws inside the diagram, pay for the rest.
  const rootIds = new Set(effectiveParsed.roots.map((r) => r.id));
  const rootTop =
    orgLayout.nodes.find((n) => rootIds.has(n.id))?.y ??
    orgLayout.containers.find((c) => rootIds.has(c.nodeId))?.y ??
    0;
  const trailReserve = ancestorTrailReserve(ancestorPath?.length ?? 0, rootTop);
  const exportWidth = orgLayout.width + PADDING * 2;
  const exportHeight =
    orgLayout.height + PADDING * 2 + titleOffset + trailReserve;
  const container = createExportContainer(exportWidth, exportHeight);

  renderOrg(
    container,
    effectiveParsed,
    orgLayout,
    effectivePalette,
    isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    activeTagGroup,
    hiddenAttributes,
    ancestorPath,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}
