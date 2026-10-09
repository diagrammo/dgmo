// ============================================================
// Hand-built sankey renderer — SPIKE (Tier 3).
// Layered layout (longest-path ranking + barycenter ordering) + value-scaled
// ribbon links. The only Tier-3 type needing a real layout algorithm; a
// production migration could swap this core for d3-sankey.
// ECharts house style: node tint mix(c,bg,75), link tint mix(c,bg,45) @0.6.
// ============================================================

import type { ParsedSankey } from '../data-chart-parser';
import { FONT_FAMILY } from '../fonts';
import { mix } from '../palettes/color-utils';
import { measureText, truncateText } from '../utils/text-measure';
import { type Svg, tagDatum } from './shared';
import {
  EMPHASIS_DIM_OPACITY,
  EMPHASIS_DIM_TEXT_OPACITY,
  resolveEmphasis,
} from '../utils/emphasis';

const NODE_W = 20;
const NODE_GAP = 14;
/** Vertical gap between return-ribbon lanes under the chart. */
const LOOP_GAP = 8;
/** How far a return ribbon's bend reaches past its node, in thicknesses. */
const LOOP_BEND = 1.25;
const LABEL_FONT = 13;
const LABEL_PAD = 6;
/** Most of the width the last column's labels may take as a right margin. */
const MAX_LABEL_MARGIN = 0.4;
/** Baseline ribbon translucency — dimming MULTIPLIES this, never replaces it. */
const RIBBON_FILL_OPACITY = 0.6;

interface SNode {
  name: string;
  rank: number;
  value: number;
  order: number;
  x: number;
  y: number;
  h: number;
  raw: string;
}

export function renderSankey(
  svg: Svg,
  chart: ParsedSankey,
  width: number,
  height: number,
  colors: string[],
  bgColor: string,
  textColor: string,
  topInset: number
): void {
  const links = chart.links ?? [];
  if (links.length === 0) return;
  // Ribbons ARE the data surface — fill-outline ignored (§1.9).
  const solid = chart.fillMode === 'solid';

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
  const { dimmed } = resolveEmphasis(chart.emphasis, names, flowClosure);
  // A flow is figure only when BOTH endpoints are figure: a ribbon landing in a
  // receded node is itself part of the background story. Same rule family uses
  // for marriage bars (lit only when both partners are lit).
  const linkDimmed = (l: { source: string; target: string }) =>
    dimmed.has(l.source) || dimmed.has(l.target);
  const node = new Map<string, SNode>();
  names.forEach((name, i) =>
    node.set(name, {
      name,
      rank: 0,
      value: 0,
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
    n.value = Math.max(out, inc, 1);
  }

  const maxRank = Math.max(...[...node.values()].map((n) => n.rank));
  const layers: SNode[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of node.values()) layers[n.rank]!.push(n);

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
      labelOffset(n) - NODE_W + measureText(n.name, LABEL_FONT)
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
          ? forwardLinks
              .filter((l) => l.target === n.name)
              .map((l) => node.get(l.source)!)
          : forwardLinks
              .filter((l) => l.source === n.name)
              .map((l) => node.get(l.target)!);
        n.order = neigh.length
          ? neigh.reduce((a, m) => a + center(m), 0) / neigh.length
          : center(n);
      }
      placeLayer(layers[r]!);
    }
  }

  // link vertical slots: stack outgoing at source right, incoming at target left
  const outOff = new Map<string, number>();
  const inOff = new Map<string, number>();
  for (const n of node.values()) {
    outOff.set(n.name, n.y);
    inOff.set(n.name, n.y);
  }
  // stable order: links by source order then target y
  // Back edges go last, so they leave and enter at the bottom of each node,
  // nearest the lane they run in.
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
    const sy = outOff.get(s.name)!;
    const ty = inOff.get(t.name)!;
    outOff.set(s.name, sy + th);
    inOff.set(t.name, ty + th);
    const sx = s.x + NODE_W;
    const tx = t.x;
    const cx0 = sx + (tx - sx) * 0.5;
    const raw = l.color ?? s.raw;
    const color = solid ? raw : mix(raw, bgColor, 45);
    const opacity = linkDimmed(l)
      ? RIBBON_FILL_OPACITY * EMPHASIS_DIM_OPACITY
      : RIBBON_FILL_OPACITY;
    let ribbon;
    if (backEdges.has(l)) {
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
      ribbon = svg
        .append('path')
        .attr(
          'd',
          `M${sx},${sy} C${cx0},${sy} ${cx0},${ty} ${tx},${ty} ` +
            `L${tx},${ty + th} C${cx0},${ty + th} ${cx0},${sy + th} ${sx},${sy + th} Z`
        )
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

  // nodes + labels
  for (const n of node.values()) {
    const nodeLine = links.find(
      (l) => l.source === n.name || l.target === n.name
    )?.lineNumber;
    const nodeDim = dimmed.has(n.name);
    const nr = svg
      .append('rect')
      .attr('x', n.x)
      .attr('y', n.y)
      .attr('width', NODE_W)
      .attr('height', Math.max(1, n.h))
      .attr('fill', solid ? n.raw : mix(n.raw, bgColor, 75))
      .attr('stroke', n.raw)
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
    const room =
      (n.rank === maxRank ? width - rightPad / 2 : layerX(n.rank + 1)) -
      LABEL_PAD -
      labelX;
    const shown = truncateText(n.name, LABEL_FONT, room);
    const label = svg
      .append('text')
      .attr('x', labelX)
      .attr('y', n.y + n.h / 2 + 4)
      .attr('text-anchor', 'start')
      .attr('fill', textColor)
      .attr('font-size', LABEL_FONT)
      .attr('font-family', FONT_FAMILY)
      .text(shown);
    if (shown !== n.name) label.append('title').text(n.name);
    if (nodeDim) label.attr('opacity', EMPHASIS_DIM_TEXT_OPACITY);
  }
}
