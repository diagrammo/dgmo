// ============================================================
// Shared note-box primitive — SVG drawing
// ============================================================
//
// A pure `(parent, rect, lines) → <g class="note">` drawer. Takes a
// final position and knows nothing about charts, layout, or anchoring.
// Folded-corner box (palette-themed via `mix`, resvg-safe — never CSS
// color-mix) + inline-markdown body. Carries the `data-note-toggle`
// hook + line-number attrs for a future collapse enhancement; decorative
// sub-paths are `pointer-events:none` so they never steal interactivity.

import type * as d3Selection from 'd3-selection';
import type { PaletteColors } from '../../palettes';
import { mix } from '../../palettes/color-utils';
import { renderInlineText } from '../inline-markdown';
import type { WrappedDescLine } from '../wrapped-desc';
import {
  NOTE_FOLD,
  NOTE_PAD_H,
  NOTE_PAD_V,
  NOTE_FONT_SIZE,
  NOTE_LINE_H,
  NOTE_BULLET_INDENT,
} from './constants';

type GSelection = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

export interface NoteRect {
  /** Left edge of the box, in the parent group's coordinate space. */
  readonly x: number;
  /** Top edge of the box. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RenderNoteBoxOptions {
  readonly isDark: boolean;
  readonly fontSize?: number;
  /** 1-based source line of the note (for the future toggle hook). */
  readonly lineNumber?: number;
  /** 1-based last source line of the note body. */
  readonly endLineNumber?: number;
}

/**
 * Draw the solid "tether" connecting a node to its note box so the
 * annotation reads as belonging to that node. The note floats beside the
 * shape WITHOUT moving it, so the tether spans the gap between them.
 * Coordinates are in the parent group's space. Decorative —
 * `pointer-events:none`.
 */
export function renderNoteConnector(
  parent: GSelection,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  palette: PaletteColors
): void {
  parent
    .append('line')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1)
    .attr('class', 'note-connector')
    .style('pointer-events', 'none');
}

/**
 * Connector endpoints `[x1, y1, x2, y2]` (node-center-local) from the
 * shape edge to the note's near edge, for the side the note sits on.
 */
export function noteConnectorPoints(
  node: { width: number; height: number },
  note: {
    x: number;
    y: number;
    width: number;
    height: number;
    side: 'above' | 'below' | 'left' | 'right';
  }
): [number, number, number, number] {
  const clampX = Math.max(note.x, Math.min(0, note.x + note.width));
  switch (note.side) {
    case 'right':
      return [node.width / 2, 0, note.x, note.y + note.height / 2];
    case 'left':
      return [
        -node.width / 2,
        0,
        note.x + note.width,
        note.y + note.height / 2,
      ];
    case 'below':
      return [clampX, node.height / 2, clampX, note.y];
    case 'above':
    default:
      return [clampX, -node.height / 2, clampX, note.y + note.height];
  }
}

/** Resvg-safe note fill — mirrors the sequence renderer. */
export function noteBoxFill(palette: PaletteColors, isDark: boolean): string {
  return isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.bg, palette.surface, 15);
}

/**
 * Append a folded-corner note box to `parent` at `rect`, with `lines`
 * (from {@link noteBoxSize}) as the body. Returns the created group.
 */
export function renderNoteBox(
  parent: GSelection,
  rect: NoteRect,
  lines: readonly WrappedDescLine[],
  palette: PaletteColors,
  opts: RenderNoteBoxOptions
): GSelection {
  const fontSize = opts.fontSize ?? NOTE_FONT_SIZE;
  const { x, y, width, height } = rect;
  const fill = noteBoxFill(palette, opts.isDark);

  const noteG = parent
    .append('g')
    .attr('class', 'note')
    .attr('data-note-toggle', '');
  if (opts.lineNumber !== undefined) {
    noteG.attr('data-line-number', String(opts.lineNumber));
  }
  if (opts.endLineNumber !== undefined) {
    noteG.attr('data-line-end', String(opts.endLineNumber));
  }

  // Folded-corner body path.
  noteG
    .append('path')
    .attr(
      'd',
      [
        `M ${x} ${y}`,
        `L ${x + width - NOTE_FOLD} ${y}`,
        `L ${x + width} ${y + NOTE_FOLD}`,
        `L ${x + width} ${y + height}`,
        `L ${x} ${y + height}`,
        'Z',
      ].join(' ')
    )
    .attr('fill', fill)
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 0.75)
    .attr('class', 'note-box')
    .style('pointer-events', 'none');

  // Fold triangle.
  noteG
    .append('path')
    .attr(
      'd',
      [
        `M ${x + width - NOTE_FOLD} ${y}`,
        `L ${x + width - NOTE_FOLD} ${y + NOTE_FOLD}`,
        `L ${x + width} ${y + NOTE_FOLD}`,
      ].join(' ')
    )
    .attr('fill', 'none')
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 0.75)
    .attr('class', 'note-fold')
    .style('pointer-events', 'none');

  // Body text — bullet first-lines get a "•" glyph at the left edge with
  // the body hanging-indented; continuation lines align under the body.
  lines.forEach((line, li) => {
    const textY = y + NOTE_PAD_V + (li + 1) * NOTE_LINE_H - 3;
    const indent = line.kind === 'plain' ? 0 : NOTE_BULLET_INDENT;
    if (line.kind === 'bullet-first') {
      noteG
        .append('text')
        .attr('x', x + NOTE_PAD_H)
        .attr('y', textY)
        .attr('fill', palette.text)
        .attr('font-size', fontSize)
        .text('•');
    }
    const textEl = noteG
      .append('text')
      .attr('x', x + NOTE_PAD_H + indent)
      .attr('y', textY)
      .attr('fill', palette.text)
      .attr('font-size', fontSize)
      .attr('class', 'note-text');
    renderInlineText(textEl, line.text, palette, fontSize);
  });

  return noteG;
}
