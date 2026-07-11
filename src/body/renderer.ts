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
import { getSeriesColors, mix } from '../palettes/color-utils';
import { resolveColor } from '../colors';
import { FONT_FAMILY } from '../fonts';
import { resolveActiveTagGroup, resolveTagColor } from '../utils/tag-groups';
import { renderIntegratedLegend } from '../utils/legend-integration';
import type { LegendGroupData } from '../utils/legend-types';
import { getFigure, resolvePartKey } from './catalog';
import type { BodyFigure, BodyPart, ParsedBody } from './types';

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
      part: BodyPart;
    }
  >;
  vx: number;
  vy: number;
  vw: number;
  vh: number;
}

/** Render a figure's body (no labels) + collect per-part anchors in raw coords. */
function renderFigureBody(
  fig: BodyFigure,
  parts: readonly BodyPart[],
  partColor: (p: BodyPart) => string,
  form: ParsedBody['options']['form'],
  palette: PaletteColors,
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
      part: BodyPart;
    }
  >();
  for (const part of parts) {
    const key = resolvePartKey(fig, part.name);
    if (!key) continue;
    const geom = fig.parts[key]!;
    const color = partColor(part);
    const dataLine = ` class="dgmo-body-part" data-line-number="${part.lineNumber}"`;
    if (form === 'skin') {
      for (const d of geom.paths) {
        out += `<path${dataLine} d="${d}" fill="${color}" fill-opacity="0.5" stroke="${color}" stroke-width="1.5"/>`;
      }
    } else {
      // Muted fill (~70% colour, 30% bg) with a full-strength coloured edge —
      // clearly filled, but soft enough that the leader line reads across it.
      const lightFill = mix(color, palette.bg, 70);
      for (const d of geom.paths) {
        out += `<path${dataLine} d="${d}" fill="${lightFill}" stroke="${color}" stroke-width="1.5"/>`;
      }
    }
    anchors.set(part.name.toLowerCase(), {
      x: geom.anchor.x,
      y: geom.anchor.y,
      centers: geom.centers?.length
        ? geom.centers.map((c) => ({ x: c.x, y: c.y }))
        : [{ x: geom.anchor.x, y: geom.anchor.y }],
      color,
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
  const left = list.filter((a) => a.x < cx).sort((a, b) => a.y - b.y);
  const right = list.filter((a) => a.x >= cx).sort((a, b) => a.y - b.y);
  let labels = '';
  const place = (arr: typeof list, side: 'L' | 'R'): void => {
    const gx = side === 'L' ? vx - 14 : vx + vw + 14;
    const anchorX = side === 'L' ? 'end' : 'start';
    const minGap = vh * 0.05;
    let prevY = -1e9;
    for (const a of arr) {
      // Aim at the muscle component nearest this label's gutter side.
      const tgt = nearestCenter(a, gx);
      const ly = Math.max(tgt.y - 6, prevY + minGap);
      prevY = ly;
      const note = a.part.notes.length ? a.part.notes[0]! : '';
      labels +=
        `<path d="M${gx} ${ly} L${tgt.x} ${tgt.y}" stroke="${a.color}" stroke-width="1.6" fill="none" opacity="0.75"/>` +
        `<circle cx="${tgt.x}" cy="${tgt.y}" r="5.5" fill="${a.color}" stroke="${palette.bg}" stroke-width="2"/>` +
        `<text x="${gx}" y="${ly - 3}" text-anchor="${anchorX}" font-size="${LABEL_FONT}" font-weight="700" fill="${palette.text}">${esc(a.part.name)}</text>`;
      if (note) {
        labels += `<text x="${gx}" y="${ly + 21}" text-anchor="${anchorX}" font-size="${NOTE_FONT}" fill="${palette.textMuted}">${esc(note)}</text>`;
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

  const defs: string[] = [];
  const rendered = parsed.options.views.map((view) =>
    renderFigureBody(
      getFigure(parsed.options.sex, view),
      parsed.parts,
      partColor,
      parsed.options.form,
      palette,
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
      left?: { x: number; y: number };
      right?: { x: number; y: number };
      y: number;
    }
    const seen = new Set<string>();
    const items: Item[] = [];
    for (const part of parsed.parts) {
      const nm = part.name.toLowerCase();
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
        name: part.name,
        note: part.notes.length ? part.notes[0]! : '',
        color: (aL ?? aR)!.color,
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
      if (it.left) {
        labels +=
          `<path d="M${(centerX - stub).toFixed(1)} ${it.y.toFixed(1)} L${it.left.x.toFixed(1)} ${it.left.y.toFixed(1)}" stroke="${it.color}" stroke-width="1.6" fill="none" opacity="0.75"/>` +
          `<circle cx="${it.left.x.toFixed(1)}" cy="${it.left.y.toFixed(1)}" r="5.5" fill="${it.color}" stroke="${palette.bg}" stroke-width="2"/>`;
      }
      if (it.right) {
        labels +=
          `<path d="M${(centerX + stub).toFixed(1)} ${it.y.toFixed(1)} L${it.right.x.toFixed(1)} ${it.right.y.toFixed(1)}" stroke="${it.color}" stroke-width="1.6" fill="none" opacity="0.75"/>` +
          `<circle cx="${it.right.x.toFixed(1)}" cy="${it.right.y.toFixed(1)}" r="5.5" fill="${it.color}" stroke="${palette.bg}" stroke-width="2"/>`;
      }
      labels += `<text x="${centerX}" y="${(it.y - 3).toFixed(1)}" text-anchor="middle" font-size="${LABEL_FONT}" font-weight="700" fill="${palette.text}">${esc(it.name)}</text>`;
      if (it.note) {
        labels += `<text x="${centerX}" y="${(it.y + 20).toFixed(1)}" text-anchor="middle" font-size="${NOTE_FONT}" fill="${palette.textMuted}">${esc(it.note)}</text>`;
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
  if (parsed.title) {
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
