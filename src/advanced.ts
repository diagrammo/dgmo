// ============================================================
// @diagrammo/dgmo/advanced — low-level building blocks for first-party
// and advanced consumers (parsers, layout helpers, internal types).
//
// **No semver guarantee.** Exports here may be renamed, removed, or
// behave differently between MINOR versions. Patch versions will only
// change behavior to fix bugs.
//
// Use only when the public root API at `@diagrammo/dgmo` cannot meet
// your needs. Pin your `@diagrammo/dgmo` dependency tight if you depend
// on /advanced symbols.
//
// (Previously published as `/internal`. The old subpath is kept as a
// deprecated alias for one minor and will be removed in 0.17.x.)
// ============================================================

// ============================================================
// Diagnostics
// ============================================================

export { makeDgmoError, formatDgmoError } from './diagnostics';
export type { DgmoError, DgmoSeverity } from './diagnostics';

// ============================================================
// Arrow helpers (in-arrow label validation)
// ============================================================

export {
  parseInArrowLabel,
  validateLabelCharacters,
  ARROW_DIAGNOSTIC_CODES,
} from './utils/arrows';
export type { ParseInArrowLabelResult } from './utils/arrows';

// ============================================================
// Unified API
// ============================================================

export { render } from './render';

// ============================================================
// Chart-type registry (single source of truth)
// ============================================================

export { chartTypes } from './chart-types';
export type { ChartTypeMeta } from './chart-types';

export {
  normalize as normalizeChartTypePrompt,
  matchesContiguously,
  scoreChartType,
  confidence as chartTypeConfidence,
  suggestChartTypes,
  MIN_PRIMARY_SCORE,
  AMBIGUITY_THRESHOLD,
} from './chart-type-scoring';
export type {
  ChartTypeScore,
  Confidence as ChartTypeConfidence,
  SuggestionResult as ChartTypeSuggestionResult,
} from './chart-type-scoring';

// ============================================================
// Router
// ============================================================

export {
  parseDgmoChartType,
  parseDgmo,
  getRenderCategory,
  isExtendedChartType,
  getAllChartTypes,
  CHART_TYPE_DESCRIPTIONS,
  chartTypeParsers,
  knownChartTypeIds,
} from './dgmo-router';
export type { RenderCategory } from './dgmo-router';

// ============================================================
// Parsers
// ============================================================

export { parseChart, parseDataRowValues } from './chart';
export type { ParsedChart, ChartType, ChartDataPoint, ChartEra } from './chart';

export { parseExtendedChart } from './echarts';
export type { ParsedExtendedChart, ExtendedChartType } from './echarts';

export {
  parseVisualization,
  orderArcNodes,
  parseTimelineDate,
  addDurationToDate,
  formatDateLabel,
} from './d3';
export { computeTimeTicks } from './utils/time-ticks';
export type {
  ParsedVisualization,
  VisualizationType,
  D3ExportDimensions,
  ArcLink,
  ArcNodeGroup,
} from './d3';

export {
  parseSequenceDgmo,
  parseSequenceDgmo as parseSequenceDiagram,
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

export { parseFlowchart, looksLikeFlowchart } from './graph/flowchart-parser';

export { parseState, looksLikeState } from './graph/state-parser';
export { renderState, renderStateForExport } from './graph/state-renderer';
export { collapseStateGroups } from './graph/state-collapse';
export type { StateCollapseResult } from './graph/state-collapse';

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

export {
  renderClassDiagram,
  renderClassDiagramForExport,
} from './class/renderer';

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
export type { ERLayoutResult, ERLayoutNode, ERLayoutEdge } from './er/layout';

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

export {
  normalizeName,
  displayName,
  getOrCreateName,
} from './utils/name-normalize';
export type { NameEntry, GetOrCreateNameResult } from './utils/name-normalize';

export { parseOrg } from './org/parser';
export type { ParsedOrg, OrgNode } from './org/parser';

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
export {
  computeCardMove,
  computeCardArchive,
  isArchiveColumn,
} from './kanban/mutations';
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

export {
  layoutC4Context,
  layoutC4Containers,
  layoutC4Components,
  layoutC4Deployment,
  rollUpContextRelationships,
} from './c4/layout';
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

export { parseBoxesAndLines } from './boxes-and-lines/parser';
export type {
  ParsedBoxesAndLines,
  BLNode,
  BLEdge,
  BLGroup,
} from './boxes-and-lines/types';
export { layoutBoxesAndLines } from './boxes-and-lines/layout';
export type {
  BLLayoutResult,
  BLLayoutNode,
  BLLayoutEdge,
  BLLayoutGroup,
} from './boxes-and-lines/layout';
export {
  renderBoxesAndLines,
  renderBoxesAndLinesForExport,
} from './boxes-and-lines/renderer';

export { collapseBoxesAndLines } from './boxes-and-lines/collapse';
export type { BLCollapseResult } from './boxes-and-lines/collapse';

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
export type {
  ParsedInfra,
  InfraNode,
  InfraEdge,
  InfraGroup,
  InfraTagGroup,
  InfraProperty,
  InfraDiagnostic,
  InfraComputeParams,
  InfraBehaviorKey,
} from './infra/types';
export { INFRA_BEHAVIOR_KEYS } from './infra/types';
export { computeInfra } from './infra/compute';
export type {
  ComputedInfraModel,
  ComputedInfraNode,
  ComputedInfraEdge,
  InfraLatencyPercentiles,
  InfraAvailabilityPercentiles,
  InfraCbState,
} from './infra/types';
export { validateInfra, validateComputed } from './infra/validation';
export { inferRoles, collectDiagramRoles } from './infra/roles';
export type { InfraRole } from './infra/roles';
export { layoutInfra } from './infra/layout';
export type {
  InfraLayoutResult,
  InfraLayoutNode,
  InfraLayoutEdge,
  InfraLayoutGroup,
} from './infra/layout';
export {
  renderInfra,
  parseAndLayoutInfra,
  computeInfraLegendGroups,
} from './infra/renderer';
export type { InfraLegendGroup, InfraPlaybackState } from './infra/renderer';
export type { CollapsedSitemapResult } from './sitemap/collapse';

// ── Gantt Chart ───────────────────────────────────────────
export { parseGantt } from './gantt/parser';
export { calculateSchedule } from './gantt/calculator';
export { renderGantt, buildTagLaneRowList } from './gantt/renderer';
export type {
  GanttInteractiveOptions,
  GanttRow,
  GanttGroupRow,
  GanttTaskRow,
  GanttLaneHeaderRow,
} from './gantt/renderer';
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

// ── PERT Diagram ──────────────────────────────────────────
export { parsePert, looksLikePert, extractPertSymbols } from './pert/parser';
export { analyzePert } from './pert/analyzer';
export { layoutPert, relayoutPert } from './pert/layout';
export type { LayoutOverrides as PertLayoutOverrides } from './pert/internal';
export { normalizePertSourceForShare } from './pert/share-normalize';

// Monte Carlo simulator surface (formerly the `/pert` subpath, now folded
// in here since there were zero subpath consumers and modern tree-shaking
// handles the Web Worker bundle-size case).
export {
  mulberry32,
  sampleBetaPert,
  simulateCanonical,
  simulateFast,
  buildSimulationContext,
} from './pert/monte-carlo';
export type { ExpandedActivity, SimulateOptions } from './pert/monte-carlo';
export {
  renderPert,
  renderPertForExport,
  renderPertAnalysisBlock,
  measurePertAnalysisBlock,
  highlightPertCriticalPath,
  highlightPertSet,
  pertLegendEntries,
  pertLegendBlockWidth,
  PERT_LEGEND_PILL_HEIGHT,
  renderLegendBlock as renderPertLegendBlock,
  resetPertCriticalPath,
  resetPertHighlight,
} from './pert/renderer';
export type { PertRenderOptions } from './pert/renderer';
export type {
  Anchor as PertAnchor,
  ParsedPert,
  PertActivity,
  PertEdge,
  PertGroup,
  PertMilestone,
  PertOptions,
  PertDirection,
  NodeDetail,
  ResolvedActivity,
  ResolvedGroup as ResolvedPertGroup,
  ResolvedPert,
  MonteCarloResult,
  PertLayoutNode,
  PertLayoutEdge,
  PertLayoutGroup,
  LayoutResult as PertLayoutResult,
} from './pert/types';

export { collapseOrgTree, focusOrgTree } from './org/collapse';
export type {
  CollapsedOrgResult,
  FocusOrgResult,
  AncestorInfo,
} from './org/collapse';

export { parseMindmap } from './mindmap/parser';
export type {
  MindmapNode,
  ParsedMindmap,
  MindmapLayoutNode,
  MindmapLayoutEdge,
  MindmapLayoutResult,
} from './mindmap/types';
export { layoutMindmap } from './mindmap/layout';
export { renderMindmap, renderMindmapForExport } from './mindmap/renderer';
export { collapseMindmapTree } from './mindmap/collapse';
export type { CollapsedMindmapResult } from './mindmap/collapse';

export { parseWireframe } from './wireframe/parser';
export type {
  ParsedWireframe,
  WireframeElement,
  WireframeElementType,
  WireframeFormFactor,
} from './wireframe/types';
export { layoutWireframe } from './wireframe/layout';
export type { WireframeLayout, WireframeLayoutNode } from './wireframe/layout';
export { renderWireframe } from './wireframe/renderer';

export { parseTechRadar } from './tech-radar/parser';
export { computeRadarLayout, getRadarGeometry } from './tech-radar/layout';
export {
  renderTechRadar,
  renderTechRadarForExport,
} from './tech-radar/renderer';
export {
  renderQuadrantFocus,
  renderQuadrantFocusForExport,
} from './tech-radar/interactive';
export type {
  ParsedTechRadar,
  TechRadarRing,
  TechRadarQuadrant,
  TechRadarBlip,
  TechRadarLayoutPoint,
  QuadrantPosition,
  BlipTrend,
} from './tech-radar/types';

export { parseCycle } from './cycle/parser';
export { computeCycleLayout } from './cycle/layout';
export { renderCycle, renderCycleForExport } from './cycle/renderer';
export type { CycleRenderOptions } from './cycle/renderer';
export type {
  ParsedCycle,
  CycleNode,
  CycleEdge,
  CycleLayoutNode,
  CycleLayoutEdge,
  CycleLayoutResult,
} from './cycle/types';

export { parseJourneyMap } from './journey-map/parser';
export { layoutJourneyMap } from './journey-map/layout';
export type { JourneyMapLayout } from './journey-map/layout';
export {
  renderJourneyMap,
  renderJourneyMapForExport,
} from './journey-map/renderer';
export type {
  ParsedJourneyMap,
  JourneyMapPhase,
  JourneyMapStep,
  JourneyMapPersona,
  JourneyMapAnnotation,
} from './journey-map/types';
export type { JourneyMapInteractiveOptions } from './journey-map/renderer';

export { parsePyramid } from './pyramid/parser';
export { renderPyramid, renderPyramidForExport } from './pyramid/renderer';
export type { ParsedPyramid, PyramidLayer } from './pyramid/types';

export { parseRing } from './ring/parser';
export { renderRing, renderRingForExport } from './ring/renderer';
export type { ParsedRing, RingLayer } from './ring/types';

export type { RaciDragSource, RaciInteractionHandlers } from './raci';
export {
  parseRaci,
  renderRaci,
  renderRaciForExport,
  VARIANTS as RACI_VARIANTS,
  RACI_ERROR_CODES,
  RACI_WARNING_CODES,
  cellReplace as raciCellReplace,
  cellAppendMarker as raciCellAppendMarker,
  cellRemove as raciCellRemove,
  cellCycle as raciCellCycle,
} from './raci';
export type {
  ParsedRaci,
  RaciVariant,
  RaciMarker,
  RaciTask,
  RaciPhase,
  RaciRoleAssignment,
} from './raci';

export { resolveOrgImports } from './org/resolver';
export type {
  ReadFileFn,
  ResolveImportsResult,
  ImportSource,
} from './org/resolver';

export { layoutGraph } from './graph/layout';
export type {
  LayoutResult,
  LayoutNode,
  LayoutEdge,
  LayoutGroup,
  LayoutOptions,
} from './graph/layout';

export {
  renderFlowchart,
  renderFlowchartForExport,
} from './graph/flowchart-renderer';

// ============================================================
// Config Builders (produce framework-specific config objects)
// ============================================================

export {
  buildExtendedChartOption,
  buildSimpleChartOption,
  renderExtendedChartForExport,
  getExtendedChartLegendGroups,
  getSimpleChartLegendGroups,
  computeScatterLabelGraphics,
} from './echarts';
export type { ScatterLabelPoint } from './echarts';
export {
  renderLegendSvg,
  renderLegendSvgFromConfig,
  type LegendGroupData,
} from './utils/legend-svg';
export { LEGEND_HEIGHT, LEGEND_GEAR_PILL_W } from './utils/legend-constants';
export { renderLegendD3 } from './utils/legend-d3';
export {
  computeLegendLayout,
  controlsGroupCapsuleWidth,
  getLegendReservedHeight,
} from './utils/legend-layout';
export type {
  LegendConfig,
  LegendState,
  LegendCallbacks,
  LegendPosition,
  LegendMode,
  LegendControl,
  LegendLayout,
  LegendHandle,
  LegendPalette,
} from './utils/legend-types';
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

export { applyCollapseProjection } from './sequence/collapse';
export type { CollapsedView } from './sequence/collapse';

// ============================================================
// Colors & Palettes
// ============================================================

export {
  resolveColor,
  resolveColorWithDiagnostic,
  colorNames,
  nord,
  seriesColors,
  RECOGNIZED_COLOR_NAMES,
  isRecognizedColorName,
} from './colors';

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
  draculaPalette,
  monokaiPalette,
} from './palettes';

export type { PaletteConfig, PaletteColors } from './palettes';
export { mix, shapeFill } from './palettes/color-utils';

// ============================================================
// Sharing (URL encoding/decoding)
// ============================================================

export {
  encodeDiagramUrl,
  decodeDiagramUrl,
  encodeViewState,
  decodeViewState,
} from './sharing';
export type {
  EncodeDiagramUrlOptions,
  EncodeDiagramUrlResult,
  CompactViewState,
  DecodedDiagramUrl,
} from './sharing';

// ============================================================
// Completion (symbol extraction API)
// ============================================================

export {
  registerExtractor,
  extractDiagramSymbols,
  COMPLETION_REGISTRY,
  CHART_TYPES,
  METADATA_KEY_SET,
  ENTITY_TYPES,
  PIPE_METADATA,
  extractTagDeclarations,
} from './completion';
export type {
  DiagramSymbols,
  ExtractFn,
  DirectiveSpec,
  DirectiveValueSpec,
  PipeKeySpec,
} from './completion';

export { parseFirstLine, ALL_CHART_TYPES } from './utils/parsing';

// ============================================================
// Additional exports introduced by the API freeze
// ============================================================

// Namespace constants (also exported from the public root)
export { palettes } from './palettes';
export { themes, type Theme } from './themes';

// Public-API alias for parseDgmo (also exported from the public root as `validate`)
export { parseDgmo as validate } from './dgmo-router';

// `dgmo migrate` — programmatic access to the 0.18.0 legacy `|` → §1.4
// migration. Consumed by `@diagrammo/dgmo-mcp`'s `migrate_diagram` tool
// and by external authoring tools that want to offer in-place migration.
export {
  migrateContent,
  formatLineDiff,
  isLegacyMetadataLine,
  findUnsafePipePositions,
  transformLine,
} from './migrate';
export type { ContentMigration, TransformResult } from './migrate';
