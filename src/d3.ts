// ============================================================
// d3.ts — export-render dispatch + public re-export barrel.
//
// Story 109.2 split the six D3 visualizations into per-viz modules under
// src/<viz>/. What remains here is renderForExport's dispatch table (the
// per-type export handlers) plus the public barrel that re-exports the parser,
// types, and renderers from their new homes so downstream import paths
// (@diagrammo/dgmo/advanced, ../src/d3 in tests, the desktop app) don't churn.
// ============================================================

import type { PaletteColors } from './palettes';
import type { D3ExportDimensions } from './utils/d3-types';
import { parseVisualization } from './visualizations/parse';
import { resolveActiveTagGroup } from './utils/tag-groups';
import {
  EXPORT_HEIGHT,
  EXPORT_WIDTH,
  createExportContainer,
  finalizeSvgExport,
  resolveExportPalette,
} from './utils/d3-helpers';

// Per-viz renderers + parser doors used by the export handlers (own modules — Story 109.2).
import { renderSlopeChart } from './slope/renderer';
import { parseSlope } from './slope/parser';
import { renderArcDiagram } from './arc/renderer';
import { parseArc } from './arc/parser';
import { renderTimeline } from './timeline/renderer';
import { parseTimeline } from './timeline/viz-parser';
import { renderWordCloudAsync } from './wordcloud/renderer';
import { parseWordcloud } from './wordcloud/parser';
import { renderVenn } from './venn/renderer';
import { parseVenn } from './venn/parser';
import { renderQuadrant } from './quadrant/renderer';
import { parseQuadrant } from './quadrant/parser';

// ── Public re-export barrel (paths downstream consumers import from) ──
export { parseVisualization } from './visualizations/parse';
export { parseTimelineDate, addDurationToDate } from './timeline/parser';
export type { D3ExportDimensions } from './utils/d3-types';
export type {
  VisualizationType,
  ParsedVisualization,
  ArcLink,
  ArcNodeGroup,
} from './visualizations/types';
export { renderSlopeChart, resolveVerticalCollisions } from './slope/renderer';
export { orderArcNodes, renderArcDiagram } from './arc/renderer';
export { renderTimeline, formatDateLabel } from './timeline/renderer';
export { renderWordCloud } from './wordcloud/renderer';
export { renderVenn } from './venn/renderer';
export { renderQuadrant } from './quadrant/renderer';

// ============================================================
// Export-render dispatch
// ============================================================

/**
 * Renders a D3 chart to an SVG string for export.
 * Creates a detached DOM element, renders into it, extracts the SVG, then cleans up.
 */
type RenderForExportOptions = {
  c4Level?: 'context' | 'containers' | 'components' | 'deployment';
  c4System?: string;
  c4Container?: string;
  tagGroup?: string;
  exportMode?: boolean;
  // Browser callers (the app / Obsidian) bundle the map JSON and inject it
  // here — the Node fs `loadMapData()` seam can't run in a browser. CLI/SSR
  // omit this and fall back to the fs loader.
  mapData?: import('./map/resolved-types').MapData;
  // WYSIWYG map export: the live preview pane's displayed aspect (w/h). When
  // set, the map canvas adopts it + stretch-fills so the PNG matches the
  // on-screen map. The app passes this; headless consumers omit it.
  mapAspect?: number;
};

/** Everything an export handler needs — one bundle threaded through dispatch. */
interface ExportContext {
  content: string;
  theme: 'light' | 'dark' | 'transparent';
  palette: PaletteColors | undefined;
  viewState: import('./sharing').CompactViewState | undefined;
  options: RenderForExportOptions | undefined;
  exportMode: boolean;
  /** Whether the theme is dark, resolved once in renderForExport (Story 111.2). */
  isDark: boolean;
}

type DiagramExportHandler = (ctx: ExportContext) => Promise<string>;

/**
 * Export-render dispatch, keyed by detected chart type. Story 109.1 (arch-review)
 * replaced a 22-branch per-type if-ladder with this table.
 * `chart-type-registry.test.ts` asserts every diagram/visualization id in
 * CHART_TYPE_REGISTRY is covered here (or by the visualization fallthrough), so a
 * newly-registered type can no longer silently render an empty string.
 */
export const DIAGRAM_EXPORT_HANDLERS: Record<string, DiagramExportHandler> = {
  org: exportOrg,
  sitemap: exportSitemap,
  kanban: exportKanban,
  class: exportClass,
  er: exportEr,
  'boxes-and-lines': exportBoxesAndLines,
  swimlane: exportSwimlane,
  'version-control': exportVersionControl,
  mindmap: exportMindmap,
  wireframe: exportWireframe,
  c4: exportC4,
  flowchart: exportFlowchart,
  infra: exportInfra,
  pert: exportPert,
  gantt: exportGantt,
  state: exportState,
  'tech-radar': exportTechRadar,
  'journey-map': exportJourneyMap,
  cycle: exportCycle,
  map: exportMap,
  pyramid: exportPyramid,
  ring: exportRing,
  treemap: exportTreemap,
  block: exportBlock,
  raci: exportRaci,
  // D3 visualizations — own handler per type (Story 109.2). Only `sequence`
  // still falls through to exportVisualization (no chart-type of its own).
  slope: exportSlope,
  arc: exportArc,
  timeline: exportTimeline,
  'event-line': exportEventLine,
  wordcloud: exportWordcloud,
  venn: exportVenn,
  quadrant: exportQuadrant,
};

/**
 * Arc circular-layout override (#26, narrowed by #29): `arc` renders linear by
 * default; `layout chord` selects the circular ("chord") preset over the same
 * pairwise edge data. `chord` is no longer a chart-type keyword (#29) — the
 * circular layout is reachable ONLY through `arc` + `layout chord`. We parse
 * with the arc engine, normalize to a flat edge list, and re-emit canonical
 * content for the internal circular renderer (arc groups/order are dropped —
 * best-effort for a pure layout switch). Returns the rewritten `{content, type}`,
 * or null when no override applies.
 */
export function resolveArcChordOverride(
  content: string,
  detectedType: string | null,
  palette?: PaletteColors
): { content: string; type: string } | null {
  if (detectedType === 'arc') {
    const p = parseArc(content, palette);
    if (!p.error && p.layout === 'chord' && p.links.length) {
      const emitted = [
        `chord ${p.title ?? ''}`.trimEnd(),
        ...p.links.map((l) => `${l.source} -> ${l.target} ${l.value}`),
      ].join('\n');
      return { content: emitted, type: 'chord' };
    }
  }
  return null;
}

export async function renderForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors,
  viewState?: import('./sharing').CompactViewState,
  options?: RenderForExportOptions
): Promise<string> {
  const exportMode = options?.exportMode ?? false;
  const { parseDgmoChartType } = await import('./dgmo-router');
  const detectedTypeRaw = parseDgmoChartType(content);
  // Arc↔chord `layout` override (#26): re-emit canonical content for the other
  // engine so each renders its own grammar.
  const override = resolveArcChordOverride(content, detectedTypeRaw, palette);
  const renderContent = override?.content ?? content;
  const detectedType = override?.type ?? detectedTypeRaw;
  // Data-chart types (bar/line/pie/scatter/sankey/…) render via the hand-built
  // D3 engine — route them here so renderForExport is a complete export entry
  // for every chart type (the app's export path calls this directly).
  if (detectedType !== null) {
    const { supportsD3DataChart, renderDataChartD3 } =
      await import('./charts-d3');
    if (supportsD3DataChart(detectedType)) {
      return renderDataChartD3(renderContent, theme, palette);
    }
  }
  const ctx: ExportContext = {
    content: renderContent,
    theme,
    palette,
    viewState,
    options,
    exportMode,
    isDark: theme === 'dark',
  };
  // Generic dispatch: every structured diagram AND every D3 visualization now
  // resolves through the handler table. Only `sequence` — which has no chart
  // type of its own and is auto-detected from arrow syntax — falls through to
  // exportVisualization.
  const handler =
    detectedType !== null ? DIAGRAM_EXPORT_HANDLERS[detectedType] : undefined;
  return (handler ?? exportVisualization)(ctx);
}

/**
 * The tag-group override threaded into every handler: an explicit viewState tag
 * (app toggle / share link) wins, else the options.tagGroup fallback. Resolved
 * from ctx so handlers stop repeating the viewState/options fallback
 * shape (Story 111.2).
 */
function ctxTagOverride(ctx: ExportContext): string | undefined {
  return ctx.viewState?.tag ?? ctx.options?.tagGroup;
}

async function exportEventLine(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseEventLine } = await import('./event-line/parser');
  const { renderEventLineForExport } = await import('./event-line/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const parsed = parseEventLine(content, effectivePalette);
  if (parsed.error || parsed.events.length === 0) return '';

  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  renderEventLineForExport(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    { width: EXPORT_WIDTH, height: EXPORT_HEIGHT },
    ctxTagOverride(ctx)
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportVersionControl(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseVersionControl } = await import('./version-control/parser');
  const { renderVersionControlForExport } =
    await import('./version-control/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const parsed = parseVersionControl(content, effectivePalette);
  if (parsed.error || parsed.nodes.length === 0) return '';

  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  renderVersionControlForExport(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    {
      width: EXPORT_WIDTH,
      height: EXPORT_HEIGHT,
    }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

/**
 * Merge the source `hide` directive (comma-separated attribute keys) with any
 * interactive `viewState.ha`, lowercasing both so they match the parser's
 * lowercased metadata keys. Returns `undefined` when nothing is hidden.
 */
function unionHiddenAttributes(
  hideOption: string | undefined,
  ha: readonly string[] | undefined
): Set<string> | undefined {
  const sourceHidden = hideOption
    ? hideOption
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const union = new Set([...sourceHidden, ...(ha ?? [])]);
  return union.size > 0 ? union : undefined;
}

async function exportOrg(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseOrg } = await import('./org/parser');
  const { layoutOrg } = await import('./org/layout');
  const { collapseOrgTree } = await import('./org/collapse');
  const { renderOrg } = await import('./org/renderer');

  const isDark = ctx.isDark;
  const effectivePalette = await resolveExportPalette(theme, palette);

  const orgParsed = parseOrg(content, effectivePalette);
  if (orgParsed.error) return '';

  // Apply interactive collapse state when provided (read from unified viewState)
  const collapsedNodes = viewState?.cg ? new Set(viewState.cg) : undefined;
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

  const { parsed: effectiveParsed, hiddenCounts } =
    collapsedNodes && collapsedNodes.size > 0
      ? collapseOrgTree(orgParsed, collapsedNodes)
      : { parsed: orgParsed, hiddenCounts: new Map<string, number>() };

  const orgLayout = layoutOrg(
    effectiveParsed,
    hiddenCounts.size > 0 ? hiddenCounts : undefined,
    activeTagGroup,
    hiddenAttributes,
    false // expandAllLegend off — collapsed-by-default per §1.3
  );

  const PADDING = 20;
  const titleOffset = effectiveParsed.title ? 30 : 0;
  const exportWidth = orgLayout.width + PADDING * 2;
  const exportHeight = orgLayout.height + PADDING * 2 + titleOffset;
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
    undefined,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportSitemap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseSitemap } = await import('./sitemap/parser');
  const { layoutSitemap } = await import('./sitemap/layout');
  const { collapseSitemapTree } = await import('./sitemap/collapse');
  const { renderSitemap } = await import('./sitemap/renderer');

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
  const exportWidth = sitemapLayout.width + PADDING * 2;
  const exportHeight = sitemapLayout.height + PADDING * 2 + titleOffset;
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

async function exportKanban(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseKanban } = await import('./kanban/parser');
  const { renderKanban } = await import('./kanban/renderer');

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
    currentSwimlaneGroup: viewState?.swim ?? null,
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

async function exportClass(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, exportMode } = ctx;
  const { parseClassDiagram } = await import('./class/parser');
  const { layoutClassDiagram } = await import('./class/layout');
  const { renderClassDiagram } = await import('./class/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const classParsed = parseClassDiagram(content, effectivePalette);
  if (classParsed.error || classParsed.classes.length === 0) return '';

  const classLayout = layoutClassDiagram(classParsed);
  const PADDING = 20;
  const titleOffset = classParsed.title ? 40 : 0;
  const exportWidth = classLayout.width + PADDING * 2;
  const exportHeight = classLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderClassDiagram(
    container,
    classParsed,
    classLayout,
    effectivePalette,
    ctx.isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    undefined,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportEr(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseERDiagram } = await import('./er/parser');
  const { layoutERDiagram } = await import('./er/layout');
  const { renderERDiagram } = await import('./er/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const erParsed = parseERDiagram(content, effectivePalette);
  if (erParsed.error || erParsed.tables.length === 0) return '';

  const erLayout = layoutERDiagram(erParsed);
  const PADDING = 20;
  const titleOffset = erParsed.title ? 40 : 0;
  const exportWidth = erLayout.width + PADDING * 2;
  const exportHeight = erLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderERDiagram(
    container,
    erParsed,
    erLayout,
    effectivePalette,
    ctx.isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    resolveActiveTagGroup(
      erParsed.tagGroups,
      erParsed.options['active-tag'],
      ctxTagOverride(ctx)
    ),
    viewState?.sem,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportBoxesAndLines(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseBoxesAndLines } = await import('./boxes-and-lines/parser');
  const effectivePalette = await resolveExportPalette(theme, palette);
  const blParsed = parseBoxesAndLines(content, effectivePalette);
  if (blParsed.error || blParsed.nodes.length === 0) return '';

  // Convert viewState.htv (Record<string, string[]>) to Map<string, Set<string>>
  let blHiddenTagValues: Map<string, Set<string>> | undefined;
  if (viewState?.htv) {
    blHiddenTagValues = new Map();
    for (const [k, v] of Object.entries(viewState.htv)) {
      blHiddenTagValues.set(k, new Set(v));
    }
  }

  const { renderBoxesAndLinesForExport } =
    await import('./boxes-and-lines/renderer');
  const { layoutBoxesAndLines } = await import('./boxes-and-lines/layout');
  const blLayout = await layoutBoxesAndLines(blParsed);
  const PADDING = 20;
  const titleOffset = blParsed.title ? 40 : 0;
  const exportWidth = blLayout.width + PADDING * 2;
  const exportHeight = blLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  const blActiveTagGroup = ctxTagOverride(ctx);
  renderBoxesAndLinesForExport(
    container,
    blParsed,
    blLayout,
    effectivePalette,
    ctx.isDark,
    {
      exportDims: { width: exportWidth, height: exportHeight },
      ...(blActiveTagGroup !== undefined && {
        activeTagGroup: blActiveTagGroup,
      }),
      ...(blHiddenTagValues !== undefined && {
        hiddenTagValues: blHiddenTagValues,
      }),
      exportMode,
    }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportSwimlane(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseSwimlane } = await import('./swimlane/parser');
  const { layoutSwimlane } = await import('./swimlane/layout');
  const { renderSwimlaneForExport } = await import('./swimlane/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const swimParsed = parseSwimlane(content, effectivePalette);
  if (swimParsed.error || swimParsed.nodes.length === 0) return '';

  const swimLayout = layoutSwimlane(swimParsed);
  const PADDING = 20;
  const titleOffset = swimParsed.title ? 40 : 0;
  const exportWidth = swimLayout.width + PADDING * 2;
  const exportHeight = swimLayout.height + PADDING * 2 + titleOffset;
  const container = createExportContainer(exportWidth, exportHeight);

  renderSwimlaneForExport(
    container,
    swimParsed,
    swimLayout,
    effectivePalette,
    ctx.isDark,
    {
      exportDims: { width: exportWidth, height: exportHeight },
      activeTagGroup: resolveActiveTagGroup(
        swimParsed.tagGroups,
        swimParsed.options['active-tag'],
        ctxTagOverride(ctx)
      ),
      exportMode: ctx.exportMode,
    }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportMindmap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseMindmap } = await import('./mindmap/parser');
  const { layoutMindmap } = await import('./mindmap/layout');
  const { collapseMindmapTree } = await import('./mindmap/collapse');
  const { renderMindmap } = await import('./mindmap/renderer');

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

  const colorByDepth = viewState?.cbd === true;

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

async function exportWireframe(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseWireframe } = await import('./wireframe/parser');
  const { layoutWireframe } = await import('./wireframe/layout');
  const { renderWireframe } = await import('./wireframe/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const wireframeParsed = parseWireframe(content);
  if (
    wireframeParsed.error ||
    (wireframeParsed.roots.length === 0 && wireframeParsed.modals.length === 0)
  )
    return '';

  const wireframeLayout = layoutWireframe(wireframeParsed);

  const exportWidth = wireframeLayout.width;
  const exportHeight = wireframeLayout.height;
  const container = createExportContainer(exportWidth, exportHeight);

  renderWireframe(
    container,
    wireframeParsed,
    wireframeLayout,
    effectivePalette,
    ctx.isDark,
    undefined,
    { width: exportWidth, height: exportHeight },
    theme
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportC4(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseC4 } = await import('./c4/parser');
  const {
    layoutC4Context,
    layoutC4Containers,
    layoutC4Components,
    layoutC4Deployment,
  } = await import('./c4/layout');
  const { renderC4Context, renderC4Containers } = await import('./c4/renderer');

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

async function exportFlowchart(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseFlowchart } = await import('./graph/flowchart-parser');
  const { layoutGraph } = await import('./graph/layout');
  const { renderFlowchart } = await import('./graph/flowchart-renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const fcParsed = parseFlowchart(content, effectivePalette);
  if (fcParsed.error || fcParsed.nodes.length === 0) return '';

  const layout = layoutGraph(fcParsed);
  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);

  renderFlowchart(
    container,
    fcParsed,
    layout,
    effectivePalette,
    ctx.isDark,
    undefined,
    { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportInfra(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState } = ctx;
  const { parseInfra } = await import('./infra/parser');
  const { computeInfra } = await import('./infra/compute');
  const { layoutInfra } = await import('./infra/layout');
  const { renderInfra, computeInfraLegendGroups } =
    await import('./infra/renderer');

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
  const legendOffset = legendGroups.length > 0 ? 28 : 0;
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

async function exportPert(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState } = ctx;
  const { parsePert } = await import('./pert/parser');
  const { analyzePert } = await import('./pert/analyzer');
  const { layoutPert } = await import('./pert/layout');
  const { renderPert, measurePertAnalysisBlock } =
    await import('./pert/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const pertParsed = parsePert(content, { palette: effectivePalette });
  if (pertParsed.error || pertParsed.activities.length === 0) return '';

  const pertResolved = analyzePert(pertParsed);
  const pertLayout = layoutPert(pertResolved);

  const titleHeight = pertParsed.title && !pertParsed.options.noTitle ? 80 : 0;
  const PERT_PADDING = 20;
  // Analysis layer renders by default whenever MC ran. Precedence:
  // an explicit viewState.an (app toggle / share link) wins; else the
  // `no-analysis` source directive suppresses it; else on. The
  // renderer silently omits it in analytical mode (no MC output).
  const analysisOn = viewState?.an ?? !pertParsed.options.noAnalysis;
  const fieldLabelsOn = viewState?.fl === true;
  const exportW = pertLayout.width + PERT_PADDING * 2;
  const analysisMeasured =
    analysisOn || fieldLabelsOn
      ? measurePertAnalysisBlock(pertResolved, exportW - 2 * PERT_PADDING, {
          showSummary: false,
          showTornado: analysisOn,
          showScurve: analysisOn,
          showFieldLegend: fieldLabelsOn,
        })
      : { width: 0, height: 0 };
  const exportH =
    pertLayout.height +
    PERT_PADDING * 2 +
    titleHeight +
    analysisMeasured.height;
  const container = createExportContainer(exportW, exportH);

  renderPert(
    container,
    pertResolved,
    pertLayout,
    effectivePalette,
    ctx.isDark,
    {
      title: pertParsed.title,
      exportDims: { width: exportW, height: exportH },
      showSummary: false,
      showTornado: analysisOn,
      showScurve: analysisOn,
      showFieldLegend: fieldLabelsOn,
    }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportGantt(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseGantt } = await import('./gantt/parser');
  const { calculateSchedule } = await import('./gantt/calculator');
  const { renderGantt } = await import('./gantt/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const ganttParsed = parseGantt(content, effectivePalette);
  const resolved = calculateSchedule(ganttParsed);
  if (resolved.tasks.length === 0) return '';

  const EXPORT_W = 1200;
  const EXPORT_H = 800;
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
  const ganttSwimlaneGroup = viewState?.swim ?? undefined;
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

async function exportState(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState } = ctx;
  const { parseState } = await import('./graph/state-parser');
  const { layoutGraph } = await import('./graph/layout');
  const { renderState } = await import('./graph/state-renderer');
  const { collapseStateGroups } = await import('./graph/state-collapse');

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
  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);

  renderState(
    container,
    effectiveParsed,
    layout,
    effectivePalette,
    ctx.isDark,
    undefined,
    { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportTechRadar(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseTechRadar } = await import('./tech-radar/parser');
  const { renderTechRadarForExport } = await import('./tech-radar/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const radarParsed = parseTechRadar(content);
  if (radarParsed.error || radarParsed.quadrants.length === 0) return '';

  const RADAR_EXPORT_W = 1300;
  const RADAR_EXPORT_H = 1500;
  const container = createExportContainer(RADAR_EXPORT_W, RADAR_EXPORT_H);
  renderTechRadarForExport(
    container,
    radarParsed,
    effectivePalette,
    ctx.isDark,
    { width: RADAR_EXPORT_W, height: RADAR_EXPORT_H },
    viewState,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportJourneyMap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, exportMode } = ctx;
  const { parseJourneyMap } = await import('./journey-map/parser');
  const { renderJourneyMap } = await import('./journey-map/renderer');
  const { layoutJourneyMap } = await import('./journey-map/layout');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const jmParsed = parseJourneyMap(content, effectivePalette);
  if (
    jmParsed.error ||
    (jmParsed.phases.length === 0 && jmParsed.steps.length === 0)
  )
    return '';

  const jmLayout = layoutJourneyMap(jmParsed, effectivePalette, {
    isDark: ctx.isDark,
  });
  const container = createExportContainer(
    jmLayout.totalWidth,
    jmLayout.totalHeight
  );
  renderJourneyMap(container, jmParsed, effectivePalette, ctx.isDark, {
    exportDims: { width: jmLayout.totalWidth, height: jmLayout.totalHeight },
    exportMode,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportCycle(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const { parseCycle } = await import('./cycle/parser');
  const { renderCycleForExport } = await import('./cycle/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const cycleParsed = parseCycle(content);
  if (cycleParsed.error || cycleParsed.nodes.length === 0) return '';

  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  renderCycleForExport(
    container,
    cycleParsed,
    effectivePalette,
    ctx.isDark,
    { width: EXPORT_WIDTH, height: EXPORT_HEIGHT },
    viewState,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportMap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, options } = ctx;
  const { parseMap } = await import('./map/parser');
  const { resolveMap } = await import('./map/resolver');
  const { renderMapForExport } = await import('./map/renderer');
  const { mapExportDimensions } = await import('./map/dimensions');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const mapParsed = parseMap(content, effectivePalette);
  // Always render — an empty or partially-resolved map still draws the
  // inferred base map (§24B.10 / layout AC23); diagnostics surface separately.
  // Prefer injected `mapData` (browser bundles it; the fs loader can't run
  // there); fall back to the Node fs loader for CLI/SSR. Degrade like every
  // other branch (return '') if neither yields data.
  let mapData = options?.mapData;
  if (!mapData) {
    const { loadMapData } = await import('./map/load-data');
    try {
      mapData = await loadMapData();
    } catch {
      return '';
    }
  }
  const mapResolved = resolveMap(mapParsed, mapData);

  // Content-aware canvas: derive the height from the map's intrinsic projected
  // aspect (world ~2.3:1, a region taller, etc.) instead of the fixed 800, so the
  // export matches the content's natural shape — no vertical stretch, no
  // letterbox bands. `preferContain` rides along to the renderer.
  const dims = mapExportDimensions(
    mapResolved,
    mapData,
    EXPORT_WIDTH,
    options?.mapAspect
  );
  const container = createExportContainer(dims.width, dims.height);
  renderMapForExport(
    container,
    mapResolved,
    mapData,
    effectivePalette,
    ctx.isDark,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportPyramid(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parsePyramid } = await import('./pyramid/parser');
  const { renderPyramidForExport } = await import('./pyramid/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const pyramidParsed = parsePyramid(content);
  if (pyramidParsed.error || pyramidParsed.layers.length === 0) return '';

  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  renderPyramidForExport(
    container,
    pyramidParsed,
    effectivePalette,
    ctx.isDark,
    { width: EXPORT_WIDTH, height: EXPORT_HEIGHT }
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportRing(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseRing } = await import('./ring/parser');
  const { renderRingForExport } = await import('./ring/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const ringParsed = parseRing(content);
  if (ringParsed.error || ringParsed.layers.length === 0) return '';

  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  renderRingForExport(container, ringParsed, effectivePalette, ctx.isDark, {
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportTreemap(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseTreemap } = await import('./treemap/parser');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const treemapParsed = parseTreemap(content, effectivePalette);
  if (treemapParsed.error || treemapParsed.roots.length === 0) return '';

  // Headless export: full tree (no depth window), source-declared color mode.
  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  const dims = { width: EXPORT_WIDTH, height: EXPORT_HEIGHT };

  if (treemapParsed.options.radial) {
    // Sunburst mode: parallel lazy imports of the radial layout + renderer.
    const { renderTreemapRadialForExport } =
      await import('./treemap/renderer-radial');
    renderTreemapRadialForExport(
      container,
      treemapParsed,
      effectivePalette,
      ctx.isDark,
      dims
    );
  } else {
    const { renderTreemapForExport } = await import('./treemap/renderer');
    renderTreemapForExport(
      container,
      treemapParsed,
      effectivePalette,
      ctx.isDark,
      dims
    );
  }
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportBlock(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseBlock } = await import('./block/parser');
  const { renderBlockForExport } = await import('./block/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const blockParsed = parseBlock(content, effectivePalette);
  if (blockParsed.error || blockParsed.top.rows.length === 0) return '';

  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  renderBlockForExport(container, blockParsed, effectivePalette, ctx.isDark, {
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportRaci(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const { parseRaci } = await import('./raci/parser');
  const { renderRaciForExport } = await import('./raci/renderer');

  const effectivePalette = await resolveExportPalette(theme, palette);
  const raciParsed = parseRaci(content, effectivePalette);
  if (raciParsed.error) return '';

  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  renderRaciForExport(container, raciParsed, effectivePalette, ctx.isDark, {
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
  });
  return finalizeSvgExport(container, theme, effectivePalette);
}

/**
 * Shared export prelude for the D3 visualizations: offscreen container + the
 * canonical export dimensions. Each per-viz handler renders into the container
 * then finalizes it.
 */
function beginVizExport(): {
  container: HTMLDivElement;
  dims: D3ExportDimensions;
} {
  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);
  const dims: D3ExportDimensions = {
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
  };
  return { container, dims };
}

async function exportSlope(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseSlope(content, palette);
  if (parsed.error || parsed.data.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport();
  renderSlopeChart(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    undefined,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportArc(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseArc(content, palette);
  if (parsed.error || parsed.links.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport();
  renderArcDiagram(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    undefined,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportTimeline(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState, exportMode } = ctx;
  const parsed = parseTimeline(content, palette);
  if (parsed.error || parsed.timelineEvents.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport();
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
    viewState?.swim,
    undefined,
    undefined,
    exportMode
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportWordcloud(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseWordcloud(content, palette);
  if (parsed.error || parsed.words.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport();
  await renderWordCloudAsync(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportVenn(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseVenn(content, palette);
  if (parsed.error || parsed.vennSets.length < 2) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport();
  renderVenn(container, parsed, effectivePalette, ctx.isDark, undefined, dims);
  return finalizeSvgExport(container, theme, effectivePalette);
}

async function exportQuadrant(ctx: ExportContext): Promise<string> {
  const { content, theme, palette } = ctx;
  const parsed = parseQuadrant(content, palette);
  if (parsed.error || parsed.quadrantPoints.length === 0) return '';
  const effectivePalette = await resolveExportPalette(theme, palette);
  const { container, dims } = beginVizExport();
  renderQuadrant(
    container,
    parsed,
    effectivePalette,
    ctx.isDark,
    undefined,
    dims
  );
  return finalizeSvgExport(container, theme, effectivePalette);
}

/**
 * Fallthrough export for `sequence` — the only type without a chart-type of its
 * own (auto-detected from arrow syntax, parsed by parseSequenceDgmo). All other
 * D3 visualizations now have their own handler in DIAGRAM_EXPORT_HANDLERS.
 */
async function exportVisualization(ctx: ExportContext): Promise<string> {
  const { content, theme, palette, viewState } = ctx;
  const parsed = parseVisualization(content, palette);
  // Allow sequence diagrams through even if parseVisualization errors —
  // sequence is parsed by its own dedicated parser (parseSequenceDgmo)
  // and may not have a "chart:" line (auto-detected from arrow syntax).
  if (parsed.type !== 'sequence') {
    if (parsed.error) {
      const looksLikeSequence = /->|~>|<-/.test(content);
      if (!looksLikeSequence) return '';
    } else {
      return '';
    }
  }

  const effectivePalette = await resolveExportPalette(theme, palette);
  const isDark = ctx.isDark;
  const container = createExportContainer(EXPORT_WIDTH, EXPORT_HEIGHT);

  const { parseSequenceDgmo } = await import('./sequence/parser');
  const { renderSequenceDiagram } = await import('./sequence/renderer');
  const seqParsed = parseSequenceDgmo(content, effectivePalette);
  if (seqParsed.error || seqParsed.participants.length === 0) return '';
  // Apply interactive view state from share links (read from unified viewState).
  // Sequences key both sections and groups by source line number; `cg` is the
  // shared string[] field, so coerce its entries back to numbers.
  const collapsedSections = viewState?.cs ? new Set(viewState.cs) : undefined;
  const collapsedGroups = viewState?.cg
    ? new Set(viewState.cg.map(Number).filter((n) => Number.isFinite(n)))
    : undefined;
  const seqActiveTagGroup = ctxTagOverride(ctx);
  renderSequenceDiagram(
    container,
    seqParsed,
    effectivePalette,
    isDark,
    undefined,
    {
      exportWidth: EXPORT_WIDTH,
      ...(seqActiveTagGroup !== undefined && {
        activeTagGroup: seqActiveTagGroup,
      }),
      ...(collapsedSections !== undefined && { collapsedSections }),
      ...(collapsedGroups !== undefined && { collapsedGroups }),
    }
  );

  return finalizeSvgExport(container, theme, effectivePalette);
}
