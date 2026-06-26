// ============================================================
// Hand-built sankey renderer — SPIKE (Tier 3).
// Layered layout (longest-path ranking + barycenter ordering) + value-scaled
// ribbon links. The only Tier-3 type needing a real layout algorithm; a
// production migration could swap this core for d3-sankey.
// ECharts house style: node tint mix(c,bg,75), link tint mix(c,bg,45) @0.6.
// ============================================================

import type { ParsedSankey } from '../echarts';
import { FONT_FAMILY } from '../fonts';
import { mix } from '../palettes/color-utils';
import { measureText } from '../utils/text-measure';
import type { Svg } from './shared';

const NODE_W = 20;
const NODE_GAP = 14;

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
  const solid = chart.solidFill === true;

  const names = Array.from(new Set(links.flatMap((l) => [l.source, l.target])));
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

  // longest-path ranking
  for (let pass = 0; pass < names.length; pass++) {
    let changed = false;
    for (const l of links) {
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
    const out = links.filter((l) => l.source === n.name).reduce((a, l) => a + l.value, 0);
    const inc = links.filter((l) => l.target === n.name).reduce((a, l) => a + l.value, 0);
    n.value = Math.max(out, inc, 1);
  }

  const maxRank = Math.max(...[...node.values()].map((n) => n.rank));
  const layers: SNode[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of node.values()) layers[n.rank]!.push(n);

  const plotLeft = 16;
  const top = topInset + 8;
  const plotW = width - plotLeft - 16 - measureText('M', 14);
  const plotH = height - top - 24;

  // global value scale so the busiest layer fits
  let valueScale = Infinity;
  for (const layer of layers) {
    const tot = layer.reduce((a, n) => a + n.value, 0);
    const avail = plotH - (layer.length - 1) * NODE_GAP;
    if (tot > 0) valueScale = Math.min(valueScale, avail / tot);
  }
  if (!isFinite(valueScale)) valueScale = 1;

  const layerX = (r: number) =>
    plotLeft + (maxRank === 0 ? 0 : (r * (plotW - NODE_W)) / maxRank);

  const placeLayer = (layer: SNode[]) => {
    layer.sort((a, b) => a.order - b.order);
    const totH = layer.reduce((a, n) => a + n.value * valueScale, 0) + (layer.length - 1) * NODE_GAP;
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
    const order = forward
      ? [...layers.keys()]
      : [...layers.keys()].reverse();
    for (const r of order) {
      for (const n of layers[r]!) {
        const neigh = forward
          ? links.filter((l) => l.target === n.name).map((l) => node.get(l.source)!)
          : links.filter((l) => l.source === n.name).map((l) => node.get(l.target)!);
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
  const ordered = [...links].sort((a, b) => {
    const sa = node.get(a.source)!;
    const sb = node.get(b.source)!;
    if (sa.y !== sb.y) return sa.y - sb.y;
    return node.get(a.target)!.y - node.get(b.target)!.y;
  });

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
    svg
      .append('path')
      .attr(
        'd',
        `M${sx},${sy} C${cx0},${sy} ${cx0},${ty} ${tx},${ty} ` +
          `L${tx},${ty + th} C${cx0},${ty + th} ${cx0},${sy + th} ${sx},${sy + th} Z`
      )
      .attr('fill', color)
      .attr('fill-opacity', 0.6);
  }

  // nodes + labels
  for (const n of node.values()) {
    svg
      .append('rect')
      .attr('x', n.x)
      .attr('y', n.y)
      .attr('width', NODE_W)
      .attr('height', Math.max(1, n.h))
      .attr('fill', solid ? n.raw : mix(n.raw, bgColor, 75))
      .attr('stroke', n.raw)
      .attr('stroke-width', 1);
    const lastLayer = n.rank === maxRank;
    svg
      .append('text')
      .attr('x', lastLayer ? n.x - 6 : n.x + NODE_W + 6)
      .attr('y', n.y + n.h / 2 + 4)
      .attr('text-anchor', lastLayer ? 'end' : 'start')
      .attr('fill', textColor)
      .attr('font-size', 13)
      .attr('font-family', FONT_FAMILY)
      .text(n.name);
  }
}
