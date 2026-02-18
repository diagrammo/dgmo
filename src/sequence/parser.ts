// ============================================================
// Sequence Diagram Parser (.dgmo format)
// ============================================================

import { inferParticipantType } from './participant-inference';

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
}

/**
 * A message between two participants.
 * Placeholder for future stories — included in the interface now for completeness.
 */
export interface SequenceMessage {
  from: string;
  to: string;
  label: string;
  returnLabel?: string;
  lineNumber: number;
  async?: boolean;
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
  color?: string;
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
  color?: string;
  participantIds: string[];
  lineNumber: number;
}

/**
 * Parsed result from a .dgmo sequence diagram.
 */
export interface ParsedSequenceDgmo {
  title: string | null;
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
  elements: SequenceElement[];
  groups: SequenceGroup[];
  sections: SequenceSection[];
  options: Record<string, string>;
  error: string | null;
}

// "Name is a type" pattern — e.g. "AuthService is a service"
// Remainder after type is parsed separately for aka/position modifiers
const IS_A_PATTERN = /^(\S+)\s+is\s+an?\s+(\w+)(?:\s+(.+))?$/i;

// Standalone "Name position N" pattern — e.g. "DB position -1"
const POSITION_ONLY_PATTERN = /^(\S+)\s+position\s+(-?\d+)$/i;

// Group heading pattern — "## Backend", "## API Services(blue)", "## Backend(#hex)"
const GROUP_HEADING_PATTERN = /^##\s+(.+?)(?:\(([^)]+)\))?\s*$/;

// Section divider pattern — "== Label ==", "== Label(color) ==", or "== Label" (trailing == optional)
const SECTION_PATTERN = /^==\s+(.+?)(?:\s*==)?\s*$/;

// Arrow pattern for sequence inference — "A -> B: message" or "A ~> B: message"
const ARROW_PATTERN = /\S+\s*(?:->|~>)\s*\S+/;

// <- return syntax: "Login <- 200 OK"
const ARROW_RETURN_PATTERN = /^(.+?)\s*<-\s*(.+)$/;

// UML method(args): returnType syntax: "getUser(id): UserObj"
const UML_RETURN_PATTERN = /^(\w+\([^)]*\))\s*:\s*(.+)$/;

// Note patterns — "note: text", "note right of API: text", "note left of User"
const NOTE_SINGLE = /^note(?:\s+(right|left)\s+of\s+(\S+))?\s*:\s*(.+)$/i;
const NOTE_MULTI = /^note(?:\s+(right|left)\s+of\s+(\S+))?\s*$/i;

/**
 * Extract return label from a message label string.
 * Priority: `<-` syntax first, then UML `method(): return` syntax,
 * then shorthand ` : ` separator (splits on last occurrence).
 */
function parseReturnLabel(rawLabel: string): {
  label: string;
  returnLabel?: string;
} {
  if (!rawLabel) return { label: '' };

  // Check <- syntax first
  const arrowReturn = rawLabel.match(ARROW_RETURN_PATTERN);
  if (arrowReturn) {
    return { label: arrowReturn[1].trim(), returnLabel: arrowReturn[2].trim() };
  }

  // Check UML method(args): returnType syntax
  const umlReturn = rawLabel.match(UML_RETURN_PATTERN);
  if (umlReturn) {
    return { label: umlReturn[1].trim(), returnLabel: umlReturn[2].trim() };
  }

  // Shorthand colon return syntax (split on last ":")
  // Skip if the colon is part of a URL scheme (followed by //)
  const lastColon = rawLabel.lastIndexOf(':');
  if (lastColon > 0 && lastColon < rawLabel.length - 1) {
    const afterColon = rawLabel.substring(lastColon + 1);
    if (!afterColon.startsWith('//')) {
      const reqPart = rawLabel.substring(0, lastColon).trim();
      const resPart = afterColon.trim();
      if (reqPart && resPart) {
        return { label: reqPart, returnLabel: resPart };
      }
    }
  }

  return { label: rawLabel };
}

/**
 * Measure leading whitespace of a line, normalizing tabs to 4 spaces.
 */
function measureIndent(line: string): number {
  let indent = 0;
  for (const ch of line) {
    if (ch === ' ') indent++;
    else if (ch === '\t') indent += 4;
    else break;
  }
  return indent;
}

/**
 * Parse a .dgmo file with `chart: sequence` into a structured representation.
 */
export function parseSequenceDgmo(content: string): ParsedSequenceDgmo {
  const result: ParsedSequenceDgmo = {
    title: null,
    participants: [],
    messages: [],
    elements: [],
    groups: [],
    sections: [],
    options: {},
    error: null,
  };

  if (!content || !content.trim()) {
    result.error = 'Empty content';
    return result;
  }

  const lines = content.split('\n');
  let hasExplicitChart = false;
  let contentStarted = false;

  // Group parsing state — tracks the active ## group heading
  let activeGroup: SequenceGroup | null = null;

  // Track participant → group name for duplicate membership detection
  const participantGroupMap = new Map<string, string>();

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
      continue;
    }

    // Parse group heading — must be checked before comment skip since ## starts with #
    const groupMatch = trimmed.match(GROUP_HEADING_PATTERN);
    if (groupMatch) {
      const groupColor = groupMatch[2]?.trim();
      if (groupColor && groupColor.startsWith('#')) {
        result.error = `Line ${lineNumber}: Use a named color instead of hex (e.g., blue, red, teal)`;
        return result;
      }
      contentStarted = true;
      activeGroup = {
        name: groupMatch[1].trim(),
        color: groupColor || undefined,
        participantIds: [],
        lineNumber,
      };
      result.groups.push(activeGroup);
      continue;
    }

    // Close active group on non-indented, non-group lines
    if (activeGroup && measureIndent(raw) === 0) {
      activeGroup = null;
    }

    // Skip comments — only // is supported
    if (trimmed.startsWith('//')) continue;

    // Reject # as comment syntax (## is for group headings, handled above)
    if (trimmed.startsWith('#') && !trimmed.startsWith('##')) {
      result.error = `Line ${lineNumber}: Use // for comments. # is reserved for group headings (##)`;
      return result;
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
      if (colorMatch && colorMatch[2].trim().startsWith('#')) {
        result.error = `Line ${lineNumber}: Use a named color instead of hex (e.g., blue, red, teal)`;
        return result;
      }
      contentStarted = true;
      const section: SequenceSection = {
        kind: 'section',
        label: colorMatch ? colorMatch[1].trim() : labelRaw,
        color: colorMatch ? colorMatch[2].trim() : undefined,
        lineNumber,
      };
      result.sections.push(section);
      currentContainer().push(section);
      continue;
    }

    // Parse header key: value lines (always top-level)
    // Skip 'note' lines — parsed in the indent-aware section below
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0 && !trimmed.includes('->') && !trimmed.includes('~>')) {
      const key = trimmed.substring(0, colonIndex).trim().toLowerCase();
      if (key === 'note' || key.startsWith('note ')) {
        // Fall through to indent-aware note parsing below
      } else {
      const value = trimmed.substring(colonIndex + 1).trim();

      if (key === 'chart') {
        hasExplicitChart = true;
        if (value.toLowerCase() !== 'sequence') {
          result.error = `Expected chart type "sequence", got "${value}"`;
          return result;
        }
        continue;
      }

      // Enforce headers-before-content
      if (contentStarted) {
        result.error = `Line ${lineNumber}: Options like '${key}: ${value}' must appear before the first message or declaration`;
        return result;
      }

      if (key === 'title') {
        result.title = value;
        continue;
      }

      // Store other options
      result.options[key] = value;
      continue;
      }
    }

    // Parse "Name is a type [aka Alias]" declarations (always top-level)
    const isAMatch = trimmed.match(IS_A_PATTERN);
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
        });
      }
      // Track group membership
      if (activeGroup && !activeGroup.participantIds.includes(id)) {
        const existingGroup = participantGroupMap.get(id);
        if (existingGroup) {
          result.error = `Line ${lineNumber}: Participant '${id}' is already in group '${existingGroup}' — participants can only belong to one group`;
          return result;
        }
        activeGroup.participantIds.push(id);
        participantGroupMap.set(id, activeGroup.name);
      }
      continue;
    }

    // Parse standalone "Name position N" (no "is a" type)
    const posOnlyMatch = trimmed.match(POSITION_ONLY_PATTERN);
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
        });
      }
      // Track group membership
      if (activeGroup && !activeGroup.participantIds.includes(id)) {
        const existingGroup = participantGroupMap.get(id);
        if (existingGroup) {
          result.error = `Line ${lineNumber}: Participant '${id}' is already in group '${existingGroup}' — participants can only belong to one group`;
          return result;
        }
        activeGroup.participantIds.push(id);
        participantGroupMap.set(id, activeGroup.name);
      }
      continue;
    }

    // Bare participant name inside an active group (single identifier on an indented line)
    if (activeGroup && measureIndent(raw) > 0 && /^\S+$/.test(trimmed)) {
      contentStarted = true;
      const id = trimmed;
      if (!result.participants.some((p) => p.id === id)) {
        result.participants.push({
          id,
          label: id,
          type: inferParticipantType(id),
          lineNumber,
        });
      }
      if (!activeGroup.participantIds.includes(id)) {
        const existingGroup = participantGroupMap.get(id);
        if (existingGroup) {
          result.error = `Line ${lineNumber}: Participant '${id}' is already in group '${existingGroup}' — participants can only belong to one group`;
          return result;
        }
        activeGroup.participantIds.push(id);
        participantGroupMap.set(id, activeGroup.name);
      }
      continue;
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

    // Parse message lines first — arrows take priority over keywords
    // Reject "async" keyword prefix — use ~> instead
    const asyncPrefixMatch = trimmed.match(/^async\s+(.+)$/i);
    if (asyncPrefixMatch && ARROW_PATTERN.test(asyncPrefixMatch[1])) {
      result.error = `Line ${lineNumber}: Use ~> for async messages: A ~> B: message`;
      return result;
    }

    // Match ~> (async arrow) or -> (sync arrow)
    let isAsync = false;
    const asyncArrowMatch = trimmed.match(
      /^(\S+)\s*~>\s*([^\s:]+)\s*(?::\s*(.+))?$/
    );
    const syncArrowMatch = trimmed.match(
      /^(\S+)\s*->\s*([^\s:]+)\s*(?::\s*(.+))?$/
    );
    const arrowMatch = asyncArrowMatch || syncArrowMatch;
    if (asyncArrowMatch) isAsync = true;

    if (arrowMatch) {
      contentStarted = true;
      const from = arrowMatch[1];
      const to = arrowMatch[2];
      lastMsgFrom = from;
      const rawLabel = arrowMatch[3]?.trim() || '';

      // Extract return label — skip for async messages
      const { label, returnLabel } = isAsync
        ? { label: rawLabel, returnLabel: undefined }
        : parseReturnLabel(rawLabel);

      const msg: SequenceMessage = {
        from,
        to,
        label,
        returnLabel,
        lineNumber,
        ...(isAsync ? { async: true } : {}),
      };
      result.messages.push(msg);
      currentContainer().push(msg);

      // Auto-register participants from message usage with type inference
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
          result.error = `Line ${lineNumber}: parallel blocks don't support else if — list all concurrent messages directly inside the block`;
          return result;
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
          result.error = `Line ${lineNumber}: parallel blocks don't support else — list all concurrent messages directly inside the block`;
          return result;
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
      result.error =
        'No "chart: sequence" header and no sequence content detected';
      return result;
    }
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
