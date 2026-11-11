// ============================================================
// Whiteboard diagram — Renderer (spec §39)
// ============================================================
//
// Clean vector shapes (no hand-drawn wobble); only ink looks hand-made, drawn
// with perfect-freehand as a filled outline polygon so resvg renders it too.
// The canvas is infinite, so the SVG is cropped to the content bounds plus a
// margin, with the title band above.
//
// Colours are palette NAMES resolved here: `ink` is `palette.text` (near-black
// on light, near-white on dark), every other name is the palette's own shade
// of that hue for the current theme.

import * as d3 from 'd3-selection';
import { getStroke } from 'perfect-freehand';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import {
  contrastText,
  mix,
  shapeFill,
  themeBaseBg,
} from '../palettes/color-utils';
import { drawCylinderCard, drawQueueCard } from '../shapes/draw';
import {
  GLYPH_STROKE,
  GLYPH_VIEWBOX,
  glyphPaths,
  type GlyphName,
} from '../glyphs/registry';
import { renderChartTitle } from '../utils/d3-helpers';
import { measureText } from '../utils/text-measure';
import { TITLE_FONT_SIZE } from '../utils/title-constants';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { getMaxLegendReservedHeight } from '../utils/legend-layout';
import type { LegendGroupData } from '../utils/legend-types';
import {
  RECT_RADIUS,
  clipWhiteboardConnector,
  whiteboardConnectorAttachments,
  whiteboardDrawOrder,
  whiteboardEnclosesAny,
  whiteboardFilePath,
  whiteboardNoteFold,
  whiteboardSegmentMidpoint,
  type WhiteboardPoint,
  type WhiteboardSegment,
} from './geometry';
import type { InkPoint } from './ink-codec';
import {
  WHITEBOARD_LABEL_FONT as LABEL_FONT,
  WHITEBOARD_LABEL_LINE as LABEL_LINE,
  WHITEBOARD_NOTE_PAD as NOTE_PAD,
  WHITEBOARD_CONTAINER_WEIGHT,
  fitWhiteboardLabel,
  whiteboardLabelShift,
  whiteboardShapeLabel,
} from './label';
import type {
  ParsedWhiteboard,
  WhiteboardColor,
  WhiteboardElement,
  WhiteboardImage,
  WhiteboardNote,
  WhiteboardShape,
} from './types';
import { WHITEBOARD_COLORS, WHITEBOARD_NOTE_COLOR } from './types';

export interface WhiteboardRenderOptions {
  /**
   * Turn an image ref into an `href` (a data URI or a URL). When supplied, its
   * answer is final: `undefined` draws the placeholder box. When omitted,
   * `https://` refs pass through unchanged and anything else is a placeholder.
   */
  readonly resolveImage?: (ref: string) => string | undefined;
  /**
   * Draw the sticky notes, overriding the board's `no-notes` directive either
   * way — the app's notes toggle and its export pass this. Omitted, the
   * directive decides: notes show unless the board says `no-notes`. Hidden
   * notes are left out entirely — not drawn, not counted in the crop — and so
   * is every arrow or line with an end on one.
   */
  readonly showNotes?: boolean;
}

/**
 * Whole-board indices of the elements a render draws, in order: every
 * element, less the sticky notes when they are hidden (see
 * {@link WhiteboardRenderOptions.showNotes}) and less every arrow or line with
 * an end on a hidden note — a connector drawn from a note goes with it, label
 * and all. Attachment is read on the WHOLE board, so an end the note held is
 * not re-attached to whatever lies beneath it.
 */
export function visibleWhiteboardIndices(
  parsed: ParsedWhiteboard,
  options: Pick<WhiteboardRenderOptions, 'showNotes'> = {}
): number[] {
  const all = parsed.elements;
  const show = options.showNotes ?? !parsed.options.noNotes;
  const out: number[] = [];
  all.forEach((el, i) => {
    if (show) return void out.push(i);
    if (el.kind === 'note') return;
    if (el.kind === 'arrow' || el.kind === 'line') {
      const { from, to } = whiteboardConnectorAttachments(el, all);
      if (all[from]?.kind === 'note' || all[to]?.kind === 'note') return;
    }
    out.push(i);
  });
  return out;
}

/**
 * The elements a render draws, in order — {@link visibleWhiteboardIndices},
 * as elements.
 */
export function visibleWhiteboardElements(
  parsed: ParsedWhiteboard,
  options: Pick<WhiteboardRenderOptions, 'showNotes'> = {}
): readonly WhiteboardElement[] {
  const show = options.showNotes ?? !parsed.options.noNotes;
  if (show) return parsed.elements;
  return visibleWhiteboardIndices(parsed, options).map(
    (i) => parsed.elements[i]!
  );
}

/** Space around the cropped content, px. */
const WHITEBOARD_MARGIN = 24;
const TITLE_BAND = 40;
/** Gap between the legend band and the content below it, px. */
const LEGEND_GAP = 8;
/** Opacity of a legend whose colours are all still unnamed (#1344). */
const LEGEND_FAINT_OPACITY = 0.4;
/**
 * The legend's group name before the board has a `tag` block — the name the
 * spec's example writes (`tag Meaning`). The shared legend draws nothing for a
 * nameless group.
 */
const LEGEND_DEFAULT_GROUP = 'Meaning';

/**
 * The colour legend (#1344): one dot per colour on the board, named by the
 * first `tag` group's entry for it. Fewer than two colours draw nothing. With
 * none named it is drawn faintly, as bare dots; once one is named, at full
 * strength. `ink` is no colour, and a note in its default yellow is coloured by
 * its kind, not by a choice, so neither counts.
 */
function whiteboardLegend(
  parsed: ParsedWhiteboard,
  elements: readonly WhiteboardElement[],
  colorOf: (c: WhiteboardColor) => string
): {
  group: LegendGroupData;
  named: boolean;
  /** The legend entry each counted colour pairs with on hover. */
  entryOf: ReadonlyMap<WhiteboardColor, string>;
} | null {
  const used = new Set<WhiteboardColor>();
  for (const el of elements) {
    const c = legendColor(el);
    if (c) used.add(c);
  }
  if (used.size < 2) return null;
  const tags = parsed.tagGroups[0];
  const nameOf = (c: WhiteboardColor): string =>
    tags?.entries.find((e) => e.color === c)?.value ?? '';
  const entries = WHITEBOARD_COLORS.filter((c) => used.has(c)).map((c) => ({
    value: nameOf(c),
    color: colorOf(c),
  }));
  return {
    group: { name: tags?.name ?? LEGEND_DEFAULT_GROUP, entries },
    named: entries.some((e) => e.value !== ''),
    entryOf: new Map([...used].map((c) => [c, nameOf(c)])),
  };
}

/** The colour an element counts toward the legend, if any. */
function legendColor(el: WhiteboardElement): WhiteboardColor | null {
  if (!('color' in el) || el.color === 'ink') return null;
  if (el.kind === 'note' && el.color === WHITEBOARD_NOTE_COLOR) return null;
  return el.color;
}
const SHAPE_STROKE = 2;
const ARROW_STROKE = 2;
const ARROW_HEAD_LEN = 12;
const ARROW_HEAD_HALF = 6;
/**
 * `style: dashed` dash and gap, in multiples of the stroke width. The round
 * caps add half a width to each end of a dash, so the drawn dash is one width
 * longer and the drawn gap one width shorter: 8 on, 6 off at the default 2px.
 */
/** Width of the halo behind a shape label, in the shape's fill, px. */
const LABEL_HALO = 3;
const DASH_ON = 3;
const DASH_OFF = 4;
const WHITEBOARD_TEXT_FONT = 16;
/** A sticky note's fill and edge: its hue mixed into the ground, percent. */
const NOTE_TINT = 40;
const NOTE_EDGE = 65;
/** A `fill: solid` shape's outline: this much of its colour, the rest its
 *  label colour, percent. */
const SOLID_EDGE = 55;
/** A sticky note's text: its hue mixed into the palette's text colour, percent. */
const NOTE_INK = 40;
/** Opacity of a sticky note's folded corner, drawn in its edge colour. */
const NOTE_FOLD_OPACITY = 0.55;
const BASELINE = 0.8;
/** Placeholder text for an image no host could resolve. */
export const IMAGE_NOT_UPLOADED = 'image not uploaded';
const PLACEHOLDER_MIN_FONT = 8;

/** A drawable `href`: http(s), blob, or an inline raster/vector image. */
const SAFE_IMAGE_HREF_RE = /^(https?:|blob:|data:image\/)/i;

/** An arrow, line or text label's written lines — one drawn line each, never reflowed. */
function labelLines(label: string): string[] {
  return label.split('\n');
}

/** Widest of `lines` at `font` px. */
function widest(lines: readonly string[], font: number, bold = false): number {
  return Math.max(0, ...lines.map((l) => measureText(l, font, { bold })));
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function grow(b: Bounds, x0: number, y0: number, x1: number, y1: number): void {
  b.minX = Math.min(b.minX, x0, x1);
  b.minY = Math.min(b.minY, y0, y1);
  b.maxX = Math.max(b.maxX, x0, x1);
  b.maxY = Math.max(b.maxY, y0, y1);
}

/** Height of a sticky note's text block, padding included, px. */
function noteTextHeight(el: WhiteboardNote): number {
  const { lines, font, top } = fitWhiteboardLabel(el.text, el);
  return 2 * top + lines.length * font * LABEL_LINE;
}

/** Gap between a glyph's box and the first line of its label, px. */
const GLYPH_CAPTION_GAP = 4;
/** Widest a glyph's line is drawn, in multiples of SHAPE_STROKE. */
const GLYPH_STROKE_MAX = 2;

/** A glyph shape — a line icon with its label beneath its box. */
type WhiteboardGlyph = WhiteboardShape & { readonly glyph: GlyphName };

function isGlyph(el: WhiteboardElement): el is WhiteboardGlyph {
  return el.kind === 'shape' && el.glyph !== undefined;
}

/** A glyph's label: written lines, centred under its box, never wrapped. */
function glyphCaption(el: WhiteboardGlyph): {
  lines: string[];
  top: number;
  width: number;
  height: number;
} {
  const lines = el.label ? labelLines(el.label) : [];
  return {
    lines,
    top: el.y + el.height + GLYPH_CAPTION_GAP,
    width: widest(lines, LABEL_FONT),
    height: lines.length * LABEL_FONT * LABEL_LINE,
  };
}

/** Content bounds of every drawn element, in canvas px. */
export function whiteboardBounds(
  parsed: ParsedWhiteboard,
  options: Pick<WhiteboardRenderOptions, 'showNotes'> = {}
): Bounds {
  const b: Bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  const elements = visibleWhiteboardElements(parsed, options);
  const labelAt = placeConnectorLabels(elements, parsed.elements);
  for (const el of elements) {
    switch (el.kind) {
      case 'shape':
      case 'image':
        grow(b, el.x, el.y, el.x + el.width, el.y + el.height);
        if (isGlyph(el)) {
          // The label hangs below the box and stays in the crop.
          const c = glyphCaption(el);
          const cx = el.x + el.width / 2;
          if (c.lines.length > 0) {
            grow(
              b,
              cx - c.width / 2,
              c.top,
              cx + c.width / 2,
              c.top + c.height
            );
          }
        }
        break;
      case 'note':
        // Text longer than the card runs on below it, and stays in the crop.
        grow(
          b,
          el.x,
          el.y,
          el.x + el.width,
          el.y + Math.max(el.height, noteTextHeight(el))
        );
        break;
      case 'arrow':
      case 'line': {
        // The DRAWN segment — an end attached to a shape stops at its border.
        const s = clipWhiteboardConnector(el, elements);
        const pad = ARROW_HEAD_HALF + ARROW_STROKE;
        grow(b, s.x1 - pad, s.y1 - pad, s.x2 + pad, s.y2 + pad);
        grow(b, s.x1 + pad, s.y1 + pad, s.x2 - pad, s.y2 - pad);
        if (s.cx !== undefined) {
          for (let k = 1; k < CURVE_BOUND_STEPS; k++) {
            const p = segmentPoint(s, k / CURVE_BOUND_STEPS);
            grow(b, p.x - pad, p.y - pad, p.x + pad, p.y + pad);
          }
        }
        if (el.label) {
          const lines = labelLines(el.label);
          const { x: mx, y: my } = labelAt.get(el)!;
          const hw = widest(lines, LABEL_FONT) / 2 + 4;
          const hh =
            LABEL_FONT + ((lines.length - 1) * LABEL_FONT * LABEL_LINE) / 2;
          grow(b, mx - hw, my - hh, mx + hw, my + hh);
        }
        break;
      }
      case 'text': {
        const lines = labelLines(el.text);
        grow(
          b,
          el.x,
          el.y,
          el.x + widest(lines, WHITEBOARD_TEXT_FONT),
          el.y + lines.length * WHITEBOARD_TEXT_FONT * LABEL_LINE
        );
        break;
      }
      case 'ink': {
        const r = el.width;
        for (const p of el.points) grow(b, p.x - r, p.y - r, p.x + r, p.y + r);
        break;
      }
    }
  }
  if (!Number.isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return b;
}

/** Samples taken along a curve to fit it in the crop. */
const CURVE_BOUND_STEPS = 16;

/** The point at `t` along a drawn segment — straight, or its quadratic. */
function segmentPoint(s: WhiteboardSegment, t: number): WhiteboardPoint {
  const u = 1 - t;
  if (s.cx === undefined || s.cy === undefined) {
    return { x: u * s.x1 + t * s.x2, y: u * s.y1 + t * s.y2 };
  }
  return {
    x: u * u * s.x1 + 2 * u * t * s.cx + t * t * s.x2,
    y: u * u * s.y1 + 2 * u * t * s.cy + t * t * s.y2,
  };
}

/**
 * The `t` at which a curve is `len` px (straight-line) from its end at
 * `t = end`, found by bisection; the head is drawn over the rest.
 */
function curveTrim(s: WhiteboardSegment, end: 0 | 1, len: number): number {
  const tip = segmentPoint(s, end);
  let near: number = end;
  let far: number = 1 - end;
  for (let n = 0; n < 24; n++) {
    const m = (near + far) / 2;
    const p = segmentPoint(s, m);
    if (Math.hypot(p.x - tip.x, p.y - tip.y) < len) near = m;
    else far = m;
  }
  return (near + far) / 2;
}

/** How far along its connector a label slides per try, as a fraction of t. */
const LABEL_SLIDE_STEP = 0.05;
/** Tries each way from the midpoint — the label stays within t ∈ [0.1, 0.9]. */
const LABEL_SLIDE_TRIES = 8;
/**
 * Clearance kept around an edge label, px: half its halo stroke (the
 * knock-out reaches 2 px) plus a gap, so it does not read as one block with
 * the text beside it.
 */
const LABEL_CLEAR = 5;
/** Gap between a label set beside its connector and the stroke, px. */
const LABEL_SIDE_GAP = 2;
/** How far around a candidate box the "how busy is this side" count looks, px. */
const LABEL_BUSY_REACH = 14;
/**
 * Cost of a candidate placement, in slide steps. Any overlap outweighs every
 * clean placement; a beside-the-line placement costs a few slide steps, so a
 * short slide wins over stepping off the line, and stepping off wins over a
 * long slide; nearby clutter breaks ties toward the quieter side.
 */
const LABEL_HIT_COST = 1000;
const LABEL_SIDE_COST = 3;
const LABEL_BUSY_COST = 0.25;

interface TextBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxesOverlap(a: TextBox, b: TextBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function grownBox(b: TextBox, by: number): TextBox {
  return { x0: b.x0 - by, y0: b.y0 - by, x1: b.x1 + by, y1: b.y1 + by };
}

/** Whether the segment a→b passes through `box` (Liang–Barsky clip). */
function segmentMeetsBox(
  a: WhiteboardPoint,
  b: WhiteboardPoint,
  box: TextBox
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - box.x0],
    [dx, box.x1 - a.x],
    [-dy, a.y - box.y0],
    [dy, box.y1 - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

/** A drawn segment as a polyline: its ends, or its curve sampled. */
function segmentPolyline(s: WhiteboardSegment): WhiteboardPoint[] {
  if (s.cx === undefined || s.cy === undefined) {
    return [
      { x: s.x1, y: s.y1 },
      { x: s.x2, y: s.y2 },
    ];
  }
  const pts: WhiteboardPoint[] = [];
  for (let k = 0; k <= CURVE_BOUND_STEPS; k++) {
    pts.push(segmentPoint(s, k / CURVE_BOUND_STEPS));
  }
  return pts;
}

function polylineMeetsBox(
  pts: readonly WhiteboardPoint[],
  box: TextBox
): boolean {
  for (let k = 1; k < pts.length; k++) {
    if (segmentMeetsBox(pts[k - 1]!, pts[k]!, box)) return true;
  }
  return false;
}

/** An edge label's drawn block, halo included, centred on (x, y). */
function connectorLabelBox(
  lines: readonly string[],
  x: number,
  y: number
): TextBox {
  const hw = widest(lines, LABEL_FONT) / 2 + LABEL_CLEAR;
  const hh = (lines.length * LABEL_FONT * LABEL_LINE) / 2 + LABEL_CLEAR;
  return { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh };
}

/** The author-placed text an edge label must not cover. */
function authoredTextBoxes(
  elements: readonly WhiteboardElement[],
  all: readonly WhiteboardElement[]
): TextBox[] {
  const boxes: TextBox[] = [];
  for (const el of elements) {
    if (el.kind === 'text') {
      const lines = labelLines(el.text);
      boxes.push({
        x0: el.x,
        y0: el.y,
        x1: el.x + widest(lines, WHITEBOARD_TEXT_FONT),
        y1: el.y + lines.length * WHITEBOARD_TEXT_FONT * LABEL_LINE,
      });
    } else if (el.kind === 'note') {
      boxes.push({
        x0: el.x,
        y0: el.y,
        x1: el.x + el.width,
        y1: el.y + Math.max(el.height, noteTextHeight(el)),
      });
    } else if (el.kind === 'shape' && el.label) {
      const { lines, font, bold, cy } = whiteboardShapeLabel(el, all);
      if (lines.length === 0) continue;
      const cx = el.x + el.width / 2 + whiteboardLabelShift(el);
      const hh = (lines.length * font * LABEL_LINE) / 2;
      const hw = widest(lines, font, bold) / 2;
      boxes.push({ x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh });
    }
  }
  return boxes;
}

/**
 * The bodies an edge label must not sit on: every shape and image, except a
 * container (it encloses another element — the label may sit in its empty
 * interior) and except one holding both of this connector's ends.
 */
function bodyBoxes(
  elements: readonly WhiteboardElement[],
  all: readonly WhiteboardElement[]
): { el: WhiteboardElement; box: TextBox }[] {
  const out: { el: WhiteboardElement; box: TextBox }[] = [];
  for (const el of elements) {
    if (el.kind !== 'shape' && el.kind !== 'image') continue;
    if (el.kind === 'shape' && whiteboardEnclosesAny(el, all)) continue;
    out.push({
      el,
      box: { x0: el.x, y0: el.y, x1: el.x + el.width, y1: el.y + el.height },
    });
  }
  return out;
}

function boxHolds(b: TextBox, x: number, y: number): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

/**
 * Where each connector's label is centred (#1923). Candidates run along the
 * connector from its midpoint out to t ∈ [0.1, 0.9], each either on the line
 * (its halo knocks the stroke out) or set just beside it on either side. A
 * candidate is scored by what its box hits — other text, earlier labels,
 * shape bodies, and every OTHER connector's stroke, so a label never sits on
 * a crossing and cannot be read as naming the wrong line — then by how far it
 * slid, whether it stepped off the line, and how busy its surroundings are,
 * so a label stepping off goes to the quieter side. Nothing clean → the
 * least-bad candidate. Author-placed elements never move. The renderer and
 * the app canvas both place from this, so they cannot disagree.
 */
export function whiteboardConnectorLabelPoints(
  elements: readonly WhiteboardElement[],
  all: readonly WhiteboardElement[] = elements
): Map<WhiteboardElement, WhiteboardPoint> {
  const placed = new Map<WhiteboardElement, WhiteboardPoint>();
  const taken = authoredTextBoxes(elements, all);
  const bodies = bodyBoxes(elements, all);
  const strokes: { el: WhiteboardElement; pts: WhiteboardPoint[] }[] = [];
  const segments = new Map<WhiteboardElement, WhiteboardSegment>();
  for (const el of elements) {
    if (el.kind !== 'arrow' && el.kind !== 'line') continue;
    const s = clipWhiteboardConnector(el, elements);
    segments.set(el, s);
    strokes.push({ el, pts: segmentPolyline(s) });
  }
  for (const el of elements) {
    if ((el.kind !== 'arrow' && el.kind !== 'line') || !el.label) continue;
    const lines = labelLines(el.label);
    const s = segments.get(el)!;
    const own = connectorLabelBox(lines, 0, 0);
    const hw = own.x1;
    const hh = own.y1;
    const mine = bodies.filter(
      (b) => !(boxHolds(b.box, el.x1, el.y1) && boxHolds(b.box, el.x2, el.y2))
    );
    const others = strokes.filter((o) => o.el !== el);
    const hits = (box: TextBox): number => {
      let n = 0;
      for (const t of taken) if (boxesOverlap(box, t)) n++;
      for (const b of mine) if (boxesOverlap(box, b.box)) n++;
      for (const o of others) if (polylineMeetsBox(o.pts, box)) n++;
      return n;
    };
    let best: WhiteboardPoint = whiteboardSegmentMidpoint(s);
    let bestCost = Infinity;
    const consider = (
      p: WhiteboardPoint,
      steps: number,
      side: boolean
    ): void => {
      const box = connectorLabelBox(lines, p.x, p.y);
      let cost = LABEL_HIT_COST * hits(box) + steps;
      if (side) {
        cost +=
          LABEL_SIDE_COST +
          LABEL_BUSY_COST * hits(grownBox(box, LABEL_BUSY_REACH));
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = p;
      }
    };
    for (let k = 0; k <= LABEL_SLIDE_TRIES; k++) {
      for (const t of k === 0
        ? [0.5]
        : [0.5 - k * LABEL_SLIDE_STEP, 0.5 + k * LABEL_SLIDE_STEP]) {
        const p = segmentPoint(s, t);
        consider(p, k, false);
        // The connector's direction at t, for setting the label beside it.
        const a = segmentPoint(s, Math.max(0, t - 0.01));
        const b = segmentPoint(s, Math.min(1, t + 0.01));
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-9) continue;
        const nx = -(b.y - a.y) / len;
        const ny = (b.x - a.x) / len;
        // Far enough along the normal that the box just clears the stroke.
        const d = hw * Math.abs(nx) + hh * Math.abs(ny) + LABEL_SIDE_GAP;
        consider({ x: p.x + nx * d, y: p.y + ny * d }, k, true);
        consider({ x: p.x - nx * d, y: p.y - ny * d }, k, true);
      }
    }
    placed.set(el, best);
    taken.push(connectorLabelBox(lines, best.x, best.y));
  }
  return placed;
}

const placeConnectorLabels = whiteboardConnectorLabelPoints;

/** Radius of the semicircle a connector makes to hop over an earlier one, px. */
export const WHITEBOARD_HOP_RADIUS = 5;

/**
 * Where a straight stroke crosses the straight connectors drawn before it —
 * distances along the stroke, ascending, each at least a hop clear of both
 * ends and of the previous hop. Curved connectors and parallel ones never hop.
 */
export function whiteboardHopStops(
  line: {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  },
  earlier: readonly WhiteboardSegment[]
): number[] {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const len = Math.hypot(dx, dy);
  const r = WHITEBOARD_HOP_RADIUS;
  if (len <= 2 * r) return [];
  const found: number[] = [];
  for (const o of earlier) {
    if (o.cx !== undefined && o.cy !== undefined) continue;
    const ex = o.x2 - o.x1;
    const ey = o.y2 - o.y1;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((o.x1 - line.x1) * ey - (o.y1 - line.y1) * ex) / den;
    const u = ((o.x1 - line.x1) * dy - (o.y1 - line.y1) * dx) / den;
    if (u < 0 || u > 1) continue;
    const d = t * len;
    if (d >= r && d <= len - r) found.push(d);
  }
  found.sort((a, b) => a - b);
  const stops: number[] = [];
  for (const d of found) {
    if (stops.length === 0 || d - stops[stops.length - 1]! >= 2 * r) {
      stops.push(d);
    }
  }
  return stops;
}

/** A straight stroke as an `M … A …` path hopping its crossings, or null. */
function hoppedLinePath(
  line: {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  },
  earlier: readonly WhiteboardSegment[]
): string | null {
  if (earlier.length === 0) return null;
  const stops = whiteboardHopStops(line, earlier);
  if (stops.length === 0) return null;
  const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
  const ux = (line.x2 - line.x1) / len;
  const uy = (line.y2 - line.y1) / len;
  const r = WHITEBOARD_HOP_RADIUS;
  const at = (d: number): string =>
    `${round2(line.x1 + ux * d)} ${round2(line.y1 + uy * d)}`;
  let d = `M${round2(line.x1)} ${round2(line.y1)}`;
  for (const stop of stops) {
    d += `L${at(stop - r)}A${r} ${r} 0 0 1 ${at(stop + r)}`;
  }
  return `${d}L${round2(line.x2)} ${round2(line.y2)}`;
}

/** What to draw for a connector: one stroke (a line or a curve) and its heads. */
export interface WhiteboardConnectorPaint {
  /** A straight stroke, coordinates rounded to 0.01 px. */
  readonly line?: {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  };
  /** A curved stroke, as one `M … Q …` path. */
  readonly path?: string;
  /** Each head as a polygon `points` string, tip first. */
  readonly heads: readonly string[];
}

/**
 * The stroke and heads of a drawn connector — the renderer and the app canvas
 * both draw from this, so they cannot disagree. The stroke stops at each
 * head's base; a head on a curve points along the bit of curve it covers.
 */
export function whiteboardConnectorPaint(
  s: WhiteboardSegment,
  heads: { readonly start: boolean; readonly end: boolean },
  earlier: readonly WhiteboardSegment[] = []
): WhiteboardConnectorPaint {
  const polygon = (
    tip: WhiteboardPoint,
    ux: number,
    uy: number,
    head: number
  ): string => {
    const bx = tip.x - ux * head;
    const by = tip.y - uy * head;
    const px = -uy * ARROW_HEAD_HALF;
    const py = ux * ARROW_HEAD_HALF;
    return `${round2(tip.x)},${round2(tip.y)} ${round2(bx + px)},${round2(by + py)} ${round2(bx - px)},${round2(by - py)}`;
  };
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = Math.hypot(dx, dy);
  if (s.cx === undefined || s.cy === undefined) {
    if (len === 0) return { heads: [] };
    const ux = dx / len;
    const uy = dy / len;
    const headE = heads.end ? Math.min(ARROW_HEAD_LEN, len) : 0;
    const headS = heads.start ? Math.min(ARROW_HEAD_LEN, len / 2) : 0;
    const head = heads.start ? Math.min(headE, len / 2) : headE;
    const out: string[] = [];
    if (heads.end) out.push(polygon({ x: s.x2, y: s.y2 }, ux, uy, head));
    if (heads.start) out.push(polygon({ x: s.x1, y: s.y1 }, -ux, -uy, headS));
    const line = {
      x1: round2(s.x1 + ux * headS),
      y1: round2(s.y1 + uy * headS),
      x2: round2(s.x2 - ux * head),
      y2: round2(s.y2 - uy * head),
    };
    const hopped = hoppedLinePath(line, earlier);
    return hopped === null
      ? { line, heads: out }
      : { path: hopped, heads: out };
  }
  const tEnd = heads.end ? curveTrim(s, 1, ARROW_HEAD_LEN) : 1;
  const tStart = heads.start ? curveTrim(s, 0, ARROW_HEAD_LEN) : 0;
  const [t0, t1] = tEnd - tStart > 0 ? [tStart, tEnd] : [0, 1];
  const p0 = segmentPoint(s, t0);
  const p1 = segmentPoint(s, t1);
  // Blossom of the sub-curve [t0, t1]: its control point.
  const w0 = (1 - t0) * (1 - t1);
  const w1 = (1 - t0) * t1 + t0 * (1 - t1);
  const w2 = t0 * t1;
  const qx = w0 * s.x1 + w1 * s.cx + w2 * s.x2;
  const qy = w0 * s.y1 + w1 * s.cy + w2 * s.y2;
  const out: string[] = [];
  const along = (tip: WhiteboardPoint, base: WhiteboardPoint): void => {
    const hx = tip.x - base.x;
    const hy = tip.y - base.y;
    const hl = Math.hypot(hx, hy);
    if (hl > 0) out.push(polygon(tip, hx / hl, hy / hl, hl));
  };
  if (heads.end) along({ x: s.x2, y: s.y2 }, p1);
  if (heads.start) along({ x: s.x1, y: s.y1 }, p0);
  return {
    path: `M${round2(p0.x)} ${round2(p0.y)}Q${round2(qx)} ${round2(qy)} ${round2(p1.x)} ${round2(p1.y)}`,
    heads: out,
  };
}

/** The outline polygon perfect-freehand produces, as an SVG path. */
export function inkOutlinePath(
  points: readonly InkPoint[],
  width: number
): string {
  const hasPressure = points.every((p) => p.pressure !== undefined);
  const outline = getStroke(
    points.map((p) => (hasPressure ? [p.x, p.y, p.pressure!] : [p.x, p.y])),
    {
      size: width,
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
      simulatePressure: !hasPressure,
      last: true,
    }
  );
  if (outline.length === 0) return '';
  const r = (n: number): string => String(Math.round(n * 100) / 100);
  // Quadratic smoothing through midpoints — perfect-freehand's own recipe.
  const first = outline[0]!;
  let d = `M${r(first[0])} ${r(first[1])}Q`;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    d += `${r(a[0])} ${r(a[1])} ${r((a[0] + b[0]) / 2)} ${r((a[1] + b[1]) / 2)} `;
  }
  return d.trimEnd() + 'Z';
}

type GSel = d3.Selection<SVGGElement, unknown, null, undefined>;

export function renderWhiteboard(
  container: HTMLDivElement,
  parsed: ParsedWhiteboard,
  palette: PaletteColors,
  isDark: boolean,
  options: WhiteboardRenderOptions = {}
): void {
  const base = themeBaseBg(palette, isDark);
  const colorOf = (c: WhiteboardColor): string =>
    c === 'ink' ? palette.text : (palette.colors[c] ?? palette.text);
  const fillOf = (c: WhiteboardColor): string =>
    c === 'ink' ? base : shapeFill(palette, colorOf(c), isDark);

  const showTitle = !!parsed.title && !parsed.options.noTitle;
  const titleOffset = showTitle ? TITLE_BAND : 0;
  const elements = visibleWhiteboardElements(parsed, options);
  const b = whiteboardBounds(parsed, options);
  const labelAt = placeConnectorLabels(elements, parsed.elements);
  const contentW = b.maxX - b.minX;
  const contentH = b.maxY - b.minY;
  const titleW = showTitle
    ? measureText(parsed.title, TITLE_FONT_SIZE, { bold: true })
    : 0;
  const width = Math.ceil(Math.max(contentW, titleW) + 2 * WHITEBOARD_MARGIN);
  const legend = whiteboardLegend(parsed, elements, colorOf);
  const legendConfig = legend && {
    groups: [legend.group],
    position: {
      placement: 'top-center',
      titleRelation: 'below-title',
    } as const,
    mode: 'export' as const,
  };
  const legendOffset = legendConfig
    ? getMaxLegendReservedHeight(legendConfig, width) + LEGEND_GAP
    : 0;
  const height = Math.ceil(
    contentH + 2 * WHITEBOARD_MARGIN + titleOffset + legendOffset
  );
  // Centre the content under a title wider than it.
  const tx =
    WHITEBOARD_MARGIN - b.minX + (width - 2 * WHITEBOARD_MARGIN - contentW) / 2;
  const ty = WHITEBOARD_MARGIN + titleOffset + legendOffset - b.minY;

  d3.select(container).selectAll('*').remove();
  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('font-family', FONT_FAMILY);

  if (showTitle) {
    renderChartTitle(
      svg,
      parsed.title,
      parsed.titleLineNumber,
      width,
      palette.text
    );
  }

  if (legend && legendConfig) {
    const legendG = svg
      .append('g')
      .attr('class', 'whiteboard-legend')
      .attr('transform', `translate(0,${titleOffset + WHITEBOARD_MARGIN / 2})`);
    if (!legend.named) legendG.attr('opacity', LEGEND_FAINT_OPACITY);
    renderIntegratedLegend(legendG, {
      ...legendConfig,
      activeGroup: legend.group.name,
      palette,
      isDark,
      width,
    });
  }

  const canvas = svg
    .append('g')
    .attr('class', 'whiteboard-canvas')
    .attr('transform', `translate(${round2(tx)},${round2(ty)})`);

  const halo = palette.bg;

  /** A shape label: fitted to the shape (#1225), centred as a block. */
  const centredLabel = (
    g: GSel,
    {
      lines,
      font,
      bold,
    }: { lines: readonly string[]; font: number; bold: boolean },
    cx: number,
    cy: number,
    color: string,
    ground: string
  ): void => {
    if (lines.length === 0) return;
    const lh = font * LABEL_LINE;
    const top = cy - (lines.length * lh) / 2 + lh * BASELINE;
    // A halo of the shape's own fill: where a line of text meets the outline,
    // the outline gives way to the words.
    const t = g
      .append('text')
      .attr('class', 'whiteboard-label')
      .attr('text-anchor', 'middle')
      .attr('font-size', font)
      .attr('fill', color)
      .attr('stroke', ground)
      .attr('stroke-width', LABEL_HALO)
      .attr('stroke-linejoin', 'round')
      .attr('paint-order', 'stroke');
    if (bold) t.attr('font-weight', WHITEBOARD_CONTAINER_WEIGHT);
    appendLines(t, lines, cx, top, lh);
  };

  const drawImage = (g: GSel, el: WhiteboardImage): void => {
    const resolved = options.resolveImage
      ? options.resolveImage(el.ref)
      : /^https:\/\//i.test(el.ref)
        ? el.ref
        : undefined;
    if (resolved !== undefined && SAFE_IMAGE_HREF_RE.test(resolved)) {
      g.append('image')
        .attr('x', el.x)
        .attr('y', el.y)
        .attr('width', el.width)
        .attr('height', el.height)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('href', resolved);
      return;
    }
    g.append('rect')
      .attr('class', 'whiteboard-image-placeholder')
      .attr('x', el.x)
      .attr('y', el.y)
      .attr('width', el.width)
      .attr('height', el.height)
      .attr('rx', 4)
      .attr('fill', mix(palette.textMuted, base, 10))
      .attr('stroke', mix(palette.textMuted, base, 50))
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '6 4');
    // Shrink the label to fit the box (≈0.55em per Inter glyph); a box too
    // small for a legible label keeps only its dashed outline.
    const fit = Math.min(
      LABEL_FONT,
      (el.width - 8) / (IMAGE_NOT_UPLOADED.length * 0.55)
    );
    if (fit < PLACEHOLDER_MIN_FONT) return;
    g.append('text')
      .attr('x', el.x + el.width / 2)
      .attr('y', el.y + el.height / 2 + fit * 0.35)
      .attr('text-anchor', 'middle')
      .attr('font-size', round2(fit))
      .attr('fill', palette.textMuted)
      .text(IMAGE_NOT_UPLOADED);
  };

  /** Connectors drawn so far, as drawn — a later one hops over these. */
  const drawnConnectors: WhiteboardSegment[] = [];
  const drawElement = (el: WhiteboardElement): void => {
    const g = canvas
      .append('g')
      .attr(
        'class',
        `whiteboard-${el.kind === 'shape' ? (el.glyph ?? el.shape) : el.kind}`
      )
      .attr('data-line-number', el.lineNumber);
    // Pairs the element with its colour's legend entry on hover.
    const lc = legend && legendColor(el);
    if (lc) g.attr('data-wb-meaning', legend.entryOf.get(lc) ?? '');
    switch (el.kind) {
      case 'shape': {
        const hue = colorOf(el.color);
        // tint: a wash of the colour · solid: the colour · outline: hollow.
        const fill =
          el.fill === 'solid'
            ? hue
            : el.fill === 'outline'
              ? 'none'
              : fillOf(el.color);
        const labelColor =
          el.fill === 'solid'
            ? contrastText(hue, base, palette.text)
            : palette.text;
        // A solid shape's outline is drawn a shade toward its label colour,
        // or a cylinder's caps and an ellipse's rim vanish into the fill.
        const stroke =
          el.fill === 'solid' ? mix(hue, labelColor, SOLID_EDGE) : hue;
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        if (isGlyph(el)) {
          // A line icon scaled to fit its box, centred, in the shape's colour.
          // Its line thickens with size up to GLYPH_STROKE_MAX strokes.
          const k = Math.min(el.width, el.height) / GLYPH_VIEWBOX;
          const drawn = Math.min(
            GLYPH_STROKE * k,
            GLYPH_STROKE_MAX * SHAPE_STROKE
          );
          const icon = g
            .append('g')
            .attr('class', 'whiteboard-glyph')
            .attr(
              'transform',
              `translate(${round2(cx - (GLYPH_VIEWBOX * k) / 2)},${round2(cy - (GLYPH_VIEWBOX * k) / 2)}) scale(${round2(k)})`
            )
            .attr('fill', 'none')
            .attr('stroke', hue)
            .attr('stroke-width', round2(drawn / k))
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round');
          for (const d of glyphPaths(el.glyph))
            icon.append('path').attr('d', d);
          const c = glyphCaption(el);
          centredLabel(
            g,
            { lines: c.lines, font: LABEL_FONT, bold: false },
            cx,
            c.top + c.height / 2,
            palette.text,
            halo
          );
          break;
        }
        if (el.shape === 'rectangle') {
          g.append('rect')
            .attr('x', el.x)
            .attr('y', el.y)
            .attr('width', el.width)
            .attr('height', el.height)
            .attr('rx', Math.min(RECT_RADIUS, el.width / 2, el.height / 2))
            .attr('fill', fill)
            .attr('stroke', stroke)
            .attr('stroke-width', SHAPE_STROKE);
        } else if (el.shape === 'ellipse') {
          g.append('ellipse')
            .attr('cx', cx)
            .attr('cy', cy)
            .attr('rx', el.width / 2)
            .attr('ry', el.height / 2)
            .attr('fill', fill)
            .attr('stroke', stroke)
            .attr('stroke-width', SHAPE_STROKE);
        } else if (el.shape === 'file') {
          g.append('path')
            .attr('d', whiteboardFilePath(el.x, el.y, el.width, el.height))
            .attr('fill', fill)
            .attr('stroke', stroke)
            .attr('stroke-width', SHAPE_STROKE);
        } else {
          const inner = g
            .append('g')
            .attr('transform', `translate(${round2(cx)},${round2(cy)})`);
          if (el.shape === 'database') {
            drawCylinderCard(inner, el.width, el.height, fill, stroke, false);
          } else {
            drawQueueCard(inner, el.width, el.height, fill, stroke);
          }
        }
        const label = whiteboardShapeLabel(el, parsed.elements);
        centredLabel(
          g,
          label,
          cx + whiteboardLabelShift(el),
          label.cy,
          labelColor,
          label.onEdge || fill === 'none' ? halo : fill
        );
        break;
      }
      case 'note': {
        // A flat tinted card — stronger than a shape's tint, edged in its own
        // hue — with its top-right corner folded down, and the text top-left
        // in a dark shade of the same hue, wrapped to the card.
        const hue = colorOf(el.color);
        const edge = mix(hue, base, NOTE_EDGE);
        const { x, y, width: w, height: h } = el;
        const f = whiteboardNoteFold(w, h);
        g.append('path')
          .attr('d', `M${x} ${y}h${w - f}l${f} ${f}v${h - f}h${-w}z`)
          .attr('fill', mix(hue, base, NOTE_TINT))
          .attr('stroke', edge)
          .attr('stroke-width', 1)
          .attr('stroke-linejoin', 'round');
        if (f > 2) {
          g.append('path')
            .attr('class', 'whiteboard-note-fold')
            .attr('d', `M${x + w - f} ${y}v${f - 2}q0 2 2 2h${f - 2}z`)
            .attr('fill', edge)
            .attr('opacity', NOTE_FOLD_OPACITY);
        }
        const { lines, font, top } = fitWhiteboardLabel(el.text, el);
        if (lines.length > 0) {
          const lh = font * LABEL_LINE;
          const t = g
            .append('text')
            .attr('class', 'whiteboard-label')
            .attr('font-size', font)
            .attr('fill', mix(hue, palette.text, NOTE_INK));
          appendLines(
            t,
            lines,
            el.x + NOTE_PAD,
            el.y + top + lh * BASELINE,
            lh
          );
        }
        break;
      }
      case 'arrow':
      case 'line': {
        const color = colorOf(el.color);
        // An end inside a shape is attached and drawn to its border.
        const s = clipWhiteboardConnector(el, elements);
        const paint = whiteboardConnectorPaint(
          s,
          {
            start: el.kind === 'arrow' && el.heads === 'both',
            end: el.kind === 'arrow',
          },
          drawnConnectors
        );
        drawnConnectors.push(s);
        let stroke: d3.Selection<SVGElement, unknown, null, undefined> | null =
          null;
        if (paint.line) {
          stroke = g
            .append<SVGElement>('line')
            .attr('x1', paint.line.x1)
            .attr('y1', paint.line.y1)
            .attr('x2', paint.line.x2)
            .attr('y2', paint.line.y2);
        } else if (paint.path) {
          stroke = g
            .append<SVGElement>('path')
            .attr('d', paint.path)
            .attr('fill', 'none');
        }
        if (stroke) {
          stroke
            .attr('stroke', color)
            .attr('stroke-width', ARROW_STROKE)
            .attr('stroke-linecap', 'round');
          if (el.style === 'dashed') {
            stroke.attr(
              'stroke-dasharray',
              `${DASH_ON * ARROW_STROKE} ${DASH_OFF * ARROW_STROKE}`
            );
          }
        }
        for (const points of paint.heads) {
          g.append('polygon').attr('points', points).attr('fill', color);
        }
        if (el.label) {
          // The block of lines is centred on its placed point (the midpoint
          // unless that covers other text); the halo stroke knocks the line
          // out behind every one of them.
          const lines = labelLines(el.label);
          const mid = labelAt.get(el)!;
          const mx = round2(mid.x);
          const lh = LABEL_FONT * LABEL_LINE;
          const firstY =
            mid.y + LABEL_FONT * 0.35 - ((lines.length - 1) * lh) / 2;
          const t = g
            .append('text')
            .attr('class', 'whiteboard-label')
            .attr('x', mx)
            .attr('y', round2(firstY))
            .attr('text-anchor', 'middle')
            .attr('font-size', LABEL_FONT)
            .attr('fill', palette.text)
            .attr('stroke', halo)
            .attr('stroke-width', 4)
            .attr('stroke-linejoin', 'round')
            .attr('paint-order', 'stroke');
          if (lines.length === 1) t.text(el.label);
          else appendLines(t, lines, mx, firstY, lh);
        }
        break;
      }
      case 'text': {
        const lines = labelLines(el.text);
        const firstY = el.y + WHITEBOARD_TEXT_FONT * BASELINE;
        const t = g
          .append('text')
          .attr('x', el.x)
          .attr('y', round2(firstY))
          .attr('font-size', WHITEBOARD_TEXT_FONT)
          .attr('fill', colorOf(el.color));
        if (lines.length === 1) t.text(el.text);
        else
          appendLines(
            t,
            lines,
            el.x,
            firstY,
            WHITEBOARD_TEXT_FONT * LABEL_LINE
          );
        break;
      }
      case 'image':
        drawImage(g, el);
        break;
      case 'ink': {
        const d = inkOutlinePath(el.points, el.width);
        if (d) g.append('path').attr('d', d).attr('fill', colorOf(el.color));
        break;
      }
    }
  };

  for (const el of inDrawOrder(elements)) drawElement(el);
}

/** The elements in paint order, bottom first (`whiteboardDrawOrder`). */
function inDrawOrder(
  elements: readonly WhiteboardElement[]
): readonly WhiteboardElement[] {
  return whiteboardDrawOrder(elements).map((i) => elements[i]!);
}

/** One `<tspan>` per non-empty line, `lh` apart from the first baseline. */
function appendLines(
  t: d3.Selection<SVGTextElement, unknown, null, undefined>,
  lines: readonly string[],
  x: number,
  firstY: number,
  lh: number
): void {
  lines.forEach((ln, i) => {
    if (!ln) return; // an empty line keeps its slot, draws nothing
    t.append('tspan')
      .attr('x', round2(x))
      .attr('y', round2(firstY + i * lh))
      .text(ln);
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
