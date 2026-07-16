// ============================================================
// Venn renderer — Story 109.2 (arch-review). Extracted from d3.ts.
// ============================================================

import type * as d3Selection from 'd3-selection';
import { measureText, wrapTextToWidth } from '../utils/text-measure';
import type { D3ExportDimensions } from '../utils/d3-types';
import { ScaleContext } from '../utils/scaling';
import { initD3Chart, renderChartTitle } from '../utils/d3-helpers';
import type { ParsedVenn, VennOverlap } from '../visualizations/types';
import type { PaletteColors } from '../palettes';
import { mix } from '../palettes/color-utils';

interface Point {
  x: number;
  y: number;
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

function fitCirclesToContainerAsymmetric(
  circles: Circle[],
  w: number,
  h: number,
  mLeft: number,
  mRight: number,
  mTop: number,
  mBottom: number
): Circle[] {
  if (circles.length === 0) return [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const c of circles) {
    minX = Math.min(minX, c.x - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    minY = Math.min(minY, c.y - c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  const availW = w - mLeft - mRight;
  const availH = h - mTop - mBottom;
  const scale = Math.min(availW / bw, availH / bh);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const tx = mLeft + availW / 2;
  const ty = mTop + availH / 2;
  return circles.map((c) => ({
    x: (c.x - cx) * scale + tx,
    y: (c.y - cy) * scale + ty,
    r: c.r * scale,
  }));
}

function pointInCircle(p: Point, c: Circle): boolean {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return dx * dx + dy * dy <= c.r * c.r + 1e-6;
}

function regionCentroid(circles: Circle[], inside: boolean[]): Point {
  // Deterministic 50×50 grid scan instead of random sampling
  const GRID = 50;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const c of circles) {
    minX = Math.min(minX, c.x - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    minY = Math.min(minY, c.y - c.r);
    maxY = Math.max(maxY, c.y + c.r);
  }
  const stepX = (maxX - minX) / GRID;
  const stepY = (maxY - minY) / GRID;
  let sx = 0,
    sy = 0,
    count = 0;
  for (let gi = 0; gi <= GRID; gi++) {
    const x = minX + gi * stepX;
    for (let gj = 0; gj <= GRID; gj++) {
      const y = minY + gj * stepY;
      let match = true;
      for (let j = 0; j < circles.length; j++) {
        // In-bounds by loop guard.
        const isIn = pointInCircle({ x, y }, circles[j]!);
        if (isIn !== inside[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        sx += x;
        sy += y;
        count++;
      }
    }
  }
  if (count === 0) {
    // Fallback: centroid of the circles that should be "inside"
    let fx = 0,
      fy = 0,
      fc = 0;
    for (let j = 0; j < circles.length; j++) {
      if (inside[j]) {
        // In-bounds by loop guard.
        fx += circles[j]!.x;
        fy += circles[j]!.y;
        fc++;
      }
    }
    return { x: fx / (fc || 1), y: fy / (fc || 1) };
  }
  return { x: sx / count, y: sy / count };
}

// ============================================================
// Venn Diagram Renderer
// ============================================================

export function renderVenn(
  container: HTMLDivElement,
  parsed: ParsedVenn,
  palette: PaletteColors,
  _isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { vennSets, vennOverlaps } = parsed;
  const fillMode = parsed.fillMode;
  const title = parsed.noTitle ? null : parsed.title;
  if (vennSets.length < 2 || vennSets.length > 3) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, colors } = init;
  const n = vennSets.length;

  const idealWidth = n === 2 ? 500 : 600;
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sTitleHeight = title ? ctx.aesthetic(40) : 0;

  svg.attr('preserveAspectRatio', 'xMidYMid meet');
  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  // ── Equal-radius layout with ~30% overlap depth ──
  // All circles share the same base radius; center distance = 1.4r gives ~30% penetration
  const BASE_R = 100;
  const OVERLAP_DISTANCE = BASE_R * 1.4;

  let rawCircles: Circle[];
  if (n === 2) {
    rawCircles = [
      { x: -OVERLAP_DISTANCE / 2, y: 0, r: BASE_R },
      { x: OVERLAP_DISTANCE / 2, y: 0, r: BASE_R },
    ];
  } else {
    // Equilateral triangle with side = OVERLAP_DISTANCE
    const s = OVERLAP_DISTANCE;
    const h = (Math.sqrt(3) / 2) * s;
    rawCircles = [
      { x: -s / 2, y: h / 3, r: BASE_R },
      { x: s / 2, y: h / 3, r: BASE_R },
      { x: 0, y: -(2 * h) / 3, r: BASE_R },
    ];
  }

  // Resolve colors for each set
  const setColors = vennSets.map(
    // colors is non-empty; modulo guarantees in-bounds.
    (s, i) => s.color ?? colors[i % colors.length]!
  );

  // ── Layout-aware centering with label space ──
  const clusterCx = rawCircles.reduce((s, c) => s + c.x, 0) / n;
  const clusterCy = rawCircles.reduce((s, c) => s + c.y, 0) / n;

  let marginLeft = ctx.aesthetic(30),
    marginRight = ctx.aesthetic(30),
    marginTop = ctx.aesthetic(30),
    marginBottom = ctx.aesthetic(30);
  const stubLen = ctx.structural(20);
  const edgePad = ctx.aesthetic(8);
  const labelTextPad = ctx.aesthetic(4);

  const sSetLabelFont = ctx.text(14);

  for (let i = 0; i < n; i++) {
    // In-bounds by loop guard (n === vennSets.length === rawCircles.length).
    const estimatedWidth =
      measureText(vennSets[i]!.name, sSetLabelFont) +
      stubLen +
      edgePad +
      labelTextPad;
    const dx = rawCircles[i]!.x - clusterCx;
    const dy = rawCircles[i]!.y - clusterCy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) marginRight = Math.max(marginRight, estimatedWidth);
      else marginLeft = Math.max(marginLeft, estimatedWidth);
    } else {
      const halfEstimate = estimatedWidth * 0.5;
      if (dy >= 0)
        marginBottom = Math.max(marginBottom, halfEstimate + ctx.aesthetic(20));
      else marginTop = Math.max(marginTop, halfEstimate + ctx.aesthetic(20));
    }
  }

  // Pre-wrap overlap labels and reserve margin so circles shrink enough
  // to leave readable space outside for leader+text. Wrap target scales
  // with the canvas so labels stay narrow on small windows.
  const OVERLAP_FONT = ctx.text(13);
  const OVERLAP_LINE_H = ctx.structural(16);
  const OVERLAP_LEADER_PAD = ctx.structural(18);
  const OVERLAP_TEXT_GAP = ctx.aesthetic(6);
  const OVERLAP_MARGIN_PAD = ctx.aesthetic(12);
  const OVERLAP_WRAP_TARGET_W = Math.max(
    ctx.structural(80),
    Math.min(ctx.structural(170), width * 0.18)
  );

  function predictOverlapDirRaw(idxs: number[]): { x: number; y: number } {
    const excluded = rawCircles
      .map((_, j) => j)
      .filter((j) => !idxs.includes(j));
    if (excluded.length > 0) {
      let sx = 0,
        sy = 0;
      for (const ei of excluded) {
        // ei comes from rawCircles' index map above.
        sx += rawCircles[ei]!.x;
        sy += rawCircles[ei]!.y;
      }
      sx /= excluded.length;
      sy /= excluded.length;
      let cx = 0,
        cy = 0;
      for (const ci of idxs) {
        // ci is a valid index into rawCircles by caller's contract.
        cx += rawCircles[ci]!.x;
        cy += rawCircles[ci]!.y;
      }
      cx /= idxs.length;
      cy /= idxs.length;
      const dx = cx - sx;
      const dy = cy - sy;
      const m = Math.sqrt(dx * dx + dy * dy);
      if (m >= 1e-6) return { x: dx / m, y: dy / m };
    }
    if (n === 3) return { x: 0, y: -1 };
    return { x: 0, y: 1 };
  }

  const wrappedOverlapLabels = new Map<VennOverlap, string[]>();
  for (const ov of vennOverlaps) {
    if (!ov.label) continue;
    const idxs = ov.sets.map((s) => vennSets.findIndex((vs) => vs.name === s));
    if (idxs.some((idx) => idx < 0)) continue;
    const lines = wrapTextToWidth(
      ov.label,
      OVERLAP_FONT,
      OVERLAP_WRAP_TARGET_W
    );
    wrappedOverlapLabels.set(ov, lines);

    const dir = predictOverlapDirRaw(idxs);
    const labelW = lines.reduce(
      (m, l) => Math.max(m, measureText(l, OVERLAP_FONT)),
      0
    );
    const labelH = lines.length * OVERLAP_LINE_H;
    const baseLeader =
      OVERLAP_LEADER_PAD + OVERLAP_TEXT_GAP + OVERLAP_MARGIN_PAD;

    if (Math.abs(dir.x) >= Math.abs(dir.y)) {
      const need = labelW + baseLeader;
      if (dir.x >= 0) marginRight = Math.max(marginRight, need);
      else marginLeft = Math.max(marginLeft, need);
      // Multi-line label also reaches vertically; reserve half its height
      const halfH = labelH / 2;
      if (dir.y >= 0) marginBottom = Math.max(marginBottom, halfH + 8);
      else marginTop = Math.max(marginTop, halfH + 8);
    } else {
      // Triple-overlap leader exits the union at the top circle's top
      // edge — exactly where that circle's set label gets placed when
      // it can't fit inside (small canvases). Use a longer leader pad
      // so the triple text clears the set label.
      const isStackedTriple = idxs.length === 3 && n === 3 && dir.y < 0;
      const padBoost = isStackedTriple ? 32 : 0;
      const need = labelH + baseLeader + padBoost;
      if (dir.y >= 0) marginBottom = Math.max(marginBottom, need);
      else marginTop = Math.max(marginTop, need);
    }
  }

  const drawH = height - sTitleHeight;
  // Cap margins so the figure always keeps a usable share of the canvas.
  // If labels need more space than the cap allows the leader+text logic
  // will clamp them to the viewport instead of letting circles shrink to
  // unreadable.
  const maxSideMarginX = width * 0.32;
  const maxSideMarginY = drawH * 0.4;
  marginLeft = Math.min(marginLeft, maxSideMarginX);
  marginRight = Math.min(marginRight, maxSideMarginX);
  marginTop = Math.min(marginTop, maxSideMarginY);
  marginBottom = Math.min(marginBottom, maxSideMarginY);
  const circles = fitCirclesToContainerAsymmetric(
    rawCircles,
    width,
    drawH,
    marginLeft,
    marginRight,
    marginTop,
    marginBottom
  ).map((c) => ({ ...c, y: c.y + sTitleHeight }));

  // circles is non-empty: vennSets.length >= 2 guard above ensures rawCircles is sized.
  const scaledR = circles[0]!.r;

  // Suppress WebKit focus ring on interactive SVG elements
  svg
    .append('style')
    .text(
      'circle:focus, circle:focus-visible { outline-solid: none !important; }'
    );

  // Title
  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  // ── Semi-transparent filled circles (non-interactive) ──
  const circleEls: d3Selection.Selection<
    SVGCircleElement,
    unknown,
    null,
    undefined
  >[] = [];
  const circleGroup = svg.append('g');
  circles.forEach((c, i) => {
    const el = circleGroup
      .append('circle')
      .attr('cx', c.x)
      .attr('cy', c.y)
      .attr('r', c.r)
      // setColors was built from vennSets via map, so i is in-bounds.
      .attr('fill', setColors[i]!)
      .attr(
        'fill-opacity',
        fillMode === 'solid' ? 0.6 : fillMode === 'outline' ? 0 : 0.35
      )
      .attr('stroke', setColors[i]!)
      .attr('stroke-width', ctx.structural(2))
      .style('pointer-events', 'none') as d3Selection.Selection<
      SVGCircleElement,
      unknown,
      null,
      undefined
    >;
    circleEls.push(el);
  });

  // ── Per-region highlight overlays (section-only, not full circles) ──
  // Build SVG defs with clipPaths + masks so each region can be highlighted independently.
  const defs = svg.append('defs');

  // Individual circle clipPaths
  circles.forEach((c, i) => {
    defs
      .append('clipPath')
      .attr('id', `vcp-${i}`)
      .append('circle')
      .attr('cx', c.x)
      .attr('cy', c.y)
      .attr('r', c.r);
  });

  // All region index-sets: exclusive then intersection subsets
  const regionIdxSets: number[][] = circles.map((_, i) => [i]);
  if (n === 2) {
    regionIdxSets.push([0, 1]);
  } else {
    regionIdxSets.push([0, 1], [0, 2], [1, 2], [0, 1, 2]);
  }

  const overlayGroup = svg.append('g').style('pointer-events', 'none');
  const overlayEls = new Map<
    string,
    d3Selection.Selection<SVGRectElement, unknown, null, undefined>
  >();

  for (const idxs of regionIdxSets) {
    const key = idxs.join('-');
    const excluded = Array.from({ length: n }, (_, j) => j).filter(
      (j) => !idxs.includes(j)
    );

    // Build nested clipPath for intersection of all idxs
    // idxs is non-empty by construction in regionIdxSets.
    let clipId = `vcp-${idxs[0]!}`;
    for (let k = 1; k < idxs.length; k++) {
      const nestedId = `vcp-n-${idxs.slice(0, k + 1).join('-')}`;
      // k is in-bounds by loop guard.
      const ci = idxs[k]!;
      defs
        .append('clipPath')
        .attr('id', nestedId)
        .append('circle')
        // ci is a valid index into circles by caller's contract.
        .attr('cx', circles[ci]!.x)
        .attr('cy', circles[ci]!.y)
        .attr('r', circles[ci]!.r)
        .attr('clip-path', `url(#${clipId})`);
      clipId = nestedId;
    }

    // Determine line number for this region (for editor sync)
    let regionLineNumber: number | null = null; // eslint-disable-line no-useless-assignment
    if (idxs.length === 1) {
      // idxs[0] guaranteed by length check above.
      regionLineNumber = vennSets[idxs[0]!]!.lineNumber;
    } else {
      const sortedNames = idxs.map((i) => vennSets[i]!.name).sort();
      const ov = vennOverlaps.find(
        (o) =>
          o.sets.length === sortedNames.length &&
          o.sets.every((s, k) => s === sortedNames[k])
      );
      regionLineNumber = ov?.lineNumber ?? null;
    }

    const el = overlayGroup
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'white')
      .attr('fill-opacity', 0)
      .attr('class', 'venn-region-overlay')
      .attr(
        'data-line-number',
        regionLineNumber != null ? String(regionLineNumber) : '0'
      )
      .attr('clip-path', `url(#${clipId})`);

    if (excluded.length > 0) {
      // Mask subtracts excluded circles so only the exact region shape highlights
      const maskId = `vvm-${key}`;
      const mask = defs.append('mask').attr('id', maskId);
      mask
        .append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', width)
        .attr('height', height)
        .attr('fill', 'white');
      for (const j of excluded) {
        // excluded is built from circles' indices, so j is in-bounds.
        mask
          .append('circle')
          .attr('cx', circles[j]!.x)
          .attr('cy', circles[j]!.y)
          .attr('r', circles[j]!.r)
          .attr('fill', 'black');
      }
      el.attr('mask', `url(#${maskId})`);
    }

    overlayEls.set(key, el);
  }

  // Registry of label wrapper <g>s keyed by region (sorted idxs joined by
  // '-'), so hovering a shape can dim non-matching labels and hovering a
  // label can highlight the matching shape overlay.
  const labelEls = new Map<
    string,
    d3Selection.Selection<SVGGElement, unknown, null, undefined>[]
  >();
  function registerLabel(
    key: string,
    el: d3Selection.Selection<SVGGElement, unknown, null, undefined>
  ) {
    if (!labelEls.has(key)) labelEls.set(key, []);
    labelEls.get(key)!.push(el);
  }
  function dimLabelsExcept(matchKey: string | null) {
    labelEls.forEach((els, k) => {
      const op = matchKey === null || k === matchKey ? 1 : 0.2;
      els.forEach((el) => el.attr('opacity', op));
    });
  }

  const showRegionOverlay = (idxs: number[]) => {
    const key = [...idxs].sort((a, b) => a - b).join('-');
    overlayEls.forEach((el, k) =>
      el.attr('fill-opacity', k === key ? 0 : 0.55)
    );
    dimLabelsExcept(key);
  };
  const hideAllOverlays = () => {
    overlayEls.forEach((el) => el.attr('fill-opacity', 0));
    dimLabelsExcept(null);
  };

  // ── Labels ──
  const gcx = circles.reduce((s, c) => s + c.x, 0) / n;
  const gcy = circles.reduce((s, c) => s + c.y, 0) / n;

  function exclusiveHSpan(_px: number, py: number, ci: number): number {
    // ci is in-bounds: caller passes a circle index.
    const cci = circles[ci]!;
    const dy = py - cci.y;
    const halfChord = Math.sqrt(Math.max(0, cci.r * cci.r - dy * dy));
    let left = cci.x - halfChord;
    let right = cci.x + halfChord;
    for (let j = 0; j < n; j++) {
      if (j === ci) continue;
      // In-bounds: n === circles.length.
      const cj = circles[j]!;
      const djy = py - cj.y;
      if (Math.abs(djy) >= cj.r) continue;
      const hc = Math.sqrt(cj.r * cj.r - djy * djy);
      const jLeft = cj.x - hc;
      const jRight = cj.x + hc;
      if (jLeft <= left && jRight >= right) return 0;
      if (jLeft <= left && jRight > left) left = jRight;
      if (jRight >= right && jLeft < right) right = jLeft;
    }
    return Math.max(0, right - left);
  }

  const MIN_FONT = ctx.text(10);
  const MAX_FONT = ctx.text(22);
  const INTERNAL_PAD = ctx.aesthetic(12);

  const labelGroup = svg.append('g');

  // Bboxes of rendered set labels, used to clip overlap leader lines
  // so they don't draw through the set name text.
  type Bbox = { x: number; y: number; w: number; h: number };
  const setLabelBBoxes: Array<Bbox | null> = circles.map(() => null);

  // Set name labels: prefer inside exclusive region, fall back to external leader line
  circles.forEach((c, i) => {
    // vennSets.length === circles.length by construction.
    const text = vennSets[i]!.name;
    const inside = circles.map((_, j) => j === i);
    const centroid = regionCentroid(circles, inside);

    const availW = exclusiveHSpan(centroid.x, centroid.y, i);
    // Width of `text` at fontSize 1; scale to solve for the largest fitting font.
    const textWidthPerPx = measureText(text, 1);
    const fitFont = Math.min(
      MAX_FONT,
      Math.max(MIN_FONT, (availW - INTERNAL_PAD * 2) / textWidthPerPx)
    );
    const estTextW = measureText(text, fitFont);

    const fitsInside =
      estTextW + INTERNAL_PAD * 2 < availW &&
      pointInCircle({ x: centroid.x, y: centroid.y - fitFont / 2 }, c) &&
      pointInCircle({ x: centroid.x, y: centroid.y + fitFont / 2 }, c);

    const setKey = String(i);
    const labelG = labelGroup
      .append('g')
      .style('cursor', 'default')
      .on('mouseenter', () => showRegionOverlay([i]))
      .on('mouseleave', () => hideAllOverlays());
    registerLabel(setKey, labelG);

    if (fitsInside) {
      labelG
        .append('text')
        .attr('x', centroid.x)
        .attr('y', centroid.y)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', textColor)
        .attr('font-size', `${Math.round(fitFont)}px`)
        .attr('font-weight', 'bold')
        .text(text);
      setLabelBBoxes[i] = {
        x: centroid.x - estTextW / 2,
        y: centroid.y - fitFont / 2,
        w: estTextW,
        h: fitFont,
      };
    } else {
      let dx = c.x - gcx;
      let dy = c.y - gcy;
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag < 1e-6) {
        dx = 1;
        dy = 0;
      } else {
        dx /= mag;
        dy /= mag;
      }

      const exitX = c.x + dx * c.r;
      const exitY = c.y + dy * c.r;
      const edgeX = exitX + dx * edgePad;
      const edgeY = exitY + dy * edgePad;
      const stubEndX = edgeX + dx * stubLen;
      const stubEndY = edgeY + dy * stubLen;

      labelG
        .append('line')
        .attr('x1', edgeX)
        .attr('y1', edgeY)
        .attr('x2', stubEndX)
        .attr('y2', stubEndY)
        .attr('stroke', textColor)
        .attr('stroke-width', ctx.structural(1));

      const isRight = stubEndX >= gcx;
      const textAnchor = isRight ? 'start' : 'end';
      let textX = stubEndX + (isRight ? labelTextPad : -labelTextPad);
      const textY = stubEndY;
      const estW = measureText(text, sSetLabelFont);
      if (isRight) textX = Math.min(textX, width - estW - 4);
      else textX = Math.max(textX, estW + 4);

      const renderedTextY = Math.max(
        sSetLabelFont,
        Math.min(height - 4, textY)
      );
      labelG
        .append('text')
        .attr('x', textX)
        .attr('y', renderedTextY)
        .attr('text-anchor', textAnchor)
        .attr('dominant-baseline', 'central')
        .attr('fill', textColor)
        .attr('font-size', `${sSetLabelFont}px`)
        .attr('font-weight', 'bold')
        .text(text);
      const externalEstW = measureText(text, sSetLabelFont);
      setLabelBBoxes[i] = {
        x: isRight ? textX : textX - externalEstW,
        y: renderedTextY - sSetLabelFont / 2,
        w: externalEstW,
        h: sSetLabelFont,
      };
    }
  });

  // Splits a line into visible segments that skip any of the given rects
  // (with optional padding). Used so overlap leaders don't draw through
  // set name text.
  function clipLineByRects(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    rects: Bbox[],
    pad = 4
  ): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const skips: Array<[number, number]> = [];
    for (const raw of rects) {
      const rx = raw.x - pad;
      const ry = raw.y - pad;
      const rw = raw.w + 2 * pad;
      const rh = raw.h + 2 * pad;
      let tMin = 0;
      let tMax = 1;
      if (Math.abs(dx) < 1e-9) {
        if (x1 < rx || x1 > rx + rw) continue;
      } else {
        const t1 = (rx - x1) / dx;
        const t2 = (rx + rw - x1) / dx;
        tMin = Math.max(tMin, Math.min(t1, t2));
        tMax = Math.min(tMax, Math.max(t1, t2));
      }
      if (Math.abs(dy) < 1e-9) {
        if (y1 < ry || y1 > ry + rh) continue;
      } else {
        const t1 = (ry - y1) / dy;
        const t2 = (ry + rh - y1) / dy;
        tMin = Math.max(tMin, Math.min(t1, t2));
        tMax = Math.min(tMax, Math.max(t1, t2));
      }
      if (tMin < tMax) skips.push([Math.max(0, tMin), Math.min(1, tMax)]);
    }
    skips.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const s of skips) {
      const last = merged[merged.length - 1];
      if (!last || s[0] > last[1]) merged.push([s[0], s[1]]);
      else last[1] = Math.max(last[1], s[1]);
    }
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    let cursor = 0;
    for (const [s, e] of merged) {
      if (s > cursor)
        segs.push({
          x1: x1 + dx * cursor,
          y1: y1 + dy * cursor,
          x2: x1 + dx * s,
          y2: y1 + dy * s,
        });
      cursor = Math.max(cursor, e);
    }
    if (cursor < 1)
      segs.push({
        x1: x1 + dx * cursor,
        y1: y1 + dy * cursor,
        x2: x2,
        y2: y2,
      });
    return segs;
  }

  // ── Overlap labels (leader line from region centroid to outside the region) ──
  function overlapOutwardDir(centroid: Point, idxs: number[]): Point {
    const excluded = circles.map((_, j) => j).filter((j) => !idxs.includes(j));
    if (excluded.length > 0) {
      let sx = 0,
        sy = 0;
      for (const ei of excluded) {
        // excluded was built from circles' indices.
        sx += circles[ei]!.x;
        sy += circles[ei]!.y;
      }
      sx /= excluded.length;
      sy /= excluded.length;
      const dx = centroid.x - sx;
      const dy = centroid.y - sy;
      const m = Math.sqrt(dx * dx + dy * dy);
      if (m >= 1e-6) {
        // Snap floating-point noise to 0 so axis-aligned checks downstream work.
        const nx = Math.abs(dx / m) < 1e-9 ? 0 : dx / m;
        const ny = Math.abs(dy / m) < 1e-9 ? 0 : dy / m;
        return { x: nx, y: ny };
      }
    }
    // Triple overlap in 3-set Venn: point up so the leader doesn't
    // collide with the pair (0,1) leader going down.
    if (n === 3) return { x: 0, y: -1 };
    return { x: 0, y: 1 };
  }

  // Where the ray (c0, dir) crosses the lens boundary — the first idxs
  // circle it leaves. This is the visual touch point for pair leaders.
  function lensExit(c0: Point, dir: Point, idxs: number[]): Point {
    let minT = Infinity;
    for (const i of idxs) {
      // idxs only contains valid circle indices (built from regionIdxSets).
      const c = circles[i]!;
      const dx = c0.x - c.x;
      const dy = c0.y - c.y;
      const B = dx * dir.x + dy * dir.y;
      const C = dx * dx + dy * dy - c.r * c.r;
      const disc = B * B - C;
      if (disc < 0) continue;
      const t = -B + Math.sqrt(disc);
      if (t > 0 && t < minT) minT = t;
    }
    if (!isFinite(minT)) return { x: c0.x, y: c0.y };
    return { x: c0.x + dir.x * minT, y: c0.y + dir.y * minT };
  }

  // Where the ray clears the union's visual silhouette — used to position
  // text (and the stub end) so they don't overlap any circle. Walks until
  // outside every circle and, for axis-aligned leaders, also past the
  // union's bounding box on the travel axis.
  function unionExit(c0: Point, dir: Point, idxs: number[]): Point {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const c of circles) {
      minX = Math.min(minX, c.x - c.r);
      maxX = Math.max(maxX, c.x + c.r);
      minY = Math.min(minY, c.y - c.r);
      maxY = Math.max(maxY, c.y + c.r);
    }
    const STEP = 3;
    const MAX_ITERS = 400;
    const axisAligned = dir.x === 0 || dir.y === 0;
    let p = { x: c0.x, y: c0.y };
    let leftOverlap = false;
    for (let i = 0; i < MAX_ITERS; i++) {
      const next = { x: p.x + dir.x * STEP, y: p.y + dir.y * STEP };
      p = next;
      if (!leftOverlap) {
        // ci is a valid circle index by caller's contract.
        leftOverlap = !idxs.every((ci) => pointInCircle(next, circles[ci]!));
        if (!leftOverlap) continue;
      }
      const insideAny = circles.some((c) => pointInCircle(next, c));
      if (insideAny) continue;
      if (axisAligned) {
        const passedX = dir.x > 0 ? next.x >= maxX : next.x <= minX;
        const passedY = dir.y > 0 ? next.y >= maxY : next.y <= minY;
        if (dir.x !== 0 && !passedX) continue;
        if (dir.y !== 0 && !passedY) continue;
      }
      break;
    }
    return p;
  }

  for (const ov of vennOverlaps) {
    if (!ov.label) continue;
    const idxs = ov.sets.map((s) => vennSets.findIndex((vs) => vs.name === s));
    if (idxs.some((idx) => idx < 0)) continue;
    const lines = wrappedOverlapLabels.get(ov) ?? [ov.label];
    const inside = circles.map((_, j) => idxs.includes(j));
    const centroid = regionCentroid(circles, inside);
    const dir = overlapOutwardDir(centroid, idxs);
    const isTriple = idxs.length === 3 && n === 3;
    const padBoost = isTriple && dir.y < 0 ? 32 : 0;
    const leaderPad = OVERLAP_LEADER_PAD + padBoost;
    // Pair leaders touch the lens exactly; stub end sits past the union
    // silhouette so text doesn't overlap circles.
    const lensPt = lensExit(centroid, dir, idxs);
    const farExit = unionExit(centroid, dir, idxs);
    const stubEndX = farExit.x + dir.x * leaderPad;
    const stubEndY = farExit.y + dir.y * leaderPad;

    const horizontal = Math.abs(dir.x) >= Math.abs(dir.y);
    let textAnchor: string;
    let baseline = 'central';
    if (horizontal) {
      textAnchor = dir.x >= 0 ? 'start' : 'end';
    } else {
      textAnchor = 'middle';
      baseline = dir.y >= 0 ? 'hanging' : 'auto';
    }

    // For horizontal-dominated leaders, offset text only horizontally and
    // align it vertically with the leader endpoint — otherwise multi-line
    // text blocks engulf the leader's tip. Mirror logic for vertical.
    let textX: number, textY: number;
    if (horizontal) {
      const sign = dir.x >= 0 ? 1 : -1;
      textX = stubEndX + sign * OVERLAP_TEXT_GAP;
      textY = stubEndY;
    } else {
      const sign = dir.y >= 0 ? 1 : -1;
      textX = stubEndX;
      textY = stubEndY + sign * OVERLAP_TEXT_GAP;
    }

    const blockW = lines.reduce(
      (m, l) => Math.max(m, measureText(l, OVERLAP_FONT)),
      0
    );
    const blockH = lines.length * OVERLAP_LINE_H;

    if (textAnchor === 'start') textX = Math.min(textX, width - blockW - 4);
    else if (textAnchor === 'end') textX = Math.max(textX, blockW + 4);
    else
      textX = Math.max(blockW / 2 + 4, Math.min(width - blockW / 2 - 4, textX));

    let topY: number, bottomY: number;
    if (baseline === 'hanging') {
      topY = textY;
      bottomY = textY + blockH;
    } else if (baseline === 'auto') {
      bottomY = textY;
      topY = textY - blockH;
    } else {
      topY = textY - blockH / 2;
      bottomY = textY + blockH / 2;
    }
    if (topY < sTitleHeight + 6) textY += sTitleHeight + 6 - topY;
    else if (bottomY > height - 4) textY -= bottomY - (height - 4);

    const startY =
      baseline === 'hanging'
        ? textY
        : baseline === 'auto'
          ? textY - (lines.length - 1) * OVERLAP_LINE_H
          : textY - ((lines.length - 1) * OVERLAP_LINE_H) / 2;

    // Triple leader runs from the centroid (through the diagram) to the
    // text — preserved per the user's "leave the triple alone" request.
    // Pair leaders start exactly on the lens boundary (analytic), so the
    // line touches the shape it describes.
    const leaderStartX = isTriple ? centroid.x : lensPt.x;
    const leaderStartY = isTriple ? centroid.y : lensPt.y;

    // Tint the leader + text with the average of the constituent set
    // colors so the label visually ties to its overlap region. Mix a bit
    // of the body text color in to keep contrast against the bg.
    // idxs is non-empty; its entries are valid indices into setColors (same length as vennSets).
    let tinted = setColors[idxs[0]!]!;
    for (let k = 1; k < idxs.length; k++) {
      const pct = (k / (k + 1)) * 100;
      // k in-bounds by loop; idxs[k] is a valid setColors index.
      tinted = mix(tinted, setColors[idxs[k]!]!, pct);
    }
    const overlapColor = mix(tinted, textColor, 90);

    const ovKey = [...idxs].sort((a, b) => a - b).join('-');
    const ovLabelG = labelGroup
      .append('g')
      .style('cursor', 'default')
      .on('mouseenter', () => showRegionOverlay(idxs))
      .on('mouseleave', () => hideAllOverlays());
    registerLabel(ovKey, ovLabelG);

    const labelRects = setLabelBBoxes.filter((b): b is Bbox => b !== null);
    const segments = clipLineByRects(
      leaderStartX,
      leaderStartY,
      stubEndX,
      stubEndY,
      labelRects,
      4
    );
    for (const seg of segments) {
      ovLabelG
        .append('line')
        .attr('x1', seg.x1)
        .attr('y1', seg.y1)
        .attr('x2', seg.x2)
        .attr('y2', seg.y2)
        .attr('stroke', overlapColor)
        .attr('stroke-width', ctx.structural(1.25))
        .attr('opacity', 0.85);
    }

    const textEl = ovLabelG
      .append('text')
      .attr('text-anchor', textAnchor)
      .attr('dominant-baseline', baseline)
      .attr('fill', overlapColor)
      .attr('font-size', `${OVERLAP_FONT}px`)
      .attr('font-weight', '600');

    lines.forEach((line, i) => {
      const tspan = textEl.append('tspan').attr('x', textX);
      if (i === 0) tspan.attr('y', startY);
      else tspan.attr('dy', OVERLAP_LINE_H);
      tspan.text(line);
    });
  }

  // ── Hover targets ──
  // Exclusive circle targets first (lower z-order), then intersection targets (higher z-order)
  const hoverGroup = svg.append('g');

  circles.forEach((c, i) => {
    hoverGroup
      .append('circle')
      .attr('cx', c.x)
      .attr('cy', c.y)
      .attr('r', c.r)
      .attr('fill', 'transparent')
      .attr('stroke', 'none')
      .attr('class', 'venn-hit-target')
      // vennSets[i] in-bounds: circles.length === vennSets.length.
      .attr('data-line-number', String(vennSets[i]!.lineNumber))
      .style('cursor', onClickItem ? 'pointer' : 'default')
      .style('outline-solid', 'none')
      .on('mouseenter', () => {
        showRegionOverlay([i]);
      })
      .on('mouseleave', () => {
        hideAllOverlays();
      })
      .on('click', function () {
        (this as SVGElement).blur?.();
        if (onClickItem && vennSets[i]!.lineNumber)
          onClickItem(vennSets[i]!.lineNumber);
      });
  });

  // Intersection targets: centroid-based circles for all overlap regions (declared + undeclared)
  const overlayR = scaledR * 0.35;

  const subsets: { idxs: number[]; sets: string[] }[] = [];
  if (n === 2) {
    // n === 2 ⇒ vennSets has at least 2 entries.
    subsets.push({
      idxs: [0, 1],
      sets: [vennSets[0]!.name, vennSets[1]!.name].sort(),
    });
  } else {
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        // a and b are valid vennSets indices (n === vennSets.length).
        subsets.push({
          idxs: [a, b],
          sets: [vennSets[a]!.name, vennSets[b]!.name].sort(),
        });
      }
    }
    // n === 3 path ⇒ vennSets has 3 entries.
    subsets.push({
      idxs: [0, 1, 2],
      sets: [vennSets[0]!.name, vennSets[1]!.name, vennSets[2]!.name].sort(),
    });
  }

  for (const subset of subsets) {
    const { idxs, sets } = subset;
    const inside = circles.map((_, j) => idxs.includes(j));
    const centroid = regionCentroid(circles, inside);
    const declaredOv = vennOverlaps.find(
      (ov) =>
        ov.sets.length === sets.length && ov.sets.every((s, k) => s === sets[k])
    );
    hoverGroup
      .append('circle')
      .attr('cx', centroid.x)
      .attr('cy', centroid.y)
      .attr('r', overlayR)
      .attr('fill', 'transparent')
      .attr('stroke', 'none')
      .attr('class', 'venn-hit-target')
      .attr('data-line-number', declaredOv ? String(declaredOv.lineNumber) : '')
      .style('cursor', onClickItem && declaredOv ? 'pointer' : 'default')
      .style('outline-solid', 'none')
      .on('mouseenter', () => {
        showRegionOverlay(idxs);
      })
      .on('mouseleave', () => {
        hideAllOverlays();
      })
      .on('click', function () {
        (this as SVGElement).blur?.();
        if (onClickItem && declaredOv) onClickItem(declaredOv.lineNumber);
      });
  }
}

// ============================================================
