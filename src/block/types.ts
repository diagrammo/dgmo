import type { DgmoError } from '../diagnostics';
import type { TagGroup } from '../utils/tag-groups';

// ============================================================
// Block diagram — Parsed Types
// ============================================================
//
// A block diagram is an author-controlled GRID of rectangular blocks. One
// source line = one row; `[Label]` is a block; `_` is an empty cell. A block
// becomes a CONTAINER by indenting a sub-grid under it (siblings stack
// vertically; the horizontal grid is for the leaf blocks inside a container).
// Metadata (tags, `span:`, `collapsed`) goes OUTSIDE the bracket — the
// boxes-and-lines group idiom — and a group's tag cascades to its children.
// See the block § of docs/dgmo-language-spec.md for the canonical grammar.

/** A single block. Becomes a container when `grid` is present. */
export interface BlockNode {
  readonly id: string;
  readonly label: string;
  /** Column span (≥ 1). Resolved/clamped during the layout-inference pass. */
  span: number;
  /** Authored `collapsed` flag — container starts folded (collapse-bar). */
  collapsed: boolean;
  readonly metadata: Record<string, string>;
  readonly lineNumber: number;
  /** Present iff this block is a container (has an indented sub-grid). */
  grid?: BlockGrid;
}

/** A deliberate empty cell (`_`), reserving grid space with no block. */
export interface EmptyCell {
  readonly empty: true;
  span: number;
}

export type BlockCell = BlockNode | EmptyCell;

export interface BlockGrid {
  /** Explicit `columns N`, or null until the inference pass resolves it from
   *  the widest row. After parse this is always a positive integer. */
  cols: number | null;
  readonly rows: BlockCell[][];
}

export interface BlockOptions {
  /** `no-legend` — hide the tag legend. */
  noLegend: boolean;
  /** `solid-fill` — fill nodes at full intent saturation instead of a tint. */
  solidFill: boolean;
}

export interface ParsedBlock {
  readonly type: 'block';
  readonly title: string | null;
  readonly titleLineNumber: number | null;
  /** The top-level grid (rows of cells; containers nest their own grids). */
  readonly top: BlockGrid;
  readonly tagGroups: TagGroup[];
  readonly options: BlockOptions;
  readonly diagnostics: DgmoError[];
  readonly error: string | null;
}

/** Type guard — narrow a cell to the deliberate-empty case. */
export function isEmptyCell(cell: BlockCell): cell is EmptyCell {
  return (cell as EmptyCell).empty === true;
}

/** Type guard — narrow a cell to a real block. */
export function isBlockNode(cell: BlockCell): cell is BlockNode {
  return (cell as EmptyCell).empty !== true;
}
