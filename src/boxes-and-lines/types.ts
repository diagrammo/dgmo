import type { TagGroup } from '../utils/tag-groups';
import type { DgmoError } from '../diagnostics';
import type { DiagramNote } from '../utils/notes';

export interface BLNode {
  readonly label: string;
  readonly lineNumber: number;
  readonly metadata: Readonly<Record<string, string>>;
  readonly description?: readonly string[];
  /** Numeric measure lifted from `heat: X` metadata (mirror of map's
   *  `region.value`). Drives the heat ramp / choropleth tinting. */
  readonly value?: number;
}

export interface BLEdge {
  readonly source: string;
  readonly target: string;
  readonly label?: string;
  readonly bidirectional: boolean;
  readonly lineNumber: number;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface BLGroup {
  readonly label: string;
  readonly children: readonly string[];
  readonly lineNumber: number;
  readonly metadata: Readonly<Record<string, string>>;
  readonly parentGroup?: string;
}

export interface ParsedBoxesAndLines {
  readonly type: 'boxes-and-lines';
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly nodes: readonly BLNode[];
  readonly edges: readonly BLEdge[];
  readonly groups: readonly BLGroup[];
  readonly tagGroups: readonly TagGroup[];
  readonly options: Readonly<Record<string, string>>;
  /** Generic node notes (`note <Box> …`); resolved in layout. */
  readonly notes?: readonly DiagramNote[];
  readonly initialHiddenTagValues: ReadonlyMap<string, ReadonlySet<string>>;
  readonly direction: 'LR' | 'TB';
  /** `heat <label> [low] [high]` — names the value-ramp dimension and
   *  optionally sets its endpoint colours. One color = high hue over a neutral
   *  low; two = explicit `low high`. Mirror of map's `region-heat`. */
  readonly boxMetric?: string;
  /** Recognized color NAME for the ramp HIGH endpoint. */
  readonly boxMetricColor?: string;
  /** Recognized color NAME for the ramp LOW endpoint (two-colour form). */
  readonly boxMetricLowColor?: string;
  /**
   * Box numeric value labels. Default ON (decision #48) — `no-value` sets
   * `false`; legacy `show-values` sets `true` (a no-op). `undefined` = on.
   */
  readonly showValues?: boolean;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
