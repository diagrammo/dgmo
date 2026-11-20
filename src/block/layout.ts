// ============================================================
// Block diagram — Layout (deterministic grid solver)
// ============================================================
//
// No graph layout: block placement is fully determined by the grid. Sizing is
// intrinsic + bottom-up — each container sizes to its contents (a column is as
// wide as its widest cell, capped) so nesting never crushes inner blocks. A
// collapsed container renders as a compact header band (the collapse-bar lives
// in the renderer). Output is a tree of absolutely-positioned items the renderer
// walks; colours are resolved renderer-side (they're palette-dependent).

import { measureText, wrapTextToWidth } from '../utils/text-measure';
import type { BlockGrid, BlockNode } from './types';
import { isBlockNode } from './types';

export const BLOCK_GAP = 12;
export const BLOCK_PAD = 10;
export const BLOCK_LEAF_H = 46;
export const BLOCK_HEADER_H = 28;
export const BLOCK_COLLAPSED_H = 46;
const MIN_COL = 104;
const MAX_COL = 250;
const LABEL_FS = 13;
/** Font size of a collapsed container's label. */
const BLOCK_COLLAPSED_FS = 12.5;
// Horizontal room a label leaves inside its box: a leaf, then a collapsed or
// expanded container.
const LEAF_INSET = 16;
const CONTAINER_INSET = 24;

export interface BlockLayoutItem {
  type: 'leaf' | 'container' | 'collapsed' | 'empty';
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  node?: BlockNode;
  lineNumber?: number;
  /** Container children (a nested layout). */
  inner?: BlockLayoutItem[];
  /** The label as drawn: wrapped to the box, a too-wide word hard-broken. */
  labelLines?: string[];
  /** Font size the label lines were wrapped at. */
  labelFs?: number;
}

export interface BlockLayoutResult {
  width: number;
  height: number;
  items: BlockLayoutItem[];
}

export interface BlockLayoutOptions {
  /** Block ids rendered folded (authored `collapsed` + app runtime toggles). */
  collapsed?: ReadonlySet<string>;
}

export function layoutBlock(
  grid: BlockGrid,
  opts: BlockLayoutOptions = {}
): BlockLayoutResult {
  const collapsed = opts.collapsed ?? new Set<string>();
  const node = layoutGrid(grid, 0, 0, null, collapsed);
  return { width: node.w, height: node.h, items: node.items };
}

// ── label wrapping ──────────────────────────────────────────

/** Baseline-to-baseline distance of a wrapped block label. */
export function blockLineH(fs: number): number {
  return Math.round(fs * 1.3);
}

/**
 * An expanded container's header scales (subtly) with the box size — a soft
 * section watermark on big regions, crisp on small ones.
 */
export function blockHeaderFs(w: number, h: number): number {
  const sizeMetric = Math.min(w, h * 2.5);
  return Math.max(13, Math.min(20, Math.round(13 + (sizeMetric - 220) / 70)));
}

/**
 * A label wrapped onto as many lines as it needs; only a word wider than the
 * box is broken, at a character boundary (#2172). Measured bold: the labels
 * draw at 700 or 600, and with only Regular and Bold shipped, CSS font
 * matching resolves 600 up to the Bold face.
 */
function wrapLabel(label: string, maxWidth: number, fs: number): string[] {
  return wrapTextToWidth(label, fs, maxWidth, { bold: true, hardBreak: true });
}

function shiftItems(items: BlockLayoutItem[], dy: number): void {
  for (const it of items) {
    it.y += dy;
    if (it.inner) shiftItems(it.inner, dy);
  }
}

// ── intrinsic sizing ────────────────────────────────────────

function maxSpanSum(g: BlockGrid): number {
  return Math.max(
    1,
    ...g.rows.map((r) => r.reduce((s, c) => s + (c.span || 1), 0))
  );
}

function leafW(node: BlockNode): number {
  return Math.max(
    MIN_COL,
    Math.min(MAX_COL, measureText(node.label, LABEL_FS) + 2 * BLOCK_PAD + 14)
  );
}

function gridColW(g: BlockGrid): number {
  let m = MIN_COL;
  for (const row of g.rows)
    for (const c of row) {
      if (!isBlockNode(c)) continue;
      const iw = c.grid ? intrinsicGridW(c.grid) + 2 * BLOCK_PAD : leafW(c);
      m = Math.max(m, iw / (c.span || 1));
    }
  return m;
}

function intrinsicGridW(g: BlockGrid): number {
  const cols = g.cols ?? maxSpanSum(g);
  return cols * gridColW(g) + (cols + 1) * BLOCK_GAP;
}

interface GridLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  items: BlockLayoutItem[];
}

function layoutGrid(
  g: BlockGrid,
  ox: number,
  oy: number,
  forceColW: number | null,
  collapsed: ReadonlySet<string>
): GridLayout {
  const cols = g.cols ?? maxSpanSum(g);
  const colW = forceColW ?? gridColW(g);
  const gridW = cols * colW + (cols + 1) * BLOCK_GAP;
  let cy = oy + BLOCK_GAP;
  const items: BlockLayoutItem[] = [];
  let maxRight = ox + BLOCK_GAP;

  for (const row of g.rows) {
    let cx = ox + BLOCK_GAP;
    let rowH = BLOCK_LEAF_H;
    const rowItems: BlockLayoutItem[] = [];

    for (const cell of row) {
      const span = cell.span || 1;
      const cw = span * colW + (span - 1) * BLOCK_GAP;

      if (!isBlockNode(cell)) {
        rowItems.push({ type: 'empty', x: cx, y: cy, w: cw, h: BLOCK_LEAF_H });
        cx += cw + BLOCK_GAP;
        maxRight = Math.max(maxRight, cx - BLOCK_GAP);
        continue;
      }

      if (cell.grid && collapsed.has(cell.id)) {
        const lines = wrapLabel(
          cell.label,
          cw - CONTAINER_INSET,
          BLOCK_COLLAPSED_FS
        );
        const h =
          BLOCK_COLLAPSED_H +
          (lines.length - 1) * blockLineH(BLOCK_COLLAPSED_FS);
        const item: BlockLayoutItem = {
          type: 'collapsed',
          x: cx,
          y: cy,
          w: cw,
          h,
          label: cell.label,
          node: cell,
          lineNumber: cell.lineNumber,
          labelLines: lines,
          labelFs: BLOCK_COLLAPSED_FS,
        };
        rowItems.push(item);
        rowH = Math.max(rowH, h);
        cx += cw + BLOCK_GAP;
        maxRight = Math.max(maxRight, cx - BLOCK_GAP);
        continue;
      }

      if (cell.grid) {
        const innerCols = cell.grid.cols ?? maxSpanSum(cell.grid);
        const innerColW = Math.max(
          MIN_COL * 0.66,
          (cw - 2 * BLOCK_PAD - (innerCols + 1) * BLOCK_GAP) / innerCols
        );
        const inner = layoutGrid(
          cell.grid,
          cx + BLOCK_PAD,
          cy + BLOCK_HEADER_H,
          innerColW,
          collapsed
        );
        // The header's font follows the box's size before any extra header
        // lines, so a label that fits draws exactly as it always has.
        const fs = blockHeaderFs(cw, BLOCK_HEADER_H + inner.h + BLOCK_PAD);
        const lines = wrapLabel(cell.label, cw - CONTAINER_INSET, fs);
        const extra = (lines.length - 1) * blockLineH(fs);
        if (extra > 0) shiftItems(inner.items, extra);
        const h = BLOCK_HEADER_H + extra + inner.h + BLOCK_PAD;
        rowItems.push({
          type: 'container',
          x: cx,
          y: cy,
          w: cw,
          h,
          label: cell.label,
          node: cell,
          lineNumber: cell.lineNumber,
          inner: inner.items,
          labelLines: lines,
          labelFs: fs,
        });
        rowH = Math.max(rowH, h);
        cx += cw + BLOCK_GAP;
        maxRight = Math.max(maxRight, cx - BLOCK_GAP);
        continue;
      }

      const lines = wrapLabel(cell.label, cw - LEAF_INSET, LABEL_FS);
      const h = BLOCK_LEAF_H + (lines.length - 1) * blockLineH(LABEL_FS);
      rowItems.push({
        type: 'leaf',
        x: cx,
        y: cy,
        w: cw,
        h,
        label: cell.label,
        node: cell,
        lineNumber: cell.lineNumber,
        labelLines: lines,
        labelFs: LABEL_FS,
      });
      rowH = Math.max(rowH, h);
      cx += cw + BLOCK_GAP;
      maxRight = Math.max(maxRight, cx - BLOCK_GAP);
    }

    items.push(...rowItems);
    cy += rowH + BLOCK_GAP;
  }

  const fitW = Math.max(gridW, maxRight - ox + BLOCK_GAP);
  return { x: ox, y: oy, w: fitW, h: cy - oy, items };
}
