// ============================================================
// Sequence Diagram Parser (.dgmo format)
// ============================================================

import { inferParticipantType } from './participant-inference';
import type { DgmoError } from '../diagnostics';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import { parseArrow } from '../utils/arrows';
import { measureIndent, extractColor, parsePipeMetadata } from '../utils/parsing';
import type { TagGroup } from '../utils/tag-groups';
import { matchTagBlockHeading, validateTagValues } from '../utils/tag-groups';

/**
 * Participant types that can be declared via "Name is a type" syntax.
 */
export type ParticipantType =
  | 'default'
  | 'service'
  | 'database'
  | 'actor'
  | 'queue'
  | 'cache'
  | 'gateway'
  | 'external'
  | 'networking'
  | 'frontend';

const VALID_PARTICIPANT_TYPES: ReadonlySet<string> = new Set([
  'service',
  'database',
  'actor',
  'queue',
  'cache',
  'gateway',
  'external',
  'networking',
  'frontend',
]);

/**
 * A declared or inferred participant in the sequence diagram.
 */
export interface SequenceParticipant {
  /** Internal identifier (e.g. "AuthService") */
  id: string;
  /** Display label — uses aka alias if provided, otherwise id */
  label: string;
  /** Participant shape type */
  type: ParticipantType;
  /** Source line number (1-based) */
  lineNumber: number;
  /** Explicit layout position override (0-based from left, negative from right) */
  position?: number;
  /** Pipe-delimited tag metadata (e.g. `| role: Gateway`) */
  metadata?: Record<string, string>;
}

/**
 * A message between two participants.
 */
export interface SequenceMessage {
  from: string;
  to: string;
  label: string;
  lineNumber: number;
  async?: boolean;
  /** Pipe-delimited tag metadata (e.g. `| c: Caching`) */
  metadata?: Record<string, string>;
}

/**
 * A conditional or loop block in the sequence diagram.
 */
export interface ElseIfBranch {
  label: string;
  children: SequenceElement[];
}

export interface SequenceBlock {
  kind: 'block';
  type: 'if' | 'loop' | 'parallel';
  label: string;
  children: SequenceElement[];
  elseChildren: SequenceElement[];
  elseIfBranches?: ElseIfBranch[];
  lineNumber: number;
}

/**
 * A labeled horizontal divider between message phases.
 */
export interface SequenceSection {
  kind: 'section';
  label: string;
  lineNumber: number;
}

/**
 * An annotation attached to a message, rendered as a folded-corner box.
 */
export interface SequenceNote {
  kind: 'note';
  text: string;
  position: 'right' | 'left';
  participantId: string;
  lineNumber: number;
  endLineNumber: number;
}

export type SequenceElement =
  | SequenceMessage
  | SequenceBlock
  | SequenceSection
  | SequenceNote;

export function isSequenceBlock(el: SequenceElement): el is SequenceBlock {
  return 'kind' in el && (el as SequenceBlock).kind === 'block';
}

export function isSequenceSection(el: SequenceElement): el is SequenceSection {
  return 'kind' in el && (el as SequenceSection).kind === 'section';
}

export function isSequenceNote(el: SequenceElement): el is SequenceNote {
  return 'kind' in el && (el as SequenceNote).kind === 'note';
}

/**
 * A named group of participants rendered as a labeled box.
 */
export interface SequenceGroup {
  name: string;
  participantIds: string[];
  lineNumber: number;
  /** Pipe-delimited tag metadata (e.g. `[Backend | t: Product]`) */
  metadata?: Record<string, string>;
}

/**
 * Parsed result from a .dgmo sequence diagram.
 */
export interface ParsedSequenceDgmo {
  title: string | null;
  titleLineNumber: number | null;
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
  elements: SequenceElement[];
  groups: SequenceGroup[];
  sections: SequenceSection[];
  tagGroups: TagGroup[];
  options: Record<string, string>;
  diagnostics: DgmoError[];
  error: string | null;
}

// "Name is a type" pattern — e.g. "Auth Server is a service"
// Participant names may contain spaces; [^:]+? stops at colons so that
// note lines like "note right of A: this is a service" are not falsely matched.
// Remainder after type is parsed separately for aka/position modifiers
const IS_A_PATTERN = /^([^:]+?)\s+is\s+an?\s+(\w+)(?:\s+(.+))?$/i;

// Standalone "Name position N" pattern — e.g. "DB position -1"
const POSITION_ONLY_PATTERN = /^([^:]+?)\s+position\s+(-?\d+)$/i;

// Colored participant declaration — e.g. "Tapin2(green)", "API(blue)"
const COLORED_PARTICIPANT_PATTERN = /^(\S+?)\(([^)]+)\)\s*$/;

// Group heading pattern — "[Backend]", "[API Services(blue)]", "[Backend(#hex)]"
const GROUP_HEADING_PATTERN = /^\[(.+?)(?:\(([^)]+)\))?\]\s*$/;
// Legacy ## syntax — detect and emit migration error
const LEGACY_GROUP_PATTERN = /^##\s+(.+?)(?:\(([^)]+)\))?\s*$/;

// Section divider pattern — "== Label ==", "== Label(color) ==", or "== Label" (trailing == optional)
const SECTION_PATTERN = /^==\s+(.+?)(?:\s*==)?\s*$/;

// Arrow pattern for sequence inference — detects any arrow form
const ARROW_PATTERN = /\S+\s*(?:<-\S+-|<~\S+~|-\S+->|~\S+~>|->|~>|<-|<~)\s*\S+/;

// Note patterns — "note: text", "note right of Auth Server: text"
// Participant names may contain spaces; the colon acts as the delimiter.
const NOTE_SINGLE = /^note(?:\s+(right|left)\s+of\s+(.+?))?\s*:\s*(.+)$/i;
const NOTE_MULTI = /^note(?:\s+(right|left)\s+of\s+(.+?))?\s*:?\s*$/i;

/**
 * Parse a .dgmo file with `chart: sequence` into a structured representation.
 */
export function parseSequenceDgmo(content: string): ParsedSequenceDgmo {
  const result: ParsedSequenceDgmo = {
    title: null,
    titleLineNumber: null,
    participants: [],
    messages: [],
    elements: [],
    groups: [],
    sections: [],
    tagGroups: [],
    options: {},
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedSequenceDgmo => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  /** Push a recoverable error and continue parsing. */
  const pushError = (line: number, message: string): void => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    if (!result.error) result.error = formatDgmoError(diag);
  };

  /** Push a non-fatal warning (does not set result.error). */
  const pushWarning = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  if (!content || !content.trim()) {
    return fail(0, 'Empty content');
  }

  const lines = content.split('\n');
  let hasExplicitChart = false;
  let contentStarted = false;

  // Group parsing state — tracks the active [Group] heading
  let activeGroup: SequenceGroup | null = null;

  // Track participant → group name for duplicate membership detection
  const participantGroupMap = new Map<string, string>();

  // Tag group parsing state
  let currentTagGroup: TagGroup | null = null;
  const aliasMap = new Map<string, string>();

  /** Split pipe metadata from a line: "core | k: v" → { core, meta } */
  const splitPipe = (text: string): { core: string; meta?: Record<string, string> } => {
    const idx = text.indexOf('|');
    if (idx < 0) return { core: text };
    const core = text.substring(0, idx).trimEnd();
    const segments = text.substring(idx).split('|');
    const meta = parsePipeMetadata(segments, aliasMap);
    return Object.keys(meta).length > 0 ? { core, meta } : { core };
  };

  // Block parsing state
  const blockStack: {
    block: SequenceBlock;
    indent: number;
    inElse: boolean;
    activeElseIfBranch?: ElseIfBranch;
  }[] = [];
  const currentContainer = (): SequenceElement[] => {
    if (blockStack.length === 0) return result.elements;
    const top = blockStack[blockStack.length - 1];
    if (top.activeElseIfBranch) return top.activeElseIfBranch.children;
    return top.inElse ? top.block.elseChildren : top.block.children;
  };

  // Track last message sender for default note positioning
  let lastMsgFrom: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const lineNumber = i + 1;

    // Skip empty lines
    if (!trimmed) {
      activeGroup = null;
      currentTagGroup = null;
      continue;
    }

    // Parse group heading — [Group Name] or [Group Name(color)] or [Group | k: v]
    const groupMatch = trimmed.match(GROUP_HEADING_PATTERN);
    if (groupMatch) {
      let groupName = groupMatch[1].trim();
      let groupColor = groupMatch[2]?.trim();
      let groupMeta: Record<string, string> | undefined;

      // Check for pipe metadata inside brackets
      const gpipeIdx = groupName.indexOf('|');
      if (gpipeIdx >= 0) {
        const nameAndColor = groupName.substring(0, gpipeIdx).trimEnd();
        const segments = groupName.substring(gpipeIdx).split('|');
        const meta = parsePipeMetadata(segments, aliasMap);
        if (Object.keys(meta).length > 0) groupMeta = meta;
        // Re-extract color from name part
        const colorSuffix = nameAndColor.match(/^(.+?)\(([^)]+)\)$/);
        if (colorSuffix) {
          groupName = colorSuffix[1].trim();
          groupColor = colorSuffix[2].trim();
        } else {
          groupName = nameAndColor;
        }
      }

      if (groupColor) {
        pushWarning(lineNumber, `(${groupColor}) color syntax removed from sequence diagrams — use 'tag:' groups for coloring`);
      }
      contentStarted = true;
      activeGroup = {
        name: groupName,
        participantIds: [],
        lineNumber,
        ...(groupMeta ? { metadata: groupMeta } : {}),
      };
      result.groups.push(activeGroup);
      continue;
    }

    // Reject legacy ## group syntax with migration hint
    if (trimmed.match(LEGACY_GROUP_PATTERN)) {
      const legacyMatch = trimmed.match(LEGACY_GROUP_PATTERN)!;
      const name = legacyMatch[1].trim();
      const color = legacyMatch[2]?.trim();
      const suggestion = color ? `[${name}(${color})]` : `[${name}]`;
      pushError(lineNumber, `'## ${name}' group syntax is no longer supported. Use '${suggestion}' instead`);
      continue;
    }

    // Close active group on non-indented, non-group lines
    if (activeGroup && measureIndent(raw) === 0) {
      activeGroup = null;
    }

    // Skip comments — only // is supported
    if (trimmed.startsWith('//')) continue;

    // Reject # as comment syntax
    if (trimmed.startsWith('#')) {
      pushError(lineNumber, 'Use // for comments');
      continue;
    }

    // ---- Tag group handling ----
    // Tag block heading: "tag: Name [alias X]"
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch && !tagBlockMatch.deprecated) {
      if (contentStarted) {
        pushError(lineNumber, 'Tag groups must appear before sequence content');
        continue;
      }
      currentTagGroup = {
        name: tagBlockMatch.name,
        alias: tagBlockMatch.alias,
        entries: [],
        lineNumber,
      };
      if (tagBlockMatch.alias) {
        aliasMap.set(tagBlockMatch.alias.toLowerCase(), tagBlockMatch.name.toLowerCase());
      }
      result.tagGroups.push(currentTagGroup);
      continue;
    }

    // Tag group entries (indented Value(color) [default] under tag: heading)
    if (currentTagGroup && !contentStarted && measureIndent(raw) > 0) {
      const isDefault = /\bdefault\s*$/.test(trimmed);
      const entryText = isDefault
        ? trimmed.replace(/\s+default\s*$/, '').trim()
        : trimmed;
      const { label, color } = extractColor(entryText);
      if (!color) {
        pushError(lineNumber, `Expected 'Value(color)' in tag group '${currentTagGroup.name}'`);
        continue;
      }
      if (isDefault) {
        currentTagGroup.defaultValue = label;
      }
      currentTagGroup.entries.push({ value: label, color, lineNumber });
      continue;
    }

    // Non-indented line after tag group — close it
    if (currentTagGroup) {
      currentTagGroup = null;
    }

    // Parse section dividers — "== Label ==" or "== Label(color) =="
    // Close blocks first — sections at indent 0 should not nest inside blocks
    const sectionMatch = trimmed.match(SECTION_PATTERN);
    if (sectionMatch) {
      const sectionIndent = measureIndent(raw);
      while (blockStack.length > 0) {
        const top = blockStack[blockStack.length - 1];
        if (sectionIndent > top.indent) break;
        blockStack.pop();
      }
      const labelRaw = sectionMatch[1].trim();
      const colorMatch = labelRaw.match(/^(.+?)\(([^)]+)\)$/);
      if (colorMatch) {
        pushWarning(lineNumber, `(${colorMatch[2].trim()}) color syntax removed from sequence diagrams — use 'tag:' groups for coloring`);
      }
      contentStarted = true;
      const section: SequenceSection = {
        kind: 'section',
        label: colorMatch ? colorMatch[1].trim() : labelRaw,
        lineNumber,
      };
      result.sections.push(section);
      currentContainer().push(section);
      continue;
    }

    // Parse header key: value lines (always top-level)
    // Skip 'note' lines — parsed in the indent-aware section below
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0 && !trimmed.includes('->') && !trimmed.includes('~>') && !trimmed.includes('<-') && !trimmed.includes('<~') && !trimmed.includes('|')) {
      const key = trimmed.substring(0, colonIndex).trim().toLowerCase();
      if (key === 'note' || key.startsWith('note ')) {
        // Fall through to indent-aware note parsing below
      } else {
      const value = trimmed.substring(colonIndex + 1).trim();

      if (key === 'chart') {
        hasExplicitChart = true;
        if (value.toLowerCase() !== 'sequence') {
          return fail(lineNumber, `Expected chart type "sequence", got "${value}"`);
        }
        continue;
      }

      // Enforce headers-before-content
      if (contentStarted) {
        pushError(lineNumber, `Options like '${key}: ${value}' must appear before the first message or declaration`);
        continue;
      }

      if (key === 'title') {
        result.title = value;
        result.titleLineNumber = lineNumber;
        continue;
      }

      // Store other options
      result.options[key] = value;
      continue;
      }
    }

    // Parse "Name is a type [aka Alias]" declarations (always top-level)
    const { core: isACore, meta: isAMeta } = splitPipe(trimmed);
    const isAMatch = isACore.match(IS_A_PATTERN);
    if (isAMatch) {
      contentStarted = true;
      const id = isAMatch[1];
      const typeStr = isAMatch[2].toLowerCase();
      const remainder = isAMatch[3]?.trim() || '';

      const participantType: ParticipantType = VALID_PARTICIPANT_TYPES.has(
        typeStr
      )
        ? (typeStr as ParticipantType)
        : 'default';

      // Parse modifiers from remainder: aka ALIAS, position N
      const akaMatch = remainder.match(
        /\baka\s+(.+?)(?:\s+position\s+-?\d+\s*$|$)/i
      );
      const posMatch = remainder.match(/\bposition\s+(-?\d+)/i);
      const alias = akaMatch ? akaMatch[1].trim() : null;
      const position = posMatch ? parseInt(posMatch[1], 10) : undefined;

      // Avoid duplicate participant declarations
      if (!result.participants.some((p) => p.id === id)) {
        result.participants.push({
          id,
          label: alias || id,
          type: participantType,
          lineNumber,
          ...(position !== undefined ? { position } : {}),
          ...(isAMeta ? { metadata: isAMeta } : {}),
        });
      }
      // Track group membership
      if (activeGroup && !activeGroup.participantIds.includes(id)) {
        const existingGroup = participantGroupMap.get(id);
        if (existingGroup) {
          pushError(lineNumber, `Participant '${id}' is already in group '${existingGroup}' — participants can only belong to one group`);
        } else {
          activeGroup.participantIds.push(id);
          participantGroupMap.set(id, activeGroup.name);
        }
      }
      continue;
    }

    // Parse standalone "Name position N" (no "is a" type)
    const { core: posCore, meta: posMeta } = splitPipe(trimmed);
    const posOnlyMatch = posCore.match(POSITION_ONLY_PATTERN);
    if (posOnlyMatch) {
      contentStarted = true;
      const id = posOnlyMatch[1];
      const position = parseInt(posOnlyMatch[2], 10);

      if (!result.participants.some((p) => p.id === id)) {
        result.participants.push({
          id,
          label: id,
          type: inferParticipantType(id),
          lineNumber,
          position,
          ...(posMeta ? { metadata: posMeta } : {}),
        });
      }
      // Track group membership
      if (activeGroup && !activeGroup.participantIds.includes(id)) {
        const existingGroup = participantGroupMap.get(id);
        if (existingGroup) {
          pushError(lineNumber, `Participant '${id}' is already in group '${existingGroup}' — participants can only belong to one group`);
        } else {
          activeGroup.participantIds.push(id);
          participantGroupMap.set(id, activeGroup.name);
        }
      }
      continue;
    }

    // Colored participant declaration — "Name(color)" at any level
    // Color syntax is deprecated — emit warning and register without color
    const { core: colorCore, meta: colorMeta } = splitPipe(trimmed);
    const coloredMatch = colorCore.match(COLORED_PARTICIPANT_PATTERN);
    if (coloredMatch && !ARROW_PATTERN.test(colorCore)) {
      const id = coloredMatch[1];
      const color = coloredMatch[2].trim();
      pushWarning(lineNumber, `(${color}) color syntax removed from sequence diagrams — use 'tag:' groups for coloring`);
      contentStarted = true;
      if (!result.participants.some((p) => p.id === id)) {
        result.participants.push({
          id,
          label: id,
          type: inferParticipantType(id),
          lineNumber,
          ...(colorMeta ? { metadata: colorMeta } : {}),
        });
      }
      if (activeGroup && !activeGroup.participantIds.includes(id)) {
        const existingGroup = participantGroupMap.get(id);
        if (existingGroup) {
          pushError(lineNumber, `Participant '${id}' is already in group '${existingGroup}' — participants can only belong to one group`);
        } else {
          activeGroup.participantIds.push(id);
          participantGroupMap.set(id, activeGroup.name);
        }
      }
      continue;
    }

    // Bare participant name — either inside an active group (indented) or top-level declaration
    // Supports pipe metadata: "  API | c: Gateway" or "Tapin2 | l:Park"
    {
      const { core: bareCore, meta: bareMeta } = splitPipe(trimmed);
      const inGroup = activeGroup && measureIndent(raw) > 0;
      if (/^\S+$/.test(bareCore) && !ARROW_PATTERN.test(bareCore) && (inGroup || !contentStarted || bareMeta)) {
        contentStarted = true;
        const id = bareCore;
        if (!result.participants.some((p) => p.id === id)) {
          result.participants.push({
            id,
            label: id,
            type: inferParticipantType(id),
            lineNumber,
            ...(bareMeta ? { metadata: bareMeta } : {}),
          });
        }
        if (activeGroup && !activeGroup.participantIds.includes(id)) {
          const existingGroup = participantGroupMap.get(id);
          if (existingGroup) {
            pushError(lineNumber, `Participant '${id}' is already in group '${existingGroup}' — participants can only belong to one group`);
          } else {
            activeGroup.participantIds.push(id);
            participantGroupMap.set(id, activeGroup.name);
          }
        }
        continue;
      }
    }

    // ---- Indent-aware parsing for messages and block keywords ----
    const indent = measureIndent(raw);

    // Close blocks whose scope has ended (indent decreased)
    while (blockStack.length > 0) {
      const top = blockStack[blockStack.length - 1];
      if (indent > top.indent) break;
      // Keep block on stack when 'else' or 'else if' matches current indent — handled below
      if (
        indent === top.indent &&
        (top.block.type === 'if' || top.block.type === 'parallel')
      ) {
        const lower = trimmed.toLowerCase();
        if (lower === 'else' || lower.startsWith('else if ')) break;
      }
      blockStack.pop();
    }

    // Split pipe metadata before arrow parsing (arrows use $ anchor)
    const { core: arrowCore, meta: arrowMeta } = splitPipe(trimmed);

    // Parse message lines first — arrows take priority over keywords
    // Reject "async" keyword prefix — use ~> instead
    const asyncPrefixMatch = arrowCore.match(/^async\s+(.+)$/i);
    if (asyncPrefixMatch && ARROW_PATTERN.test(asyncPrefixMatch[1])) {
      pushError(lineNumber, 'Use ~> for async messages: A ~> B: message');
      continue;
    }

    // ---- Labeled arrows: -label->, ~label~> ----
    // Must be checked BEFORE plain arrow patterns to avoid partial matches
    const labeledArrow = parseArrow(arrowCore);
    if (labeledArrow && 'error' in labeledArrow) {
      pushError(lineNumber, labeledArrow.error);
      continue;
    }
    if (labeledArrow) {
      contentStarted = true;
      const { from, to, label, async: isAsync } = labeledArrow;
      lastMsgFrom = from;

      const msg: SequenceMessage = {
        from,
        to,
        label,
        lineNumber,
        ...(isAsync ? { async: true } : {}),
        ...(arrowMeta ? { metadata: arrowMeta } : {}),
      };
      result.messages.push(msg);
      currentContainer().push(msg);

      // Auto-register participants
      if (!result.participants.some((p) => p.id === from)) {
        result.participants.push({
          id: from,
          label: from,
          type: inferParticipantType(from),
          lineNumber,
        });
      }
      if (!result.participants.some((p) => p.id === to)) {
        result.participants.push({
          id: to,
          label: to,
          type: inferParticipantType(to),
          lineNumber,
        });
      }
      continue;
    }

    // ---- Error: old colon-postfix syntax (A -> B: msg) ----
    const colonPostfixSync = arrowCore.match(
      /^(\S+)\s*->\s*([^\s:]+)\s*:\s*(.+)$/
    );
    const colonPostfixAsync = arrowCore.match(
      /^(\S+)\s*~>\s*([^\s:]+)\s*:\s*(.+)$/
    );
    const colonPostfix = colonPostfixSync || colonPostfixAsync;
    if (colonPostfix) {
      const a = colonPostfix[1];
      const b = colonPostfix[2];
      const msg = colonPostfix[3].trim();
      const arrowChar = colonPostfixAsync ? '~' : '-';
      const arrowEnd = colonPostfixAsync ? '~>' : '->';
      pushError(
        lineNumber,
        `Colon syntax is no longer supported. Use '${a} ${arrowChar}${msg}${arrowEnd} ${b}' instead`
      );
      continue;
    }

    // ---- Error: plain bidirectional arrows (A <-> B, A <~> B) ----
    const bidiPlainMatch = arrowCore.match(
      /^(.+?)\s*(?:<->|<~>)\s*(.+)/
    );
    if (bidiPlainMatch) {
      pushError(
        lineNumber,
        "Bidirectional arrows are no longer supported. Use two separate lines: 'A -msg-> B' and 'B -msg-> A'"
      );
      continue;
    }

    // ---- Deprecated bare return arrows: A <- B, A <~ B ----
    const bareReturnSync = arrowCore.match(/^(.+?)\s+<-\s+(.+)$/);
    const bareReturnAsync = arrowCore.match(/^(.+?)\s+<~\s+(.+)$/);
    const bareReturn = bareReturnSync || bareReturnAsync;
    if (bareReturn) {
      const to = bareReturn[1];
      const from = bareReturn[2];
      pushError(
        lineNumber,
        `Left-pointing arrows are no longer supported. Write '${from} -> ${to}' instead`
      );
      continue;
    }

    // ---- Bare (unlabeled) call arrows: A -> B, A ~> B ----
    const bareCallSync = arrowCore.match(/^(.+?)\s*->\s*(.+)$/);
    const bareCallAsync = arrowCore.match(/^(.+?)\s*~>\s*(.+)$/);
    const bareCall = bareCallSync || bareCallAsync;
    if (bareCall) {
      contentStarted = true;
      const from = bareCall[1];
      const to = bareCall[2];
      lastMsgFrom = from;

      const msg: SequenceMessage = {
        from,
        to,
        label: '',
        lineNumber,
        ...(bareCallAsync ? { async: true } : {}),
        ...(arrowMeta ? { metadata: arrowMeta } : {}),
      };
      result.messages.push(msg);
      currentContainer().push(msg);

      if (!result.participants.some((p) => p.id === from)) {
        result.participants.push({
          id: from,
          label: from,
          type: inferParticipantType(from),
          lineNumber,
        });
      }
      if (!result.participants.some((p) => p.id === to)) {
        result.participants.push({
          id: to,
          label: to,
          type: inferParticipantType(to),
          lineNumber,
        });
      }
      continue;
    }

    // Parse 'if <label>' block keyword
    const ifMatch = trimmed.match(/^if\s+(.+)$/i);
    if (ifMatch) {
      contentStarted = true;
      const block: SequenceBlock = {
        kind: 'block',
        type: 'if',
        label: ifMatch[1].trim(),
        children: [],
        elseChildren: [],
        lineNumber,
      };
      currentContainer().push(block);
      blockStack.push({ block, indent, inElse: false });
      continue;
    }

    // Parse 'loop <label>' block keyword
    const loopMatch = trimmed.match(/^loop\s+(.+)$/i);
    if (loopMatch) {
      contentStarted = true;
      const block: SequenceBlock = {
        kind: 'block',
        type: 'loop',
        label: loopMatch[1].trim(),
        children: [],
        elseChildren: [],
        lineNumber,
      };
      currentContainer().push(block);
      blockStack.push({ block, indent, inElse: false });
      continue;
    }

    // Parse 'parallel [label]' block keyword
    const parallelMatch = trimmed.match(/^parallel(?:\s+(.+))?$/i);
    if (parallelMatch) {
      contentStarted = true;
      const block: SequenceBlock = {
        kind: 'block',
        type: 'parallel',
        label: parallelMatch[1]?.trim() || '',
        children: [],
        elseChildren: [],
        lineNumber,
      };
      currentContainer().push(block);
      blockStack.push({ block, indent, inElse: false });
      continue;
    }

    // Parse 'else if <label>' keyword (must come before bare 'else')
    const elseIfMatch = trimmed.match(/^else\s+if\s+(.+)$/i);
    if (elseIfMatch) {
      if (blockStack.length > 0 && blockStack[blockStack.length - 1].indent === indent) {
        const top = blockStack[blockStack.length - 1];
        if (top.block.type === 'parallel') {
          pushError(lineNumber, "parallel blocks don't support else if — list all concurrent messages directly inside the block");
          continue;
        }
        if (top.block.type === 'if') {
          const branch: ElseIfBranch = { label: elseIfMatch[1].trim(), children: [] };
          if (!top.block.elseIfBranches) top.block.elseIfBranches = [];
          top.block.elseIfBranches.push(branch);
          top.activeElseIfBranch = branch;
          top.inElse = false;
        }
      }
      continue;
    }

    // Parse 'else' keyword (only applies to 'if' blocks)
    if (trimmed.toLowerCase() === 'else') {
      if (blockStack.length > 0 && blockStack[blockStack.length - 1].indent === indent) {
        const top = blockStack[blockStack.length - 1];
        if (top.block.type === 'parallel') {
          pushError(lineNumber, "parallel blocks don't support else — list all concurrent messages directly inside the block");
          continue;
        }
        if (top.block.type === 'if') {
          top.inElse = true;
          top.activeElseIfBranch = undefined;
        }
      }
      continue;
    }

    // Parse single-line note — "note: text" or "note right of API: text"
    const noteSingleMatch = trimmed.match(NOTE_SINGLE);
    if (noteSingleMatch) {
      const notePosition =
        (noteSingleMatch[1]?.toLowerCase() as 'right' | 'left') || 'right';
      let noteParticipant = noteSingleMatch[2] || null;
      if (!noteParticipant) {
        if (!lastMsgFrom) continue; // incomplete — skip during live typing
        noteParticipant = lastMsgFrom;
      }
      if (!result.participants.some((p) => p.id === noteParticipant)) {
        continue; // unknown participant — skip during live typing
      }
      const note: SequenceNote = {
        kind: 'note',
        text: noteSingleMatch[3].trim(),
        position: notePosition,
        participantId: noteParticipant,
        lineNumber,
        endLineNumber: lineNumber,
      };
      currentContainer().push(note);
      continue;
    }

    // Parse multi-line note — "note" or "note right of API" (no colon, body indented below)
    const noteMultiMatch = trimmed.match(NOTE_MULTI);
    if (noteMultiMatch) {
      const notePosition =
        (noteMultiMatch[1]?.toLowerCase() as 'right' | 'left') || 'right';
      let noteParticipant = noteMultiMatch[2] || null;
      if (!noteParticipant) {
        if (!lastMsgFrom) continue; // incomplete — skip during live typing
        noteParticipant = lastMsgFrom;
      }
      if (!result.participants.some((p) => p.id === noteParticipant)) {
        continue; // unknown participant — skip during live typing
      }
      // Collect indented body lines
      const noteLines: string[] = [];
      while (i + 1 < lines.length) {
        const nextRaw = lines[i + 1];
        const nextTrimmed = nextRaw.trim();
        if (!nextTrimmed) break;
        const nextIndent = measureIndent(nextRaw);
        if (nextIndent <= indent) break;
        noteLines.push(nextTrimmed);
        i++;
      }
      if (noteLines.length === 0) continue; // no body yet — skip during live typing
      const note: SequenceNote = {
        kind: 'note',
        text: noteLines.join('\n'),
        position: notePosition,
        participantId: noteParticipant,
        lineNumber,
        endLineNumber: i + 1, // i has advanced past the body lines (1-based)
      };
      currentContainer().push(note);
      continue;
    }
  }

  // Validate: if no explicit chart line, check for arrow-based inference
  if (!hasExplicitChart && result.messages.length === 0) {
    // Check if raw content has arrow patterns for inference
    const hasArrows = lines.some((line) => ARROW_PATTERN.test(line.trim()));
    if (!hasArrows) {
      return fail(1, 'No "chart: sequence" header and no sequence content detected');
    }
  }

  // Warn about unused participants (only when the diagram has messages)
  if (result.messages.length > 0) {
    const usedIds = new Set<string>();
    for (const msg of result.messages) {
      usedIds.add(msg.from);
      usedIds.add(msg.to);
    }
    // Walk elements recursively to find note participant references
    const walkElements = (elements: SequenceElement[]): void => {
      for (const el of elements) {
        if (isSequenceNote(el)) {
          usedIds.add(el.participantId);
        } else if (isSequenceBlock(el)) {
          walkElements(el.children);
          walkElements(el.elseChildren);
          if (el.elseIfBranches) {
            for (const branch of el.elseIfBranches) {
              walkElements(branch.children);
            }
          }
        }
      }
    };
    walkElements(result.elements);

    for (const p of result.participants) {
      if (!usedIds.has(p.id)) {
        pushWarning(p.lineNumber, `Participant "${p.label}" is declared but never used in any message or note`);
      }
    }
  }

  // Warn about empty groups
  for (const group of result.groups) {
    if (group.participantIds.length === 0) {
      pushWarning(group.lineNumber, `Group "${group.name}" has no participants`);
    }
  }

  // Validate tag group values on participants and messages
  if (result.tagGroups.length > 0) {
    const entities: Array<{ metadata: Record<string, string>; lineNumber: number }> = [];
    for (const p of result.participants) {
      if (p.metadata) entities.push({ metadata: p.metadata, lineNumber: p.lineNumber });
    }
    for (const m of result.messages) {
      if (m.metadata) entities.push({ metadata: m.metadata, lineNumber: m.lineNumber });
    }
    for (const g of result.groups) {
      if (g.metadata) entities.push({ metadata: g.metadata, lineNumber: g.lineNumber });
    }
    validateTagValues(entities, result.tagGroups, pushWarning, suggest);
  }

  return result;
}

/**
 * Detect whether raw content looks like a sequence diagram.
 * Used by the chart type inference logic.
 */
export function looksLikeSequence(content: string): boolean {
  if (!content) return false;
  const lines = content.split('\n');
  return lines.some((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) return false;
    return ARROW_PATTERN.test(trimmed);
  });
}
