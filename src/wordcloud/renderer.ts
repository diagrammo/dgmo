// ============================================================
// Wordcloud renderer — Story 109.2 (arch-review). Extracted from d3.ts.
// ============================================================

import * as d3Selection from 'd3-selection';
import cloud from 'd3-cloud';
import { FONT_FAMILY } from '../fonts';
import { measureText } from '../utils/text-measure';
import type { D3ExportDimensions } from '../utils/d3-types';
import { ScaleContext } from '../utils/scaling';
import { initD3Chart, renderChartTitle } from '../utils/d3-helpers';
import type {
  ParsedWordcloud,
  WordCloudWord,
  WordCloudRotate,
} from '../visualizations/types';
import type { PaletteColors } from '../palettes';
import { getSeriesColors } from '../palettes';

function getRotateFn(mode: WordCloudRotate): () => number {
  if (mode === 'mixed') return () => (Math.random() > 0.5 ? 0 : 90);
  if (mode === 'angled') return () => Math.round(Math.random() * 30 - 15);
  return () => 0;
}

/**
 * d3-cloud rasterizes each glyph to a canvas sprite for pixel-perfect
 * collision detection. In headless Node (jsdom), `getContext('2d')` returns
 * null, so d3-cloud throws (`getImageData` on null). This detects whether a
 * usable 2D canvas exists; when it doesn't, we fall back to a canvas-free
 * spiral packer so word clouds still render in SSG (remark wrappers), the MCP
 * server, and the CLI.
 */
function hasCanvas2d(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    return typeof canvas.getContext === 'function' && !!canvas.getContext('2d');
  } catch {
    return false;
  }
}

function estimateWordWidth(text: string, size: number): number {
  // Every word in the cloud is drawn at 600.
  return measureText(text, size, { bold: true });
}

type PlacedCloudWord = WordCloudWord & {
  size: number;
  x: number;
  y: number;
  rotate: number;
};

/**
 * Canvas-free word-cloud layout. Places the largest words first at the centre
 * and walks an Archimedean spiral outward, using axis-aligned bounding-box
 * overlap tests (text width estimated from font metrics). Returns words in
 * placement order with `x`/`y` relative to the cloud centre — the same shape
 * d3-cloud hands to its `end` callback — so the existing draw code is reused.
 * Words that can't be placed within the box are dropped, matching d3-cloud.
 */
function layoutWordsNoCanvas(
  words: Array<WordCloudWord & { size: number }>,
  width: number,
  height: number,
  padding: number,
  rotateFn: () => number
): PlacedCloudWord[] {
  const sorted = [...words].sort((a, b) => b.size - a.size);
  const placed: Array<PlacedCloudWord & { halfW: number; halfH: number }> = [];
  const maxR = Math.sqrt(width * width + height * height) / 2;
  // Bias the spiral to the box aspect so wide clouds spread horizontally.
  const aspect = width > 0 ? height / width : 1;

  for (const w of sorted) {
    const rotate = rotateFn();
    const rawW = estimateWordWidth(w.text, w.size) + padding * 2;
    const rawH = w.size + padding * 2;
    const rad = (rotate * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const halfW = (rawW * cos + rawH * sin) / 2;
    const halfH = (rawW * sin + rawH * cos) / 2;

    let spot: { x: number; y: number } | null = null;
    for (let t = 0; t < 4000; t++) {
      const a = t * 0.25;
      const r = a * 1.4;
      if (r > maxR) break;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * aspect;
      if (
        x - halfW < -width / 2 ||
        x + halfW > width / 2 ||
        y - halfH < -height / 2 ||
        y + halfH > height / 2
      ) {
        continue;
      }
      let collides = false;
      for (const p of placed) {
        if (
          Math.abs(x - p.x) < halfW + p.halfW &&
          Math.abs(y - p.y) < halfH + p.halfH
        ) {
          collides = true;
          break;
        }
      }
      if (!collides) {
        spot = { x, y };
        break;
      }
    }
    if (!spot) continue;
    placed.push({ ...w, rotate, x: spot.x, y: spot.y, halfW, halfH });
  }
  return placed;
}

// ============================================================
// Word Cloud Renderer
// ============================================================

/**
 * Renders a word cloud into the given container using d3-cloud.
 */
export function renderWordCloud(
  container: HTMLDivElement,
  parsed: ParsedWordcloud,
  palette: PaletteColors,
  _isDark: boolean,
  onClickItem?: (lineNumber: number) => void,
  exportDims?: D3ExportDimensions
): void {
  const { words, cloudOptions } = parsed;
  const title = parsed.noTitle ? null : parsed.title;
  if (words.length === 0) return;

  const init = initD3Chart(container, palette, exportDims);
  if (!init) return;
  const { svg, width, height, textColor, colors } = init;

  const idealWidth = Math.max(400, words.length * 30);
  const ctx = exportDims
    ? ScaleContext.identity()
    : ScaleContext.from(width, idealWidth);

  const sTitleHeight = title ? ctx.aesthetic(40) : 0;
  const cloudHeight = height - sTitleHeight;
  const sPadding = ctx.structural(2);

  svg.attr('preserveAspectRatio', 'xMidYMid meet');
  if (ctx.isBelowFloor) {
    svg.attr('width', '100%');
  }

  const { minSize, maxSize } = cloudOptions;
  const sMinSize = ctx.text(minSize);
  const sMaxSize = ctx.text(maxSize);
  const weights = words.map((w) => w.weight);
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const range = maxWeight - minWeight || 1;

  const fontSize = (weight: number): number => {
    const t = (weight - minWeight) / range;
    return sMinSize + Math.sqrt(t) * (sMaxSize - sMinSize);
  };

  const rotateFn = getRotateFn(cloudOptions.rotate);

  renderChartTitle(
    svg,
    title,
    parsed.titleLineNumber,
    width,
    textColor,
    onClickItem
  );

  const g = svg
    .append('g')
    .attr(
      'transform',
      `translate(${width / 2},${sTitleHeight + cloudHeight / 2})`
    );

  const sized = words.map((w) => ({ ...w, size: fontSize(w.weight) }));

  const draw = (
    layoutWords: Array<{
      text?: string;
      size?: number;
      x?: number;
      y?: number;
      rotate?: number;
    }>
  ): void => {
    g.selectAll('text')
      .data(layoutWords)
      .join('text')
      .style('font-size', (d) => `${d.size}px`)
      .style('font-family', FONT_FAMILY)
      .style('font-weight', 'bold')
      // colors is non-empty; modulo guarantees in-bounds.
      .style('fill', (_d, i) => colors[i % colors.length]!)
      .style('cursor', (d) =>
        onClickItem && (d as WordCloudWord).lineNumber ? 'pointer' : 'default'
      )
      .attr('text-anchor', 'middle')
      .attr('transform', (d) => `translate(${d.x},${d.y}) rotate(${d.rotate})`)
      .attr('data-line-number', (d) => {
        const ln = (d as WordCloudWord).lineNumber;
        return ln ? String(ln) : null;
      })
      .text((d) => d.text!)
      .on('click', (_event, d) => {
        const ln = (d as WordCloudWord).lineNumber;
        if (onClickItem && ln) onClickItem(ln);
      });
  };

  // No real 2D canvas (headless Node) → fall back to the spiral packer.
  if (!hasCanvas2d()) {
    draw(layoutWordsNoCanvas(sized, width, cloudHeight, sPadding, rotateFn));
    return;
  }

  cloud<WordCloudWord & cloud.Word>()
    .size([width, cloudHeight])
    .words(sized)
    .padding(sPadding)
    .rotate(rotateFn)
    .fontSize((d) => d.size!)
    .font(FONT_FAMILY)
    .on('end', draw)
    .start();
}

// ============================================================
// Word Cloud Renderer (for export — returns Promise)
// ============================================================

export function renderWordCloudAsync(
  container: HTMLDivElement,
  parsed: ParsedWordcloud,
  palette: PaletteColors,
  _isDark: boolean,
  exportDims?: D3ExportDimensions
): Promise<void> {
  return new Promise((resolve) => {
    d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

    const { words, cloudOptions } = parsed;
    const title = parsed.noTitle ? null : parsed.title;
    if (words.length === 0) {
      resolve();
      return;
    }

    const width = exportDims?.width ?? container.clientWidth;
    const height = exportDims?.height ?? container.clientHeight;
    if (width <= 0 || height <= 0) {
      resolve();
      return;
    }

    const titleHeight = title ? 40 : 0;
    const cloudHeight = height - titleHeight;

    const textColor = palette.text;
    const bgColor = palette.bg;
    const colors = getSeriesColors(palette);

    const { minSize, maxSize } = cloudOptions;
    const weights = words.map((w) => w.weight);
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const range = maxWeight - minWeight || 1;

    const fontSize = (weight: number): number => {
      const t = (weight - minWeight) / range;
      return minSize + Math.sqrt(t) * (maxSize - minSize);
    };

    const rotateFn = getRotateFn(cloudOptions.rotate);

    const svg = d3Selection
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .style('background', bgColor);

    renderChartTitle(svg, title, parsed.titleLineNumber, width, textColor);

    const g = svg
      .append('g')
      .attr(
        'transform',
        `translate(${width / 2},${titleHeight + cloudHeight / 2})`
      );

    const sized = words.map((w) => ({ ...w, size: fontSize(w.weight) }));

    const draw = (
      layoutWords: Array<{
        text?: string;
        size?: number;
        x?: number;
        y?: number;
        rotate?: number;
      }>
    ): void => {
      g.selectAll('text')
        .data(layoutWords)
        .join('text')
        .style('font-size', (d) => `${d.size}px`)
        .style('font-family', FONT_FAMILY)
        .style('font-weight', 'bold')
        // colors is non-empty; modulo guarantees in-bounds.
        .style('fill', (_d, i) => colors[i % colors.length]!)
        .attr('text-anchor', 'middle')
        .attr(
          'transform',
          (d) => `translate(${d.x},${d.y}) rotate(${d.rotate})`
        )
        .text((d) => d.text!);
      resolve();
    };

    // No real 2D canvas (headless Node: SSG wrappers, MCP, CLI) → d3-cloud's
    // sprite rasterization can't run. Use the canvas-free spiral packer.
    if (!hasCanvas2d()) {
      draw(layoutWordsNoCanvas(sized, width, cloudHeight, 2, rotateFn));
      return;
    }

    cloud<WordCloudWord & cloud.Word>()
      .size([width, cloudHeight])
      .words(sized)
      .padding(2)
      .rotate(rotateFn)
      .fontSize((d) => d.size!)
      .font(FONT_FAMILY)
      .on('end', draw)
      .start();
  });
}

// ============================================================
// Venn Diagram Math Helpers
// ============================================================
