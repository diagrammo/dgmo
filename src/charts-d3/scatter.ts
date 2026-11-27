// ============================================================
// Hand-built scatter / bubble renderer — SPIKE (Tier 2).
// Auto-fit axes (10% pad), per-point or per-category color, bubble sizing,
// point labels. (Spike uses simple above-point labels, not the full ECharts
// greedy collision graphic.)
// ============================================================

import { axisNumberFormat } from '../utils/axis-format';
import { scaleSqrt } from 'd3-scale';
import { axisTickFormat, buildValueAxis, labelledTicks } from './value-axis';
import { tabularText } from '../utils/tabular-figures';
import {
  computeQuadrantPointLabels,
  rectsOverlap,
  rectCircleOverlap,
  type LabelRect,
  type PointCircle,
} from '../label-layout';
import { measureText } from '../utils/text-measure';
import { FULL_TEXT_ATTR } from '../utils/full-text';
import type { ParsedScatter } from '../data-chart-parser';
import type { PaletteColors } from '../palettes';
import { FONT_FAMILY } from '../fonts';
import { shapeFill, themeBaseBg } from '../palettes/color-utils';
import { annotationValues } from '../annotations/parse';
import {
  drawBands,
  drawMarkers,
  settleBandLabels,
  type ValueAxisFrame,
} from '../annotations/draw';
import { drawChartNotes } from '../annotations/notes';
import {
  drawOverlayLabels,
  drawOverlayPaths,
  type OverlayPath,
} from '../overlays/draw';
import { overlayPlacement } from '../overlays/place';
import { linearFit } from '../overlays/compute';
import { buildDateAxis, parseTimeLabel } from './date-axis';
import {
  type Svg,
  type Margins,
  TICK_FONT,
  fmtNum,
  chartFormatter,
  computeLeftMargin,
  drawXAxisTitle,
  xAxisTitleLines,
  X_TITLE_LINE,
  drawYAxisTitle,
  tagDatum,
  cutMark,
  CUT_MARK_GAP,
  CUT_MARK_LEN,
  drawValueLabel,
} from './shared';
import {
  EMPHASIS_DIM_OPACITY,
  EMPHASIS_DIM_TEXT_OPACITY,
  resolveEmphasis,
  storyPaint,
} from '../utils/emphasis';

const FILL_OPACITY = 0.65;
/** Length of a `connect` path's arrowhead (#1982). */
const ARROW_LEN = 9;

/**
 * Point indices of each `connect` path (#1982), in row order: one per
 * category in first-appearance order, points outside any category together. A
 * group of one point has no path. Exported for tests.
 */
export function connectPaths(
  points: readonly { category?: string }[]
): number[][] {
  const groups = new Map<string, number[]>();
  points.forEach((p, i) => {
    const key = p.category ?? '';
    const g = groups.get(key);
    if (g) g.push(i);
    else groups.set(key, [i]);
  });
  return [...groups.values()].filter((g) => g.length >= 2);
}
const DEFAULT_SIZE = 15; // diameter
const LABEL_FONT = 11;
/** A point label wraps to at most this many lines, then ends in `…` (#2464). */
const POINT_LABEL_MAX_LINES = 2;
/** …and no line is wider than this share of the plot's width. */
const POINT_LABEL_MAX_WIDTH_SHARE = 0.3;
/** Baseline-to-baseline pitch of a wrapped point label. */
const POINT_LABEL_LINE = LABEL_FONT + 2;
// Must match the adapter's hover point-value styling: a big bold number line
// nearest the bubble, the small label line stacked beyond it.
const SIZEVAL_FONT = 20;
const SIZEVAL_LINE = SIZEVAL_FONT + 4;
const SIZEVAL_LABEL_FONT = 11;
const SIZEVAL_LABEL_LINE = SIZEVAL_LABEL_FONT + 4;
const SIZEVAL_BOLD_FACTOR = 1.08;

/**
 * Place the two-line hover size-value block (number + label) for one point so
 * it avoids the static name labels, the other bubbles, and the plot bounds.
 * Tries below / above / right / left at expanding offsets; falls back to
 * just-below when everything collides. The number line always sits nearest the
 * bubble, the label line beyond it. Returned x/y/labelY are SVG text attrs
 * (alphabetic baselines). Exported for tests.
 */
export function placeScatterHoverValue(
  cx: number,
  cy: number,
  r: number,
  labelText: string,
  valueText: string,
  labelRects: LabelRect[],
  circles: PointCircle[],
  bounds: { left: number; top: number; right: number; bottom: number }
): {
  x: number;
  y: number;
  labelY: number;
  anchor: 'middle' | 'start' | 'end';
  rect: LabelRect;
} {
  const w =
    Math.max(
      measureText(valueText, SIZEVAL_FONT) * SIZEVAL_BOLD_FACTOR,
      measureText(labelText, SIZEVAL_LABEL_FONT)
    ) + 6;
  const h = SIZEVAL_LINE + SIZEVAL_LABEL_LINE;
  const gap = 8;
  // numberFirst: number line at the top of the block (block sits below the
  // bubble / beside it); false: label on top, number at the bottom, nearest
  // the bubble (block sits above).
  const toResult = (
    rect: LabelRect,
    anchor: 'middle' | 'start' | 'end',
    numberFirst: boolean
  ) => {
    const numY = numberFirst ? rect.y + SIZEVAL_LINE - 6 : rect.y + h - 6;
    const lblY = numberFirst ? rect.y + h - 4 : rect.y + SIZEVAL_LABEL_LINE - 4;
    return {
      x:
        anchor === 'middle'
          ? cx
          : anchor === 'start'
            ? rect.x
            : rect.x + rect.w,
      y: numY,
      labelY: lblY,
      anchor,
      rect,
    };
  };
  const gens: Array<
    (off: number) => {
      rect: LabelRect;
      anchor: 'middle' | 'start' | 'end';
      numberFirst: boolean;
    }
  > = [
    (off) => ({
      rect: { x: cx - w / 2, y: cy + r + off, w, h },
      anchor: 'middle',
      numberFirst: true,
    }),
    (off) => ({
      rect: { x: cx - w / 2, y: cy - r - off - h, w, h },
      anchor: 'middle',
      numberFirst: false,
    }),
    (off) => ({
      rect: { x: cx + r + off, y: cy - h / 2, w, h },
      anchor: 'start',
      numberFirst: true,
    }),
    (off) => ({
      rect: { x: cx - r - off - w, y: cy - h / 2, w, h },
      anchor: 'end',
      numberFirst: true,
    }),
  ];
  for (let off = gap; off <= gap + 96; off += 12) {
    for (const gen of gens) {
      const { rect, anchor, numberFirst } = gen(off);
      if (
        rect.x < bounds.left ||
        rect.x + rect.w > bounds.right ||
        rect.y < bounds.top ||
        rect.y + rect.h > bounds.bottom
      )
        continue;
      if (labelRects.some((lr) => rectsOverlap(rect, lr))) continue;
      if (circles.some((c) => rectCircleOverlap(rect, c))) continue;
      return toResult(rect, anchor, numberFirst);
    }
  }
  return toResult({ x: cx - w / 2, y: cy + r + gap, w, h }, 'middle', true);
}

export function renderScatter(
  svg: Svg,
  chart: ParsedScatter,
  width: number,
  height: number,
  colors: string[],
  palette: PaletteColors,
  isDark: boolean,
  textColor: string,
  mutedColor: string,
  topInset: number
): void {
  const points = chart.scatterPoints ?? [];
  if (points.length === 0) return;
  const fillMode = chart.fillMode;
  const hasSize = points.some((p) => p.size !== undefined);

  const categories = [
    ...new Set(points.map((p) => p.category).filter(Boolean)),
  ] as string[];
  const catColor = (cat: string, i: number) =>
    chart.categoryColors?.[cat] ?? colors[i % colors.length]!;
  const catIndex = new Map(categories.map((c, i) => [c, i]));

  // §1.11 emphasis (#1829): `highlight` names points or categories. A point
  // stays at full strength when its name or its category is named; every
  // other point, its label and its leader line recede. Only `highlight` is
  // adopted here — the shared parser also reads `dim`, which scatter ignores.
  const emphasis = resolveEmphasis(
    chart.emphasis?.kind === 'highlight' ? chart.emphasis : undefined,
    [...points.map((p) => p.name), ...categories]
  );
  const { dimmed } = emphasis;
  // Story view (#2046): the subject solid, the rest one grey ground drawn
  // first so the subject sits on top.
  const story = storyPaint(emphasis, palette, isDark);
  const recedes = (p: (typeof points)[number]) =>
    dimmed.has(p.name) && (!p.category || dimmed.has(p.category));

  // A `marker` or `band` (#2039) beyond the points widens its axis to it.
  const xs = [
    ...points.map((p) => p.x),
    ...(points.every((p) => p.xLabel !== undefined)
      ? []
      : annotationValues(chart.annotations, 'cross')),
  ];
  const ys = [
    ...points.map((p) => p.y),
    ...annotationValues(chart.annotations, 'value'),
  ];
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.1 || 1;
  const yPad = (yMax - yMin) * 0.1 || 1;
  const yProbe = buildValueAxis(
    Math.floor(yMin - yPad),
    Math.ceil(yMax + yPad),
    chart.axes?.y,
    [0, 1],
    { dataLo: yMin, dataHi: yMax }
  );
  const yTicks = yProbe.ticks(6);
  // The author's `format` / `unit` / `locale` (#1831), one compact unit for
  // the y axis (#2036).
  const fmt = chartFormatter(chart, yTicks);
  const yTickFmt = axisTickFormat(yProbe, chart.numberFormat, fmt);

  const m: Margins = {
    top: topInset + 8,
    right: 32,
    bottom: 64,
    left: computeLeftMargin(chart.ylabel, yTicks.map(yTickFmt), {
      tabular: true,
    }),
  };
  const plotW = width - m.left - m.right;
  // A long x-axis title wraps under the plot; the margin grows to hold it.
  const xTitleLines = xAxisTitleLines(chart.xlabel, plotW).lines.length;
  m.bottom += Math.max(0, xTitleLines - 1) * X_TITLE_LINE;
  const plotH = height - m.top - m.bottom;

  // Bubble radii: area-proportional (scaleSqrt, true-zero domain) mapped into a
  // plot-relative pixel budget so the biggest bubble can always fit. Raw size/2
  // pixels blew out the pane (a size of 510 → r=255px, larger than the plot).
  // Plain scatter (no size declared) keeps the fixed DEFAULT_SIZE dot.
  const sizes = points.map((p) =>
    hasSize ? (p.size ?? DEFAULT_SIZE) : DEFAULT_SIZE
  );
  const rBudget = Math.max(12, Math.min(plotW, plotH) * 0.14);
  const rScale = scaleSqrt()
    .domain([0, Math.max(...sizes) || 1])
    .range([0, rBudget]);
  const radii = points.map((_, i) =>
    hasSize ? Math.max(5, rScale(sizes[i]!)) : DEFAULT_SIZE / 2
  );
  // Inset the data range by the largest bubble radius so no bubble edge clips
  // the pane, whichever point sits at an axis extreme.
  const rInset = Math.max(...radii) + 4;

  // Both axes take a range and `log` on their `x-axis` / `y-axis` line.
  // A time x (#2208): the parser guarantees every point carries `xLabel` or
  // none does. Bare times share one day (no midnight wrap: rows are unordered).
  // `x` stays a numeric axis over `p.x`, answering from the date axis' own
  // pixels so every call site below works unchanged; only the ticks differ.
  const xRange: [number, number] = [m.left + rInset, m.left + plotW - rInset];
  const timeKind = points.every((p) => p.xLabel !== undefined)
    ? parseTimeLabel(points[0]!.xLabel!)?.kind === 'time'
      ? 'time'
      : 'date'
    : null;
  const dateOf = (p: (typeof points)[number]): Date => {
    const t = parseTimeLabel(p.xLabel!)!;
    return t.kind === 'time' ? new Date(2000, 0, 1, 0, 0, t.seconds) : t.date;
  };
  const timeAxis =
    timeKind !== null
      ? buildDateAxis(
          points.map(dateOf),
          xRange,
          { fontSize: TICK_FONT },
          timeKind
        )
      : null;
  const xLinear = buildValueAxis(
    Math.floor(xMin - xPad),
    Math.ceil(xMax + xPad),
    timeAxis ? undefined : chart.axes?.x,
    xRange,
    { dataLo: xMin, dataHi: xMax }
  );
  const timePx = new Map(points.map((p) => [p.x, timeAxis?.x(dateOf(p)) ?? 0]));
  const x = timeAxis
    ? Object.assign(
        ((v: number) => timePx.get(v) ?? xLinear(v)) as typeof xLinear,
        xLinear
      )
    : xLinear;
  const y = buildValueAxis(
    Math.floor(yMin - yPad),
    Math.ceil(yMax + yPad),
    chart.axes?.y,
    [m.top + plotH - rInset, m.top + rInset],
    { dataLo: yMin, dataHi: yMax }
  );

  // Hit/bounds target so the interaction adapter knows axis positions for the
  // dotted leader-line + on-axis value projection.
  svg
    .append('rect')
    .attr('class', 'dgmo-plot-rect')
    .attr('x', m.left)
    .attr('y', m.top)
    .attr('width', plotW)
    .attr('height', plotH)
    .attr('fill', 'transparent')
    .attr('pointer-events', 'none');

  // Bands (#2039) sit beneath the gridlines: `band` on y, `band x` on x.
  const bgColor = themeBaseBg(palette, isDark);
  const annotationColors = {
    text: textColor,
    muted: palette.textMuted,
    bg: bgColor,
  };
  const yFrame: ValueAxisFrame = {
    pos: (v) => y(v),
    domain: y.domain(),
    left: m.left,
    top: m.top,
    width: plotW,
    height: plotH,
    horizontal: false,
    crossPos: (at) => {
      if (typeof at !== 'number' || timeAxis) return undefined;
      const [d0, d1] = x.domain();
      return at >= Math.min(d0, d1) && at <= Math.max(d0, d1)
        ? x(at)
        : undefined;
    },
  };
  const xFrame: ValueAxisFrame = {
    ...yFrame,
    pos: (v) => x(v),
    domain: x.domain(),
    horizontal: true,
  };
  const annotationBoxes = [
    ...drawBands(svg, chart.annotations, yFrame, annotationColors),
    ...(timeAxis
      ? []
      : drawBands(svg, chart.annotations, xFrame, annotationColors, 'cross')),
  ];

  // gridlines + ticks
  const shownTicks = y.ticks(6);
  const shown = labelledTicks(y, shownTicks, yTickFmt, {
    fontSize: TICK_FONT,
    vertical: true,
  });
  for (const t of shownTicks) {
    const yy = y(t);
    svg
      .append('line')
      .attr('x1', m.left)
      .attr('x2', m.left + plotW)
      .attr('y1', yy)
      .attr('y2', yy)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.25);
    if (shown.has(t))
      svg
        .append('text')
        .attr('class', 'dgmo-tick')
        .attr('x', m.left - 10)
        .attr('y', yy + 4)
        .attr('text-anchor', 'end')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .call(tabularText(yTickFmt(t), TICK_FONT));
  }
  // x prints plain unless its axis block sets a format (#2116).
  const formatX = axisNumberFormat(chart, 'x', false);
  const fmtX = formatX
    ? chartFormatter({ numberFormat: formatX }, x.ticks(6))
    : fmtNum;
  const xTickFmt = axisTickFormat(x, formatX, fmtX);
  const xText = (p: (typeof points)[number]): string => p.xLabel ?? fmtX(p.x);
  // A time axis brings its own ticks (position + label); a number axis is
  // measured and thinned by `labelledTicks`.
  const timeTicks = timeAxis?.ticks ?? null;
  const shownXTicks = timeTicks ? timeTicks.map((_, i) => i) : x.ticks(6);
  const shownX = timeTicks
    ? new Set(shownXTicks)
    : labelledTicks(x, shownXTicks, xTickFmt, {
        fontSize: TICK_FONT,
        vertical: false,
      });
  for (const t of shownXTicks) {
    const xx = timeTicks ? timeTicks[t]!.pos : x(t);
    svg
      .append('line')
      .attr('x1', xx)
      .attr('x2', xx)
      .attr('y1', m.top)
      .attr('y2', m.top + plotH)
      .attr('stroke', mutedColor)
      .attr('stroke-opacity', 0.25);
    if (shownX.has(t))
      svg
        .append('text')
        .attr('class', 'dgmo-tick')
        .attr('x', xx)
        .attr('y', m.top + plotH + 18)
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', TICK_FONT)
        .attr('font-family', FONT_FAMILY)
        .call(
          tabularText(timeTicks ? timeTicks[t]!.label : xTickFmt(t), TICK_FONT)
        );
  }

  const pointColor = (p: (typeof points)[number], i: number): string =>
    p.color ??
    (p.category
      ? catColor(p.category, catIndex.get(p.category) ?? 0)
      : colors[i % colors.length]!);

  // `trend` (#1954): one least-squares line per category, behind the
  // points, across that category's x range, labelled with its R².
  const trend = chart.overlays?.find((o) => o.kind === 'trend');
  const trendPaths: OverlayPath[] = [];
  if (trend && !timeAxis) {
    const groups = new Map<string, number[]>();
    points.forEach((p, i) => {
      const key = p.category ?? '';
      groups.set(key, [...(groups.get(key) ?? []), i]);
    });
    const several = groups.size > 1;
    for (const [cat, ix] of groups) {
      const xsOf = ix.map((i) => points[i]!.x);
      const fit = linearFit(
        xsOf,
        ix.map((i) => points[i]!.y)
      );
      if (!fit) continue;
      const lo = Math.min(...xsOf);
      const hi = Math.max(...xsOf);
      // Sampled, so the line stays true on a log x axis.
      const STEPS = 24;
      const pts = Array.from({ length: STEPS + 1 }, (_, k) => {
        const xv = lo + ((hi - lo) * k) / STEPS;
        return { at: x(xv), v: fit.intercept + fit.slope * xv };
      }).filter((p) => Number.isFinite(p.at));
      trendPaths.push({
        kind: 'trend',
        points: pts,
        label: `${several && cat ? `${cat} ` : ''}R² ${fit.r2.toFixed(2)}`,
        color:
          several && cat ? catColor(cat, catIndex.get(cat) ?? 0) : textColor,
        lineNumber: trend.lineNumber,
      });
    }
  }
  const trendLabels = drawOverlayPaths(svg, trendPaths, yFrame);

  // `connect` (#1982): one path per category (points outside any category share one),
  // in row order. A path of one point draws nothing.
  const paths = chart.connect ? connectPaths(points) : [];
  // The first and last point of every path keep their names, even under
  // `no-name`.
  const pathEnds = new Set(paths.flatMap((ix) => [ix[0]!, ix[ix.length - 1]!]));
  const labelled = points
    .map((_, i) => i)
    .filter((i) => !chart.noName || pathEnds.has(i));

  // Greedy collision-avoiding label placement (above/below/left/right + leader
  // line when pushed) — replaces the spike's naive above-point labels. Every
  // point stays an obstacle, labelled or not.
  const placedSome =
    labelled.length === 0
      ? null
      : computeQuadrantPointLabels(
          labelled.map((i) => ({
            label: points[i]!.name,
            cx: x(points[i]!.x),
            cy: y(points[i]!.y),
            r: radii[i]!,
          })),
          {
            left: m.left,
            top: m.top,
            right: m.left + plotW,
            bottom: m.top + plotH,
          },
          chart.noName
            ? points
                .map((p, i) => ({ p, i }))
                .filter(({ i }) => !pathEnds.has(i))
                .map(({ p, i }) => ({
                  x: x(p.x) - radii[i]!,
                  y: y(p.y) - radii[i]!,
                  w: radii[i]! * 2,
                  h: radii[i]! * 2,
                }))
            : [],
          DEFAULT_SIZE / 2,
          LABEL_FONT,
          false,
          {
            maxWidth: plotW * POINT_LABEL_MAX_WIDTH_SHARE,
            maxLines: POINT_LABEL_MAX_LINES,
            lineHeight: POINT_LABEL_LINE,
          }
        );
  const placedLabels:
    | (ReturnType<typeof computeQuadrantPointLabels>[number] | undefined)[]
    | null = placedSome
    ? points.map((_, i) => {
        const k = labelled.indexOf(i);
        return k < 0 ? undefined : placedSome[k];
      })
    : null;

  // Paths sit beneath every point; a receded path is drawn first.
  const pathRecedes = (ix: number[]) => ix.every((i) => recedes(points[i]!));
  const pathOrder = [...paths].sort(
    (a, b) => Number(pathRecedes(b)) - Number(pathRecedes(a))
  );
  for (const ix of pathOrder) {
    const first = points[ix[0]!]!;
    const own = first.category ? pointColor(first, ix[0]!) : mutedColor;
    const recede = pathRecedes(ix);
    const stroke = !story.active
      ? own
      : recede
        ? story.groundStroke
        : story.subject(own);
    const g = svg
      .append('g')
      .attr('class', 'dgmo-scatter-path')
      .attr('data-color', own);
    if (first.category) g.attr('data-series-name', first.category);
    if (recede && !story.active) g.attr('opacity', EMPHASIS_DIM_OPACITY);
    const at = ix.map((i) => [x(points[i]!.x), y(points[i]!.y)] as const);
    g.append('path')
      .attr('class', 'dgmo-scatter-path-line')
      .attr(
        'd',
        at.map(([px, py], k) => `${k ? 'L' : 'M'}${px},${py}`).join('')
      )
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr('stroke-width', 1.5)
      .attr('stroke-linejoin', 'round');
    // Arrowhead on the last segment, its tip on the last point's rim.
    const [x0, y0] = at[at.length - 2]!;
    const [x1, y1] = at[at.length - 1]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len > 0) {
      const ux = (x1 - x0) / len;
      const uy = (y1 - y0) / len;
      const rim = radii[ix[ix.length - 1]!]! + 1;
      const tx = x1 - ux * rim;
      const ty = y1 - uy * rim;
      const bx = tx - ux * ARROW_LEN;
      const by = ty - uy * ARROW_LEN;
      const w = ARROW_LEN * 0.45;
      g.append('path')
        .attr('class', 'dgmo-scatter-arrow')
        .attr(
          'd',
          `M${tx},${ty}L${bx - uy * w},${by + ux * w}L${bx + uy * w},${by - ux * w}Z`
        )
        .attr('fill', stroke)
        .attr('stroke', 'none');
    }
  }

  const plotBounds = {
    left: m.left,
    top: m.top,
    right: m.left + plotW,
    bottom: m.top + plotH,
  };
  // A point's own name label stays unfaded during hover, so the size block
  // must clear it (everything else dims and may be overlapped).
  const ownLabelRect = (i: number): LabelRect[] => {
    const pl = placedLabels?.[i];
    return pl ? [pl.rect] : [];
  };

  // points
  const order = points.map((_, i) => i);
  if (story.active)
    order.sort(
      (a, b) => Number(recedes(points[b]!)) - Number(recedes(points[a]!))
    );
  order.forEach((i) => {
    const p = points[i]!;
    const own = pointColor(p, i);
    const recede = recedes(p);
    const stroke = !story.active
      ? own
      : recede
        ? story.groundStroke
        : story.subject(own);
    const r = radii[i]!;
    const dot = svg
      .append('circle')
      .attr('cx', x(p.x))
      .attr('cy', y(p.y))
      .attr('r', r)
      .attr(
        'fill',
        !story.active
          ? shapeFill(palette, own, isDark, { mode: fillMode })
          : recede
            ? story.groundFill
            : stroke
      )
      .attr('fill-opacity', story.active ? null : FILL_OPACITY)
      .attr('stroke', stroke)
      .attr('stroke-width', 2);
    // Story view bakes the grey into the paint; only `dim` uses opacity.
    const dim = recede && !story.active;
    if (dim) dot.attr('opacity', EMPHASIS_DIM_OPACITY);
    tagDatum(dot, {
      line: p.lineNumber,
      key: p.name,
      name: p.category ? `${p.name} · ${p.category}` : p.name,
      value:
        p.size !== undefined
          ? `(${xText(p)}, ${fmt(p.y)}) · ${chart.sizelabel ?? 'size'}: ${fmtNum(p.size)}`
          : `(${xText(p)}, ${fmt(p.y)})`,
      color: own,
    });
    // Per-axis values for the adapter's on-axis projection (no tooltip).
    dot.attr('data-axval-x', xText(p)).attr('data-axval-y', fmt(p.y));
    // A point past a fixed axis end is pinned to it (#2119): the dot gives
    // way to a triangle pointing the way the value went, with the real value
    // beside it. The dot stays, unpainted, as the hover target.
    const cut = pointCut(
      p.x,
      p.y,
      timeAxis ? undefined : chart.axes?.x,
      chart.axes?.y
    );
    if (cut) {
      dot.attr('fill-opacity', 0).attr('stroke-opacity', 0);
      const horiz = cut.axis === 'x';
      const mid = horiz ? y(p.y) : x(p.x);
      const edge = horiz ? x(p.x) : y(p.y);
      cutMark(svg, mid, edge, cut.dir, horiz, stroke, p.lineNumber, dim);
      const reach = CUT_MARK_GAP + CUT_MARK_LEN / 2;
      const along = horiz ? edge + cut.dir * reach : edge - cut.dir * reach;
      drawValueLabel(
        svg,
        horiz ? xText(p) : fmt(p.y),
        horiz ? along : mid + CUT_MARK_LEN + 2,
        horiz ? mid - CUT_MARK_LEN - 4 : along + 4,
        stroke,
        horiz ? 'middle' : 'start'
      )
        .attr('class', 'dgmo-ptlabel')
        .attr('data-line-number', p.lineNumber)
        .attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null);
    }
    // Size has no axis to project onto — the adapter prints it next to the
    // hovered point instead, labeled by `size-label` when declared.
    if (p.size !== undefined) {
      const sizeLabel = chart.sizelabel ?? 'size';
      // Tight to the bubble on purpose — everything else fades during hover,
      // so the block may sit over dimmed marks. Only the point's own name
      // label (unfaded) and plot bounds constrain it.
      const pos = placeScatterHoverValue(
        x(p.x),
        y(p.y),
        r,
        sizeLabel,
        fmtNum(p.size),
        ownLabelRect(i),
        [],
        plotBounds
      );
      dot
        .attr('data-size', fmtNum(p.size))
        .attr('data-size-label', sizeLabel)
        .attr('data-sizeval-x', pos.x)
        .attr('data-sizeval-y', pos.y)
        .attr('data-sizeval-ly', pos.labelY)
        .attr('data-sizeval-anchor', pos.anchor);
    }
    // Category key for cross-highlight (hover a point → dim other categories).
    // `data-category` drives the baked-CSS path; `data-series-name` (mirrors the
    // legend entry) lets the live JS adapter treat categories as series so
    // legend-hover dims the other groups. Only when a category is declared.
    if (p.category) {
      dot.attr('data-category', p.category);
      dot.attr('data-series-name', p.category);
    }
    const placed = placedLabels?.[i];
    if (placed) {
      // `dgmo-ptlabel` + line number let the interaction adapter fade every
      // other point's label while one bubble is hovered.
      if (placed.connectorLine) {
        svg
          .append('line')
          .attr('class', 'dgmo-ptlabel')
          .attr('data-line-number', p.lineNumber)
          .attr('x1', placed.connectorLine.x1)
          .attr('y1', placed.connectorLine.y1)
          .attr('x2', placed.connectorLine.x2)
          .attr('y2', placed.connectorLine.y2)
          .attr('stroke', stroke)
          .attr('stroke-width', 1)
          .attr('opacity', dim ? 0.5 * EMPHASIS_DIM_OPACITY : 0.5);
      }
      const label = svg
        .append('text')
        .attr('class', 'dgmo-ptlabel')
        .attr('data-line-number', p.lineNumber)
        .attr('x', placed.x)
        .attr('y', placed.y)
        .attr('text-anchor', placed.anchor)
        .attr('dominant-baseline', 'central')
        .attr('fill', stroke)
        .attr('font-size', LABEL_FONT)
        .attr('font-family', FONT_FAMILY)
        .attr('opacity', dim ? EMPHASIS_DIM_TEXT_OPACITY : null);
      if (placed.lines.length === 1) label.text(placed.lines[0]!);
      else
        placed.lines.forEach((line, k) =>
          label
            .append('tspan')
            .attr('x', placed.x)
            .attr(
              'dy',
              k === 0
                ? (-(placed.lines.length - 1) * POINT_LABEL_LINE) / 2
                : POINT_LABEL_LINE
            )
            .text(line)
        );
      // A cut name keeps its whole text for hover and screen readers.
      if (placed.truncated) label.attr(FULL_TEXT_ATTR, p.name);
    }
  });

  const markerLines: LabelRect[] = [];
  annotationBoxes.push(
    ...drawMarkers(
      svg,
      chart.annotations,
      yFrame,
      annotationColors,
      markerLines
    ),
    ...drawOverlayLabels(
      svg,
      trendLabels,
      yFrame,
      bgColor,
      [],
      // Trend labels clear the points and their names (#2217).
      overlayPlacement({
        reserved: points.flatMap((_, i) => ownLabelRect(i)),
        markers: points.map((p, i) => ({
          cx: x(p.x),
          cy: y(p.y),
          r: radii[i]! + 2,
        })),
      })
    )
  );
  settleBandLabels(svg);

  // Notes (#2039): a ring on the point, the text in clear plot space.
  if (chart.notes?.length && !chart.noNotes) {
    drawChartNotes(
      svg,
      chart.notes.map((n) => {
        const p = points[n.index]!;
        return {
          x: x(p.x),
          y: y(p.y),
          r: radii[n.index]!,
          text: n.text,
          color: n.color,
          lineNumber: n.lineNumber,
        };
      }),
      {
        plot: plotBounds,
        canvas: { ...plotBounds, right: width },
        reserved: [
          ...annotationBoxes,
          ...points.flatMap((_, i) => ownLabelRect(i)),
        ],
        obstacles: markerLines,
        markers: points.map((p, i) => ({
          cx: x(p.x),
          cy: y(p.y),
          r: radii[i]! + 2,
        })),
        colors: { text: textColor, bg: bgColor },
        palette,
      }
    );
  }

  drawXAxisTitle(
    svg,
    chart.xlabel,
    m.left + plotW / 2,
    m.top + plotH + 46,
    textColor,
    plotW
  );
  drawYAxisTitle(svg, chart.ylabel, m.top, plotH, 20, textColor);
}

/** Which fixed axis end a point passes, if any (#2119): y first, then x. */
function pointCut(
  px: number,
  py: number,
  xSpec: { min?: number; max?: number } | undefined,
  ySpec: { min?: number; max?: number } | undefined
): { axis: 'x' | 'y'; dir: 1 | -1 } | null {
  if (ySpec?.max !== undefined && py > ySpec.max) return { axis: 'y', dir: 1 };
  if (ySpec?.min !== undefined && py < ySpec.min) return { axis: 'y', dir: -1 };
  if (xSpec?.max !== undefined && px > xSpec.max) return { axis: 'x', dir: 1 };
  if (xSpec?.min !== undefined && px < xSpec.min) return { axis: 'x', dir: -1 };
  return null;
}
