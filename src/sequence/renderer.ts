// ============================================================
// Sequence Diagram SVG Renderer
// ============================================================

import * as d3Selection from 'd3-selection';
import type { PaletteColors } from '../palettes';
import { resolveColor } from '../colors';
import type {
  ParsedSequenceDgmo,
  SequenceElement,
  SequenceGroup,
  SequenceMessage,
  SequenceParticipant,
} from './parser';
import { isSequenceBlock, isSequenceSection } from './parser';

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

// Mix two hex colors in sRGB: pct% of a, rest of b
function mix(a: string, b: string, pct: number): string {
  const parse = (h: string) => {
    const r = h.replace('#', '');
    const f = r.length === 3 ? r[0]+r[0]+r[1]+r[1]+r[2]+r[2] : r;
    return [parseInt(f.substring(0,2),16), parseInt(f.substring(2,4),16), parseInt(f.substring(4,6),16)];
  };
  const [ar,ag,ab] = parse(a), [br,bg,bb] = parse(b), t = pct/100;
  const c = (x: number, y: number) => Math.round(x*t + y*(1-t)).toString(16).padStart(2,'0');
  return `#${c(ar,br)}${c(ag,bg)}${c(ab,bb)}`;
}

// Shared fill/stroke helpers
const fill = (palette: PaletteColors, isDark: boolean): string =>
  mix(palette.primary, isDark ? palette.surface : palette.bg, isDark ? 15 : 30);
const stroke = (palette: PaletteColors): string => palette.textMuted;
const SW = 1.5;
const W = PARTICIPANT_BOX_WIDTH;
const H = PARTICIPANT_BOX_HEIGHT;

// ============================================================
// Participant Shape Renderers
// ============================================================

function renderRectParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean
): void {
  g.append('rect')
    .attr('x', -W / 2)
    .attr('y', 0)
    .attr('width', W)
    .attr('height', H)
    .attr('rx', 2)
    .attr('ry', 2)
    .attr('fill', fill(palette, isDark))
    .attr('stroke', stroke(palette))
    .attr('stroke-width', SW);
}

function renderServiceParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean
): void {
  g.append('rect')
    .attr('x', -W / 2)
    .attr('y', 0)
    .attr('width', W)
    .attr('height', H)
    .attr('rx', SERVICE_BORDER_RADIUS)
    .attr('ry', SERVICE_BORDER_RADIUS)
    .attr('fill', fill(palette, isDark))
    .attr('stroke', stroke(palette))
    .attr('stroke-width', SW);
}

function renderActorParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors
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
  const s = stroke(palette);
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
  isDark: boolean
): void {
  // Cylinder fitting within W x H
  const ry = 7;
  const topY = ry;
  const bodyH = H - ry * 2;
  const f = fill(palette, isDark);
  const s = stroke(palette);

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
  isDark: boolean
): void {
  // Horizontal cylinder (pipe) — like database rotated 90 degrees
  const rx = 10;
  const leftX = -W / 2 + rx;
  const bodyW = W - rx * 2;
  const f = fill(palette, isDark);
  const s = stroke(palette);

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
  isDark: boolean
): void {
  // Dashed cylinder — variation of database to convey ephemeral storage
  const ry = 7;
  const topY = ry;
  const bodyH = H - ry * 2;
  const f = fill(palette, isDark);
  const s = stroke(palette);
  const dash = '4 3';

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
  isDark: boolean
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
    .attr('fill', fill(palette, isDark))
    .attr('stroke', stroke(palette))
    .attr('stroke-width', SW);
}

function renderFrontendParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean
): void {
  // Monitor shape fitting within W x H
  const screenH = H - 10;
  const s = stroke(palette);
  g.append('rect')
    .attr('x', -W / 2)
    .attr('y', 0)
    .attr('width', W)
    .attr('height', screenH)
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('fill', fill(palette, isDark))
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
  isDark: boolean
): void {
  // Dashed border rectangle
  g.append('rect')
    .attr('x', -W / 2)
    .attr('y', 0)
    .attr('width', W)
    .attr('height', H)
    .attr('rx', 2)
    .attr('ry', 2)
    .attr('fill', fill(palette, isDark))
    .attr('stroke', stroke(palette))
    .attr('stroke-width', SW)
    .attr('stroke-dasharray', '6 3');
}

function renderGatewayParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean
): void {
  renderRectParticipant(g, palette, isDark);
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
      } else if (isSequenceSection(el)) {
        // Sections inside blocks are not top-level — skip
        continue;
      } else {
        const idx = messages.indexOf(el);
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
      } else {
        const idx = messages.indexOf(el);
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
    returnLabel?: string;
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
        label: top.returnLabel || '',
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
        label: msg.returnLabel || '',
        messageIndex: mi,
      });
    } else {
      // Push onto stack for pending return
      stack.push({
        from: msg.from,
        to: msg.to,
        returnLabel: msg.returnLabel,
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
      label: top.returnLabel || '',
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
 * Groups appear in declaration order, followed by ungrouped participants.
 */
export function applyGroupOrdering(
  participants: SequenceParticipant[],
  groups: SequenceGroup[]
): SequenceParticipant[] {
  if (groups.length === 0) return participants;

  const groupedIds = new Set(groups.flatMap((g) => g.participantIds));
  const result: SequenceParticipant[] = [];
  const placed = new Set<string>();

  // Place grouped participants in group declaration order
  for (const group of groups) {
    for (const id of group.participantIds) {
      const p = participants.find((pp) => pp.id === id);
      if (p && !placed.has(id)) {
        result.push(p);
        placed.add(id);
      }
    }
  }

  // Append ungrouped participants in their original order
  for (const p of participants) {
    if (!groupedIds.has(p.id) && !placed.has(p.id)) {
      result.push(p);
      placed.add(p.id);
    }
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

  const { title, messages, elements, groups, options: parsedOptions } = parsed;
  const collapsedSections = options?.collapsedSections;
  const participants = applyPositionOverrides(
    applyGroupOrdering(parsed.participants, groups)
  );
  if (participants.length === 0) return;

  const activationsOff = parsedOptions.activations?.toLowerCase() === 'off';

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
  renderSteps = renderSteps.filter(
    (s) => s.type === 'call' || s.label
  );
  const activations = activationsOff ? [] : computeActivations(renderSteps);
  const stepSpacing = 35;

  // --- Block-aware Y spacing ---
  // Extra spacing constants for block boundaries
  const BLOCK_HEADER_SPACE = 30; // Extra space for frame label above first message in a block
  const BLOCK_AFTER_SPACE = 15; // Extra space after a block ends (before next sibling)

  // Build maps from messageIndex to render step indices (needed early for spacing)
  const msgToFirstStep = new Map<number, number>();
  const msgToLastStep = new Map<number, number>();
  renderSteps.forEach((step, si) => {
    if (!msgToFirstStep.has(step.messageIndex)) {
      msgToFirstStep.set(step.messageIndex, si);
    }
    msgToLastStep.set(step.messageIndex, si);
  });

  // Find the first visible message index in an element subtree
  const findFirstMsgIndex = (els: SequenceElement[]): number => {
    for (const el of els) {
      if (isSequenceBlock(el)) {
        const idx = findFirstMsgIndex(el.children);
        if (idx >= 0) return idx;
      } else if (!isSequenceSection(el)) {
        const idx = messages.indexOf(el);
        if (idx >= 0 && !hiddenMsgIndices.has(idx)) return idx;
      }
    }
    return -1;
  };

  // Section layout constants
  const SECTION_TOP_PAD = 35;   // space above section divider line (matches stepSpacing)
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
    const collectMsgIndicesFromBlock = (
      block: import('./parser').SequenceBlock
    ): number[] => {
      const indices: number[] = [];
      for (const child of block.children) {
        if (isSequenceBlock(child)) {
          indices.push(...collectMsgIndicesFromBlock(child));
        } else if (!isSequenceSection(child)) {
          const idx = messages.indexOf(child);
          if (idx >= 0) indices.push(idx);
        }
      }
      for (const child of block.elseChildren) {
        if (isSequenceBlock(child)) {
          indices.push(...collectMsgIndicesFromBlock(child));
        } else if (!isSequenceSection(child)) {
          const idx = messages.indexOf(child);
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
        const idx = messages.indexOf(el);
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
      if (!hiddenMsgIndices.has(allRenderSteps[oi].messageIndex)) {
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
  const groupOffset =
    groups.length > 0 ? GROUP_PADDING_TOP + GROUP_LABEL_SIZE : 0;
  const participantStartY =
    TOP_MARGIN + titleOffset + PARTICIPANT_Y_OFFSET + groupOffset;
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
    layoutEndY = curY;
  }

  const contentBottomY =
    renderSteps.length > 0
      ? Math.max(
          stepYPositions[stepYPositions.length - 1] + stepSpacing,
          layoutEndY
        )
      : layoutEndY;
  const messageAreaHeight = contentBottomY - lifelineStartY0;
  const lifelineLength = messageAreaHeight + LIFELINE_TAIL;
  const totalWidth = Math.max(
    participants.length * PARTICIPANT_GAP,
    PARTICIPANT_BOX_WIDTH + 40
  );
  const totalHeight =
    participantStartY +
    PARTICIPANT_BOX_HEIGHT +
    Math.max(lifelineLength, 40) +
    40;

  const { width: containerWidth } = container.getBoundingClientRect();
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
    .style(
      'font-family',
      'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif'
    );

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

  // Render title
  if (title) {
    svg
      .append('text')
      .attr('x', svgWidth / 2)
      .attr('y', TOP_MARGIN + TITLE_HEIGHT * 0.7)
      .attr('text-anchor', 'middle')
      .attr('fill', palette.text)
      .attr('font-size', 16)
      .attr('font-weight', 'bold')
      .text(title);
  }

  // Render group boxes (behind participant shapes)
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

    // Group box background
    const resolvedGroupColor = group.color
      ? resolveColor(group.color, palette)
      : undefined;
    const fillColor = resolvedGroupColor
      ? mix(resolvedGroupColor, isDark ? palette.surface : palette.bg, 10)
      : isDark
        ? palette.surface
        : palette.bg;
    const strokeColor = resolvedGroupColor || palette.textMuted;

    svg
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
      .attr('class', 'group-box')
      .attr('data-group-line', String(group.lineNumber));

    // Group label
    svg
      .append('text')
      .attr('x', minX + 8)
      .attr('y', boxY + GROUP_LABEL_SIZE + 4)
      .attr('fill', strokeColor)
      .attr('font-size', GROUP_LABEL_SIZE)
      .attr('font-weight', 'bold')
      .attr('opacity', 0.7)
      .attr('class', 'group-label')
      .attr('data-group-line', String(group.lineNumber))
      .text(group.name);
  }

  // Render each participant
  const lifelineStartY = lifelineStartY0;
  participants.forEach((participant, index) => {
    const cx = offsetX + index * PARTICIPANT_GAP;
    const cy = participantStartY;

    renderParticipant(svg, participant, cx, cy, palette, isDark);

    // Render lifeline
    svg
      .append('line')
      .attr('x1', cx)
      .attr('y1', lifelineStartY)
      .attr('x2', cx)
      .attr('y2', lifelineStartY + lifelineLength)
      .attr('stroke', palette.textMuted)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '6 4')
      .attr('class', 'lifeline');
  });

  // Helper: compute Y for a step index
  const stepY = (i: number) => stepYPositions[i];

  // Render block frames (behind everything else)
  const FRAME_PADDING_X = 30;
  const FRAME_PADDING_TOP = 42;
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
      } else if (!isSequenceSection(el)) {
        const idx = messages.indexOf(el);
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
  }> = [];

  // Recursive block renderer — draws borders/dividers now, defers label text
  const renderBlockFrames = (els: SequenceElement[], depth: number): void => {
    for (const el of els) {
      if (!isSequenceBlock(el)) continue;

      const ifIndices = collectMsgIndices(el.children);
      const elseIndices = collectMsgIndices(el.elseChildren);
      const allIndices = [...ifIndices, ...elseIndices];
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
          });
          deferredLabels.push({
            x: frameX + 6,
            y: dividerY + 14,
            text: 'else',
            bold: false,
            italic: true,
          });
        }
      }

      // Recurse into nested blocks
      renderBlockFrames(el.children, depth + 1);
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

    // Opaque background to mask the lifeline
    svg
      .append('rect')
      .attr('x', x)
      .attr('y', y1)
      .attr('width', ACTIVATION_WIDTH)
      .attr('height', y2 - y1)
      .attr('fill', isDark ? palette.surface : palette.bg);

    const actFill = mix(palette.primary, isDark ? palette.surface : palette.bg, isDark ? 15 : 30);
    svg
      .append('rect')
      .attr('x', x)
      .attr('y', y1)
      .attr('width', ACTIVATION_WIDTH)
      .attr('height', y2 - y1)
      .attr('fill', actFill)
      .attr('stroke', palette.primary)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5)
      .attr('data-participant-id', act.participantId)
      .attr('data-msg-lines', coveredLines.join(','))
      .attr('class', 'activation');
  });

  // Render deferred else dividers (on top of activations)
  for (const ln of deferredLines) {
    svg
      .append('line')
      .attr('x1', ln.x1)
      .attr('y1', ln.y1)
      .attr('x2', ln.x2)
      .attr('y2', ln.y2)
      .attr('stroke', palette.textMuted)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2 3');
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
    const lineColor = sec.color
      ? resolveColor(sec.color, palette)
      : palette.textMuted;

    // Wrap section elements in a <g> for toggle.
    // IMPORTANT: only the <g> carries data-line-number / data-section —
    // children must NOT have them, otherwise the click walk-up resolves
    // to a line-number navigation before reaching data-section-toggle.
    const HIT_AREA_HEIGHT = 36;
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
      ? (isDark ? 0.35 : 0.25)
      : (isDark ? 0.1 : 0.08);
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

    // Collapsed sections use white text for contrast against the darker band
    const labelColor = isCollapsed ? '#ffffff' : lineColor;

    // Chevron indicator
    const chevronSpace = 14;
    const labelX = (sectionLineX1 + sectionLineX2) / 2;
    const chevronX = labelX - (labelText.length * 3.5 + 8 + chevronSpace / 2);
    const chevronY = secY;
    if (isCollapsed) {
      // Right-pointing triangle ▶
      sectionG
        .append('path')
        .attr(
          'd',
          `M ${chevronX} ${chevronY - 4} L ${chevronX + 6} ${chevronY} L ${chevronX} ${chevronY + 4} Z`
        )
        .attr('fill', labelColor)
        .attr('class', 'section-chevron');
    } else {
      // Down-pointing triangle ▼
      sectionG
        .append('path')
        .attr(
          'd',
          `M ${chevronX - 1} ${chevronY - 3} L ${chevronX + 7} ${chevronY - 3} L ${chevronX + 3} ${chevronY + 3} Z`
        )
        .attr('fill', labelColor)
        .attr('class', 'section-chevron');
    }

    // Centered label text
    sectionG
      .append('text')
      .attr('x', labelX + chevronSpace / 2)
      .attr('y', secY + 4)
      .attr('text-anchor', 'middle')
      .attr('fill', labelColor)
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

    if (step.type === 'call') {
      if (step.from === step.to) {
        // Self-call: loopback arrow from right edge of activation
        const x = arrowEdgeX(step.from, i, 'right');
        svg
          .append('path')
          .attr(
            'd',
            `M ${x} ${y} H ${x + SELF_CALL_WIDTH} V ${y + SELF_CALL_HEIGHT} H ${x}`
          )
          .attr('fill', 'none')
          .attr('stroke', palette.text)
          .attr('stroke-width', 1.2)
          .attr('marker-end', 'url(#seq-arrowhead)')
          .attr('class', 'message-arrow self-call')
          .attr(
            'data-line-number',
            String(messages[step.messageIndex].lineNumber)
          )
          .attr('data-msg-index', String(step.messageIndex));

        if (step.label) {
          svg
            .append('text')
            .attr('x', x + SELF_CALL_WIDTH + 5)
            .attr('y', y + SELF_CALL_HEIGHT / 2 + 4)
            .attr('text-anchor', 'start')
            .attr('fill', palette.text)
            .attr('font-size', 12)
            .attr('class', 'message-label')
            .attr(
              'data-line-number',
              String(messages[step.messageIndex].lineNumber)
            )
            .attr('data-msg-index', String(step.messageIndex))
            .text(step.label);
        }
      } else {
        // Normal call arrow — snap to activation box edges
        const goingRight = fromX < toX;
        const x1 = arrowEdgeX(step.from, i, goingRight ? 'right' : 'left');
        const x2 = arrowEdgeX(step.to, i, goingRight ? 'left' : 'right');

        const markerRef = step.async
          ? 'url(#seq-arrowhead-async)'
          : 'url(#seq-arrowhead)';
        svg
          .append('line')
          .attr('x1', x1)
          .attr('y1', y)
          .attr('x2', x2)
          .attr('y2', y)
          .attr('stroke', palette.text)
          .attr('stroke-width', 1.2)
          .attr('marker-end', markerRef)
          .attr('class', 'message-arrow')
          .attr(
            'data-line-number',
            String(messages[step.messageIndex].lineNumber)
          )
          .attr('data-msg-index', String(step.messageIndex));

        if (step.label) {
          const midX = (x1 + x2) / 2;
          svg
            .append('text')
            .attr('x', midX)
            .attr('y', y - 8)
            .attr('text-anchor', 'middle')
            .attr('fill', palette.text)
            .attr('font-size', 12)
            .attr('class', 'message-label')
            .attr(
              'data-line-number',
              String(messages[step.messageIndex].lineNumber)
            )
            .attr('data-msg-index', String(step.messageIndex))
            .text(step.label);
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

      svg
        .append('line')
        .attr('x1', x1)
        .attr('y1', y)
        .attr('x2', x2)
        .attr('y2', y)
        .attr('stroke', palette.textMuted)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '6 4')
        .attr('marker-end', 'url(#seq-arrowhead-open)')
        .attr('class', 'return-arrow')
        .attr(
          'data-line-number',
          String(messages[step.messageIndex].lineNumber)
        )
        .attr('data-msg-index', String(step.messageIndex));

      if (step.label) {
        const midX = (x1 + x2) / 2;
        svg
          .append('text')
          .attr('x', midX)
          .attr('y', y - 6)
          .attr('text-anchor', 'middle')
          .attr('fill', palette.textMuted)
          .attr('font-size', 11)
          .attr('class', 'message-label')
          .attr(
            'data-line-number',
            String(messages[step.messageIndex].lineNumber)
          )
          .attr('data-msg-index', String(step.messageIndex))
          .text(step.label);
      }
    }
  });
}

function renderParticipant(
  svg: d3Selection.Selection<SVGSVGElement, unknown, null, undefined>,
  participant: SequenceParticipant,
  cx: number,
  cy: number,
  palette: PaletteColors,
  isDark: boolean
): void {
  const g = svg
    .append('g')
    .attr('transform', `translate(${cx}, ${cy})`)
    .attr('class', 'participant')
    .attr('data-participant-id', participant.id);

  // Render shape based on type
  switch (participant.type) {
    case 'actor':
      renderActorParticipant(g, palette);
      break;
    case 'database':
      renderDatabaseParticipant(g, palette, isDark);
      break;
    case 'service':
      renderServiceParticipant(g, palette, isDark);
      break;
    case 'queue':
      renderQueueParticipant(g, palette, isDark);
      break;
    case 'cache':
      renderCacheParticipant(g, palette, isDark);
      break;
    case 'networking':
      renderNetworkingParticipant(g, palette, isDark);
      break;
    case 'frontend':
      renderFrontendParticipant(g, palette, isDark);
      break;
    case 'external':
      renderExternalParticipant(g, palette, isDark);
      break;
    case 'gateway':
      renderGatewayParticipant(g, palette, isDark);
      break;
    default:
      renderRectParticipant(g, palette, isDark);
      break;
  }

  // Render label — below the shape for actors, centered inside for others
  const isActor = participant.type === 'actor';
  g.append('text')
    .attr('x', 0)
    .attr(
      'y',
      isActor ? PARTICIPANT_BOX_HEIGHT + 14 : PARTICIPANT_BOX_HEIGHT / 2 + 5
    )
    .attr('text-anchor', 'middle')
    .attr('fill', palette.text)
    .attr('font-size', 13)
    .attr('font-weight', 500)
    .text(participant.label);
}
