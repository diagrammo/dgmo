// ============================================================
// Hand-built sankey renderer — SPIKE (Tier 3).
// Layered layout (longest-path ranking + barycenter ordering) + value-scaled
// ribbon links. The only Tier-3 type needing a real layout algorithm; a
// production migration could swap this core for d3-sankey.
// ECharts house style: node tint mix(c,bg,75), link tint mix(c,bg,45) @0.6.
// ============================================================

import type { PaletteColors } from '../palettes/types';
import type { ParsedSankey } from '../data-chart-parser';
import type { SankeyAlluvial } from './alluvial-parse';
import { FONT_FAMILY } from '../fonts';
import { mix } from '../palettes/color-utils';
import {
  measureText,
  truncateText,
  wrapTextToWidth,
} from '../utils/text-measure';
import { type Svg, chartFormatter, tagDatum } from './shared';
import {
  EMPHASIS_DIM_OPACITY,
  EMPHASIS_DIM_TEXT_OPACITY,
  parseHighlightChain,
  resolveEmphasis,
  resolveHighlightPaths,
  storyPaint,
} from '../utils/emphasis';
import type { ResolvedEmphasis } from '../utils/emphasis';

const NODE_W = 20;
const NODE_GAP = 14;
/** Vertical gap between return-ribbon lanes under the chart. */
const LOOP_GAP = 8;
/** How far a return ribbon's bend reaches past its node, in thicknesses. */
const LOOP_BEND = 1.25;
const LABEL_FONT = 13;
const LABEL_PAD = 6;
/**
 * A node name wraps at word breaks (#1947) into lines this far apart; each
 * column's names are stacked clear of each other by `stackLabels`.
 */
const LABEL_LINE_H = 16;
/** Space between two stacked names, so one name never reads as the next's. */
const LABEL_BLOCK_GAP = 6;
/** Most of the width the last column's labels may take as a right margin. */
const MAX_LABEL_MARGIN = 0.4;
/** Baseline ribbon translucency — dimming MULTIPLIES this, never replaces it. */
const RIBBON_FILL_OPACITY = 0.6;

interface SNode {
  name: string;
  rank: number;
  value: number;
  /** The node's throughput as written — `value` before its 1-unit floor. */
  flow: number;
  order: number;
  x: number;
  y: number;
  h: number;
  raw: string;
  /** A pass-through slot for a link that skips this column; never drawn. */
  virtual?: boolean;
}

/** One column-to-column hop of a forward link. */
interface Seg {
  s: SNode;
  t: SNode;
  value: number;
  sy: number;
  ty: number;
}

export function renderSankey(
  svg: Svg,
  chart: ParsedSankey,
  width: number,
  height: number,
  colors: string[],
  bgColor: string,
  textColor: string,
  topInset: number,
  palette: PaletteColors,
  isDark: boolean
): void {
  if (chart.alluvial) {
    renderAlluvial(
      svg,
      chart,
      chart.alluvial,
      width,
      height,
      colors,
      bgColor,
      textColor,
      topInset,
      palette
    );
    return;
  }
  const links = chart.links ?? [];
  if (links.length === 0) return;
  // Ribbons ARE the data surface — fill-outline ignored (§1.9).
  const solid = chart.fillMode === 'solid';
  // Each node's label carries its throughput (#1837): the larger of what flows
  // in and what flows out, through the chart's own number format. `no-value`
  // takes it off. The value is never truncated — the name gives way first.
  // Under `format compact` every value prints in one unit (#2036).
  const fmt = chartFormatter(
    chart,
    links.map((l) => l.value)
  );
  const valueText = (n: SNode): string =>
    chart.noValue ? '' : ` ${fmt(n.flow)}`;
  const valueW = (n: SNode): number =>
    chart.noValue ? 0 : measureText(valueText(n), LABEL_FONT, { bold: true });

  const names = Array.from(new Set(links.flatMap((l) => [l.source, l.target])));

  // §1.11 emphasis. Resolved against the derived node names — sankey has no
  // node declaration list, so the names an author writes in `dim`/`highlight`
  // are matched against whatever the links actually mention.
  //
  // `highlight` lights the FLOW CLOSURE of the named nodes: everything
  // upstream that feeds them plus everything downstream they feed. This is the
  // sankey analogue of the family chart's bloodline (focus + ancestors +
  // descendants) — "where does this come from and where does it go" is the
  // question a sankey exists to answer, so highlighting a node without its
  // path would dim the very flows that explain it.
  // Upstream and downstream are walked SEPARATELY and unioned — never
  // alternated. A single bidirectional walk leaks sideways (up to a shared
  // source, then back down into an unrelated sibling) and ends up lighting the
  // entire connected component, which is the same trap family avoids by taking
  // ancestors and descendants as distinct sets.
  const walk = (seeds: ReadonlySet<string>, up: boolean): Set<string> => {
    const seen = new Set(seeds);
    for (let pass = 0; pass < names.length; pass++) {
      let grew = false;
      for (const l of links) {
        const from = up ? l.target : l.source;
        const to = up ? l.source : l.target;
        if (seen.has(from) && !seen.has(to)) {
          seen.add(to);
          grew = true;
        }
      }
      if (!grew) break;
    }
    return seen;
  };
  const flowClosure = (seeds: ReadonlySet<string>): Set<string> =>
    new Set([...walk(seeds, true), ...walk(seeds, false)]);
  // An arrow chain (#2041) names flows exactly: `highlight Paid Ads ->
  // Landing Page -> Sign Up` lights those two ribbons and nothing else.
  const paths = resolveHighlightPaths(
    chart.emphasis,
    names,
    links.map((l) => ({ from: l.source, to: l.target })),
    flowClosure
  );
  const chained =
    paths.active &&
    chart.emphasis?.names.some((n) => parseHighlightChain(n) !== null) === true;
  const emphasis: ResolvedEmphasis = chained
    ? {
        dimmed: new Set(names.filter((n) => !paths.litNodes.has(n))),
        unknown: paths.unknown,
        kind: 'highlight',
        ...(paths.color !== undefined && { color: paths.color }),
      }
    : resolveEmphasis(chart.emphasis, names, flowClosure);
  const { dimmed } = emphasis;
  const linkIndex = new Map(links.map((l, i) => [l, i]));
  // Story view (#2046): lit flows and nodes solid, the rest one grey ground.
  const story = storyPaint(emphasis, palette, isDark);
  // A flow is figure only when BOTH endpoints are figure: a ribbon landing in a
  // receded node is itself part of the background story. Same rule family uses
  // for marriage bars (lit only when both partners are lit).
  const linkDimmed = (l: { source: string; target: string }) =>
    chained
      ? !paths.litEdges.has(linkIndex.get(l as (typeof links)[number]) ?? -1)
      : dimmed.has(l.source) || dimmed.has(l.target);
  const node = new Map<string, SNode>();
  names.forEach((name, i) =>
    node.set(name, {
      name,
      rank: 0,
      value: 0,
      flow: 0,
      order: i,
      x: 0,
      y: 0,
      h: 0,
      raw: chart.nodeColors?.[name] ?? colors[i % colors.length]!,
    })
  );

  // Back edges. Authors write cycles (an issue bouncing between two statuses
  // twice), and longest-path ranking never converges on one: each pass pushes
  // the loop a column further right, so the loop's nodes inflated maxRank and
  // crushed every real column into the left of the chart (#1218). A DFS from
  // the true sources marks each edge that closes a loop; ranking and ordering
  // ignore those, and they are drawn as return ribbons under the chart.
  const outgoing = new Map<string, typeof links>();
  for (const l of links) {
    const list = outgoing.get(l.source) ?? [];
    list.push(l);
    outgoing.set(l.source, list);
  }
  const backEdges = new Set<(typeof links)[number]>();
  const visitState = new Map<string, 'open' | 'done'>();
  const visit = (name: string): void => {
    visitState.set(name, 'open');
    for (const l of outgoing.get(name) ?? []) {
      const st = visitState.get(l.target);
      if (st === 'open') backEdges.add(l);
      else if (st === undefined) visit(l.target);
    }
    visitState.set(name, 'done');
  };
  const hasIncoming = new Set(links.map((l) => l.target));
  for (const name of names) if (!hasIncoming.has(name)) visit(name);
  // a component that is all cycle has no source; enter it at its first name
  for (const name of names) if (!visitState.has(name)) visit(name);
  const forwardLinks = links.filter((l) => !backEdges.has(l));
  const backLinks = links.filter((l) => backEdges.has(l));

  // longest-path ranking
  for (let pass = 0; pass < names.length; pass++) {
    let changed = false;
    for (const l of forwardLinks) {
      const s = node.get(l.source)!;
      const t = node.get(l.target)!;
      if (t.rank < s.rank + 1) {
        t.rank = s.rank + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // node value = max(sum in, sum out)
  for (const n of node.values()) {
    const out = links
      .filter((l) => l.source === n.name)
      .reduce((a, l) => a + l.value, 0);
    const inc = links
      .filter((l) => l.target === n.name)
      .reduce((a, l) => a + l.value, 0);
    n.flow = Math.max(out, inc);
    n.value = Math.max(n.flow, 1);
  }

  const maxRank = Math.max(...[...node.values()].map((n) => n.rank));
  const layers: SNode[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of node.values()) layers[n.rank]!.push(n);

  // A link that skips columns used to be one curve from source to target, and
  // nothing reserved its path, so it ran through the nodes of every column it
  // crossed (#1317). It now hops column to column through a virtual node per
  // crossed column. The virtual node takes room and joins the ordering sweeps
  // like a real one, so real nodes move out of the band's way.
  const segs: Seg[] = [];
  const chains = new Map<(typeof links)[number], Seg[]>();
  for (const l of forwardLinks) {
    const t = node.get(l.target)!;
    let prev = node.get(l.source)!;
    const chain: Seg[] = [];
    for (let r = prev.rank + 1; r <= t.rank; r++) {
      let next = t;
      if (r < t.rank) {
        next = {
          name: `${l.source}␟${l.target}␟${r}`,
          rank: r,
          value: l.value,
          flow: l.value,
          order: prev.order,
          x: 0,
          y: 0,
          h: 0,
          raw: prev.raw,
          virtual: true,
        };
        layers[r]!.push(next);
      }
      const seg: Seg = { s: prev, t: next, value: l.value, sy: 0, ty: 0 };
      chain.push(seg);
      segs.push(seg);
      prev = next;
    }
    chains.set(l, chain);
  }

  let plotLeft = 16;
  const top = topInset + 8;
  const rightPad = 16;
  let plotH = height - top - 24;

  // global value scale so the busiest layer fits
  const fitScale = (h: number): number => {
    let scale = Infinity;
    for (const layer of layers) {
      const tot = layer.reduce((a, n) => a + n.value, 0);
      const avail = h - (layer.length - 1) * NODE_GAP;
      if (tot > 0) scale = Math.min(scale, avail / tot);
    }
    return isFinite(scale) && scale > 0 ? scale : 1;
  };
  let valueScale = fitScale(plotH);
  // Return ribbons run in lanes under the nodes; take their room from plotH.
  if (backLinks.length > 0) {
    const backTotal = backLinks.reduce((a, l) => a + l.value, 0);
    const reserve = backTotal * valueScale + LOOP_GAP * (backLinks.length + 1);
    plotH = Math.max(plotH * 0.5, plotH - reserve);
    valueScale = fitScale(plotH);
  }

  // A return ribbon bends outside its node by LOOP_BEND × its thickness.
  // Entering the first column, that bend needs a left margin; leaving any
  // node, it pushes that node's label further right.
  const bend = new Map<string, number>();
  let leftBend = 0;
  for (const l of backLinks) {
    const over = l.value * valueScale * LOOP_BEND;
    bend.set(l.source, Math.max(bend.get(l.source) ?? 0, over));
    if (node.get(l.target)!.rank === 0) leftBend = Math.max(leftBend, over);
  }
  plotLeft += leftBend;
  const labelOffset = (n: SNode) =>
    NODE_W + (bend.get(n.name) ?? 0) + LABEL_PAD;

  // Every label sits to the RIGHT of its node (#1087). The last column's used
  // to point left, into the same gap as the column before it, and nothing
  // measured one against the other. The right margin now holds the last
  // column's labels, capped at MAX_LABEL_MARGIN of the width; a label longer
  // than its room is truncated below.
  let labelMargin = 0;
  for (const n of layers[maxRank]!) {
    labelMargin = Math.max(
      labelMargin,
      labelOffset(n) - NODE_W + measureText(n.name, LABEL_FONT) + valueW(n)
    );
  }
  labelMargin = Math.min(labelMargin, width * MAX_LABEL_MARGIN);
  const plotW = Math.max(NODE_W, width - plotLeft - rightPad - labelMargin);

  const layerX = (r: number) =>
    plotLeft + (maxRank === 0 ? 0 : (r * (plotW - NODE_W)) / maxRank);

  const placeLayer = (layer: SNode[]) => {
    layer.sort((a, b) => a.order - b.order);
    const totH =
      layer.reduce((a, n) => a + n.value * valueScale, 0) +
      (layer.length - 1) * NODE_GAP;
    let y = top + (plotH - totH) / 2;
    for (const n of layer) {
      n.h = n.value * valueScale;
      n.x = layerX(n.rank);
      n.y = y;
      y += n.h + NODE_GAP;
    }
  };
  layers.forEach(placeLayer);

  // barycenter ordering sweeps to reduce crossings
  const center = (n: SNode) => n.y + n.h / 2;
  for (let iter = 0; iter < 6; iter++) {
    const forward = iter % 2 === 0;
    const order = forward ? [...layers.keys()] : [...layers.keys()].reverse();
    for (const r of order) {
      for (const n of layers[r]!) {
        const neigh = forward
          ? segs.filter((g) => g.t === n).map((g) => g.s)
          : segs.filter((g) => g.s === n).map((g) => g.t);
        n.order = neigh.length
          ? neigh.reduce((a, m) => a + center(m), 0) / neigh.length
          : center(n);
      }
      placeLayer(layers[r]!);
    }
  }

  // link vertical slots: stack outgoing at source right, incoming at target left
  const outOff = new Map<SNode, number>();
  const inOff = new Map<SNode, number>();
  for (const layer of layers) {
    for (const n of layer) {
      outOff.set(n, n.y);
      inOff.set(n, n.y);
    }
  }
  const slot = (n: SNode, th: number, off: Map<SNode, number>): number => {
    const y = off.get(n)!;
    off.set(n, y + th);
    return y;
  };
  // Hops by source y then target y, so each node's outgoing bands stack in
  // the order of where they go and its incoming in the order they came from.
  // Back edges go after, so they leave and enter at the bottom of each node,
  // nearest the lane they run in.
  for (const g of [...segs].sort((a, b) =>
    a.s.y !== b.s.y ? a.s.y - b.s.y : a.t.y - b.t.y
  )) {
    const th = g.value * valueScale;
    g.sy = slot(g.s, th, outOff);
    g.ty = slot(g.t, th, inOff);
  }
  const ordered = [
    ...[...forwardLinks].sort((a, b) => {
      const sa = node.get(a.source)!;
      const sb = node.get(b.source)!;
      if (sa.y !== sb.y) return sa.y - sb.y;
      return node.get(a.target)!.y - node.get(b.target)!.y;
    }),
    ...backLinks,
  ];
  let laneY = top + plotH + LOOP_GAP;

  for (const l of ordered) {
    const s = node.get(l.source)!;
    const t = node.get(l.target)!;
    const th = l.value * valueScale;
    const sx = s.x + NODE_W;
    const tx = t.x;
    const raw = l.color ?? s.raw;
    const color = !story.active
      ? solid
        ? raw
        : mix(raw, bgColor, 45)
      : linkDimmed(l)
        ? story.groundStroke
        : story.subject(raw);
    // Story view bakes the grey into the paint; only `dim` uses opacity.
    const opacity =
      linkDimmed(l) && !story.active
        ? RIBBON_FILL_OPACITY * EMPHASIS_DIM_OPACITY
        : RIBBON_FILL_OPACITY;
    let ribbon;
    if (backEdges.has(l)) {
      const sy = slot(s, th, outOff);
      const ty = slot(t, th, inOff);
      // Return ribbon: out of the source's right side, down into its own lane
      // under the chart, back left, and up into the target's left side.
      // Stroked at the flow's thickness so the bends keep a constant width.
      const lane = laneY + th / 2;
      laneY += th + LOOP_GAP;
      // control offset k bulges the bend 0.75k; plus half the stroke this is
      // LOOP_BEND × th, which the margins above reserved
      const k = th;
      const y1 = sy + th / 2;
      const y2 = ty + th / 2;
      ribbon = svg
        .append('path')
        .attr(
          'd',
          `M${sx},${y1} C${sx + k},${y1} ${sx + k},${lane} ${sx},${lane} ` +
            `L${tx},${lane} C${tx - k},${lane} ${tx - k},${y2} ${tx},${y2}`
        )
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', th)
        .attr('stroke-opacity', opacity);
    } else {
      // Top edge left to right through every hop, straight across each
      // virtual node, then the bottom edge back.
      const chain = chains.get(l)!;
      const top: string[] = [];
      const bottom: string[] = [];
      chain.forEach((g, i) => {
        const gx = g.s.x + NODE_W;
        const cx = (gx + g.t.x) / 2;
        top.push(
          `${i === 0 ? 'M' : 'L'}${gx},${g.sy} C${cx},${g.sy} ${cx},${g.ty} ${g.t.x},${g.ty}`
        );
        bottom.unshift(
          `L${g.t.x},${g.ty + th} C${cx},${g.ty + th} ${cx},${g.sy + th} ${gx},${g.sy + th}`
        );
      });
      ribbon = svg
        .append('path')
        .attr('d', `${top.join(' ')} ${bottom.join(' ')} Z`)
        .attr('fill', color)
        .attr('fill-opacity', opacity);
    }
    tagDatum(ribbon, {
      line: l.lineNumber,
      // U+241F (symbol-for-unit-separator) — collision-proof AND XML-legal;
      // a raw control char here corrupts the exported SVG (data-emph-key).
      key: `link:${s.name}␟${t.name}`,
      name: `${s.name} → ${t.name}`,
      value: String(l.value),
      color: s.raw,
    });
  }

  const labelRoom = (n: SNode) =>
    (n.rank === maxRank ? width - rightPad / 2 : layerX(n.rank + 1)) -
    LABEL_PAD -
    (n.x + labelOffset(n));

  // Each real node's label lines and where its block starts (LABEL_LINE_H).
  const placed = new Map<
    SNode,
    { lines: string[]; y0: number; cut: boolean }
  >();
  for (let r = 0; r <= maxRank; r++) {
    const col = [...node.values()]
      .filter((n) => n.rank === r)
      .sort((a, b) => a.y - b.y);
    const blocks = stackLabels(
      col.map((n) => ({
        name: n.name,
        width: labelRoom(n) - valueW(n),
        center: n.y + n.h / 2,
      })),
      top,
      top + plotH
    );
    col.forEach((n, i) => placed.set(n, blocks[i]!));
  }

  // nodes + labels
  for (const n of node.values()) {
    const nodeLine = links.find(
      (l) => l.source === n.name || l.target === n.name
    )?.lineNumber;
    const recede = dimmed.has(n.name);
    const nodeDim = recede && !story.active;
    const lit = story.subject(n.raw);
    const nr = svg
      .append('rect')
      .attr('x', n.x)
      .attr('y', n.y)
      .attr('width', NODE_W)
      .attr('height', Math.max(1, n.h))
      .attr(
        'fill',
        !story.active
          ? solid
            ? n.raw
            : mix(n.raw, bgColor, 75)
          : recede
            ? story.groundFill
            : lit
      )
      .attr('stroke', !story.active ? n.raw : recede ? story.groundStroke : lit)
      .attr('stroke-width', 1);
    // Baked attribute, not a class or a color swap: hue survives (a receded
    // brand-red flow is still red) and the SVG needs no CSS or JS to export.
    if (nodeDim) nr.attr('opacity', EMPHASIS_DIM_OPACITY);
    tagDatum(nr, {
      ...(nodeLine !== undefined && { line: nodeLine }),
      key: `node:${n.name}`,
      name: n.name,
      value: String(n.value),
      color: n.raw,
    });
    // A label may run to the next column's nodes, or to the right edge.
    const labelX = n.x + labelOffset(n);
    const fit = placed.get(n)!;
    const k = fit.lines.length;
    const label = svg
      .append('text')
      .attr('x', labelX)
      .attr('y', fit.y0 + LABEL_LINE_H / 2 + 4)
      .attr('text-anchor', 'start')
      .attr('fill', story.active && recede ? story.groundText : textColor)
      .attr('font-size', LABEL_FONT)
      .attr('font-family', FONT_FAMILY);
    if (k === 1) label.text(fit.lines[0]!);
    else {
      fit.lines.forEach((line, j) => {
        const span = label.append('tspan').text(line);
        if (j > 0) span.attr('x', labelX).attr('dy', LABEL_LINE_H);
      });
    }
    if (!chart.noValue) {
      label.append('tspan').attr('font-weight', 'bold').text(valueText(n));
    }
    if (fit.cut) label.append('title').text(n.name);
    if (nodeDim) label.attr('opacity', EMPHASIS_DIM_TEXT_OPACITY);
  }
}

/**
 * One column's node names, wrapped at word breaks and stacked so no two
 * blocks overlap (#1947). Each block starts centred on its node and moves
 * the least it must to clear its neighbours, inside [lo, hi]. When the
 * column cannot hold every line, the tallest blocks give up lines first, and
 * only a block's last kept line is cut with "…". A single word wider than
 * its room is cut on its own line.
 */
function stackLabels(
  items: { name: string; width: number; center: number }[],
  lo: number,
  hi: number
): { lines: string[]; y0: number; cut: boolean }[] {
  const full = items.map((it) =>
    it.width > 0 ? wrapTextToWidth(it.name, LABEL_FONT, it.width) : [it.name]
  );
  const k = full.map((l) => l.length);
  const room = hi - lo - (items.length - 1) * LABEL_BLOCK_GAP;
  const cap = Math.max(items.length, Math.floor(room / LABEL_LINE_H));
  let total = k.reduce((a, b) => a + b, 0);
  while (total > cap) {
    let at = 0;
    for (let i = 1; i < k.length; i++) if (k[i]! > k[at]!) at = i;
    if (k[at]! <= 1) break;
    k[at]!--;
    total--;
  }
  const out = items.map((it, i) => {
    let lines = full[i]!;
    let cut = false;
    if (lines.length > k[i]!) {
      lines = [...lines.slice(0, k[i]! - 1), lines.slice(k[i]! - 1).join(' ')];
      cut = true;
    }
    lines = lines.map((l) => {
      const shown = truncateText(l, LABEL_FONT, it.width);
      if (shown !== l) cut = true;
      return shown;
    });
    return { lines, y0: it.center - (lines.length * LABEL_LINE_H) / 2, cut };
  });
  // Push down past the block above, then back up from the bottom edge. A
  // column too short for one line each keeps every label on its node.
  if (items.length * LABEL_LINE_H > room) return out;
  for (let i = 0; i < out.length; i++) {
    const floor =
      i === 0
        ? lo
        : out[i - 1]!.y0 +
          out[i - 1]!.lines.length * LABEL_LINE_H +
          LABEL_BLOCK_GAP;
    out[i]!.y0 = Math.max(out[i]!.y0, floor);
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const h = out[i]!.lines.length * LABEL_LINE_H;
    const ceil = i === out.length - 1 ? hi : out[i + 1]!.y0 - LABEL_BLOCK_GAP;
    out[i]!.y0 = Math.max(lo, Math.min(out[i]!.y0, ceil - h));
  }
  return out;
}

/** Period header row above the alluvial columns. */
const PERIOD_FONT = 12;
const PERIOD_ROW_H = 22;
/** Most of the width the first or last column's labels may take. */
const MAX_SIDE_MARGIN = 0.25;
/** Room past the widest measured label, so it is never cut at the edge. */
const LABEL_SLACK = 6;
/** Space between a node's name and its bold value. */
const VALUE_GAP = 4;

/**
 * Alluvial mode (#1858): one column per period, the same categories in the
 * same order in every column, and bands between consecutive columns. A band
 * keeps the colour of its first-column category (its cohort) all the way
 * across; a node bar takes its own category's colour. Within a node, the
 * bands leave in destination order, then cohort order, and arrive in source
 * order, then cohort order, so crossings stay low.
 */
function renderAlluvial(
  svg: Svg,
  chart: ParsedSankey,
  flows: SankeyAlluvial,
  width: number,
  height: number,
  colors: string[],
  bgColor: string,
  textColor: string,
  topInset: number,
  palette: PaletteColors
): void {
  const { periods, categories, paths } = flows;
  if (paths.length === 0 || periods.length < 2) return;
  const solid = chart.fillMode === 'solid';
  const P = periods.length;
  const order = new Map(categories.map((c, i) => [c, i]));
  const colorOf = (c: string): string =>
    chart.nodeColors?.[c] ?? colors[order.get(c)! % colors.length]!;
  const fmt = chartFormatter(
    chart,
    paths.map((p) => p.value)
  );

  // Node totals, and the first row naming each node (click-to-source).
  const total: Map<string, number>[] = periods.map(() => new Map());
  const nodeLine: Map<string, number>[] = periods.map(() => new Map());
  for (const p of paths) {
    p.steps.forEach((c, j) => {
      total[j]!.set(c, (total[j]!.get(c) ?? 0) + p.value);
      if (!nodeLine[j]!.has(c)) nodeLine[j]!.set(c, p.lineNumber);
    });
  }
  const colTotal = total.map((m) => [...m.values()].reduce((a, v) => a + v, 0));
  const cols = total.map((m) => categories.filter((c) => (m.get(c) ?? 0) > 0));

  const valueText = (v: number): string => (chart.noValue ? '' : ` ${fmt(v)}`);
  const labelW = (c: string, v: number): number =>
    measureText(c, LABEL_FONT) +
    (chart.noValue ? 0 : measureText(valueText(v), LABEL_FONT, { bold: true }));
  const sideMargin = (j: number): number =>
    Math.min(
      width * MAX_SIDE_MARGIN,
      Math.max(0, ...cols[j]!.map((c) => labelW(c, total[j]!.get(c)!))) +
        LABEL_PAD +
        LABEL_SLACK
    );
  const plotLeft = 16 + sideMargin(0);
  const plotRight = width - 16 - sideMargin(P - 1);
  const plotW = Math.max(NODE_W * P, plotRight - plotLeft);
  const colX = (j: number): number =>
    plotLeft + (j * (plotW - NODE_W)) / (P - 1);

  const headerY = topInset + 8 + PERIOD_FONT;
  const top = topInset + 8 + PERIOD_ROW_H;
  const plotH = Math.max(40, height - top - 24);
  let valueScale = Infinity;
  cols.forEach((col, j) => {
    const avail = plotH - (col.length - 1) * NODE_GAP;
    if (colTotal[j]! > 0)
      valueScale = Math.min(valueScale, avail / colTotal[j]!);
  });
  if (!isFinite(valueScale) || valueScale <= 0) valueScale = 1;

  // Node boxes, top-aligned so a category sits at the same height in turn.
  interface ANode {
    x: number;
    y: number;
    h: number;
    out: number;
    in: number;
  }
  const nodes: Map<string, ANode>[] = cols.map((col, j) => {
    const m = new Map<string, ANode>();
    let y = top;
    for (const c of col) {
      const h = total[j]!.get(c)! * valueScale;
      m.set(c, { x: colX(j), y, h, out: y, in: y });
      y += h + NODE_GAP;
    }
    return m;
  });

  // Bands per hop: one per (cohort, source, destination).
  for (let j = 0; j < P - 1; j++) {
    const bands = new Map<
      string,
      { cohort: string; s: string; t: string; value: number; line: number }
    >();
    for (const p of paths) {
      const cohort = p.steps[0]!;
      const s = p.steps[j]!;
      const t = p.steps[j + 1]!;
      const k = `${cohort}␟${s}␟${t}`;
      const b = bands.get(k);
      if (b) b.value += p.value;
      else bands.set(k, { cohort, s, t, value: p.value, line: p.lineNumber });
    }
    const list = [...bands.values()];
    const o = (c: string) => order.get(c)!;
    const sy = new Map<(typeof list)[number], number>();
    const ty = new Map<(typeof list)[number], number>();
    for (const b of [...list].sort(
      (a, b) => o(a.s) - o(b.s) || o(a.t) - o(b.t) || o(a.cohort) - o(b.cohort)
    )) {
      const n = nodes[j]!.get(b.s)!;
      sy.set(b, n.out);
      n.out += b.value * valueScale;
    }
    for (const b of [...list].sort(
      (a, b) => o(a.t) - o(b.t) || o(a.s) - o(b.s) || o(a.cohort) - o(b.cohort)
    )) {
      const n = nodes[j + 1]!.get(b.t)!;
      ty.set(b, n.in);
      n.in += b.value * valueScale;
    }
    const x0 = colX(j) + NODE_W;
    const x1 = colX(j + 1);
    const cx = (x0 + x1) / 2;
    for (const b of list) {
      const th = b.value * valueScale;
      const y0 = sy.get(b)!;
      const y1 = ty.get(b)!;
      const raw = colorOf(b.cohort);
      const ribbon = svg
        .append('path')
        .attr(
          'd',
          `M${x0},${y0} C${cx},${y0} ${cx},${y1} ${x1},${y1} ` +
            `L${x1},${y1 + th} C${cx},${y1 + th} ${cx},${y0 + th} ${x0},${y0 + th} Z`
        )
        .attr('fill', solid ? raw : mix(raw, bgColor, 45))
        .attr('fill-opacity', RIBBON_FILL_OPACITY);
      // Hovering a band lights its whole cohort and reads out this step.
      const mid = (y0 + y1) / 2 + th / 2;
      tagDatum(ribbon, {
        line: b.line,
        key: `cohort:${b.cohort}`,
        name: `${b.s} → ${b.t}`,
        value: String(b.value),
        color: raw,
      })
        .attr('data-size', fmt(b.value))
        .attr(
          'data-size-label',
          `${b.cohort} cohort · ${periods[j]} ${b.s} → ${periods[j + 1]} ${b.t}`
        )
        .attr('data-sizeval-x', cx)
        .attr('data-sizeval-y', mid - 2)
        .attr('data-sizeval-ly', mid + 13)
        .attr('data-sizeval-anchor', 'middle');
    }
  }

  // Period headers, nodes and labels.
  for (let j = 0; j < P; j++) {
    svg
      .append('text')
      .attr('x', colX(j) + NODE_W / 2)
      .attr('y', headerY)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.textMuted)
      .attr('font-size', PERIOD_FONT)
      .attr('font-weight', 'bold')
      .attr('font-family', FONT_FAMILY)
      .text(periods[j]!);
    const first = j === 0;
    // Labels sit left of the first column and right of every other one.
    const room = first
      ? plotLeft - 16 - LABEL_PAD
      : j === P - 1
        ? width - 16 - (colX(j) + NODE_W + LABEL_PAD)
        : colX(j + 1) - (colX(j) + NODE_W) - 2 * LABEL_PAD;
    for (const [c, n] of nodes[j]!) {
      const raw = colorOf(c);
      const v = total[j]!.get(c)!;
      const rect = svg
        .append('rect')
        .attr('x', n.x)
        .attr('y', n.y)
        .attr('width', NODE_W)
        .attr('height', Math.max(1, n.h))
        .attr('fill', solid ? raw : mix(raw, bgColor, 75))
        .attr('stroke', raw)
        .attr('stroke-width', 1);
      tagDatum(rect, {
        line: nodeLine[j]!.get(c)!,
        key: `node:${j}␟${c}`,
        name: c,
        value: String(v),
        color: raw,
      })
        .attr('data-size', fmt(v))
        .attr(
          'data-size-label',
          `${c} · ${periods[j]} · of ${fmt(colTotal[j]!)}`
        )
        .attr('data-sizeval-x', n.x + NODE_W / 2)
        .attr('data-sizeval-y', n.y + n.h / 2 - 2)
        .attr('data-sizeval-ly', n.y + n.h / 2 + 13)
        .attr('data-sizeval-anchor', 'middle');
      const vw = chart.noValue
        ? 0
        : measureText(valueText(v), LABEL_FONT, { bold: true });
      const name = truncateText(c, LABEL_FONT, Math.max(0, room - vw));
      const label = svg
        .append('text')
        .attr('x', first ? n.x - LABEL_PAD : n.x + NODE_W + LABEL_PAD)
        .attr('y', n.y + n.h / 2 + 4)
        .attr('text-anchor', first ? 'end' : 'start')
        .attr('fill', textColor)
        .attr('font-size', LABEL_FONT)
        .attr('font-family', FONT_FAMILY)
        .text(name);
      // The gap is a dx, not a leading space, which a rasteriser collapses.
      if (!chart.noValue)
        label
          .append('tspan')
          .attr('dx', VALUE_GAP)
          .attr('font-weight', 'bold')
          .text(fmt(v));
    }
  }
}
