// ============================================================
// Sequence Diagram SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import type { PaletteColors } from '../palettes';
import { mix } from '../palettes/color-utils';
import {
  parseInlineMarkdown,
  truncateBareUrl,
  renderInlineText,
} from '../utils/inline-markdown';
export { parseInlineMarkdown, truncateBareUrl };
import { FONT_FAMILY } from '../fonts';
import type {
  ParsedSequenceDgmo,
  SequenceElement,
  SequenceGroup,
  SequenceMessage,
  SequenceNote,
  SequenceParticipant,
} from './parser';
import { isSequenceBlock, isSequenceSection, isSequenceNote } from './parser';
import { applyCollapseProjection } from './collapse';
import type { CollapsedView } from './collapse';
import { resolveSequenceTags } from './tag-resolution';
import type { ResolvedTagMap } from './tag-resolution';
import { resolveActiveTagGroup } from '../utils/tag-groups';
import { LEGEND_HEIGHT } from '../utils/legend-constants';
import { renderLegendD3 } from '../utils/legend-d3';
import type { LegendConfig, LegendState } from '../utils/legend-types';
import { TITLE_FONT_SIZE, TITLE_FONT_WEIGHT } from '../utils/title-constants';

// ============================================================
// Layout Constants
// ============================================================

const PARTICIPANT_GAP = 160;
const PARTICIPANT_BOX_WIDTH = 120;
const PARTICIPANT_BOX_HEIGHT = 50;
const TOP_MARGIN = 20;
const TITLE_HEIGHT = 30;
const PARTICIPANT_Y_OFFSET = 10;
const SERVICE_BORDER_RADIUS = 10;
const MESSAGE_START_OFFSET = 30;
const LIFELINE_TAIL = 30;
const ARROWHEAD_SIZE = 8;

// Note rendering constants
const NOTE_MAX_W = 200;
const NOTE_FOLD = 10;
const NOTE_PAD_H = 8;
const NOTE_PAD_V = 6;
const NOTE_FONT_SIZE = 10;
const NOTE_LINE_H = 14;
const NOTE_GAP = 15;
const NOTE_CHAR_W = 6;
const NOTE_CHARS_PER_LINE = Math.floor(
  (NOTE_MAX_W - NOTE_PAD_H * 2 - NOTE_FOLD) / NOTE_CHAR_W
);
const COLLAPSED_NOTE_H = 20;
const COLLAPSED_NOTE_W = 40;

function wrapTextLines(text: string, maxChars: number): string[] {
  const rawLines = text.split('\n');
  const wrapped: string[] = [];
  for (const line of rawLines) {
    if (line.length <= maxChars) {
      wrapped.push(line);
    } else {
      const words = line.split(' ');
      let current = '';
      for (const word of words) {
        if (current && (current + ' ' + word).length > maxChars) {
          wrapped.push(current);
          current = word;
        } else {
          current = current ? current + ' ' + word : word;
        }
      }
      if (current) wrapped.push(current);
    }
  }
  return wrapped;
}

/**
 * Split a participant label into multiple lines if it exceeds the box width.
 * Splits on spaces first, then dashes, then camelCase boundaries.
 * Approximate max chars based on font-size 13 (~7.5px per char average).
 */
const LABEL_CHAR_WIDTH = 7.5;
const LABEL_MAX_CHARS = Math.floor(
  (PARTICIPANT_BOX_WIDTH - 10) / LABEL_CHAR_WIDTH
); // ~14 chars

function splitParticipantLabel(label: string): string[] {
  if (label.length <= LABEL_MAX_CHARS) return [label];

  // Split on spaces
  if (label.includes(' ')) {
    return wrapLabelWords(label.split(' '));
  }

  // Split on dashes/underscores
  if (/[-_]/.test(label)) {
    const parts = label.split(/[-_]/);
    return wrapLabelWords(parts);
  }

  // Split on camelCase boundaries: "UserLookupCloudFx" → ["User", "Lookup", "Cloud", "Fx"]
  const camelParts = label
    .replace(/([a-z])([A-Z])/g, '$1\x00$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\x00$2')
    .split('\x00');
  if (camelParts.length > 1) {
    return wrapLabelWords(camelParts);
  }

  return [label];
}

/** Greedily join word parts into lines that fit within LABEL_MAX_CHARS. */
function wrapLabelWords(words: string[]): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + word : word;
    if (test.length > LABEL_MAX_CHARS && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Shared fill/stroke helpers — accept optional color override for per-participant coloring
const fill = (
  palette: PaletteColors,
  isDark: boolean,
  color?: string
): string =>
  color
    ? mix(color, isDark ? palette.surface : palette.bg, isDark ? 30 : 40)
    : isDark
      ? mix(palette.overlay, palette.surface, 50)
      : mix(palette.bg, palette.surface, 50);
const stroke = (palette: PaletteColors, color?: string): string =>
  color || palette.border;
const SW = 1.5;
const W = PARTICIPANT_BOX_WIDTH;
const H = PARTICIPANT_BOX_HEIGHT;

// ============================================================
// Participant Shape Renderers
// ============================================================

function renderRectParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean,
  color?: string
): void {
  g.append('rect')
    .attr('x', -W / 2)
    .attr('y', 0)
    .attr('width', W)
    .attr('height', H)
    .attr('rx', 2)
    .attr('ry', 2)
    .attr('fill', fill(palette, isDark, color))
    .attr('stroke', stroke(palette, color))
    .attr('stroke-width', SW);
}

function renderServiceParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean,
  color?: string
): void {
  g.append('rect')
    .attr('x', -W / 2)
    .attr('y', 0)
    .attr('width', W)
    .attr('height', H)
    .attr('rx', SERVICE_BORDER_RADIUS)
    .attr('ry', SERVICE_BORDER_RADIUS)
    .attr('fill', fill(palette, isDark, color))
    .attr('stroke', stroke(palette, color))
    .attr('stroke-width', SW);
}

function renderActorParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  color?: string
): void {
  // Stick figure — no background, natural proportions
  const headR = 8;
  const cx = 0;
  const headY = headR + 2;
  const bodyTopY = headY + headR + 1;
  const bodyBottomY = H * 0.65;
  const legY = H - 2;
  const armSpan = 16;
  const legSpan = 12;
  const s = stroke(palette, color);
  const actorSW = 2.5;

  g.append('circle')
    .attr('cx', cx)
    .attr('cy', headY)
    .attr('r', headR)
    .attr('fill', 'none')
    .attr('stroke', s)
    .attr('stroke-width', actorSW);

  g.append('line')
    .attr('x1', cx)
    .attr('y1', bodyTopY)
    .attr('x2', cx)
    .attr('y2', bodyBottomY)
    .attr('stroke', s)
    .attr('stroke-width', actorSW);

  g.append('line')
    .attr('x1', cx - armSpan)
    .attr('y1', bodyTopY + 5)
    .attr('x2', cx + armSpan)
    .attr('y2', bodyTopY + 5)
    .attr('stroke', s)
    .attr('stroke-width', actorSW);

  g.append('line')
    .attr('x1', cx)
    .attr('y1', bodyBottomY)
    .attr('x2', cx - legSpan)
    .attr('y2', legY)
    .attr('stroke', s)
    .attr('stroke-width', actorSW);

  g.append('line')
    .attr('x1', cx)
    .attr('y1', bodyBottomY)
    .attr('x2', cx + legSpan)
    .attr('y2', legY)
    .attr('stroke', s)
    .attr('stroke-width', actorSW);
}

function renderDatabaseParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean,
  color?: string
): void {
  // Cylinder fitting within W x H
  const ry = 7;
  const topY = ry;
  const bodyH = H - ry * 2;
  const f = fill(palette, isDark, color);
  const s = stroke(palette, color);

  // Bottom ellipse (drawn first — rect will cover its top arc)
  g.append('ellipse')
    .attr('cx', 0)
    .attr('cy', topY + bodyH)
    .attr('rx', W / 2)
    .attr('ry', ry)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', SW);

  // Filled body (no stroke) to hide the top arc of the bottom ellipse
  g.append('rect')
    .attr('class', 'participant-body')
    .attr('x', -W / 2)
    .attr('y', topY)
    .attr('width', W)
    .attr('height', bodyH)
    .attr('fill', f)
    .attr('stroke', 'none');

  // Side lines
  g.append('line')
    .attr('x1', -W / 2)
    .attr('y1', topY)
    .attr('x2', -W / 2)
    .attr('y2', topY + bodyH)
    .attr('stroke', s)
    .attr('stroke-width', SW);
  g.append('line')
    .attr('x1', W / 2)
    .attr('y1', topY)
    .attr('x2', W / 2)
    .attr('y2', topY + bodyH)
    .attr('stroke', s)
    .attr('stroke-width', SW);

  // Top ellipse cap (drawn last, on top)
  g.append('ellipse')
    .attr('cx', 0)
    .attr('cy', topY)
    .attr('rx', W / 2)
    .attr('ry', ry)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', SW);
}

function renderQueueParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean,
  color?: string
): void {
  // Horizontal cylinder (pipe) — like database rotated 90 degrees
  const rx = 10;
  const leftX = -W / 2 + rx;
  const bodyW = W - rx * 2;
  const f = fill(palette, isDark, color);
  const s = stroke(palette, color);

  // Right ellipse (back face, drawn first — rect will cover its left arc)
  g.append('ellipse')
    .attr('cx', leftX + bodyW)
    .attr('cy', H / 2)
    .attr('rx', rx)
    .attr('ry', H / 2)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', SW);

  // Body rect (no stroke) to hide left arc of right ellipse
  g.append('rect')
    .attr('class', 'participant-body')
    .attr('x', leftX)
    .attr('y', 0)
    .attr('width', bodyW)
    .attr('height', H)
    .attr('fill', f)
    .attr('stroke', 'none');

  // Top and bottom lines
  g.append('line')
    .attr('x1', leftX)
    .attr('y1', 0)
    .attr('x2', leftX + bodyW)
    .attr('y2', 0)
    .attr('stroke', s)
    .attr('stroke-width', SW);
  g.append('line')
    .attr('x1', leftX)
    .attr('y1', H)
    .attr('x2', leftX + bodyW)
    .attr('y2', H)
    .attr('stroke', s)
    .attr('stroke-width', SW);

  // Left ellipse (front face, drawn last)
  g.append('ellipse')
    .attr('cx', leftX)
    .attr('cy', H / 2)
    .attr('rx', rx)
    .attr('ry', H / 2)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', SW);
}

function renderCacheParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean,
  color?: string
): void {
  // Dashed cylinder — variation of database to convey ephemeral storage
  const ry = 7;
  const topY = ry;
  const bodyH = H - ry * 2;
  const f = fill(palette, isDark, color);
  const s = stroke(palette, color);
  const dash = '4 3';

  // Bottom ellipse (back face)
  g.append('ellipse')
    .attr('cx', 0)
    .attr('cy', topY + bodyH)
    .attr('rx', W / 2)
    .attr('ry', ry)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', SW)
    .attr('stroke-dasharray', dash);

  g.append('rect')
    .attr('class', 'participant-body')
    .attr('x', -W / 2)
    .attr('y', topY)
    .attr('width', W)
    .attr('height', bodyH)
    .attr('fill', f)
    .attr('stroke', 'none');

  g.append('line')
    .attr('x1', -W / 2)
    .attr('y1', topY)
    .attr('x2', -W / 2)
    .attr('y2', topY + bodyH)
    .attr('stroke', s)
    .attr('stroke-width', SW)
    .attr('stroke-dasharray', dash);
  g.append('line')
    .attr('x1', W / 2)
    .attr('y1', topY)
    .attr('x2', W / 2)
    .attr('y2', topY + bodyH)
    .attr('stroke', s)
    .attr('stroke-width', SW)
    .attr('stroke-dasharray', dash);

  // Top ellipse cap
  g.append('ellipse')
    .attr('cx', 0)
    .attr('cy', topY)
    .attr('rx', W / 2)
    .attr('ry', ry)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', SW)
    .attr('stroke-dasharray', dash);
}

function renderNetworkingParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean,
  color?: string
): void {
  // Hexagon fitting within W x H
  const inset = 16;
  const points = [
    `${-W / 2 + inset},0`,
    `${W / 2 - inset},0`,
    `${W / 2},${H / 2}`,
    `${W / 2 - inset},${H}`,
    `${-W / 2 + inset},${H}`,
    `${-W / 2},${H / 2}`,
  ].join(' ');
  g.append('polygon')
    .attr('points', points)
    .attr('fill', fill(palette, isDark, color))
    .attr('stroke', stroke(palette, color))
    .attr('stroke-width', SW);
}

function renderFrontendParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean,
  color?: string
): void {
  // Monitor shape fitting within W x H
  const screenH = H - 10;
  const s = stroke(palette, color);
  g.append('rect')
    .attr('x', -W / 2)
    .attr('y', 0)
    .attr('width', W)
    .attr('height', screenH)
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('fill', fill(palette, isDark, color))
    .attr('stroke', s)
    .attr('stroke-width', SW);
  // Stand
  g.append('line')
    .attr('x1', 0)
    .attr('y1', screenH)
    .attr('x2', 0)
    .attr('y2', H - 2)
    .attr('stroke', s)
    .attr('stroke-width', SW);
  // Base
  g.append('line')
    .attr('x1', -14)
    .attr('y1', H - 2)
    .attr('x2', 14)
    .attr('y2', H - 2)
    .attr('stroke', s)
    .attr('stroke-width', SW);
}

function renderExternalParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean,
  color?: string
): void {
  // Dashed border rectangle
  g.append('rect')
    .attr('x', -W / 2)
    .attr('y', 0)
    .attr('width', W)
    .attr('height', H)
    .attr('rx', 2)
    .attr('ry', 2)
    .attr('fill', fill(palette, isDark, color))
    .attr('stroke', stroke(palette, color))
    .attr('stroke-width', SW)
    .attr('stroke-dasharray', '6 3');
}

function renderGatewayParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean,
  color?: string
): void {
  renderRectParticipant(g, palette, isDark, color);
}

// ============================================================
// Collapsible Section Support
// ============================================================

export interface SectionMessageGroup {
  section: import('./parser').SequenceSection;
  messageIndices: number[]; // indices into messages[]
}

export interface SequenceRenderOptions {
  collapsedSections?: Set<number>; // keyed by section lineNumber
  collapsedGroups?: Set<number>; // keyed by group lineNumber
  expandedNoteLines?: Set<number>; // keyed by note lineNumber; undefined = all expanded (CLI default)
  exportWidth?: number; // Explicit width for CLI/export rendering (bypasses getBoundingClientRect)
  activeTagGroup?: string | null; // Active tag group name for tag-driven recoloring; null = explicitly none
}

/**
 * Group messages by the top-level section that precedes them.
 * Messages before the first section are ungrouped (always visible).
 * Only top-level sections are collapsible — sections inside blocks are excluded.
 */
export function groupMessagesBySection(
  elements: SequenceElement[],
  messages: SequenceMessage[]
): SectionMessageGroup[] {
  const groups: SectionMessageGroup[] = [];
  let currentGroup: SectionMessageGroup | null = null;

  // Recursively collect all message indices from an element subtree
  const collectIndices = (els: SequenceElement[]): number[] => {
    const indices: number[] = [];
    for (const el of els) {
      if (isSequenceBlock(el)) {
        indices.push(
          ...collectIndices(el.children),
          ...collectIndices(el.elseChildren)
        );
        if (el.elseIfBranches) {
          for (const branch of el.elseIfBranches) {
            indices.push(...collectIndices(branch.children));
          }
        }
      } else if (isSequenceSection(el) || isSequenceNote(el)) {
        // Sections and notes inside blocks are not messages — skip
        continue;
      } else {
        const idx = messages.indexOf(el as SequenceMessage);
        if (idx >= 0) indices.push(idx);
      }
    }
    return indices;
  };

  for (const el of elements) {
    if (isSequenceSection(el)) {
      // Start a new group for this top-level section
      currentGroup = { section: el, messageIndices: [] };
      groups.push(currentGroup);
    } else if (currentGroup) {
      // Collect messages from this element into the current group
      if (isSequenceBlock(el)) {
        currentGroup.messageIndices.push(...collectIndices([el]));
      } else if (!isSequenceNote(el)) {
        const idx = messages.indexOf(el as SequenceMessage);
        if (idx >= 0) currentGroup.messageIndices.push(idx);
      }
    }
    // Messages before the first section are ungrouped — skip
  }

  return groups;
}

// ============================================================
// Render Sequence Builder (stack-based return placement)
// ============================================================

export interface RenderStep {
  type: 'call' | 'return';
  from: string;
  to: string;
  label: string;
  messageIndex: number;
  async?: boolean;
}

/**
 * Build an ordered render sequence from flat messages.
 * Uses a call stack to infer where returns should be placed:
 * returns appear after all nested sub-calls complete.
 */
export function buildRenderSequence(messages: SequenceMessage[]): RenderStep[] {
  const steps: RenderStep[] = [];
  const stack: {
    from: string;
    to: string;
    messageIndex: number;
  }[] = [];

  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi];
    // Pop returns for callees that are no longer the sender
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.to === msg.from) break; // callee is still working
      stack.pop();
      steps.push({
        type: 'return',
        from: top.to,
        to: top.from,
        label: '',
        messageIndex: top.messageIndex,
      });
    }

    // Emit call
    steps.push({
      type: 'call',
      from: msg.from,
      to: msg.to,
      label: msg.label,
      messageIndex: mi,
      ...(msg.async ? { async: true } : {}),
    });

    // Async messages: no return arrow, no activation on target
    if (msg.async) {
      continue;
    }

    if (msg.from === msg.to) {
      // Self-call: immediately emit return (completes instantly)
      steps.push({
        type: 'return',
        from: msg.to,
        to: msg.from,
        label: '',
        messageIndex: mi,
      });
    } else {
      // Push onto stack for pending return
      stack.push({
        from: msg.from,
        to: msg.to,
        messageIndex: mi,
      });
    }
  }

  // Flush remaining returns
  while (stack.length > 0) {
    const top = stack.pop()!;
    steps.push({
      type: 'return',
      from: top.to,
      to: top.from,
      label: '',
      messageIndex: top.messageIndex,
    });
  }

  return steps;
}

// ============================================================
// Activation Computation
// ============================================================

export interface Activation {
  participantId: string;
  startStep: number;
  endStep: number;
  depth: number;
}

/**
 * Compute activation rectangles from render steps.
 * Each call pushes onto the callee's stack; each return pops it.
 */
export function computeActivations(steps: RenderStep[]): Activation[] {
  const activations: Activation[] = [];
  // Per-participant stack of open activations (step index)
  const stacks = new Map<string, number[]>();

  const getStack = (id: string): number[] => {
    if (!stacks.has(id)) stacks.set(id, []);
    return stacks.get(id)!;
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type === 'call') {
      const s = getStack(step.to);
      s.push(i);
    } else {
      // return: step.from is the callee returning
      const s = getStack(step.from);
      if (s.length > 0) {
        const startIdx = s.pop()!;
        activations.push({
          participantId: step.from,
          startStep: startIdx,
          endStep: i,
          depth: s.length,
        });
      }
    }
  }

  return activations;
}

// ============================================================
// Position Override Sorting
// ============================================================

/**
 * Reorder participants based on explicit `position` overrides.
 * Positive positions are 0-based from the left; negative positions count from the right (-1 = last).
 * Unpositioned participants maintain their relative order, filling remaining slots.
 */
export function applyPositionOverrides(
  participants: SequenceParticipant[]
): SequenceParticipant[] {
  if (!participants.some((p) => p.position !== undefined)) return participants;

  const total = participants.length;
  const positioned: { participant: SequenceParticipant; index: number }[] = [];
  const unpositioned: SequenceParticipant[] = [];

  for (const p of participants) {
    if (p.position !== undefined) {
      // Resolve negative: -1 → last, -2 → second-to-last
      let idx = p.position < 0 ? total + p.position : p.position;
      // Clamp to valid range
      idx = Math.max(0, Math.min(total - 1, idx));
      positioned.push({ participant: p, index: idx });
    } else {
      unpositioned.push(p);
    }
  }

  // Sort positioned by target index for deterministic placement
  positioned.sort((a, b) => a.index - b.index);

  // Place positioned participants, resolving conflicts by finding nearest free slot
  const result: (SequenceParticipant | null)[] = new Array(total).fill(null);
  const usedIndices = new Set<number>();

  for (const { participant, index } of positioned) {
    let idx = index;
    if (usedIndices.has(idx)) {
      // Find nearest free slot
      for (let offset = 1; offset < total; offset++) {
        if (idx + offset < total && !usedIndices.has(idx + offset)) {
          idx = idx + offset;
          break;
        }
        if (idx - offset >= 0 && !usedIndices.has(idx - offset)) {
          idx = idx - offset;
          break;
        }
      }
    }
    result[idx] = participant;
    usedIndices.add(idx);
  }

  // Fill remaining slots with unpositioned participants in order
  let uIdx = 0;
  for (let i = 0; i < total; i++) {
    if (result[i] === null) {
      result[i] = unpositioned[uIdx++];
    }
  }

  return result as SequenceParticipant[];
}

// Group Ordering
// ============================================================

/**
 * Reorder participants so that members of the same group are adjacent.
 * Groups are positioned at the point where their first member would naturally
 * appear based on message order (first-occurrence positioning). This prevents
 * groups declared at the top of the file from being placed before participants
 * that appear in messages earlier.
 *
 * Explicit `position` overrides are handled separately by `applyPositionOverrides`.
 */
export function applyGroupOrdering(
  participants: SequenceParticipant[],
  groups: SequenceGroup[],
  messages: SequenceMessage[] = []
): SequenceParticipant[] {
  if (groups.length === 0) return participants;

  // Build a map: participantId → group
  const idToGroup = new Map<string, SequenceGroup>();
  for (const group of groups) {
    for (const id of group.participantIds) {
      idToGroup.set(id, group);
    }
  }

  // Build first-appearance index from messages (order in which participants
  // are first referenced). Participants not in any message keep their
  // declaration order from the participants array.
  const appearanceOrder: string[] = [];
  const seen = new Set<string>();
  for (const msg of messages) {
    for (const id of [msg.from, msg.to]) {
      if (!seen.has(id)) {
        seen.add(id);
        appearanceOrder.push(id);
      }
    }
  }
  // Append any participants not referenced in messages (declaration-only)
  for (const p of participants) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      appearanceOrder.push(p.id);
    }
  }

  // Walk appearance order; when we encounter a grouped participant,
  // insert the entire group at that position (if not already placed).
  const result: SequenceParticipant[] = [];
  const placed = new Set<string>();
  const placedGroups = new Set<SequenceGroup>();

  for (const id of appearanceOrder) {
    if (placed.has(id)) continue;

    const group = idToGroup.get(id);
    if (group && !placedGroups.has(group)) {
      // Place entire group here
      placedGroups.add(group);
      for (const gid of group.participantIds) {
        const p = participants.find((pp) => pp.id === gid);
        if (p && !placed.has(gid)) {
          result.push(p);
          placed.add(gid);
        }
      }
    } else if (!group) {
      // Ungrouped participant
      const p = participants.find((pp) => pp.id === id);
      if (p) {
        result.push(p);
        placed.add(id);
      }
    }
    // If group already placed, skip (member already included)
  }

  return result;
}

// Main Renderer
// ============================================================

/**
 * Render a sequence diagram into the given container element.
 */
export function renderSequenceDiagram(
  container: HTMLDivElement,
  parsed: ParsedSequenceDgmo,
  palette: PaletteColors,
  isDark: boolean,
  _onNavigateToLine?: (line: number) => void,
  options?: SequenceRenderOptions
): void {
  // Clear previous content
  d3Selection.select(container).selectAll('*').remove();

  const { title, options: parsedOptions } = parsed;

  // Compute effective collapsed groups: union of syntax-declared and runtime-toggled
  const effectiveCollapsedGroups = new Set<number>();
  for (const group of parsed.groups) {
    if (group.collapsed) effectiveCollapsedGroups.add(group.lineNumber);
  }
  if (options?.collapsedGroups) {
    for (const ln of options.collapsedGroups) {
      // Toggle: if already in the set (from syntax), remove it (user expanded);
      // if not in the set, add it (user collapsed)
      if (effectiveCollapsedGroups.has(ln)) {
        effectiveCollapsedGroups.delete(ln);
      } else {
        effectiveCollapsedGroups.add(ln);
      }
    }
  }

  // Apply collapse projection before participant ordering
  const collapsed: CollapsedView | null =
    effectiveCollapsedGroups.size > 0
      ? applyCollapseProjection(parsed, effectiveCollapsedGroups)
      : null;

  const messages = collapsed ? collapsed.messages : parsed.messages;
  const elements = collapsed ? collapsed.elements : parsed.elements;
  const groups = collapsed ? collapsed.groups : parsed.groups;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const collapsedGroupIds = collapsed?.collapsedGroupIds ?? new Map();

  const collapsedSections = options?.collapsedSections;
  const expandedNoteLines = options?.expandedNoteLines;
  const collapseNotesDisabled =
    parsedOptions['collapse-notes']?.toLowerCase() === 'no';
  // A note is expanded if: expandedNoteLines is undefined (CLI/export),
  // collapse-notes: no is set, or the note's lineNumber is in the set.
  const isNoteExpanded = (note: SequenceNote): boolean =>
    expandedNoteLines === undefined ||
    collapseNotesDisabled ||
    expandedNoteLines.has(note.lineNumber);

  const sourceParticipants = collapsed
    ? collapsed.participants
    : parsed.participants;
  const participants = applyPositionOverrides(
    applyGroupOrdering(sourceParticipants, groups, messages)
  );
  if (participants.length === 0) return;

  const activationsOff = parsedOptions.activations?.toLowerCase() === 'off';

  // Tag resolution — shared utility handles priority chain:
  // programmatic override → diagram-level active-tag → auto-activate first group
  const activeTagGroup =
    resolveActiveTagGroup(
      parsed.tagGroups,
      parsedOptions['active-tag'],
      options?.activeTagGroup
    ) ?? undefined;
  let tagMap: ResolvedTagMap | undefined;
  const tagValueToColor = new Map<string, string>();
  if (activeTagGroup) {
    tagMap = resolveSequenceTags(parsed, activeTagGroup);
    const tg = parsed.tagGroups.find(
      (g) => g.name.toLowerCase() === activeTagGroup.toLowerCase()
    );
    if (tg) {
      for (const entry of tg.entries) {
        tagValueToColor.set(entry.value.toLowerCase(), entry.color);
      }
    }
  }
  const getTagColor = (value: string | undefined): string | undefined =>
    value ? tagValueToColor.get(value.toLowerCase()) : undefined;
  const tagKey = activeTagGroup?.toLowerCase();

  // Build hidden message set for collapse support
  const hiddenMsgIndices = new Set<number>();
  if (collapsedSections && collapsedSections.size > 0) {
    const sectionGroups = groupMessagesBySection(elements, messages);
    for (const grp of sectionGroups) {
      if (collapsedSections.has(grp.section.lineNumber)) {
        for (const idx of grp.messageIndices) {
          hiddenMsgIndices.add(idx);
        }
      }
    }
  }

  // Build render sequence with stack-based return placement
  // Run on ALL messages first (preserves call stack correctness), then filter
  const allRenderSteps = buildRenderSequence(messages);
  let renderSteps =
    hiddenMsgIndices.size > 0
      ? allRenderSteps.filter((s) => !hiddenMsgIndices.has(s.messageIndex))
      : allRenderSteps;
  // Drop unlabeled returns — they add visual noise without conveying information.
  // Labeled returns (explicit <- value) are kept.
  renderSteps = renderSteps.filter((s) => s.type === 'call' || s.label);
  const activations = activationsOff ? [] : computeActivations(renderSteps);
  const stepSpacing = 35;

  // --- Block-aware Y spacing ---
  // Extra spacing constants for block boundaries
  const BLOCK_HEADER_SPACE = 30; // Extra space for frame label above first message in a block
  const BLOCK_AFTER_SPACE = 15; // Extra space after a block ends (before next sibling)
  const FRAME_PADDING_TOP = 42; // Vertical padding from frame top to first message

  // Build maps from messageIndex to render step indices (needed early for spacing)
  const msgToFirstStep = new Map<number, number>();
  const msgToLastStep = new Map<number, number>();
  renderSteps.forEach((step, si) => {
    if (!msgToFirstStep.has(step.messageIndex)) {
      msgToFirstStep.set(step.messageIndex, si);
    }
    msgToLastStep.set(step.messageIndex, si);
  });

  // Map a note to the last render-step index of its preceding message
  // (the return arrow if present, otherwise the call arrow).
  // This ensures notes are positioned below the return arrow so they
  // don't overlap it.
  // If the note's closest preceding message is hidden (collapsed section), return -1
  // so the note is hidden along with its section.
  const findAssociatedLastStep = (note: SequenceNote): number => {
    // First find the closest preceding message (ignoring hidden filter)
    let closestMsgIndex = -1;
    let closestLine = -1;
    for (let mi = 0; mi < messages.length; mi++) {
      if (
        messages[mi].lineNumber < note.lineNumber &&
        messages[mi].lineNumber > closestLine
      ) {
        closestLine = messages[mi].lineNumber;
        closestMsgIndex = mi;
      }
    }
    // If the closest preceding message is hidden, hide the note too
    if (closestMsgIndex >= 0 && hiddenMsgIndices.has(closestMsgIndex)) {
      return -1;
    }
    if (closestMsgIndex < 0) return -1;
    return msgToLastStep.get(closestMsgIndex) ?? -1;
  };

  // Find the first visible message index in an element subtree
  const findFirstMsgIndex = (els: SequenceElement[]): number => {
    for (const el of els) {
      if (isSequenceBlock(el)) {
        const idx = findFirstMsgIndex(el.children);
        if (idx >= 0) return idx;
        if (el.elseIfBranches) {
          for (const branch of el.elseIfBranches) {
            const branchIdx = findFirstMsgIndex(branch.children);
            if (branchIdx >= 0) return branchIdx;
          }
        }
        const elseIdx = findFirstMsgIndex(el.elseChildren);
        if (elseIdx >= 0) return elseIdx;
      } else if (!isSequenceSection(el) && !isSequenceNote(el)) {
        const idx = messages.indexOf(el as SequenceMessage);
        if (idx >= 0 && !hiddenMsgIndices.has(idx)) return idx;
      }
    }
    return -1;
  };

  // Section layout constants
  const SECTION_TOP_PAD = 35; // space above section divider line (matches stepSpacing)
  const SECTION_BOTTOM_PAD = 45; // space below section divider line before next content

  // Block spacing via extraBeforeMsg (sections handled separately below)
  const extraBeforeMsg = new Map<number, number>();
  const addExtra = (msgIdx: number, amount: number) => {
    extraBeforeMsg.set(msgIdx, (extraBeforeMsg.get(msgIdx) || 0) + amount);
  };

  const markBlockSpacing = (els: SequenceElement[]): void => {
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (isSequenceSection(el)) continue; // sections handled separately
      if (!isSequenceBlock(el)) continue;

      const firstIdx = findFirstMsgIndex(el.children);
      if (firstIdx >= 0) addExtra(firstIdx, BLOCK_HEADER_SPACE);

      if (el.elseIfBranches) {
        for (const branch of el.elseIfBranches) {
          const firstBranchIdx = findFirstMsgIndex(branch.children);
          if (firstBranchIdx >= 0) addExtra(firstBranchIdx, BLOCK_HEADER_SPACE);
          markBlockSpacing(branch.children);
        }
      }

      const firstElseIdx = findFirstMsgIndex(el.elseChildren);
      if (firstElseIdx >= 0) addExtra(firstElseIdx, BLOCK_HEADER_SPACE);

      markBlockSpacing(el.children);
      markBlockSpacing(el.elseChildren);

      if (i + 1 < els.length) {
        const nextIdx = findFirstMsgIndex([els[i + 1]]);
        if (nextIdx >= 0) addExtra(nextIdx, BLOCK_AFTER_SPACE);
      }
    }
  };

  if (elements && elements.length > 0) {
    markBlockSpacing(elements);
  }

  // Note spacing — add vertical room after messages that have notes attached
  const NOTE_OFFSET_BELOW = 14; // gap between message arrow and top of note box
  // The next message label extends ~17px above its arrow line (8px offset + 9px cap height).
  // When notes share horizontal space with subsequent arrows, generous vertical clearance
  // is needed so note boxes don't visually cover message labels.
  const NOTE_TRAILING_GAP = 35;
  const computeNoteHeight = (text: string): number => {
    const lines = wrapTextLines(text, NOTE_CHARS_PER_LINE);
    return lines.length * NOTE_LINE_H + NOTE_PAD_V * 2;
  };
  let trailingNoteSpace = 0; // extra space for notes at the end with no following message
  const markNoteSpacing = (els: SequenceElement[]): void => {
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (isSequenceNote(el)) {
        // Total vertical extent of notes from the message arrow:
        //   NOTE_OFFSET_BELOW (gap above first note)
        //   + each note's height + NOTE_OFFSET_BELOW (inter-note gap)
        //   + NOTE_TRAILING_GAP (gap below last note — clears next message label)
        let totalExtent = NOTE_OFFSET_BELOW;
        let j = i;
        while (j < els.length && isSequenceNote(els[j])) {
          const note = els[j] as SequenceNote;
          const noteH = isNoteExpanded(note)
            ? computeNoteHeight(note.text)
            : COLLAPSED_NOTE_H;
          totalExtent += noteH + NOTE_OFFSET_BELOW;
          j++;
        }
        // Replace the final inter-note gap with the larger trailing gap
        totalExtent += NOTE_TRAILING_GAP - NOTE_OFFSET_BELOW;
        // Only reserve space beyond the existing stepSpacing gap
        let extraNeeded = Math.max(0, totalExtent - stepSpacing);
        // Scan forward past sections, blocks, and other non-message elements to find next message
        let nextMsgIdx = -1;
        for (let k = j; k < els.length; k++) {
          nextMsgIdx = findFirstMsgIndex([els[k]]);
          if (nextMsgIdx >= 0) break;
        }
        // If a block follows, its frame extends FRAME_PADDING_TOP above the first
        // message but only BLOCK_HEADER_SPACE is reserved. Add the difference so
        // the note doesn't overlap the frame.
        if (j < els.length && isSequenceBlock(els[j])) {
          extraNeeded += FRAME_PADDING_TOP - BLOCK_HEADER_SPACE;
        }
        if (nextMsgIdx >= 0) {
          addExtra(nextMsgIdx, extraNeeded);
        } else {
          // Notes at the end — reserve only the excess beyond stepSpacing
          trailingNoteSpace = Math.max(trailingNoteSpace, extraNeeded);
        }
        // Skip over the consecutive notes we just processed
        i = j - 1;
      } else if (isSequenceBlock(el)) {
        markNoteSpacing(el.children);
        if (el.elseIfBranches) {
          for (const branch of el.elseIfBranches) {
            markNoteSpacing(branch.children);
          }
        }
        markNoteSpacing(el.elseChildren);
      }
    }
  };
  if (elements && elements.length > 0) {
    markNoteSpacing(elements);
  }

  // --- Section-aware Y layout ---
  // Sections get their own Y positions computed from content above them (not anchored
  // to messages below). This ensures toggling collapse/expand doesn't move the divider.

  // Walk top-level elements to build section regions
  interface SectionRegion {
    section: import('./parser').SequenceSection;
    msgIndices: number[]; // message indices belonging to this section
  }
  const preSectionMsgIndices: number[] = [];
  const sectionRegions: SectionRegion[] = [];
  {
    // Build lineNumber → message index lookup.  This is used instead of
    // messages.indexOf() because collapse projection creates spread copies
    // of messages, breaking reference equality.
    const msgLineToIndex = new Map<number, number>();
    messages.forEach((m, i) => msgLineToIndex.set(m.lineNumber, i));

    const findMsgIndex = (child: SequenceElement): number =>
      msgLineToIndex.get(child.lineNumber) ?? -1;

    const collectMsgIndicesFromBlock = (
      block: import('./parser').SequenceBlock
    ): number[] => {
      const indices: number[] = [];
      for (const child of block.children) {
        if (isSequenceBlock(child)) {
          indices.push(...collectMsgIndicesFromBlock(child));
        } else if (!isSequenceSection(child) && !isSequenceNote(child)) {
          const idx = findMsgIndex(child);
          if (idx >= 0) indices.push(idx);
        }
      }
      if (block.elseIfBranches) {
        for (const branch of block.elseIfBranches) {
          for (const child of branch.children) {
            if (isSequenceBlock(child)) {
              indices.push(...collectMsgIndicesFromBlock(child));
            } else if (!isSequenceSection(child) && !isSequenceNote(child)) {
              const idx = findMsgIndex(child);
              if (idx >= 0) indices.push(idx);
            }
          }
        }
      }
      for (const child of block.elseChildren) {
        if (isSequenceBlock(child)) {
          indices.push(...collectMsgIndicesFromBlock(child));
        } else if (!isSequenceSection(child) && !isSequenceNote(child)) {
          const idx = findMsgIndex(child);
          if (idx >= 0) indices.push(idx);
        }
      }
      return indices;
    };

    let currentTarget = preSectionMsgIndices;
    for (const el of elements) {
      if (isSequenceSection(el)) {
        const region: SectionRegion = { section: el, msgIndices: [] };
        sectionRegions.push(region);
        currentTarget = region.msgIndices;
      } else if (isSequenceBlock(el)) {
        currentTarget.push(...collectMsgIndicesFromBlock(el));
      } else {
        const idx = findMsgIndex(el);
        if (idx >= 0) currentTarget.push(idx);
      }
    }
  }

  // Build mapping from original (all) render step index → filtered step index
  const allMsgToFirstStep = new Map<number, number>();
  allRenderSteps.forEach((step, si) => {
    if (!allMsgToFirstStep.has(step.messageIndex)) {
      allMsgToFirstStep.set(step.messageIndex, si);
    }
  });

  const originalToFiltered = new Map<number, number>();
  {
    let fi = 0;
    for (let oi = 0; oi < allRenderSteps.length; oi++) {
      const step = allRenderSteps[oi];
      if (
        !hiddenMsgIndices.has(step.messageIndex) &&
        (step.type === 'call' || step.label)
      ) {
        originalToFiltered.set(oi, fi);
        fi++;
      }
    }
  }

  // For each section, find the filtered step index where its padding should be inserted
  const findFilteredInsertionPoint = (origStep: number): number | null => {
    for (let i = origStep; i < allRenderSteps.length; i++) {
      const fi = originalToFiltered.get(i);
      if (fi !== undefined) return fi;
    }
    return null;
  };

  // Map: filtered step index → sections to insert before it (in document order)
  const sectionsBeforeStep = new Map<
    number,
    import('./parser').SequenceSection[]
  >();
  const trailingSections: import('./parser').SequenceSection[] = [];

  for (const region of sectionRegions) {
    if (region.msgIndices.length === 0) {
      trailingSections.push(region.section);
      continue;
    }
    const firstMsgIdx = region.msgIndices[0];
    const origStep = allMsgToFirstStep.get(firstMsgIdx);
    if (origStep === undefined) {
      trailingSections.push(region.section);
      continue;
    }
    const filteredStep = findFilteredInsertionPoint(origStep);
    if (filteredStep === null) {
      trailingSections.push(region.section);
      continue;
    }
    const existing = sectionsBeforeStep.get(filteredStep) || [];
    existing.push(region.section);
    sectionsBeforeStep.set(filteredStep, existing);
  }

  // Section message counts for collapsed labels
  const sectionMsgCounts = new Map<number, number>();
  for (const region of sectionRegions) {
    sectionMsgCounts.set(region.section.lineNumber, region.msgIndices.length);
  }

  // Group box layout constants (needed early for Y offset)
  const GROUP_PADDING_X = 15;
  const GROUP_PADDING_TOP = 22;
  const GROUP_PADDING_BOTTOM = 8;
  const GROUP_LABEL_SIZE = 11;

  // Compute cumulative Y positions for each step, with section dividers as stable anchors
  const titleOffset = title ? TITLE_HEIGHT : 0;
  const LEGEND_FIXED_GAP = 8;
  const legendTopSpace =
    parsed.tagGroups.length > 0 ? LEGEND_HEIGHT + LEGEND_FIXED_GAP : 0;
  // Use parsed.groups (not projected groups) to keep vertical space consistent
  // even when all groups are collapsed into virtual participants
  const groupOffset =
    parsed.groups.length > 0 ? GROUP_PADDING_TOP + GROUP_LABEL_SIZE : 0;
  const participantStartY =
    TOP_MARGIN +
    titleOffset +
    legendTopSpace +
    PARTICIPANT_Y_OFFSET +
    groupOffset;
  const lifelineStartY0 = participantStartY + PARTICIPANT_BOX_HEIGHT;
  const hasActors = participants.some((p) => p.type === 'actor');
  const messageStartOffset = MESSAGE_START_OFFSET + (hasActors ? 20 : 0);
  const stepYPositions: number[] = [];
  const sectionYPositions = new Map<number, number>(); // section lineNumber → Y
  let layoutEndY: number; // final Y after all steps and trailing sections
  {
    let curY = lifelineStartY0 + messageStartOffset;
    for (let i = 0; i < renderSteps.length; i++) {
      // Insert section padding before this step if needed
      const sections = sectionsBeforeStep.get(i);
      if (sections) {
        for (const sec of sections) {
          curY += SECTION_TOP_PAD;
          sectionYPositions.set(sec.lineNumber, curY);
          curY += SECTION_BOTTOM_PAD;
        }
      }

      const step = renderSteps[i];
      // Add extra spacing before the first render step of a flagged message (block spacing)
      if (msgToFirstStep.get(step.messageIndex) === i) {
        const extra = extraBeforeMsg.get(step.messageIndex) || 0;
        curY += extra;
      }
      stepYPositions.push(curY);
      curY += stepSpacing;
    }
    // Handle trailing sections (after all steps)
    for (const sec of trailingSections) {
      curY += SECTION_TOP_PAD;
      sectionYPositions.set(sec.lineNumber, curY);
      curY += SECTION_BOTTOM_PAD;
    }
    // Extend for trailing notes that have no following message
    curY += trailingNoteSpace;
    layoutEndY = curY;
  }

  // Helper: compute Y for a step index
  const stepY = (i: number) => stepYPositions[i];

  // Compute absolute Y positions for each note element
  const noteYMap = new Map<SequenceNote, number>();
  {
    const computeNotePositions = (els: SequenceElement[]): void => {
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (isSequenceNote(el)) {
          const si = findAssociatedLastStep(el);
          if (si < 0) continue;
          // Check if there's a preceding note that we should stack below
          const prevNote =
            i > 0 && isSequenceNote(els[i - 1])
              ? (els[i - 1] as SequenceNote)
              : null;
          const prevNoteY = prevNote ? noteYMap.get(prevNote) : undefined;
          let noteTopY: number;
          if (prevNoteY !== undefined && prevNote) {
            // Stack below previous note
            const prevNoteH = isNoteExpanded(prevNote)
              ? computeNoteHeight(prevNote.text)
              : COLLAPSED_NOTE_H;
            noteTopY = prevNoteY + prevNoteH + NOTE_OFFSET_BELOW;
          } else {
            // First note after a message
            noteTopY = stepY(si) + NOTE_OFFSET_BELOW;
          }
          noteYMap.set(el, noteTopY);
        } else if (isSequenceBlock(el)) {
          computeNotePositions(el.children);
          if (el.elseIfBranches) {
            for (const branch of el.elseIfBranches) {
              computeNotePositions(branch.children);
            }
          }
          computeNotePositions(el.elseChildren);
        }
      }
    };
    if (elements && elements.length > 0) {
      computeNotePositions(elements);
    }
  }

  // Ensure contentBottomY accounts for all note extents
  let contentBottomY =
    renderSteps.length > 0
      ? Math.max(
          stepYPositions[stepYPositions.length - 1] + stepSpacing,
          layoutEndY
        )
      : layoutEndY;
  for (const [note, noteTopY] of noteYMap) {
    const noteH = isNoteExpanded(note)
      ? computeNoteHeight(note.text)
      : COLLAPSED_NOTE_H;
    contentBottomY = Math.max(
      contentBottomY,
      noteTopY + noteH + NOTE_TRAILING_GAP
    );
  }
  const messageAreaHeight = contentBottomY - lifelineStartY0;
  const lifelineLength = messageAreaHeight + LIFELINE_TAIL;
  const totalWidth = Math.max(
    participants.length * PARTICIPANT_GAP,
    PARTICIPANT_BOX_WIDTH + 40
  );
  const contentHeight =
    participantStartY +
    PARTICIPANT_BOX_HEIGHT +
    Math.max(lifelineLength, 40) +
    40;
  const totalHeight = contentHeight;

  const containerWidth =
    options?.exportWidth ?? container.getBoundingClientRect().width;
  const svgWidth = Math.max(totalWidth, containerWidth);

  // Center the diagram horizontally
  const diagramWidth = participants.length * PARTICIPANT_GAP;
  const offsetX =
    Math.max(0, (svgWidth - diagramWidth) / 2) + PARTICIPANT_GAP / 2;

  // Build participant x-position lookup
  const participantX = new Map<string, number>();
  participants.forEach((p, i) => {
    participantX.set(p.id, offsetX + i * PARTICIPANT_GAP);
  });

  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', totalHeight)
    .attr('viewBox', `0 0 ${svgWidth} ${totalHeight}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('class', 'sequence-diagram')
    .style('font-family', FONT_FAMILY);

  // Define arrowhead markers
  const defs = svg.append('defs');

  // Filled arrowhead for call arrows
  defs
    .append('marker')
    .attr('id', 'seq-arrowhead')
    .attr('viewBox', `0 0 ${ARROWHEAD_SIZE} ${ARROWHEAD_SIZE}`)
    .attr('refX', ARROWHEAD_SIZE)
    .attr('refY', ARROWHEAD_SIZE / 2)
    .attr('markerWidth', ARROWHEAD_SIZE)
    .attr('markerHeight', ARROWHEAD_SIZE)
    .attr('orient', 'auto')
    .append('polygon')
    .attr(
      'points',
      `0,0 ${ARROWHEAD_SIZE},${ARROWHEAD_SIZE / 2} 0,${ARROWHEAD_SIZE}`
    )
    .attr('fill', palette.text);

  // Open arrowhead for return arrows
  defs
    .append('marker')
    .attr('id', 'seq-arrowhead-open')
    .attr('viewBox', `0 0 ${ARROWHEAD_SIZE} ${ARROWHEAD_SIZE}`)
    .attr('refX', ARROWHEAD_SIZE)
    .attr('refY', ARROWHEAD_SIZE / 2)
    .attr('markerWidth', ARROWHEAD_SIZE)
    .attr('markerHeight', ARROWHEAD_SIZE)
    .attr('orient', 'auto')
    .append('polyline')
    .attr(
      'points',
      `0,0 ${ARROWHEAD_SIZE},${ARROWHEAD_SIZE / 2} 0,${ARROWHEAD_SIZE}`
    )
    .attr('fill', 'none')
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1.2);

  // Open arrowhead for async (fire-and-forget) arrows — same as return but text color
  defs
    .append('marker')
    .attr('id', 'seq-arrowhead-async')
    .attr('viewBox', `0 0 ${ARROWHEAD_SIZE} ${ARROWHEAD_SIZE}`)
    .attr('refX', ARROWHEAD_SIZE)
    .attr('refY', ARROWHEAD_SIZE / 2)
    .attr('markerWidth', ARROWHEAD_SIZE)
    .attr('markerHeight', ARROWHEAD_SIZE)
    .attr('orient', 'auto')
    .append('polyline')
    .attr(
      'points',
      `0,0 ${ARROWHEAD_SIZE},${ARROWHEAD_SIZE / 2} 0,${ARROWHEAD_SIZE}`
    )
    .attr('fill', 'none')
    .attr('stroke', palette.text)
    .attr('stroke-width', 1.2);

  // Per-color arrowhead markers for tag-driven coloring
  const arrowPoints = `0,0 ${ARROWHEAD_SIZE},${ARROWHEAD_SIZE / 2} 0,${ARROWHEAD_SIZE}`;
  for (const [, color] of tagValueToColor) {
    const hex = color.replace('#', '');
    // Filled arrowhead (call arrows)
    defs
      .append('marker')
      .attr('id', `seq-arrowhead-c${hex}`)
      .attr('viewBox', `0 0 ${ARROWHEAD_SIZE} ${ARROWHEAD_SIZE}`)
      .attr('refX', ARROWHEAD_SIZE)
      .attr('refY', ARROWHEAD_SIZE / 2)
      .attr('markerWidth', ARROWHEAD_SIZE)
      .attr('markerHeight', ARROWHEAD_SIZE)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', arrowPoints)
      .attr('fill', color);
    // Open arrowhead (async arrows)
    defs
      .append('marker')
      .attr('id', `seq-arrowhead-async-c${hex}`)
      .attr('viewBox', `0 0 ${ARROWHEAD_SIZE} ${ARROWHEAD_SIZE}`)
      .attr('refX', ARROWHEAD_SIZE)
      .attr('refY', ARROWHEAD_SIZE / 2)
      .attr('markerWidth', ARROWHEAD_SIZE)
      .attr('markerHeight', ARROWHEAD_SIZE)
      .attr('orient', 'auto')
      .append('polyline')
      .attr('points', arrowPoints)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1.2);
    // Open arrowhead (return arrows)
    defs
      .append('marker')
      .attr('id', `seq-arrowhead-open-c${hex}`)
      .attr('viewBox', `0 0 ${ARROWHEAD_SIZE} ${ARROWHEAD_SIZE}`)
      .attr('refX', ARROWHEAD_SIZE)
      .attr('refY', ARROWHEAD_SIZE / 2)
      .attr('markerWidth', ARROWHEAD_SIZE)
      .attr('markerHeight', ARROWHEAD_SIZE)
      .attr('orient', 'auto')
      .append('polyline')
      .attr('points', arrowPoints)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1.2);
  }

  // Helper: resolve marker ref for tag-colored arrows
  const coloredMarker = (
    type: 'call' | 'async' | 'return',
    tagColor?: string
  ): string => {
    if (tagColor) {
      const hex = tagColor.replace('#', '');
      switch (type) {
        case 'call':
          return `url(#seq-arrowhead-c${hex})`;
        case 'async':
          return `url(#seq-arrowhead-async-c${hex})`;
        case 'return':
          return `url(#seq-arrowhead-open-c${hex})`;
      }
    }
    switch (type) {
      case 'call':
        return 'url(#seq-arrowhead)';
      case 'async':
        return 'url(#seq-arrowhead-async)';
      case 'return':
        return 'url(#seq-arrowhead-open)';
    }
  };

  // Render title
  if (title) {
    const titleEl = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', svgWidth / 2)
      .attr('y', 30)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', TITLE_FONT_SIZE)
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .text(title);

    if (parsed.titleLineNumber) {
      titleEl.attr('data-line-number', parsed.titleLineNumber);
    }
  }

  // Render legend pills for tag groups
  if (parsed.tagGroups.length > 0) {
    const legendY = TOP_MARGIN + titleOffset;
    // Resolve tag colors for legend entries
    const resolvedGroups = parsed.tagGroups
      .filter((tg) => tg.entries.length > 0)
      .map((tg) => ({
        name: tg.name,
        entries: tg.entries.map((e) => ({
          value: e.value,
          color: e.color,
        })),
      }));
    const legendConfig: LegendConfig = {
      groups: resolvedGroups,
      position: { placement: 'top-center', titleRelation: 'below-title' },
      mode: 'fixed',
    };
    const legendState: LegendState = { activeGroup: activeTagGroup ?? null };
    const legendG = svg
      .append('g')
      .attr('class', 'sequence-legend')
      .attr('transform', `translate(0,${legendY})`);
    renderLegendD3(
      legendG,
      legendConfig,
      legendState,
      palette,
      isDark,
      undefined,
      svgWidth
    );
  }

  // Build set of collapsed group names for drill-bar rendering
  const collapsedGroupNames = new Set<string>();
  const collapsedGroupMeta = new Map<
    string,
    { lineNumber: number; metadata?: Record<string, string> }
  >();
  for (const group of parsed.groups) {
    if (effectiveCollapsedGroups.has(group.lineNumber)) {
      collapsedGroupNames.add(group.name);
      collapsedGroupMeta.set(group.name, {
        lineNumber: group.lineNumber,
        metadata: group.metadata,
      });
    }
  }

  // Render group boxes (behind participant shapes) — skip collapsed groups
  for (const group of groups) {
    if (group.participantIds.length === 0) continue;

    // Find X bounds from member participant positions
    const memberXs = group.participantIds
      .map((id) => participantX.get(id))
      .filter((x): x is number => x !== undefined);
    if (memberXs.length === 0) continue;

    const minX =
      Math.min(...memberXs) - PARTICIPANT_BOX_WIDTH / 2 - GROUP_PADDING_X;
    const maxX =
      Math.max(...memberXs) + PARTICIPANT_BOX_WIDTH / 2 + GROUP_PADDING_X;
    const boxY = participantStartY - GROUP_PADDING_TOP;
    const boxH =
      PARTICIPANT_BOX_HEIGHT + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM;

    // Group box background — use tag color if group has metadata for the active tag group
    const groupTagValue = tagKey && group.metadata?.[tagKey];
    const groupTagColor = getTagColor(groupTagValue || undefined);
    const fillColor = groupTagColor
      ? mix(
          groupTagColor,
          isDark ? palette.surface : palette.bg,
          isDark ? 15 : 20
        )
      : isDark
        ? palette.surface
        : palette.bg;
    const strokeColor = groupTagColor || palette.textMuted;

    const groupG = svg
      .append('g')
      .attr('class', 'group-box-wrapper')
      .attr('data-group-toggle', '')
      .attr('data-group-line', String(group.lineNumber))
      .attr('cursor', 'pointer');
    groupG.append('title').text('Click to collapse');

    groupG
      .append('rect')
      .attr('x', minX)
      .attr('y', boxY)
      .attr('width', maxX - minX)
      .attr('height', boxH)
      .attr('rx', 6)
      .attr('fill', fillColor)
      .attr('stroke', strokeColor)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5)
      .attr('class', 'group-box');

    // Group label
    groupG
      .append('text')
      .attr('x', minX + 8)
      .attr('y', boxY + GROUP_LABEL_SIZE + 4)
      .attr('fill', strokeColor)
      .attr('font-size', GROUP_LABEL_SIZE)
      .attr('font-weight', 'bold')
      .attr('opacity', 0.7)
      .attr('class', 'group-label')
      .text(group.name);
  }

  // Render each participant
  const lifelineStartY = lifelineStartY0;
  participants.forEach((participant, index) => {
    const cx = offsetX + index * PARTICIPANT_GAP;
    const cy = participantStartY;

    const pTagValue = tagMap?.participants.get(participant.id);
    const pTagColor = getTagColor(pTagValue);
    const pTagAttr =
      tagKey && pTagValue
        ? { key: tagKey, value: pTagValue.toLowerCase() }
        : undefined;
    // For collapsed group participants, resolve tag color from group metadata
    const isCollapsedGroup = collapsedGroupNames.has(participant.id);
    let effectiveTagColor = pTagColor;
    if (isCollapsedGroup && !effectiveTagColor) {
      const meta = collapsedGroupMeta.get(participant.id);
      if (meta?.metadata && tagKey) {
        effectiveTagColor = getTagColor(meta.metadata[tagKey]);
      }
    }

    renderParticipant(
      svg,
      participant,
      cx,
      cy,
      palette,
      isDark,
      effectiveTagColor,
      pTagAttr
    );

    // Collapsed group: re-render participant box at full group height + drill-bar
    if (isCollapsedGroup) {
      const meta = collapsedGroupMeta.get(participant.id)!;
      const drillColor = effectiveTagColor || palette.textMuted;
      const drillBarH = 6;
      const boxW = PARTICIPANT_BOX_WIDTH;
      // Match the group box dimensions
      const fullH =
        PARTICIPANT_BOX_HEIGHT + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM;
      const clipId = `clip-drill-group-${participant.id.replace(/[^a-zA-Z0-9-]/g, '-')}`;

      // Add toggle attributes to the participant <g> so any click on it
      // (overlay rect, label, drill-bar) walks up and triggers the toggle
      const participantG = svg.select<SVGGElement>(
        `.participant[data-participant-id="${participant.id}"]`
      );
      participantG
        .attr('data-group-toggle', '')
        .attr('data-group-line', String(meta.lineNumber))
        .attr('cursor', 'pointer');
      participantG.append('title').text('Click to expand');

      // Overlay a taller rect to replace the standard participant box
      const pFill = effectiveTagColor
        ? mix(
            effectiveTagColor,
            isDark ? palette.surface : palette.bg,
            isDark ? 30 : 40
          )
        : isDark
          ? mix(palette.overlay, palette.surface, 50)
          : mix(palette.bg, palette.surface, 50);
      const pStroke = effectiveTagColor || palette.border;

      // Taller box inside the participant <g> (local coords, y=0 is participant cy)
      participantG
        .append('rect')
        .attr('x', -boxW / 2)
        .attr('y', -GROUP_PADDING_TOP)
        .attr('width', boxW)
        .attr('height', fullH)
        .attr('rx', 6)
        .attr('fill', pFill)
        .attr('stroke', pStroke)
        .attr('stroke-width', 1.5);

      // Re-render label centered in the taller box (local coords)
      participantG
        .append('text')
        .attr('x', 0)
        .attr('y', -GROUP_PADDING_TOP + fullH / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('fill', palette.text)
        .attr('font-size', 13)
        .attr('font-weight', 500)
        .text(participant.label);

      // Drill-bar at bottom (local coords)
      participantG
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', -boxW / 2)
        .attr('y', -GROUP_PADDING_TOP)
        .attr('width', boxW)
        .attr('height', fullH)
        .attr('rx', 6);

      participantG
        .append('rect')
        .attr('class', 'sequence-drill-bar')
        .attr('x', -boxW / 2)
        .attr('y', -GROUP_PADDING_TOP + fullH - drillBarH)
        .attr('width', boxW)
        .attr('height', drillBarH)
        .attr('fill', drillColor)
        .attr('clip-path', `url(#${clipId})`);
    }

    // Render lifeline — collapsed groups start below the taller box
    const llY = isCollapsedGroup
      ? lifelineStartY + GROUP_PADDING_BOTTOM
      : lifelineStartY;
    const llColor = isCollapsedGroup
      ? effectiveTagColor || palette.textMuted
      : pTagColor || palette.textMuted;
    const lifelineEl = svg
      .append('line')
      .attr('x1', cx)
      .attr('y1', llY)
      .attr('x2', cx)
      .attr('y2', lifelineStartY + lifelineLength)
      .attr('stroke', llColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '6 4')
      .attr('class', 'lifeline')
      .attr('data-participant-id', participant.id);
    if (tagKey && pTagValue) {
      lifelineEl.attr(`data-tag-${tagKey}`, pTagValue.toLowerCase());
    }
  });

  // Render block frames (behind everything else)
  const FRAME_PADDING_X = 30;
  // FRAME_PADDING_TOP declared earlier (near BLOCK_HEADER_SPACE)
  const FRAME_PADDING_BOTTOM = 15;
  const FRAME_LABEL_HEIGHT = 18;

  // Collect message indices from an element subtree
  const collectMsgIndices = (els: SequenceElement[]): number[] => {
    const indices: number[] = [];
    for (const el of els) {
      if (isSequenceBlock(el)) {
        indices.push(
          ...collectMsgIndices(el.children),
          ...collectMsgIndices(el.elseChildren)
        );
        if (el.elseIfBranches) {
          for (const branch of el.elseIfBranches) {
            indices.push(...collectMsgIndices(branch.children));
          }
        }
      } else if (!isSequenceSection(el) && !isSequenceNote(el)) {
        const idx = messages.indexOf(el as SequenceMessage);
        if (idx >= 0) indices.push(idx);
      }
    }
    return indices;
  };

  // Collect deferred draws (rendered after activations so they appear on top)
  const deferredLabels: Array<{
    x: number;
    y: number;
    text: string;
    bold: boolean;
    italic: boolean;
    blockLine?: number;
  }> = [];
  const deferredLines: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    blockLine?: number;
  }> = [];

  // Recursive block renderer — draws borders/dividers now, defers label text
  const renderBlockFrames = (els: SequenceElement[], depth: number): void => {
    for (const el of els) {
      if (!isSequenceBlock(el)) continue;

      const ifIndices = collectMsgIndices(el.children);
      const elseIfBranchData: {
        label: string;
        indices: number[];
        lineNumber: number;
      }[] = [];
      if (el.elseIfBranches) {
        for (const branch of el.elseIfBranches) {
          elseIfBranchData.push({
            label: branch.label,
            indices: collectMsgIndices(branch.children),
            lineNumber: branch.lineNumber,
          });
        }
      }
      const elseIndices = collectMsgIndices(el.elseChildren);
      const allIndices = [
        ...ifIndices,
        ...elseIfBranchData.flatMap((b) => b.indices),
        ...elseIndices,
      ];
      if (allIndices.length === 0) continue;

      // Find render step range
      let minStep = Infinity;
      let maxStep = -Infinity;
      for (const mi of allIndices) {
        const first = msgToFirstStep.get(mi);
        const last = msgToLastStep.get(mi);
        if (first !== undefined) minStep = Math.min(minStep, first);
        if (last !== undefined) maxStep = Math.max(maxStep, last);
      }
      if (minStep === Infinity) continue;

      // Find participant X range
      const involved = new Set<string>();
      for (const mi of allIndices) {
        involved.add(messages[mi].from);
        involved.add(messages[mi].to);
      }
      let minPX = Infinity;
      let maxPX = -Infinity;
      for (const pid of involved) {
        const px = participantX.get(pid);
        if (px !== undefined) {
          minPX = Math.min(minPX, px);
          maxPX = Math.max(maxPX, px);
        }
      }

      const frameX = minPX - FRAME_PADDING_X;
      const frameY = stepY(minStep) - FRAME_PADDING_TOP;
      const frameW = maxPX - minPX + FRAME_PADDING_X * 2;
      const frameH =
        stepY(maxStep) -
        stepY(minStep) +
        FRAME_PADDING_TOP +
        FRAME_PADDING_BOTTOM;

      // Frame border
      svg
        .append('rect')
        .attr('x', frameX)
        .attr('y', frameY)
        .attr('width', frameW)
        .attr('height', frameH)
        .attr('fill', 'none')
        .attr('stroke', palette.textMuted)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '2 3')
        .attr('rx', 3)
        .attr('ry', 3)
        .attr('class', 'block-frame')
        .attr('data-block-line', String(el.lineNumber));

      // Defer label text (rendered on top of activations later)
      deferredLabels.push({
        x: frameX + 6,
        y: frameY + FRAME_LABEL_HEIGHT - 4,
        text: `${el.type} ${el.label}`,
        bold: true,
        italic: false,
        blockLine: el.lineNumber,
      });

      // Else-if dividers
      for (const branchData of elseIfBranchData) {
        if (branchData.indices.length > 0) {
          let firstBranchStep = Infinity;
          for (const mi of branchData.indices) {
            const first = msgToFirstStep.get(mi);
            if (first !== undefined)
              firstBranchStep = Math.min(firstBranchStep, first);
          }
          if (firstBranchStep < Infinity) {
            const dividerY = stepY(firstBranchStep) - stepSpacing / 2;
            deferredLines.push({
              x1: frameX,
              y1: dividerY,
              x2: frameX + frameW,
              y2: dividerY,
              blockLine: branchData.lineNumber,
            });
            deferredLabels.push({
              x: frameX + 6,
              y: dividerY + 14,
              text: `else if ${branchData.label}`,
              bold: false,
              italic: true,
              blockLine: branchData.lineNumber,
            });
          }
        }
      }

      // Else divider
      if (elseIndices.length > 0) {
        let firstElseStep = Infinity;
        for (const mi of elseIndices) {
          const first = msgToFirstStep.get(mi);
          if (first !== undefined)
            firstElseStep = Math.min(firstElseStep, first);
        }
        if (firstElseStep < Infinity) {
          const dividerY = stepY(firstElseStep) - stepSpacing / 2;
          deferredLines.push({
            x1: frameX,
            y1: dividerY,
            x2: frameX + frameW,
            y2: dividerY,
            blockLine: el.elseLineNumber,
          });
          deferredLabels.push({
            x: frameX + 6,
            y: dividerY + 14,
            text: 'else',
            bold: false,
            italic: true,
            blockLine: el.elseLineNumber,
          });
        }
      }

      // Recurse into nested blocks
      renderBlockFrames(el.children, depth + 1);
      if (el.elseIfBranches) {
        for (const branch of el.elseIfBranches) {
          renderBlockFrames(branch.children, depth + 1);
        }
      }
      renderBlockFrames(el.elseChildren, depth + 1);
    }
  };

  if (elements && elements.length > 0) {
    renderBlockFrames(elements, 0);
  }

  // Render activation rectangles (behind arrows)
  const ACTIVATION_WIDTH = 10;
  const ACTIVATION_NEST_OFFSET = 6;
  activations.forEach((act) => {
    const px = participantX.get(act.participantId);
    if (px === undefined) return;

    const x = px - ACTIVATION_WIDTH / 2 + act.depth * ACTIVATION_NEST_OFFSET;
    const y1 = stepY(act.startStep);
    const y2 = stepY(act.endStep);

    // Collect message line numbers covered by this activation
    const coveredLines: number[] = [];
    for (let si = act.startStep; si <= act.endStep; si++) {
      const step = renderSteps[si];
      const msg = messages[step.messageIndex];
      if (msg) coveredLines.push(msg.lineNumber);
    }

    // Determine activation color from triggering message's tag
    const triggerMsg = messages[renderSteps[act.startStep]?.messageIndex];
    const actTagValue = triggerMsg
      ? tagMap?.messages.get(triggerMsg.lineNumber)
      : undefined;
    const actTagColor = getTagColor(actTagValue);
    const actBaseColor = actTagColor || palette.primary;

    // Opaque background to mask the lifeline
    svg
      .append('rect')
      .attr('x', x)
      .attr('y', y1)
      .attr('width', ACTIVATION_WIDTH)
      .attr('height', y2 - y1)
      .attr('fill', isDark ? palette.surface : palette.bg);

    const actFill = mix(
      actBaseColor,
      isDark ? palette.surface : palette.bg,
      isDark ? 15 : 30
    );
    const actRect = svg
      .append('rect')
      .attr('x', x)
      .attr('y', y1)
      .attr('width', ACTIVATION_WIDTH)
      .attr('height', y2 - y1)
      .attr('fill', actFill)
      .attr('stroke', actBaseColor)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5)
      .attr('data-participant-id', act.participantId)
      .attr('data-msg-lines', coveredLines.join(','))
      .attr('data-line-number', coveredLines[0] ?? '')
      .attr('class', 'activation');
    if (tagKey && actTagValue) {
      actRect.attr(`data-tag-${tagKey}`, actTagValue.toLowerCase());
    }
  });

  // Render deferred else dividers (on top of activations)
  for (const ln of deferredLines) {
    const line = svg
      .append('line')
      .attr('x1', ln.x1)
      .attr('y1', ln.y1)
      .attr('x2', ln.x2)
      .attr('y2', ln.y2)
      .attr('stroke', palette.textMuted)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2 3')
      .attr('class', 'block-divider');
    if (ln.blockLine !== undefined)
      line.attr('data-block-line', String(ln.blockLine));
  }

  // Render deferred block labels (on top of activations)
  for (const lbl of deferredLabels) {
    const t = svg
      .append('text')
      .attr('x', lbl.x)
      .attr('y', lbl.y)
      .attr('fill', palette.text)
      .attr('font-size', 11)
      .attr('class', 'block-label')
      .text(lbl.text);
    if (lbl.bold) t.attr('font-weight', 'bold');
    if (lbl.italic) t.attr('font-style', 'italic');
    if (lbl.blockLine !== undefined)
      t.attr('data-block-line', String(lbl.blockLine));
  }

  // Helper: find max active activation depth for a participant at a step
  const activeDepthAt = (pid: string, stepIdx: number): number => {
    let maxDepth = -1;
    for (const act of activations) {
      if (
        act.participantId === pid &&
        act.startStep <= stepIdx &&
        stepIdx <= act.endStep &&
        act.depth > maxDepth
      ) {
        maxDepth = act.depth;
      }
    }
    return maxDepth;
  };

  // Helper: compute arrow endpoint X, snapping to activation box edge
  const arrowEdgeX = (
    pid: string,
    stepIdx: number,
    side: 'left' | 'right'
  ): number => {
    const px = participantX.get(pid)!;
    const depth = activeDepthAt(pid, stepIdx);
    if (depth < 0) return px;
    const offset = depth * ACTIVATION_NEST_OFFSET;
    return side === 'right'
      ? px + ACTIVATION_WIDTH / 2 + offset
      : px - ACTIVATION_WIDTH / 2 + offset;
  };

  // Render section dividers
  const leftmostX = Math.min(...Array.from(participantX.values()));
  const rightmostX = Math.max(...Array.from(participantX.values()));
  const sectionLineX1 = leftmostX - PARTICIPANT_BOX_WIDTH / 2 - 10;
  const sectionLineX2 = rightmostX + PARTICIPANT_BOX_WIDTH / 2 + 10;

  for (const region of sectionRegions) {
    const sec = region.section;
    const secY = sectionYPositions.get(sec.lineNumber);
    if (secY === undefined) continue;

    const isCollapsed = collapsedSections?.has(sec.lineNumber) ?? false;
    const lineColor = palette.textMuted;

    // Wrap section elements in a <g> for toggle.
    // IMPORTANT: only the <g> carries data-line-number / data-section —
    // children must NOT have them, otherwise the click walk-up resolves
    // to a line-number navigation before reaching data-section-toggle.
    const sectionG = svg
      .append('g')
      .attr('data-section-toggle', '')
      .attr('data-line-number', String(sec.lineNumber))
      .attr('data-section', '')
      .attr('tabindex', '0')
      .attr('role', 'button')
      .attr('aria-expanded', String(!isCollapsed));

    // Full-width tinted band
    const BAND_HEIGHT = 22;
    const bandX = sectionLineX1 - 10;
    const bandWidth = sectionLineX2 - sectionLineX1 + 20;
    const bandOpacity = isCollapsed
      ? isDark
        ? 0.35
        : 0.25
      : isDark
        ? 0.1
        : 0.08;
    sectionG
      .append('rect')
      .attr('x', bandX)
      .attr('y', secY - BAND_HEIGHT / 2)
      .attr('width', bandWidth)
      .attr('height', BAND_HEIGHT)
      .attr('fill', lineColor)
      .attr('opacity', bandOpacity)
      .attr('rx', 2)
      .attr('class', 'section-divider');

    // Build display label
    const msgCount = sectionMsgCounts.get(sec.lineNumber) ?? 0;
    const labelText = isCollapsed
      ? `${sec.label} (${msgCount} ${msgCount === 1 ? 'message' : 'messages'})`
      : sec.label;

    // Centered label text
    const labelX = (sectionLineX1 + sectionLineX2) / 2;
    sectionG
      .append('text')
      .attr('x', labelX)
      .attr('y', secY + 4)
      .attr('text-anchor', 'middle')
      .attr('fill', lineColor)
      .attr('font-size', 11)
      .attr('font-weight', 'bold')
      .attr('class', 'section-label')
      .text(labelText);
  }

  // Render steps (calls and returns in stack-inferred order)
  const SELF_CALL_WIDTH = 30;
  const SELF_CALL_HEIGHT = 25;
  renderSteps.forEach((step, i) => {
    const fromX = participantX.get(step.from);
    const toX = participantX.get(step.to);
    if (fromX === undefined || toX === undefined) return;

    const y = stepY(i);

    const HIT_H = 20; // transparent hit area height (10px above + below arrow)

    // Resolve tag color for this message
    const msg = messages[step.messageIndex];
    const msgTagValue = msg ? tagMap?.messages.get(msg.lineNumber) : undefined;
    const msgTagColor = getTagColor(msgTagValue);

    if (step.type === 'call') {
      const arrowColor = msgTagColor || palette.text;

      if (step.from === step.to) {
        // Self-call: loopback arrow from right edge of activation
        const x = arrowEdgeX(step.from, i, 'right');

        // Hit area for self-call
        svg
          .append('rect')
          .attr('x', x)
          .attr('y', y - 5)
          .attr('width', SELF_CALL_WIDTH)
          .attr('height', SELF_CALL_HEIGHT + 10)
          .attr('fill', 'transparent')
          .attr('class', 'message-hit-area')
          .attr(
            'data-line-number',
            String(messages[step.messageIndex].lineNumber)
          )
          .attr('data-msg-index', String(step.messageIndex))
          .attr('data-step-index', String(i));

        const selfCallEl = svg
          .append('path')
          .attr(
            'd',
            `M ${x} ${y} H ${x + SELF_CALL_WIDTH} V ${y + SELF_CALL_HEIGHT} H ${x}`
          )
          .attr('fill', 'none')
          .attr('stroke', arrowColor)
          .attr('stroke-width', 1.2)
          .attr('marker-end', coloredMarker('call', msgTagColor))
          .attr('class', 'message-arrow self-call')
          .attr(
            'data-line-number',
            String(messages[step.messageIndex].lineNumber)
          )
          .attr('data-msg-index', String(step.messageIndex))
          .attr('data-step-index', String(i))
          .attr('data-from', step.from)
          .attr('data-to', step.to);
        if (tagKey && msgTagValue) {
          selfCallEl.attr(`data-tag-${tagKey}`, msgTagValue.toLowerCase());
        }

        if (step.label) {
          const labelEl = svg
            .append('text')
            .attr('x', x + SELF_CALL_WIDTH + 5)
            .attr('y', y + SELF_CALL_HEIGHT / 2 + 4)
            .attr('text-anchor', 'start')
            .attr('fill', arrowColor)
            .attr('font-size', 12)
            .attr('class', 'message-label')
            .attr(
              'data-line-number',
              String(messages[step.messageIndex].lineNumber)
            )
            .attr('data-msg-index', String(step.messageIndex))
            .attr('data-step-index', String(i));
          if (tagKey && msgTagValue) {
            labelEl.attr(`data-tag-${tagKey}`, msgTagValue.toLowerCase());
          }
          // TD-1: in-arrow labels render as plain text (no markdown interpretation).
          // Fixes the `location[]`-style silent character drop.
          labelEl.text(step.label);
        }
      } else {
        // Normal call arrow — snap to activation box edges
        const goingRight = fromX < toX;
        const x1 = arrowEdgeX(step.from, i, goingRight ? 'right' : 'left');
        const x2 = arrowEdgeX(step.to, i, goingRight ? 'left' : 'right');

        // Hit area for call arrow
        svg
          .append('rect')
          .attr('x', Math.min(x1, x2))
          .attr('y', y - HIT_H / 2)
          .attr('width', Math.abs(x2 - x1))
          .attr('height', HIT_H)
          .attr('fill', 'transparent')
          .attr('class', 'message-hit-area')
          .attr(
            'data-line-number',
            String(messages[step.messageIndex].lineNumber)
          )
          .attr('data-msg-index', String(step.messageIndex))
          .attr('data-step-index', String(i));

        const markerRef = step.async
          ? coloredMarker('async', msgTagColor)
          : coloredMarker('call', msgTagColor);
        const arrowEl = svg
          .append('line')
          .attr('x1', x1)
          .attr('y1', y)
          .attr('x2', x2)
          .attr('y2', y)
          .attr('stroke', arrowColor)
          .attr('stroke-width', 1.2)
          .attr('marker-end', markerRef)
          .attr('class', 'message-arrow')
          .attr(
            'data-line-number',
            String(messages[step.messageIndex].lineNumber)
          )
          .attr('data-msg-index', String(step.messageIndex))
          .attr('data-step-index', String(i))
          .attr('data-from', step.from)
          .attr('data-to', step.to);
        if (tagKey && msgTagValue) {
          arrowEl.attr(`data-tag-${tagKey}`, msgTagValue.toLowerCase());
        }

        if (step.label) {
          const midX = (x1 + x2) / 2;
          const labelEl = svg
            .append('text')
            .attr('x', midX)
            .attr('y', y - 8)
            .attr('text-anchor', 'middle')
            .attr('fill', arrowColor)
            .attr('font-size', 12)
            .attr('class', 'message-label')
            .attr(
              'data-line-number',
              String(messages[step.messageIndex].lineNumber)
            )
            .attr('data-msg-index', String(step.messageIndex))
            .attr('data-step-index', String(i));
          if (tagKey && msgTagValue) {
            labelEl.attr(`data-tag-${tagKey}`, msgTagValue.toLowerCase());
          }
          // TD-1: in-arrow labels render as plain text (no markdown interpretation).
          // Fixes the `location[]`-style silent character drop.
          labelEl.text(step.label);
        }
      }
    } else {
      if (step.from === step.to) {
        // Self-call return — already handled by the loopback path, skip
        return;
      }
      // Return arrow — snap to activation box edges
      const goingRight = fromX < toX;
      const x1 = arrowEdgeX(step.from, i, goingRight ? 'right' : 'left');
      const x2 = arrowEdgeX(step.to, i, goingRight ? 'left' : 'right');
      const returnColor = msgTagColor || palette.textMuted;

      // Hit area for return arrow
      svg
        .append('rect')
        .attr('x', Math.min(x1, x2))
        .attr('y', y - HIT_H / 2)
        .attr('width', Math.abs(x2 - x1))
        .attr('height', HIT_H)
        .attr('fill', 'transparent')
        .attr('class', 'message-hit-area')
        .attr(
          'data-line-number',
          String(messages[step.messageIndex].lineNumber)
        )
        .attr('data-msg-index', String(step.messageIndex))
        .attr('data-step-index', String(i));

      const returnEl = svg
        .append('line')
        .attr('x1', x1)
        .attr('y1', y)
        .attr('x2', x2)
        .attr('y2', y)
        .attr('stroke', returnColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '6 4')
        .attr('marker-end', coloredMarker('return', msgTagColor))
        .attr('class', 'return-arrow')
        .attr(
          'data-line-number',
          String(messages[step.messageIndex].lineNumber)
        )
        .attr('data-msg-index', String(step.messageIndex))
        .attr('data-step-index', String(i))
        .attr('data-from', step.from)
        .attr('data-to', step.to);
      if (tagKey && msgTagValue) {
        returnEl.attr(`data-tag-${tagKey}`, msgTagValue.toLowerCase());
      }

      if (step.label) {
        const midX = (x1 + x2) / 2;
        const labelEl = svg
          .append('text')
          .attr('x', midX)
          .attr('y', y - 6)
          .attr('text-anchor', 'middle')
          .attr('fill', returnColor)
          .attr('font-size', 11)
          .attr('class', 'message-label')
          .attr(
            'data-line-number',
            String(messages[step.messageIndex].lineNumber)
          )
          .attr('data-msg-index', String(step.messageIndex))
          .attr('data-step-index', String(i));
        if (tagKey && msgTagValue) {
          labelEl.attr(`data-tag-${tagKey}`, msgTagValue.toLowerCase());
        }
        // TD-1: in-arrow labels render as plain text (no markdown
        // interpretation). Return-arrow labels are currently always empty
        // (buildRenderSequence sets them to '') but this path is kept in
        // sync with the call/self-call sites above to prevent a future
        // change resurrecting the location[] silent-drop bug.
        labelEl.text(step.label);
      }
    }
  });

  // Render notes — folded-corner boxes attached to participant lifelines
  const noteFill = isDark
    ? mix(palette.surface, palette.bg, 50)
    : mix(palette.bg, palette.surface, 15);

  const collapsedNoteFill = mix(palette.textMuted, palette.bg, 15);

  const renderNoteElements = (els: SequenceElement[]): void => {
    for (const el of els) {
      if (isSequenceNote(el)) {
        const px = participantX.get(el.participantId);
        if (px === undefined) continue;
        const noteTopY = noteYMap.get(el);
        if (noteTopY === undefined) continue;

        const expanded = isNoteExpanded(el);
        const isRight = el.position === 'right';

        if (expanded) {
          // --- Expanded note: full folded-corner box with wrapped text ---
          const wrappedLines = wrapTextLines(el.text, NOTE_CHARS_PER_LINE);
          const noteH = wrappedLines.length * NOTE_LINE_H + NOTE_PAD_V * 2;
          const maxLineLen = Math.max(...wrappedLines.map((l) => l.length));
          const noteW = Math.min(
            NOTE_MAX_W,
            Math.max(80, maxLineLen * NOTE_CHAR_W + NOTE_PAD_H * 2 + NOTE_FOLD)
          );
          const noteX = isRight
            ? px + ACTIVATION_WIDTH + NOTE_GAP
            : px - ACTIVATION_WIDTH - NOTE_GAP - noteW;

          const noteG = svg
            .append('g')
            .attr('class', 'note')
            .attr('data-note-toggle', '')
            .attr('data-line-number', String(el.lineNumber))
            .attr('data-line-end', String(el.endLineNumber));

          // Folded-corner path
          noteG
            .append('path')
            .attr(
              'd',
              [
                `M ${noteX} ${noteTopY}`,
                `L ${noteX + noteW - NOTE_FOLD} ${noteTopY}`,
                `L ${noteX + noteW} ${noteTopY + NOTE_FOLD}`,
                `L ${noteX + noteW} ${noteTopY + noteH}`,
                `L ${noteX} ${noteTopY + noteH}`,
                'Z',
              ].join(' ')
            )
            .attr('fill', noteFill)
            .attr('stroke', palette.textMuted)
            .attr('stroke-width', 0.75)
            .attr('class', 'note-box');

          // Fold triangle
          noteG
            .append('path')
            .attr(
              'd',
              [
                `M ${noteX + noteW - NOTE_FOLD} ${noteTopY}`,
                `L ${noteX + noteW - NOTE_FOLD} ${noteTopY + NOTE_FOLD}`,
                `L ${noteX + noteW} ${noteTopY + NOTE_FOLD}`,
              ].join(' ')
            )
            .attr('fill', 'none')
            .attr('stroke', palette.textMuted)
            .attr('stroke-width', 0.75)
            .attr('class', 'note-fold');

          // Render text with inline markdown
          wrappedLines.forEach((line, li) => {
            const textY = noteTopY + NOTE_PAD_V + (li + 1) * NOTE_LINE_H - 3;
            const isBullet = line.startsWith('- ');
            const bulletIndent = isBullet ? 10 : 0;
            const displayLine = isBullet ? line.slice(2) : line;
            const textEl = noteG
              .append('text')
              .attr('x', noteX + NOTE_PAD_H + bulletIndent)
              .attr('y', textY)
              .attr('fill', palette.text)
              .attr('font-size', NOTE_FONT_SIZE)
              .attr('class', 'note-text');

            if (isBullet) {
              noteG
                .append('text')
                .attr('x', noteX + NOTE_PAD_H)
                .attr('y', textY)
                .attr('fill', palette.text)
                .attr('font-size', NOTE_FONT_SIZE)
                .text('\u2022');
            }

            renderInlineText(textEl, displayLine, palette, NOTE_FONT_SIZE);
          });
        } else {
          // --- Collapsed note: compact indicator ---
          const cFold = 6;
          const noteX = isRight
            ? px + ACTIVATION_WIDTH + NOTE_GAP
            : px - ACTIVATION_WIDTH - NOTE_GAP - COLLAPSED_NOTE_W;

          const noteG = svg
            .append('g')
            .attr('class', 'note note-collapsed')
            .attr('data-note-toggle', '')
            .attr('data-line-number', String(el.lineNumber))
            .attr('data-line-end', String(el.endLineNumber))
            .style('cursor', 'pointer');

          // Small folded-corner rectangle
          noteG
            .append('path')
            .attr(
              'd',
              [
                `M ${noteX} ${noteTopY}`,
                `L ${noteX + COLLAPSED_NOTE_W - cFold} ${noteTopY}`,
                `L ${noteX + COLLAPSED_NOTE_W} ${noteTopY + cFold}`,
                `L ${noteX + COLLAPSED_NOTE_W} ${noteTopY + COLLAPSED_NOTE_H}`,
                `L ${noteX} ${noteTopY + COLLAPSED_NOTE_H}`,
                'Z',
              ].join(' ')
            )
            .attr('fill', collapsedNoteFill)
            .attr('stroke', palette.border)
            .attr('stroke-width', 0.75)
            .attr('class', 'note-box');

          // Fold triangle
          noteG
            .append('path')
            .attr(
              'd',
              [
                `M ${noteX + COLLAPSED_NOTE_W - cFold} ${noteTopY}`,
                `L ${noteX + COLLAPSED_NOTE_W - cFold} ${noteTopY + cFold}`,
                `L ${noteX + COLLAPSED_NOTE_W} ${noteTopY + cFold}`,
              ].join(' ')
            )
            .attr('fill', 'none')
            .attr('stroke', palette.border)
            .attr('stroke-width', 0.75)
            .attr('class', 'note-fold');

          // "..." text
          noteG
            .append('text')
            .attr('x', noteX + COLLAPSED_NOTE_W / 2)
            .attr('y', noteTopY + COLLAPSED_NOTE_H / 2 + 3)
            .attr('text-anchor', 'middle')
            .attr('fill', palette.textMuted)
            .attr('font-size', 9)
            .attr('class', 'note-text')
            .text('\u2026');
        }
      } else if (isSequenceBlock(el)) {
        renderNoteElements(el.children);
        if (el.elseIfBranches) {
          for (const branch of el.elseIfBranches) {
            renderNoteElements(branch.children);
          }
        }
        renderNoteElements(el.elseChildren);
      }
    }
  };

  if (elements && elements.length > 0) {
    renderNoteElements(elements);
  }
}

/**
 * Build a mapping from each note's lineNumber to the lineNumber of its
 * associated message (the last message before the note in document order).
 * Used by the app to expand notes when cursor is on the associated message.
 */
export function buildNoteMessageMap(
  elements: SequenceElement[]
): Map<number, number> {
  const map = new Map<number, number>();
  let lastMessageLine = -1;

  const walk = (els: SequenceElement[]): void => {
    for (const el of els) {
      if (isSequenceNote(el)) {
        if (lastMessageLine >= 0) {
          map.set(el.lineNumber, lastMessageLine);
        }
      } else if (isSequenceBlock(el)) {
        walk(el.children);
        if (el.elseIfBranches) {
          for (const branch of el.elseIfBranches) {
            walk(branch.children);
          }
        }
        walk(el.elseChildren);
      } else if (!isSequenceSection(el)) {
        // It's a message
        const msg = el as SequenceMessage;
        lastMessageLine = msg.lineNumber;
      }
    }
  };
  walk(elements);
  return map;
}

function renderParticipant(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  participant: SequenceParticipant,
  cx: number,
  cy: number,
  palette: PaletteColors,
  isDark: boolean,
  color?: string,
  tagAttr?: { key: string; value: string }
): void {
  const g = svg
    .append('g')
    .attr('transform', `translate(${cx}, ${cy})`)
    .attr('class', 'participant')
    .attr('data-participant-id', participant.id);

  // Set data-tag attribute for legend hover dimming
  if (tagAttr) {
    g.attr(`data-tag-${tagAttr.key}`, tagAttr.value);
  }

  // Render shape based on type
  switch (participant.type) {
    case 'actor':
      renderActorParticipant(g, palette, color);
      break;
    case 'database':
      renderDatabaseParticipant(g, palette, isDark, color);
      break;
    case 'service':
      renderServiceParticipant(g, palette, isDark, color);
      break;
    case 'queue':
      renderQueueParticipant(g, palette, isDark, color);
      break;
    case 'cache':
      renderCacheParticipant(g, palette, isDark, color);
      break;
    case 'networking':
      renderNetworkingParticipant(g, palette, isDark, color);
      break;
    case 'frontend':
      renderFrontendParticipant(g, palette, isDark, color);
      break;
    case 'external':
      renderExternalParticipant(g, palette, isDark, color);
      break;
    case 'gateway':
      renderGatewayParticipant(g, palette, isDark, color);
      break;
    default:
      renderRectParticipant(g, palette, isDark, color);
      break;
  }

  // Render label — below the shape for actors, centered inside for others
  const isActor = participant.type === 'actor';
  const labelLines = splitParticipantLabel(participant.label);
  const fontSize = 13;
  const lineHeight = fontSize + 2;
  const textEl = g
    .append('text')
    .attr('x', 0)
    .attr('text-anchor', 'middle')
    .attr('fill', palette.text)
    .attr('font-size', fontSize)
    .attr('font-weight', 500);

  if (labelLines.length === 1) {
    textEl
      .attr(
        'y',
        isActor ? PARTICIPANT_BOX_HEIGHT + 14 : PARTICIPANT_BOX_HEIGHT / 2 + 5
      )
      .text(participant.label);
  } else {
    // Multi-line: vertically center the lines within the box (or below for actors)
    const totalHeight = labelLines.length * lineHeight;
    const baseY = isActor
      ? PARTICIPANT_BOX_HEIGHT + 14 - ((labelLines.length - 1) * lineHeight) / 2
      : PARTICIPANT_BOX_HEIGHT / 2 + 5 - (totalHeight - lineHeight) / 2;

    labelLines.forEach((line, i) => {
      textEl
        .append('tspan')
        .attr('x', 0)
        .attr('dy', i === 0 ? `${baseY}px` : `${lineHeight}px`)
        .text(line);
    });
  }
}
