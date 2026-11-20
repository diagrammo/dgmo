// ============================================================
// arc `layout chord` — ribbons on a ring (#1856, decided 2026-11-12).
//
// Each node is an outer segment sized by its total flow (given + received),
// with a small pad between segments. Each link is ONE ribbon whose width at
// both ends is its weight; both ends sit flush on their segments, so `A -> B`
// and `B -> A` stay two ribbons. Direction is not drawn: hovering a ribbon
// names it (`Rackham → Roberts 100`) in the ring's centre.
// ============================================================

import * as d3Selection from 'd3-selection';
import type { ParsedArc, ArcLink } from '../visualizations/types';
import type { PaletteColors } from '../palettes';
import { shapeFill, themeBaseBg } from '../palettes/color-utils';
import { measureText } from '../utils/text-measure';
import { FONT_FAMILY } from '../fonts';

type G = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

const CHORD_LABEL_FONT = 12;
const CHORD_READOUT_FONT = 13;
const CHORD_SEGMENT_THICKNESS = 12;
const CHORD_LABEL_GAP = 8;
/** Pad between segments, radians; shrunk when there are many nodes. */
const CHORD_PAD = 0.04;
const CHORD_MIN_RADIUS = 40;
const RIBBON_OPACITY = 0.6;
const RIBBON_SOLID_OPACITY = 0.85;
const RIBBON_FADE_OPACITY = 0.08;
const RIBBON_HOVER_OPACITY = 0.9;

interface ChordSpan {
  /** Start angle, radians clockwise from 12 o'clock. */
  a0: number;
  a1: number;
}

interface ChordLayoutNode extends ChordSpan {
  name: string;
  total: number;
}

interface ChordLayoutRibbon {
  link: ArcLink;
  source: ChordSpan;
  target: ChordSpan;
}

interface ChordLayout {
  nodes: ChordLayoutNode[];
  ribbons: ChordLayoutRibbon[];
}

/** Total flow per node: every link it gives plus every link it receives. */
function chordTotals(links: ArcLink[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const l of links) {
    totals.set(l.source, (totals.get(l.source) ?? 0) + l.value);
    totals.set(l.target, (totals.get(l.target) ?? 0) + l.value);
  }
  return totals;
}

/**
 * Angles for every segment and both ends of every ribbon. Within a segment the
 * ends are ordered by how far clockwise the other node sits — the farthest
 * first — so ribbons leave toward their neighbour instead of crossing.
 */
export function layoutChord(nodes: string[], links: ArcLink[]): ChordLayout {
  const totals = chordTotals(links);
  const n = nodes.length;
  const grand = nodes.reduce((s, nm) => s + (totals.get(nm) ?? 0), 0);
  const pad = n > 1 ? Math.min(CHORD_PAD, (Math.PI * 2 * 0.2) / n) : 0;
  const avail = Math.PI * 2 - pad * n;
  const k = grand > 0 ? avail / grand : 0;
  const index = new Map(nodes.map((nm, i) => [nm, i]));

  type End = { link: ArcLink; li: number; isSource: boolean; dist: number };
  const ends = new Map<string, End[]>();
  for (const nm of nodes) ends.set(nm, []);
  links.forEach((link, li) => {
    const si = index.get(link.source)!;
    const ti = index.get(link.target)!;
    ends.get(link.source)!.push({
      link,
      li,
      isSource: true,
      dist: (ti - si + n) % n,
    });
    ends.get(link.target)!.push({
      link,
      li,
      isSource: false,
      dist: (si - ti + n) % n,
    });
  });

  const out: ChordLayoutNode[] = [];
  const spans = new Map<number, { source?: ChordSpan; target?: ChordSpan }>();
  let a = 0;
  for (const nm of nodes) {
    const total = totals.get(nm) ?? 0;
    const a0 = a;
    const list = ends.get(nm)!;
    list.sort(
      (x, y) =>
        y.dist - x.dist ||
        x.li - y.li ||
        (x.isSource === y.isSource ? 0 : x.isSource ? -1 : 1)
    );
    let c = a0;
    for (const e of list) {
      const w = e.link.value * k;
      const span = { a0: c, a1: c + w };
      const slot = spans.get(e.li) ?? {};
      if (e.isSource) slot.source = span;
      else slot.target = span;
      spans.set(e.li, slot);
      c += w;
    }
    a = a0 + total * k;
    out.push({ name: nm, total, a0, a1: a });
    a += pad;
  }

  const ribbons = links.map((link, li) => {
    const s = spans.get(li)!;
    return { link, source: s.source!, target: s.target! };
  });
  return { nodes: out, ribbons };
}

function pt(cx: number, cy: number, r: number, ang: number): string {
  return `${cx + r * Math.sin(ang)},${cy - r * Math.cos(ang)}`;
}

function arcTo(cx: number, cy: number, r: number, from: number, to: number) {
  const large = to - from > Math.PI ? 1 : 0;
  return `A${r},${r} 0 ${large} 1 ${pt(cx, cy, r, to)}`;
}

/** The ribbon shape: an arc on each end, joined by curves through the centre. */
function ribbonPath(
  cx: number,
  cy: number,
  r: number,
  s: ChordSpan,
  t: ChordSpan
): string {
  return [
    `M${pt(cx, cy, r, s.a0)}`,
    arcTo(cx, cy, r, s.a0, s.a1),
    `Q${cx},${cy} ${pt(cx, cy, r, t.a0)}`,
    arcTo(cx, cy, r, t.a0, t.a1),
    `Q${cx},${cy} ${pt(cx, cy, r, s.a0)}`,
    'Z',
  ].join(' ');
}

function segmentPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  s: ChordSpan
): string {
  const large = s.a1 - s.a0 > Math.PI ? 1 : 0;
  return [
    `M${pt(cx, cy, r1, s.a0)}`,
    `A${r1},${r1} 0 ${large} 1 ${pt(cx, cy, r1, s.a1)}`,
    `L${pt(cx, cy, r0, s.a1)}`,
    `A${r0},${r0} 0 ${large} 0 ${pt(cx, cy, r0, s.a0)}`,
    'Z',
  ].join(' ');
}

function fmt(v: number): string {
  return Number.isInteger(v) ? v.toLocaleString('en-US') : String(v);
}

interface ChordRenderArgs {
  g: G;
  parsed: ParsedArc;
  nodes: string[];
  nodeGroupColor: Map<string, string>;
  palette: PaletteColors;
  isDark: boolean;
  colors: string[];
  textColor: string;
  bgColor: string;
  innerWidth: number;
  innerHeight: number;
  onClickItem: ((lineNumber: number) => void) | undefined;
}

export function renderArcChord(args: ChordRenderArgs): void {
  const {
    g,
    parsed,
    nodes,
    nodeGroupColor,
    palette,
    isDark,
    colors,
    textColor,
    bgColor,
    innerWidth,
    innerHeight,
    onClickItem,
  } = args;
  const links = parsed.links;
  const layout = layoutChord(nodes, links);
  const showTotal = !parsed.noValue;

  // Node colour follows arc's rules: the group's colour, else the palette.
  const nodeColor = new Map<string, string>();
  nodes.forEach((nm, i) =>
    nodeColor.set(nm, nodeGroupColor.get(nm) ?? colors[i % colors.length]!)
  );
  const totals = new Map(layout.nodes.map((nd) => [nd.name, nd.total]));
  // A ribbon takes the colour of its larger node by total (tie → source);
  // an explicit per-link colour wins.
  const ribbonColor = (l: ArcLink): string => {
    if (l.color) return l.color;
    const st = totals.get(l.source) ?? 0;
    const tt = totals.get(l.target) ?? 0;
    return nodeColor.get(tt > st ? l.target : l.source)!;
  };

  const labelText = (nd: ChordLayoutNode) =>
    showTotal ? `${nd.name} ${fmt(nd.total)}` : nd.name;
  const maxLabel = Math.max(
    0,
    ...layout.nodes.map((nd) => measureText(labelText(nd), CHORD_LABEL_FONT))
  );
  const cx = innerWidth / 2;
  const cy = innerHeight / 2;
  const outer = Math.max(
    CHORD_MIN_RADIUS + CHORD_SEGMENT_THICKNESS,
    Math.min(
      innerWidth / 2 - maxLabel - CHORD_LABEL_GAP,
      innerHeight / 2 - CHORD_LABEL_FONT - CHORD_LABEL_GAP
    )
  );
  const inner = outer - CHORD_SEGMENT_THICKNESS;
  const fillMode = parsed.fillMode;
  const baseOpacity =
    fillMode === 'solid' ? RIBBON_SOLID_OPACITY : RIBBON_OPACITY;
  const hollow = themeBaseBg(palette, isDark);

  const ribbonLayer = g.append('g').attr('class', 'arc-chord-ribbons');
  // Larger ribbons draw first, so a thin one is never buried under a wide one.
  const order = [...layout.ribbons].sort((x, y) => y.link.value - x.link.value);
  for (const rb of order) {
    const l = rb.link;
    const color = ribbonColor(l);
    const name = `${l.source} → ${l.target} ${fmt(l.value)}`;
    ribbonLayer
      .append('path')
      .attr('class', 'arc-chord-ribbon')
      .attr('data-source', l.source)
      .attr('data-target', l.target)
      .attr('data-value', String(l.value))
      .attr('data-line-number', String(l.lineNumber))
      .attr('aria-label', name)
      .attr('d', ribbonPath(cx, cy, inner, rb.source, rb.target))
      .attr('fill', fillMode === 'outline' ? hollow : color)
      .attr('fill-opacity', fillMode === 'outline' ? 0 : baseOpacity)
      .attr('stroke', color)
      .attr('stroke-opacity', fillMode === 'outline' ? 0.9 : 0.5)
      .attr('stroke-width', fillMode === 'outline' ? 1.5 : 0.5)
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .on('mouseenter', () => focusRibbon(l, name))
      .on('mouseleave', clearFocus)
      .on('click', () => {
        if (onClickItem && l.lineNumber) onClickItem(l.lineNumber);
      });
  }

  const nodeLayer = g.append('g').attr('class', 'arc-chord-nodes');
  for (const nd of layout.nodes) {
    const color = nodeColor.get(nd.name)!;
    const firstLink = links.find(
      (l) => l.source === nd.name || l.target === nd.name
    );
    const nodeG = nodeLayer
      .append('g')
      .attr('class', 'arc-node')
      .attr('data-node', nd.name)
      .attr(
        'data-line-number',
        firstLink?.lineNumber ? String(firstLink.lineNumber) : null
      )
      .style('cursor', 'pointer')
      .on('mouseenter', () => focusNode(nd.name))
      .on('mouseleave', clearFocus)
      .on('click', () => {
        if (onClickItem && firstLink?.lineNumber)
          onClickItem(firstLink.lineNumber);
      });
    nodeG
      .append('path')
      .attr('class', 'arc-chord-segment')
      .attr('d', segmentPath(cx, cy, inner, outer, nd))
      .attr('fill', shapeFill(palette, color, isDark, { mode: fillMode }))
      .attr('stroke', color)
      .attr('stroke-width', 1);

    const mid = (nd.a0 + nd.a1) / 2;
    const s = Math.sin(mid);
    const c = Math.cos(mid);
    const lr = outer + CHORD_LABEL_GAP;
    const text = nodeG
      .append('text')
      .attr('x', cx + lr * s)
      .attr('y', cy - lr * c)
      .attr('dy', '0.35em')
      .attr(
        'text-anchor',
        Math.abs(s) < 0.2 ? 'middle' : s > 0 ? 'start' : 'end'
      )
      .attr('fill', textColor)
      .attr('font-size', CHORD_LABEL_FONT)
      .attr('font-family', FONT_FAMILY);
    if (Math.abs(s) < 0.2) text.attr('dy', c > 0 ? '-0.2em' : '0.9em');
    text.append('tspan').text(nd.name);
    if (showTotal)
      text
        .append('tspan')
        .attr('fill', palette.textMuted)
        .text(` ${fmt(nd.total)}`);
  }

  // Hover readout: the ring's centre names the hovered ribbon. Empty at rest,
  // so exports carry nothing here.
  const readout = g
    .append('text')
    .attr('class', 'arc-chord-readout')
    .attr('x', cx)
    .attr('y', cy)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'middle')
    .attr('fill', textColor)
    .attr('font-size', CHORD_READOUT_FONT)
    .attr('font-weight', 600)
    .attr('font-family', FONT_FAMILY)
    .attr('stroke', bgColor)
    .attr('stroke-width', 4)
    .attr('stroke-linejoin', 'round')
    .attr('paint-order', 'stroke')
    .style('pointer-events', 'none');

  function setRibbons(pred: (src: string, tgt: string) => boolean) {
    ribbonLayer
      .selectAll<SVGPathElement, unknown>('.arc-chord-ribbon')
      .each(function () {
        const el = d3Selection.select(this);
        const on = pred(el.attr('data-source'), el.attr('data-target'));
        if (fillMode !== 'outline')
          el.attr(
            'fill-opacity',
            on ? RIBBON_HOVER_OPACITY : RIBBON_FADE_OPACITY
          );
        el.attr('stroke-opacity', on ? 0.9 : RIBBON_FADE_OPACITY);
      });
  }
  function focusRibbon(l: ArcLink, name: string) {
    setRibbons((src, tgt) => src === l.source && tgt === l.target);
    readout.text(name);
  }
  function focusNode(nm: string) {
    setRibbons((src, tgt) => src === nm || tgt === nm);
  }
  function clearFocus() {
    ribbonLayer
      .selectAll<SVGPathElement, unknown>('.arc-chord-ribbon')
      .attr('fill-opacity', fillMode === 'outline' ? 0 : baseOpacity)
      .attr('stroke-opacity', fillMode === 'outline' ? 0.9 : 0.5);
    readout.text('');
  }
}
