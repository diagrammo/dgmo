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
export type { ChartTypeMeta, ChartTypeId } from './chart-types';

// Chart-type SELECTION (suggestChartTypes + the trigger/scoring engine) moved
// to the dgmo-mcp server — it is AI-authoring functionality that the render
// library's consumers (Obsidian, Astro, the apps) never use. Only the registry
// (above) stays here.

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

export { parseExtendedChart } from './data-chart-parser';
export type {
  ParsedExtendedChart,
  ExtendedChartType,
} from './data-chart-parser';

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
// The canonical categorical auto-color rotation (RGB-seeded, max-contrast,
// neutrals excluded) — so app/editor swatch cyclers share dgmo's exact order.
//
// 🔴 `resolveActiveTagGroup` and `resolveTagColor` are exported for the same
// reason and it is not convenience: the app's sketch canvas draws the board
// itself, so without these it would need its OWN copy of "which group is
// active" and "what colour is this value" — and a second copy of a colour
// rotation is how the deuteranopia work and the eight-slot cycle come to
// disagree between the picture dgmo renders and the picture the editor shows.
// One resolver, both renderers.
export {
  autoTagColorCycle,
  resolveActiveTagGroup,
  resolveTagColor,
  tagAttrKey,
} from './utils/tag-groups';

export { parseInlineMarkdown, truncateBareUrl } from './utils/inline-markdown';
export type { InlineSpan } from './utils/inline-markdown';

export {
  normalizeName,
  displayName,
  getOrCreateName,
} from './utils/name-normalize';
export type { NameEntry, GetOrCreateNameResult } from './utils/name-normalize';

export { findOrgNodeIdByName, parseOrg } from './org/parser';
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

// ── Sketch (BL-115, spec §31) — the app canvas editor consumes the parser,
// layout, renderer, AND the slot-geometry constants through this entrypoint
// (one drawing code path, decision 21; constants never redefined, Task 5).
export { parseSketch } from './sketch/parser';
export { emitSketch, canonicalSketch, sameSketch } from './sketch/emit';
export type {
  ParsedSketch,
  SketchNode,
  SketchEdge,
  SketchBox,
  SketchAt,
  SketchShapeKind,
  SketchEdgeHeads,
  SketchOptions,
} from './sketch/types';
export { SKETCH_SHAPE_KINDS, isSketchShapeKind } from './sketch/types';
export { layoutSketch, SKETCH_AUTO_LAYOUT_DEFAULTS } from './sketch/layout';
export type {
  SketchLayout,
  SketchLayoutNode,
  SketchLayoutBox,
  SketchLayoutOptions,
  SketchAutoLayoutFlags,
} from './sketch/layout';
export {
  renderSketch,
  renderSketchForExport,
  sketchEdgeGeometry,
} from './sketch/renderer';
export type {
  SketchRenderOptions,
  SketchEdgeGeometry,
} from './sketch/renderer';
export { collapseSketch } from './sketch/collapse';
export type { SketchCollapseResult } from './sketch/collapse';
export {
  SKETCH_GEOMETRY,
  SKETCH_FOOT_W,
  SKETCH_FOOT_H,
  SKETCH_HALF_SLOT_X,
  SKETCH_HALF_SLOT_Y,
  SKETCH_SLOT_X,
  SKETCH_SLOT_Y,
  SKETCH_SEP,
  sketchSlotToPx,
} from './sketch/geometry';
export type { BLCollapseResult } from './boxes-and-lines/collapse';
export { focusBoxesAndLines } from './boxes-and-lines/focus';
export type { FocusTarget, FocusResult } from './boxes-and-lines/focus';

export { parseSwimlane } from './swimlane/parser';
export type {
  ParsedSwimlane,
  SwimNode,
  SwimEdge,
  SwimLane,
  SwimPhase,
  SwimShape,
  SwimEvent,
  SwimlaneLayoutResult,
  LayoutBand as SwimlaneLayoutBand,
} from './swimlane/types';
export { layoutSwimlane } from './swimlane/layout';
export { renderSwimlaneForExport } from './swimlane/renderer';

export { parseFamily } from './family/parser';
export type {
  ParsedFamily,
  FamilyPerson,
  FamilyUnion,
  FamilyChild,
  FamilySex,
  FamilyLayoutResult,
  FamilyLayoutNode,
  FamilyMarriageBar,
  FamilyChildEdge,
} from './family/types';
export { layoutFamily } from './family/layout';
export { renderFamily, renderFamilyForExport } from './family/renderer';

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

export { parseEventLine } from './event-line/parser';
export {
  renderEventLine,
  renderEventLineForExport,
  focusEventLine,
  clearEventLineMuted,
} from './event-line/renderer';
export type { EventLineFocus } from './event-line/renderer';
export type {
  ParsedEventLine,
  EventLineEvent,
  EventLineOptions,
  EventLineEra,
} from './event-line/types';

export { parseCountdown, targetToMs } from './countdown/parser';
export {
  renderCountdown,
  renderCountdownForExport,
} from './countdown/renderer';
export { startCountdowns, tickCountdowns } from './countdown/ticker';
export type { ParsedCountdown } from './countdown/types';
export type { RecurRule, CountUnits, RoundMode } from './countdown/resolve';

export { parseClock } from './clock/parser';
export { renderClock, renderClockForExport } from './clock/renderer';
export { startClocks, tickClocks } from './clock/ticker';
export { parseFixedOffset, formatOffsetLabel } from './clock/resolve';
export { searchZones, resolvePlace, normalizePlace } from './clock/gazetteer';
export type { ZoneSuggestion, PlaceResolution } from './clock/gazetteer';
export type {
  ParsedClock,
  ClockEntry,
  ClockFace,
  ClockZoneKind,
  WorkWindow,
} from './clock/types';

export { parseBody } from './body/parser';
export { renderBody, renderBodyForExport } from './body/renderer';
export type {
  ParsedBody,
  BodyPart,
  BodyOptions,
  BodyFigure,
} from './body/types';

// Live link (§38). No DOM renderer, unlike every sibling below: the card is a
// pure string builder, so a host draws it by setting the markup rather than by
// handing over a container.
export { parseLiveLink } from './live-link/parser';
export { renderLiveLinkCard } from './live-link/renderer';
export type { ParsedLiveLink } from './live-link/types';

export { parseGoal } from './goal/parser';
export { renderGoal, renderGoalForExport } from './goal/renderer';
export type { ParsedGoal, GoalMode, GoalOptions } from './goal/types';
export { parseBracket } from './bracket/parser';
export { renderBracket, renderBracketForExport } from './bracket/renderer';
export { layoutBracket } from './bracket/layout';
export type {
  ParsedBracket,
  BracketMode,
  BracketSide,
  RawMatch,
  RawSeed,
} from './bracket/types';

export { parseVersionControl } from './version-control/parser';
export {
  renderVersionControl,
  renderVersionControlForExport,
} from './version-control/renderer';
export type {
  ParsedVersionControl,
  VCNode,
  VCBranch,
  VCRef,
  VCNote,
  VCOptions,
} from './version-control/types';

export { parseRing } from './ring/parser';
export { renderRing, renderRingForExport } from './ring/renderer';
export type { ParsedRing, RingLayer } from './ring/types';

export { parseTreemap } from './treemap/parser';
export { renderTreemap, renderTreemapForExport } from './treemap/renderer';
export {
  renderTreemapRadial,
  renderTreemapRadialForExport,
} from './treemap/renderer-radial';
export { layoutTreemap } from './treemap/layout';
export { layoutTreemapRadial } from './treemap/layout-radial';
export type { TreemapCell, TreemapLayoutResult } from './treemap/layout';
export type { RadialCell, RadialLayoutResult } from './treemap/layout-radial';
export type {
  ParsedTreemap,
  TreemapNode,
  TreemapColorMode,
  TreemapOptions,
} from './treemap/types';

export { parseBlock } from './block/parser';
export {
  renderBlock,
  renderBlockForExport,
  authoredCollapsedIds,
} from './block/renderer';
export { layoutBlock } from './block/layout';
export type { BlockLayoutItem, BlockLayoutResult } from './block/layout';
export type {
  ParsedBlock,
  BlockNode,
  BlockCell,
  BlockGrid,
  BlockOptions,
} from './block/types';

// Map (§24B) — the interactive render surface for app/editor consumers. The
// browser supplies `MapData` by DI (resolveMap/renderMap take it as an
// argument); a Node host passes the fs loader below straight to `render()` as
// `render(src, { mapData: loadMapData })`, which is the ONLY route from a
// render to the disk — there is no implicit fallback.
export { parseMap, looksLikeMap } from './map/parser';
export { resolveMap } from './map/resolver';
export { loadMapData } from './map/load-data';
export {
  layoutMap,
  albersSkewFallback,
  mapBackgroundColor,
  mapNeutralLandColor,
} from './map/layout';
export type {
  MapLayout,
  MapLayoutRegion,
  MapLayoutPoi,
  MapLayoutLeg,
  PlacedLabel,
  MapLayoutLegend,
} from './map/layout';
export { renderMap, renderMapForExport } from './map/renderer';
// Content-aware export dimensions — derive the canvas height from a map's intrinsic
// projected aspect so exports/embeds match the content's natural shape (no vertical
// stretch). Used by the CLI/MCP/SSG export path and by Obsidian's DI render.
export {
  mapContentAspect,
  mapExportDimensions,
  type MapExportDimensions,
} from './map/dimensions';
// Map geo-query (step-5 coordinate/location inspector) — a SEPARATE entry from
// the renderer; takes `MapData` by DI so it's browser-safe (never calls the
// Node-only `loadMapData`).
export { createMapGeoQuery } from './map/geo-query';
export type {
  MapGeoQuery,
  CreateMapGeoQueryOptions,
  ResultCard,
  ResultTokens,
  RegionToken,
  NearestCity,
  ProjectedCity,
} from './map/geo-query';
export type { MapLayoutInset, MapLayoutStretch } from './map/layout';
export type {
  ParsedMap,
  MapDirectives,
  MapRegion,
  MapPoi,
  MapRoute,
  MapEdge,
  PoiPos,
} from './map/types';
export type {
  ResolvedMap,
  MapData,
  ResolvedRegion,
  ResolvedPoi,
  ResolvedEdge,
  ResolvedRoute,
  ProjectionFamily,
  GeoExtent,
} from './map/resolved-types';
export {
  completeMapPlaces,
  completeMapRegions,
  searchMapLocations,
} from './map/completion';
export type {
  MapPlaceCompletion,
  MapRegionCompletion,
  MapCompletionOptions,
  MapLocationMatch,
} from './map/completion';
export type {
  Gazetteer,
  GazetteerEntry,
  BoundaryTopology,
  RegionName,
  RegionNames,
  AirportData,
} from './map/data/types';

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
// Data-chart legend-group helpers (consumed by the D3 renderers)
// ============================================================

export {
  getExtendedChartLegendGroups,
  getSimpleChartLegendGroups,
} from './data-chart-parser';
export { ScaleContext } from './utils/scaling';
export { renderLegendSvg, renderLegendSvgFromConfig } from './utils/legend-svg';
export type { LegendGroupData } from './utils/legend-types';
// 🔴 The geometry a SECOND drawer needs. `computeLegendLayout` is already
// exported, but its output alone does not say how big a dot is or what size
// the type runs at — so a consumer drawing from the layout by hand had to
// restate those numbers, which is how a legend comes to look almost right.
// Added 2026-08-26 for the app's live sketch canvas, the one legend in the
// product dgmo does not draw (diagrammo/diagrammo#514).
export {
  LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_ENTRY_TRAIL,
  LEGEND_GEAR_PILL_W,
  LEGEND_GROUP_GAP,
  LEGEND_HEIGHT,
  LEGEND_MAX_ENTRY_ROWS,
  LEGEND_PILL_FONT_SIZE,
  LEGEND_PILL_PAD,
} from './utils/legend-constants';
export { renderLegendD3 } from './utils/legend-d3';
export {
  computeLegendLayout,
  controlsGroupCapsuleWidth,
  getLegendReservedHeight,
  legendEntryWidth,
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
  INVALID_COLOR_CODE,
  nearestNamedColor,
  isInvalidColorToken,
  invalidColorDiagnostic,
  INVALID_CSS_COLOR_HEX,
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
  catppuccinPalette,
  tokyoNightPalette,
  atlasPalette,
  blueprintPalette,
  slatePalette,
  tidewaterPalette,
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
//
// The completion registries + symbol extractors moved to the app (the only
// consumer) — see ADR-001 of the context-aware-completion spec. dgmo no longer
// publishes COMPLETION_REGISTRY / extractDiagramSymbols / STRUCTURAL_KEYWORDS /
// REFERENCE_GRAMMAR / PIPE_METADATA / etc. The `DiagramSymbols` shape stays
// exported — it is the return type of the parser-integrated extractors below,
// which the app calls as a parser.

export type { DiagramSymbols } from './completion-types';

// Parser-integrated symbol extractors (parser API, NOT "completion"). These 5
// call the real parsers, so they stay in dgmo; the app calls them as a parser
// (ADR-001 / Task 5 of the context-aware-completion spec). extractPertSymbols
// is already exported above with the PERT surface.
export { extractSymbols as extractErSymbols } from './er/parser';
export { extractSymbols as extractFlowchartSymbols } from './graph/flowchart-parser';
export { extractSymbols as extractInfraSymbols } from './infra/parser';
export { extractSymbols as extractClassSymbols } from './class/parser';

export { parseFirstLine, ALL_CHART_TYPES } from './utils/parsing';

// ============================================================
// Additional exports introduced by the API freeze
// ============================================================

// Namespace constants (also exported from the public root)
export { palettes } from './palettes';
export { themes, type Theme } from './themes';

// Public-API alias for parseDgmo (also exported from the public root as `validate`)
export { parseDgmo as validate } from './dgmo-router';

// Font coverage — which characters the bundled Inter cannot draw, and the
// portability warning a rasterising caller should print. Exported here rather
// than as a new subpath: a new `exports` key breaks the app's dev-mode source
// alias (see diagrammo-app/CLAUDE.md), and the two consumers that rasterise —
// @diagrammo/dgmo-cli and @diagrammo/dgmo-mcp — both inline this entry already.
export {
  textFromSvg,
  uncoveredCharacters,
  fontPortabilityWarning,
  type FontCoverage,
  type CodepointRange,
  type UncoveredRun,
} from './font-coverage';
