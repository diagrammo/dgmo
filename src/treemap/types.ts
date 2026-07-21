import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

// ============================================================
// Treemap — Parsed Types
// ============================================================
//
// A treemap is a hierarchy (indentation) where each leaf carries a size
// (the bare trailing number) and parents auto-sum their descendants. See the
// treemap § of docs/dgmo-language-spec.md for the canonical grammar.

/** Runtime color mode for a treemap. Default resolved from source; the app's
 *  legend/settings switcher overrides it live without editing source. */
export type TreemapColorMode = 'tag' | 'heat' | 'branch';

export interface TreemapNode {
  readonly id: string;
  readonly label: string;
  /**
   * Leaf size = the bare trailing number. `undefined` for branches (the layout
   * auto-sums descendants) and for value-less leaves (treated as 0 + a warning).
   */
  value?: number;
  /** Optional per-node heat metric (`heat:`), drives the color-by-value ramp. */
  heat?: number;
  readonly metadata: Record<string, string>;
  readonly children: TreemapNode[];
  readonly lineNumber: number;
}

export interface TreemapOptions {
  /** Label for the heat ramp (`heat <Label> …`). */
  heatLabel?: string;
  /** Explicit ramp colors peeled from the `heat` directive (0–2, named only). */
  readonly heatColors: string[];
  /** `depth N` — render budget (interactive only); undefined = unlimited. */
  maxDepth?: number;
  noValues: boolean;
  noPercent: boolean;
  noHeaders: boolean;
  noLegend: boolean;
  /** §1.9 `legend-inline` — title left, legend flushed right on one row. */
  legendInline?: boolean;
  /** §1.9 fill family; undefined ⇒ canonical 25% tint. */
  fillMode: 'solid' | 'outline' | undefined;
  /** `radial` — render as a sunburst (concentric rings) instead of rectangles. */
  radial: boolean;
}

export interface ParsedTreemap {
  readonly type: 'treemap';
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  readonly roots: TreemapNode[];
  readonly tagGroups: TagGroup[];
  /** True when any `heat:` value or a `heat` directive was declared. */
  readonly hasHeat: boolean;
  /** Raw `active-tag` directive value (§24C.6) — source-level pre-selection of
   *  the resting color dimension. `undefined` = directive absent. */
  activeTag?: string;
  /** Line of the `active-tag` directive (diagnostics anchor). */
  activeTagLineNumber?: number;
  /** Source-declared default color mode. Resolution (decision #48): the
   *  `active-tag` directive when it names a known dimension, else the
   *  universal heat > tag > branch precedence (map §24B.4 / b&l §13.9). */
  readonly defaultColorMode: TreemapColorMode;
  readonly options: TreemapOptions;
  readonly diagnostics: DgmoError[];
  readonly error: string | null;
}
