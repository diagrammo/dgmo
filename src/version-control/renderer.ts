// ============================================================
// Version-Control — D3 SVG Renderer (spec §29)
// ============================================================
//
// "Metro map" lanes: thick rounded colored branch lines, big commit dots,
// rounded right-angle elbow connectors, ref-pill badges, and diagonal commit
// labels (LR) / a right-hand column (TB). Ghost commits (faded/dashed) are the
// shared primitive behind rebase/reset/squash. Ports
// docs/version-control-syntax-mockups.html build()/draw().

import { EDGE_DASH, HAIRLINE_DASH } from '../utils/visual-conventions';
import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { getSeriesColors, mix } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';
import { growChartFrame } from '../utils/chart-frame';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedVersionControl, VCBranch, VCNode } from './types';

type Sel = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

// Refined to match the event-line visual system: thinner strokes, smaller dots,
// horizontal message "shelves" (no rotated text).
const LINE = 3; // branch lane / connector stroke
const DOT = 5.5; // commit dot radius (event-line DOT_R)
const CORNER = 10; // elbow radius
const STACK = 19; // above-dot badge stack step
const CIRCLED = '①②③④⑤⑥⑦⑧⑨';
const TITLE_AREA = 40;
// Message-shelf (event-line no-box) constants.
const SHELF_TINT = 13; // % branch color mixed over bg for the shelf fill
const SHELF_EDGE = 4; // shelf corner radius
const SHELF_LIP = 2; // colored spine-side landing lip
const SHELF_PAD = 8; // horizontal text inset inside a shelf
const SHELF_H = 21; // single-line shelf height
const LEADER_GAP = 22; // lanes-bottom → first shelf row
const ROW_GAP = 7; // vertical gap between stacked shelf rows
const SCAN_REACH = 40; // how far past the dot a shelf may hang in the fine scan

interface Badge {
  kind: 'tag' | 'ref' | 'head' | 'note';
  label: string;
  w: number;
  remote?: boolean;
}
interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}
interface Placement {
  node: VCNode;
  kind: 'msg' | 'tag' | 'ref' | 'head' | 'note' | 'ab';
  label?: string | undefined;
  remote?: boolean | undefined;
  w?: number | undefined;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  shelfLeft?: number | undefined;
  shelfTop?: number | undefined;
  shelfW?: number | undefined;
  leader?: { x1: number; y1: number; x2: number; y2: number } | undefined;
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/** Rounded right-angle elbow through one corner. */
function roundedL(
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  ex: number,
  ey: number,
  r: number
): string {
  const l1 = Math.hypot(cx - sx, cy - sy);
  const l2 = Math.hypot(ex - cx, ey - cy);
  const rr = Math.max(2, Math.min(r, l1 - 1, l2 - 1));
  const u1x = (cx - sx) / (l1 || 1),
    u1y = (cy - sy) / (l1 || 1);
  const u2x = (ex - cx) / (l2 || 1),
    u2y = (ey - cy) / (l2 || 1);
  return `M${sx},${sy} L${cx - u1x * rr},${cy - u1y * rr} Q${cx},${cy} ${cx + u2x * rr},${cy + u2y * rr} L${ex},${ey}`;
}

export function renderVersionControl(
  container: HTMLDivElement,
  parsed: ParsedVersionControl,
  palette: PaletteColors,
  isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  void isDark;
  if (parsed.nodes.length === 0) return;
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  const nodes = parsed.nodes;
  const TB = parsed.options.direction !== 'LR';
  const branchByName = new Map(
    parsed.branches.map((b) => [b.name, b] as const)
  );
  const series = getSeriesColors(palette);
  const laneColor = (b: VCBranch): string =>
    b.colorToken
      ? (resolveColor(b.colorToken, palette) ?? series[b.lane % series.length]!)
      : series[b.lane % series.length]!;
  const colorOf = (n: VCNode): string => laneColor(branchByName.get(n.branch)!);
  const byKey = (k: number): VCNode => nodes[k]!;

  // ── per-node label strings ──
  const pfx = (n: VCNode): string =>
    n.kind === 'cherry' ? '⇠ ' : n.kind === 'merge' ? '⇲ ' : '';
  const label = new Map<
    number,
    { sha: string | null; msg: string; lw: number }
  >();
  for (const n of nodes) {
    const sha = n.id;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty commit message also shows '(empty)'
    const msg = pfx(n) + clip(n.message || '(empty)', 26);
    // Bold 12px message text averages ~6.9px/char; under-measuring here lets the
    // diagonal labels project below the computed canvas height (bottom clipping,
    // esp. in hosts whose font load lags the layout pass — e.g. Obsidian).
    const lw = (sha ? sha.length * 6.6 + 8 : 0) + msg.length * 6.9 + 8;
    label.set(n.key, { sha, msg, lw });
  }
  const maxLW = Math.max(0, ...[...label.values()].map((l) => l.lw));

  // ── above-the-dot badge stack ──
  const above = new Map<number, Badge[]>();
  const pushBadge = (k: number, b: Badge): void => {
    if (!above.has(k)) above.set(k, []);
    above.get(k)!.push(b);
  };
  if (!parsed.options.noLabels) {
    for (const n of nodes)
      if (n.tag)
        pushBadge(n.key, {
          kind: 'tag',
          label: n.tag,
          w: n.tag.length * 6.6 + 16,
        });
  }
  for (const r of parsed.refs) {
    if (r.atKey == null) continue;
    if (r.head) pushBadge(r.atKey, { kind: 'head', label: 'HEAD', w: 46 });
    else
      pushBadge(r.atKey, {
        kind: 'ref',
        label: r.name,
        remote: r.remote,
        w: r.name.length * 6.2 + 18,
      });
  }
  for (const nt of parsed.notes) {
    if (nt.anchorKey == null) continue;
    pushBadge(nt.anchorKey, {
      kind: 'note',
      label: CIRCLED[nt.num - 1] ?? `#${nt.num}`,
      w: 19,
    });
  }
  const maxStack = Math.max(0, ...[...above.values()].map((a) => a.length));

  const laneCount = parsed.branches.length;
  const K = nodes.length;
  const pos = new Map<number, { x: number; y: number }>();
  const placements: Placement[] = [];
  let shiftX = 0;
  let contentW: number,
    contentH: number,
    gutter: number,
    cross0: number,
    captionY = 0;
  if (!TB) {
    // Branch names now sit inline above each lane's first commit, so the left
    // gutter only needs a small margin.
    gutter = 14;
    const along0 = gutter + 20,
      step = 88,
      laneGap = 50;
    cross0 = 16 + maxStack * STACK + 14;
    for (const n of nodes)
      pos.set(n.key, {
        x: along0 + n.seq * step,
        y: cross0 + n.lane * laneGap,
      });
    const lanesBottom = cross0 + (laneCount - 1) * laneGap;
    const bandTop = lanesBottom + LEADER_GAP;

    // Message shelves sit BESIDE their dot: first free slot just under the
    // commit's own lane (short leader), tried centered, then hanging right,
    // then hanging left, then one row lower. Only when every nearby slot is
    // taken (other shelves, dots, lane/connector lines, badges, branch names)
    // does a shelf drop to the shared band below the lanes.
    const shelfGap = 6;
    const P0 = (k: number): { x: number; y: number } => pos.get(k)!;
    const blocked: Box[] = [];
    const seg = (x1: number, y1: number, x2: number, y2: number): void => {
      blocked.push({
        l: Math.min(x1, x2) - 3,
        t: Math.min(y1, y2) - 3,
        r: Math.max(x1, x2) + 3,
        b: Math.max(y1, y2) + 3,
      });
    };
    const legs = (a: VCNode, b: VCNode, cx: number, cy: number): void => {
      const A = P0(a.key),
        B = P0(b.key);
      seg(A.x, A.y, cx, cy);
      seg(cx, cy, B.x, B.y);
    };
    for (const n of nodes) {
      const N = P0(n.key);
      blocked.push({
        l: N.x - DOT - 3,
        t: N.y - DOT - 3,
        r: N.x + DOT + 3,
        b: N.y + DOT + 3,
      });
      if (n.prev != null) seg(P0(n.prev).x, P0(n.prev).y, N.x, N.y);
      if (n.parent != null) legs(byKey(n.parent), n, P0(n.parent).x, N.y);
      if (n.mergeFrom != null)
        legs(byKey(n.mergeFrom), n, N.x, P0(n.mergeFrom).y);
      for (const from of [n.cherryFrom, n.revertFrom, n.squashFrom])
        if (from != null) legs(byKey(from), n, N.x, P0(from).y);
      if (n.movedTo != null) legs(n, byKey(n.movedTo), P0(n.movedTo).x, N.y);
      (above.get(n.key) ?? []).forEach((it, j) => {
        const cy = N.y - DOT - 12 - j * STACK;
        blocked.push({
          l: N.x - it.w / 2 - 2,
          t: cy - 10,
          r: N.x + it.w / 2 + 2,
          b: cy + 10,
        });
      });
    }
    if (!parsed.options.noLanes)
      for (const b of parsed.branches) {
        let first: VCNode | null = null;
        for (const n of nodes)
          if (n.branch === b.name && (first === null || n.seq < first.seq))
            first = n;
        if (!first) continue;
        const fp = P0(first.key);
        blocked.push({
          l: fp.x - DOT - 2,
          t: fp.y - DOT - 22,
          r: fp.x - DOT + b.name.length * 8 + 4,
          b: fp.y - DOT - 2,
        });
      }
    for (const b of parsed.branches) {
      if (!b.ab || b.ab.ahead + b.ab.behind === 0 || b.tip == null) continue;
      const tip = P0(b.tip);
      blocked.push({
        l: tip.x + DOT + 6,
        t: tip.y - 9,
        r: tip.x + DOT + 10 + abText(b.ab).length * 7 + 4,
        b: tip.y + 9,
      });
    }
    const hit = (a: Box, list: readonly Box[]): boolean =>
      list.some((o) => a.l < o.r && a.r > o.l && a.t < o.b && a.b > o.t);
    const shelves: Box[] = [];
    const shelfRects: Box[] = [];
    let minLeft = Infinity,
      maxRight = 0;
    const sorted = [...nodes].sort(
      (a, b) => pos.get(a.key)!.x - pos.get(b.key)!.x
    );
    let bottom = bandTop;
    for (const n of sorted) {
      const p = pos.get(n.key)!;
      const w = label.get(n.key)!.lw + SHELF_PAD * 2;
      const near = p.y + DOT + 8;
      const aboveNear = p.y - DOT - 8 - SHELF_H;
      const preferred = [
        p.x - w / 2,
        p.x - 10,
        p.x - w + 10,
        p.x + DOT + 6,
        p.x - w - DOT - 6,
      ];
      // Leader endpoint on the shelf's near edge, clamped inside its corners.
      const leadX = (left: number): number =>
        Math.min(Math.max(p.x, left + 6), left + w - 6);
      const leadOf = (
        left: number,
        top: number
      ): { x1: number; y1: number; x2: number; y2: number } =>
        top > p.y
          ? { x1: p.x, y1: p.y + DOT, x2: leadX(left), y2: top }
          : { x1: p.x, y1: p.y - DOT, x2: leadX(left), y2: top + SHELF_H };
      // Candidates, best first: the original five beside the dot below the
      // lane (then one row lower), the same five above the lane, then a fine
      // scan of every nearby offset ranked by leader length. A shelf may run
      // past the left edge; the whole graph shifts right to make room.
      const cands: { left: number; top: number }[] = [];
      for (const top of [near, near + SHELF_H + ROW_GAP])
        for (const left of preferred) cands.push({ left, top });
      if (aboveNear >= 4)
        for (const left of preferred) cands.push({ left, top: aboveNear });
      const scan: { left: number; top: number; cost: number }[] = [];
      for (const top of [near, near + SHELF_H + ROW_GAP, aboveNear]) {
        if (top < 4) continue;
        for (
          let left = p.x - w - SCAN_REACH;
          left <= p.x + SCAN_REACH;
          left += 2
        ) {
          const L = leadOf(left, top);
          scan.push({ left, top, cost: Math.hypot(L.x2 - L.x1, L.y2 - L.y1) });
        }
      }
      scan.sort((a, b) => a.cost - b.cost);
      cands.push(...scan);
      // The node's own dot and the lines meeting it are not obstacles for its
      // own shelf's leader, only for the shelf body.
      const slot = (left: number, top: number): Box => ({
        l: left - shelfGap / 2,
        t: top - 2,
        r: left + w + shelfGap / 2,
        b: top + SHELF_H + 2,
      });
      let chosen: { left: number; top: number } | null = null;
      for (const c of cands) {
        const box = slot(c.left, c.top);
        if (hit(box, blocked) || hit(box, shelves)) continue;
        const L = leadOf(c.left, c.top);
        if (shelfRects.some((r) => segHitsBox(L, r))) continue;
        chosen = c;
        break;
      }
      if (!chosen) {
        const left = p.x - w / 2;
        for (let row = 0; !chosen; row++) {
          const top = bandTop + row * (SHELF_H + ROW_GAP);
          if (!hit(slot(left, top), shelves)) chosen = { left, top };
        }
      }
      const { left, top } = chosen;
      shelves.push(slot(left, top));
      shelfRects.push({ l: left, t: top, r: left + w, b: top + SHELF_H });
      minLeft = Math.min(minLeft, left);
      maxRight = Math.max(maxRight, left + w);
      bottom = Math.max(bottom, top + SHELF_H);
      placements.push({
        node: n,
        kind: 'msg',
        x: p.x,
        y: top,
        anchor: 'start',
        shelfLeft: left,
        shelfTop: top,
        shelfW: w,
        leader: leadOf(left, top),
      });
      const stack = above.get(n.key) ?? [];
      stack.forEach((it, j) =>
        placements.push({
          node: n,
          kind: it.kind,
          label: it.label,
          remote: it.remote,
          w: it.w,
          x: p.x,
          y: p.y - DOT - 12 - j * STACK,
          anchor: 'middle',
        })
      );
    }
    for (const b of parsed.branches) {
      if (!b.ab || b.ab.ahead + b.ab.behind === 0 || b.tip == null) continue;
      const tip = pos.get(b.tip)!;
      placements.push({
        node: byKey(b.tip),
        kind: 'ab',
        label: abText(b.ab),
        x: tip.x + DOT + 10,
        y: tip.y,
        anchor: 'start',
      });
    }
    contentW =
      Math.max(
        along0 + (K - 1) * step + DOT + 40,
        ...[...pos.entries()].map(
          ([k, p]) => p.x + label.get(k)!.lw / 2 + SHELF_PAD + 8
        ),
        maxRight + 8
      ) + 8;
    // A shelf hanging past the left edge shifts the whole graph right.
    shiftX = Number.isFinite(minLeft) ? Math.max(0, 4 - minLeft) : 0;
    contentW += shiftX;
    contentH = bottom + 8;
    if (parsed.notes.length) {
      captionY = contentH + 4;
      contentH += 8 + parsed.notes.length * 16 + 8;
    }
  } else {
    gutter = 24;
    const along0 = gutter + 32,
      step = 52,
      laneGap = 96;
    cross0 = 78;
    for (const n of nodes)
      pos.set(n.key, {
        x: cross0 + n.lane * laneGap,
        y: along0 + n.seq * step,
      });
    const bandX = cross0 + (laneCount - 1) * laneGap + 28;
    for (const n of nodes) {
      const p = pos.get(n.key)!;
      placements.push({
        node: n,
        kind: 'msg',
        x: bandX,
        y: p.y,
        anchor: 'start',
        leader: { x1: p.x + DOT + 2, y1: p.y, x2: bandX - 6, y2: p.y },
      });
      const stack = above.get(n.key) ?? [];
      // in TB, stack badges to the left of the dot
      stack.forEach((it, j) =>
        placements.push({
          node: n,
          kind: it.kind,
          label: it.label,
          remote: it.remote,
          w: it.w,
          x: p.x - DOT - 12 - it.w / 2 - j * 4,
          y: p.y,
          anchor: 'middle',
        })
      );
    }
    contentW = bandX + maxLW + 16;
    contentH = along0 + (K - 1) * step + 22;
  }

  const showTitle = !!parsed.title;
  const titleH = showTitle ? TITLE_AREA : 0;
  const baseW = contentW;
  const baseH = contentH + titleH;

  const exportMode = !!exportDims;
  // Fit-to-pane in live preview: pad the viewBox out to the panel so the SVG
  // element is exactly the pane size and `meet` scales the graph down to fit —
  // a wide graph never overflows/clips, a small one never upscales past 1:1.
  const paneW = exportMode ? 0 : container.clientWidth || 0;
  const paneH = exportMode ? 0 : container.clientHeight || 0;
  const W = Math.round(Math.max(baseW, paneW));
  const H = Math.round(Math.max(baseH, paneH));
  const vw = exportMode ? W : paneW || W;
  const vh = exportMode ? H : paneH || H;
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', vw)
    .attr('height', vh)
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .style('font-family', FONT_FAMILY);
  svg
    .append('rect')
    .attr('width', W)
    .attr('height', H)
    .attr('fill', palette.bg);

  if (showTitle) {
    const t = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', W / 2)
      .attr('y', TITLE_Y)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .attr('data-line-number', parsed.titleLineNumber ?? 1)
      .text(parsed.title);
    if (onClickItem && parsed.titleLineNumber && !exportMode) {
      const ln = parsed.titleLineNumber;
      t.style('cursor', 'pointer').on('click', () => onClickItem(ln));
    }
  }

  const g = svg
    .append('g')
    .attr('transform', `translate(${shiftX}, ${titleH})`);
  drawGraph(
    g,
    parsed,
    palette,
    TB,
    pos,
    placements,
    label,
    colorOf,
    byKey,
    cross0,
    captionY,
    onClickItem && !exportMode ? onClickItem : undefined
  );

  // Chart frame (#1827): subtitle under the title, footer under the chart.
  growChartFrame(svg.node(), parsed.frame, palette, {
    size: exportMode ? 'grow' : 'fit',
  });
}

/** Does segment (x1,y1)→(x2,y2) pass through box b? Sampled; leaders are short. */
function segHitsBox(
  L: { x1: number; y1: number; x2: number; y2: number },
  b: Box
): boolean {
  const steps = Math.max(2, Math.ceil(Math.hypot(L.x2 - L.x1, L.y2 - L.y1)));
  for (let i = 0; i <= steps; i++) {
    const x = L.x1 + ((L.x2 - L.x1) * i) / steps;
    const y = L.y1 + ((L.y2 - L.y1) * i) / steps;
    if (x > b.l && x < b.r && y > b.t && y < b.b) return true;
  }
  return false;
}

function abText(ab: { ahead: number; behind: number }): string {
  const a: string[] = [];
  if (ab.ahead) a.push('↑' + ab.ahead);
  if (ab.behind) a.push('↓' + ab.behind);
  return a.join(' ');
}

function drawGraph(
  g: Sel,
  parsed: ParsedVersionControl,
  palette: PaletteColors,
  TB: boolean,
  pos: Map<number, { x: number; y: number }>,
  placements: Placement[],
  label: Map<number, { sha: string | null; msg: string; lw: number }>,
  colorOf: (n: VCNode) => string,
  byKey: (k: number) => VCNode,
  cross0: number,
  captionY: number,
  onClickItem?: (lineNumber: number) => void
): void {
  const nodes = parsed.nodes;
  const P = (k: number): { x: number; y: number } => pos.get(k)!;
  const branchCorner = (par: VCNode, n: VCNode): { x: number; y: number } =>
    TB
      ? { x: P(n.key).x, y: P(par.key).y }
      : { x: P(par.key).x, y: P(n.key).y };
  const mergeCorner = (src: VCNode, n: VCNode): { x: number; y: number } =>
    TB
      ? { x: P(src.key).x, y: P(n.key).y }
      : { x: P(n.key).x, y: P(src.key).y };
  const gop = (n: VCNode): number => (n.ghost ? 0.32 : 1);

  const dlink = (a: VCNode, b: VCNode, color: string, arrow: boolean): void => {
    const A = P(a.key),
      B = P(b.key),
      c = mergeCorner(a, b);
    g.append('path')
      .attr('d', roundedL(A.x, A.y, c.x, c.y, B.x, B.y, CORNER))
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', HAIRLINE_DASH)
      .attr('opacity', 0.8);
    if (arrow) {
      // small arrowhead at B pointing along (corner → B)
      const dx = B.x - c.x,
        dy = B.y - c.y,
        l = Math.hypot(dx, dy) || 1;
      const ux = dx / l,
        uy = dy / l,
        px = -uy,
        py = ux,
        s = 4;
      g.append('path')
        .attr(
          'd',
          `M${B.x},${B.y} L${B.x - ux * s * 2 + px * s},${B.y - uy * s * 2 + py * s} L${B.x - ux * s * 2 - px * s},${B.y - uy * s * 2 - py * s} Z`
        )
        .attr('fill', color)
        .attr('opacity', 0.8);
    }
  };

  // ── edges ──
  for (const n of nodes) {
    const c = colorOf(n);
    const o = gop(n);
    const N = P(n.key);
    if (n.prev != null) {
      const a = P(n.prev);
      const e = g
        .append('line')
        .attr('x1', a.x)
        .attr('y1', a.y)
        .attr('x2', N.x)
        .attr('y2', N.y)
        .attr('stroke', c)
        .attr('stroke-width', LINE)
        .attr('stroke-linecap', 'round')
        .attr('data-branch', n.branch)
        .attr('opacity', o);
      if (n.ghost) e.attr('stroke-dasharray', EDGE_DASH);
    }
    if (n.parent != null) {
      const par = byKey(n.parent),
        cc = branchCorner(par, n),
        pp = P(par.key);
      const e = g
        .append('path')
        .attr('d', roundedL(pp.x, pp.y, cc.x, cc.y, N.x, N.y, CORNER))
        .attr('fill', 'none')
        .attr('stroke', c)
        .attr('stroke-width', LINE)
        .attr('stroke-linecap', 'round')
        .attr('data-branch', n.branch)
        .attr('opacity', o);
      if (n.ghost) e.attr('stroke-dasharray', EDGE_DASH);
    }
    if (n.mergeFrom != null) {
      const s = byKey(n.mergeFrom),
        cc = mergeCorner(s, n),
        sp = P(s.key);
      g.append('path')
        .attr('d', roundedL(sp.x, sp.y, cc.x, cc.y, N.x, N.y, CORNER))
        .attr('fill', 'none')
        .attr('stroke', colorOf(s))
        .attr('stroke-width', LINE)
        .attr('stroke-linecap', 'round')
        .attr('data-branch', s.branch)
        .attr('opacity', 0.92 * o);
    }
    if (n.cherryFrom != null)
      dlink(byKey(n.cherryFrom), n, colorOf(byKey(n.cherryFrom)), false);
    if (n.revertFrom != null) dlink(byKey(n.revertFrom), n, c, false);
    if (n.squashFrom != null)
      dlink(byKey(n.squashFrom), n, palette.textMuted, true);
    if (n.movedTo != null) dlink(n, byKey(n.movedTo), palette.textMuted, true);
  }

  // ── branch-name gutter ──
  if (!parsed.options.noLanes) {
    for (const b of parsed.branches) {
      let first: VCNode | null = null;
      for (const n of nodes)
        if (n.branch === b.name && (first === null || n.seq < first.seq))
          first = n;
      if (!first) continue;
      const fp = P(first.key);
      const col = colorOf(first);
      if (TB) {
        g.append('text')
          .attr('x', fp.x)
          .attr('y', 14)
          .attr('text-anchor', 'middle')
          .attr('font-size', 12.5)
          .attr('font-weight', 'bold')
          .attr('fill', col)
          .text(b.name);
      } else {
        // Inline above the lane, anchored at the branch's first commit.
        g.append('text')
          .attr('x', fp.x - DOT - 1)
          .attr('y', fp.y - DOT - 7)
          .attr('text-anchor', 'start')
          .attr('font-size', 12.5)
          .attr('font-weight', 'bold')
          .attr('fill', col)
          .attr('data-branch', b.name)
          .text(b.name);
      }
    }
  }
  void cross0;

  // ── nodes ──
  for (const n of nodes) {
    const c = colorOf(n);
    const N = P(n.key);
    const sel = <E extends d3Selection.BaseType>(
      el: d3Selection.Selection<E, unknown, null, undefined>
    ): void => {
      el.attr('data-line-number', n.lineNumber);
      // Branch key for baked-CSS cross-highlight (hover a commit → dim other
      // branches).
      el.attr('data-branch', n.branch);
      if (onClickItem)
        el.style('cursor', 'pointer').on('click', () =>
          onClickItem(n.lineNumber)
        );
    };
    if (n.ghost) {
      sel(
        g
          .append('circle')
          .attr('cx', N.x)
          .attr('cy', N.y)
          .attr('r', DOT - 1)
          .attr('fill', palette.bg)
          .attr('stroke', c)
          .attr('stroke-width', 2)
          .attr('opacity', 0.4)
      );
      continue;
    }
    if (n.type === 'highlight') {
      sel(
        g
          .append('rect')
          .attr('x', N.x - DOT)
          .attr('y', N.y - DOT)
          .attr('width', DOT * 2)
          .attr('height', DOT * 2)
          .attr('rx', 3.5)
          .attr('fill', c)
          .attr('stroke', palette.bg)
          .attr('stroke-width', 3)
      );
    } else if (n.type === 'reverse') {
      g.append('circle')
        .attr('cx', N.x)
        .attr('cy', N.y)
        .attr('r', DOT)
        .attr('fill', palette.bg)
        .attr('stroke', c)
        .attr('stroke-width', 3);
      sel(
        g
          .append('path')
          .attr(
            'd',
            `M${N.x - 3.6},${N.y - 3.6} L${N.x + 3.6},${N.y + 3.6} M${N.x + 3.6},${N.y - 3.6} L${N.x - 3.6},${N.y + 3.6}`
          )
          .attr('stroke', c)
          .attr('stroke-width', 2)
          .attr('stroke-linecap', 'round')
          .attr('fill', 'none')
      );
    } else if (n.kind === 'merge') {
      g.append('circle')
        .attr('cx', N.x)
        .attr('cy', N.y)
        .attr('r', DOT)
        .attr('fill', palette.bg)
        .attr('stroke', c)
        .attr('stroke-width', 3);
      sel(
        g
          .append('circle')
          .attr('cx', N.x)
          .attr('cy', N.y)
          .attr('r', 3)
          .attr('fill', c)
      );
    } else {
      sel(
        g
          .append('circle')
          .attr('cx', N.x)
          .attr('cy', N.y)
          .attr('r', DOT)
          .attr('fill', c)
          .attr('stroke', palette.bg)
          .attr('stroke-width', 3)
      );
    }
  }

  // ── leaders + labels + badges ──
  const pill = (
    cx: number,
    cy: number,
    w: number,
    text: string,
    fill: string,
    textColor: string,
    border?: string,
    dash?: boolean,
    weight = 'bold'
  ): void => {
    const r = g
      .append('rect')
      .attr('x', cx - w / 2)
      .attr('y', cy - 8.5)
      .attr('width', w)
      .attr('height', 17)
      .attr('rx', 8.5)
      .attr('fill', fill);
    if (border) {
      r.attr('stroke', border).attr('stroke-width', 1.3);
      if (dash) r.attr('stroke-dasharray', HAIRLINE_DASH);
    }
    g.append('text')
      .attr('x', cx)
      .attr('y', cy + 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', 10.5)
      .attr('font-weight', weight)
      .attr('fill', textColor)
      .text(text);
  };

  let shelfSeq = 0;
  for (const pl of placements) {
    const n = pl.node;
    const c = colorOf(n);
    if (pl.leader) {
      g.append('line')
        .attr('x1', pl.leader.x1)
        .attr('y1', pl.leader.y1)
        .attr('x2', pl.leader.x2)
        .attr('y2', pl.leader.y2)
        .attr('stroke', c)
        .attr('stroke-width', 1.5)
        .attr('stroke-linecap', 'round')
        .attr('data-branch', n.branch)
        .attr('opacity', 0.55 * gop(n));
    }
    if (pl.kind === 'tag') pill(pl.x, pl.y, pl.w!, pl.label!, c, palette.bg);
    else if (pl.kind === 'head')
      pill(
        pl.x,
        pl.y,
        pl.w!,
        'HEAD',
        palette.text,
        palette.bg,
        undefined,
        false,
        'bold'
      );
    else if (pl.kind === 'ref')
      pill(pl.x, pl.y, pl.w!, pl.label!, palette.bg, c, c, pl.remote);
    else if (pl.kind === 'note') {
      g.append('circle')
        .attr('cx', pl.x)
        .attr('cy', pl.y)
        .attr('r', 8.5)
        .attr('fill', c);
      g.append('text')
        .attr('x', pl.x)
        .attr('y', pl.y + 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', 11)
        .attr('fill', palette.bg)
        .text(pl.label!);
    } else if (pl.kind === 'ab') {
      g.append('text')
        .attr('x', pl.x)
        .attr('y', pl.y + 4)
        .attr('text-anchor', 'start')
        .attr('font-size', 11)
        .attr('font-weight', 'bold')
        .attr('fill', c)
        .text(pl.label!);
    } else {
      // message
      const L = label.get(n.key)!;
      const gh = n.ghost;
      const mfill = gh ? palette.textMuted : c;
      let tx = pl.x;
      let ty = pl.y + 4;
      let anchor = pl.anchor;
      if (pl.shelfW != null) {
        // LR: event-line no-box "shelf" — tag-tinted rounded rect + colored
        // spine-side lip, horizontal left-aligned text (no rotation).
        const left = pl.shelfLeft!;
        const top = pl.shelfTop!;
        const w = pl.shelfW;
        const clipId = `dgmo-vc-shelf-${shelfSeq++}`;
        g.append('clipPath')
          .attr('id', clipId)
          .append('rect')
          .attr('x', left)
          .attr('y', top)
          .attr('width', w)
          .attr('height', SHELF_H)
          .attr('rx', SHELF_EDGE);
        g.append('rect')
          .attr('x', left)
          .attr('y', top)
          .attr('width', w)
          .attr('height', SHELF_H)
          .attr('rx', SHELF_EDGE)
          .attr('fill', gh ? palette.bg : mix(c, palette.bg, SHELF_TINT))
          .attr('data-branch', n.branch)
          .attr('opacity', gh ? 0.5 : 1);
        // The lip faces the dot: on top for a shelf below the lane, on the
        // bottom for one above it.
        const above = pl.leader != null && pl.leader.y2 < pl.leader.y1;
        g.append('rect')
          .attr('x', left)
          .attr('y', above ? top + SHELF_H - SHELF_LIP : top)
          .attr('width', w)
          .attr('height', SHELF_LIP)
          .attr('clip-path', `url(#${clipId})`)
          .attr('fill', c)
          .attr('data-branch', n.branch)
          .attr('opacity', gh ? 0.4 : 1);
        tx = left + SHELF_PAD;
        ty = top + SHELF_H / 2 + 4;
        anchor = 'start';
      }
      const t = g
        .append('text')
        .attr('x', tx)
        .attr('y', ty)
        .attr('text-anchor', anchor)
        .attr('font-size', 12)
        .attr('data-branch', n.branch)
        .attr('opacity', gh ? 0.6 : 1);
      if (L.sha)
        t.append('tspan')
          .attr('font-family', 'ui-monospace, monospace')
          .attr('font-size', 11)
          .attr('fill', palette.textMuted)
          .text(L.sha + ' ');
      t.append('tspan')
        .attr('fill', mfill)
        .attr('font-weight', n.kind === 'cherry' ? 'normal' : 'bold')
        .attr('font-style', n.kind === 'cherry' ? 'italic' : 'normal')
        .text(L.msg);
    }
  }

  // ── note captions ──
  if (captionY && parsed.notes.length) {
    let y = captionY + 14;
    for (const nt of parsed.notes) {
      const t = g
        .append('text')
        .attr('x', 12)
        .attr('y', y)
        .attr('font-size', 11.5);
      t.append('tspan')
        .attr('fill', palette.text)
        .attr('font-weight', 'bold')
        .text((CIRCLED[nt.num - 1] ?? `#${nt.num}`) + '  ');
      t.append('tspan').attr('fill', palette.textMuted).text(nt.text);
      y += 16;
    }
  }
}

export function renderVersionControlForExport(
  container: HTMLDivElement,
  parsed: ParsedVersionControl,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions
): void {
  renderVersionControl(
    container,
    parsed,
    palette,
    isDark,
    undefined,
    exportDims
  );
}
