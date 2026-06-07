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

// Subdued stroke styling for the note box, fold, and leader line — thin and
// a little lighter so the annotation stays quiet next to the diagram.
const NOTE_STROKE_WIDTH = 0.6;
const NOTE_STROKE_OPACITY = 0.6;

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
  /** 1-based source line of the note (drives the toggle hook). */
  readonly lineNumber?: number;
  /** 1-based last source line of the note body. */
  readonly endLineNumber?: number;
  /**
   * When true, the box is a click target that collapses the note (the app
   * wires `data-note-toggle`): the group gets `cursor:pointer` + button
   * a11y and the box fill catches pointer events. When false (the default,
   * e.g. static export contexts), the box is inert.
   */
  readonly interactive?: boolean;
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
    .attr('stroke-width', NOTE_STROKE_WIDTH)
    .attr('stroke-opacity', NOTE_STROKE_OPACITY)
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

/** Faded-yellow note fill (resvg-safe — `mix`, never CSS color-mix). */
export function noteBoxFill(palette: PaletteColors, isDark: boolean): string {
  return isDark
    ? mix(palette.colors.yellow, palette.bg, 24)
    : mix(palette.colors.yellow, palette.bg, 16);
}

/** Note accent (border) colour — the palette's yellow. */
export function noteAccent(palette: PaletteColors): string {
  return palette.colors.yellow;
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
  const interactive = opts.interactive ?? false;
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
  if (interactive) {
    noteG
      .style('cursor', 'pointer')
      .attr('role', 'button')
      .attr('tabindex', '0')
      .attr('aria-expanded', 'true')
      .attr('aria-label', 'Collapse note');
  }

  // Folded-corner body path. When interactive it doubles as the click
  // target (default pointer-events); otherwise it's inert.
  const boxPath = noteG
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
    .attr('stroke', noteAccent(palette))
    .attr('stroke-width', NOTE_STROKE_WIDTH)
    .attr('stroke-opacity', NOTE_STROKE_OPACITY)
    .attr('class', 'note-box');
  if (!interactive) boxPath.style('pointer-events', 'none');

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
    .attr('stroke', noteAccent(palette))
    .attr('stroke-width', NOTE_STROKE_WIDTH)
    .attr('stroke-opacity', NOTE_STROKE_OPACITY)
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

export interface RenderNoteBadgeOptions {
  readonly isDark: boolean;
  /** 1-based source line of the note (drives the toggle hook). */
  readonly lineNumber?: number;
  readonly endLineNumber?: number;
}

/** Half the badge's footprint (px) — for callers reserving corner space. */
export const NOTE_BADGE_RADIUS = 7;

/** Overall opacity of the collapsed badge — kept quiet so it reads as a
 *  subtle affordance, not a loud icon competing with the node. */
const NOTE_BADGE_OPACITY = 0.6;

/**
 * Draw the collapsed-note badge: a small comment bubble pinned at `center`
 * (parent-group coords). Carries the same `data-note-toggle` + line attrs
 * as the expanded box, so clicking it re-expands the note. Interactive by
 * design (button a11y + `cursor:pointer`).
 */
export function renderNoteBadge(
  parent: GSelection,
  center: { readonly x: number; readonly y: number },
  palette: PaletteColors,
  opts: RenderNoteBadgeOptions
): GSelection {
  const fill = noteBoxFill(palette, opts.isDark);
  const g = parent
    .append('g')
    .attr('class', 'note note-badge')
    .attr('data-note-toggle', '')
    .attr('transform', `translate(${center.x}, ${center.y})`)
    .attr('opacity', NOTE_BADGE_OPACITY)
    .style('cursor', 'pointer')
    .attr('role', 'button')
    .attr('tabindex', '0')
    .attr('aria-expanded', 'false')
    .attr('aria-label', 'Expand note');
  if (opts.lineNumber !== undefined) {
    g.attr('data-line-number', String(opts.lineNumber));
  }
  if (opts.endLineNumber !== undefined) {
    g.attr('data-line-end', String(opts.endLineNumber));
  }

  // Comment bubble: small rounded body (13×9) with a tail at the
  // bottom-left. Single path so body + tail share one seamless outline.
  g.append('path')
    .attr(
      'd',
      [
        'M -6.5 -4',
        'Q -6.5 -6 -4.5 -6',
        'L 4.5 -6',
        'Q 6.5 -6 6.5 -4',
        'L 6.5 1',
        'Q 6.5 3 4.5 3',
        'L -1 3',
        'L -4 6',
        'L -2.5 3',
        'L -4.5 3',
        'Q -6.5 3 -6.5 1',
        'Z',
      ].join(' ')
    )
    .attr('fill', fill)
    .attr('stroke', noteAccent(palette))
    .attr('stroke-width', 0.55)
    .attr('class', 'note-badge-bubble');

  // Two short "text" strokes inside the bubble (group opacity tones them).
  g.append('line')
    .attr('x1', -3.5)
    .attr('y1', -3)
    .attr('x2', 3.5)
    .attr('y2', -3)
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 0.75)
    .style('pointer-events', 'none');
  g.append('line')
    .attr('x1', -3.5)
    .attr('y1', -0.5)
    .attr('x2', 1.5)
    .attr('y2', -0.5)
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 0.75)
    .style('pointer-events', 'none');

  return g;
}
