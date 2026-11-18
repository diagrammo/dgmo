// ============================================================
// Ownership chart layout — layers, order, positions, routing (#1873)
// ============================================================
//
// A layered (top-down) layout built for the owner's routing rules:
//
//   1. An entity with several owners takes their lines left to right, in the
//      order of the owners' x positions.
//   2. Each owner has one trunk and one horizontal run per gap between ranks;
//      owners whose runs overlap in x get different heights.
//   3. No line passes through a box; a pill sits on its own line's vertical.
//   4. Order is chosen to minimise crossings before anything else; a crossing
//      the structure forces is reported (the parser turns it into a warning).
//   5. A triangle or an oval takes a line where the line meets its outline.
//
// Steps: break cycles → rank (longest path, outside owners pulled down beside
// what they own) → dummies on links that span several ranks → order each rank
// (barycenter sweeps plus adjacent swaps, keeping the order with the fewest
// crossings) → x by order-preserving least squares toward neighbours → route
// each gap → y. The crossings reported are counted on the routed geometry, so
// they are the crossings the picture shows.
//
// Pure: no DOM. Text is measured with the shared metrics, so the parser can
// run it for the forced-crossing warning.

import {
  measureText,
  truncateText,
  wrapTextToWidth,
} from '../utils/text-measure';
import { tagAttrKey } from '../utils/tag-groups';
import type { EntityType, OwnershipEntity, ParsedOwnership } from './types';

// ── Text ──────────────────────────────────────────────────────
export const NAME_FONT_SIZE = 12.5;
export const SUB_FONT_SIZE = 10;
export const DESC_FONT_SIZE = 10;
export const NAME_LINE_HEIGHT = 16;
export const SUB_LINE_HEIGHT = 14;
export const PILL_FONT_SIZE = 10.5;
export const PILL_HEIGHT = 17;
const PILL_PAD_X = 7;

// ── Shapes ────────────────────────────────────────────────────
const PAD_X = 14;
const PAD_Y = 10;
const MIN_WIDTH = 150;
const MAX_TEXT_WIDTH = 212;
// A partnership triangle keeps one aspect (height / width) and wraps its name
// instead of widening to fit it on one line (#2101). Only the name sits
// inside; the jurisdiction goes in a code box at the bottom right (the HMRC
// structure-chart convention) and the description becomes a caption under
// the base when no line leaves the base.
const TRIANGLE_ASPECT = 0.62;
const TRIANGLE_NAME_WIDTH = 104;
/** Base to the bottom of the name block; leaves the code box its own row. */
export const TRIANGLE_BOTTOM_PAD = 20;
const TRIANGLE_SIDE_PAD = 8;
/** Base to the caption's baseline box top. */
export const TRIANGLE_CAPTION_GAP = 4;
const OVAL_PAD = 6;

// ── Spacing ───────────────────────────────────────────────────
const NODE_GAP = 40;
const DUMMY_GAP = 24;
/** Owner bottom to its first run. */
const TRUNK_STUB = 18;
/** Between two runs at different heights in one gap. */
const LEVEL_GAP = 14;
/** Lowest run to the top of the next rank: room for the pill and arrow. */
const DROP = 62;
/** Between two lines entering one entity. */
const ENTRY_GAP = 58;
const ARROW = 6;

const EPS = 0.5;
/** Ordering effort: sweeps per start, and shuffled restarts after the first. */
const SWEEPS = 12;
const RESTARTS = 40;
/** Orders to try one by one: the product of each rank's permutations. */
const EXHAUSTIVE_LIMIT = 50_000;

export type EntityShape = 'rect' | 'triangle' | 'oval' | 'trust';

export function shapeOf(type: EntityType): EntityShape {
  if (type === 'partnership') return 'triangle';
  if (type === 'individual') return 'oval';
  if (type === 'trust') return 'trust';
  return 'rect';
}

export const TYPE_LABELS: Record<EntityType, string> = {
  corporation: 'Corporation',
  partnership: 'Partnership',
  individual: 'Individual',
  trust: 'Trust',
};

export interface LayoutEntity {
  readonly id: string;
  readonly entity: OwnershipEntity;
  readonly shape: EntityShape;
  readonly rank: number;
  /** Centre x. */
  readonly x: number;
  /** Top y of the shape's box. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly nameLines: readonly string[];
  /** "UK · Corporation"; on a triangle, only the jurisdiction, for its code box. */
  readonly sub: string;
  /**
   * First description line, truncated to fit; '' when none. On a triangle it
   * is the caption under the base, and '' when the triangle owns anything.
   */
  readonly desc: string;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface LayoutEdge {
  /** The link id. */
  readonly id: string;
  readonly ownerId: string;
  readonly ownedId: string;
  /** Orthogonal polyline from the owner to the owned entity. */
  readonly points: readonly Point[];
  /** Pill centre, on the vertical piece next to the owned entity. */
  readonly pill: { x: number; y: number; width: number; readonly text: string };
  /** Drawn against a cycle: the arrow sits at the start (the upper end). */
  readonly reversed: boolean;
  readonly dashed: boolean;
}

export interface OwnershipLayout {
  readonly width: number;
  readonly height: number;
  readonly entities: readonly LayoutEntity[];
  readonly edges: readonly LayoutEdge[];
  /** Pairs of link ids whose lines cross in the drawing. */
  readonly crossings: readonly { a: string; b: string }[];
}

// ============================================================
// Measuring
// ============================================================

interface Measured {
  shape: EntityShape;
  nameLines: string[];
  sub: string;
  descFull: string;
  /** Widest text line. */
  textWidth: number;
  /** Height of the text block. */
  textHeight: number;
  /** Height the rank must give this entity, caption included. */
  naturalHeight: number;
  /** Triangle only: the shape's own size, fixed by the name. */
  tri?: { width: number; height: number };
}

function firstGroupValue(
  parsed: ParsedOwnership,
  entity: OwnershipEntity
): string {
  const group = parsed.tagGroups[0];
  if (!group) return '';
  const raw = entity.metadata[tagAttrKey(group.name)];
  if (!raw) return '';
  return (
    group.entries.find((e) => e.value.toLowerCase() === raw.toLowerCase())
      ?.value ?? raw
  );
}

function measure(
  parsed: ParsedOwnership,
  entity: OwnershipEntity,
  owns: boolean
): Measured {
  const shape = shapeOf(entity.type);
  const value = firstGroupValue(parsed, entity);
  if (shape === 'triangle') return measureTriangle(entity, value, owns);
  const nameLines = wrapTextToWidth(
    entity.name,
    NAME_FONT_SIZE,
    MAX_TEXT_WIDTH,
    {
      bold: true,
    }
  );
  const sub = [value, TYPE_LABELS[entity.type]].filter(Boolean).join(' · ');
  const descFull = entity.description[0] ?? '';
  const widths = [
    ...nameLines.map((l) => measureText(l, NAME_FONT_SIZE, { bold: true })),
    Math.min(MAX_TEXT_WIDTH, measureText(sub, SUB_FONT_SIZE)),
    Math.min(MAX_TEXT_WIDTH, measureText(stripMd(descFull), DESC_FONT_SIZE)),
  ];
  const textWidth = Math.max(...widths);
  const textHeight =
    nameLines.length * NAME_LINE_HEIGHT +
    (sub ? SUB_LINE_HEIGHT : 0) +
    (descFull ? SUB_LINE_HEIGHT : 0);
  const naturalHeight =
    shape === 'oval' ? textHeight + 2 * PAD_Y + 12 : textHeight + 2 * PAD_Y;
  return {
    shape,
    nameLines,
    sub,
    descFull,
    textWidth,
    textHeight,
    naturalHeight,
  };
}

/**
 * A triangle sized from its wrapped name. With height = k·width, the name's
 * widest line fits at the top of the block when
 * width ≥ need + (bottomPad + textHeight) / k.
 */
function measureTriangle(
  entity: OwnershipEntity,
  value: string,
  owns: boolean
): Measured {
  // Narrowest wrap that takes at most two lines, so a long name does not
  // strand a word ("LP") on a third.
  let nameLines: string[] = [];
  for (let w = TRIANGLE_NAME_WIDTH; w <= MAX_TEXT_WIDTH; w += 12) {
    nameLines = wrapTextToWidth(entity.name, NAME_FONT_SIZE, w, { bold: true });
    if (nameLines.length <= 2) break;
  }
  const textWidth = Math.max(
    ...nameLines.map((l) => measureText(l, NAME_FONT_SIZE, { bold: true }))
  );
  const textHeight = nameLines.length * NAME_LINE_HEIGHT;
  const need = textWidth + 2 * TRIANGLE_SIDE_PAD;
  const width = Math.max(
    MIN_WIDTH,
    need + (TRIANGLE_BOTTOM_PAD + textHeight) / TRIANGLE_ASPECT
  );
  const height = Math.round(width * TRIANGLE_ASPECT);
  const descFull = owns ? '' : (entity.description[0] ?? '');
  return {
    shape: 'triangle',
    nameLines,
    sub: value,
    descFull,
    textWidth,
    textHeight,
    naturalHeight:
      height + (descFull ? TRIANGLE_CAPTION_GAP + SUB_LINE_HEIGHT : 0),
    tri: { width, height },
  };
}

/** Display text of a §34.6 line, for measuring. */
function stripMd(text: string): string {
  return text.replace(/\*\*|__|[*_`]/g, '');
}

/** Shape width once the rank height is known. */
function shapeWidth(m: Measured, height: number): number {
  if (m.tri) return m.tri.width;
  if (m.shape === 'oval') {
    const ry = height / 2;
    const halfH = m.textHeight / 2 + 2;
    const k = Math.sqrt(Math.max(0.2, 1 - (halfH / ry) ** 2));
    return Math.max(MIN_WIDTH, (2 * (m.textWidth / 2 + OVAL_PAD)) / k);
  }
  return Math.max(MIN_WIDTH, m.textWidth + 2 * PAD_X);
}

/** Half-width a shape's entry points may use, from its centre. */
function usableHalf(shape: EntityShape, width: number): number {
  if (shape === 'triangle' || shape === 'oval') return width * 0.32;
  return width / 2 - 22;
}

/** Where a vertical line at `x` meets the shape's upper outline. */
function outlineTop(
  shape: EntityShape,
  cx: number,
  top: number,
  width: number,
  height: number,
  x: number
): number {
  const dx = Math.abs(x - cx);
  if (shape === 'triangle') return top + (height * dx) / (width / 2);
  if (shape === 'oval') {
    const rx = width / 2;
    const ry = height / 2;
    return top + ry - ry * Math.sqrt(Math.max(0, 1 - (dx / rx) ** 2));
  }
  return top;
}

// ============================================================
// Graph
// ============================================================

interface GNode {
  /** Entity id, or `d<n>` for a dummy. */
  id: string;
  real: boolean;
  rank: number;
  width: number;
  x: number;
}

/** One hop between adjacent ranks. */
interface Hop {
  link: string;
  from: number;
  to: number;
}

export function layoutOwnership(parsed: ParsedOwnership): OwnershipLayout {
  const entities = parsed.entities;
  const links = parsed.links;
  const index = new Map(entities.map((e, i) => [e.id, i]));
  const n = entities.length;

  // ── Cycles: a link back into the DFS path is laid out reversed ─
  const outLinks: number[][] = entities.map(() => []);
  links.forEach((l, li) => outLinks[index.get(l.ownerId)!]!.push(li));
  const reversed = new Set<number>();
  const state = new Array<number>(n).fill(0);
  const dfs = (v: number): void => {
    state[v] = 1;
    for (const li of outLinks[v]!) {
      const w = index.get(links[li]!.ownedId)!;
      if (state[w] === 1) reversed.add(li);
      else if (state[w] === 0) dfs(w);
    }
    state[v] = 2;
  };
  const rootIdx = parsed.rootId ? (index.get(parsed.rootId) ?? 0) : 0;
  if (n > 0) dfs(rootIdx);
  for (let v = 0; v < n; v++) if (state[v] === 0) dfs(v);

  const up = (li: number): number => {
    const l = links[li]!;
    return index.get(reversed.has(li) ? l.ownedId : l.ownerId)!;
  };
  const down = (li: number): number => {
    const l = links[li]!;
    return index.get(reversed.has(li) ? l.ownerId : l.ownedId)!;
  };
  const succ: number[][] = entities.map(() => []);
  const pred: number[][] = entities.map(() => []);
  links.forEach((_, li) => {
    succ[up(li)]!.push(li);
    pred[down(li)]!.push(li);
  });

  // ── Ranks: longest path, then sources pulled down to sit beside what
  // they own ──────────────────────────────────────────────────
  const indeg = pred.map((p) => p.length);
  const topo: number[] = [];
  const queue: number[] = [];
  for (let v = 0; v < n; v++) if (indeg[v] === 0) queue.push(v);
  while (queue.length > 0) {
    const v = queue.shift()!;
    topo.push(v);
    for (const li of succ[v]!) {
      const w = down(li);
      if (--indeg[w]! === 0) queue.push(w);
    }
  }
  const rank = new Array<number>(n).fill(0);
  for (const v of topo)
    for (const li of succ[v]!)
      rank[down(li)] = Math.max(rank[down(li)]!, rank[v]! + 1);
  for (const v of [...topo].reverse()) {
    if (pred[v]!.length > 0 || succ[v]!.length === 0) continue;
    rank[v] = Math.min(...succ[v]!.map((li) => rank[down(li)]!)) - 1;
  }
  const minRank = n > 0 ? Math.min(...rank) : 0;
  for (let v = 0; v < n; v++) rank[v] = rank[v]! - minRank;
  const rankCount = n > 0 ? Math.max(...rank) + 1 : 0;

  // ── Sizes: rank height first, then the width each shape needs ─
  // A triangle has its own height; every other shape in a rank shares one
  // (boxHeight), so a tall triangle does not stretch the boxes beside it.
  const owners = new Set(links.map((l) => l.ownerId));
  const measured = entities.map((e) => measure(parsed, e, owners.has(e.id)));
  const rankHeight = new Array<number>(rankCount).fill(0);
  const boxHeight = new Array<number>(rankCount).fill(0);
  for (let v = 0; v < n; v++) {
    const r = rank[v]!;
    const m = measured[v]!;
    rankHeight[r] = Math.max(rankHeight[r]!, m.naturalHeight);
    if (!m.tri) boxHeight[r] = Math.max(boxHeight[r]!, m.naturalHeight);
  }
  const widths = measured.map((m, v) => shapeWidth(m, boxHeight[rank[v]!]!));

  // ── Graph with dummies ───────────────────────────────────────
  const nodes: GNode[] = entities.map((e, v) => ({
    id: e.id,
    real: true,
    rank: rank[v]!,
    width: widths[v]!,
    x: 0,
  }));
  const hops: Hop[] = [];
  /** Per link, its hops top to bottom. */
  const chain = new Map<string, Hop[]>();
  links.forEach((l, li) => {
    const a = up(li);
    const b = down(li);
    const list: Hop[] = [];
    let prev = a;
    for (let r = rank[a]! + 1; r < rank[b]!; r++) {
      const d = nodes.length;
      nodes.push({ id: `d${d}`, real: false, rank: r, width: 0, x: 0 });
      list.push({ link: l.id, from: prev, to: d });
      prev = d;
    }
    list.push({ link: l.id, from: prev, to: b });
    hops.push(...list);
    chain.set(l.id, list);
  });
  const ups: number[][] = nodes.map(() => []);
  const downs: number[][] = nodes.map(() => []);
  for (const h of hops) {
    downs[h.from]!.push(h.to);
    ups[h.to]!.push(h.from);
  }

  // ── Order: DFS seed, then barycenter sweeps and adjacent swaps ─
  let layers: number[][] = Array.from({ length: rankCount }, () => []);
  const seen = new Set<number>();
  const place = (v: number): void => {
    if (seen.has(v)) return;
    seen.add(v);
    layers[nodes[v]!.rank]!.push(v);
    for (const w of downs[v]!) place(w);
  };
  if (n > 0) place(rootIdx);
  for (let v = 0; v < n; v++) place(v);
  for (let v = n; v < nodes.length; v++) place(v);

  const pos = new Array<number>(nodes.length).fill(0);
  const setPos = (ls: number[][]): void => {
    for (const layer of ls) layer.forEach((v, i) => (pos[v] = i));
  };
  /** Crossings between layer r and r+1, counted on hops. */
  const pairCrossings = (r: number): number => {
    const es: [number, number][] = [];
    for (const v of layers[r]!)
      for (const w of downs[v]!) es.push([pos[v]!, pos[w]!]);
    let c = 0;
    for (let i = 0; i < es.length; i++)
      for (let j = i + 1; j < es.length; j++) {
        const [a1, b1] = es[i]!;
        const [a2, b2] = es[j]!;
        if ((a1 - a2) * (b1 - b2) < 0) c++;
      }
    return c;
  };
  const totalCrossings = (): number => {
    let c = 0;
    for (let r = 0; r + 1 < rankCount; r++) c += pairCrossings(r);
    return c;
  };
  const sortBy = (r: number, neighbours: number[][]): void => {
    const layer = layers[r]!;
    const keyed = layer.map((v, i) => {
      const ns = neighbours[v]!;
      const bc = ns.length
        ? ns.reduce((s, w) => s + pos[w]!, 0) / ns.length
        : i;
      return { v, bc, i };
    });
    keyed.sort((a, b) => a.bc - b.bc || a.i - b.i);
    layers[r] = keyed.map((k) => k.v);
    layers[r].forEach((v, i) => (pos[v] = i));
  };
  const transpose = (): void => {
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 20) {
      improved = false;
      for (let r = 0; r < rankCount; r++) {
        const layer = layers[r]!;
        for (let i = 0; i + 1 < layer.length; i++) {
          const local = (): number =>
            (r > 0 ? pairCrossings(r - 1) : 0) +
            (r + 1 < rankCount ? pairCrossings(r) : 0);
          const before = local();
          [layer[i], layer[i + 1]] = [layer[i + 1]!, layer[i]!];
          pos[layer[i]!] = i;
          pos[layer[i + 1]!] = i + 1;
          if (local() < before) {
            improved = true;
          } else {
            [layer[i], layer[i + 1]] = [layer[i + 1]!, layer[i]!];
            pos[layer[i]!] = i;
            pos[layer[i + 1]!] = i + 1;
          }
        }
      }
    }
  };
  // Barycenter sweeps fall into local minima on chains (fund → Labs ← Inc →
  // GmbH ← BV …), so the sweep restarts from shuffled orders, seeded so the
  // same source always lays out the same way, until nothing crosses.
  const seed = layers.map((l) => [...l]);
  setPos(layers);
  let best = seed.map((l) => [...l]);
  let bestCount = totalCrossings();
  const random = mulberry32(nodes.length * 7919 + hops.length);
  for (let restart = 0; restart <= RESTARTS && bestCount > 0; restart++) {
    layers = seed.map((l) => [...l]);
    if (restart > 0) for (const l of layers) shuffle(l, random);
    setPos(layers);
    for (let iter = 0; iter < SWEEPS && bestCount > 0; iter++) {
      for (let r = 1; r < rankCount; r++) sortBy(r, ups);
      for (let r = rankCount - 2; r >= 0; r--) sortBy(r, downs);
      transpose();
      const c = totalCrossings();
      if (c < bestCount) {
        bestCount = c;
        best = layers.map((l) => [...l]);
      }
    }
  }
  // A small chart is searched exhaustively (branch and bound), so the order
  // it draws is the fewest crossings any order can reach.
  if (bestCount > 0) {
    const space = layers.reduce((p, l) => p * factorial(l.length), 1);
    if (space <= EXHAUSTIVE_LIMIT) {
      const trial = best.map((l) => [...l]);
      layers = trial;
      const permsOf = trial.map((l) => permutations(l));
      const rec = (r: number, sofar: number): void => {
        if (sofar >= bestCount) return;
        if (r === rankCount) {
          bestCount = sofar;
          best = trial.map((l) => [...l]);
          return;
        }
        for (const p of permsOf[r]!) {
          trial[r] = p;
          p.forEach((v, i) => (pos[v] = i));
          rec(r + 1, sofar + (r > 0 ? pairCrossings(r - 1) : 0));
          if (bestCount === 0) return;
        }
      };
      rec(0, 0);
    }
  }
  layers = best;
  // A mirror image crosses exactly as often; keep the one that reads closer
  // to the source, siblings left to right as written.
  const sourceOrder = (ls: number[][]): number => {
    let score = 0;
    for (const l of ls) {
      const real = l.filter((v) => v < n);
      for (let i = 0; i < real.length; i++)
        for (let j = i + 1; j < real.length; j++)
          score += real[i]! < real[j]! ? 1 : -1;
    }
    return score;
  };
  const mirrored = layers.map((l) => [...l].reverse());
  if (sourceOrder(mirrored) > sourceOrder(layers)) layers = mirrored;
  setPos(layers);

  // ── x: order-preserving least squares toward neighbours ──────
  const sep = (a: GNode, b: GNode): number =>
    a.width / 2 + b.width / 2 + (a.real && b.real ? NODE_GAP : DUMMY_GAP);
  for (const layer of layers) {
    let x = 0;
    layer.forEach((v, i) => {
      if (i > 0) x += sep(nodes[layer[i - 1]!]!, nodes[v]!);
      nodes[v]!.x = x;
    });
  }
  const weight = (a: number, b: number): number =>
    !nodes[a]!.real && !nodes[b]!.real
      ? 8
      : !nodes[a]!.real || !nodes[b]!.real
        ? 2
        : 1;
  const relax = (r: number): void => {
    const layer = layers[r]!;
    const desired = layer.map((v) => {
      const ns = [...ups[v]!, ...downs[v]!];
      if (ns.length === 0) return nodes[v]!.x;
      let s = 0;
      let w = 0;
      for (const u of ns) {
        const k = weight(u, v);
        s += k * nodes[u]!.x;
        w += k;
      }
      return s / w;
    });
    const offsets: number[] = [];
    let o = 0;
    layer.forEach((v, i) => {
      if (i > 0) o += sep(nodes[layer[i - 1]!]!, nodes[v]!);
      offsets.push(o);
    });
    const ys = isotonic(desired.map((d, i) => d - offsets[i]!));
    layer.forEach((v, i) => (nodes[v]!.x = ys[i]! + offsets[i]!));
  };
  for (let iter = 0; iter < 40; iter++) {
    for (let r = 0; r < rankCount; r++) relax(r);
    for (let r = rankCount - 1; r >= 0; r--) relax(r);
  }
  let minLeft = Infinity;
  let maxRight = -Infinity;
  for (const nd of nodes) {
    minLeft = Math.min(minLeft, nd.x - nd.width / 2);
    maxRight = Math.max(maxRight, nd.x + nd.width / 2);
  }
  if (!Number.isFinite(minLeft)) {
    minLeft = 0;
    maxRight = 0;
  }
  for (const nd of nodes) nd.x = round(nd.x - minLeft);

  // ── Routing, one gap at a time ───────────────────────────────
  interface Owner {
    node: number;
    x: number;
    hops: Hop[];
    lo: number;
    hi: number;
    level: number;
    straight: boolean;
  }
  const entryX = new Map<Hop, number>();
  const ownerOfHop = new Map<Hop, Owner>();
  const gapLevels: number[] = [];
  const hopsByGap: Hop[][] = Array.from(
    { length: Math.max(0, rankCount - 1) },
    () => []
  );
  for (const h of hops) hopsByGap[nodes[h.from]!.rank]!.push(h);

  for (let r = 0; r + 1 < rankCount; r++) {
    const gap = hopsByGap[r]!;
    // Entry points, ordered by the owners' x (rule 1).
    const byTarget = new Map<number, Hop[]>();
    for (const h of gap) {
      const list = byTarget.get(h.to) ?? [];
      list.push(h);
      byTarget.set(h.to, list);
    }
    for (const [t, list] of byTarget) {
      list.sort(
        (a, b) =>
          nodes[a.from]!.x - nodes[b.from]!.x || pos[a.from]! - pos[b.from]!
      );
      const tn = nodes[t]!;
      if (!tn.real) {
        for (const h of list) entryX.set(h, tn.x);
        continue;
      }
      const k = list.length;
      const half = usableHalf(measured[t]!.shape, tn.width);
      const step = k > 1 ? Math.min(ENTRY_GAP, (2 * half) / (k - 1)) : 0;
      list.forEach((h, i) =>
        entryX.set(h, round(tn.x + (i - (k - 1) / 2) * step))
      );
    }
    // One owner per upper node: a trunk and a run (rule 2).
    const owners = new Map<number, Owner>();
    for (const h of gap) {
      let o = owners.get(h.from);
      if (!o) {
        const x = nodes[h.from]!.x;
        o = {
          node: h.from,
          x,
          hops: [],
          lo: x,
          hi: x,
          level: 0,
          straight: false,
        };
        owners.set(h.from, o);
      }
      o.hops.push(h);
      const e = entryX.get(h)!;
      o.lo = Math.min(o.lo, e);
      o.hi = Math.max(o.hi, e);
      ownerOfHop.set(h, o);
    }
    const list = [...owners.values()].sort((a, b) => a.x - b.x);
    for (const o of list) o.straight = o.hi - o.lo < EPS;
    const runs = list.filter((o) => !o.straight);
    // cost[i][j]: the crossings drawn when run i sits higher than run j —
    // j's trunk passes down through i's run, and i's drops through j's.
    const inside = (v: number, o: Owner): boolean =>
      v > o.lo + EPS && v < o.hi - EPS;
    const cost = runs.map((a) =>
      runs.map((b) =>
        a === b
          ? 0
          : (inside(b.x, a) ? 1 : 0) +
            a.hops.filter((h) => inside(entryX.get(h)!, b)).length
      )
    );
    const order = runOrder(cost);
    // Each run turns below every earlier run it interacts with, and never on
    // top of a run it overlaps.
    const placed: number[] = [];
    for (const i of order) {
      const o = runs[i]!;
      let level = 0;
      for (const j of placed)
        if (cost[i]![j]! + cost[j]![i]! > 0)
          level = Math.max(level, runs[j]!.level + 1);
      const clash = (lv: number): boolean =>
        placed.some((j) => {
          const p = runs[j]!;
          return p.level === lv && p.lo < o.hi + 2 && o.lo < p.hi + 2;
        });
      while (clash(level)) level++;
      o.level = level;
      placed.push(i);
    }
    gapLevels[r] = runs.length ? Math.max(...runs.map((o) => o.level)) + 1 : 1;
  }

  // ── y ───────────────────────────────────────────────────────
  const rankTop: number[] = [];
  let y = 0;
  for (let r = 0; r < rankCount; r++) {
    rankTop[r] = y;
    y += rankHeight[r]!;
    if (r + 1 < rankCount)
      y += TRUNK_STUB + (gapLevels[r]! - 1) * LEVEL_GAP + DROP;
  }
  const height = y;
  const rankBottom = (r: number): number => rankTop[r]! + rankHeight[r]!;
  const runY = (r: number, level: number): number =>
    rankBottom(r) + TRUNK_STUB + level * LEVEL_GAP;
  const pillY = (r: number): number =>
    (runY(r, gapLevels[r]! - 1) + rankTop[r + 1]!) / 2;

  const layoutEntities: LayoutEntity[] = entities.map((e, v) => {
    const m = measured[v]!;
    const w = widths[v]!;
    const h = m.tri ? m.tri.height : boxHeight[rank[v]!]!;
    const descMax = m.shape === 'oval' ? m.textWidth + 1 : w - 2 * PAD_X;
    return {
      id: e.id,
      entity: e,
      shape: m.shape,
      rank: rank[v]!,
      x: nodes[v]!.x,
      y: rankTop[rank[v]!]!,
      width: round(w),
      height: h,
      nameLines: m.nameLines,
      sub: m.tri ? m.sub : truncateText(m.sub, SUB_FONT_SIZE, descMax),
      desc: m.descFull ? truncateText(m.descFull, DESC_FONT_SIZE, descMax) : '',
    };
  });

  const entryY = (h: Hop, x: number): number => {
    const t = nodes[h.to]!;
    const r = t.rank;
    if (!t.real) return rankTop[r]!;
    const le = layoutEntities[h.to]!;
    return round(outlineTop(le.shape, le.x, le.y, le.width, le.height, x));
  };

  // ── Edges ───────────────────────────────────────────────────
  interface Seg {
    link: string;
    /** Shared trunk and run pieces carry their owner's key. */
    group: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }
  const segs: Seg[] = [];
  const edges: LayoutEdge[] = links.map((l, li) => {
    const list = chain.get(l.id)!;
    const pts: Point[] = [];
    const push = (x: number, yy: number): void => {
      const last = pts[pts.length - 1];
      if (last && Math.abs(last.x - x) < 0.01 && Math.abs(last.y - yy) < 0.01)
        return;
      pts.push({ x: round(x), y: round(yy) });
    };
    let lastDrop = { x: 0, gap: 0 };
    for (const h of list) {
      const from = nodes[h.from]!;
      const r = from.rank;
      const o = ownerOfHop.get(h)!;
      const e = entryX.get(h)!;
      const ey = entryY(h, e);
      const group = `${r}:${h.from}`;
      if (!from.real) {
        // Straight through the rank band.
        push(from.x, rankTop[r]!);
        segs.push({
          link: l.id,
          group: `band:${h.from}`,
          x1: from.x,
          y1: rankTop[r]!,
          x2: from.x,
          y2: rankBottom(r),
        });
      }
      // A real owner's line leaves its own bottom, which may sit above the
      // rank's when a taller triangle shares the rank.
      const sy = from.real
        ? layoutEntities[h.from]!.y + layoutEntities[h.from]!.height
        : rankBottom(r);
      push(from.x, sy);
      if (o.straight) {
        push(from.x, ey);
        segs.push({
          link: l.id,
          group,
          x1: from.x,
          y1: sy,
          x2: from.x,
          y2: ey,
        });
      } else {
        const ry = runY(r, o.level);
        push(from.x, ry);
        push(e, ry);
        push(e, ey);
        segs.push({
          link: l.id,
          group,
          x1: from.x,
          y1: sy,
          x2: from.x,
          y2: ry,
        });
        segs.push({
          link: l.id,
          group,
          x1: Math.min(from.x, e),
          y1: ry,
          x2: Math.max(from.x, e),
          y2: ry,
        });
        segs.push({ link: l.id, group, x1: e, y1: ry, x2: e, y2: ey });
      }
      lastDrop = { x: e, gap: r };
    }
    const text = `${l.pctText}%`;
    return {
      id: l.id,
      ownerId: l.ownerId,
      ownedId: l.ownedId,
      points: collinear(pts),
      pill: {
        x: lastDrop.x,
        y: round(pillY(lastDrop.gap)),
        width: round(
          measureText(text, PILL_FONT_SIZE, { bold: true }) + 2 * PILL_PAD_X
        ),
        text,
      },
      reversed: reversed.has(li),
      dashed: entities[index.get(l.ownerId)!]!.outside,
    };
  });

  // Pills that would touch on a crowded entity alternate up and down.
  const pillRows = new Map<string, LayoutEdge[]>();
  for (const e of edges) {
    const key = `${e.pill.y}:${e.ownedId}`;
    const row = pillRows.get(key) ?? [];
    row.push(e);
    pillRows.set(key, row);
  }
  for (const row of pillRows.values()) {
    row.sort((a, b) => a.pill.x - b.pill.x);
    let crowded = false;
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1]!.pill;
      const b = row[i]!.pill;
      if (b.x - a.x < (a.width + b.width) / 2 + 4) crowded = true;
    }
    if (!crowded) continue;
    const shift = (PILL_HEIGHT + 3) / 2;
    row.forEach((e, i) => {
      e.pill.y = round(e.pill.y + (i % 2 === 0 ? -shift : shift));
    });
  }

  return {
    width: round(maxRight - minLeft),
    height,
    entities: layoutEntities,
    edges,
    crossings: findCrossings(segs),
  };
}

// ============================================================
// Helpers
// ============================================================

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Drop interior points that sit on a straight line. */
function collinear(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    while (out.length >= 2) {
      const a = out[out.length - 2]!;
      const b = out[out.length - 1]!;
      const sameX = Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - p.x) < 0.01;
      const sameY = Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - p.y) < 0.01;
      if (sameX || sameY) out.pop();
      else break;
    }
    out.push(p);
  }
  return out;
}

/**
 * The top-to-bottom order of a gap's runs with the fewest crossings, from
 * `cost[i][j]` (the crossings when i sits above j). Exhaustive for a few
 * runs; beyond that, insertion of each run at its cheapest place.
 */
function runOrder(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length;
  const ids = Array.from({ length: n }, (_, i) => i);
  const total = (ord: readonly number[]): number => {
    let c = 0;
    for (let a = 0; a < ord.length; a++)
      for (let b = a + 1; b < ord.length; b++) c += cost[ord[a]!]![ord[b]!]!;
    return c;
  };
  if (n <= 7) {
    let best = ids;
    let bestCost = total(ids);
    for (const p of permutations(ids)) {
      if (bestCost === 0) break;
      const c = total(p);
      if (c < bestCost) {
        bestCost = c;
        best = p;
      }
    }
    return best;
  }
  const ord: number[] = [];
  for (const i of ids) {
    let at = 0;
    let bestCost = Infinity;
    for (let k = 0; k <= ord.length; k++) {
      const c = total([...ord.slice(0, k), i, ...ord.slice(k)]);
      if (c < bestCost) {
        bestCost = c;
        at = k;
      }
    }
    ord.splice(at, 0, i);
  }
  return ord;
}

function factorial(k: number): number {
  return k <= 1 ? 1 : k * factorial(k - 1);
}

function permutations(list: readonly number[]): number[][] {
  if (list.length <= 1) return [[...list]];
  return list.flatMap((v, i) =>
    permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((p) => [
      v,
      ...p,
    ])
  );
}

/** Small seeded PRNG, so a shuffled restart is the same on every render. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], random: () => number): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
}

/** Non-decreasing least-squares fit (pool adjacent violators). */
function isotonic(values: number[]): number[] {
  const blocks: { sum: number; count: number }[] = [];
  for (const v of values) {
    blocks.push({ sum: v, count: 1 });
    while (blocks.length >= 2) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sum / a.count <= b.sum / b.count) break;
      a.sum += b.sum;
      a.count += b.count;
      blocks.pop();
    }
  }
  const out: number[] = [];
  for (const b of blocks)
    for (let i = 0; i < b.count; i++) out.push(b.sum / b.count);
  return out;
}

interface CrossSeg {
  link: string;
  group: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Pairs of links whose drawn pieces cross or lie on top of each other. Pieces
 * an owner shares among its own links (one trunk, one run) never count.
 */
export function findCrossings(
  segs: readonly CrossSeg[]
): { a: string; b: string }[] {
  const pairs = new Map<string, { a: string; b: string }>();
  // One owner's lines share its trunk and run, so crossing that shared piece
  // is one crossing on the page, however many lines run along it.
  const seen = new Set<string>();
  const where = (s: { x1: number; y1: number; x2: number; y2: number }) =>
    [s.x1, s.y1, s.x2, s.y2].map((v) => v.toFixed(1)).join(',');
  const norm = segs.map((s) => ({
    ...s,
    x1: Math.min(s.x1, s.x2),
    x2: Math.max(s.x1, s.x2),
    y1: Math.min(s.y1, s.y2),
    y2: Math.max(s.y1, s.y2),
  }));
  for (let i = 0; i < norm.length; i++) {
    for (let j = i + 1; j < norm.length; j++) {
      const s = norm[i]!;
      const t = norm[j]!;
      if (s.link === t.link || s.group === t.group) continue;
      if (!segmentsMeet(s, t)) continue;
      const spot = [where(s), where(t)].sort().join('|');
      if (seen.has(spot)) continue;
      seen.add(spot);
      const [a, b] = s.link < t.link ? [s.link, t.link] : [t.link, s.link];
      pairs.set(`${a}|${b}`, { a, b });
    }
  }
  return [...pairs.values()];
}

function segmentsMeet(
  s: { x1: number; y1: number; x2: number; y2: number },
  t: { x1: number; y1: number; x2: number; y2: number }
): boolean {
  const sH = Math.abs(s.y1 - s.y2) < 0.01;
  const tH = Math.abs(t.y1 - t.y2) < 0.01;
  const sV = Math.abs(s.x1 - s.x2) < 0.01;
  const tV = Math.abs(t.x1 - t.x2) < 0.01;
  if (sH && tV && !sV) return crossHV(s, t);
  if (tH && sV && !tV) return crossHV(t, s);
  // Collinear pieces lying on top of each other.
  if (sH && tH && Math.abs(s.y1 - t.y1) < EPS)
    return Math.min(s.x2, t.x2) - Math.max(s.x1, t.x1) > EPS;
  if (sV && tV && Math.abs(s.x1 - t.x1) < EPS)
    return Math.min(s.y2, t.y2) - Math.max(s.y1, t.y1) > EPS;
  return false;
}

function crossHV(
  h: { x1: number; y1: number; x2: number },
  v: { x1: number; y1: number; y2: number }
): boolean {
  return (
    v.x1 > h.x1 + EPS &&
    v.x1 < h.x2 - EPS &&
    h.y1 > v.y1 + EPS &&
    h.y1 < v.y2 - EPS
  );
}

/** Arrowhead length, for the renderer. */
export const ARROW_SIZE = ARROW;
