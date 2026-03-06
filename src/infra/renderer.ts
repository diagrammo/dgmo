// ============================================================
// Infra Chart SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import * as d3Shape from 'd3-shape';
import { FONT_FAMILY } from '../fonts';
import type { PaletteColors } from '../palettes';
import { mix } from '../palettes/color-utils';
import type { ParsedInfra, InfraTagGroup } from './types';
import { resolveColor } from '../colors';
import type { ComputedInfraModel } from './types';
import type { InfraLayoutResult, InfraLayoutNode, InfraLayoutEdge, InfraLayoutGroup } from './layout';
import { inferRoles, collectDiagramRoles } from './roles';
import type { InfraRole } from './roles';
import { parseInfra } from './parser';
import { computeInfra } from './compute';
import { layoutInfra } from './layout';

// ============================================================
// Constants
// ============================================================

const DIAGRAM_PADDING = 20;
const NODE_FONT_SIZE = 13;
const META_FONT_SIZE = 10;
const META_LINE_HEIGHT = 14;
const RPS_FONT_SIZE = 11;
const EDGE_LABEL_FONT_SIZE = 11;
const GROUP_LABEL_FONT_SIZE = 14;
const NODE_BORDER_RADIUS = 8;
const EDGE_STROKE_WIDTH = 1.5;
const NODE_STROKE_WIDTH = 1.5;
const OVERLOAD_STROKE_WIDTH = 3;
const ROLE_DOT_RADIUS = 3;
const NODE_HEADER_HEIGHT = 28;
const NODE_SEPARATOR_GAP = 4;
const NODE_PAD_BOTTOM = 10;
const COLLAPSE_BAR_HEIGHT = 6;
const COLLAPSE_BAR_INSET = 0;

// Legend pill/capsule constants (matching org chart style)
const LEGEND_HEIGHT = 28;
const LEGEND_PILL_PAD = 16;
const LEGEND_PILL_FONT_SIZE = 11;
const LEGEND_PILL_FONT_W = LEGEND_PILL_FONT_SIZE * 0.6;
const LEGEND_CAPSULE_PAD = 4;
const LEGEND_DOT_R = 4;
const LEGEND_ENTRY_FONT_SIZE = 10;
const LEGEND_ENTRY_FONT_W = LEGEND_ENTRY_FONT_SIZE * 0.6;
const LEGEND_ENTRY_DOT_GAP = 4;
const LEGEND_ENTRY_TRAIL = 8;
const LEGEND_GROUP_GAP = 12;
const LEGEND_FIXED_GAP = 8; // gap between fixed legend and scaled diagram

// Health colors (from UX spec)
const COLOR_HEALTHY = '#22c55e';
const COLOR_WARNING = '#eab308';
const COLOR_OVERLOADED = '#ef4444';
const COLOR_NEUTRAL = '#94a3b8';

// Animation constants
const FLOW_DASH = '8 6';          // dash-array for animated edges
const FLOW_DASH_LEN = 14;         // sum of dash + gap (for offset keyframe)
const FLOW_SPEED_MIN = 2.5;       // seconds at max RPS
const FLOW_SPEED_MAX = 6;         // seconds at min RPS
const OVERLOAD_PULSE_SPEED = 0.8; // seconds for overload pulse cycle
const PARTICLE_R = 5;             // particle circle radius
const PARTICLE_COUNT_MIN = 1;     // min particles per edge
const PARTICLE_COUNT_MAX = 4;     // max particles per edge (at max RPS)
const NODE_PULSE_SPEED = 1.5;     // seconds for warning pulse
const NODE_PULSE_OVERLOAD = 0.7;  // seconds for overload pulse

// Reject particle constants
const REJECT_PARTICLE_R = 2.5;
const REJECT_DROP_DISTANCE = 30;  // px downward travel
const REJECT_DURATION_MIN = 1.5;  // seconds per drop at max reject
const REJECT_DURATION_MAX = 3;    // seconds per drop at min reject
const REJECT_COUNT_MIN = 1;
const REJECT_COUNT_MAX = 3;

// ============================================================
// Edge path generator
// ============================================================

const lineGenerator = d3Shape.line<{ x: number; y: number }>()
  .x((d) => d.x)
  .y((d) => d.y)
  .curve(d3Shape.curveBasis);

/** Compute the point on a node's border closest to an external target point. */
function nodeBorderPoint(
  node: InfraLayoutNode,
  target: { x: number; y: number },
): { x: number; y: number } {
  const hw = node.width / 2;
  const hh = node.height / 2;
  const dx = target.x - node.x;
  const dy = target.y - node.y;
  if (dx === 0 && dy === 0) return { x: node.x + hw, y: node.y };

  // Scale factor to reach the bounding box edge
  const sx = hw / Math.abs(dx || 1);
  const sy = hh / Math.abs(dy || 1);
  const s = Math.min(sx, sy);

  return { x: node.x + dx * s, y: node.y + dy * s };
}

/** Map RPS to animation duration — higher RPS = faster (shorter duration). */
function flowDuration(rps: number, maxRps: number): number {
  if (maxRps <= 0) return FLOW_SPEED_MAX;
  const t = Math.min(rps / maxRps, 1);
  return FLOW_SPEED_MAX - t * (FLOW_SPEED_MAX - FLOW_SPEED_MIN);
}

/** Map RPS to particle count — more traffic = more particles. */
function particleCount(rps: number, maxRps: number): number {
  if (maxRps <= 0) return PARTICLE_COUNT_MIN;
  const t = Math.min(rps / maxRps, 1);
  return Math.round(PARTICLE_COUNT_MIN + t * (PARTICLE_COUNT_MAX - PARTICLE_COUNT_MIN));
}

/** Determine if a node is in warning state (>70% capacity but not overloaded). */
function isWarning(node: InfraLayoutNode): boolean {
  if (node.overloaded || node.isEdge) return false;
  const maxRps = node.properties.find((p) => p.key === 'max-rps');
  if (!maxRps) return false;
  const cap = Number(maxRps.value) * node.computedInstances;
  return cap > 0 && node.computedRps / cap > 0.7;
}

// ============================================================
// Helpers
// ============================================================

/** Display names for behavior property keys. */
const PROP_DISPLAY: Record<string, string> = {
  'cache-hit': 'cache hit',
  'firewall-block': 'fw block',
  'bot-filter': 'bot filter',
  'ratelimit-rps': 'rate limit',
  'latency-ms': 'latency',
  'uptime': 'uptime',
  'instances': 'instances',
  'max-rps': 'max rps',
  'cb-error-threshold': 'CB err %',
  'cb-latency-threshold-ms': 'CB latency',
};

/** Computed metric rows (latency percentiles, uptime, availability) shown after declared props. */
function getComputedRows(node: InfraLayoutNode, expanded: boolean): { key: string; value: string; color?: string }[] {
  const rows: { key: string; value: string; color?: string }[] = [];
  const p = node.computedLatencyPercentiles;
  if (p.p50 > 0 || p.p90 > 0 || p.p99 > 0) {
    if (expanded) {
      rows.push({ key: 'p50', value: formatMsShort(p.p50) });
      rows.push({ key: 'p90', value: formatMsShort(p.p90) });
    }
    rows.push({ key: 'p99', value: formatMsShort(p.p99) });
  }
  // Edge node shows system-wide uptime/availability; other nodes show their own
  if (node.computedUptime < 1) {
    rows.push({ key: 'uptime', value: formatUptimeShort(node.computedUptime) });
  }
  if (node.computedAvailability < 1) {
    const color = node.computedAvailability < 0.95 ? COLOR_OVERLOADED
      : node.computedAvailability < 0.99 ? COLOR_WARNING
      : undefined;
    rows.push({ key: 'avail', value: formatUptimeShort(node.computedAvailability), color });
  }
  return rows;
}

function formatMsShort(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatUptimeShort(fraction: number): string {
  const pct = fraction * 100;
  if (pct >= 99.99) return '99.99%';
  if (pct >= 99.9) return `${pct.toFixed(2)}%`;
  if (pct >= 99) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(1)}%`;
}

/** Properties shown as key-value rows inside the node card. */
function getDisplayProps(node: InfraLayoutNode): { key: string; displayKey: string; value: string }[] {
  if (node.isEdge) return [];
  const rows: { key: string; displayKey: string; value: string }[] = [];
  for (const p of node.properties) {
    const displayKey = PROP_DISPLAY[p.key];
    if (!displayKey) continue;
    const val = String(p.value);
    rows.push({ key: p.key, displayKey, value: val.endsWith('%') ? val : val });
  }
  return rows;
}

function formatRps(rps: number): string {
  if (rps >= 1000) return `${(rps / 1000).toFixed(1)}k rps`;
  return `${Math.round(rps)} rps`;
}

/** RPS value without "rps" suffix — for key-value rows where the key already says "RPS". */
function formatRpsShort(rps: number): string {
  if (rps >= 1000) return `${(rps / 1000).toFixed(1)}k`;
  return `${Math.round(rps)}`;
}

function nodeColor(node: InfraLayoutNode, palette: PaletteColors, isDark: boolean): {
  fill: string;
  stroke: string;
  textFill: string;
} {
  // Collapsed group nodes use the worst child health state for coloring
  const healthState = node.childHealthState;
  if (healthState) {
    if (healthState === 'overloaded') {
      return {
        fill: mix(palette.bg, COLOR_OVERLOADED, isDark ? 80 : 92),
        stroke: COLOR_OVERLOADED,
        textFill: palette.text,
      };
    }
    if (healthState === 'warning') {
      return {
        fill: mix(palette.bg, COLOR_WARNING, isDark ? 85 : 92),
        stroke: COLOR_WARNING,
        textFill: palette.text,
      };
    }
    // 'normal' falls through to default
  } else {
    if (node.overloaded) {
      return {
        fill: mix(palette.bg, COLOR_OVERLOADED, isDark ? 80 : 92),
        stroke: COLOR_OVERLOADED,
        textFill: palette.text,
      };
    }
    if (isWarning(node)) {
      return {
        fill: mix(palette.bg, COLOR_WARNING, isDark ? 85 : 92),
        stroke: COLOR_WARNING,
        textFill: palette.text,
      };
    }
  }
  return {
    fill: isDark ? mix(palette.bg, palette.text, 90) : mix(palette.bg, palette.text, 95),
    stroke: isDark ? mix(palette.text, palette.bg, 60) : mix(palette.text, palette.bg, 40),
    textFill: palette.text,
  };
}

function edgeColor(_edge: InfraLayoutEdge, palette: PaletteColors): string {
  return palette.textMuted;
}

function edgeWidth(): number {
  return EDGE_STROKE_WIDTH;
}

// ============================================================
// Render functions
// ============================================================

function renderGroups(
  svg: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  groups: InfraLayoutGroup[],
  palette: PaletteColors,
  isDark: boolean,
) {
  for (const group of groups) {
    const g = svg.append('g')
      .attr('class', 'infra-group')
      .attr('data-line-number', group.lineNumber)
      .attr('data-node-toggle', group.id)
      .style('cursor', 'pointer');

    // Filled background (matching org chart container style)
    const groupFill = mix(palette.surface, palette.bg, 40);
    const groupStroke = palette.textMuted;
    g.append('rect')
      .attr('x', group.x)
      .attr('y', group.y)
      .attr('width', group.width)
      .attr('height', group.height)
      .attr('rx', 6)
      .attr('fill', groupFill)
      .attr('stroke', groupStroke)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', 1);

    // Group label (centered at top)
    g.append('text')
      .attr('x', group.x + group.width / 2)
      .attr('y', group.y + 16)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', GROUP_LABEL_FONT_SIZE)
      .attr('font-weight', '600')
      .attr('fill', palette.text)
      .text(group.label);

    // Group instances badge (top-right, like node instance badges)
    const gi = typeof group.instances === 'number' ? group.instances :
      typeof group.instances === 'string' ? parseInt(String(group.instances), 10) || 0 : 0;
    if (gi > 1) {
      g.append('text')
        .attr('x', group.x + group.width - 8)
        .attr('y', group.y + 16)
        .attr('text-anchor', 'end')
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', META_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .text(`${gi}x`);
    }
  }
}

function renderEdgePaths(
  svg: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  edges: InfraLayoutEdge[],
  nodes: InfraLayoutNode[],
  palette: PaletteColors,
  isDark: boolean,
  animate: boolean,
) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const maxRps = Math.max(...edges.map((e) => e.computedRps), 1);

  for (const edge of edges) {
    if (edge.points.length === 0) continue;

    const targetNode = nodeMap.get(edge.targetId);
    const sourceNode = nodeMap.get(edge.sourceId);
    const color = edgeColor(edge, palette);
    const strokeW = edgeWidth();

    // Ensure dagre waypoints are ordered source→target (not guaranteed by dagre)
    let pts = edge.points;
    if (sourceNode && targetNode && pts.length >= 2) {
      const first = pts[0];
      const distFirstToSource = (first.x - sourceNode.x) ** 2 + (first.y - sourceNode.y) ** 2;
      const distFirstToTarget = (first.x - targetNode.x) ** 2 + (first.y - targetNode.y) ** 2;
      if (distFirstToTarget < distFirstToSource) {
        pts = [...pts].reverse();
      }
    }

    // Prepend source border point and append target border point so edges
    // visually connect to node boundaries (dagre waypoints float between nodes)
    if (sourceNode && pts.length > 0) {
      const bp = nodeBorderPoint(sourceNode, pts[0]);
      pts = [bp, ...pts];
    }
    if (targetNode && pts.length > 0) {
      const bp = nodeBorderPoint(targetNode, pts[pts.length - 1]);
      pts = [...pts, bp];
    }

    const pathD = lineGenerator(pts) ?? '';
    const edgeG = svg.append('g')
      .attr('class', 'infra-edge')
      .attr('data-line-number', edge.lineNumber);

    edgeG.append('path')
      .attr('d', pathD)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', strokeW);

    if (animate && edge.computedRps > 0) {
      const dur = flowDuration(edge.computedRps, maxRps);

      // Particles traveling along the path — always green (overloaded nodes
      // already have red styling + reject particles to show the problem)
      const count = particleCount(edge.computedRps, maxRps);
      const particleColor = palette.colors.green;

      for (let i = 0; i < count; i++) {
        const delay = (dur / count) * i;
        const circle = edgeG.append('circle')
          .attr('r', PARTICLE_R)
          .attr('fill', particleColor)
          .attr('opacity', 0.85);

        // Use SMIL <animateMotion> for path-following
        circle.append('animateMotion')
          .attr('dur', `${dur}s`)
          .attr('repeatCount', 'indefinite')
          .attr('begin', `${delay}s`)
          .attr('path', pathD);
      }
    }
  }
}

function renderEdgeLabels(
  svg: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  edges: InfraLayoutEdge[],
  palette: PaletteColors,
  isDark: boolean,
  animate: boolean,
) {
  for (const edge of edges) {
    if (edge.points.length === 0) continue;
    if (!edge.label) continue;

    const midIdx = Math.floor(edge.points.length / 2);
    const midPt = edge.points[midIdx];
    const labelText = edge.label;

    const g = svg.append('g')
      .attr('class', animate ? 'infra-edge-label' : '');

    // Background rect for readability
    const textWidth = labelText.length * 6.5 + 8;
    g.append('rect')
      .attr('x', midPt.x - textWidth / 2)
      .attr('y', midPt.y - 8)
      .attr('width', textWidth)
      .attr('height', 16)
      .attr('rx', 3)
      .attr('fill', palette.bg)
      .attr('opacity', 0.9);

    g.append('text')
      .attr('x', midPt.x)
      .attr('y', midPt.y + 4)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', EDGE_LABEL_FONT_SIZE)
      .attr('fill', palette.textMuted)
      .text(labelText);

    // When animated, add a wider invisible hover zone so labels appear on hover
    if (animate) {
      const pathD = lineGenerator(edge.points) ?? '';
      g.insert('path', ':first-child')
        .attr('d', pathD)
        .attr('fill', 'none')
        .attr('stroke', 'transparent')
        .attr('stroke-width', 20);
    }
  }
}

function renderNodes(
  svg: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  nodes: InfraLayoutNode[],
  palette: PaletteColors,
  isDark: boolean,
  animate: boolean,
  selectedNodeId?: string | null,
  activeGroup?: string | null,
) {
  const mutedColor = palette.textMuted;

  for (const node of nodes) {
    const { fill, stroke, textFill } = nodeColor(node, palette, isDark);
    let cls = 'infra-node';
    if (animate && !node.isEdge) {
      if (node.computedCbState === 'open') cls += ' infra-node-cb-open';
      else if (node.overloaded) cls += ' infra-node-overload';
      else if (isWarning(node)) cls += ' infra-node-warning';
    }
    const g = svg.append('g')
      .attr('class', cls)
      .attr('data-line-number', node.lineNumber)
      .attr('data-infra-node', node.id);

    // Collapsed group nodes: toggle attribute + pointer cursor
    if (node.id.startsWith('[')) {
      g.attr('data-node-toggle', node.id)
        .style('cursor', 'pointer');
    }

    // Expose tag values for legend hover dimming
    for (const [tagKey, tagVal] of Object.entries(node.tags)) {
      g.attr(`data-tag-${tagKey.toLowerCase()}`, tagVal.toLowerCase());
    }

    // Expose role names for role legend hover dimming
    if (!node.isEdge) {
      const roles = inferRoles(node.properties);
      for (const role of roles) {
        g.attr(`data-role-${role.name.toLowerCase().replace(/\s+/g, '-')}`, 'true');
      }
    }

    const x = node.x - node.width / 2;
    const y = node.y - node.height / 2;
    const isCollapsedGroup = node.id.startsWith('[');
    const strokeWidth = node.overloaded || isWarning(node) ? OVERLOAD_STROKE_WIDTH : NODE_STROKE_WIDTH;

    // Node rect
    g.append('rect')
      .attr('x', x)
      .attr('y', y)
      .attr('width', node.width)
      .attr('height', node.height)
      .attr('rx', NODE_BORDER_RADIUS)
      .attr('fill', fill)
      .attr('stroke', stroke)
      .attr('stroke-width', strokeWidth);

    // Node name — centered in header area
    const headerCenterY = y + NODE_HEADER_HEIGHT / 2 + NODE_FONT_SIZE * 0.35;
    g.append('text')
      .attr('x', node.x)
      .attr('y', headerCenterY)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', NODE_FONT_SIZE)
      .attr('font-weight', '600')
      .attr('fill', textFill)
      .text(node.label);

    // --- Key-value rows below header ---
    {
      const displayProps = node.isEdge ? [] : getDisplayProps(node);
      const expanded = node.id === selectedNodeId;
      const computedRows = getComputedRows(node, expanded);
      const hasContent = displayProps.length > 0 || computedRows.length > 0 || node.computedRps > 0;

      if (hasContent) {
        // Separator line between header and body
        const sepY = y + NODE_HEADER_HEIGHT;
        g.append('line')
          .attr('x1', x)
          .attr('y1', sepY)
          .attr('x2', x + node.width)
          .attr('y2', sepY)
          .attr('stroke', stroke)
          .attr('stroke-opacity', 0.3)
          .attr('stroke-width', 1);

        // Build all rows (RPS + declared properties + computed) so values align
        const rows: { key: string; value: string; valueFill: string; fontWeight: string }[] = [];
        if (node.computedRps > 0) {
          const rpsColor = node.overloaded ? COLOR_OVERLOADED : mutedColor;
          rows.push({ key: 'RPS', value: formatRpsShort(node.computedRps), valueFill: rpsColor, fontWeight: '500' });
        }
        for (const prop of displayProps) {
          rows.push({ key: prop.displayKey, value: prop.value, valueFill: textFill, fontWeight: 'normal' });
        }
        for (const cr of computedRows) {
          rows.push({ key: cr.key, value: cr.value, valueFill: cr.color ?? mutedColor, fontWeight: 'normal' });
        }

        // Compute max key width so values align vertically
        const maxKeyLen = Math.max(...rows.map((r) => r.key.length));
        const valueX = x + 10 + (maxKeyLen + 2) * (META_FONT_SIZE * 0.6);

        let rowY = sepY + NODE_SEPARATOR_GAP + META_FONT_SIZE;
        for (const row of rows) {
          // Key (muted)
          g.append('text')
            .attr('x', x + 10)
            .attr('y', rowY)
            .attr('font-family', FONT_FAMILY)
            .attr('font-size', META_FONT_SIZE)
            .attr('fill', mutedColor)
            .text(`${row.key}: `);

          // Value (aligned)
          g.append('text')
            .attr('x', valueX)
            .attr('y', rowY)
            .attr('font-family', FONT_FAMILY)
            .attr('font-size', META_FONT_SIZE)
            .attr('font-weight', row.fontWeight)
            .attr('fill', row.valueFill)
            .text(row.value);

          rowY += META_LINE_HEIGHT;
        }
      }

      // Instance count — clickable for interactive adjustment (not for edge nodes)
      if (!node.isEdge && node.computedInstances > 0) {
        g.append('text')
          .attr('x', x + node.width - 6)
          .attr('y', y + NODE_HEADER_HEIGHT / 2 + META_FONT_SIZE * 0.35)
          .attr('text-anchor', 'end')
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', META_FONT_SIZE)
          .attr('fill', mutedColor)
          .attr('data-instance-node', node.id)
          .style('cursor', 'pointer')
          .text(node.computedInstances > 1 ? `${node.computedInstances}x` : '');
      }

      // Role badge dots — only shown when Capabilities legend is expanded
      const showDots = activeGroup != null && activeGroup.toLowerCase() === 'capabilities';
      const roles = showDots && !node.isEdge ? inferRoles(node.properties) : [];
      if (roles.length > 0) {
        // Move dots up above the collapse bar for collapsed groups
        const dotY = isCollapsedGroup
          ? y + node.height - COLLAPSE_BAR_HEIGHT - NODE_PAD_BOTTOM / 2
          : y + node.height - NODE_PAD_BOTTOM / 2;
        const totalDotsWidth = roles.length * (ROLE_DOT_RADIUS * 2 + 2) - 2;
        const startX = node.x - totalDotsWidth / 2 + ROLE_DOT_RADIUS;
        for (let i = 0; i < roles.length; i++) {
          g.append('circle')
            .attr('cx', startX + i * (ROLE_DOT_RADIUS * 2 + 2))
            .attr('cy', dotY)
            .attr('r', ROLE_DOT_RADIUS)
            .attr('fill', roles[i].color);
        }
      }

      // Collapse bar at bottom of collapsed group nodes (accent stripe, clipped to card)
      if (isCollapsedGroup) {
        const clipId = `clip-${node.id.replace(/[[\]\s]/g, '')}`;
        g.append('clipPath').attr('id', clipId)
          .append('rect')
          .attr('x', x).attr('y', y)
          .attr('width', node.width).attr('height', node.height)
          .attr('rx', NODE_BORDER_RADIUS);
        g.append('rect')
          .attr('x', x + COLLAPSE_BAR_INSET)
          .attr('y', y + node.height - COLLAPSE_BAR_HEIGHT)
          .attr('width', node.width - COLLAPSE_BAR_INSET * 2)
          .attr('height', COLLAPSE_BAR_HEIGHT)
          .attr('fill', stroke)
          .attr('clip-path', `url(#${clipId})`)
          .attr('class', 'infra-collapse-bar');
      }
    }
  }
}

// ============================================================
// Reject Particles — red fading drops for traffic-shedding nodes
// ============================================================

/** Get a numeric property from an InfraLayoutNode. */
function getNodeNumProp(node: InfraLayoutNode, key: string, fallback: number): number {
  const prop = node.properties.find((p) => p.key === key);
  if (!prop) return fallback;
  if (typeof prop.value === 'number') return prop.value;
  const num = parseFloat(String(prop.value));
  return isNaN(num) ? fallback : num;
}

/**
 * Compute rejected RPS for a node — traffic that arrives but is dropped/blocked.
 * This includes: firewall-block, bot-filter, rate-limit excess, and overload excess.
 * Cache-hit is NOT a reject — the request is served from cache.
 */
function computeRejectedRps(node: InfraLayoutNode): number {
  if (node.isEdge || node.computedRps <= 0) return 0;
  let rejected = 0;
  const inbound = node.computedRps;

  // Firewall block: N% of inbound is rejected
  const fwBlock = getNodeNumProp(node, 'firewall-block', 0);
  if (fwBlock > 0) rejected += inbound * (fwBlock / 100);

  // Bot filter: N% of remaining is rejected
  const botFilter = getNodeNumProp(node, 'bot-filter', 0);
  if (botFilter > 0) rejected += inbound * (botFilter / 100);

  // Rate limit excess (applied after cache/fw/bot reductions)
  const rateLimit = getNodeNumProp(node, 'ratelimit-rps', 0);
  if (rateLimit > 0) {
    let preRateLimitRps = inbound;
    const cacheHit = getNodeNumProp(node, 'cache-hit', 0);
    if (cacheHit > 0) preRateLimitRps *= (100 - cacheHit) / 100;
    if (fwBlock > 0) preRateLimitRps *= (100 - fwBlock) / 100;
    if (botFilter > 0) preRateLimitRps *= (100 - botFilter) / 100;
    if (preRateLimitRps > rateLimit) {
      rejected += preRateLimitRps - rateLimit;
    }
  }

  // Overload excess
  if (node.overloaded || node.childHealthState === 'overloaded') {
    const maxRps = getNodeNumProp(node, 'max-rps', 0);
    if (maxRps > 0) {
      const capacity = maxRps * node.computedInstances;
      if (inbound > capacity) {
        rejected += inbound - capacity;
      }
    }
    // For collapsed groups: childHealthState signals child overload even when
    // the virtual node's aggregated capacity math doesn't trigger (due to
    // group instances being baked into both max-rps and computedInstances).
    // Ensure we always produce a reject signal.
    if (rejected === 0) {
      rejected = inbound * 0.1;
    }
  }

  return rejected;
}

function renderRejectParticles(
  svg: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  nodes: InfraLayoutNode[],
) {
  // Compute max rejected RPS across all nodes for scaling
  const rejectMap: { node: InfraLayoutNode; rejected: number }[] = [];
  for (const node of nodes) {
    const rejected = computeRejectedRps(node);
    if (rejected > 0) rejectMap.push({ node, rejected });
  }
  if (rejectMap.length === 0) return;

  const maxRejected = Math.max(...rejectMap.map((r) => r.rejected));

  for (const { node, rejected } of rejectMap) {
    const t = Math.min(rejected / maxRejected, 1);
    const count = Math.round(REJECT_COUNT_MIN + t * (REJECT_COUNT_MAX - REJECT_COUNT_MIN));
    const dur = REJECT_DURATION_MAX - t * (REJECT_DURATION_MAX - REJECT_DURATION_MIN);

    const nodeBottom = node.y + node.height / 2;

    for (let i = 0; i < count; i++) {
      const delay = (dur / count) * i;
      // Spread particles horizontally around the node center
      const spread = node.width * 0.3;
      const startX = node.x + (count > 1 ? -spread / 2 + spread * (i / (count - 1)) : 0);
      const startY = nodeBottom;
      const endY = nodeBottom + REJECT_DROP_DISTANCE;

      const circle = svg.append('circle')
        .attr('r', REJECT_PARTICLE_R)
        .attr('fill', COLOR_OVERLOADED)
        .attr('opacity', 0);

      // Drop straight down from node bottom
      circle.append('animate')
        .attr('attributeName', 'cy')
        .attr('from', startY)
        .attr('to', endY)
        .attr('dur', `${dur}s`)
        .attr('repeatCount', 'indefinite')
        .attr('begin', `${delay}s`);

      circle.append('animate')
        .attr('attributeName', 'cx')
        .attr('from', startX)
        .attr('to', startX)
        .attr('dur', `${dur}s`)
        .attr('repeatCount', 'indefinite')
        .attr('begin', `${delay}s`);

      // Fade: appear quickly, then fade out
      circle.append('animate')
        .attr('attributeName', 'opacity')
        .attr('values', '0;0.8;0.6;0')
        .attr('keyTimes', '0;0.1;0.5;1')
        .attr('dur', `${dur}s`)
        .attr('repeatCount', 'indefinite')
        .attr('begin', `${delay}s`);
    }
  }
}

// ============================================================
// Legend — pill/capsule groups (matching org chart style)
// ============================================================

interface InfraLegendEntry {
  value: string;
  color: string;
  /** For role: kebab-case role name. For tag: lowercase tag value. */
  key: string;
}

export interface InfraLegendGroup {
  name: string;
  type: 'role' | 'tag';
  /** For tag groups: the key used in data-tag-* attributes (alias or name). */
  tagKey?: string;
  entries: InfraLegendEntry[];
  width: number;
  minifiedWidth: number;
}

/** Build legend groups from roles + tags. */
export function computeInfraLegendGroups(
  nodes: InfraLayoutNode[],
  tagGroups: InfraTagGroup[],
  palette: PaletteColors,
): InfraLegendGroup[] {
  const groups: InfraLegendGroup[] = [];

  // Capabilities group (from inferred roles)
  const roles = collectDiagramRoles(nodes.filter((n) => !n.isEdge).map((n) => n.properties));
  if (roles.length > 0) {
    const entries = roles.map((r) => ({
      value: r.name,
      color: r.color,
      key: r.name.toLowerCase().replace(/\s+/g, '-'),
    }));
    const pillWidth = 'Capabilities'.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
    let entriesWidth = 0;
    for (const e of entries) {
      entriesWidth += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + e.value.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
    }
    groups.push({
      name: 'Capabilities',
      type: 'role',
      entries,
      width: LEGEND_CAPSULE_PAD * 2 + pillWidth + 4 + entriesWidth,
      minifiedWidth: pillWidth,
    });
  }

  // Tag groups
  for (const tg of tagGroups) {
    const entries: InfraLegendEntry[] = [];
    for (const tv of tg.values) {
      if (tv.color) {
        entries.push({
          value: tv.name,
          color: resolveColor(tv.color, palette),
          key: tv.name.toLowerCase(),
        });
      }
    }
    if (entries.length === 0) continue;
    const pillWidth = tg.name.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
    let entriesWidth = 0;
    for (const e of entries) {
      entriesWidth += LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP + e.value.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
    }
    groups.push({
      name: tg.name,
      type: 'tag',
      tagKey: (tg.alias ?? tg.name).toLowerCase(),
      entries,
      width: LEGEND_CAPSULE_PAD * 2 + pillWidth + 4 + entriesWidth,
      minifiedWidth: pillWidth,
    });
  }

  return groups;
}

/** Compute total width for the playback legend group. */
function computePlaybackWidth(playback: InfraPlaybackState | undefined, _palette: PaletteColors): number {
  if (!playback) return 0;
  const pillWidth = 'Playback'.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
  if (!playback.expanded) return pillWidth;

  let entriesW = 8; // gap after pill
  // Play/Pause icon
  entriesW += LEGEND_PILL_FONT_SIZE * 0.8 + 6;
  // Speed options
  for (const s of playback.speedOptions) {
    entriesW += `${s}x`.length * LEGEND_ENTRY_FONT_W + 6;
  }
  // Scenarios
  for (const name of playback.scenarioNames) {
    entriesW += name.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
  }
  // Reset
  if (playback.hasOverrides) {
    entriesW += 'Reset'.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
  }

  return LEGEND_CAPSULE_PAD * 2 + pillWidth + entriesW;
}

function renderLegend(
  rootSvg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  legendGroups: InfraLegendGroup[],
  totalWidth: number,
  legendY: number,
  palette: PaletteColors,
  isDark: boolean,
  activeGroup: string | null,
  playback?: InfraPlaybackState,
) {
  if (legendGroups.length === 0 && !playback) return;

  const legendG = rootSvg.append('g')
    .attr('transform', `translate(0, ${legendY})`);

  // Compute centered positions
  const effectiveW = (g: InfraLegendGroup) =>
    activeGroup != null && g.name.toLowerCase() === activeGroup.toLowerCase() ? g.width : g.minifiedWidth;
  const playbackW = computePlaybackWidth(playback, palette);
  const playbackGap = playback && legendGroups.length > 0 ? LEGEND_GROUP_GAP : 0;
  const totalLegendW = legendGroups.reduce((s, g) => s + effectiveW(g), 0)
    + (legendGroups.length - 1) * LEGEND_GROUP_GAP
    + playbackGap + playbackW;
  let cursorX = (totalWidth - totalLegendW) / 2;

  for (const group of legendGroups) {
    const isActive = activeGroup != null && group.name.toLowerCase() === activeGroup.toLowerCase();

    const groupBg = isDark
      ? mix(palette.bg, palette.text, 85)
      : mix(palette.bg, palette.text, 92);

    const pillLabel = group.name;
    const pillWidth = pillLabel.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;

    const gEl = legendG
      .append('g')
      .attr('transform', `translate(${cursorX}, 0)`)
      .attr('class', 'infra-legend-group')
      .attr('data-legend-group', group.name.toLowerCase())
      .attr('data-legend-type', group.type)
      .style('cursor', 'pointer');

    // Outer capsule background (active only)
    if (isActive) {
      gEl.append('rect')
        .attr('width', group.width)
        .attr('height', LEGEND_HEIGHT)
        .attr('rx', LEGEND_HEIGHT / 2)
        .attr('fill', groupBg);
    }

    const pillXOff = isActive ? LEGEND_CAPSULE_PAD : 0;
    const pillYOff = isActive ? LEGEND_CAPSULE_PAD : 0;
    const pillH = LEGEND_HEIGHT - (isActive ? LEGEND_CAPSULE_PAD * 2 : 0);

    // Pill background
    gEl.append('rect')
      .attr('x', pillXOff)
      .attr('y', pillYOff)
      .attr('width', pillWidth)
      .attr('height', pillH)
      .attr('rx', pillH / 2)
      .attr('fill', isActive ? palette.bg : groupBg);

    // Active pill border
    if (isActive) {
      gEl.append('rect')
        .attr('x', pillXOff)
        .attr('y', pillYOff)
        .attr('width', pillWidth)
        .attr('height', pillH)
        .attr('rx', pillH / 2)
        .attr('fill', 'none')
        .attr('stroke', isDark ? mix(palette.textMuted, palette.bg, 50) : mix(palette.textMuted, palette.bg, 50))
        .attr('stroke-width', 0.75);
    }

    // Pill text
    gEl.append('text')
      .attr('x', pillXOff + pillWidth / 2)
      .attr('y', LEGEND_HEIGHT / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', LEGEND_PILL_FONT_SIZE)
      .attr('font-weight', '500')
      .attr('fill', isActive ? palette.text : palette.textMuted)
      .attr('text-anchor', 'middle')
      .text(pillLabel);

    // Entries inside capsule (active only)
    if (isActive) {
      let entryX = pillXOff + pillWidth + 4;
      for (const entry of group.entries) {
        const entryG = gEl
          .append('g')
          .attr('class', 'infra-legend-entry')
          .attr('data-legend-entry', entry.key)
          .attr('data-legend-type', group.type)
          .attr('data-legend-color', entry.color)
          .style('cursor', 'pointer');

        if (group.type === 'tag' && group.tagKey) {
          entryG.attr('data-legend-tag-group', group.tagKey);
        }

        entryG.append('circle')
          .attr('cx', entryX + LEGEND_DOT_R)
          .attr('cy', LEGEND_HEIGHT / 2)
          .attr('r', LEGEND_DOT_R)
          .attr('fill', entry.color);

        const textX = entryX + LEGEND_DOT_R * 2 + LEGEND_ENTRY_DOT_GAP;
        entryG.append('text')
          .attr('x', textX)
          .attr('y', LEGEND_HEIGHT / 2 + LEGEND_ENTRY_FONT_SIZE / 2 - 1)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
          .attr('fill', palette.textMuted)
          .text(entry.value);

        entryX = textX + entry.value.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
      }
    }

    cursorX += effectiveW(group) + LEGEND_GROUP_GAP;
  }

  // Playback pill — same capsule pattern as other legend groups
  if (playback) {
    const isExpanded = playback.expanded;
    const groupBg = isDark
      ? mix(palette.bg, palette.text, 85)
      : mix(palette.bg, palette.text, 92);

    const pillLabel = 'Playback';
    const pillWidth = pillLabel.length * LEGEND_PILL_FONT_W + LEGEND_PILL_PAD;
    const fullW = computePlaybackWidth(playback, palette);

    const pbG = legendG
      .append('g')
      .attr('transform', `translate(${cursorX}, 0)`)
      .attr('class', 'infra-legend-group infra-playback-pill')
      .style('cursor', 'pointer');

    // Outer capsule (expanded only)
    if (isExpanded) {
      pbG.append('rect')
        .attr('width', fullW)
        .attr('height', LEGEND_HEIGHT)
        .attr('rx', LEGEND_HEIGHT / 2)
        .attr('fill', groupBg);
    }

    const pillXOff = isExpanded ? LEGEND_CAPSULE_PAD : 0;
    const pillYOff = isExpanded ? LEGEND_CAPSULE_PAD : 0;
    const pillH = LEGEND_HEIGHT - (isExpanded ? LEGEND_CAPSULE_PAD * 2 : 0);

    // Pill background
    pbG.append('rect')
      .attr('x', pillXOff)
      .attr('y', pillYOff)
      .attr('width', pillWidth)
      .attr('height', pillH)
      .attr('rx', pillH / 2)
      .attr('fill', isExpanded ? palette.bg : groupBg);

    // Active pill border
    if (isExpanded) {
      pbG.append('rect')
        .attr('x', pillXOff)
        .attr('y', pillYOff)
        .attr('width', pillWidth)
        .attr('height', pillH)
        .attr('rx', pillH / 2)
        .attr('fill', 'none')
        .attr('stroke', isDark ? mix(palette.textMuted, palette.bg, 50) : mix(palette.textMuted, palette.bg, 50))
        .attr('stroke-width', 0.75);
    }

    // Pill text
    pbG.append('text')
      .attr('x', pillXOff + pillWidth / 2)
      .attr('y', LEGEND_HEIGHT / 2 + LEGEND_PILL_FONT_SIZE / 2 - 2)
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', LEGEND_PILL_FONT_SIZE)
      .attr('font-weight', '500')
      .attr('fill', isExpanded ? palette.text : palette.textMuted)
      .attr('text-anchor', 'middle')
      .text(pillLabel);

    // Expanded entries
    if (isExpanded) {
      let entryX = pillXOff + pillWidth + 8;
      const entryY = LEGEND_HEIGHT / 2 + LEGEND_ENTRY_FONT_SIZE / 2 - 1;

      // Play/Pause
      const ppLabel = playback.paused ? '▶' : '⏸';
      pbG.append('text')
        .attr('x', entryX)
        .attr('y', entryY)
        .attr('font-family', FONT_FAMILY)
        .attr('font-size', LEGEND_PILL_FONT_SIZE)
        .attr('fill', palette.textMuted)
        .attr('data-playback-action', 'toggle-pause')
        .style('cursor', 'pointer')
        .text(ppLabel);
      entryX += LEGEND_PILL_FONT_SIZE * 0.8 + 6;

      // Speed options
      for (const s of playback.speedOptions) {
        const label = `${s}x`;
        const isActive = playback.speed === s;
        pbG.append('text')
          .attr('x', entryX)
          .attr('y', entryY)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
          .attr('font-weight', isActive ? '600' : '400')
          .attr('fill', isActive ? palette.text : palette.textMuted)
          .attr('data-playback-action', 'set-speed')
          .attr('data-playback-value', String(s))
          .style('cursor', 'pointer')
          .text(label);
        entryX += label.length * LEGEND_ENTRY_FONT_W + 6;
      }

      // Scenarios
      for (const name of playback.scenarioNames) {
        const isActive = playback.activeScenario === name;
        pbG.append('text')
          .attr('x', entryX)
          .attr('y', entryY)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
          .attr('font-weight', isActive ? '600' : '400')
          .attr('fill', isActive ? palette.text : palette.textMuted)
          .attr('data-playback-action', 'set-scenario')
          .attr('data-playback-value', name)
          .style('cursor', 'pointer')
          .text(name);
        entryX += name.length * LEGEND_ENTRY_FONT_W + LEGEND_ENTRY_TRAIL;
      }

      // Reset
      if (playback.hasOverrides) {
        pbG.append('text')
          .attr('x', entryX)
          .attr('y', entryY)
          .attr('font-family', FONT_FAMILY)
          .attr('font-size', LEGEND_ENTRY_FONT_SIZE)
          .attr('fill', palette.textMuted)
          .attr('data-playback-action', 'reset')
          .style('cursor', 'pointer')
          .text('Reset');
      }
    }
  }
}

// ============================================================
// Main render
// ============================================================

export interface InfraPlaybackState {
  expanded: boolean;
  paused: boolean;
  speed: number;
  speedOptions: readonly number[];
  scenarioNames: string[];
  activeScenario: string | null;
  hasOverrides: boolean;
}

export function renderInfra(
  container: HTMLDivElement,
  layout: InfraLayoutResult,
  palette: PaletteColors,
  isDark: boolean,
  title: string | null,
  titleLineNumber: number | null,
  tagGroups?: InfraTagGroup[],
  activeGroup?: string | null,
  animate?: boolean,
  playback?: InfraPlaybackState | null,
  selectedNodeId?: string | null,
  exportMode?: boolean,
) {
  // Clear previous render (preserve tooltips if any)
  d3Selection.select(container).selectAll(':not([data-d3-tooltip])').remove();

  // Build legend groups
  const legendGroups = computeInfraLegendGroups(layout.nodes, tagGroups ?? [], palette);
  const hasLegend = legendGroups.length > 0 || !!playback;
  // In app mode (not export), legend is rendered as a separate fixed-size SVG
  const fixedLegend = !exportMode && hasLegend;
  const legendOffset = hasLegend && !fixedLegend ? LEGEND_HEIGHT : 0;

  const titleOffset = title ? 40 : 0;
  const totalWidth = layout.width;
  const totalHeight = layout.height + titleOffset + legendOffset;

  const shouldAnimate = animate !== false;

  const rootSvg = d3Selection.select(container)
    .append('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('width', '100%')
    .attr('height', fixedLegend ? `calc(100% - ${LEGEND_HEIGHT + LEGEND_FIXED_GAP}px)` : '100%')
    .attr('viewBox', `0 0 ${totalWidth} ${totalHeight}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Inject animation keyframes + edge label hover styles
  if (shouldAnimate) {
    rootSvg.append('style').text(`
      @keyframes infra-pulse-warning {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      @keyframes infra-pulse-overload {
        0%, 100% { stroke-width: ${OVERLOAD_STROKE_WIDTH}; }
        50% { stroke-width: ${OVERLOAD_STROKE_WIDTH + 2}; }
      }
      @keyframes infra-pulse-cb {
        0%, 49% { stroke-dasharray: none; }
        50%, 100% { stroke-dasharray: 6 4; }
      }
      .infra-node-warning > rect:first-of-type {
        animation: infra-pulse-warning ${NODE_PULSE_SPEED}s ease-in-out infinite;
      }
      .infra-node-overload > rect:first-of-type {
        animation: infra-pulse-overload ${NODE_PULSE_OVERLOAD}s ease-in-out infinite;
      }
      .infra-node-cb-open > rect:first-of-type {
        stroke-dasharray: 6 4;
        animation: infra-pulse-cb 1s step-end infinite;
      }
      .infra-edge-label {
        opacity: 0;
        transition: opacity 0.15s ease;
        pointer-events: all;
      }
      .infra-edge-label:hover {
        opacity: 1;
      }
    `);
  }

  const svg = rootSvg.append('g')
    .attr('transform', `translate(0, ${titleOffset})`);

  // Title
  if (title) {
    rootSvg.append('text')
      .attr('class', 'chart-title')
      .attr('x', totalWidth / 2)
      .attr('y', 28)
      .attr('text-anchor', 'middle')
      .attr('font-family', FONT_FAMILY)
      .attr('font-size', 18)
      .attr('font-weight', '700')
      .attr('fill', palette.text)
      .attr('data-line-number', titleLineNumber != null ? titleLineNumber : '')
      .text(title);
  }

  // Render layers: groups (back), edge paths, nodes, reject particles, edge labels (front)
  renderGroups(svg, layout.groups, palette, isDark);
  renderEdgePaths(svg, layout.edges, layout.nodes, palette, isDark, shouldAnimate);
  renderNodes(svg, layout.nodes, palette, isDark, shouldAnimate, selectedNodeId, activeGroup);
  if (shouldAnimate) {
    renderRejectParticles(svg, layout.nodes);
  }
  renderEdgeLabels(svg, layout.edges, palette, isDark, shouldAnimate);

  // Legend at bottom
  if (hasLegend) {
    if (fixedLegend) {
      // Render legend in a separate SVG that stays at fixed pixel size
      const containerWidth = container.clientWidth || totalWidth;
      const legendSvg = d3Selection.select(container)
        .append('svg')
        .attr('class', 'infra-legend-fixed')
        .attr('width', '100%')
        .attr('height', LEGEND_HEIGHT + LEGEND_FIXED_GAP)
        .attr('viewBox', `0 0 ${containerWidth} ${LEGEND_HEIGHT + LEGEND_FIXED_GAP}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('display', 'block');
      renderLegend(legendSvg, legendGroups, containerWidth, LEGEND_FIXED_GAP / 2, palette, isDark, activeGroup ?? null, playback ?? undefined);
    } else {
      renderLegend(rootSvg, legendGroups, totalWidth, titleOffset + layout.height + 4, palette, isDark, activeGroup ?? null, playback ?? undefined);
    }
  }
}

// ============================================================
// Export pipeline (for CLI / d3.ts integration)
// ============================================================

export function parseAndLayoutInfra(content: string) {
  const parsed = parseInfra(content);
  if (parsed.error) return { parsed, computed: null, layout: null };
  const computed = computeInfra(parsed);
  const layout = layoutInfra(computed);
  return { parsed, computed, layout };
}
