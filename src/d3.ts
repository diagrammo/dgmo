// ============================================================
// d3.ts — export-render dispatch + public re-export barrel.
//
// Story 109.2 split the six D3 visualizations into per-viz modules under
// src/<viz>/, and #1362 moved every chart's export handler beside its chart
// (src/<chart>/export.ts). What remains here is renderForExport and its
// dispatch table, plus the public barrel that re-exports the parser, types,
// and renderers from their homes so downstream import paths
// (@diagrammo/dgmo/advanced, ../src/d3 in tests, the desktop app) don't churn.
// ============================================================

import type { PaletteColors } from './palettes';
import type { CompactViewState } from './sharing';
import { parseArc } from './arc/parser';
import { EXPORT_HEIGHT, EXPORT_WIDTH } from './utils/d3-helpers';
import type {
  DiagramExportHandler,
  ExportContext,
  RenderForExportOptions,
} from './utils/export-context';

// Each chart's export handler, beside its chart (#1362).
import { exportArc } from './arc/export';
import { exportBlock } from './block/export';
import { exportBody } from './body/export';
import { exportBoxesAndLines } from './boxes-and-lines/export';
import { exportBracket } from './bracket/export';
import { exportC4 } from './c4/export';
import { exportClass } from './class/export';
import { exportClock } from './clock/export';
import { exportCountdown } from './countdown/export';
import { exportCycle } from './cycle/export';
import { exportEr } from './er/export';
import { exportEventLine } from './event-line/export';
import { exportFamily } from './family/export';
import { exportGantt } from './gantt/export';
import { exportGoal } from './goal/export';
import { exportFlowchart, exportState } from './graph/export';
import { exportInfra } from './infra/export';
import { exportJourneyMap } from './journey-map/export';
import { exportKanban } from './kanban/export';
import { exportLiveLink } from './live-link/export';
import { exportMap } from './map/export';
import { exportMindmap } from './mindmap/export';
import { exportOrg } from './org/export';
import { exportPert } from './pert/export';
import { exportPyramid } from './pyramid/export';
import { exportQuadrant } from './quadrant/export';
import { exportRaci } from './raci/export';
import { exportRing } from './ring/export';
import { exportVisualization } from './sequence/export';
import { exportSitemap } from './sitemap/export';
import { exportSketch } from './sketch/export';
import { exportSlope } from './slope/export';
import { exportSwimlane } from './swimlane/export';
import { exportTechRadar } from './tech-radar/export';
import { exportTimeline } from './timeline/export';
import { exportTreemap } from './treemap/export';
import { exportVenn } from './venn/export';
import { exportVersionControl } from './version-control/export';
import { exportWhiteboard } from './whiteboard/export';
import { exportWireframe } from './wireframe/export';
import { exportWordcloud } from './wordcloud/export';

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
export type { MapDataSource } from './utils/export-context';
export { resolveMapDataSource } from './map/export';

// ============================================================
// Export-render dispatch
// ============================================================

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
  sketch: exportSketch,
  whiteboard: exportWhiteboard,
  swimlane: exportSwimlane,
  family: exportFamily,
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
  goal: exportGoal,
  countdown: exportCountdown,
  clock: exportClock,
  bracket: exportBracket,
  raci: exportRaci,
  body: exportBody,
  'live-link': exportLiveLink,
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
        // §1.9 fill family survives the layout re-emit so the circular
        // renderer honors fill-solid / fill-outline authored on the arc.
        ...(p.fillMode ? [`fill-${p.fillMode}`] : []),
        ...p.links.map((l) => `${l.source} -> ${l.target} ${l.value}`),
      ].join('\n');
      return { content: emitted, type: 'chord' };
    }
  }
  return null;
}

/**
 * Renders a D3 chart to an SVG string for export.
 * Creates a detached DOM element, renders into it, extracts the SVG, then cleans up.
 */
export async function renderForExport(
  content: string,
  theme: 'light' | 'dark' | 'transparent',
  palette?: PaletteColors,
  viewState?: CompactViewState,
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
      // Forward the caller's dimensions. They were dropped here until
      // 2026-08-29, so a data chart routed through renderForExport — the app's
      // markdown export, the marketing site's hero — silently ignored a
      // requested width that `render()` honoured (#532).
      return renderDataChartD3(renderContent, theme, palette, {
        ...(options?.width !== undefined && { width: options.width }),
        ...(options?.height !== undefined && { height: options.height }),
      });
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
    // The resolved canvas, and the raw request beside it. A chart whose own
    // natural size is not EXPORT_WIDTH (tech-radar) needs to tell "the caller
    // asked for 1200" apart from "nobody asked", which the resolved value
    // cannot express.
    requestedWidth:
      options?.width && options.width > 0
        ? Math.round(options.width)
        : undefined,
    requestedHeight:
      options?.height && options.height > 0
        ? Math.round(options.height)
        : undefined,
    width:
      options?.width && options.width > 0
        ? Math.round(options.width)
        : EXPORT_WIDTH,
    height:
      options?.height && options.height > 0
        ? Math.round(options.height)
        : EXPORT_HEIGHT,
  };
  // Generic dispatch: every structured diagram AND every D3 visualization now
  // resolves through the handler table. Only `sequence` — which has no chart
  // type of its own and is auto-detected from arrow syntax — falls through to
  // exportVisualization.
  const handler =
    detectedType !== null ? DIAGRAM_EXPORT_HANDLERS[detectedType] : undefined;
  return (handler ?? exportVisualization)(ctx);
}
