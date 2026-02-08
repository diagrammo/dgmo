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
export interface SequenceBlock {
  kind: 'block';
  type: 'if' | 'loop' | 'parallel';
  label: string;
  children: SequenceElement[];
  elseChildren: SequenceElement[];
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

export type SequenceElement = SequenceMessage | SequenceBlock | SequenceSection;

export function isSequenceBlock(el: SequenceElement): el is SequenceBlock {
  return 'kind' in el && (el as SequenceBlock).kind === 'block';
}

export function isSequenceSection(el: SequenceElement): el is SequenceSection {
  return 'kind' in el && (el as SequenceSection).kind === 'section';
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

// Group heading pattern — "## Backend" or "## Backend(blue)"
const GROUP_HEADING_PATTERN = /^##\s+(\S+?)(?:\((\w+)\))?$/;

// Section divider pattern — "== Label ==" or "== Label(color) =="
const SECTION_PATTERN = /^==\s+(.+?)\s*==$/;

// Arrow pattern for sequence inference — "A -> B: message" or "A ~> B: message"
const ARROW_PATTERN = /\S+\s*(?:->|~>)\s*\S+/;

// <- return syntax: "Login <- 200 OK"
const ARROW_RETURN_PATTERN = /^(.+?)\s*<-\s*(.+)$/;

// UML method(args): returnType syntax: "getUser(id): UserObj"
const UML_RETURN_PATTERN = /^(\w+\([^)]*\))\s*:\s*(.+)$/;

/**
 * Extract return label from a message label string.
 * Priority: `<-` syntax first, then UML `method(): return` syntax.
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

  // Group parsing state — tracks the active ## group heading
  let activeGroup: SequenceGroup | null = null;

  // Block parsing state
  const blockStack: {
    block: SequenceBlock;
    indent: number;
    inElse: boolean;
  }[] = [];
  const currentContainer = (): SequenceElement[] => {
    if (blockStack.length === 0) return result.elements;
    const top = blockStack[blockStack.length - 1];
    return top.inElse ? top.block.elseChildren : top.block.children;
  };

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
      activeGroup = {
        name: groupMatch[1],
        color: groupMatch[2] || undefined,
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

    // Skip comments
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

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
      const colorMatch = labelRaw.match(/^(.+?)\((\w+)\)$/);
      const section: SequenceSection = {
        kind: 'section',
        label: colorMatch ? colorMatch[1].trim() : labelRaw,
        color: colorMatch ? colorMatch[2] : undefined,
        lineNumber,
      };
      result.sections.push(section);
      currentContainer().push(section);
      continue;
    }

    // Parse header key: value lines (always top-level)
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0 && !trimmed.includes('->') && !trimmed.includes('~>')) {
      const key = trimmed.substring(0, colonIndex).trim().toLowerCase();
      const value = trimmed.substring(colonIndex + 1).trim();

      if (key === 'chart') {
        hasExplicitChart = true;
        if (value.toLowerCase() !== 'sequence') {
          result.error = `Expected chart type "sequence", got "${value}"`;
          return result;
        }
        continue;
      }

      if (key === 'title') {
        result.title = value;
        continue;
      }

      // Store other options
      result.options[key] = value;
      continue;
    }

    // Parse "Name is a type [aka Alias]" declarations (always top-level)
    const isAMatch = trimmed.match(IS_A_PATTERN);
    if (isAMatch) {
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
        activeGroup.participantIds.push(id);
      }
      continue;
    }

    // Parse standalone "Name position N" (no "is a" type)
    const posOnlyMatch = trimmed.match(POSITION_ONLY_PATTERN);
    if (posOnlyMatch) {
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
        activeGroup.participantIds.push(id);
      }
      continue;
    }

    // Bare participant name inside an active group (single identifier on an indented line)
    if (activeGroup && measureIndent(raw) > 0 && /^\S+$/.test(trimmed)) {
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
        activeGroup.participantIds.push(id);
      }
      continue;
    }

    // ---- Indent-aware parsing for messages and block keywords ----
    const indent = measureIndent(raw);

    // Close blocks whose scope has ended (indent decreased)
    while (blockStack.length > 0) {
      const top = blockStack[blockStack.length - 1];
      if (indent > top.indent) break;
      if (
        indent === top.indent &&
        trimmed.toLowerCase() === 'else' &&
        top.block.type === 'if'
      )
        break;
      blockStack.pop();
    }

    // Parse message lines first — arrows take priority over keywords
    // Detect async prefix: "async A -> B: msg"
    let isAsync = false;
    let arrowLine = trimmed;
    const asyncPrefixMatch = trimmed.match(/^async\s+(.+)$/i);
    if (asyncPrefixMatch) {
      isAsync = true;
      arrowLine = asyncPrefixMatch[1];
    }

    // Match ~> (async arrow) or -> (sync arrow)
    const asyncArrowMatch = arrowLine.match(
      /^(\S+)\s*~>\s*([^\s:]+)\s*(?::\s*(.+))?$/
    );
    const syncArrowMatch = arrowLine.match(
      /^(\S+)\s*->\s*([^\s:]+)\s*(?::\s*(.+))?$/
    );
    const arrowMatch = asyncArrowMatch || syncArrowMatch;
    if (asyncArrowMatch) isAsync = true;

    if (arrowMatch) {
      const from = arrowMatch[1];
      const to = arrowMatch[2];
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

    // Parse 'else' keyword (only applies to 'if' blocks)
    if (trimmed.toLowerCase() === 'else') {
      if (
        blockStack.length > 0 &&
        blockStack[blockStack.length - 1].indent === indent &&
        blockStack[blockStack.length - 1].block.type === 'if'
      ) {
        blockStack[blockStack.length - 1].inElse = true;
      }
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
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) return false;
    return ARROW_PATTERN.test(trimmed);
  });
}
