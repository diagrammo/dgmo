import type { TagGroup } from '../utils/tag-groups';
import type { DgmoError } from '../diagnostics';

export interface BLNode {
  readonly label: string;
  readonly lineNumber: number;
  readonly metadata: Readonly<Record<string, string>>;
  readonly description?: readonly string[];
  /** Numeric measure lifted from `value: X` metadata (mirror of map's
   *  `region.value`). Drives the value ramp / choropleth tinting. */
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
  readonly initialHiddenTagValues: ReadonlyMap<string, ReadonlySet<string>>;
  readonly direction: 'LR' | 'TB';
  /** `box-metric <label> [color]` — names the value-ramp dimension and
   *  optionally sets its hue. Mirror of map's `region-metric`. */
  readonly boxMetric?: string;
  readonly boxMetricColor?: string;
  /** `show-values` — print each box's numeric value as text (opt-in). */
  readonly showValues?: boolean;
  readonly diagnostics: readonly DgmoError[];
  readonly error: string | null;
}
