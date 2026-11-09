// Shared d3 drawers for shapes more than one chart type draws (#1760). Geometry
// comes from `./geometry`; these only append elements and apply paint. Each
// draws centred on the group's origin.

import type * as d3Selection from 'd3-selection';
import { CLOUD_BUMP, CYLINDER_RY, QUEUE_CAP } from '../shape-caps';
import { EDGE_DASH, NODE_STROKE_WIDTH } from '../utils/visual-conventions';
import {
  cloudPath,
  cylinderPath,
  cylinderTopCap,
  queueNearCapPath,
  queuePath,
} from './geometry';

type GSelection = d3Selection.Selection<SVGGElement, unknown, null, undefined>;

/** A standing cylinder (database, cache): outline, then the full top cap. */
export function drawCylinderCard(
  nodeG: GSelection,
  w: number,
  h: number,
  fill: string,
  stroke: string,
  dashed: boolean
): void {
  const x = -w / 2;
  const y = -h / 2;
  const el = nodeG
    .append('path')
    .attr('d', cylinderPath(x, y, w, h, CYLINDER_RY))
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', NODE_STROKE_WIDTH);

  if (dashed) {
    el.attr('stroke-dasharray', EDGE_DASH);
  }

  const cap = cylinderTopCap(x, y, w, CYLINDER_RY);
  nodeG
    .append('ellipse')
    .attr('cx', cap.cx)
    .attr('cy', cap.cy)
    .attr('rx', cap.rx)
    .attr('ry', cap.ry)
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

/**
 * A queue — a cylinder on its side (#654): outline, then the near cap.
 * `computeC4NodeDimensions` pays for both caps in width, so the name never
 * sits on top of the near cap's arc.
 */
export function drawQueueCard(
  nodeG: GSelection,
  w: number,
  h: number,
  fill: string,
  stroke: string
): void {
  const x = -w / 2;
  const y = -h / 2;
  nodeG
    .append('path')
    .attr('d', queuePath(x, y, w, h, QUEUE_CAP))
    .attr('data-c4-shape', 'queue')
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', NODE_STROKE_WIDTH);

  nodeG
    .append('path')
    .attr('d', queueNearCapPath(x, y, h, QUEUE_CAP))
    .attr('fill', 'none')
    .attr('stroke', stroke)
    .attr('stroke-width', NODE_STROKE_WIDTH);
}

/**
 * A cloud card (#654). Every lobe's radius is derived from the card's own
 * size, so a wide card gets wide lobes rather than a row of circles.
 */
export function drawCloudCard(
  nodeG: GSelection,
  w: number,
  h: number,
  fill: string,
  stroke: string
): void {
  nodeG
    .append('path')
    .attr('d', cloudPath(-w / 2, -h / 2, w, h, CLOUD_BUMP))
    .attr('data-c4-shape', 'cloud')
    .attr('fill', fill)
    .attr('stroke', stroke)
    .attr('stroke-width', NODE_STROKE_WIDTH);
}
