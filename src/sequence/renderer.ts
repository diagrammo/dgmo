// ============================================================
// Sequence Diagram SVG Renderer
// ============================================================

import { tagAttrKey } from '../utils/tag-groups';
import { fillModeFromOptions } from '../utils/parsing';
import * as d3Selection from 'd3-selection';
import type { PaletteColors } from '../palettes';
import {
  contrastText,
  mix,
  shapeFill,
  themeBaseBg,
} from '../palettes/color-utils';
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
import {
  wrapDescriptionLines,
  type WrappedDescLine,
} from '../utils/wrapped-desc';
import { measureText, truncateText } from '../utils/text-measure';
import { resolveSequenceTags } from './tag-resolution';
import type { ResolvedTagMap } from './tag-resolution';
import { resolveActiveTagGroup } from '../utils/tag-groups';
import {
  getMaxLegendReservedHeight,
  getLegendExtent,
} from '../utils/legend-layout';
import { legendSuppressed, legendInlineRequested } from '../utils/parsing';
import { layoutInlineHeader } from '../utils/inline-header';
import { renderIntegratedLegend } from '../utils/legend-integration';
import { legendChromeColors } from '../utils/legend-constants';
import type { LegendCallbacks, LegendConfig } from '../utils/legend-types';
import {
  TITLE_FONT_SIZE,
  TITLE_FONT_WEIGHT,
  TITLE_Y,
} from '../utils/title-constants';
import { ScaleContext } from '../utils/scaling';

// ============================================================
// Layout Constants
// ============================================================

const PARTICIPANT_GAP = 160;
const PARTICIPANT_BOX_WIDTH = 120;
const PARTICIPANT_BOX_HEIGHT = 50;
const LABEL_FONT_SIZE = 13;
const TOP_MARGIN = 20;
const TITLE_HEIGHT = 30;
const PARTICIPANT_Y_OFFSET = 10;
const MESSAGE_START_OFFSET = 50;
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
const ACTIVATION_WIDTH = 10;
const SELF_CALL_HEIGHT = 25;
const SELF_CALL_WIDTH = 30;
// Actors render their label below the stick figure (at boxH + 14). Their
// lifeline starts this far below the box so the dashes clear the label text.
const ACTOR_LABEL_CLEARANCE = 22;
function wrapTextLines(
  text: string,
  maxWidth: number,
  fontSize: number
): WrappedDescLine[] {
  // Convert leading "- " to the canonical bullet prefix so the shared wrap
  // helper can split bullet lines into bullet-first / bullet-cont kinds and
  // give us hanging-indent alignment on continuation lines.
  const rawLines = text
    .split('\n')
    .map((l) => (l.startsWith('- ') ? '• ' + l.slice(2) : l));
  // Drive the shared bullet-aware wrapper by pixel width: passing the note's
  // available text width as the limit and a glyph-accurate measurer as the
  // length function turns its char-count comparison into a true pixel wrap.
  return wrapDescriptionLines(rawLines, maxWidth, (s) =>
    measureText(s, fontSize)
  );
}

/**
 * Available pixel width for a participant label inside a box of the given
 * width (the 10px accounts for the same left/right inset the layout uses).
 */
const labelTextWidth = (boxW: number): number => boxW - 10;

/**
 * Split a participant label into multiple lines if it exceeds the box width.
 * Splits on spaces first, then dashes, then camelCase boundaries.
 */
function splitParticipantLabel(
  label: string,
  maxWidth: number,
  fontSize: number
): string[] {
  if (measureText(label, fontSize) <= maxWidth) return [label];

  // Split on spaces
  if (label.includes(' ')) {
    return wrapLabelWords(label.split(' '), maxWidth, fontSize);
  }

  // Split on dashes/underscores/colons/slashes
  if (/[-_:/]/.test(label)) {
    const parts = label.split(/[-_:/]+/);
    return wrapLabelWords(parts, maxWidth, fontSize);
  }

  // Split on camelCase boundaries: "UserLookupCloudFx" → ["User", "Lookup", "Cloud", "Fx"]
  const camelParts = label
    .replace(/([a-z])([A-Z])/g, '$1\x00$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\x00$2')
    .split('\x00');
  if (camelParts.length > 1) {
    return wrapLabelWords(camelParts, maxWidth, fontSize);
  }

  return [label];
}

/** Greedily join word parts into lines that fit within maxWidth pixels. */
function wrapLabelWords(
  words: string[],
  maxWidth: number,
  fontSize: number
): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + word : word;
    if (measureText(test, fontSize) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Shared fill/stroke helpers — accept optional color override for per-participant coloring.
// When `color` is provided we use the canonical shapeFill() 25% tint.
// When omitted we fall back to a subtle-neutral surface highlight (out of scope for the
// shape-fill standardization spec — see TD-2 / F11). Participants without a color should
// recede; bumping them to 25% intent would defeat that intent.
const fill = (
  palette: PaletteColors,
  isDark: boolean,
  color?: string,
  fillMode?: 'solid' | 'outline'
): string =>
  color
    ? shapeFill(palette, color, isDark, { mode: fillMode })
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
  color?: string,
  fillMode?: 'solid' | 'outline',
  w: number = W,
  h: number = H
): void {
  g.append('rect')
    .attr('x', -w / 2)
    .attr('y', 0)
    .attr('width', w)
    .attr('height', h)
    .attr('rx', 2)
    .attr('ry', 2)
    .attr('fill', fill(palette, isDark, color, fillMode))
    .attr('stroke', stroke(palette, color))
    .attr('stroke-width', SW);
}

function renderActorParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  color?: string,
  h: number = H
): void {
  // Stick figure — no background. Every dimension is scaled by sc = h / H so
  // the figure keeps its proportions at any box height. The box height itself
  // is compressed by ScaleContext when the diagram is wider than its container;
  // scaling head/arms/legs by the same factor (instead of hardcoding 8/16/12)
  // prevents the head from ballooning over a collapsed body when compressed.
  const sc = h / H;
  const headR = 8 * sc;
  const cx = 0;
  const headY = 10 * sc;
  const bodyTopY = 19 * sc;
  const bodyBottomY = h * 0.65;
  const legY = h - 2 * sc;
  const armY = 24 * sc;
  const armSpan = 16 * sc;
  const legSpan = 12 * sc;
  const s = stroke(palette, color);
  const actorSW = Math.max(1.2, 2.5 * sc);

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
    .attr('y1', armY)
    .attr('x2', cx + armSpan)
    .attr('y2', armY)
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
  color?: string,
  fillMode?: 'solid' | 'outline',
  w: number = W,
  h: number = H
): void {
  // Cylinder fitting within w x h
  const ry = 7;
  const topY = ry;
  const bodyH = h - ry * 2;
  const f = fill(palette, isDark, color, fillMode);
  const s = stroke(palette, color);

  // Bottom ellipse (drawn first — rect will cover its top arc)
  g.append('ellipse')
    .attr('cx', 0)
    .attr('cy', topY + bodyH)
    .attr('rx', w / 2)
    .attr('ry', ry)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', SW);

  // Filled body (no stroke) to hide the top arc of the bottom ellipse
  g.append('rect')
    .attr('class', 'participant-body')
    .attr('x', -w / 2)
    .attr('y', topY)
    .attr('width', w)
    .attr('height', bodyH)
    .attr('fill', f)
    .attr('stroke', 'none');

  // Side lines
  g.append('line')
    .attr('x1', -w / 2)
    .attr('y1', topY)
    .attr('x2', -w / 2)
    .attr('y2', topY + bodyH)
    .attr('stroke', s)
    .attr('stroke-width', SW);
  g.append('line')
    .attr('x1', w / 2)
    .attr('y1', topY)
    .attr('x2', w / 2)
    .attr('y2', topY + bodyH)
    .attr('stroke', s)
    .attr('stroke-width', SW);

  // Top ellipse cap (drawn last, on top)
  g.append('ellipse')
    .attr('cx', 0)
    .attr('cy', topY)
    .attr('rx', w / 2)
    .attr('ry', ry)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', SW);
}

function renderQueueParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean,
  color?: string,
  fillMode?: 'solid' | 'outline',
  w: number = W,
  h: number = H
): void {
  // Horizontal cylinder (pipe) — like database rotated 90 degrees
  const rx = 10;
  const leftX = -w / 2 + rx;
  const bodyW = w - rx * 2;
  const f = fill(palette, isDark, color, fillMode);
  const s = stroke(palette, color);

  // Right ellipse (back face, drawn first — rect will cover its left arc)
  g.append('ellipse')
    .attr('cx', leftX + bodyW)
    .attr('cy', h / 2)
    .attr('rx', rx)
    .attr('ry', h / 2)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', SW);

  // Body rect (no stroke) to hide left arc of right ellipse
  g.append('rect')
    .attr('class', 'participant-body')
    .attr('x', leftX)
    .attr('y', 0)
    .attr('width', bodyW)
    .attr('height', h)
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
    .attr('y1', h)
    .attr('x2', leftX + bodyW)
    .attr('y2', h)
    .attr('stroke', s)
    .attr('stroke-width', SW);

  // Left ellipse (front face, drawn last)
  g.append('ellipse')
    .attr('cx', leftX)
    .attr('cy', h / 2)
    .attr('rx', rx)
    .attr('ry', h / 2)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', SW);
}

function renderCacheParticipant(
  g: d3Selection.Selection<SVGGElement, unknown, null, undefined>,
  palette: PaletteColors,
  isDark: boolean,
  color?: string,
  fillMode?: 'solid' | 'outline',
  w: number = W,
  h: number = H
): void {
  // Dashed cylinder — variation of database to convey ephemeral storage
  const ry = 7;
  const topY = ry;
  const bodyH = h - ry * 2;
  const f = fill(palette, isDark, color, fillMode);
  const s = stroke(palette, color);
  const dash = '4 3';

  // Bottom ellipse (back face)
  g.append('ellipse')
    .attr('cx', 0)
    .attr('cy', topY + bodyH)
    .attr('rx', w / 2)
    .attr('ry', ry)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', SW)
    .attr('stroke-dasharray', dash);

  g.append('rect')
    .attr('class', 'participant-body')
    .attr('x', -w / 2)
    .attr('y', topY)
    .attr('width', w)
    .attr('height', bodyH)
    .attr('fill', f)
    .attr('stroke', 'none');

  g.append('line')
    .attr('x1', -w / 2)
    .attr('y1', topY)
    .attr('x2', -w / 2)
    .attr('y2', topY + bodyH)
    .attr('stroke', s)
    .attr('stroke-width', SW)
    .attr('stroke-dasharray', dash);
  g.append('line')
    .attr('x1', w / 2)
    .attr('y1', topY)
    .attr('x2', w / 2)
    .attr('y2', topY + bodyH)
    .attr('stroke', s)
    .attr('stroke-width', SW)
    .attr('stroke-dasharray', dash);

  // Top ellipse cap
  g.append('ellipse')
    .attr('cx', 0)
    .attr('cy', topY)
    .attr('rx', w / 2)
    .attr('ry', ry)
    .attr('fill', f)
    .attr('stroke', s)
    .attr('stroke-width', SW)
    .attr('stroke-dasharray', dash);
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
  exportWidth?: number; // Explicit width for CLI/export rendering (bypasses getBoundingClientRect)
  activeTagGroup?: string | null; // Active tag group name for tag-driven recoloring; null = explicitly none
}

/**
 * Group messages by the top-level section that precedes them.
 * Messages before the first section are ungrouped (always visible).
 * Only top-level sections are collapsible — sections inside blocks are excluded.
 */
export function groupMessagesBySection(
  elements: readonly SequenceElement[],
  messages: readonly SequenceMessage[]
): SectionMessageGroup[] {
  const groups: SectionMessageGroup[] = [];
  let currentGroup: SectionMessageGroup | null = null;

  // Look up by lineNumber — collapse projection creates separate spread copies
  // for messages[] and the messages embedded in elements[], breaking reference
  // equality. lineNumber is preserved across spreads.
  const msgLineToIdx = new Map<number, number>();
  messages.forEach((m, i) => msgLineToIdx.set(m.lineNumber, i));

  // Recursively collect all message indices from an element subtree
  const collectIndices = (els: readonly SequenceElement[]): number[] => {
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
        const idx = msgLineToIdx.get(el.lineNumber) ?? -1;
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
        const idx = msgLineToIdx.get(el.lineNumber) ?? -1;
        if (idx >= 0) currentGroup.messageIndices.push(idx);
      }
    }
    // Messages before the first section are ungrouped — skip
  }

  return groups;
}

/** Height of a section band with nothing but its label. */
const SECTION_BAND_HEIGHT = 22;
/**
 * Height of a collapsed band, which carries a second row of participant
 * marks beneath its label. The label and the marks cannot share a row: the
 * label is left-aligned once it has marks to make room for (a centred one
 * lands on the middle column, which is usually the busiest participant in
 * the fold), and a mark landing under that label is then unreadable either
 * way — hidden behind the text, or punched through it and reading as damage.
 */
const COLLAPSED_SECTION_BAND_HEIGHT = 36;
/** Split evenly above and below the section anchor, so the band stays centred. */
const COLLAPSED_SECTION_BAND_EXTRA =
  COLLAPSED_SECTION_BAND_HEIGHT - SECTION_BAND_HEIGHT;
/** Distance from the section anchor down to the row of participant marks. */
const COLLAPSED_SECTION_MARK_OFFSET = 9;
/** Distance from the section anchor up to the label baseline when collapsed. */
const COLLAPSED_SECTION_LABEL_BASELINE = -4;
/**
 * Breathing room around a section label, where the lifelines are cut away.
 * At 11px bold the glyphs run about 8px above the baseline and 3px below, so
 * these leave a few pixels of clear band on every side — enough that a dash
 * ending near the label reads as absent rather than as a clipped stroke.
 */
const SECTION_LABEL_CLEARANCE_X = 8;
const SECTION_LABEL_CLEARANCE_ABOVE = 12;
const SECTION_LABEL_CLEARANCE_BELOW = 5;

/** What one participant did inside a run of messages. */
export interface SectionParticipation {
  /** Messages it sent. */
  sends: number;
  /** Messages addressed to it. */
  receives: number;
}

/**
 * Who takes part in a hidden run of messages, and how.
 *
 * A collapsed band draws one mark per participant, and the mark's shape comes
 * from this: anything that sends is filled, a participant that only ever
 * receives is drawn as a ring, and one that appears in neither column gets the
 * absent tick. A self-message counts on both sides — the participant plainly
 * spoke — so it never produces a ring.
 *
 * Keyed by participant id in whatever space `messages` is expressed in, which
 * after a group-collapse projection is the group's virtual id rather than the
 * member's. That is what the band wants: the mark goes on the lifeline the
 * reader can actually see.
 */
export function summarizeSectionParticipation(
  messages: readonly SequenceMessage[],
  msgIndices: readonly number[]
): Map<string, SectionParticipation> {
  const summary = new Map<string, SectionParticipation>();
  const bump = (id: string, key: 'sends' | 'receives'): void => {
    const entry = summary.get(id) ?? { sends: 0, receives: 0 };
    entry[key] += 1;
    summary.set(id, entry);
  };
  for (const idx of msgIndices) {
    const msg = messages[idx];
    if (!msg) continue;
    bump(msg.from, 'sends');
    bump(msg.to, 'receives');
  }
  return summary;
}

/**
 * Radius of a participant's mark, stepped by how many hidden messages touch
 * it. Three tiers rather than a continuous scale — beyond three, the sizes
 * stop being tellable apart and read as noise instead of as weight.
 */
function sectionMarkRadius(touches: number): number {
  if (touches >= 4) return 6;
  if (touches >= 2) return 4.5;
  return 3.5;
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
export function buildRenderSequence(
  messages: readonly SequenceMessage[]
): RenderStep[] {
  const steps: RenderStep[] = [];
  const stack: {
    from: string;
    to: string;
    messageIndex: number;
  }[] = [];

  for (let mi = 0; mi < messages.length; mi++) {
    // In-bounds by loop guard.
    const msg = messages[mi]!;
    // Pop returns for callees that are no longer the sender
    while (stack.length > 0) {
      // In-bounds: stack.length > 0 guard above.
      const top = stack[stack.length - 1]!;
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

    // Response heuristic: if B sends back to A and the top of the
    // stack is A→B, treat this as a response (pop) rather than a new
    // call.  Covers the common request-response ping-pong pattern.
    if (stack.length > 0 && !msg.async && msg.from !== msg.to) {
      const top = stack[stack.length - 1]!;
      if (top.from === msg.to && top.to === msg.from) {
        stack.pop();
        steps.push({
          type: 'return',
          from: msg.from,
          to: msg.to,
          label: msg.label,
          messageIndex: mi,
        });
        continue;
      }
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
    // In-bounds by loop guard.
    const step = steps[i]!;
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
  participants: readonly SequenceParticipant[]
): SequenceParticipant[] {
  // Copy to a mutable array on the no-op path so callers always get a
  // fresh `SequenceParticipant[]` regardless of input mutability.
  if (!participants.some((p) => p.position !== undefined))
    return [...participants];

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
      // In-bounds: positioned.length + unpositioned.length === total, so the
      // remaining `null` slots equal unpositioned.length.
      result[i] = unpositioned[uIdx++]!;
    }
  }

  return result as SequenceParticipant[];
}

// Group Ordering
// ============================================================

/**
 * Order participants by first appearance in messages, then pull grouped
 * members adjacent.
 *
 * The baseline is first-occurrence order (spec §2.2 priority 3): the first
 * participant referenced by a message gets the leftmost column, regardless of
 * declaration order. A bare declaration line assigns a tag/type only — it does
 * NOT pin a column. Participants that never appear in any message fall back to
 * declaration order (priority 4) and are appended after the message-referenced
 * ones.
 *
 * When spatial `[Group]` boxes exist (priority 2), each group's members are
 * pulled adjacent at the group's first-appearance anchor, overriding their
 * individual appearance slots. With no groups this reduces to pure
 * appearance order.
 *
 * Explicit `position` overrides (priority 1) are handled separately by
 * `applyPositionOverrides`, which runs after this pass.
 */
export function applyGroupOrdering(
  participants: readonly SequenceParticipant[],
  groups: readonly SequenceGroup[],
  messages: readonly SequenceMessage[] = []
): SequenceParticipant[] {
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
  const fillMode = fillModeFromOptions(parsedOptions);

  // Effective collapsed groups. `options.collapsedGroups` is the AUTHORITATIVE
  // desired set when supplied — the app seeds it from the source `collapsed:
  // true` markers and mutates it on toggle (write-through keeps source in sync),
  // so it must NOT be XOR'd against the syntax-declared set (doing so cancelled
  // a seeded set back to expanded). With no set supplied (bare render / CLI),
  // default to the syntax-declared collapsed groups. Mirrors gantt/kanban/state.
  const effectiveCollapsedGroups = options?.collapsedGroups
    ? new Set(options.collapsedGroups)
    : new Set(
        parsed.groups.filter((g) => g.collapsed).map((g) => g.lineNumber)
      );

  // Apply collapse projection before participant ordering
  const collapsed: CollapsedView | null =
    effectiveCollapsedGroups.size > 0
      ? applyCollapseProjection(parsed, effectiveCollapsedGroups)
      : null;

  const messages = collapsed ? collapsed.messages : parsed.messages;
  const elements = collapsed ? collapsed.elements : parsed.elements;
  const groups = collapsed ? collapsed.groups : parsed.groups;
  const collapsedSections = options?.collapsedSections;

  const sourceParticipants = collapsed
    ? collapsed.participants
    : parsed.participants;
  const participants = applyPositionOverrides(
    applyGroupOrdering(sourceParticipants, groups, messages)
  );
  if (participants.length === 0) return;

  // Compute group boundaries for inter-group spacing redistribution.
  // A gap is "between" (wider) whenever the two adjacent lifelines are not
  // members of the same group — this includes group→group, group→loose, and
  // loose→group transitions. Only two lifelines inside the same group, or two
  // adjacent loose lifelines, get the tighter "within" gap. Treating a loose
  // participant as its own non-group prevents it from being jammed against an
  // adjacent group box (whose frame extends GROUP_PADDING_X past its members).
  const groupBoundaryIds = new Set<string>();
  if (groups.length > 0) {
    const pToG = new Map<string, number>();
    for (let gi = 0; gi < groups.length; gi++) {
      for (const pid of groups[gi]!.participantIds) pToG.set(pid, gi);
    }
    const LOOSE = -1;
    for (let i = 1; i < participants.length; i++) {
      const prevGi = pToG.get(participants[i - 1]!.id) ?? LOOSE;
      const gi = pToG.get(participants[i]!.id) ?? LOOSE;
      // Different group membership → boundary. Two loose lifelines (both LOOSE)
      // stay tight since neither carries a group frame.
      if (gi !== prevGi && !(gi === LOOSE && prevGi === LOOSE)) {
        groupBoundaryIds.add(participants[i]!.id);
      }
    }
  }
  const numGroupGaps = groupBoundaryIds.size;

  // Content-adaptive box width: measure widest label, use uniform width for all
  const MAX_BOX_WIDTH = 225;
  let uniformBoxWidth = PARTICIPANT_BOX_WIDTH;
  for (const p of participants) {
    const lines = splitParticipantLabel(
      p.label,
      labelTextWidth(PARTICIPANT_BOX_WIDTH),
      LABEL_FONT_SIZE
    );
    if (lines.length === 0) continue;
    const widest = Math.max(
      ...lines.map((l) => measureText(l, LABEL_FONT_SIZE))
    );
    const labelWidth = widest + 10;
    uniformBoxWidth = Math.max(uniformBoxWidth, labelWidth);
  }
  uniformBoxWidth = Math.min(MAX_BOX_WIDTH, uniformBoxWidth);
  const effectiveGap = Math.max(PARTICIPANT_GAP, uniformBoxWidth + 30);

  const idealWidth = Math.max(
    participants.length * effectiveGap,
    uniformBoxWidth + 40
  );
  const containerWidth =
    options?.exportWidth ?? container.getBoundingClientRect().width;
  const ctx = options?.exportWidth
    ? ScaleContext.identity()
    : ScaleContext.from(containerWidth, idealWidth);

  const sGap = ctx.structural(effectiveGap);
  const sBoxW = ctx.structural(uniformBoxWidth);
  const sBoxH = ctx.structural(PARTICIPANT_BOX_HEIGHT);
  const sTopMargin = ctx.aesthetic(TOP_MARGIN);
  const sTitleHeight = ctx.aesthetic(TITLE_HEIGHT);
  const sParticipantYOffset = ctx.aesthetic(PARTICIPANT_Y_OFFSET);
  const sMsgStartOffset = ctx.structural(MESSAGE_START_OFFSET);
  const sLifelineTail = ctx.structural(LIFELINE_TAIL);
  const sArrowheadSize = ctx.structural(ARROWHEAD_SIZE);
  const sNoteMaxW = ctx.structural(NOTE_MAX_W);
  const sNoteFold = ctx.structural(NOTE_FOLD);
  const sNotePadH = ctx.structural(NOTE_PAD_H);
  const sNotePadV = ctx.structural(NOTE_PAD_V);
  const sNoteFontSize = ctx.text(NOTE_FONT_SIZE);
  const sNoteLineH = ctx.structural(NOTE_LINE_H);
  const sNoteGap = ctx.structural(NOTE_GAP);
  const sActivationWidth = ctx.structural(ACTIVATION_WIDTH);
  const sSelfCallHeight = SELF_CALL_HEIGHT;
  const sSelfCallWidth = ctx.structural(SELF_CALL_WIDTH);
  // Pixel width available for note text inside the widest allowed note box
  // (box width minus the horizontal padding on both sides and the fold cut).
  const sNoteTextWidthMax = sNoteMaxW - sNotePadH * 2 - sNoteFold;
  const sNoteLaneMax = sGap - sActivationWidth - sNoteGap;
  const sLabelFontSize = ctx.text(LABEL_FONT_SIZE);
  // Pixel width available for a participant label inside the scaled box.
  const sLabelTextWidth = labelTextWidth(sBoxW);

  // Participant index lookup — used to clamp note width within one lane
  const participantIndexMap = new Map<string, number>();
  participants.forEach((p, i) => participantIndexMap.set(p.id, i));

  // Notes anchored to the outermost participant on the side they'd extend
  // toward have no neighbor lane to fit into, so they would overflow the SVG.
  // Flip them to the inside when there's a participant on the other side.
  const effectiveNotePosition = (note: SequenceNote): 'left' | 'right' => {
    const idx = participantIndexMap.get(note.participantId);
    if (idx === undefined) return note.position;
    if (note.position === 'right' && idx === participants.length - 1 && idx > 0)
      return 'left';
    if (note.position === 'left' && idx === 0 && participants.length > 1)
      return 'right';
    return note.position;
  };

  // Extra X shift for notes after self-calls
  const SELF_CALL_NOTE_X_SHIFT =
    sActivationWidth / 2 +
    sSelfCallWidth +
    sNoteGap -
    (sActivationWidth + sNoteGap);

  const noteEffectiveMaxW = (
    participantId: string,
    position: 'right' | 'left',
    afterSelfCall = false
  ): number => {
    const idx = participantIndexMap.get(participantId);
    if (idx === undefined) return sNoteMaxW;
    const hasNeighbor =
      position === 'right' ? idx < participants.length - 1 : idx > 0;
    if (!hasNeighbor) return sNoteMaxW;
    const laneMax =
      afterSelfCall && position === 'right'
        ? sNoteLaneMax - SELF_CALL_NOTE_X_SHIFT
        : sNoteLaneMax;
    return Math.min(sNoteMaxW, laneMax);
  };

  // Pixel width available for note text inside a note box of the given outer
  // width — outer width minus horizontal padding (both sides) and the fold cut.
  const noteTextWidth = (maxW: number): number =>
    maxW - sNotePadH * 2 - sNoteFold;

  const activationsOff = parsedOptions['activations']?.toLowerCase() === 'off';

  // Tag resolution — shared utility handles priority chain:
  // programmatic override → diagram-level active-tag → auto-activate first group
  const activeTagGroup =
    resolveActiveTagGroup(
      parsed.tagGroups.filter((tg) => tg.entries.length > 0),
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
  const tagKey = activeTagGroup ? tagAttrKey(activeTagGroup) : undefined;

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
  // A step survives into the laid-out sequence when it is not hidden by a
  // collapsed section AND it is either a call or a *labeled* return. Unlabeled
  // returns are dropped from the layout — they add vertical noise without
  // conveying information — but they still balance the activation stack, so
  // dropping them before computeActivations would corrupt nesting depth
  // (self-call returns are unlabeled; their pushes would never pop, shifting
  // the parent activation to a bogus depth). Compute depth on the full
  // balanced sequence, then remap step indices to the laid-out array.
  const stepSurvives = (s: RenderStep): boolean =>
    (hiddenMsgIndices.size === 0 || !hiddenMsgIndices.has(s.messageIndex)) &&
    (s.type === 'call' || !!s.label);
  const renderSteps: RenderStep[] = [];
  // allRenderSteps index → laid-out (renderSteps) index. A dropped step maps to
  // the next surviving step, so an activation whose closing return was dropped
  // still extends to the following event rather than collapsing to zero height.
  const allToFiltered: number[] = new Array(allRenderSteps.length);
  for (let j = 0; j < allRenderSteps.length; j++) {
    const s = allRenderSteps[j]!;
    allToFiltered[j] = renderSteps.length;
    if (stepSurvives(s)) renderSteps.push(s);
  }
  const lastStepIdx = Math.max(renderSteps.length - 1, 0);
  const clampStep = (i: number): number =>
    Math.min(Math.max(i, 0), lastStepIdx);
  // Activations computed on the balanced sequence for correct nesting depth,
  // then remapped to laid-out indices for Y positioning.
  const activations = activationsOff
    ? []
    : computeActivations(allRenderSteps).map((a) => ({
        ...a,
        startStep: clampStep(allToFiltered[a.startStep] ?? 0),
        endStep: clampStep(allToFiltered[a.endStep] ?? 0),
      }));
  // Vertical spacing is NOT compressed by ScaleContext — the container scrolls
  // vertically, so keeping full spacing preserves message readability at all scales.
  const stepSpacing = 35;

  // --- Block-aware Y spacing ---
  const BLOCK_HEADER_SPACE = 30;
  const BLOCK_AFTER_SPACE = 15;
  const FRAME_PADDING_TOP = 42;

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
      // In-bounds by loop guard.
      const m = messages[mi]!;
      if (m.lineNumber < note.lineNumber && m.lineNumber > closestLine) {
        closestLine = m.lineNumber;
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

  // Check whether a note's preceding message is a self-call.
  // Self-call loopback arrows extend SELF_CALL_HEIGHT below the step Y,
  // so notes after self-calls need a larger vertical offset.
  const isNoteAfterSelfCall = (note: SequenceNote): boolean => {
    let closestMsgIndex = -1;
    let closestLine = -1;
    for (let mi = 0; mi < messages.length; mi++) {
      // In-bounds by loop guard.
      const m = messages[mi]!;
      if (m.lineNumber < note.lineNumber && m.lineNumber > closestLine) {
        closestLine = m.lineNumber;
        closestMsgIndex = mi;
      }
    }
    if (closestMsgIndex < 0) return false;
    // In-bounds: closestMsgIndex was set from a valid `mi` above.
    const msg = messages[closestMsgIndex]!;
    return msg.from === msg.to;
  };

  // Extra gap below self-call loop before note starts
  const SELF_CALL_NOTE_GAP = ctx.structural(8);
  const noteOffsetBelow = (note: SequenceNote): number =>
    isNoteAfterSelfCall(note)
      ? sSelfCallHeight + NOTE_OFFSET_BELOW + SELF_CALL_NOTE_GAP
      : NOTE_OFFSET_BELOW;

  // Find the first visible message index in an element subtree.
  // Use lineNumber lookup instead of indexOf — collapse projection creates
  // separate spread copies for messages[] and elements[], breaking reference equality.
  const msgLineToIdx = new Map<number, number>();
  messages.forEach((m, i) => msgLineToIdx.set(m.lineNumber, i));

  const findFirstMsgIndex = (els: readonly SequenceElement[]): number => {
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
        const idx = msgLineToIdx.get(el.lineNumber) ?? -1;
        if (idx >= 0 && !hiddenMsgIndices.has(idx)) return idx;
      }
    }
    return -1;
  };

  // Section layout constants
  const isSectionCollapsed = (
    sec: import('./parser').SequenceSection
  ): boolean => collapsedSections?.has(sec.lineNumber) ?? false;
  /** Half the collapsed band's extra height, added on each side of the anchor. */
  const collapsedBandPad = (sec: import('./parser').SequenceSection): number =>
    isSectionCollapsed(sec) ? COLLAPSED_SECTION_BAND_EXTRA / 2 : 0;
  const SECTION_TOP_PAD = 35;
  const SECTION_BOTTOM_PAD = 45;

  // Block spacing via extraBeforeMsg (sections handled separately below)
  const extraBeforeMsg = new Map<number, number>();
  const addExtra = (msgIdx: number, amount: number) => {
    extraBeforeMsg.set(msgIdx, (extraBeforeMsg.get(msgIdx) || 0) + amount);
  };

  const markBlockSpacing = (els: readonly SequenceElement[]): void => {
    for (let i = 0; i < els.length; i++) {
      // In-bounds by loop guard.
      const el = els[i]!;
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
        // In-bounds: i + 1 < els.length guard.
        const nextIdx = findFirstMsgIndex([els[i + 1]!]);
        if (nextIdx >= 0) addExtra(nextIdx, BLOCK_AFTER_SPACE);
      }
    }
  };

  if (elements && elements.length > 0) {
    markBlockSpacing(elements);
  }

  // Note spacing — add vertical room after messages that have notes attached
  const NOTE_OFFSET_BELOW = ctx.structural(14);
  // The next message label extends ~17px above its arrow line (8px offset + 9px cap height).
  // When notes share horizontal space with subsequent arrows, generous vertical clearance
  // is needed so note boxes don't visually cover message labels.
  const NOTE_TRAILING_GAP = ctx.aesthetic(35);
  const computeNoteHeight = (
    text: string,
    textWidth: number = sNoteTextWidthMax
  ): number => {
    const lines = wrapTextLines(text, textWidth, sNoteFontSize);
    return lines.length * sNoteLineH + sNotePadV * 2;
  };
  let trailingNoteSpace = 0; // extra space for notes at the end with no following message
  const markNoteSpacing = (els: readonly SequenceElement[]): void => {
    for (let i = 0; i < els.length; i++) {
      // In-bounds by loop guard.
      const el = els[i]!;
      if (isSequenceNote(el)) {
        // Total vertical extent of notes from the message arrow:
        //   offset (gap above first note — larger after self-calls)
        //   + each note's height + NOTE_OFFSET_BELOW (inter-note gap)
        //   + NOTE_TRAILING_GAP (gap below last note — clears next message label)
        const firstOffset = noteOffsetBelow(el as SequenceNote);
        let totalExtent = firstOffset;
        let j = i;
        // In-bounds: j < els.length guard inside the while.
        while (j < els.length && isSequenceNote(els[j]!)) {
          // In-bounds: same guard as while.
          const note = els[j]! as SequenceNote;
          const sc = isNoteAfterSelfCall(note);
          const maxW = noteEffectiveMaxW(note.participantId, note.position, sc);
          const noteH = computeNoteHeight(note.text, noteTextWidth(maxW));
          totalExtent += noteH + NOTE_OFFSET_BELOW;
          j++;
        }
        // Replace the final inter-note gap with a proportional trailing gap
        // so tall/stacked notes get extra clearance while short notes keep baseline
        const trailingGap = Math.max(NOTE_TRAILING_GAP, totalExtent * 0.3);
        totalExtent += trailingGap - NOTE_OFFSET_BELOW;
        // Only reserve space beyond the existing stepSpacing gap
        let extraNeeded = Math.max(0, totalExtent - stepSpacing);
        // Scan forward past sections, blocks, and other non-message elements to find next message
        let nextMsgIdx = -1;
        for (let k = j; k < els.length; k++) {
          // In-bounds by loop guard.
          nextMsgIdx = findFirstMsgIndex([els[k]!]);
          if (nextMsgIdx >= 0) break;
        }
        // If a block follows, its frame extends FRAME_PADDING_TOP above the first
        // message but only BLOCK_HEADER_SPACE is reserved. Add the difference so
        // the note doesn't overlap the frame.
        // In-bounds: j < els.length guard.
        if (j < els.length && isSequenceBlock(els[j]!)) {
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
      // In-bounds by loop guard.
      const step = allRenderSteps[oi]!;
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
    // In-bounds: msgIndices.length === 0 guard above.
    const firstMsgIdx = region.msgIndices[0]!;
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
  const showTitle = !!title && parsedOptions['no-title'] !== 'on';
  const titleOffset = showTitle ? sTitleHeight : 0;
  const LEGEND_FIXED_GAP = 8;
  const resolvedGroups = parsed.tagGroups
    .filter((tg) => tg.entries.length > 0)
    .map((tg) => ({
      name: tg.name,
      entries: tg.entries.map((e) => ({ value: e.value, color: e.color })),
    }));
  const legendConfig: LegendConfig = {
    groups: resolvedGroups,
    position: { placement: 'top-center', titleRelation: 'below-title' },
    mode: 'preview',
  };
  // §1.9 `no-legend` — suppress the legend and collapse the band reserved for
  // it above the participant row.
  const noLegend = legendSuppressed(parsedOptions);
  const legendTopSpace =
    parsed.tagGroups.length > 0 && !noLegend
      ? getMaxLegendReservedHeight(legendConfig, containerWidth) +
        LEGEND_FIXED_GAP
      : 0;
  // §1.9 `legend-inline` (decision #50): try a one-line header (title left,
  // legend flushed right). Falls back to the stacked band when the legend can't
  // fit beside the title. The header is laid out against `containerWidth` — the
  // same width the legend reserve (getMaxLegendReservedHeight above) uses and
  // the only width finalized this early (svgWidth is derived downstream), so the
  // participant-offset decision here and the title/legend render below share one
  // consistent `header`.
  const inlineRequested = legendInlineRequested(parsedOptions);
  const hasLegendForHeader = parsed.tagGroups.length > 0 && !noLegend;
  const legendExtent =
    inlineRequested && hasLegendForHeader
      ? getLegendExtent(
          {
            ...legendConfig,
            position: {
              placement: 'top-center',
              titleRelation: 'inline-with-title',
            },
          },
          { activeGroup: activeTagGroup ?? null },
          containerWidth
        )
      : { width: 0, height: 0 };
  const header = layoutInlineHeader({
    requested: inlineRequested,
    title: title ?? '',
    hasLegend: hasLegendForHeader,
    legendWidth: legendExtent.width,
    legendHeight: legendExtent.height,
    containerWidth,
    titleBandHeight: titleOffset,
    legendReserve: legendTopSpace,
    titleBaselineY: ctx.structural(TITLE_Y),
    titleFontSize: ctx.text(TITLE_FONT_SIZE),
  });
  // Use parsed.groups (not projected groups) to keep vertical space consistent
  // even when all groups are collapsed into virtual participants
  const groupOffset =
    parsed.groups.length > 0 ? GROUP_PADDING_TOP + GROUP_LABEL_SIZE : 0;
  const participantStartY =
    sTopMargin +
    titleOffset +
    (header.inline ? 0 : legendTopSpace) +
    sParticipantYOffset +
    groupOffset;
  const lifelineStartY0 = participantStartY + sBoxH;
  const hasActors = participants.some((p) => p.type === 'actor');
  const messageStartOffset =
    sMsgStartOffset +
    (hasActors ? 20 : 0) +
    (parsed.groups.length > 0 ? GROUP_PADDING_BOTTOM : 0);
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
          const bandPad = collapsedBandPad(sec);
          curY += SECTION_TOP_PAD + bandPad;
          sectionYPositions.set(sec.lineNumber, curY);
          curY += SECTION_BOTTOM_PAD + bandPad;
        }
      }

      // In-bounds by loop guard.
      const step = renderSteps[i]!;
      // Add extra spacing before the first render step of a flagged message (block spacing)
      if (msgToFirstStep.get(step.messageIndex) === i) {
        const extra = extraBeforeMsg.get(step.messageIndex) || 0;
        curY += extra;
      }
      stepYPositions.push(curY);
      const isSelfCall = step.type === 'call' && step.from === step.to;
      curY += isSelfCall ? sSelfCallHeight + 25 : stepSpacing;
    }
    // Handle trailing sections (after all steps)
    for (const sec of trailingSections) {
      const bandPad = collapsedBandPad(sec);
      curY += SECTION_TOP_PAD + bandPad;
      sectionYPositions.set(sec.lineNumber, curY);
      curY += SECTION_BOTTOM_PAD + bandPad;
    }
    // Extend for trailing notes that have no following message
    curY += trailingNoteSpace;
    layoutEndY = curY;
  }

  // Helper: compute Y for a step index
  // Callers always pass a valid filtered step index from renderSteps (which is
  // 1:1 with stepYPositions by construction in the layout loop above).
  const stepY = (i: number) => stepYPositions[i]!;

  // Compute absolute Y positions for each note element
  const noteYMap = new Map<SequenceNote, number>();
  {
    const computeNotePositions = (els: readonly SequenceElement[]): void => {
      for (let i = 0; i < els.length; i++) {
        // In-bounds by loop guard.
        const el = els[i]!;
        if (isSequenceNote(el)) {
          const si = findAssociatedLastStep(el);
          if (si < 0) continue;
          // Check if there's a preceding note that we should stack below
          // In-bounds: i > 0 guard.
          const prevNote =
            i > 0 && isSequenceNote(els[i - 1]!)
              ? (els[i - 1]! as SequenceNote)
              : null;
          const prevNoteY = prevNote ? noteYMap.get(prevNote) : undefined;
          let noteTopY: number;
          if (prevNoteY !== undefined && prevNote) {
            // Stack below previous note
            const prevMaxW = noteEffectiveMaxW(
              prevNote.participantId,
              effectiveNotePosition(prevNote),
              isNoteAfterSelfCall(prevNote)
            );
            const prevNoteH = computeNoteHeight(
              prevNote.text,
              noteTextWidth(prevMaxW)
            );
            noteTopY = prevNoteY + prevNoteH + NOTE_OFFSET_BELOW;
          } else {
            // First note after a message — use larger offset after self-calls
            noteTopY = stepY(si) + noteOffsetBelow(el);
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
  const lastStep = renderSteps[renderSteps.length - 1];
  const lastIsSelfCall =
    lastStep?.type === 'call' && lastStep.from === lastStep.to;
  const lastStepTrailing = lastIsSelfCall ? sSelfCallHeight + 25 : stepSpacing;
  let contentBottomY =
    renderSteps.length > 0
      ? Math.max(
          // In-bounds: renderSteps.length > 0 guarantees stepYPositions is
          // non-empty (1:1 with renderSteps in the layout loop above).
          stepYPositions[stepYPositions.length - 1]! + lastStepTrailing,
          layoutEndY
        )
      : layoutEndY;
  for (const [note, noteTopY] of noteYMap) {
    const maxW = noteEffectiveMaxW(
      note.participantId,
      effectiveNotePosition(note),
      isNoteAfterSelfCall(note)
    );
    const noteH = computeNoteHeight(note.text, noteTextWidth(maxW));
    contentBottomY = Math.max(
      contentBottomY,
      noteTopY + noteH + NOTE_TRAILING_GAP
    );
  }
  const messageAreaHeight = contentBottomY - lifelineStartY0;
  const lifelineLength = messageAreaHeight + sLifelineTail;
  // Redistribute gap: tighter within groups, wider between groups.
  // Total width stays exactly participants.length * sGap — no viewBox change.
  const totalGaps = participants.length > 1 ? participants.length - 1 : 0;
  const numWithinGaps = totalGaps - numGroupGaps;
  let sWithinGap = sGap;
  let sBetweenGap = sGap;
  if (numGroupGaps > 0 && totalGaps > 0) {
    sWithinGap = sGap * 0.88;
    sBetweenGap =
      (totalGaps * sGap - numWithinGaps * sWithinGap) / numGroupGaps;
  }

  // Compute right-edge projection: how far content extends past the rightmost lifeline
  const rightmostId = participants[participants.length - 1]?.id;
  let rightProjection = sBoxW / 2;
  if (rightmostId) {
    // Group padding if rightmost participant is in a group
    if (
      parsed.groups.some((g: SequenceGroup) =>
        g.participantIds.includes(rightmostId)
      )
    )
      rightProjection = Math.max(rightProjection, sBoxW / 2 + GROUP_PADDING_X);
    // Self-calls on rightmost: loop + label projection (+ activation nesting buffer)
    for (const step of renderSteps) {
      if (step.from === step.to && step.from === rightmostId) {
        const selfProj = sActivationWidth + sSelfCallWidth;
        let labelProj = 0;
        // Self-call labels render at the fixed 12px message-label size.
        if (step.label) labelProj = measureText(step.label, 12) + 15;
        rightProjection = Math.max(rightProjection, selfProj + labelProj);
      }
    }
    // Block frames spanning rightmost participant (must match FRAME_PADDING_X = 30 in block rendering below)
    const blockFramePadX = 30;
    const hasBlockWithRightmost = (
      els: readonly SequenceElement[]
    ): boolean => {
      for (const el of els) {
        if (isSequenceBlock(el)) {
          const involvesRightmost = (
            children: readonly SequenceElement[]
          ): boolean =>
            children.some(
              (c) =>
                !isSequenceBlock(c) &&
                !isSequenceNote(c) &&
                !isSequenceSection(c) &&
                'from' in c &&
                (c.from === rightmostId || c.to === rightmostId)
            );
          if (
            involvesRightmost(el.children) ||
            involvesRightmost(el.elseChildren) ||
            el.elseIfBranches?.some((b) => involvesRightmost(b.children))
          )
            return true;
          if (
            hasBlockWithRightmost(el.children) ||
            hasBlockWithRightmost(el.elseChildren) ||
            el.elseIfBranches?.some((b) => hasBlockWithRightmost(b.children))
          )
            return true;
        }
      }
      return false;
    };
    if (elements && hasBlockWithRightmost(elements))
      rightProjection = Math.max(rightProjection, sBoxW / 2 + blockFramePadX);
  }
  let rightMargin = Math.max(rightProjection + 10, sGap / 2);

  let leftMargin = sGap / 2;
  // Lifelines span (n-1) gaps; overhang past the last lifeline (box half,
  // group padding) is already covered by rightMargin's rightProjection. The
  // previous `participants.length * sGap` baked one phantom trailing gap into
  // totalWidth, so wide-container centering sat every diagram left of center.
  const diagramWidth = Math.max(0, participants.length - 1) * sGap;
  let totalWidth = Math.max(
    leftMargin + diagramWidth + rightMargin,
    sBoxW + 40
  );
  const contentHeight =
    participantStartY + sBoxH + Math.max(lifelineLength, 40) + 40;
  const totalHeight = contentHeight;

  let svgWidth = Math.max(totalWidth, containerWidth);

  let offsetX = leftMargin + Math.max(0, (svgWidth - totalWidth) / 2);

  // Build participant x-position lookup with redistributed gaps
  const participantX = new Map<string, number>();
  const buildParticipantX = (): void => {
    let px = offsetX;
    participantX.clear();
    participants.forEach((p, i) => {
      participantX.set(p.id, px);
      if (i < participants.length - 1) {
        const nextId = participants[i + 1]!.id;
        px += groupBoundaryIds.has(nextId) ? sBetweenGap : sWithinGap;
      }
    });
  };
  buildParticipantX();

  // Post-layout content scan: detect labels/notes that overflow the SVG
  // boundaries. Message labels render at a fixed 12px font (unscaled) so they
  // can extend past the scaled participant grid at small scale factors.
  //
  // This must ITERATE. A single pass is coordinate-inconsistent in two ways:
  //   1. Padding the left margin shifts the whole grid rightward, which moves
  //      right-edge content that was already measured — leaving the right pad
  //      short by exactly the left pad (content clips off the right edge).
  //   2. When the container is wider than the diagram, the centering term only
  //      absorbs a fraction of a one-shot pad, so left content can still poke
  //      out negative.
  // Re-scanning in the shifted frame until stable resolves both. Padding only
  // ever grows, so this converges in a couple of passes; cap it for safety.
  //
  // The activation-width safety margin covers a second mismatch: the scan places
  // message labels at the lifeline-center midpoint, but the renderer anchors
  // them at the activation-box-edge midpoint (see the `midX = (x1 + x2) / 2`
  // using `arrowEdgeX` below). Those differ by up to half an activation width
  // when the two endpoints' activation states are asymmetric.
  // Half an activation width covers the lifeline-center vs activation-edge
  // mismatch; +2px covers the label's stroke halo (`stroke-width: 4`, painted
  // under the fill) so glyph edges never touch the viewBox boundary.
  const labelSafety = sActivationWidth / 2 + 2;
  const scanNotes = (
    els: readonly SequenceElement[],
    acc: { right: number }
  ): void => {
    for (const el of els) {
      if (isSequenceNote(el)) {
        const note = el as SequenceNote;
        const pos = effectiveNotePosition(note);
        if (pos === 'right') {
          const px = participantX.get(note.participantId);
          if (px !== undefined) {
            const sc = isNoteAfterSelfCall(note);
            const rOff = sc
              ? sActivationWidth / 2 + sSelfCallWidth + sNoteGap
              : sActivationWidth + sNoteGap;
            const maxW = noteEffectiveMaxW(note.participantId, pos, sc);
            acc.right = Math.max(acc.right, px + rOff + maxW);
          }
        }
      } else if (isSequenceBlock(el)) {
        scanNotes(el.children, acc);
        scanNotes(el.elseChildren, acc);
        if (el.elseIfBranches) {
          for (const b of el.elseIfBranches) scanNotes(b.children, acc);
        }
      }
    }
  };
  for (let pass = 0; pass < 4; pass++) {
    let contentLeft = 0;
    let contentRight = svgWidth;
    for (const step of renderSteps) {
      if (!step.label) continue;
      const labelW = measureText(step.label, 12);
      if (step.from === step.to) {
        const px = participantX.get(step.from);
        if (px !== undefined) {
          const loopRight =
            px +
            sActivationWidth / 2 +
            sSelfCallWidth +
            5 +
            labelW +
            labelSafety;
          contentRight = Math.max(contentRight, loopRight);
        }
      } else {
        const fromX = participantX.get(step.from);
        const toX = participantX.get(step.to);
        if (fromX !== undefined && toX !== undefined) {
          const midX = (fromX + toX) / 2;
          contentLeft = Math.min(contentLeft, midX - labelW / 2 - labelSafety);
          contentRight = Math.max(
            contentRight,
            midX + labelW / 2 + labelSafety
          );
        }
      }
    }
    // Scan right-positioned notes for overflow past the right edge
    if (elements) {
      const acc = { right: contentRight };
      scanNotes(elements, acc);
      contentRight = acc.right;
    }
    const neededLeftPad = Math.max(0, -contentLeft);
    const neededRightPad = Math.max(0, contentRight - svgWidth);
    if (neededLeftPad <= 0.5 && neededRightPad <= 0.5) break;
    leftMargin += neededLeftPad;
    rightMargin += neededRightPad;
    totalWidth = Math.max(leftMargin + diagramWidth + rightMargin, sBoxW + 40);
    svgWidth = Math.max(totalWidth, containerWidth);
    offsetX = leftMargin + Math.max(0, (svgWidth - totalWidth) / 2);
    buildParticipantX();
  }

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
    .attr('viewBox', `0 0 ${sArrowheadSize} ${sArrowheadSize}`)
    .attr('refX', sArrowheadSize)
    .attr('refY', sArrowheadSize / 2)
    .attr('markerWidth', sArrowheadSize)
    .attr('markerHeight', sArrowheadSize)
    .attr('orient', 'auto')
    .append('polygon')
    .attr(
      'points',
      `0,0 ${sArrowheadSize},${sArrowheadSize / 2} 0,${sArrowheadSize}`
    )
    .attr('fill', palette.text);

  // Open arrowhead for return arrows
  defs
    .append('marker')
    .attr('id', 'seq-arrowhead-open')
    .attr('viewBox', `0 0 ${sArrowheadSize} ${sArrowheadSize}`)
    .attr('refX', sArrowheadSize)
    .attr('refY', sArrowheadSize / 2)
    .attr('markerWidth', sArrowheadSize)
    .attr('markerHeight', sArrowheadSize)
    .attr('orient', 'auto')
    .append('polyline')
    .attr(
      'points',
      `0,0 ${sArrowheadSize},${sArrowheadSize / 2} 0,${sArrowheadSize}`
    )
    .attr('fill', 'none')
    .attr('stroke', palette.textMuted)
    .attr('stroke-width', 1.2);

  // Open arrowhead for async (fire-and-forget) arrows — same as return but text color
  defs
    .append('marker')
    .attr('id', 'seq-arrowhead-async')
    .attr('viewBox', `0 0 ${sArrowheadSize} ${sArrowheadSize}`)
    .attr('refX', sArrowheadSize)
    .attr('refY', sArrowheadSize / 2)
    .attr('markerWidth', sArrowheadSize)
    .attr('markerHeight', sArrowheadSize)
    .attr('orient', 'auto')
    .append('polyline')
    .attr(
      'points',
      `0,0 ${sArrowheadSize},${sArrowheadSize / 2} 0,${sArrowheadSize}`
    )
    .attr('fill', 'none')
    .attr('stroke', palette.text)
    .attr('stroke-width', 1.2);

  // Per-color arrowhead markers for tag-driven coloring
  const arrowPoints = `0,0 ${sArrowheadSize},${sArrowheadSize / 2} 0,${sArrowheadSize}`;
  for (const [, color] of tagValueToColor) {
    const hex = color.replace('#', '');
    // Filled arrowhead (call arrows)
    defs
      .append('marker')
      .attr('id', `seq-arrowhead-c${hex}`)
      .attr('viewBox', `0 0 ${sArrowheadSize} ${sArrowheadSize}`)
      .attr('refX', sArrowheadSize)
      .attr('refY', sArrowheadSize / 2)
      .attr('markerWidth', sArrowheadSize)
      .attr('markerHeight', sArrowheadSize)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', arrowPoints)
      .attr('fill', color);
    // Open arrowhead (async arrows)
    defs
      .append('marker')
      .attr('id', `seq-arrowhead-async-c${hex}`)
      .attr('viewBox', `0 0 ${sArrowheadSize} ${sArrowheadSize}`)
      .attr('refX', sArrowheadSize)
      .attr('refY', sArrowheadSize / 2)
      .attr('markerWidth', sArrowheadSize)
      .attr('markerHeight', sArrowheadSize)
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
      .attr('viewBox', `0 0 ${sArrowheadSize} ${sArrowheadSize}`)
      .attr('refX', sArrowheadSize)
      .attr('refY', sArrowheadSize / 2)
      .attr('markerWidth', sArrowheadSize)
      .attr('markerHeight', sArrowheadSize)
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
  if (showTitle) {
    const titleEl = svg
      .append('text')
      .attr('class', 'chart-title')
      .attr('x', header.inline ? header.titleX : svgWidth / 2)
      .attr('y', ctx.structural(TITLE_Y))
      .attr('text-anchor', header.inline ? header.titleAnchor : 'middle')
      .attr('fill', palette.text)
      .attr('font-size', ctx.text(TITLE_FONT_SIZE))
      .attr('font-weight', TITLE_FONT_WEIGHT)
      .text(title);

    if (parsed.titleLineNumber) {
      titleEl.attr('data-line-number', parsed.titleLineNumber);
    }
  }

  const hasTagGroups = parsed.tagGroups.length > 0 && !noLegend;

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
        ...(group.metadata !== undefined && { metadata: group.metadata }),
      });
    }
  }

  /**
   * The colour a participant's own shape wears — its tag colour, falling back
   * to the group's metadata when a collapsed group stands in for its members.
   * A collapsed section's marks read this too, so a mark can never disagree
   * with the column it sits on about what colour that participant is.
   */
  const participantTagColor = (id: string): string | undefined => {
    const direct = getTagColor(tagMap?.participants.get(id));
    if (direct) return direct;
    if (!collapsedGroupNames.has(id) || !tagKey) return undefined;
    const meta = collapsedGroupMeta.get(id);
    return meta?.metadata ? getTagColor(meta.metadata[tagKey]) : undefined;
  };

  // Render group boxes (behind participant shapes) — skip collapsed groups
  for (const group of groups) {
    if (group.participantIds.length === 0) continue;

    // Find X bounds from member participant positions
    const memberXs = group.participantIds
      .map((id) => participantX.get(id))
      .filter((x): x is number => x !== undefined);
    if (memberXs.length === 0) continue;

    const minX = Math.min(...memberXs) - sBoxW / 2 - GROUP_PADDING_X;
    const maxX = Math.max(...memberXs) + sBoxW / 2 + GROUP_PADDING_X;
    const boxY = participantStartY - GROUP_PADDING_TOP;
    const boxH = sBoxH + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM;

    // Group box background — use tag color if group has metadata for the active tag group.
    // Intentionally 15-20% (not the canonical 25% shapeFill): group boxes are
    // CONTAINERS that wrap multiple participants, so they should recede behind
    // the tinted participant shapes inside them. Promoting to 25% would make
    // the wrapper compete with its contents.
    const groupTagValue = tagKey && group.metadata?.[tagKey];
    const groupTagColor = getTagColor(groupTagValue || undefined);
    const fillColor = groupTagColor
      ? mix(groupTagColor, themeBaseBg(palette, isDark), isDark ? 15 : 20)
      : isDark
        ? palette.surface
        : palette.bg;
    const strokeColor = groupTagColor || palette.textMuted;

    const groupG = svg
      .append('g')
      .attr('class', 'group-box-wrapper')
      .attr('data-group-toggle', '')
      .attr('data-group-line', String(group.lineNumber))
      .attr('tabindex', '0')
      .attr('role', 'button')
      .attr('aria-expanded', 'true')
      .attr('cursor', 'pointer');
    groupG.append('title').text('Click to collapse');

    // Visual group frame — pointer-events:none so it never intercepts clicks.
    // The box is rendered behind the participant shapes, so the only reliable
    // toggle target is the header strip above the participants (hit area below).
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
      .attr('pointer-events', 'none')
      .attr('class', 'group-box');

    // Transparent hit area over the header strip (above the participant boxes,
    // so it is never occluded). Gives the toggle a generous, discoverable
    // click target — mirrors the section-label-hit pattern.
    groupG
      .append('rect')
      .attr('x', minX)
      .attr('y', boxY)
      .attr('width', maxX - minX)
      .attr('height', participantStartY - boxY)
      .attr('fill', 'transparent')
      .attr('class', 'group-label-hit');

    // Group label — centered across the header strip.
    groupG
      .append('text')
      .attr('x', (minX + maxX) / 2)
      .attr('y', boxY + GROUP_LABEL_SIZE + 4)
      .attr('text-anchor', 'middle')
      .attr('fill', strokeColor)
      .attr('font-size', GROUP_LABEL_SIZE)
      .attr('font-weight', 'bold')
      .attr('opacity', 0.7)
      .attr('pointer-events', 'none')
      .attr('class', 'group-label')
      .text(group.name);
  }

  // ── Section band geometry ────────────────────────────────
  // Computed here rather than beside the band render below, because the
  // lifelines are drawn first and have to be cut around each band's label.
  const bandLeftmostX = Math.min(...Array.from(participantX.values()));
  const bandRightmostX = Math.max(...Array.from(participantX.values()));
  const sectionLineX1 = bandLeftmostX - sBoxW / 2 - 10;
  const sectionLineX2 = bandRightmostX + sBoxW / 2 + 10;
  const sectionLabelX = (sectionLineX1 + sectionLineX2) / 2;

  const sectionLabelTextFor = (
    sec: import('./parser').SequenceSection
  ): string => {
    if (!isSectionCollapsed(sec)) return sec.label;
    const count = sectionMsgCounts.get(sec.lineNumber) ?? 0;
    return `${sec.label} (${count} ${count === 1 ? 'message' : 'messages'})`;
  };
  const sectionLabelBaselineFor = (
    sec: import('./parser').SequenceSection,
    secY: number
  ): number =>
    isSectionCollapsed(sec)
      ? secY + COLLAPSED_SECTION_LABEL_BASELINE
      : secY + 4;

  /**
   * The rectangle each section label occupies. Lifelines run behind the band
   * and the band is a tint rather than a fill, so a dashed line crosses the
   * label text and turns a name into something you decode. These boxes are cut
   * out of the lifelines below — actually suppressing the dashes rather than
   * painting over them, which would show as an opaque patch wherever the
   * diagram is rendered on no background at all.
   */
  const sectionLabelBoxes = sectionRegions
    .map((region) => {
      const secY = sectionYPositions.get(region.section.lineNumber);
      if (secY === undefined) return null;
      const width = measureText(sectionLabelTextFor(region.section), 11, {
        bold: true,
      });
      const baseline = sectionLabelBaselineFor(region.section, secY);
      return {
        x1: sectionLabelX - width / 2 - SECTION_LABEL_CLEARANCE_X,
        x2: sectionLabelX + width / 2 + SECTION_LABEL_CLEARANCE_X,
        y1: baseline - SECTION_LABEL_CLEARANCE_ABOVE,
        y2: baseline + SECTION_LABEL_CLEARANCE_BELOW,
      };
    })
    .filter((box): box is NonNullable<typeof box> => box !== null);

  /** A lifeline's runs of visible dashes, with each label box taken out. */
  const lifelineSegments = (
    cx: number,
    yTop: number,
    yBottom: number
  ): Array<[number, number]> => {
    const cuts = sectionLabelBoxes
      .filter((b) => cx >= b.x1 && cx <= b.x2 && b.y2 > yTop && b.y1 < yBottom)
      .sort((a, b) => a.y1 - b.y1);
    const segments: Array<[number, number]> = [];
    let y = yTop;
    for (const cut of cuts) {
      if (cut.y1 > y) segments.push([y, cut.y1]);
      y = Math.max(y, cut.y2);
    }
    if (y < yBottom) segments.push([y, yBottom]);
    return segments;
  };

  // Render each participant
  const lifelineStartY = lifelineStartY0;
  participants.forEach((participant) => {
    const cx = participantX.get(participant.id)!;
    const cy = participantStartY;

    const pTagValue = tagMap?.participants.get(participant.id);
    const pTagAttr =
      tagKey && pTagValue
        ? { key: tagKey, value: pTagValue.toLowerCase() }
        : undefined;
    const isCollapsedGroup = collapsedGroupNames.has(participant.id);
    // Falls back to the group's own metadata for a collapsed group.
    const effectiveTagColor = participantTagColor(participant.id);

    renderParticipant(
      svg,
      participant,
      cx,
      cy,
      palette,
      isDark,
      effectiveTagColor,
      pTagAttr,
      fillMode,
      sBoxW,
      sBoxH,
      sLabelTextWidth,
      sLabelFontSize
    );

    // Collapsed group: re-render participant box at full group height + drill-bar
    if (isCollapsedGroup) {
      const meta = collapsedGroupMeta.get(participant.id)!;
      const drillColor = effectiveTagColor || palette.textMuted;
      const drillBarH = 6;
      const boxW = sBoxW;
      // Match the group box dimensions
      const fullH = sBoxH + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM;
      const clipId = `clip-drill-group-${participant.id.replace(/[^a-zA-Z0-9-]/g, '-')}`;

      // Add toggle attributes to the participant <g> so any click on it
      // (overlay rect, label, drill-bar) walks up and triggers the toggle
      const participantG = svg.select<SVGGElement>(
        `.participant[data-participant-id="${participant.id}"]`
      );
      participantG
        .attr('data-group-toggle', '')
        .attr('data-group-line', String(meta.lineNumber))
        .attr('tabindex', '0')
        .attr('role', 'button')
        .attr('aria-expanded', 'false')
        .attr('cursor', 'pointer');
      participantG.append('title').text('Click to expand');

      // Overlay a taller rect to replace the standard participant box
      const pFill = effectiveTagColor
        ? mix(effectiveTagColor, themeBaseBg(palette, isDark), isDark ? 30 : 40)
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
        .attr('font-size', ctx.text(13))
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

    // Render lifeline — collapsed groups start below the taller box; actors
    // carry their label *below* the stick figure (at boxH + 14), so their
    // lifeline must start below that label or the dashes run through the text.
    const llY = isCollapsedGroup
      ? lifelineStartY + GROUP_PADDING_BOTTOM
      : participant.type === 'actor'
        ? lifelineStartY + ACTOR_LABEL_CLEARANCE
        : lifelineStartY;
    const llColor = effectiveTagColor || palette.textMuted;
    // One line per run of dashes: a lifeline crossing a section label is cut
    // around it, so the label reads. Every segment carries the same class and
    // attributes, so anything selecting `.lifeline` still finds this
    // participant's, and the topmost segment still reports the true start.
    for (const [segTop, segBottom] of lifelineSegments(
      cx,
      llY,
      lifelineStartY + lifelineLength
    )) {
      const lifelineEl = svg
        .append('line')
        .attr('x1', cx)
        .attr('y1', segTop)
        .attr('x2', cx)
        .attr('y2', segBottom)
        .attr('stroke', llColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '6 4')
        .attr('class', 'lifeline')
        .attr('data-participant-id', participant.id);
      if (tagKey && pTagValue) {
        lifelineEl.attr(`data-tag-${tagKey}`, pTagValue.toLowerCase());
      }
    }
  });

  // Render block frames (behind everything else)
  const FRAME_PADDING_X = 30;
  // FRAME_PADDING_TOP declared earlier (near BLOCK_HEADER_SPACE)
  const FRAME_PADDING_BOTTOM = 15;
  const FRAME_LABEL_HEIGHT = 18;
  // Self-loop projects ACTIVATION_WIDTH/2 + SELF_CALL_WIDTH (=35) past the
  // lifeline; FRAME_PADDING_X (=30) leaves no breathing room. When a block
  // contains a self-arrow, extend the frame on the loop's side so the loop
  // sits comfortably inside.
  const SELF_ARROW_PROJECTION = sActivationWidth / 2 + sSelfCallWidth;
  const SELF_ARROW_FRAME_PAD = 10;

  // Collect message indices from an element subtree
  const collectMsgIndices = (els: readonly SequenceElement[]): number[] => {
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
        // Narrowed to SequenceMessage by the discriminator (kind === 'message')
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
    blockLine?: number;
  }> = [];

  // Recursive block renderer — draws borders/dividers now, defers label text
  const renderBlockFrames = (
    els: readonly SequenceElement[],
    depth: number
  ): void => {
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
        // In-bounds: allIndices is built from valid message indices via
        // collectMsgIndices (only pushes `idx >= 0` from messages.indexOf).
        const m = messages[mi]!;
        involved.add(m.from);
        involved.add(m.to);
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

      // Self-arrow geometry: extend frame on the loop's side so loops sit
      // comfortably inside, and extend vertically if the block's last step
      // is a self-call (whose loop drops SELF_CALL_HEIGHT below stepY).
      let extraRight = 0;
      let maxStepIsSelfCall = false;
      for (const mi of allIndices) {
        // In-bounds: same guarantee as above (allIndices built from valid indices).
        const m = messages[mi]!;
        if (m.from === m.to) {
          const px = participantX.get(m.from);
          if (px !== undefined) {
            const loopMax = px + SELF_ARROW_PROJECTION;
            const need =
              loopMax - (maxPX + FRAME_PADDING_X) + SELF_ARROW_FRAME_PAD;
            if (need > 0) extraRight = Math.max(extraRight, need);
          }
          if (msgToLastStep.get(mi) === maxStep) {
            maxStepIsSelfCall = true;
          }
        }
      }

      const frameX = minPX - FRAME_PADDING_X;
      const frameY = stepY(minStep) - FRAME_PADDING_TOP;
      const frameW = maxPX - minPX + FRAME_PADDING_X * 2 + extraRight;
      const frameH =
        stepY(maxStep) -
        stepY(minStep) +
        FRAME_PADDING_TOP +
        FRAME_PADDING_BOTTOM +
        (maxStepIsSelfCall ? sSelfCallHeight : 0);

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
        bold: false,
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
            const dividerY = stepY(firstBranchStep) - BLOCK_HEADER_SPACE;
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
              italic: false,
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
          const dividerY = stepY(firstElseStep) - BLOCK_HEADER_SPACE;
          deferredLines.push({
            x1: frameX,
            y1: dividerY,
            x2: frameX + frameW,
            y2: dividerY,
            ...(el.elseLineNumber !== undefined && {
              blockLine: el.elseLineNumber,
            }),
          });
          deferredLabels.push({
            x: frameX + 6,
            y: dividerY + 14,
            text: 'else',
            bold: false,
            italic: false,
            ...(el.elseLineNumber !== undefined && {
              blockLine: el.elseLineNumber,
            }),
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
  const ACTIVATION_NEST_OFFSET = ctx.structural(6);
  activations.forEach((act) => {
    const px = participantX.get(act.participantId);
    if (px === undefined) return;

    const x = px - sActivationWidth / 2 + act.depth * ACTIVATION_NEST_OFFSET;
    const y1 = stepY(act.startStep);
    const y2 = stepY(act.endStep);

    // Collect message line numbers covered by this activation
    const coveredLines: number[] = [];
    for (let si = act.startStep; si <= act.endStep; si++) {
      const step = renderSteps[si];
      if (!step) continue;
      const msg = messages[step.messageIndex];
      if (msg) coveredLines.push(msg.lineNumber);
    }

    // Determine activation color from triggering message's tag
    const triggerStep = renderSteps[act.startStep];
    const triggerMsg =
      triggerStep !== undefined
        ? messages[triggerStep.messageIndex]
        : undefined;
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
      .attr('width', sActivationWidth)
      .attr('height', y2 - y1)
      .attr('fill', themeBaseBg(palette, isDark));

    // Canonical 25% tint via shapeFill() (or full intent when solid-fill is on).
    const actFill = shapeFill(palette, actBaseColor, isDark, {
      mode: fillMode,
    });
    const actRect = svg
      .append('rect')
      .attr('x', x)
      .attr('y', y1)
      .attr('width', sActivationWidth)
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
      ? px + sActivationWidth / 2 + offset
      : px - sActivationWidth / 2 + offset;
  };

  // Render section dividers — geometry hoisted above the lifelines, which are
  // drawn first and cut around each label.
  for (const region of sectionRegions) {
    const sec = region.section;
    const secY = sectionYPositions.get(sec.lineNumber);
    if (secY === undefined) continue;

    const isCollapsed = isSectionCollapsed(sec);
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

    // Full-width tinted band — taller when collapsed, to carry the mark row
    const BAND_HEIGHT = isCollapsed
      ? COLLAPSED_SECTION_BAND_HEIGHT
      : SECTION_BAND_HEIGHT;
    const bandX = sectionLineX1 - 10;
    const bandWidth = sectionLineX2 - sectionLineX1 + 20;
    // A collapsed band is a container holding something you cannot see, which
    // is the same thing the legend's capsule is — so it wears the legend's own
    // background rather than a heavier tint of its own. An expanded band stays
    // a faint tint, because it divides rather than contains.
    const bandFill = isCollapsed
      ? legendChromeColors(palette, isDark).groupBg
      : lineColor;
    const bandOpacity = isCollapsed ? 1 : isDark ? 0.1 : 0.08;
    // Visual band — pointer-events:none so it never intercepts clicks
    // intended for elements rendered earlier (participants, lifelines, etc.).
    // Toggle hit area is the label rect below.
    sectionG
      .append('rect')
      .attr('x', bandX)
      .attr('y', secY - BAND_HEIGHT / 2)
      .attr('width', bandWidth)
      .attr('height', BAND_HEIGHT)
      .attr('fill', bandFill)
      .attr('opacity', bandOpacity)
      .attr('rx', 2)
      .attr('pointer-events', 'none')
      .attr('class', 'section-divider');

    // Build display label. Centred in both states — the lifelines are cut
    // around it (see sectionLabelBoxes) rather than the label moving aside,
    // and on a collapsed band the marks have their own row below it.
    const labelText = sectionLabelTextFor(sec);
    const labelWidth = measureText(labelText, 11, { bold: true });
    const labelX = sectionLabelX;
    const labelBaseline = sectionLabelBaselineFor(sec, secY);

    // Transparent hit area scoped to the label so the toggle stays clickable
    // without the band swallowing clicks across the full diagram width.
    // Label renders at the fixed 11px section-label size.
    // The section label is drawn bold just below.
    const labelHitW = Math.max(80, labelWidth + 24);
    sectionG
      .append('rect')
      .attr('x', labelX - labelHitW / 2)
      .attr('y', secY - BAND_HEIGHT / 2)
      .attr('width', labelHitW)
      .attr('height', BAND_HEIGHT)
      .attr('fill', 'transparent')
      .attr('class', 'section-label-hit');

    sectionG
      .append('text')
      .attr('x', labelX)
      .attr('y', labelBaseline)
      .attr('text-anchor', 'middle')
      .attr('fill', lineColor)
      .attr('font-size', 11)
      .attr('font-weight', 'bold')
      .attr('class', 'section-label')
      .text(labelText);

    if (!isCollapsed) continue;

    // ── Participant marks ────────────────────────────────────
    // The count above says how much the fold swallowed; these say who was in
    // it. Without them the lifelines run through the band untouched, which
    // reads as "nobody was involved" rather than "you cannot see this yet".
    const participation = summarizeSectionParticipation(
      messages,
      region.msgIndices
    );
    const markY = secY + COLLAPSED_SECTION_MARK_OFFSET;

    // Reach: a hairline between the outermost columns the fold touches, so
    // the span of the hidden traffic reads before any individual mark does.
    const involvedXs = participants
      .filter((p) => participation.has(p.id))
      .map((p) => participantX.get(p.id))
      .filter((x): x is number => x !== undefined);
    if (involvedXs.length > 1) {
      sectionG
        .append('line')
        .attr('x1', Math.min(...involvedXs))
        .attr('x2', Math.max(...involvedXs))
        .attr('y1', markY)
        .attr('y2', markY)
        .attr('stroke', lineColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '2 3')
        .attr('opacity', 0.5)
        .attr('pointer-events', 'none')
        .attr('class', 'section-reach');
    }

    for (const participant of participants) {
      const markX = participantX.get(participant.id);
      if (markX === undefined) continue;
      const part = participation.get(participant.id);
      const mark = sectionG
        .append('circle')
        .attr('cx', markX)
        .attr('cy', markY)
        .attr('pointer-events', 'none')
        .attr('data-participant-id', participant.id);

      if (!part) {
        // Drawn rather than omitted: an empty column is ambiguous between
        // "not in this phase" and "you missed it".
        mark
          .attr('r', 2.5)
          .attr('fill', 'none')
          .attr('stroke', lineColor)
          .attr('stroke-width', 1)
          .attr('opacity', 0.5)
          .attr('class', 'section-mark section-mark-absent');
        continue;
      }

      const markColor = participantTagColor(participant.id) ?? palette.text;
      const radius = sectionMarkRadius(part.sends + part.receives);
      if (part.sends === 0) {
        // Hollow against the band itself, so it reads as an outline rather
        // than as a hole punched through to the page behind.
        mark
          .attr('r', radius)
          .attr('fill', bandFill)
          .attr('stroke', markColor)
          .attr('stroke-width', 1.6)
          .attr('class', 'section-mark section-mark-receives');
      } else {
        mark
          .attr('r', radius)
          .attr('fill', markColor)
          .attr('class', 'section-mark section-mark-sends');
      }
    }

    // The band is a button, and its text names only the phase and a count.
    // Spelling the participants into the accessible name hands a screen
    // reader the whole answer without any of the marks above.
    const involvedLabels = participants
      .filter((p) => participation.has(p.id))
      .map((p) => p.label);
    if (involvedLabels.length > 0) {
      sectionG.attr('aria-label', `${labelText}, ${involvedLabels.join(', ')}`);
    }
  }

  // Render steps (calls and returns in stack-inferred order)
  // Self-call rendering uses scaled constants
  renderSteps.forEach((step, i) => {
    const fromX = participantX.get(step.from);
    const toX = participantX.get(step.to);
    if (fromX === undefined || toX === undefined) return;

    const y = stepY(i);

    const HIT_H = 20; // transparent hit area height (10px above + below arrow)

    // Resolve tag color for this message
    // In-bounds: step.messageIndex is built from a valid messages[] index by
    // buildRenderSequence/computeActivations (no synthetic step indices exist).
    const msg = messages[step.messageIndex]!;
    const msgTagValue = msg ? tagMap?.messages.get(msg.lineNumber) : undefined;
    const msgTagColor = getTagColor(msgTagValue);

    if (step.type === 'call') {
      const arrowColor = msgTagColor || palette.text;

      if (step.from === step.to) {
        // Self-call: loopback arrow — always loops to the right.
        // Canvas width extends to accommodate via right-edge projection.
        const x = arrowEdgeX(step.from, i, 'right');
        const loopX = x + sSelfCallWidth;
        const hitX = x;

        // Hit area for self-call
        svg
          .append('rect')
          .attr('x', hitX)
          .attr('y', y - 5)
          .attr('width', sSelfCallWidth)
          .attr('height', sSelfCallHeight + 10)
          .attr('fill', 'transparent')
          .attr('class', 'message-hit-area')
          .attr('data-line-number', String(msg.lineNumber))
          .attr('data-msg-index', String(step.messageIndex))
          .attr('data-step-index', String(i));

        const selfCallEl = svg
          .append('path')
          .attr('d', `M ${x} ${y} H ${loopX} V ${y + sSelfCallHeight} H ${x}`)
          .attr('fill', 'none')
          .attr('stroke', arrowColor)
          .attr('stroke-width', 1.2)
          .attr('marker-end', coloredMarker('call', msgTagColor))
          .attr('class', 'message-arrow self-call')
          .attr('data-line-number', String(msg.lineNumber))
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
            .attr('x', loopX + 5)
            .attr('y', y + sSelfCallHeight / 2 + 4)
            .attr('text-anchor', 'start')
            .attr('fill', arrowColor)
            .attr('paint-order', 'stroke fill')
            .attr('stroke', palette.bg)
            .attr('stroke-width', 4)
            .attr('stroke-linejoin', 'round')
            .attr('font-size', 12)
            .attr('class', 'message-label')
            .attr('data-line-number', String(msg.lineNumber))
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
          .attr('data-line-number', String(msg.lineNumber))
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
          .attr('data-line-number', String(msg.lineNumber))
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
            .attr('paint-order', 'stroke fill')
            .attr('stroke', palette.bg)
            .attr('stroke-width', 4)
            .attr('stroke-linejoin', 'round')
            .attr('font-size', 12)
            .attr('class', 'message-label')
            .attr('data-line-number', String(msg.lineNumber))
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
        .attr('data-line-number', String(msg.lineNumber))
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
        .attr('data-line-number', String(msg.lineNumber))
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
          .attr('paint-order', 'stroke fill')
          .attr('stroke', palette.bg)
          .attr('stroke-width', 4)
          .attr('stroke-linejoin', 'round')
          .attr('font-size', 11)
          .attr('class', 'message-label')
          .attr('data-line-number', String(msg.lineNumber))
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

  const renderNoteElements = (els: readonly SequenceElement[]): void => {
    for (const el of els) {
      if (isSequenceNote(el)) {
        const px = participantX.get(el.participantId);
        if (px === undefined) continue;
        const noteTopY = noteYMap.get(el);
        if (noteTopY === undefined) continue;

        const position = effectiveNotePosition(el);
        const isRight = position === 'right';
        const afterSelfCall = isNoteAfterSelfCall(el);
        const maxW = noteEffectiveMaxW(
          el.participantId,
          position,
          afterSelfCall
        );
        const textWidth = noteTextWidth(maxW);
        const wrappedLines = wrapTextLines(el.text, textWidth, sNoteFontSize);
        const noteH = wrappedLines.length * sNoteLineH + sNotePadV * 2;
        const maxLineW = Math.max(
          ...wrappedLines.map((l) => measureText(l.text, sNoteFontSize))
        );
        const noteW = Math.min(
          maxW,
          Math.max(80, maxLineW + sNotePadH * 2 + sNoteFold)
        );
        // Shift notes past self-call loopback when applicable
        const rightOffset =
          afterSelfCall && isRight
            ? sActivationWidth / 2 + sSelfCallWidth + sNoteGap
            : sActivationWidth + sNoteGap;
        const noteX = isRight
          ? px + rightOffset
          : px - sActivationWidth - sNoteGap - noteW;

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
              `L ${noteX + noteW - sNoteFold} ${noteTopY}`,
              `L ${noteX + noteW} ${noteTopY + sNoteFold}`,
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
              `M ${noteX + noteW - sNoteFold} ${noteTopY}`,
              `L ${noteX + noteW - sNoteFold} ${noteTopY + sNoteFold}`,
              `L ${noteX + noteW} ${noteTopY + sNoteFold}`,
            ].join(' ')
          )
          .attr('fill', 'none')
          .attr('stroke', palette.textMuted)
          .attr('stroke-width', 0.75)
          .attr('class', 'note-fold');

        // Render text with inline markdown. Bullet first lines get a "\u2022"
        // glyph at the left edge with body text indented; bullet continuation
        // lines render at the same indented body column for hanging alignment.
        const BULLET_BODY_INDENT = 10;
        wrappedLines.forEach((line, li) => {
          const textY = noteTopY + sNotePadV + (li + 1) * sNoteLineH - 3;
          const indent = line.kind === 'plain' ? 0 : BULLET_BODY_INDENT;
          if (line.kind === 'bullet-first') {
            noteG
              .append('text')
              .attr('x', noteX + sNotePadH)
              .attr('y', textY)
              .attr('fill', palette.text)
              .attr('font-size', sNoteFontSize)
              .text('\u2022');
          }
          const textEl = noteG
            .append('text')
            .attr('x', noteX + sNotePadH + indent)
            .attr('y', textY)
            .attr('fill', palette.text)
            .attr('font-size', sNoteFontSize)
            .attr('class', 'note-text');
          renderInlineText(textEl, line.text, palette, sNoteFontSize);
        });
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

  // Render legend LAST so it sits on top of all other SVG elements
  // (group boxes, lifelines, participants, etc.) and can receive clicks.
  if (hasTagGroups) {
    const legendY = sTopMargin + titleOffset;
    const legendCallbacks: LegendCallbacks = {};

    const legendG = svg
      .append('g')
      .attr('class', 'sequence-legend')
      .attr(
        'transform',
        header.inline
          ? `translate(${header.legendX}, ${header.legendY})`
          : `translate(0,${legendY})`
      );
    renderIntegratedLegend(legendG, {
      ...legendConfig,
      // Inline → left-origin so the wrapper's right-flush translate lands the
      // legend at the header's right edge; stacked → centered below the title
      // (identical to legendConfig.position, so the stacked path is unchanged).
      position: {
        placement: 'top-center',
        titleRelation: header.inline ? 'inline-with-title' : 'below-title',
      },
      palette,
      isDark,
      width: svgWidth,
      activeGroup: activeTagGroup ?? null,
      controlsExpanded: false,
      callbacks: legendCallbacks,
    });
  }
}

/**
 * Build a mapping from each note's lineNumber to the lineNumber of its
 * associated message (the last message before the note in document order).
 * Used by the app to highlight the associated message when cursor is on a note.
 */
export function buildNoteMessageMap(
  elements: readonly SequenceElement[]
): Map<number, number> {
  const map = new Map<number, number>();
  let lastMessageLine = -1;

  const walk = (els: readonly SequenceElement[]): void => {
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
        // Narrowed to SequenceMessage by the discriminator (kind === 'message')
        lastMessageLine = el.lineNumber;
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
  tagAttr?: { key: string; value: string },
  fillMode?: 'solid' | 'outline',
  boxW: number = W,
  boxH: number = H,
  labelTextW: number = labelTextWidth(W),
  labelFontSize: number = LABEL_FONT_SIZE
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
      renderActorParticipant(g, palette, color, boxH);
      break;
    case 'database':
      renderDatabaseParticipant(
        g,
        palette,
        isDark,
        color,
        fillMode,
        boxW,
        boxH
      );
      break;
    case 'queue':
      renderQueueParticipant(g, palette, isDark, color, fillMode, boxW, boxH);
      break;
    case 'cache':
      renderCacheParticipant(g, palette, isDark, color, fillMode, boxW, boxH);
      break;
    default:
      renderRectParticipant(g, palette, isDark, color, fillMode, boxW, boxH);
      break;
  }

  // Render label — below the shape for actors, centered inside for others
  const isActor = participant.type === 'actor';
  const labelLines = splitParticipantLabel(
    participant.label,
    labelTextW,
    labelFontSize
  );
  const fontSize = labelFontSize;
  const lineHeight = fontSize + 2;
  const labelFill = isActor
    ? palette.text
    : contrastText(
        fill(palette, isDark, color, fillMode),
        palette.textOnFillLight,
        palette.textOnFillDark
      );
  const textEl = g
    .append('text')
    .attr('x', 0)
    .attr('text-anchor', 'middle')
    .attr('fill', labelFill)
    .attr('font-size', fontSize)
    .attr('font-weight', 500);

  const maxLabelW = labelTextWidth(boxW);
  const truncLine = (text: string): string =>
    truncateText(text, fontSize, maxLabelW);

  if (labelLines.length === 1) {
    textEl
      .attr('y', isActor ? boxH + 14 : boxH / 2 + 5)
      .text(truncLine(participant.label));
  } else {
    const totalHeight = labelLines.length * lineHeight;
    const baseY = isActor
      ? boxH + 14 - ((labelLines.length - 1) * lineHeight) / 2
      : boxH / 2 + 5 - (totalHeight - lineHeight) / 2;

    labelLines.forEach((line, i) => {
      textEl
        .append('tspan')
        .attr('x', 0)
        .attr('dy', i === 0 ? `${baseY}px` : `${lineHeight}px`)
        .text(truncLine(line));
    });
  }
}
