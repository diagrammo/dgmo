// ============================================================
// Flowchart + state — chart title
// ============================================================
//
// The two graph renderers draw their title the same way: at the inline
// header's x and anchor, scaled, clickable when it has a source line. One
// copy here keeps them from drifting (#1751).

import * as d3Selection from 'd3-selection';
import { TITLE_FONT_WEIGHT } from '../utils/title-constants';

export interface GraphTitleOptions {
  readonly title: string;
  readonly titleLineNumber?: number | undefined;
  readonly x: number;
  readonly y: number;
  readonly anchor: string;
  readonly fontSize: number;
  readonly color: string;
  readonly onClickItem?: ((lineNumber: number) => void) | undefined;
}

/** Append the graph's `chart-title` text to `svg`. */
export function renderGraphTitle(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  opts: GraphTitleOptions
): void {
  const { titleLineNumber, onClickItem } = opts;
  const titleEl = svg
    .append('text')
    .attr('class', 'chart-title')
    .attr('x', opts.x)
    .attr('y', opts.y)
    .attr('text-anchor', opts.anchor)
    .attr('fill', opts.color)
    .attr('font-size', opts.fontSize)
    .attr('font-weight', TITLE_FONT_WEIGHT)
    .style('cursor', onClickItem && titleLineNumber ? 'pointer' : 'default')
    .text(opts.title);

  if (!titleLineNumber) return;
  titleEl.attr('data-line-number', titleLineNumber);
  if (!onClickItem) return;
  titleEl
    .on('click', () => onClickItem(titleLineNumber))
    .on('mouseenter', function () {
      d3Selection.select(this).attr('opacity', 0.7);
    })
    .on('mouseleave', function () {
      d3Selection.select(this).attr('opacity', 1);
    });
}
