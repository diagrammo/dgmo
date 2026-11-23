// ============================================================
// Sitemap Diagram Layout Engine — page tree (#1861)
// ============================================================

import {
  HEADER_HEIGHT,
  LABEL_FONT_SIZE,
  META_FONT_SIZE,
  META_LINE_HEIGHT,
  SEPARATOR_GAP,
} from '../utils/visual-conventions';
import { tagAttrKey } from '../utils/tag-groups';
import type { Writable } from '../utils/brand';
import type { ParsedSitemap, SitemapNode } from './types';
import type { TagGroup } from '../utils/tag-groups';
import { resolveTagColor, injectDefaultTagMetadata } from '../utils/tag-groups';
import {
  LEGEND_PILL_FONT_SIZE,
  LEGEND_ENTRY_FONT_SIZE,
  LEGEND_HEIGHT,
  LEGEND_PILL_PAD,
  LEGEND_CAPSULE_PAD,
  LEGEND_DOT_R,
  LEGEND_ENTRY_DOT_GAP,
  LEGEND_ENTRY_TRAIL,
  LEGEND_GROUP_GAP,
  LEGEND_EYE_SIZE,
  LEGEND_EYE_GAP,
  measureLegendText,
} from '../utils/legend-constants';
import { measureText } from '../utils/text-measure';

import { chipGap, chipHeight, chipRows, chipWidth } from '../utils/chips';

// ============================================================
// Types
// ============================================================

export interface SitemapLayoutNode {
  readonly id: string;
  readonly label: string;
  readonly metadata: Readonly<Record<string, string>>;
  /** Original (unfiltered) metadata for tag-based coloring and hover dimming */
  readonly tagMetadata: Readonly<Record<string, string>>;
  readonly description?: readonly string[];
  readonly isContainer: boolean;
  readonly lineNumber: number;
  readonly color?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Count of hidden descendants when collapsed */
  readonly hiddenCount?: number;
  /** True if node has children (expanded or collapsed) — drives toggle UI */
  readonly hasChildren?: boolean;
  /** 1-based position inside a `steps` group (#1861) */
  readonly step?: number;
}

export interface SitemapLayoutEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly label?: string;
  readonly lineNumber: number;
  /**
   * What drew the line (#1861): `tree` is indentation (grey elbow, no head),
   * `step` joins consecutive pages of a `steps` group (bold, arrow), `link`
   * is a written `-label->` arrow (thin dashed curve over the tree).
   */
  readonly kind: 'tree' | 'step' | 'link';
}

export interface SitemapLegendEntry {
  readonly value: string;
  readonly color: string;
}

export interface SitemapLegendGroup {
  readonly name: string;
  readonly alias?: string;
  readonly entries: readonly SitemapLegendEntry[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly minifiedWidth: number;
  readonly minifiedHeight: number;
}

export interface SitemapLayoutResult {
  readonly nodes: readonly SitemapLayoutNode[];
  readonly edges: readonly SitemapLayoutEdge[];
  readonly legend: readonly SitemapLegendGroup[];
  readonly width: number;
  readonly height: number;
}

function clipToRectBorder(
  cx: number,
  cy: number,
  w: number,
  h: number,
  tx: number,
  ty: number
): { x: number; y: number } {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = w / 2;
  const hh = h / 2;
  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

// ============================================================
// Constants
// ============================================================

const CARD_H_PAD = 20;
const CARD_V_PAD = 10;
const MIN_CARD_WIDTH = 140;
export const MARGIN = 40;
// Page tree spacing (#1861).
/** Parent card bottom to child card top, in a spread or steps row. */
const TREE_V_GAP = 44;
/** Between sibling subtrees laid side by side. */
const TREE_H_GAP = 40;
/** Between the trees of a forest. */
const FOREST_GAP = 56;
/** A stacked column of leaf pages sits this far right of its parent's left edge. */
const STACK_INDENT = 28;
/** Vertical gap between cards in a stacked column. */
const STACK_GAP = 12;
/** Gap between consecutive pages of a `steps` row, wide enough for its arrow. */
const STEP_GAP = 40;
/** direction-lr: parent card right edge to its children's left edge. */
const LR_H_GAP = 56;
/** direction-lr: between sibling subtrees stacked top to bottom. */
const LR_V_GAP = 16;
/** How far a cross-link bows off the straight line, at most. */
const LINK_BOW_MAX = 48;
/**
 * How far a link between two cards of one column bows past their right edge.
 * The label sits near the peak, so the bow clears the label; longer links bow
 * further, so arcs nest and their labels part, as in an arc diagram.
 */
function sideArcBow(label: string | undefined, dy: number): number {
  const labelW = label ? measureText(label, EDGE_LABEL_FONT_SIZE) + 10 : 0;
  return Math.max(36, labelW + 16) + Math.abs(dy) * SIDE_ARC_PER_PX;
}
/** Extra bow per px of vertical distance between the two cards. */
const SIDE_ARC_PER_PX = 0.22;
/** Where along a same-column link its arc peaks, from the source (0.5 = middle). */
const SIDE_ARC_LEAN = 0.3;
/** Edge label font size; the renderer draws labels at this size. */
export const EDGE_LABEL_FONT_SIZE = 11;

// Legend (kanban-style pills)

// ============================================================
// Helpers
// ============================================================

function filterMetadata(
  metadata: Record<string, string>,
  hiddenAttributes?: Set<string>
): Record<string, string> {
  if (!hiddenAttributes || hiddenAttributes.size === 0) return metadata;
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!hiddenAttributes.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/** Chip values for a card, in metadata order (the renderer draws the same list). */
function chipValues(
  meta: Record<string, string>
): { label: string; value: string }[] {
  return Object.entries(meta).map(([label, value]) => ({ label, value }));
}

/**
 * Card width: the bold label, the description lines and the widest single
 * chip set the floor; chips wrap to the width (#1861, chips from #1862).
 */
function computeCardWidth(
  label: string,
  meta: Record<string, string>,
  descLines?: readonly string[]
): number {
  let maxContentWidth = measureText(label, LABEL_FONT_SIZE, { bold: true });
  for (const c of chipValues(meta)) {
    const w = chipWidth(c, META_FONT_SIZE);
    if (w > maxContentWidth) maxContentWidth = w;
  }
  if (descLines) {
    for (const dl of descLines) {
      const dlWidth = measureText(dl, META_FONT_SIZE);
      if (dlWidth > maxContentWidth) maxContentWidth = dlWidth;
    }
  }
  return Math.max(MIN_CARD_WIDTH, Math.ceil(maxContentWidth) + CARD_H_PAD * 2);
}

/** Height of the chip rows a card of `width` draws; 0 with no metadata. */
export function sitemapChipBlockHeight(
  meta: Record<string, string>,
  width: number
): number {
  const rows = chipRows(
    chipValues(meta),
    META_FONT_SIZE,
    META_LINE_HEIGHT,
    width - CARD_H_PAD
  ).length;
  if (rows === 0) return 0;
  return (
    rows * chipHeight(META_LINE_HEIGHT) + (rows - 1) * chipGap(META_LINE_HEIGHT)
  );
}

function computeCardHeight(
  meta: Record<string, string>,
  width: number,
  descLineCount = 0
): number {
  const chips = sitemapChipBlockHeight(meta, width);
  if (chips === 0 && descLineCount === 0) return HEADER_HEIGHT + CARD_V_PAD;
  const between = chips > 0 && descLineCount > 0 ? SEPARATOR_GAP : 0;
  return (
    HEADER_HEIGHT +
    SEPARATOR_GAP +
    chips +
    between +
    descLineCount * META_LINE_HEIGHT +
    CARD_V_PAD
  );
}

function resolveNodeColor(
  node: SitemapNode,
  tagGroups: readonly TagGroup[],
  activeGroupName: string | null
): string | undefined {
  if (node.color) return node.color;
  return resolveTagColor(
    node.metadata,
    [...tagGroups],
    activeGroupName,
    node.isContainer
  );
}

// ============================================================
// Legend
// ============================================================

function computeLegendGroups(
  tagGroups: readonly TagGroup[],
  usedValuesByGroup?: Map<string, Set<string>>
): Writable<SitemapLegendGroup>[] {
  const groups: Writable<SitemapLegendGroup>[] = [];

  for (const group of tagGroups) {
    if (group.entries.length === 0) continue;

    const usedValues = usedValuesByGroup?.get(tagAttrKey(group.name));
    const visibleEntries = usedValues
      ? group.entries.filter((e) => usedValues.has(e.value.toLowerCase()))
      : group.entries;
    if (visibleEntries.length === 0) continue;

    const pillWidth =
      measureLegendText(group.name, LEGEND_PILL_FONT_SIZE) + LEGEND_PILL_PAD;
    const minPillWidth = pillWidth;

    let entriesWidth = 0;
    for (const entry of visibleEntries) {
      entriesWidth +=
        LEGEND_DOT_R * 2 +
        LEGEND_ENTRY_DOT_GAP +
        measureLegendText(entry.value, LEGEND_ENTRY_FONT_SIZE) +
        LEGEND_ENTRY_TRAIL;
    }
    const eyeSpace = LEGEND_EYE_SIZE + LEGEND_EYE_GAP;
    const capsuleWidth =
      LEGEND_CAPSULE_PAD * 2 + pillWidth + 4 + eyeSpace + entriesWidth;

    groups.push({
      name: group.name,
      ...(group.alias !== undefined && { alias: group.alias }),
      entries: visibleEntries.map((e) => ({ value: e.value, color: e.color })),
      x: 0,
      y: 0,
      width: capsuleWidth,
      height: LEGEND_HEIGHT,
      minifiedWidth: minPillWidth,
      minifiedHeight: LEGEND_HEIGHT,
    });
  }

  return groups;
}

// ============================================================
// Flatten tree into page-node and container lists
// ============================================================

// ============================================================
// Layout — a page tree (#1861)
// ============================================================
//
// Indentation is the tree: a page's children, and a group's pages, hang
// under it joined by grey elbows. Top-level groups hang under the FIRST
// top-level page; each later top-level page starts its own tree beside it;
// with no top-level page the groups stand side by side. Written arrows never
// move a card — they are dashed `link` curves drawn over the finished tree.
//
// A node with only leaf children stacks them in an indented column (the org
// chart's compact leaf layout); one with deeper children spreads its subtrees
// side by side under a bus; a `steps` group lays its pages out in a numbered
// row joined by bold `step` arrows. direction-lr turns the tree on its side.

interface TNode {
  src: SitemapNode;
  meta: Record<string, string>;
  fullMeta: Record<string, string>;
  w: number;
  h: number;
  kids: TNode[];
  subW: number;
  subH: number;
  x: number; // card left
  y: number; // card top
  step?: number;
}

type Pt = { x: number; y: number };

function buildTNode(
  node: SitemapNode,
  extraKids: readonly SitemapNode[],
  hiddenAttributes: Set<string> | undefined
): TNode {
  const meta = filterMetadata(node.metadata, hiddenAttributes);
  const w = computeCardWidth(node.label, meta, node.description);
  const kids = [...node.children, ...extraKids]
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map((k) => buildTNode(k, [], hiddenAttributes));
  return {
    src: node,
    meta,
    fullMeta: { ...node.metadata },
    w,
    h: computeCardHeight(meta, w, node.description?.length ?? 0),
    kids,
    subW: 0,
    subH: 0,
    x: 0,
    y: 0,
  };
}

const isStack = (n: TNode): boolean =>
  !n.src.steps && n.kids.length > 0 && n.kids.every((k) => k.kids.length === 0);

/** Written links by source id, so a stacked column can reserve its arcs' room. */
type LinkIndex = ReadonlyMap<
  string,
  readonly { targetId: string; label?: string }[]
>;

/**
 * Room a stacked column needs right of its widest card for the side arcs of
 * links among its cards (see `linkPoints`), measured on the stacked offsets.
 */
function stackArcRoom(n: TNode, links: LinkIndex): number {
  const mid = new Map<string, number>();
  mid.set(n.src.id, n.h / 2);
  let y = n.h + STACK_GAP;
  for (const k of n.kids) {
    mid.set(k.src.id, y + k.h / 2);
    y += k.h + STACK_GAP;
  }
  let room = 0;
  for (const [id, ay] of mid)
    for (const l of links.get(id) ?? []) {
      const by = mid.get(l.targetId);
      if (by === undefined || l.targetId === id) continue;
      room = Math.max(room, sideArcBow(l.label, by - ay));
    }
  return room;
}

function sizeTB(n: TNode, links: LinkIndex): void {
  for (const k of n.kids) sizeTB(k, links);
  if (n.kids.length === 0) {
    n.subW = n.w;
    n.subH = n.h;
  } else if (isStack(n)) {
    n.subW = Math.max(
      n.w,
      STACK_INDENT +
        Math.max(...n.kids.map((k) => k.w)) +
        stackArcRoom(n, links)
    );
    n.subH = n.h + n.kids.reduce((s, k) => s + STACK_GAP + k.h, 0);
  } else {
    const gap = n.src.steps ? STEP_GAP : TREE_H_GAP;
    const rowW =
      n.kids.reduce((s, k) => s + k.subW, 0) + gap * (n.kids.length - 1);
    n.subW = Math.max(n.w, rowW);
    n.subH = n.h + TREE_V_GAP + Math.max(...n.kids.map((k) => k.subH));
  }
}

function placeTB(n: TNode, left: number, top: number, edges: LEdge[]): void {
  n.y = top;
  if (n.kids.length === 0) {
    n.x = left;
    return;
  }
  if (isStack(n)) {
    n.x = left;
    const trunkX = left + STACK_INDENT / 2;
    let cy = top + n.h + STACK_GAP;
    for (const k of n.kids) {
      placeTB(k, left + STACK_INDENT, cy, edges);
      const my = k.y + k.h / 2;
      edges.push(
        treeEdge(n, k, [
          { x: trunkX, y: top + n.h },
          { x: trunkX, y: my },
          { x: k.x, y: my },
        ])
      );
      cy += k.h + STACK_GAP;
    }
    return;
  }
  const steps = n.src.steps === true;
  const gap = steps ? STEP_GAP : TREE_H_GAP;
  const rowW =
    n.kids.reduce((s, k) => s + k.subW, 0) + gap * (n.kids.length - 1);
  let cx = left + (n.subW - rowW) / 2;
  const rowTop = top + n.h + TREE_V_GAP;
  for (const k of n.kids) {
    placeTB(k, cx, rowTop, edges);
    cx += k.subW + gap;
  }
  const first = n.kids[0]!;
  const last = n.kids[n.kids.length - 1]!;
  const centre = steps
    ? first.x + first.w / 2
    : (first.x + first.w / 2 + last.x + last.w / 2) / 2;
  n.x = Math.min(Math.max(centre - n.w / 2, left), left + n.subW - n.w);
  const px = n.x + n.w / 2;
  const busY = top + n.h + TREE_V_GAP / 2;
  const targets = steps ? [first] : n.kids;
  for (const k of targets) {
    const kx = k.x + k.w / 2;
    edges.push(
      treeEdge(
        n,
        k,
        Math.abs(kx - px) < 0.5
          ? [
              { x: px, y: top + n.h },
              { x: kx, y: k.y },
            ]
          : [
              { x: px, y: top + n.h },
              { x: px, y: busY },
              { x: kx, y: busY },
              { x: kx, y: k.y },
            ]
      )
    );
  }
  if (steps) stepEdges(n, edges, 'TB');
}

function sizeLR(n: TNode): void {
  for (const k of n.kids) sizeLR(k);
  if (n.kids.length === 0) {
    n.subW = n.w;
    n.subH = n.h;
  } else if (n.src.steps) {
    const rowW =
      n.kids.reduce((s, k) => s + k.subW, 0) + STEP_GAP * (n.kids.length - 1);
    n.subW = n.w + LR_H_GAP + rowW;
    n.subH = Math.max(n.h, ...n.kids.map((k) => k.subH));
  } else {
    const colH =
      n.kids.reduce((s, k) => s + k.subH, 0) + LR_V_GAP * (n.kids.length - 1);
    n.subW = n.w + LR_H_GAP + Math.max(...n.kids.map((k) => k.subW));
    n.subH = Math.max(n.h, colH);
  }
}

function placeLR(n: TNode, left: number, top: number, edges: LEdge[]): void {
  n.x = left;
  if (n.kids.length === 0) {
    n.y = top;
    return;
  }
  const kidLeft = left + n.w + LR_H_GAP;
  if (n.src.steps) {
    n.y = top + (n.subH - n.h) / 2;
    const mid = n.y + n.h / 2;
    let cx = kidLeft;
    for (const k of n.kids) {
      placeLR(k, cx, mid - k.subH / 2, edges);
      cx += k.subW + STEP_GAP;
    }
    const first = n.kids[0]!;
    edges.push(
      treeEdge(n, first, [
        { x: left + n.w, y: mid },
        { x: first.x, y: mid },
      ])
    );
    stepEdges(n, edges, 'LR');
    return;
  }
  const colH =
    n.kids.reduce((s, k) => s + k.subH, 0) + LR_V_GAP * (n.kids.length - 1);
  let cy = top + (n.subH - colH) / 2;
  for (const k of n.kids) {
    placeLR(k, kidLeft, cy, edges);
    cy += k.subH + LR_V_GAP;
  }
  const first = n.kids[0]!;
  const last = n.kids[n.kids.length - 1]!;
  const centre = (first.y + first.h / 2 + last.y + last.h / 2) / 2;
  n.y = Math.min(Math.max(centre - n.h / 2, top), top + n.subH - n.h);
  const py = n.y + n.h / 2;
  const busX = left + n.w + LR_H_GAP / 2;
  for (const k of n.kids) {
    const ky = k.y + k.h / 2;
    edges.push(
      treeEdge(
        n,
        k,
        Math.abs(ky - py) < 0.5
          ? [
              { x: left + n.w, y: py },
              { x: k.x, y: ky },
            ]
          : [
              { x: left + n.w, y: py },
              { x: busX, y: py },
              { x: busX, y: ky },
              { x: k.x, y: ky },
            ]
      )
    );
  }
}

interface LEdge {
  sourceId: string;
  targetId: string;
  points: Pt[];
  label?: string;
  lineNumber: number;
  kind: 'tree' | 'step' | 'link';
}

function treeEdge(n: TNode, k: TNode, points: Pt[]): LEdge {
  return {
    sourceId: n.src.id,
    targetId: k.src.id,
    points,
    lineNumber: k.src.lineNumber,
    kind: 'tree',
  };
}

/** Number a steps group's pages and join each to the next with a bold arrow. */
function stepEdges(n: TNode, edges: LEdge[], dir: 'TB' | 'LR'): void {
  n.kids.forEach((k, i) => {
    k.step = i + 1;
    const next = n.kids[i + 1];
    if (!next) return;
    const y =
      dir === 'TB'
        ? k.y + Math.min(k.h, next.h) / 2
        : (k.y + k.h / 2 + next.y + next.h / 2) / 2;
    edges.push({
      sourceId: k.src.id,
      targetId: next.src.id,
      points: [
        { x: k.x + k.w, y },
        { x: next.x, y },
      ],
      lineNumber: next.src.lineNumber,
      kind: 'step',
    });
  });
}

/**
 * A written arrow as a gentle curve between the two cards' borders, bowed to
 * the right of its direction so A→B and B→A part. A self-link loops over the
 * card's top-right corner.
 */
function linkPoints(s: TNode, t: TNode, label?: string): Pt[] {
  if (s === t) {
    const r = s.x + s.w;
    const top = s.y;
    return [
      { x: r - 24, y: top },
      { x: r - 24, y: top - 20 },
      { x: r + 20, y: top - 20 },
      { x: r + 20, y: top + 14 },
      { x: r, y: top + 14 },
    ];
  }
  // Cards in one column (a stacked list): arc out past their right edges,
  // so the link never squeezes through the gap between them.
  const xOverlap = Math.min(s.x + s.w, t.x + t.w) - Math.max(s.x, t.x);
  if (xOverlap > 0) {
    const ay = s.y + s.h / 2;
    const by = t.y + t.h / 2;
    const r = Math.max(s.x + s.w, t.x + t.w);
    const bow = sideArcBow(label, by - ay);
    // The peak leans toward the source, so A→B and B→A between the same two
    // cards — otherwise one curve — part, and so do their labels.
    return [
      { x: s.x + s.w, y: ay },
      { x: r + bow, y: ay + (by - ay) * SIDE_ARC_LEAN },
      { x: t.x + t.w, y: by },
    ];
  }
  // Cards in one row (a steps row, a row of sections): arc above for a
  // forward link and below for a back link, clear of the step arrows.
  const yOverlap = Math.min(s.y + s.h, t.y + t.h) - Math.max(s.y, t.y);
  if (yOverlap > 0) {
    const forward = t.x > s.x;
    const edge = forward ? Math.min(s.y, t.y) : Math.max(s.y + s.h, t.y + t.h);
    const ay = forward ? s.y : s.y + s.h;
    const by = forward ? t.y : t.y + t.h;
    const ax = s.x + s.w / 2;
    const bx = t.x + t.w / 2;
    const bow = 26 + Math.abs(bx - ax) * 0.06;
    return [
      { x: ax, y: ay },
      { x: (ax + bx) / 2, y: edge + (forward ? -bow : bow) * 2 },
      { x: bx, y: by },
    ];
  }
  const sc = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  const tc = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
  const a = clipToRectBorder(sc.x, sc.y, s.w, s.h, tc.x, tc.y);
  const b = clipToRectBorder(tc.x, tc.y, t.w, t.h, sc.x, sc.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(LINK_BOW_MAX, len * 0.18);
  const mid = {
    x: (a.x + b.x) / 2 - (dy / len) * bow,
    y: (a.y + b.y) / 2 + (dx / len) * bow,
  };
  return [a, mid, b];
}

export function layoutSitemap(
  parsed: ParsedSitemap,
  hiddenCounts?: Map<string, number>,
  activeTagGroup?: string | null,
  hiddenAttributes?: Set<string>,
  expandAllLegend?: boolean
): SitemapLayoutResult {
  if (parsed.roots.length === 0) {
    return {
      nodes: [],
      edges: [],
      legend: [],
      width: 0,
      height: 0,
    };
  }

  // Inject default tag metadata
  const allNodes: SitemapNode[] = [];
  const collect = (node: SitemapNode) => {
    allNodes.push(node);
    for (const child of node.children) collect(child);
  };
  for (const root of parsed.roots) collect(root);
  injectDefaultTagMetadata(
    allNodes,
    parsed.tagGroups,
    (e) => (e as SitemapNode).isContainer
  );

  // The forest: top-level groups join the first top-level page.
  const firstPage = parsed.roots.find((r) => !r.isContainer);
  const topGroups = parsed.roots.filter((r) => r.isContainer);
  const trees: TNode[] = firstPage
    ? parsed.roots
        .filter((r) => !r.isContainer)
        .map((r) =>
          buildTNode(r, r === firstPage ? topGroups : [], hiddenAttributes)
        )
    : topGroups.map((g) => buildTNode(g, [], hiddenAttributes));

  const linkIndex = new Map<string, { targetId: string; label?: string }[]>();
  for (const e of parsed.edges) {
    const list = linkIndex.get(e.sourceId) ?? [];
    list.push({
      targetId: e.targetId,
      ...(e.label !== undefined && { label: e.label }),
    });
    linkIndex.set(e.sourceId, list);
  }

  const lr = parsed.direction === 'LR';
  const treeEdges: LEdge[] = [];
  let cursor = MARGIN;
  for (const t of trees) {
    if (lr) {
      sizeLR(t);
      placeLR(t, MARGIN, cursor, treeEdges);
      cursor += t.subH + FOREST_GAP;
    } else {
      sizeTB(t, linkIndex);
      placeTB(t, cursor, MARGIN, treeEdges);
      cursor += t.subW + FOREST_GAP;
    }
  }

  const byId = new Map<string, TNode>();
  const walk = (n: TNode) => {
    byId.set(n.src.id, n);
    n.kids.forEach(walk);
  };
  trees.forEach(walk);

  const linkEdges: LEdge[] = [];
  for (const e of parsed.edges) {
    const s = byId.get(e.sourceId);
    const t = byId.get(e.targetId);
    if (!s || !t) continue;
    linkEdges.push({
      sourceId: e.sourceId,
      targetId: e.targetId,
      points: linkPoints(s, t, e.label),
      ...(e.label !== undefined && { label: e.label }),
      lineNumber: e.lineNumber,
      kind: 'link',
    });
  }

  const layoutNodes: Writable<SitemapLayoutNode>[] = [];
  for (const n of byId.values()) {
    const node = n.src;
    const hc = hiddenCounts?.get(node.id);
    const resolvedColor = resolveNodeColor(
      node,
      parsed.tagGroups,
      activeTagGroup ?? null
    );
    layoutNodes.push({
      id: node.id,
      label: node.label,
      metadata: n.meta,
      tagMetadata: n.fullMeta,
      ...(node.description !== undefined && {
        description: [...node.description],
      }),
      isContainer: node.isContainer,
      lineNumber: node.lineNumber,
      ...(resolvedColor !== undefined && { color: resolvedColor }),
      x: n.x + n.w / 2,
      y: n.y,
      width: n.w,
      height: n.h,
      ...(hc !== undefined && { hiddenCount: hc }),
      ...((node.children.length > 0 || (hc != null && hc > 0)) && {
        hasChildren: true,
      }),
      ...(n.step !== undefined && { step: n.step }),
    });
  }
  // Tree lines under, steps over them, written links on top.
  const layoutEdges: SitemapLayoutEdge[] = [...treeEdges, ...linkEdges];

  // Compute bounding box
  let totalWidth = 0;
  let totalHeight = 0;
  for (const node of layoutNodes) {
    totalWidth = Math.max(totalWidth, node.x + node.width / 2);
    totalHeight = Math.max(totalHeight, node.y + node.height);
  }
  for (const edge of layoutEdges) {
    for (const p of edge.points) {
      totalWidth = Math.max(totalWidth, p.x);
      totalHeight = Math.max(totalHeight, p.y);
    }
  }
  totalWidth += MARGIN;
  totalHeight += MARGIN;

  // Collect used tag values
  const usedValuesByGroup = new Map<string, Set<string>>();
  for (const group of parsed.tagGroups) {
    const key = tagAttrKey(group.name);
    const used = new Set<string>();
    const walk = (node: SitemapNode) => {
      if (!node.isContainer && node.metadata[key]) {
        used.add(node.metadata[key].toLowerCase());
      }
      for (const child of node.children) walk(child);
    };
    for (const root of parsed.roots) walk(root);
    usedValuesByGroup.set(key, used);
  }

  // Legend
  const legendGroups = computeLegendGroups(parsed.tagGroups, usedValuesByGroup);

  const visibleGroups =
    activeTagGroup != null
      ? legendGroups.filter(
          (g) => g.name.toLowerCase() === activeTagGroup.toLowerCase()
        )
      : legendGroups;
  const allExpanded = expandAllLegend && activeTagGroup == null;
  const effectiveW = (g: SitemapLegendGroup) =>
    activeTagGroup != null || allExpanded ? g.width : g.minifiedWidth;

  if (visibleGroups.length > 0) {
    // Bottom position: horizontal row below chart content
    const legendShift = LEGEND_HEIGHT + LEGEND_GROUP_GAP;

    const totalGroupsWidth =
      visibleGroups.reduce((s, g) => s + effectiveW(g), 0) +
      (visibleGroups.length - 1) * LEGEND_GROUP_GAP;

    // Center legend groups horizontally
    const neededWidth = totalGroupsWidth + MARGIN * 2;
    if (neededWidth > totalWidth) {
      // Re-centre the tree inside the wider box — renderers centre the BOX in
      // the canvas, so a tree left at its old x sits off-centre by half the
      // surplus. Same defect as `org/layout.ts`.
      const shift = (neededWidth - totalWidth) / 2;
      totalWidth = neededWidth;
      for (const n of layoutNodes) n.x += shift;
      for (const e of layoutEdges) {
        for (const p of e.points as Writable<{ x: number; y: number }>[])
          p.x += shift;
      }
    }
    let cx = (totalWidth - totalGroupsWidth) / 2;
    const legendY = totalHeight + LEGEND_GROUP_GAP;
    for (const g of visibleGroups) {
      g.x = cx;
      g.y = legendY;
      cx += effectiveW(g) + LEGEND_GROUP_GAP;
    }

    totalHeight += legendShift;
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    legend: legendGroups,
    width: totalWidth,
    height: totalHeight,
  };
}
