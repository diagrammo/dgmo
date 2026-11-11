// ============================================================
// Boxes and Lines → Whiteboard copy (#1884)
// ============================================================
//
// One-time conversion: lay the boxes-and-lines source out exactly as its
// renderer does, then write every box, group and edge as a whiteboard element
// at the place the layout put it. The source is not touched and nothing links
// the copy back to it.
//
// - A box becomes a `rectangle` at the box's position and size. Its label and
//   description lines become the rectangle's (multi-line) label.
// - A group becomes a rectangle enclosing its members; the whiteboard puts the
//   label of an enclosing rectangle at the top on its own (#1601). Outer groups
//   are written before inner ones, and every group before any box, so a box is
//   the topmost shape under its own centre.
// - An edge becomes an arrow from the source box's centre to the target box's
//   centre — an end inside a shape attaches to it — with `heads: both` when the
//   edge is bidirectional and one `bend:` approximating the routed curve.
// - Colours carry over only as colour NAMES the whiteboard knows: an explicit
//   `color:` first, else the first tag group's colour for the box's value. That
//   tag group is copied as a whiteboard `tag` block, so the legend still names
//   what the colours mean.
//
// Collapsed groups are laid out EXPANDED: a whiteboard has no folding, and a
// copy that dropped the hidden boxes would lose them.
// - A note (`note <Box> …`) becomes a whiteboard sticky note where the layout
//   floated it beside its box, every note expanded, with its colour by name
//   (the whiteboard's yellow when none) (#1922). `no-notes` places none, so
//   none is copied.

import type { PaletteColors } from '../palettes';
import type { TagGroup } from '../utils/tag-groups';
import type { ParsedBoxesAndLines, BLGroup } from './types';
import type { BLLayoutResult, BLLayoutGroup } from './layout';
import type {
  ParsedWhiteboard,
  WhiteboardColor,
  WhiteboardElement,
} from '../whiteboard/types';
import {
  WHITEBOARD_COLORS,
  WHITEBOARD_NOTE_COLOR,
  isWhiteboardColor,
} from '../whiteboard/types';
import { resolveColor } from '../colors';
import { emitWhiteboard } from '../whiteboard/emit';

/** A routed curve bowing less than this far off its chord is written straight. */
const MIN_BEND = 4;
/** How far inside a group's top-left corner a group-ended arrow is anchored. */
const GROUP_ANCHOR_INSET = 6;
const GROUP_PREFIX = '__group_';

export interface BoxesAndLinesToWhiteboardResult {
  /** Whiteboard source, ending in a newline. */
  readonly source: string;
  /** The intermediate board, for callers that want the elements. */
  readonly board: ParsedWhiteboard;
}

function colorName(value: string | undefined): WhiteboardColor | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  return isWhiteboardColor(v) ? v : null;
}

/**
 * Resolved colour value → whiteboard colour name, for the palette the source
 * was parsed with. A tag entry keeps only the resolved value, whether the
 * author named the colour or the parser assigned it, so the name is read back
 * through the same resolution.
 */
function colorNamesByValue(
  palette: PaletteColors | undefined
): Map<string, WhiteboardColor> {
  const out = new Map<string, WhiteboardColor>();
  for (const name of WHITEBOARD_COLORS) {
    if (name === 'ink') continue;
    const v = resolveColor(name, palette);
    if (v && !out.has(v.toLowerCase())) out.set(v.toLowerCase(), name);
  }
  return out;
}

/** The first tag group, kept only for entries whose colour the whiteboard knows. */
function copyTagGroup(
  groups: readonly TagGroup[],
  palette: PaletteColors | undefined
): TagGroup | null {
  const g = groups[0];
  if (!g) return null;
  const byValue = colorNamesByValue(palette);
  const entries = g.entries.flatMap((e) => {
    const c =
      colorName(e.authoredColor) ?? byValue.get(e.color.toLowerCase()) ?? null;
    return c ? [{ value: e.value, color: c, lineNumber: 0 }] : [];
  });
  if (entries.length === 0) return null;
  return {
    name: g.name,
    ...(g.alias !== undefined && { alias: g.alias }),
    entries,
    lineNumber: 0,
  };
}

function tagColor(
  metadata: Readonly<Record<string, string>>,
  tag: TagGroup | null,
  original: TagGroup | undefined,
  isContainer: boolean
): WhiteboardColor | null {
  if (!tag || !original) return null;
  const keys = [original.name, original.alias]
    .filter((k): k is string => !!k)
    .map((k) => k.toLowerCase());
  let value: string | undefined;
  for (const [k, v] of Object.entries(metadata)) {
    if (keys.includes(k.toLowerCase())) value = v;
  }
  if (value === undefined && !isContainer) value = original.defaultValue;
  if (value === undefined) return null;
  const hit = tag.entries.find(
    (e) => e.value.toLowerCase() === value.toLowerCase()
  );
  return hit ? (hit.color as WhiteboardColor) : null;
}

/** Signed distance of the route's arc-length midpoint from the chord a→b, to the right of travel. */
function bendOf(
  a: { x: number; y: number },
  b: { x: number; y: number },
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0 || points.length < 3) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i]!.x - points[i - 1]!.x,
      points[i]!.y - points[i - 1]!.y
    );
  }
  let walked = 0;
  let mid = points[0]!;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    const seg = Math.hypot(q.x - p.x, q.y - p.y);
    if (walked + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - walked) / seg;
      mid = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      break;
    }
    walked += seg;
  }
  // Right of travel on screen (y down) is (-dy, dx).
  const off =
    ((mid.x - (a.x + b.x) / 2) * -dy + (mid.y - (a.y + b.y) / 2) * dx) / len;
  return Math.abs(off) < MIN_BEND ? 0 : Math.round(off);
}

/** Groups outermost first, so each enclosing rectangle sits beneath what it encloses. */
function groupDepth(label: string, groups: readonly BLGroup[]): number {
  let depth = 0;
  let cur = groups.find((g) => g.label === label);
  const seen = new Set<string>();
  while (cur?.parentGroup && !seen.has(cur.label)) {
    seen.add(cur.label);
    depth++;
    const parent = cur.parentGroup;
    cur = groups.find((g) => g.label === parent);
  }
  return depth;
}

/**
 * Build the whiteboard board from a parsed + laid-out boxes-and-lines diagram.
 * Pure: no layout runs here, so a host can pass the layout it already has.
 */
export function boxesAndLinesLayoutToWhiteboard(
  parsed: ParsedBoxesAndLines,
  layout: BLLayoutResult,
  /** The palette `parsed` was parsed with, so tag colours map back to names. */
  palette?: PaletteColors
): ParsedWhiteboard {
  // Shift so the copy starts at the canvas origin.
  const floated = layout.nodes.flatMap((n) =>
    n.note && !n.note.collapsed
      ? [{ x: n.x + n.note.x, y: n.y + n.note.y, note: n.note }]
      : []
  );
  const lefts = [
    ...layout.nodes.map((n) => n.x - n.width / 2),
    ...layout.groups.map((g) => g.x - g.width / 2),
    ...floated.map((f) => f.x),
  ];
  const tops = [
    ...layout.nodes.map((n) => n.y - n.height / 2),
    ...layout.groups.map((g) => g.y - g.height / 2),
    ...floated.map((f) => f.y),
  ];
  const ox = lefts.length ? Math.min(...lefts) : 0;
  const oy = tops.length ? Math.min(...tops) : 0;
  const X = (x: number) => Math.round(x - ox);
  const Y = (y: number) => Math.round(y - oy);

  const tag = copyTagGroup(parsed.tagGroups, palette);
  const originalTag = parsed.tagGroups[0];
  const nodeByLabel = new Map(parsed.nodes.map((n) => [n.label, n]));
  const groupByLabel = new Map(parsed.groups.map((g) => [g.label, g]));

  const elements: WhiteboardElement[] = [];

  const layoutGroups = [...layout.groups].sort(
    (a, b) =>
      groupDepth(a.label, parsed.groups) - groupDepth(b.label, parsed.groups)
  );
  for (const g of layoutGroups) {
    const meta = groupByLabel.get(g.label)?.metadata ?? {};
    elements.push({
      kind: 'shape',
      shape: 'rectangle',
      x: X(g.x - g.width / 2),
      y: Y(g.y - g.height / 2),
      width: Math.round(g.width),
      height: Math.round(g.height),
      label: g.label,
      color:
        colorName(meta['color']) ??
        tagColor(meta, tag, originalTag, true) ??
        'gray',
      fill: 'tint',
      lineNumber: 0,
    });
  }

  for (const n of layout.nodes) {
    const src = nodeByLabel.get(n.label);
    const meta = src?.metadata ?? {};
    const label = [n.label, ...(src?.description ?? [])].join('\n');
    elements.push({
      kind: 'shape',
      shape: 'rectangle',
      x: X(n.x - n.width / 2),
      y: Y(n.y - n.height / 2),
      width: Math.round(n.width),
      height: Math.round(n.height),
      label,
      color:
        colorName(meta['color']) ??
        tagColor(meta, tag, originalTag, false) ??
        'ink',
      fill: 'tint',
      lineNumber: 0,
    });
  }

  const nodeCentre = new Map(
    layout.nodes.map((n) => [n.label, { x: n.x, y: n.y }])
  );
  const groupAnchor = new Map(
    layout.groups.map((g: BLLayoutGroup) => [
      GROUP_PREFIX + g.label,
      {
        x: g.x - g.width / 2 + GROUP_ANCHOR_INSET,
        y: g.y - g.height / 2 + GROUP_ANCHOR_INSET,
      },
    ])
  );
  const endPoint = (id: string) => nodeCentre.get(id) ?? groupAnchor.get(id);

  for (const e of layout.edges) {
    if (e.source === e.target) continue; // a whiteboard arrow cannot loop
    const a = endPoint(e.source);
    const b = endPoint(e.target);
    if (!a || !b) continue;
    elements.push({
      kind: 'arrow',
      x1: X(a.x),
      y1: Y(a.y),
      x2: X(b.x),
      y2: Y(b.y),
      label: e.label ?? '',
      color: colorName(e.metadata['color']) ?? 'ink',
      style: 'solid',
      heads: e.bidirectional ? 'both' : 'end',
      bend: bendOf(a, b, e.points),
      lineNumber: 0,
    });
  }

  // Notes last: they never sit over a box centre, so no arrow end moves.
  const byValue = colorNamesByValue(palette);
  const noteByLine = new Map(
    (parsed.notes ?? []).map((n) => [n.lineNumber, n])
  );
  for (const f of floated) {
    const src = noteByLine.get(f.note.lineNumber);
    const text = src?.body ?? f.note.lines.map((l) => l.text).join('\n');
    const hex = f.note.color ?? src?.color;
    elements.push({
      kind: 'note',
      x: X(f.x),
      y: Y(f.y),
      width: Math.round(f.note.width),
      height: Math.round(f.note.height),
      text,
      color:
        (hex ? byValue.get(hex.toLowerCase()) : undefined) ??
        WHITEBOARD_NOTE_COLOR,
      lineNumber: 0,
    });
  }

  return {
    type: 'whiteboard',
    title: parsed.title,
    titleLineNumber: null,
    elements,
    options: { noTitle: false, noNotes: false },
    tagGroups: tag ? [tag] : [],
    shapeSets: [],
    diagnostics: [],
    error: null,
  };
}

/**
 * Convert boxes-and-lines source to whiteboard source, laying it out the way
 * the renderer does (every group expanded). Returns null when the source has
 * a parse error or no boxes.
 */
export async function boxesAndLinesToWhiteboard(
  content: string,
  palette?: PaletteColors
): Promise<BoxesAndLinesToWhiteboardResult | null> {
  const { parseBoxesAndLines } = await import('./parser');
  const parsed = parseBoxesAndLines(content, palette);
  if (parsed.error || parsed.nodes.length === 0) return null;
  const expanded: ParsedBoxesAndLines = {
    ...parsed,
    groups: parsed.groups.map((g) => ({ ...g, collapsed: false })),
  };
  const { layoutBoxesAndLines } = await import('./layout');
  const layout = await layoutBoxesAndLines(expanded);
  const board = boxesAndLinesLayoutToWhiteboard(expanded, layout, palette);
  return { source: emitWhiteboard(board), board };
}
