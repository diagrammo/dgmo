// ============================================================
// Version-Control — D3 SVG Renderer (spec §29)
// ============================================================
//
// "Metro map" lanes: thick rounded colored branch lines, big commit dots,
// rounded right-angle elbow connectors, ref-pill badges, and diagonal commit
// labels (LR) / a right-hand column (TB). Ghost commits (faded/dashed) are the
// shared primitive behind rebase/reset/squash. Ports
// docs/version-control-syntax-mockups.html build()/draw().

import * as d3Selection from 'd3-selection';
import { FONT_FAMILY } from '../fonts';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { getSeriesColors } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import type { ParsedVersionControl, VCBranch, VCNode } from './types';

type Sel = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

const LINE = 5.5;
const DOT = 8;
const CORNER = 13;
const ANG = 32;
const STACK = 19;
const CIRCLED = '①②③④⑤⑥⑦⑧⑨';
const TITLE_AREA = 40;

interface Badge {
  kind: 'tag' | 'ref' | 'head' | 'note';
  label: string;
  w: number;
  remote?: boolean;
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
  diag?: boolean | undefined;
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
  let contentW: number,
    contentH: number,
    gutter: number,
    cross0: number,
    captionY = 0;
  const cos = Math.cos((ANG * Math.PI) / 180);
  const sin = Math.sin((ANG * Math.PI) / 180);

  if (!TB) {
    const maxName = Math.max(4, ...parsed.branches.map((b) => b.name.length));
    gutter = maxName * 7.5 + 18;
    const along0 = gutter + 34,
      step = 86,
      laneGap = 54;
    cross0 = 16 + maxStack * STACK + 14;
    for (const n of nodes)
      pos.set(n.key, {
        x: along0 + n.seq * step,
        y: cross0 + n.lane * laneGap,
      });
    const lanesBottom = cross0 + (laneCount - 1) * laneGap;
    const bandY = lanesBottom + 26;
    for (const n of nodes) {
      const p = pos.get(n.key)!;
      placements.push({
        node: n,
        kind: 'msg',
        diag: true,
        x: p.x,
        y: bandY,
        anchor: 'start',
        leader: { x1: p.x, y1: p.y + DOT, x2: p.x, y2: bandY - 3 },
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
        along0 + (K - 1) * step + DOT + 70,
        ...[...pos.entries()].map(([k, p]) => p.x + label.get(k)!.lw * cos)
      ) + 18;
    // +12 descender projection (label baseline rotated by ANG) + breathing room
    contentH = bandY + maxLW * sin + 12 * cos + 16;
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
        diag: false,
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
  const W = Math.round(contentW);
  const H = Math.round(contentH + titleH);

  const exportMode = !!exportDims;
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', W)
    .attr('height', H)
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
      .text(parsed.title!);
    if (onClickItem && parsed.titleLineNumber && !exportMode) {
      const ln = parsed.titleLineNumber;
      t.style('cursor', 'pointer').on('click', () => onClickItem(ln));
    }
  }

  const g = svg.append('g').attr('transform', `translate(0, ${titleH})`) as Sel;
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
    gutter,
    cross0,
    captionY,
    onClickItem && !exportMode ? onClickItem : undefined
  );
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
  gutter: number,
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
      .attr('stroke-dasharray', '2 4')
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
        .attr('opacity', o);
      if (n.ghost) e.attr('stroke-dasharray', '5 5');
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
        .attr('opacity', o);
      if (n.ghost) e.attr('stroke-dasharray', '5 5');
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
          .attr('font-weight', 800)
          .attr('fill', col)
          .text(b.name);
      } else {
        g.append('text')
          .attr('x', gutter)
          .attr('y', fp.y + 4)
          .attr('text-anchor', 'end')
          .attr('font-size', 12.5)
          .attr('font-weight', 800)
          .attr('fill', col)
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
    weight = 700
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
      if (dash) r.attr('stroke-dasharray', '3 2');
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
        .attr('stroke-width', 1)
        .attr('opacity', 0.34 * gop(n));
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
        800
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
        .attr('font-weight', 700)
        .attr('fill', c)
        .text(pl.label!);
    } else {
      // message
      const L = label.get(n.key)!;
      const gh = n.ghost;
      const mfill = gh ? palette.textMuted : c;
      const t = pl.diag
        ? g
            .append('text')
            .attr('transform', `translate(${pl.x},${pl.y}) rotate(${ANG})`)
            .attr('font-size', 12)
            .attr('opacity', gh ? 0.55 : 1)
        : g
            .append('text')
            .attr('x', pl.x)
            .attr('y', pl.y + 4)
            .attr('text-anchor', pl.anchor)
            .attr('font-size', 12)
            .attr('opacity', gh ? 0.55 : 1);
      if (L.sha)
        t.append('tspan')
          .attr('font-family', 'ui-monospace, monospace')
          .attr('font-size', 11)
          .attr('fill', palette.textMuted)
          .text(L.sha + ' ');
      t.append('tspan')
        .attr('fill', mfill)
        .attr('font-weight', n.kind === 'cherry' ? 400 : 700)
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
        .attr('font-weight', 800)
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
