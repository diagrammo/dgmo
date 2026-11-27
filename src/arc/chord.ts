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
import { HAIRLINE_DASH } from '../utils/visual-conventions';

type G = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

const CHORD_LABEL_FONT = 12;
const CHORD_READOUT_FONT = 13;
const CHORD_SEGMENT_THICKNESS = 12;
const CHORD_LABEL_GAP = 8;
/** Pad between segments, radians; shrunk when there are many nodes. */
const CHORD_PAD = 0.04;
const CHORD_MIN_RADIUS = 40;
/** Leader for a crowded label: radial stub off the ring, then a flat run. */
const CHORD_ELBOW_OUT = 10;
const CHORD_ELBOW_RUN = 14;
/** Line pitch of a stacked label column, in ems. */
const CHORD_LABEL_PITCH = 1.18;
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

export interface ChordLabelInput extends ChordSpan {
  /** Label width at CHORD_LABEL_FONT. */
  width: number;
}

export interface ChordLabelSpot {
  /** Text anchor point, relative to the ring centre. */
  x: number;
  y: number;
  dy: string;
  anchor: 'start' | 'middle' | 'end';
  font: number;
  /** Leader polyline relative to the centre; absent when the label sits in place. */
  leader?: [number, number][];
  /** The label's ink box, relative to the centre. */
  box: { x0: number; y0: number; x1: number; y1: number };
}

export interface ChordLabelPlacement {
  outer: number;
  labels: ChordLabelSpot[];
}

/** Boxes that only touch (a stacked column) do not overlap; 0.01px absorbs float drift. */
const OVERLAP_EPS = 0.01;
function boxesOverlap(a: ChordLabelSpot['box'], b: ChordLabelSpot['box']) {
  return (
    a.x0 < b.x1 - OVERLAP_EPS &&
    b.x0 < a.x1 - OVERLAP_EPS &&
    a.y0 < b.y1 - OVERLAP_EPS &&
    b.y0 < a.y1 - OVERLAP_EPS
  );
}

/** A text line's ink rows: ascender 0.75em above the baseline, descender 0.25em below. */
function inkRows(y: number, dyEm: number, font: number) {
  return { y0: y + (dyEm - 0.75) * font, y1: y + (dyEm + 0.25) * font };
}

/** Where today's label goes: mid-angle, a fixed gap outside the ring. */
function naturalSpot(n: ChordLabelInput, outer: number): ChordLabelSpot {
  const font = CHORD_LABEL_FONT;
  const mid = (n.a0 + n.a1) / 2;
  const s = Math.sin(mid);
  const c = Math.cos(mid);
  const lr = outer + CHORD_LABEL_GAP;
  const x = lr * s;
  const y = -lr * c;
  const centred = Math.abs(s) < 0.2;
  const anchor = centred ? 'middle' : s > 0 ? 'start' : 'end';
  const dyEm = centred ? (c > 0 ? -0.2 : 0.9) : 0.35;
  const x0 =
    anchor === 'start' ? x : anchor === 'end' ? x - n.width : x - n.width / 2;
  return {
    x,
    y,
    dy: `${dyEm}em`,
    anchor,
    font,
    box: { x0, ...inkRows(y, dyEm, font), x1: x0 + n.width },
  };
}

/**
 * Place every segment label (#2418). A label that collides with no other sits
 * where it always has, with no leader. Labels that would overprint move to a
 * column beside the ring, as the pie chart's do: a radial stub off the segment,
 * then a flat run to the text, stacked top to bottom on their own side. A side
 * with more labels than its height holds gets a smaller shared font.
 */
export function placeChordLabels(
  nodes: ChordLabelInput[],
  innerWidth: number,
  innerHeight: number
): ChordLabelPlacement {
  const font = CHORD_LABEL_FONT;
  const maxLabel = Math.max(0, ...nodes.map((n) => n.width));
  const radiusFor = (reserve: number) =>
    Math.max(
      CHORD_MIN_RADIUS + CHORD_SEGMENT_THICKNESS,
      Math.min(
        innerWidth / 2 - maxLabel - reserve,
        innerHeight / 2 - font - CHORD_LABEL_GAP
      )
    );

  const crowdedAt = (spots: ChordLabelSpot[]) => {
    const hit = new Set<number>();
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++)
        if (boxesOverlap(spots[i]!.box, spots[j]!.box)) {
          hit.add(i);
          hit.add(j);
        }
    return hit;
  };

  const plain = radiusFor(CHORD_LABEL_GAP);
  const plainSpots = nodes.map((n) => naturalSpot(n, plain));
  if (crowdedAt(plainSpots).size === 0)
    return { outer: plain, labels: plainSpots };

  // Crowded: shrink the ring so the leader's stub and run fit beside it.
  const outer = radiusFor(CHORD_ELBOW_OUT + CHORD_ELBOW_RUN + font * 0.3);
  const natural = nodes.map((n) => naturalSpot(n, outer));
  const moved = crowdedAt(natural);
  const labelX = outer + CHORD_ELBOW_OUT + CHORD_ELBOW_RUN;
  const bound = innerHeight / 2 - (font * CHORD_LABEL_PITCH) / 2;

  let labels = natural;
  // Moving labels into a column can land one on a label that stayed put; that
  // one joins the column too. The set only grows, so this ends.
  for (let pass = 0; pass <= nodes.length; pass++) {
    const sideOf = (i: number) =>
      Math.sin((nodes[i]!.a0 + nodes[i]!.a1) / 2) >= 0;
    const perSide = Math.max(
      0,
      ...[true, false].map(
        (r) => [...moved].filter((i) => sideOf(i) === r).length
      )
    );
    const fitFont =
      perSide > 1
        ? (2 * bound) / ((perSide - 1) * CHORD_LABEL_PITCH + 1)
        : font;
    const colFont = Math.min(font, fitFont);
    const gap = colFont * CHORD_LABEL_PITCH;
    const colBound = innerHeight / 2 - gap / 2;
    labels = [...natural];
    for (const right of [true, false]) {
      const group = [...moved]
        .filter((i) => sideOf(i) === right)
        .map((i) => {
          const mid = (nodes[i]!.a0 + nodes[i]!.a1) / 2;
          const ex = Math.sin(mid) * (outer + CHORD_ELBOW_OUT);
          const ey = -Math.cos(mid) * (outer + CHORD_ELBOW_OUT);
          return { i, mid, ex, ey, y: ey };
        })
        .sort((a, b) => a.ey - b.ey);
      // Forward pass pushes each label down off the one above; backward pass
      // pulls the column up where the bottom overran (the pie's #1941 fix).
      group.forEach((l, k) => {
        const floor = k === 0 ? -colBound : group[k - 1]!.y + gap;
        l.y = Math.max(l.ey, floor);
      });
      for (let k = group.length - 1; k >= 0; k--) {
        const ceil = k === group.length - 1 ? colBound : group[k + 1]!.y - gap;
        group[k]!.y = Math.min(group[k]!.y, ceil);
      }
      const sx = right ? 1 : -1;
      const tx = sx * labelX;
      for (const l of group) {
        const sx0 = Math.sin(l.mid) * outer;
        const sy0 = -Math.cos(l.mid) * outer;
        // Bend on the radial ray at the label's height when the ray gets there
        // before the column; otherwise keep the fixed stub and angle across.
        const rayX = Math.abs(sy0) < 0.001 ? NaN : (l.y * sx0) / sy0;
        const onRay =
          Number.isFinite(rayX) &&
          Math.sign(l.y) === Math.sign(sy0) &&
          Math.abs(l.y) >= Math.abs(l.ey) &&
          Math.abs(rayX) <= labelX - CHORD_ELBOW_RUN * 0.25;
        const bend: [number, number] = onRay ? [rayX, l.y] : [l.ex, l.ey];
        const w = nodes[l.i]!.width * (colFont / font);
        const x = tx + sx * colFont * 0.3;
        const x0 = right ? x : x - w;
        labels[l.i] = {
          x,
          y: l.y,
          dy: '0.35em',
          anchor: right ? 'start' : 'end',
          font: colFont,
          leader: [[sx0, sy0], bend, [tx, l.y]],
          box: { x0, ...inkRows(l.y, 0.35, colFont), x1: x0 + w },
        };
      }
    }
    let grew = false;
    for (let i = 0; i < nodes.length; i++) {
      if (moved.has(i)) continue;
      for (const j of moved)
        if (boxesOverlap(labels[i]!.box, labels[j]!.box)) {
          moved.add(i);
          grew = true;
          break;
        }
    }
    if (!grew) break;
  }
  return { outer, labels };
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
  const cx = innerWidth / 2;
  const cy = innerHeight / 2;
  const placement = placeChordLabels(
    layout.nodes.map((nd) => ({
      a0: nd.a0,
      a1: nd.a1,
      width: measureText(labelText(nd), CHORD_LABEL_FONT),
    })),
    innerWidth,
    innerHeight
  );
  const outer = placement.outer;
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
  for (const [ni, nd] of layout.nodes.entries()) {
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

    const spot = placement.labels[ni]!;
    if (spot.leader)
      nodeG
        .append('polyline')
        .attr('class', 'arc-chord-leader')
        .attr(
          'points',
          spot.leader.map(([x, y]) => `${cx + x},${cy + y}`).join(' ')
        )
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', HAIRLINE_DASH);
    const text = nodeG
      .append('text')
      .attr('class', 'arc-chord-label')
      .attr('x', cx + spot.x)
      .attr('y', cy + spot.y)
      .attr('dy', spot.dy)
      .attr('text-anchor', spot.anchor)
      .attr('fill', textColor)
      .attr('font-size', spot.font)
      .attr('font-family', FONT_FAMILY);
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
