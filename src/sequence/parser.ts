// ============================================================
// Sequence Diagram Parser (.dgmo format)
// ============================================================

import { inferParticipantType } from './participant-inference';
import type { DgmoError } from '../diagnostics';
import {
  makeDgmoError,
  formatDgmoError,
  suggest,
  NAME_DIAGNOSTIC_CODES,
  nameMergedMessage,
  akaRemovedMessage,
  participantTypeRemovedMessage,
} from '../diagnostics';
import { normalizeName, displayName } from '../utils/name-normalize';
import { parseArrow, parseInArrowLabel } from '../utils/arrows';
import {
  measureIndent,
  extractColor,
  parsePipeMetadata,
  MULTIPLE_PIPE_ERROR,
  parseFirstLine,
  OPTION_NOCOLON_RE,
} from '../utils/parsing';
import type { TagGroup } from '../utils/tag-groups';
import {
  matchTagBlockHeading,
  emitTagLegacyDiagnostic,
  validateTagValues,
  validateTagGroupNames,
  stripDefaultModifier,
} from '../utils/tag-groups';

/** Known sequence-diagram options that take a value (space-separated). */
/**
 * Detect whether a participant-declaration remainder contains a
 * hard-removed legacy modifier. Returns the diagnostic to emit when
 * one is found.
 *
 * Centralized so future postfix modifiers (e.g. `as` per TD-18)
 * don't accidentally re-route through the rejection branch.
 */
function isHardRemovedToken(
  remainder: string
): { removed: true; code: string; message: string } | { removed: false } {
  if (/\baka\b/i.test(remainder)) {
    return {
      removed: true,
      code: NAME_DIAGNOSTIC_CODES.AKA_REMOVED,
      message: akaRemovedMessage(),
    };
  }
  return { removed: false };
}

const KNOWN_SEQ_OPTIONS = new Set(['active-tag']);

/** Known sequence-diagram boolean options (bare keyword or `no-` prefix). */
const KNOWN_SEQ_BOOLEANS = new Set(['activations', 'solid-fill', 'no-title']);

/**
 * Participant types that can be declared via "Name is a type" syntax.
 *
 * The 0.16.0 trim retained only the types whose shapes carry semantic
 * weight at a glance: stick figure (actor), cylinder (database),
 * dashed cylinder (cache), horizontal pipe (queue), plus the default
 * rectangle. The legacy `service`/`frontend`/`networking`/`gateway`/
 * `external` keywords are rejected at parse time via
 * `E_PARTICIPANT_TYPE_REMOVED`.
 */
export type ParticipantType =
  | 'default'
  | 'database'
  | 'actor'
  | 'queue'
  | 'cache';

const VALID_PARTICIPANT_TYPES: ReadonlySet<string> = new Set([
  'database',
  'actor',
  'queue',
  'cache',
]);

/**
 * Participant-type keywords that were removed in 0.16.0. Used to
 * gate `is a X` declarations with a hard parse error rather than
 * silent fall-through to default — aligns with the pre-1.0
 * break-and-bump policy (see `E_AKA_REMOVED` precedent).
 */
const REMOVED_PARTICIPANT_TYPES: ReadonlySet<string> = new Set([
  'service',
  'frontend',
  'networking',
  'gateway',
  'external',
]);

/**
 * A declared or inferred participant in the sequence diagram.
 */
export interface SequenceParticipant {
  /** Internal identifier (e.g. "AuthService") */
  id: string;
  /** Display label — first-seen casing/spacing of the name */
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
  lineNumber: number;
}

export interface SequenceBlock {
  kind: 'block';
  type: 'if' | 'loop' | 'parallel';
  label: string;
  children: SequenceElement[];
  elseChildren: SequenceElement[];
  elseIfBranches?: ElseIfBranch[];
  elseLineNumber?: number;
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
  /** Whether this group is collapsed by default */
  collapsed?: boolean;
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

// "Name is a type" pattern — e.g. "Auth Server is a database"
// Participant names may contain spaces; [^:]+? stops at colons so that
// note lines like "note right of A: this is an actor" are not falsely matched.
// Remainder after type is parsed separately for `position N` modifier.
const IS_A_PATTERN = /^([^:]+?)\s+is\s+an?\s+(\w+)(?:\s+(.+))?$/i;

// Standalone "Name position N" pattern — e.g. "DB position -1"
const POSITION_ONLY_PATTERN = /^([^:]+?)\s+position\s+(-?\d+)$/i;

// Colored participant declaration — e.g. "Tapin2(green)", "API(blue)"
// Scoped to recognized 11-name palette colors only (§1.5) so legitimate
// `funcCall(arg)` lines don't trigger the legacy-color diagnostic.
const COLORED_PARTICIPANT_PATTERN =
  /^(\S+?)\((red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white)\)\s*$/;

// Group heading pattern — "[Backend]", "[Backend] | t: Product"
// Group 1: name (no ] or | inside brackets), Group 2: color in parens, Group 3: after-bracket text
const GROUP_HEADING_PATTERN = /^\[([^\]|]+?)(?:\(([^)]+)\))?\]\s*(.*)$/;
// Fallback: allows anything inside brackets (used to detect pipe-inside-brackets error)
const GROUP_HEADING_FALLBACK = /^\[([^\]]+)\]\s*(.*)$/;
// Legacy ## syntax — detect and emit migration error
const LEGACY_GROUP_PATTERN = /^##\s+(.+?)(?:\(([^)]+)\))?\s*$/;

// Section divider pattern — "== Label ==", "== Label(color) ==", or "== Label" (trailing == optional)
const SECTION_PATTERN = /^==\s+(.+?)(?:\s*==)?\s*$/;

// Arrow pattern for sequence inference — detects any arrow form
const ARROW_PATTERN = /\S+\s*(?:<-\S+-|<~\S+~|-\S+->|~\S+~>|->|~>|<-|<~)\s*\S+/;

// Note patterns — colon-free syntax only
// Single-line: "note text", "note left text", "note right of X text", "note left X text"
// Multi-line:  "note", "note right", "note right of X", "note left X" (body indented below)
//
// The colon-free positioned form requires participant resolution — the parser
// already has participant collection infrastructure, so we match the general
// structure here and resolve participant vs text in the parsing logic.
const NOTE_BARE = /^note\s+(.+)$/i;
const NOTE_MULTI = /^note(?:\s+(right|left)(?:\s+(?:of\s+)?(.+?))?)?\s*$/i;

/** Result of parseNoteLine — indicates what the parser should do. */
type NoteParseResult =
  | {
      kind: 'single';
      position: 'right' | 'left';
      participantId: string;
      text: string;
    }
  | { kind: 'multi-head'; position: 'right' | 'left'; participantId: string }
  | { kind: 'skip' }
  | null; // not a note line at all

/**
 * Parse a note line, resolving participant names from the known participants list.
 *
 * Supports:
 * - `note text` — default position (right), last msg sender
 * - `note left of X text` / `note left X text`
 * - `note right` — multi-line head
 * - `note right of X` / `note left X` — multi-line head
 * - Quoted participant: `note left "Auth Service" text`
 */
function parseNoteLine(
  trimmed: string,
  participants: SequenceParticipant[],
  participantIds: Set<string>,
  sortedParticipantsCache: SequenceParticipant[],
  lastMsgFrom: string | null
): NoteParseResult {
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith('note')) return null;
  // Must be exactly "note" or "note " — not "notebook" etc.
  if (trimmed.length > 4 && trimmed[4] !== ' ') return null;

  // 1. Try multi-line head (no text after note): `note`, `note right`, `note right of X`, `note left X`
  // NOTE: NOTE_MULTI's (.+?) can greedily capture "participant text" as one group.
  // Only trust this match if the captured participant actually exists. Otherwise,
  // fall through to the bare-note handler which does proper participant-aware splitting.
  const multiMatch = trimmed.match(NOTE_MULTI);
  if (multiMatch) {
    const position =
      (multiMatch[1]?.toLowerCase() as 'right' | 'left') || 'right';
    let participantId = multiMatch[2] || null;
    if (!participantId) {
      if (!lastMsgFrom) return { kind: 'skip' };
      participantId = lastMsgFrom;
    }
    const lookupKey = normalizeName(participantId);
    if (participantIds.has(lookupKey)) {
      // Resolve to first-seen display id so the renderer can find it
      const found = participants.find((p) => normalizeName(p.id) === lookupKey);
      return {
        kind: 'multi-head',
        position,
        participantId: found?.id ?? participantId,
      };
    }
    // Participant not found — fall through to bare-note handler for proper resolution
  }

  // 2. Bare note: `note text` or `note left [of] X text`
  const bareMatch = trimmed.match(NOTE_BARE);
  if (bareMatch) {
    // Capture group 1 guaranteed present after successful match.
    const rest = bareMatch[1]!.trim();
    const restLower = rest.toLowerCase();

    // Check for positioned note: `note left/right ...`
    if (restLower.startsWith('left') || restLower.startsWith('right')) {
      const posWord = restLower.startsWith('left') ? 'left' : 'right';
      const position = posWord as 'right' | 'left';
      let afterPos = rest.substring(posWord.length).trim();

      // Strip optional `of` keyword — track whether it was present
      let hadOf = false;
      if (afterPos.toLowerCase().startsWith('of ')) {
        afterPos = afterPos.substring(3).trim();
        hadOf = true;
      }

      if (!afterPos) {
        // Just `note left` or `note right` — multi-line head
        if (!lastMsgFrom) return { kind: 'skip' };
        if (!participantIds.has(normalizeName(lastMsgFrom)))
          return { kind: 'skip' };
        return { kind: 'multi-head', position, participantId: lastMsgFrom };
      }

      // Try to match a known participant at the start of afterPos
      const resolved = resolveParticipantAndText(
        afterPos,
        participants,
        participantIds,
        sortedParticipantsCache
      );
      if (resolved) {
        if (resolved.text) {
          return {
            kind: 'single',
            position,
            participantId: resolved.participantId,
            text: resolved.text,
          };
        } else {
          // No text after participant — multi-line head
          return {
            kind: 'multi-head',
            position,
            participantId: resolved.participantId,
          };
        }
      }

      // No known participant matched.
      // If `of` was explicit (`note right of Z ...`), the user intended a specific
      // participant — skip when it doesn't exist rather than defaulting.
      if (hadOf) return { kind: 'skip' };

      // Without `of`, treat remaining text as note content on the last-msg sender
      if (!lastMsgFrom) return { kind: 'skip' };
      if (!participantIds.has(normalizeName(lastMsgFrom)))
        return { kind: 'skip' };
      return {
        kind: 'single',
        position,
        participantId: lastMsgFrom,
        text: afterPos,
      };
    }

    // Plain `note text` — default position, last msg sender
    if (!lastMsgFrom) return { kind: 'skip' };
    if (!participantIds.has(normalizeName(lastMsgFrom)))
      return { kind: 'skip' };
    return {
      kind: 'single',
      position: 'right',
      participantId: lastMsgFrom,
      text: rest,
    };
  }

  return null;
}

/**
 * Try to match a known participant name at the start of a string.
 * Returns the matched participant and remaining text, or null if no match.
 * Tries longest match first (multi-word participant names).
 */
function resolveParticipantAndText(
  input: string,
  participants: SequenceParticipant[],
  participantIds: Set<string>,
  sortedParticipantsCache: SequenceParticipant[]
): { participantId: string; text: string } | null {
  // Handle quoted participant: `"Auth Service" text`
  if (input.startsWith('"') || input.startsWith("'")) {
    // input[0] guaranteed by the startsWith check above.
    const quote = input[0]!;
    const endQuote = input.indexOf(quote, 1);
    if (endQuote > 0) {
      const name = input.substring(1, endQuote);
      const key = normalizeName(name);
      if (participantIds.has(key)) {
        const text = input.substring(endQuote + 1).trim();
        const found = participants.find((p) => normalizeName(p.id) === key);
        return { participantId: found?.id ?? name, text };
      }
    }
    return null;
  }

  // Use pre-sorted participants (longest display id first) for greedy
  // matching. Compare via the shared normalizer so 'auth service text' matches
  // a participant declared as 'Auth Service'.
  const sorted = sortedParticipantsCache;
  for (const p of sorted) {
    const idLen = p.id.length;
    if (input.length < idLen) continue;
    const candidate = input.substring(0, idLen);
    if (normalizeName(candidate) !== normalizeName(p.id)) continue;
    const remaining = input.substring(idLen);
    // Must be followed by whitespace, end of string, or nothing
    if (remaining === '' || remaining[0] === ' ' || remaining[0] === '\t') {
      return { participantId: p.id, text: remaining.trim() };
    }
  }
  return null;
}

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

  // Per-parse entity alias literal → canonical participantId map
  // (TD-18). Distinct from `aliasMap` further down, which is for
  // tag-group aliases (per the A1 naming convention). Per C8:
  // never persisted, fresh each parse.
  const nameAliasMap = new Map<string, string>();
  const resolveAlias = (token: string): string => {
    const trimmed = token.trim();
    return nameAliasMap.get(trimmed) ?? trimmed;
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

  if (!content?.trim()) {
    return fail(0, 'Empty content');
  }

  const lines = content.split('\n');
  let hasExplicitChart = false;
  let contentStarted = false;
  let firstLineIndex = -1; // line index of the `sequence [Title]` first line (to skip in main loop)

  // Handle first non-empty, non-comment line for `sequence Title` syntax
  for (let fi = 0; fi < lines.length; fi++) {
    // In-bounds by loop guard.
    const fl = lines[fi]!.trim();
    if (!fl || fl.startsWith('//')) continue;
    const parsed = parseFirstLine(fl);
    if (parsed?.chartType === 'sequence') {
      hasExplicitChart = true;
      firstLineIndex = fi;
      if (parsed.title) {
        result.title = parsed.title;
        result.titleLineNumber = fi + 1;
      }
    }
    break;
  }

  // Group parsing state — tracks the active [Group] heading
  let activeGroup: SequenceGroup | null = null;

  // Fast lookup set for participant existence checks (mirrors result.participants).
  // Holds NORMALIZED participant keys so 'Auth Service' and 'auth service' fold
  // to the same entry. Display label survives in result.participants[i].label.
  const participantIds = new Set<string>();

  // Map<normalizedKey, first-seen participant.id> — the canonical
  // identifier callers store on messages, group memberships, etc.
  const idByKey = new Map<string, string>();

  /**
   * Get-or-create a participant by normalized key. Returns the FIRST-SEEN
   * `participant.id` — which is the user's original casing/spacing.
   * Callers should use the returned value on messages, group memberships,
   * notes, etc. so all references resolve to the canonical id.
   *
   * Emits NAME_MERGED warning when an incoming source label normalizes to
   * an existing key but its display form differs (case/whitespace).
   */
  const addParticipant = (
    name: string,
    lineNumber: number,
    extras?: {
      type?: ParticipantType;
      position?: number;
      label?: string;
      metadata?: Record<string, string>;
    }
  ): string => {
    const key = normalizeName(name);
    const trimmed = name.trim();
    const incomingLabel = extras?.label ?? trimmed;
    if (participantIds.has(key)) {
      const existing = result.participants.find(
        (p) => normalizeName(p.id) === key
      );
      if (existing) {
        if (
          displayName(existing.label) !== displayName(incomingLabel) ||
          displayName(existing.id) !== displayName(trimmed)
        ) {
          result.diagnostics.push(
            makeDgmoError(
              lineNumber,
              nameMergedMessage({
                incomingDisplay: trimmed,
                incomingLine: lineNumber,
                existingDisplay: existing.id,
                existingLine: existing.lineNumber,
              }),
              'warning',
              NAME_DIAGNOSTIC_CODES.NAME_MERGED
            )
          );
        }
        return existing.id;
      }
      // Fallback: idByKey lookup hit but participant somehow missing.
      return idByKey.get(key) ?? trimmed;
    }
    participantIds.add(key);

    idByKey.set(key, trimmed);
    sortedCacheDirty = true;
    result.participants.push({
      id: trimmed,
      label: incomingLabel,
      type: extras?.type ?? inferParticipantType(name),
      lineNumber,
      ...(extras?.position !== undefined ? { position: extras.position } : {}),
      ...(extras?.metadata ? { metadata: extras.metadata } : {}),
    });
    return trimmed;
  };

  // Cache sorted participants (longest ID first) for greedy name matching in notes.
  // Invalidated whenever a new participant is added.
  let sortedParticipantsCache: SequenceParticipant[] = [];
  let sortedCacheDirty = true;

  /** Get sorted participants (longest display label first), rebuilding only when dirty. */
  const getSortedParticipants = (): SequenceParticipant[] => {
    if (sortedCacheDirty) {
      sortedParticipantsCache = [...result.participants].sort(
        (a, b) => b.label.length - a.label.length
      );
      sortedCacheDirty = false;
    }
    return sortedParticipantsCache;
  };

  // Track participant → group name for duplicate membership detection
  const participantGroupMap = new Map<string, string>();

  // Tag group parsing state
  let currentTagGroup: TagGroup | null = null;
  const aliasMap = new Map<string, string>();

  /** Split pipe metadata from a line: "core | k: v" → { core, meta } */
  const splitPipe = (
    text: string,
    ln?: number
  ): { core: string; meta?: Record<string, string> } => {
    const idx = text.indexOf('|');
    if (idx < 0) return { core: text };
    const core = text.substring(0, idx).trimEnd();
    const segments = text.substring(idx).split('|');
    const warnFn =
      ln != null ? () => pushError(ln, MULTIPLE_PIPE_ERROR) : undefined;
    const meta = parsePipeMetadata(segments, aliasMap, warnFn);
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
    // In-bounds by the length check above.
    const top = blockStack[blockStack.length - 1]!;
    if (top.activeElseIfBranch) return top.activeElseIfBranch.children;
    return top.inElse ? top.block.elseChildren : top.block.children;
  };

  // Track last message sender for default note positioning
  let lastMsgFrom: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const raw = lines[i]!;
    const trimmed = raw.trim();
    const lineNumber = i + 1;

    // Skip empty lines
    if (!trimmed) {
      activeGroup = null;
      currentTagGroup = null;
      continue;
    }

    // Skip first line already handled as `sequence [Title]`
    if (i === firstLineIndex) continue;

    // Parse group heading — [Group Name] or [Group Name] | k: v
    const groupMatch = trimmed.match(GROUP_HEADING_PATTERN);
    if (groupMatch) {
      // Capture group 1 guaranteed present after successful match.
      const groupName = groupMatch[1]!.trim();
      const groupColor = groupMatch[2]?.trim();
      let groupMeta: Record<string, string> | undefined;

      // Parse collapse keyword and pipe metadata AFTER the closing bracket
      let afterBracket = groupMatch[3]?.trim() || '';
      let isCollapsed = false;

      // Extract `collapse` keyword (before any pipe metadata)
      const collapseMatch = afterBracket.match(/^collapse\b/i);
      if (collapseMatch) {
        isCollapsed = true;
        afterBracket = afterBracket.slice(collapseMatch[0].length).trim();
      }

      if (afterBracket.startsWith('|')) {
        const segments = afterBracket.split('|');
        const meta = parsePipeMetadata(segments, aliasMap, () =>
          pushError(lineNumber, MULTIPLE_PIPE_ERROR)
        );
        if (Object.keys(meta).length > 0) groupMeta = meta;
      }

      if (groupColor) {
        pushWarning(
          lineNumber,
          `'(${groupColor})' parens-color syntax removed from sequence diagrams — use 'tag:' groups for coloring`
        );
      }
      contentStarted = true;
      activeGroup = {
        name: groupName,
        participantIds: [],
        lineNumber,
        ...(groupMeta ? { metadata: groupMeta } : {}),
        ...(isCollapsed ? { collapsed: true } : {}),
      };
      result.groups.push(activeGroup);
      continue;
    }

    // Detect pipe-inside-brackets error: [Name | meta] → suggest [Name] | meta
    if (trimmed.startsWith('[')) {
      const fallbackMatch = trimmed.match(GROUP_HEADING_FALLBACK);
      // Capture group 1 guaranteed present after successful match.
      if (fallbackMatch && fallbackMatch[1]!.includes('|')) {
        const rawInside = fallbackMatch[1]!;
        const pipeIdx = rawInside.indexOf('|');
        const cleanName = rawInside
          .substring(0, pipeIdx)
          .trim()
          .replace(/\([^)]*\)$/, '')
          .trim();
        const metaPart = rawInside.substring(pipeIdx).trim();
        pushError(
          lineNumber,
          `Pipe metadata must go outside brackets — use '[${cleanName}] ${metaPart}' instead of '[${rawInside.trim()}]'`
        );
        continue;
      }
    }

    // Reject legacy ## group syntax with migration hint
    if (trimmed.match(LEGACY_GROUP_PATTERN)) {
      const legacyMatch = trimmed.match(LEGACY_GROUP_PATTERN)!;
      // Capture group 1 guaranteed present after successful match.
      const name = legacyMatch[1]!.trim();
      const color = legacyMatch[2]?.trim();
      const suggestion = color ? `[${name}(${color})]` : `[${name}]`;
      pushError(
        lineNumber,
        `'## ${name}' group syntax is no longer supported. Use '${suggestion}' instead`
      );
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
    // Tag block heading: "tag Name as <alias>"
    const tagBlockMatch = matchTagBlockHeading(trimmed);
    if (tagBlockMatch) {
      emitTagLegacyDiagnostic(tagBlockMatch, lineNumber, result.diagnostics);
      if (contentStarted) {
        pushError(lineNumber, 'Tag groups must appear before sequence content');
        continue;
      }
      const newTagGroup: TagGroup = {
        name: tagBlockMatch.name,
        ...(tagBlockMatch.alias !== undefined && {
          alias: tagBlockMatch.alias,
        }),
        entries: [],
        lineNumber,
      };
      currentTagGroup = newTagGroup;
      if (tagBlockMatch.alias) {
        aliasMap.set(
          tagBlockMatch.alias.toLowerCase(),
          tagBlockMatch.name.toLowerCase()
        );
      }
      result.tagGroups.push(newTagGroup);
      continue;
    }

    // Tag group entries (indented Value color under tag heading)
    // First entry is the default unless another is marked `default`
    if (currentTagGroup && !contentStarted && measureIndent(raw) > 0) {
      const { text: cleanEntry, isDefault } = stripDefaultModifier(trimmed);
      const { label, color } = extractColor(
        cleanEntry,
        undefined,
        result.diagnostics,
        lineNumber
      );
      if (!color) {
        pushError(
          lineNumber,
          `Expected 'Value color' in tag group '${currentTagGroup.name}'`
        );
        continue;
      }
      if (isDefault) {
        currentTagGroup.defaultValue = label;
      } else if (currentTagGroup.entries.length === 0) {
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
        // In-bounds by the length check above.
        const top = blockStack[blockStack.length - 1]!;
        if (sectionIndent > top.indent) break;
        blockStack.pop();
      }
      // Capture group 1 guaranteed present after successful match.
      const labelRaw = sectionMatch[1]!.trim();
      // Scoped to recognized 11-name palette colors only (§1.5).
      const colorMatch = labelRaw.match(
        /^(.+?)\((red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white)\)$/
      );
      if (colorMatch) {
        pushWarning(
          lineNumber,
          `'(${colorMatch[2]})' parens-color syntax removed from sequence diagrams — use 'tag:' groups for coloring`
        );
      }
      contentStarted = true;
      const section: SequenceSection = {
        kind: 'section',
        // Capture group 1 guaranteed present after successful match.
        label: colorMatch ? colorMatch[1]!.trim() : labelRaw,
        lineNumber,
      };
      result.sections.push(section);
      currentContainer().push(section);
      continue;
    }

    // Parse header key: value lines (always top-level)
    // Skip 'note' lines — parsed in the indent-aware section below
    const colonIndex = trimmed.indexOf(':');
    if (
      colonIndex > 0 &&
      !trimmed.includes('->') &&
      !trimmed.includes('~>') &&
      !trimmed.includes('<-') &&
      !trimmed.includes('<~') &&
      !trimmed.includes('|')
    ) {
      const key = trimmed.substring(0, colonIndex).trim().toLowerCase();
      if (key === 'note' || key.startsWith('note ')) {
        // Fall through to indent-aware note parsing below
      } else {
        const value = trimmed.substring(colonIndex + 1).trim();

        // Enforce headers-before-content
        if (contentStarted) {
          pushError(
            lineNumber,
            `Options like '${key}: ${value}' must appear before the first message or declaration`
          );
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

    // Parse space-separated options (no colon): `activations off`, `no-activations`, `active-tag Priority`
    {
      const optLower = trimmed.toLowerCase();
      // Negated boolean: `no-activations` → options.activations = 'off'
      if (optLower.startsWith('no-')) {
        const base = optLower.substring(3);
        if (KNOWN_SEQ_BOOLEANS.has(base)) {
          if (contentStarted) {
            pushError(
              lineNumber,
              `Options like '${trimmed}' must appear before the first message or declaration`
            );
            continue;
          }
          result.options[base] = 'off';
          continue;
        }
      }
      // Key-value option: `active-tag Priority`
      const spaceMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (spaceMatch) {
        // Capture groups 1 and 2 guaranteed present after successful match.
        const optKey = spaceMatch[1]!.toLowerCase();
        const optVal = spaceMatch[2]!.trim();
        if (KNOWN_SEQ_OPTIONS.has(optKey) || KNOWN_SEQ_BOOLEANS.has(optKey)) {
          if (contentStarted) {
            pushError(
              lineNumber,
              `Options like '${trimmed}' must appear before the first message or declaration`
            );
            continue;
          }
          result.options[optKey] = optVal;
          continue;
        }
      }
      // Bare boolean keyword: `solid-fill` / `no-title`
      if (
        KNOWN_SEQ_BOOLEANS.has(optLower) &&
        (optLower === 'solid-fill' || optLower === 'no-title')
      ) {
        if (contentStarted) {
          pushError(
            lineNumber,
            `Options like '${trimmed}' must appear before the first message or declaration`
          );
          continue;
        }
        result.options[optLower] = 'on';
        continue;
      }
    }

    // Parse "Name is a type [position N]" declarations (always top-level).
    // The legacy `aka Alias` modifier is no longer supported — Universal Name
    // Handling makes aliasing unnecessary because forgiving normalization
    // handles casing/whitespace differences automatically.
    // Skip lines starting with 'note' — handled by note parsing below.
    const { core: isACore, meta: isAMeta } = splitPipe(trimmed, lineNumber);
    const isAMatch = !/^note(\s|$)/i.test(trimmed)
      ? isACore.match(IS_A_PATTERN)
      : null;
    if (isAMatch) {
      contentStarted = true;
      // Capture groups 1 and 2 guaranteed present after successful match.
      const id = isAMatch[1]!;
      const typeStr = isAMatch[2]!.toLowerCase();
      let remainder = isAMatch[3]?.trim() || '';

      // Reject the 5 removed-type keywords with a hard parse error
      // (per Decision #2 / break-and-bump policy). Skip participant
      // registration for the bad line — downstream message references
      // will surface a "participant not declared" diagnostic, which
      // is the intended behavior.
      if (REMOVED_PARTICIPANT_TYPES.has(typeStr)) {
        result.diagnostics.push(
          makeDgmoError(
            lineNumber,
            participantTypeRemovedMessage(typeStr),
            'error',
            NAME_DIAGNOSTIC_CODES.PARTICIPANT_TYPE_REMOVED
          )
        );
        continue;
      }

      const participantType: ParticipantType = VALID_PARTICIPANT_TYPES.has(
        typeStr
      )
        ? (typeStr as ParticipantType)
        : 'default';

      // Reject removed-keyword modifiers via the guarded helper so a
      // developer adding new postfix modifiers (e.g. `as`) doesn't
      // accidentally re-invoke the rejection branch — see A2.
      const removed = isHardRemovedToken(remainder);
      if (removed.removed) {
        result.diagnostics.push(
          makeDgmoError(lineNumber, removed.message, 'error', removed.code)
        );
        continue;
      }

      // TD-18: extract trailing `as <alias>` from the remainder and
      // register it. Order on the line is `Name is a TYPE [position N] as <alias>`.
      // The leading `(.*?)\s*\b` allows the remainder to be just
      // `as <alias>` (empty prefix) — the canonical example writes
      // `Alice is an actor as a` where the entire remainder is `as a`.
      const asInRemainder = remainder.match(
        /^(.*?)\s*\bas\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/
      );
      if (asInRemainder) {
        // Capture groups 1 and 2 guaranteed present after successful match.
        nameAliasMap.set(asInRemainder[2]!, id);
        remainder = asInRemainder[1]!.trim();
      }

      const posMatch = remainder.match(/\bposition\s+(-?\d+)/i);
      // Capture group 1 guaranteed present after successful match.
      const position = posMatch ? parseInt(posMatch[1]!, 10) : undefined;

      // Avoid duplicate participant declarations
      const key = addParticipant(id, lineNumber, {
        type: participantType,
        ...(position !== undefined && { position }),
        ...(isAMeta !== undefined && { metadata: isAMeta }),
      });
      // Track group membership
      if (activeGroup && !activeGroup.participantIds.includes(key)) {
        const existingGroup = participantGroupMap.get(key);
        if (existingGroup) {
          pushError(
            lineNumber,
            `Participant '${id}' is already in group '${existingGroup}' — participants can only belong to one group`
          );
        } else {
          activeGroup.participantIds.push(key);
          // participantGroupMap is keyed by normalized participant key

          participantGroupMap.set(key, activeGroup.name);
        }
      }
      continue;
    }

    // Parse standalone "Name position N" (no "is a" type)
    const { core: posCore, meta: posMeta } = splitPipe(trimmed, lineNumber);
    const posOnlyMatch = posCore.match(POSITION_ONLY_PATTERN);
    if (posOnlyMatch) {
      contentStarted = true;
      // Capture groups 1 and 2 guaranteed present after successful match.
      const id = posOnlyMatch[1]!;
      const position = parseInt(posOnlyMatch[2]!, 10);

      const key = addParticipant(id, lineNumber, {
        position,
        ...(posMeta !== undefined && { metadata: posMeta }),
      });
      // Track group membership
      if (activeGroup && !activeGroup.participantIds.includes(key)) {
        const existingGroup = participantGroupMap.get(key);
        if (existingGroup) {
          pushError(
            lineNumber,
            `Participant '${id}' is already in group '${existingGroup}' — participants can only belong to one group`
          );
        } else {
          activeGroup.participantIds.push(key);

          participantGroupMap.set(key, activeGroup.name);
        }
      }
      continue;
    }

    // Legacy `Name(color)` participant declaration at any level (§1.5 hard
    // break). Scoped to the 11-name palette so `funcCall(arg)` doesn't trip.
    const { core: colorCore, meta: colorMeta } = splitPipe(trimmed, lineNumber);
    const coloredMatch = colorCore.match(COLORED_PARTICIPANT_PATTERN);
    if (coloredMatch && !ARROW_PATTERN.test(colorCore)) {
      // Capture groups 1 and 2 guaranteed present after successful match.
      const id = coloredMatch[1]!;
      const color = coloredMatch[2]!.trim();
      pushError(
        lineNumber,
        `'${id}(${color})' parens-color syntax is no longer supported — use 'tag:' groups for coloring`
      );
      contentStarted = true;
      const key = addParticipant(id, lineNumber, {
        ...(colorMeta !== undefined && { metadata: colorMeta }),
      });
      if (activeGroup && !activeGroup.participantIds.includes(key)) {
        const existingGroup = participantGroupMap.get(key);
        if (existingGroup) {
          pushError(
            lineNumber,
            `Participant '${id}' is already in group '${existingGroup}' — participants can only belong to one group`
          );
        } else {
          activeGroup.participantIds.push(key);

          participantGroupMap.set(key, activeGroup.name);
        }
      }
      continue;
    }

    // Bare participant name — either inside an active group (indented) or top-level declaration
    // Supports pipe metadata: "  API | c: Gateway" or "Tapin2 | l:Park"
    {
      const { core: bareCore, meta: bareMeta } = splitPipe(trimmed, lineNumber);
      const inGroup = activeGroup && measureIndent(raw) > 0;
      if (
        /^\S+$/.test(bareCore) &&
        !ARROW_PATTERN.test(bareCore) &&
        (inGroup || !contentStarted || bareMeta)
      ) {
        contentStarted = true;
        const id = bareCore;
        const key = addParticipant(id, lineNumber, {
          ...(bareMeta !== undefined && { metadata: bareMeta }),
        });
        if (activeGroup && !activeGroup.participantIds.includes(key)) {
          const existingGroup = participantGroupMap.get(key);
          if (existingGroup) {
            pushError(
              lineNumber,
              `Participant '${id}' is already in group '${existingGroup}' — participants can only belong to one group`
            );
          } else {
            activeGroup.participantIds.push(key);

            participantGroupMap.set(key, activeGroup.name);
          }
        }
        continue;
      }
    }

    // ---- Indent-aware parsing for messages and block keywords ----
    const indent = measureIndent(raw);

    // Close blocks whose scope has ended (indent decreased)
    while (blockStack.length > 0) {
      // In-bounds by the length check above.
      const top = blockStack[blockStack.length - 1]!;
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
    const { core: arrowCore, meta: arrowMeta } = splitPipe(trimmed, lineNumber);

    // Parse message lines first — arrows take priority over keywords
    // Reject "async" keyword prefix — use ~> instead
    const asyncPrefixMatch = arrowCore.match(/^async\s+(.+)$/i);
    // Capture group 1 guaranteed present after successful match.
    if (asyncPrefixMatch && ARROW_PATTERN.test(asyncPrefixMatch[1]!)) {
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
      const { from, to, label: rawLabel, async: isAsync } = labeledArrow;
      const fromKey = addParticipant(resolveAlias(from), lineNumber);
      const toKey = addParticipant(resolveAlias(to), lineNumber);
      lastMsgFrom = fromKey;

      // TD-13/TD-14: validate in-arrow label characters
      const labelResult = parseInArrowLabel(rawLabel, lineNumber);
      labelResult.diagnostics.forEach((d) => result.diagnostics.push(d));
      const label = labelResult.label ?? rawLabel;

      const msg: SequenceMessage = {
        from: fromKey,
        to: toKey,
        label,
        lineNumber,
        ...(isAsync ? { async: true } : {}),
        ...(arrowMeta ? { metadata: arrowMeta } : {}),
      };
      result.messages.push(msg);
      currentContainer().push(msg);
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
      // Capture groups 1-3 guaranteed present after successful match.
      const a = colonPostfix[1]!;
      const b = colonPostfix[2]!;
      const msg = colonPostfix[3]!.trim();
      const arrowChar = colonPostfixAsync ? '~' : '-';
      const arrowEnd = colonPostfixAsync ? '~>' : '->';
      pushError(
        lineNumber,
        `Colon syntax is no longer supported. Use '${a} ${arrowChar}${msg}${arrowEnd} ${b}' instead`
      );
      continue;
    }

    // ---- Error: plain bidirectional arrows (A <-> B, A <~> B) ----
    const bidiPlainMatch = arrowCore.match(/^(.+?)\s*(?:<->|<~>)\s*(.+)/);
    if (bidiPlainMatch) {
      pushError(
        lineNumber,
        "Bidirectional arrows are no longer supported. Use two separate lines: 'A -msg-> B' and 'B -msg-> A'"
      );
      continue;
    }

    // ---- Deprecated bare return arrows: A <- B, A <~ B ----
    const bareReturnSync = arrowCore.match(/^(.+?)\s*<-\s*(.+)$/);
    const bareReturnAsync = arrowCore.match(/^(.+?)\s*<~\s*(.+)$/);
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
      // Capture groups 1 and 2 guaranteed present after successful match.
      const from = bareCall[1]!;
      const to = bareCall[2]!;
      const fromKey = addParticipant(resolveAlias(from), lineNumber);
      const toKey = addParticipant(resolveAlias(to), lineNumber);
      lastMsgFrom = fromKey;

      const msg: SequenceMessage = {
        from: fromKey,
        to: toKey,
        label: '',
        lineNumber,
        ...(bareCallAsync ? { async: true } : {}),
        ...(arrowMeta ? { metadata: arrowMeta } : {}),
      };
      result.messages.push(msg);
      currentContainer().push(msg);
      continue;
    }

    // Parse 'if <label>' block keyword
    const ifMatch = trimmed.match(/^if\s+(.+)$/i);
    if (ifMatch) {
      contentStarted = true;
      const block: SequenceBlock = {
        kind: 'block',
        type: 'if',
        // Capture group 1 guaranteed present after successful match.
        label: ifMatch[1]!.trim(),
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
        // Capture group 1 guaranteed present after successful match.
        label: loopMatch[1]!.trim(),
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
      if (
        blockStack.length > 0 &&
        // In-bounds by the length check above.
        blockStack[blockStack.length - 1]!.indent === indent
      ) {
        // In-bounds by the length check above.
        const top = blockStack[blockStack.length - 1]!;
        if (top.block.type === 'parallel') {
          pushError(
            lineNumber,
            "parallel blocks don't support else if — list all concurrent messages directly inside the block"
          );
          continue;
        }
        if (top.block.type === 'if') {
          const branch: ElseIfBranch = {
            // Capture group 1 guaranteed present after successful match.
            label: elseIfMatch[1]!.trim(),
            children: [],
            lineNumber,
          };
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
      if (
        blockStack.length > 0 &&
        // In-bounds by the length check above.
        blockStack[blockStack.length - 1]!.indent === indent
      ) {
        // In-bounds by the length check above.
        const top = blockStack[blockStack.length - 1]!;
        if (top.block.type === 'parallel') {
          pushError(
            lineNumber,
            "parallel blocks don't support else — list all concurrent messages directly inside the block"
          );
          continue;
        }
        if (top.block.type === 'if') {
          top.inElse = true;
          delete top.activeElseIfBranch;
          top.block.elseLineNumber = lineNumber;
        }
      }
      continue;
    }

    // 'elif <label>' → suggest 'else if <label>'
    const elifMatch = trimmed.match(/^elif\b\s*(.*)$/i);
    if (elifMatch) {
      // Capture group 1 guaranteed present after successful match.
      const tailRaw = elifMatch[1]!.trim();
      const tail = tailRaw ? ' ' + tailRaw : '';
      pushError(
        lineNumber,
        `'elif' is not a keyword. Did you mean 'else if${tail}'?`
      );
      continue;
    }

    // 'else <text>' (where text isn't 'if …') → suggest 'else if <text>'
    const elseLabelMatch = trimmed.match(/^else\s+(.+)$/i);
    if (elseLabelMatch) {
      // Capture group 1 guaranteed present after successful match.
      const tail = elseLabelMatch[1]!.trim();
      pushError(
        lineNumber,
        `'else' does not take a label. Did you mean 'else if ${tail}'?`
      );
      continue;
    }

    // ---- Note parsing (space-separated only) ----
    // Strategy:
    // 1. Try bare note: `note text` — position defaults, text is everything after `note`
    // 2. For positioned: `note left [of] X text` — needs participant lookup to split name vs text
    // 3. Multi-line: `note`, `note right`, `note right [of] X` (body indented below)
    {
      const noteParsed = parseNoteLine(
        trimmed,
        result.participants,
        participantIds,
        getSortedParticipants(),
        lastMsgFrom
      );
      if (noteParsed) {
        if (noteParsed.kind === 'single') {
          const note: SequenceNote = {
            kind: 'note',
            text: noteParsed.text,
            position: noteParsed.position,
            participantId: noteParsed.participantId,
            lineNumber,
            endLineNumber: lineNumber,
          };
          currentContainer().push(note);
          continue;
        }
        if (noteParsed.kind === 'multi-head') {
          // Collect indented body lines
          const noteLines: string[] = [];
          while (i + 1 < lines.length) {
            // In-bounds by the length check above.
            const nextRaw = lines[i + 1]!;
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
            position: noteParsed.position,
            participantId: noteParsed.participantId,
            lineNumber,
            endLineNumber: i + 1, // i has advanced past the body lines (1-based)
          };
          currentContainer().push(note);
          continue;
        }
        // 'skip' — note was incomplete (no preceding message, unknown participant)
        continue;
      }
    }

    // Catch-all: nothing matched this line
    pushWarning(lineNumber, `Unexpected line: '${trimmed}'.`);
  }

  // Validate: if no explicit chart line, check for arrow-based inference
  if (!hasExplicitChart && result.messages.length === 0) {
    // Check if raw content has arrow patterns for inference
    const hasArrows = lines.some((line) => ARROW_PATTERN.test(line.trim()));
    if (!hasArrows) {
      return fail(1, 'No "sequence" header and no sequence content detected');
    }
  }

  // Warn about unused participants (only when the diagram has messages)
  if (result.messages.length > 0) {
    const usedIds = new Set<string>();
    for (const msg of result.messages) {
      // msg.from / msg.to / el.participantId are normalized participant keys
      // (set via addParticipant during parsing)
      // eslint-disable-next-line name-normalize/required-at-insertion
      usedIds.add(msg.from);
      // eslint-disable-next-line name-normalize/required-at-insertion
      usedIds.add(msg.to);
    }
    // Walk elements recursively to find note participant references
    const walkElements = (elements: SequenceElement[]): void => {
      for (const el of elements) {
        if (isSequenceNote(el)) {
          // eslint-disable-next-line name-normalize/required-at-insertion
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
        pushWarning(
          p.lineNumber,
          `Participant "${p.label}" is declared but never used in any message or note`
        );
      }
    }
  }

  // Warn about empty groups
  for (const group of result.groups) {
    if (group.participantIds.length === 0) {
      pushWarning(
        group.lineNumber,
        `Empty group '${group.name}' — did you mean '== ${group.name} ==' for a section divider?`
      );
    }
  }

  // Validate tag group values on participants and messages
  if (result.tagGroups.length > 0) {
    const entities: Array<{
      metadata: Record<string, string>;
      lineNumber: number;
    }> = [];
    for (const p of result.participants) {
      if (p.metadata)
        entities.push({ metadata: p.metadata, lineNumber: p.lineNumber });
    }
    for (const m of result.messages) {
      if (m.metadata)
        entities.push({ metadata: m.metadata, lineNumber: m.lineNumber });
    }
    for (const g of result.groups) {
      if (g.metadata)
        entities.push({ metadata: g.metadata, lineNumber: g.lineNumber });
    }
    validateTagValues(entities, result.tagGroups, pushWarning, suggest);
    validateTagGroupNames(result.tagGroups, pushWarning, pushError);
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
