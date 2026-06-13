// ============================================================
// Visualization parsed-shape types — Story 109.2 (arch-review).
//
// Extracted verbatim from d3.ts. Owns the parsed data model for the six D3
// visualizations (slope, arc, timeline, wordcloud, venn, quadrant). The
// ParsedVisualization interface is the shared shape consumers see; per-viz
// narrow shapes follow as the module split lands.
// ============================================================

import type { DgmoError } from '../diagnostics';
import type {
  TimelineSort,
  TimelineEvent,
  TimelineGroup,
  TimelineEra,
  TimelineMarker,
} from '../timeline/types';
import type { TagGroup } from '../utils/tag-groups';

export type { D3ExportDimensions } from '../utils/d3-types';

export type VisualizationType =
  | 'slope'
  | 'wordcloud'
  | 'arc'
  | 'timeline'
  | 'venn'
  | 'quadrant'
  | 'sequence'
  | 'tech-radar'
  | 'cycle'
  | 'pyramid'
  | 'ring';

export interface D3DataItem {
  label: string;
  values: number[];
  color: string | null;
  lineNumber: number;
}

export interface WordCloudWord {
  text: string;
  weight: number;
  lineNumber: number;
}

export type WordCloudRotate = 'none' | 'mixed' | 'angled';

export interface WordCloudOptions {
  rotate: WordCloudRotate;
  max: number;
  minSize: number;
  maxSize: number;
}

export const DEFAULT_CLOUD_OPTIONS: WordCloudOptions = {
  rotate: 'none',
  max: 0,
  minSize: 14,
  maxSize: 80,
};

export interface ArcLink {
  source: string;
  target: string;
  value: number;
  color: string | null;
  lineNumber: number;
}

export type ArcOrder = 'appearance' | 'name' | 'group' | 'degree';

export interface ArcNodeGroup {
  name: string;
  nodes: string[];
  color: string | null;
  lineNumber: number;
}

export interface VennSet {
  name: string;
  alias: string | null;
  color: string | null;
  lineNumber: number;
}

export interface VennOverlap {
  sets: string[];
  label: string | null;
  lineNumber: number;
}

export interface QuadrantLabel {
  text: string;
  color: string | null;
  lineNumber: number;
}

export interface QuadrantPoint {
  label: string;
  x: number;
  y: number;
  lineNumber: number;
}

export interface QuadrantLabels {
  topRight: QuadrantLabel | null;
  topLeft: QuadrantLabel | null;
  bottomLeft: QuadrantLabel | null;
  bottomRight: QuadrantLabel | null;
}

// ============================================================
// Discriminated union — Story 109.2. Each visualization carries only the fields
// it actually uses; no renderer can see another's data. The parser builds a fat
// `ParsedVizFull` accumulator internally and returns it narrowed to this union.
// ============================================================

/** Fields every visualization shares. */
export interface ParsedVizBase {
  title: string | null;
  titleLineNumber: number | null;
  /** When true, the renderer suppresses the chart title. */
  noTitle?: boolean;
  diagnostics: DgmoError[];
  error: string | null;
}

export interface ParsedSlope extends ParsedVizBase {
  type: 'slope';
  periods: string[];
  data: D3DataItem[];
  noName?: boolean;
  noValue?: boolean;
  noPercent?: boolean;
}

export interface ParsedArc extends ParsedVizBase {
  type: 'arc';
  orientation: 'horizontal' | 'vertical';
  links: ArcLink[];
  arcOrder: ArcOrder;
  arcNodeGroups: ArcNodeGroup[];
  noName?: boolean;
  noValue?: boolean;
  noPercent?: boolean;
}

export interface ParsedTimeline extends ParsedVizBase {
  type: 'timeline';
  orientation: 'horizontal' | 'vertical';
  timelineEvents: TimelineEvent[];
  timelineGroups: TimelineGroup[];
  timelineEras: TimelineEra[];
  timelineMarkers: TimelineMarker[];
  timelineTagGroups: TagGroup[];
  timelineSort: TimelineSort | null;
  timelineDefaultSwimlaneTG?: string;
  timelineScale: boolean;
  timelineSwimlanes: boolean;
  /** Authored `active-tag <group|none|metric>` directive (§15.6); resolved at render. */
  timelineActiveTag?: string;
  /** Render with full intent saturation instead of the canonical 25% tint. */
  solidFill?: boolean;
}

export interface ParsedWordcloud extends ParsedVizBase {
  type: 'wordcloud';
  words: WordCloudWord[];
  cloudOptions: WordCloudOptions;
}

export interface ParsedVenn extends ParsedVizBase {
  type: 'venn';
  vennSets: VennSet[];
  vennOverlaps: VennOverlap[];
  noName?: boolean;
  noValue?: boolean;
  noPercent?: boolean;
}

export interface ParsedQuadrant extends ParsedVizBase {
  type: 'quadrant';
  quadrantLabels: QuadrantLabels;
  quadrantPoints: QuadrantPoint[];
  quadrantXAxis: [string, string] | null;
  quadrantXAxisLineNumber: number | null;
  quadrantYAxis: [string, string] | null;
  quadrantYAxisLineNumber: number | null;
  quadrantTitleLineNumber: number | null;
}

/**
 * `sequence` (rendered by its own parser) or an unsupported/empty parse result
 * (`type: null`). Carries only the base fields — callers branch on `error`.
 */
export interface ParsedVizEmpty extends ParsedVizBase {
  type: 'sequence' | null;
}

/** What `parseVisualization` returns: discriminated on `type`. */
export type ParsedVisualization =
  | ParsedSlope
  | ParsedArc
  | ParsedTimeline
  | ParsedWordcloud
  | ParsedVenn
  | ParsedQuadrant
  | ParsedVizEmpty;

/**
 * The parser's mutable accumulator — every field present, so the single
 * line-walking state machine can populate whichever the detected type needs.
 * `parseVisualization` returns this narrowed to {@link ParsedVisualization};
 * the object is structurally a superset of every variant, so the narrowing is
 * sound and changes nothing at runtime.
 */
export interface ParsedVizFull extends ParsedVizBase {
  type: VisualizationType | null;
  orientation: 'horizontal' | 'vertical';
  periods: string[];
  data: D3DataItem[];
  words: WordCloudWord[];
  cloudOptions: WordCloudOptions;
  links: ArcLink[];
  arcOrder: ArcOrder;
  arcNodeGroups: ArcNodeGroup[];
  timelineEvents: TimelineEvent[];
  timelineGroups: TimelineGroup[];
  timelineEras: TimelineEra[];
  timelineMarkers: TimelineMarker[];
  timelineTagGroups: TagGroup[];
  timelineSort: TimelineSort | null;
  timelineDefaultSwimlaneTG?: string;
  timelineScale: boolean;
  timelineSwimlanes: boolean;
  timelineActiveTag?: string;
  vennSets: VennSet[];
  vennOverlaps: VennOverlap[];
  quadrantLabels: QuadrantLabels;
  quadrantPoints: QuadrantPoint[];
  quadrantXAxis: [string, string] | null;
  quadrantXAxisLineNumber: number | null;
  quadrantYAxis: [string, string] | null;
  quadrantYAxisLineNumber: number | null;
  quadrantTitleLineNumber: number | null;
  noName?: boolean;
  noValue?: boolean;
  noPercent?: boolean;
  solidFill?: boolean;
}
