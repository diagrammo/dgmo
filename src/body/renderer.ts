// ============================================================
// Body chart — Renderer (male/female × front/back, 1 or 2 views)
// ============================================================
//
// Emits a static SVG figure — or two side by side when the diagram names both
// `front` and `back`. A gray segmented muscle silhouette (or a flat skin
// silhouette + head), named parts filled in their tag color.
//
//   • Single view — each named part gets a gutter label on the outer edge with a
//     leader to its anchor.
//   • Dual view   — ONE central label column between the figures; each part's
//     label fans leaders out to the front figure (left) and/or the back figure
//     (right), so a muscle present on both views (deltoids, calves) is labeled
//     once with two leaders.
//
// The whole diagram is a single markup string set as the container's innerHTML;
// HTML5 foreign-content parsing namespaces the `<svg>` subtree in both jsdom
// (CLI/export) and the browser, and `finalizeSvgExport` serializes it for resvg.

import * as d3Selection from 'd3-selection';
import type { PaletteColors } from './../palettes';
import type { D3ExportDimensions } from '../utils/d3-types';
import { getSeriesColors, mix, themeBaseBg } from '../palettes/color-utils';
import type { FillMode } from '../utils/parsing';
import { resolveColor } from '../colors';
import { FONT_FAMILY } from '../fonts';
import {
  resolveActiveTagGroup,
  resolveTagColor,
  tagAttrKey,
} from '../utils/tag-groups';
import { renderIntegratedLegend } from '../utils/legend-integration';
import type { LegendGroupData } from '../utils/legend-types';
import { getFigure, getPartGeom, resolvePartKey } from './catalog';
import type { BodyFigure, BodyPart, BodyView, ParsedBody } from './types';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TITLE_H = 60; // title text area
// The figure coordinate space is large (~1400-unit tall bodies), so the shared
// legend — laid out at fixed ~11px — is scaled up to stay legible next to the
// figure labels (font 23).
const LEGEND_SCALE = 2.4;
const LEGEND_BAND = 76; // shared tag legend band (scaled), below the title
const TITLE_PAD = TITLE_H + LEGEND_BAND; // figures start below title + legend
const BOTTOM_PAD = 40;
// Breathing room around the whole diagram: the viewBox is padded on every side
// so the figure never crowds the canvas edge (it renders smaller + centered).
const PAGE_MARGIN = 160;
const OUTER_MARGIN = 30;
const CENTER_COL = 420; // dual-view central label column width
const LABEL_FONT = 23;
const NOTE_FONT = 17;

type Box = [number, number, number, number]; // vx vy vw vh

interface FigureRender {
  fig: BodyFigure;
  body: string; // base + highlighted parts + outline + head (raw coords)
  anchors: Map<
    string,
    {
      x: number;
      y: number;
      centers: Array<{ x: number; y: number }>;
      color: string;
      emph: string;
      part: BodyPart;
    }
  >;
  vx: number;
  vy: number;
  vw: number;
  vh: number;
}

/** Absolute x of a path's start point (the initial M/m is always absolute). */
function pathStartX(d: string): number {
  const m = d.match(/[Mm]\s*(-?[\d.]+)/);
  return m ? parseFloat(m[1]!) : 0;
}

/** Distinct anchor-map key so `left biceps` and `right biceps` don't collide. */
function partKey(part: BodyPart): string {
  return (part.side ? `${part.side} ` : '') + part.name.toLowerCase();
}

/** Label text — prefixes the anatomical side when one was given. */
function partLabel(part: BodyPart): string {
  return part.side ? `${part.side} ${part.name}` : part.name;
}

/**
 * Pick the component centre for a named anatomical side. `side` is the
 * patient's own left/right; on a front view that mirrors to the opposite
 * screen side, on a back view it maps straight through.
 */
function sideCenter(
  centers: Array<{ x: number; y: number }>,
  side: 'left' | 'right',
  view: BodyView
): { x: number; y: number } {
  const wantScreenRight = view === 'front' ? side === 'left' : side === 'right';
  return centers.reduce((best, c) =>
    wantScreenRight ? (c.x > best.x ? c : best) : c.x < best.x ? c : best
  );
}

/** Render a figure's body (no labels) + collect per-part anchors in raw coords. */
function renderFigureBody(
  fig: BodyFigure,
  view: BodyView,
  parts: readonly BodyPart[],
  partColor: (p: BodyPart) => string,
  emphKey: (p: BodyPart) => string,
  form: ParsedBody['options']['form'],
  palette: PaletteColors,
  isDark: boolean,
  fillMode: FillMode | undefined,
  defs: string[]
): FigureRender {
  const [vx, vy, vw, vh] = fig.viewBox.split(' ').map(Number) as Box;
  const muscleFill = mix(palette.bg, palette.border, 0.7);
  const seam = palette.bg;
  const outlineStroke = palette.textMuted;

  // Shared soft body gradient — both forms fill the silhouette with it so the
  // figure reads as one shaded shape, making highlighted parts + their leaders
  // stand out instead of getting lost in white space.
  const gid = `body-skin-${vx}-${vy}`;
  defs.push(
    `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${mix(palette.surface, palette.bg, 0.4)}"/>` +
      `<stop offset="1" stop-color="${mix(palette.border, palette.bg, 0.3)}"/>` +
      `</linearGradient>`
  );

  let out = '';
  if (form === 'skin') {
    out += `<path d="${fig.outline}" fill="url(#${gid})"/>`;
    for (const d of fig.headPaths) {
      out += `<path d="${d}" fill="url(#${gid})" stroke="${outlineStroke}" stroke-width="2.5"/>`;
    }
    const hairFill = mix(palette.text, palette.bg, 0.6);
    for (const d of fig.hairPaths) {
      out += `<path d="${d}" fill="${hairFill}" stroke="${outlineStroke}" stroke-width="1.5"/>`;
    }
  } else {
    // Shade the whole silhouette first, then lay the muscle striations over it
    // as subtle relief so the body is a single tinted shape (not white).
    out += `<path d="${fig.outline}" fill="url(#${gid})"/>`;
    for (const d of fig.base) {
      out += `<path d="${d}" fill="${muscleFill}" fill-opacity="0.55" stroke="${seam}" stroke-width="1"/>`;
    }
    // Muscle silhouette (fig.outline) traces the jaw but not the scalp, so the
    // crown is left un-bordered. Overlay the head + hairline outline (stroke
    // only) so the dark border follows the hairline like every other edge.
    for (const d of fig.headPaths) {
      out += `<path d="${d}" fill="url(#${gid})" stroke="${outlineStroke}" stroke-width="2.5"/>`;
    }
    for (const d of fig.hairPaths) {
      out += `<path d="${d}" fill="none" stroke="${outlineStroke}" stroke-width="2.5"/>`;
    }
  }

  const anchors = new Map<
    string,
    {
      x: number;
      y: number;
      centers: Array<{ x: number; y: number }>;
      color: string;
      emph: string;
      part: BodyPart;
    }
  >();
  const cxMid = vx + vw / 2;
  for (const part of parts) {
    const key = resolvePartKey(fig, part.name);
    if (!key) continue;
    const geom = getPartGeom(fig, key)!;
    const color = partColor(part);
    const emph = emphKey(part).toLowerCase();
    const dataLine = ` class="dgmo-body-part" data-line-number="${part.lineNumber}" data-emph-key="${esc(emph)}"`;
    // With a side modifier, fill only that side's shapes (patient's right pec →
    // the screen-left path), so a one-sided injury highlights one side alone.
    let paths = geom.paths as readonly string[];
    if (part.side) {
      const wantScreenRight =
        view === 'front' ? part.side === 'left' : part.side === 'right';
      const sidePaths = geom.paths.filter((d) =>
        wantScreenRight ? pathStartX(d) >= cxMid : pathStartX(d) < cxMid
      );
      if (sidePaths.length) paths = sidePaths;
    }
    if (fillMode === 'solid') {
      // §1.9 fill-solid: full-saturation region fill, coloured edge.
      for (const d of paths) {
        out += `<path${dataLine} d="${d}" fill="${color}" stroke="${color}" stroke-width="1.5"/>`;
      }
    } else if (fillMode === 'outline') {
      // §1.9 fill-outline: the region is a clean base-bg cut-out; its colour
      // rides on a heavier stroke alone (the only signal, so 2.5 not 1.5).
      const baseBg = themeBaseBg(palette, isDark);
      for (const d of paths) {
        out += `<path${dataLine} d="${d}" fill="${baseBg}" stroke="${color}" stroke-width="2.5"/>`;
      }
    } else if (form === 'skin') {
      for (const d of paths) {
        out += `<path${dataLine} d="${d}" fill="${color}" fill-opacity="0.5" stroke="${color}" stroke-width="1.5"/>`;
      }
    } else {
      // Muted fill (~70% colour, 30% bg) with a full-strength coloured edge —
      // clearly filled, but soft enough that the leader line reads across it.
      const lightFill = mix(color, palette.bg, 70);
      for (const d of paths) {
        out += `<path${dataLine} d="${d}" fill="${lightFill}" stroke="${color}" stroke-width="1.5"/>`;
      }
    }
    const allCenters = geom.centers?.length
      ? geom.centers.map((c) => ({ x: c.x, y: c.y }))
      : [{ x: geom.anchor.x, y: geom.anchor.y }];
    // A `left`/`right` modifier locks the leader onto that side's component;
    // otherwise keep every component so the label picks the nearest one.
    const chosen =
      part.side && allCenters.length > 1
        ? sideCenter(allCenters, part.side, view)
        : null;
    anchors.set(partKey(part), {
      x: chosen?.x ?? geom.anchor.x,
      y: chosen?.y ?? geom.anchor.y,
      centers: chosen ? [chosen] : allCenters,
      color,
      emph,
      part,
    });
  }

  out += `<path d="${fig.outline}" fill="none" stroke="${outlineStroke}" stroke-width="2.5"/>`;
  return { fig, body: out, anchors, vx, vy, vw, vh };
}

/** Pick the muscle component centroid nearest a target x (the label side). */
function nearestCenter(
  a: { x: number; y: number; centers: Array<{ x: number; y: number }> },
  targetX: number
): { x: number; y: number } {
  let best = a.centers[0] ?? { x: a.x, y: a.y };
  let bestD = Math.abs(best.x - targetX);
  for (const c of a.centers) {
    const d = Math.abs(c.x - targetX);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Gutter labels for the single-view case (raw coords, drawn inside the g). */
function gutterLabels(r: FigureRender, palette: PaletteColors): string {
  const { vx, vw, vh } = r;
  const cx = vx + vw / 2;
  const list = [...r.anchors.values()];
  // Clearly lateral parts label on their own side; near-midline ones (face,
  // spine, navel…) would all pile onto one gutter, so spread them across both
  // to balance the columns.
  const band = vw * 0.1;
  const left = list.filter((a) => a.x < cx - band);
  const right = list.filter((a) => a.x > cx + band);
  const mid = list
    .filter((a) => a.x >= cx - band && a.x <= cx + band)
    .sort((a, b) => a.y - b.y);
  for (const a of mid) (left.length <= right.length ? left : right).push(a);
  let labels = '';
  const place = (arr: typeof list, side: 'L' | 'R'): void => {
    const gx = side === 'L' ? vx - 14 : vx + vw + 14;
    // Leader starts a short gap in from the label text so the line never
    // crowds the words; `sx` is that start x (pointing toward the figure).
    const sx = side === 'L' ? gx + 26 : gx - 26;
    const anchorX = side === 'L' ? 'end' : 'start';
    const minGap = vh * 0.05;
    // Aim each label at the muscle component nearest its gutter side, then order
    // by that target's y so leaders never cross. Each label sits AT its target y
    // (giving a flat, horizontal leader) and only slides down when the previous
    // label is too close — the single straight leader tilts only when it must.
    const rows = arr
      .map((a) => ({ a, tgt: nearestCenter(a, gx) }))
      .sort((p, q) => p.tgt.y - q.tgt.y);
    let prevY = -1e9;
    for (const { a, tgt } of rows) {
      const ly = Math.max(tgt.y, prevY + minGap);
      prevY = ly;
      const note = a.part.notes.length ? a.part.notes[0]! : '';
      const dl = ` class="dgmo-body-part" data-line-number="${a.part.lineNumber}" data-emph-key="${esc(a.emph)}"`;
      labels +=
        `<path${dl} d="M${sx} ${ly} L${tgt.x} ${tgt.y}" stroke="${a.color}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke" fill="none" opacity="0.85"/>` +
        `<circle${dl} cx="${tgt.x}" cy="${tgt.y}" r="5.5" fill="${a.color}" stroke="${palette.bg}" stroke-width="2" vector-effect="non-scaling-stroke"/>` +
        `<text${dl} x="${gx}" y="${ly + (note ? -2 : 7)}" text-anchor="${anchorX}" font-size="${LABEL_FONT}" font-weight="700" fill="${palette.text}">${esc(partLabel(a.part))}</text>`;
      if (note) {
        labels += `<text${dl} x="${gx}" y="${ly + 22}" text-anchor="${anchorX}" font-size="${NOTE_FONT}" fill="${palette.textMuted}">${esc(note)}</text>`;
      }
    }
  };
  place(left, 'L');
  place(right, 'R');
  return labels;
}

export function renderBody(
  container: HTMLDivElement,
  parsed: ParsedBody,
  palette: PaletteColors,
  _isDark: boolean,
  _onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions,
  tagOverride?: string
): void {
  const accent = getSeriesColors(palette)[0]!;
  const activeGroup = resolveActiveTagGroup(
    parsed.tagGroups,
    undefined,
    tagOverride
  );
  const partColor = (part: BodyPart): string =>
    resolveTagColor(part.metadata, parsed.tagGroups as never, activeGroup) ??
    accent;
  // Tag value that colours this part, for legend↔chart hover pairing.
  const emphKey = (part: BodyPart): string =>
    activeGroup ? (part.metadata[tagAttrKey(activeGroup)] ?? '') : '';

  const defs: string[] = [];
  const rendered = parsed.options.views.map((view) =>
    renderFigureBody(
      getFigure(parsed.options.sex, view),
      view,
      parsed.parts,
      partColor,
      emphKey,
      parsed.options.form,
      palette,
      _isDark,
      parsed.options.fillMode,
      defs
    )
  );
  // Figures are scaled/aligned by their CONTENT box (real body extent), not the
  // padded viewBox, so front/back tops and bottoms line up exactly.
  const figH = Math.max(...rendered.map((r) => r.fig.contentBox.h));

  let body = '';
  let totalW: number;

  if (rendered.length === 1) {
    // ── Single view: figure with outer gutter labels ──
    const r = rendered[0]!;
    const gutter = r.vw * 0.42;
    const tx = OUTER_MARGIN + gutter - r.vx;
    const ty = TITLE_PAD - r.vy;
    body = `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)})">${r.body}${gutterLabels(r, palette)}</g>`;
    totalW = OUTER_MARGIN * 2 + gutter * 2 + r.vw;
  } else {
    // ── Dual view: figures flank a central label column, content-box aligned ──
    const fL = rendered[0]!;
    const fR = rendered[1]!;
    const cbL = fL.fig.contentBox;
    const cbR = fR.fig.contentBox;
    const sL = figH / cbL.h;
    const sR = figH / cbR.h;
    const leftX = OUTER_MARGIN; // fL content-box left edge on the canvas
    const rightX = OUTER_MARGIN + cbL.w * sL + CENTER_COL; // fR content-box left edge
    // Map the figure's content-box top-left → (bandLeft, TITLE_PAD), scaled.
    const txL = leftX - cbL.x * sL;
    const txR = rightX - cbR.x * sR;
    const tyL = TITLE_PAD - cbL.y * sL;
    const tyR = TITLE_PAD - cbR.y * sR;
    body += `<g transform="translate(${txL.toFixed(2)} ${tyL.toFixed(2)}) scale(${sL.toFixed(4)})">${fL.body}</g>`;
    body += `<g transform="translate(${txR.toFixed(2)} ${tyR.toFixed(2)}) scale(${sR.toFixed(4)})">${fR.body}</g>`;
    totalW = OUTER_MARGIN * 2 + cbL.w * sL + CENTER_COL + cbR.w * sR;
    const centerX = OUTER_MARGIN + cbL.w * sL + CENTER_COL / 2;
    // Map a figure's raw anchor into scaled master coords.
    const mapL = (a: { x: number; y: number }) => ({
      x: txL + a.x * sL,
      y: tyL + a.y * sL,
    });
    const mapR = (a: { x: number; y: number }) => ({
      x: txR + a.x * sR,
      y: tyR + a.y * sR,
    });

    // One label per unique part name, with leaders to whichever figure(s) hold it.
    interface Item {
      name: string;
      note: string;
      color: string;
      emph: string;
      line: number;
      left?: { x: number; y: number };
      right?: { x: number; y: number };
      y: number;
    }
    const seen = new Set<string>();
    const items: Item[] = [];
    for (const part of parsed.parts) {
      const nm = partKey(part);
      if (seen.has(nm)) continue;
      const aL = fL.anchors.get(nm);
      const aR = fR.anchors.get(nm);
      if (!aL && !aR) continue;
      seen.add(nm);
      // Central label column sits between the figures, so aim each figure's
      // leader at the muscle component nearest that inner edge.
      const left = aL ? mapL(nearestCenter(aL, fL.vx + fL.vw)) : undefined;
      const right = aR ? mapR(nearestCenter(aR, fR.vx)) : undefined;
      const ys = [left?.y, right?.y].filter((v): v is number => v != null);
      items.push({
        name: partLabel(part),
        note: part.notes.length ? part.notes[0]! : '',
        color: (aL ?? aR)!.color,
        emph: (aL ?? aR)!.emph,
        line: part.lineNumber,
        ...(left && { left }),
        ...(right && { right }),
        y: ys.reduce((s, v) => s + v, 0) / ys.length,
      });
    }
    items.sort((a, b) => a.y - b.y);

    // De-collide label Y positions in the central column.
    const minGap = figH * 0.052;
    let prevY = -1e9;
    for (const it of items) {
      it.y = Math.max(it.y, prevY + minGap);
      prevY = it.y;
    }

    let labels = '';
    const stub = 96; // leader start offset from center, clears the label text
    for (const it of items) {
      const dl = ` class="dgmo-body-part" data-line-number="${it.line}" data-emph-key="${esc(it.emph)}"`;
      if (it.left) {
        labels +=
          `<path${dl} d="M${(centerX - stub).toFixed(1)} ${it.y.toFixed(1)} L${it.left.x.toFixed(1)} ${it.left.y.toFixed(1)}" stroke="${it.color}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke" fill="none" opacity="0.85"/>` +
          `<circle${dl} cx="${it.left.x.toFixed(1)}" cy="${it.left.y.toFixed(1)}" r="5.5" fill="${it.color}" stroke="${palette.bg}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      }
      if (it.right) {
        labels +=
          `<path${dl} d="M${(centerX + stub).toFixed(1)} ${it.y.toFixed(1)} L${it.right.x.toFixed(1)} ${it.right.y.toFixed(1)}" stroke="${it.color}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke" fill="none" opacity="0.85"/>` +
          `<circle${dl} cx="${it.right.x.toFixed(1)}" cy="${it.right.y.toFixed(1)}" r="5.5" fill="${it.color}" stroke="${palette.bg}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      }
      labels += `<text${dl} x="${centerX}" y="${(it.y - 3).toFixed(1)}" text-anchor="middle" font-size="${LABEL_FONT}" font-weight="700" fill="${palette.text}">${esc(it.name)}</text>`;
      if (it.note) {
        labels += `<text${dl} x="${centerX}" y="${(it.y + 20).toFixed(1)}" text-anchor="middle" font-size="${NOTE_FONT}" fill="${palette.textMuted}">${esc(it.note)}</text>`;
      }
    }
    body += labels;
  }

  const totalH = TITLE_PAD + figH + BOTTOM_PAD;
  const exportMode = !!exportDims;

  // ── SVG root (built via d3 so the shared legend framework can attach) ──
  d3Selection.select(container).selectAll('svg').remove();
  const width = exportDims?.width ?? container.clientWidth ?? 1200;
  const height = exportDims?.height ?? container.clientHeight ?? 800;
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr(
      'viewBox',
      `${-PAGE_MARGIN} ${-PAGE_MARGIN} ${(totalW + 2 * PAGE_MARGIN).toFixed(0)} ${(totalH + 2 * PAGE_MARGIN).toFixed(0)}`
    )
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .style('font-family', FONT_FAMILY);

  if (defs.length) svg.append('defs').html(defs.join(''));
  svg.append('g').html(body); // figures + labels

  // Title (centered over the whole canvas).
  if (parsed.title && !parsed.options.noTitle) {
    svg
      .append('text')
      .attr('x', totalW / 2)
      .attr('y', 40)
      .attr('text-anchor', 'middle')
      .attr('font-size', 34)
      .attr('font-weight', 700)
      .attr('fill', palette.text)
      .text(parsed.title);
  }

  // ── Shared tag legend, in a band below the title ──
  if (!parsed.options.noLegend && parsed.tagGroups.length) {
    const legendG = svg
      .append('g')
      .attr('transform', `translate(0, ${TITLE_H}) scale(${LEGEND_SCALE})`);
    const groups: LegendGroupData[] = parsed.tagGroups.map((g) => ({
      name: g.name,
      entries: g.entries.map((e) => ({
        value: e.value,
        color: resolveColor(e.color, palette) ?? e.color,
      })),
    }));
    renderIntegratedLegend(legendG, {
      groups,
      palette,
      isDark: _isDark,
      // Legend lays out in its own (pre-scale) coordinate space; passing the
      // de-scaled width keeps it centered after the scale transform.
      width: totalW / LEGEND_SCALE,
      mode: exportMode ? 'export' : 'preview',
      activeGroup,
    });
  }
}

export function renderBodyForExport(
  container: HTMLDivElement,
  parsed: ParsedBody,
  palette: PaletteColors,
  isDark: boolean,
  exportDims?: D3ExportDimensions,
  tagOverride?: string
): void {
  renderBody(
    container,
    parsed,
    palette,
    isDark,
    undefined,
    exportDims,
    tagOverride
  );
}
