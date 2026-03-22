// ============================================================
// Diagnostics
// ============================================================

export { makeDgmoError, formatDgmoError } from './diagnostics';
export type { DgmoError, DgmoSeverity } from './diagnostics';

// ============================================================
// Unified API
// ============================================================

export { render } from './render';

// ============================================================
// Router
// ============================================================

export {
  parseDgmoChartType,
  parseDgmo,
  getRenderCategory,
  isExtendedChartType,
} from './dgmo-router';
export type { RenderCategory } from './dgmo-router';

// ============================================================
// Parsers
// ============================================================

export { parseChart } from './chart';
export type {
  ParsedChart,
  ChartType,
  ChartDataPoint,
  ChartEra,
} from './chart';

export { parseExtendedChart } from './echarts';
export type { ParsedExtendedChart, ExtendedChartType } from './echarts';

export {
  parseVisualization,
  orderArcNodes,
  parseTimelineDate,
  addDurationToDate,
  computeTimeTicks,
  formatDateLabel,
} from './d3';
export type { ParsedVisualization, VisualizationType, D3ExportDimensions, ArcLink, ArcNodeGroup } from './d3';

export {
  parseSequenceDgmo,
  looksLikeSequence,
  isSequenceBlock,
  isSequenceNote,
} from './sequence/parser';
export type {
  ParsedSequenceDgmo,
  SequenceParticipant,
  SequenceMessage,
  SequenceBlock,
  ElseIfBranch,
  SequenceSection,
  SequenceNote,
  SequenceElement,
  SequenceGroup,
  ParticipantType,
} from './sequence/parser';

export {
  inferParticipantType,
  RULE_COUNT,
} from './sequence/participant-inference';

export { parseQuadrant } from './dgmo-mermaid';
export type { ParsedQuadrant } from './dgmo-mermaid';

export { parseFlowchart, looksLikeFlowchart } from './graph/flowchart-parser';

export { parseState, looksLikeState } from './graph/state-parser';
export { renderState, renderStateForExport } from './graph/state-renderer';

export { parseClassDiagram, looksLikeClassDiagram } from './class/parser';

export type {
  ParsedClassDiagram,
  ClassNode,
  ClassMember,
  ClassRelationship,
  ClassModifier,
  MemberVisibility,
  RelationshipType,
} from './class/types';

export { layoutClassDiagram } from './class/layout';
export type {
  ClassLayoutResult,
  ClassLayoutNode,
  ClassLayoutEdge,
} from './class/layout';

export { renderClassDiagram, renderClassDiagramForExport } from './class/renderer';

export { parseERDiagram, looksLikeERDiagram } from './er/parser';

export type {
  ParsedERDiagram,
  ERTable,
  ERColumn,
  ERRelationship,
  ERConstraint,
  ERCardinality,
} from './er/types';

export { layoutERDiagram } from './er/layout';
export type {
  ERLayoutResult,
  ERLayoutNode,
  ERLayoutEdge,
} from './er/layout';

export { renderERDiagram, renderERDiagramForExport } from './er/renderer';

export type {
  ParsedGraph,
  GraphNode,
  GraphEdge,
  GraphGroup,
  GraphShape,
  GraphDirection,
} from './graph/types';

export type { TagGroup, TagEntry } from './utils/tag-groups';

export { parseInlineMarkdown, truncateBareUrl } from './utils/inline-markdown';
export type { InlineSpan } from './utils/inline-markdown';

export { parseOrg } from './org/parser';
export type {
  ParsedOrg,
  OrgNode,
  OrgTagGroup,
  OrgTagEntry,
} from './org/parser';

export { layoutOrg } from './org/layout';
export type {
  OrgLayoutResult,
  OrgLayoutNode,
  OrgLayoutEdge,
  OrgContainerBounds,
} from './org/layout';

export { renderOrg, renderOrgForExport } from './org/renderer';

export { parseKanban } from './kanban/parser';
export type {
  ParsedKanban,
  KanbanColumn,
  KanbanCard,
  KanbanTagGroup,
  KanbanTagEntry,
} from './kanban/types';
export { computeCardMove, computeCardArchive, isArchiveColumn } from './kanban/mutations';
export { renderKanban, renderKanbanForExport } from './kanban/renderer';

export { parseC4 } from './c4/parser';
export type {
  ParsedC4,
  C4Element,
  C4ElementType,
  C4Shape,
  C4ArrowType,
  C4Relationship,
  C4Group,
  C4DeploymentNode,
  C4TagGroup,
  C4TagEntry,
} from './c4/types';

export { layoutC4Context, layoutC4Containers, layoutC4Components, layoutC4Deployment, rollUpContextRelationships } from './c4/layout';
export type {
  C4LayoutResult,
  C4LayoutNode,
  C4LayoutEdge,
  C4LayoutBoundary,
  C4LegendGroup,
  C4LegendEntry,
  ContextRelationship,
} from './c4/layout';

export {
  renderC4Context,
  renderC4ContextForExport,
  renderC4Containers,
  renderC4ContainersForExport,
  renderC4ComponentsForExport,
  renderC4Deployment,
  renderC4DeploymentForExport,
} from './c4/renderer';

export { parseInitiativeStatus, looksLikeInitiativeStatus } from './initiative-status/parser';
export type {
  ParsedInitiativeStatus,
  ISNode,
  ISEdge,
  ISGroup,
  InitiativeStatus,
} from './initiative-status/types';

export { layoutInitiativeStatus } from './initiative-status/layout';
export type {
  ISLayoutResult,
  ISLayoutNode,
  ISLayoutEdge,
  ISLayoutGroup,
} from './initiative-status/layout';

export { renderInitiativeStatus, renderInitiativeStatusForExport } from './initiative-status/renderer';
export type { ISRenderOptions } from './initiative-status/renderer';

export { collapseInitiativeStatus } from './initiative-status/collapse';
export type { CollapseResult } from './initiative-status/collapse';

export { filterInitiativeStatusByTags } from './initiative-status/filter';

export { parseSitemap, looksLikeSitemap } from './sitemap/parser';

export type {
  ParsedSitemap,
  SitemapNode,
  SitemapEdge,
  SitemapDirection,
} from './sitemap/types';

export { layoutSitemap } from './sitemap/layout';
export type {
  SitemapLayoutResult,
  SitemapLayoutNode,
  SitemapLayoutEdge,
  SitemapContainerBounds,
  SitemapLegendGroup,
  SitemapLegendEntry,
} from './sitemap/layout';

export { renderSitemap, renderSitemapForExport } from './sitemap/renderer';

export { collapseSitemapTree } from './sitemap/collapse';

// ── Infra Chart ────────────────────────────────────────────
export { parseInfra } from './infra/parser';
export type { ParsedInfra, InfraNode, InfraEdge, InfraGroup, InfraTagGroup, InfraProperty, InfraDiagnostic, InfraComputeParams, InfraBehaviorKey } from './infra/types';
export { INFRA_BEHAVIOR_KEYS } from './infra/types';
export { computeInfra } from './infra/compute';
export type { ComputedInfraModel, ComputedInfraNode, ComputedInfraEdge, InfraLatencyPercentiles, InfraAvailabilityPercentiles, InfraCbState } from './infra/types';
export { validateInfra, validateComputed } from './infra/validation';
export { inferRoles, collectDiagramRoles } from './infra/roles';
export type { InfraRole } from './infra/roles';
export { layoutInfra } from './infra/layout';
export type { InfraLayoutResult, InfraLayoutNode, InfraLayoutEdge, InfraLayoutGroup } from './infra/layout';
export { renderInfra, parseAndLayoutInfra, computeInfraLegendGroups } from './infra/renderer';
export type { InfraLegendGroup } from './infra/renderer';
export type { CollapsedSitemapResult } from './sitemap/collapse';

// ── Gantt Chart ───────────────────────────────────────────
export { parseGantt } from './gantt/parser';
export { calculateSchedule } from './gantt/calculator';
export { renderGantt } from './gantt/renderer';
export { resolveTaskName, collectTasks } from './gantt/resolver';
export type {
  ParsedGantt,
  GanttTask,
  GanttGroup,
  GanttParallelBlock,
  GanttNode,
  GanttDependency,
  GanttHolidays,
  GanttEra,
  GanttMarker,
  GanttOptions,
  Duration,
  DurationUnit,
  ResolvedSchedule,
  ResolvedTask,
  ResolvedGroup,
} from './gantt/types';

export { collapseOrgTree } from './org/collapse';
export type { CollapsedOrgResult } from './org/collapse';

export { resolveOrgImports } from './org/resolver';
export type { ReadFileFn, ResolveImportsResult, ImportSource } from './org/resolver';

export { layoutGraph } from './graph/layout';
export type {
  LayoutResult,
  LayoutNode,
  LayoutEdge,
  LayoutGroup,
} from './graph/layout';

export { renderFlowchart, renderFlowchartForExport } from './graph/flowchart-renderer';

// ============================================================
// Config Builders (produce framework-specific config objects)
// ============================================================

export { buildExtendedChartOption, buildSimpleChartOption, renderExtendedChartForExport } from './echarts';
export { buildMermaidQuadrant } from './dgmo-mermaid';

// ============================================================
// Renderers (produce SVG output)
// ============================================================

export {
  renderSlopeChart,
  renderArcDiagram,
  renderTimeline,
  renderWordCloud,
  renderVenn,
  renderQuadrant,
  renderForExport,
} from './d3';

export {
  renderSequenceDiagram,
  buildRenderSequence,
  computeActivations,
  applyPositionOverrides,
  applyGroupOrdering,
  groupMessagesBySection,
  buildNoteMessageMap,
} from './sequence/renderer';
export type {
  RenderStep,
  Activation,
  SectionMessageGroup,
  SequenceRenderOptions,
} from './sequence/renderer';

// ============================================================
// Colors & Palettes
// ============================================================

export { resolveColor, colorNames, nord, seriesColors } from './colors';

export {
  // Registry
  getPalette,
  getAvailablePalettes,
  registerPalette,
  isValidHex,
  // Utilities
  hexToHSL,
  hslToHex,
  hexToHSLString,
  mute,
  tint,
  shade,
  getSeriesColors,
  contrastText,
  // Palette definitions
  nordPalette,
  solarizedPalette,
  catppuccinPalette,
  rosePinePalette,
  gruvboxPalette,
  tokyoNightPalette,
  oneDarkPalette,
  boldPalette,
  // Mermaid bridge
  buildMermaidThemeVars,
  buildThemeCSS,
} from './palettes';

export type { PaletteConfig, PaletteColors } from './palettes';

// ============================================================
// Sharing (URL encoding/decoding)
// ============================================================

export { encodeDiagramUrl, decodeDiagramUrl } from './sharing';
export type {
  EncodeDiagramUrlOptions,
  EncodeDiagramUrlResult,
  DiagramViewState,
  DecodedDiagramUrl,
} from './sharing';

// ============================================================
// Completion (symbol extraction API)
// ============================================================

export {
  registerExtractor,
  extractDiagramSymbols,
} from './completion';
export type { DiagramSymbols, ExtractFn } from './completion';

// ============================================================
// Branding
// ============================================================

export { injectBranding } from './branding';
