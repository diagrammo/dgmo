import { resolveColorWithDiagnostic } from '../colors';
import type { DgmoError } from '../diagnostics';
import type { PaletteColors } from '../palettes';
import {
  makeDgmoError,
  formatDgmoError,
  suggest,
  NAME_DIAGNOSTIC_CODES,
  nameMergedMessage,
} from '../diagnostics';
import { parseInArrowLabel } from '../utils/arrows';
import {
  measureIndent,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  ALL_CHART_TYPES,
  tryParseSharedOption,
  extractColor,
} from '../utils/parsing';
import { normalizeName, displayName } from '../utils/name-normalize';
import type { Writable } from '../utils/brand';
import type { ParsedGraph, GraphNode, GraphGroup, GraphNote } from './types';
import { parseNoteHeader, collectNoteBody, resolveNotes } from './notes';

// ============================================================
// Constants
// ============================================================

const PSEUDOSTATE_ID = 'pseudostate:[*]';
const PSEUDOSTATE_LABEL = '[*]';

// `[Group]` or `[Group] color` (universal §1.5 trailing-token).
// Color (group 2) must be a recognized lowercase palette word.
const GROUP_BRACKET_RE =
  /^\[([^\]]+)\](?:\s+(red|orange|yellow|green|blue|purple|teal|cyan|gray|black|white))?\s*$/;

// ============================================================
// Arrow splitter
// ============================================================

/**
 * Split a line on `->` arrows, returning alternating segments:
 * [nodeText, arrowToken, nodeText, ...]
 *
 * Arrows: `->`, `-label->`. Edges have no color slot (spec §1.7).
 */
function splitArrows(line: string): string[] {
  // Mirrors flowchart-parser.ts splitArrows. TD-9 longest-match: arrow token
  // is the maximal run of `-+>`. See that file for the full algorithm rationale.
  const segments: string[] = [];
  const arrowPositions: {
    start: number;
    end: number;
    label?: string;
  }[] = [];

  let searchFrom = 0;
  let scanFloor = 0;
  while (searchFrom < line.length) {
    const idx = line.indexOf('->', searchFrom);
    if (idx === -1) break;

    let runStart = idx;
    while (runStart > scanFloor && line[runStart - 1] === '-') runStart--;
    const arrowEnd = idx + 2;

    let arrowStart: number;
    let label: string | undefined;

    let openingStart = -1;
    for (let i = scanFloor; i < runStart; i++) {
      if (line[i] !== '-') continue;
      const prevIsWsOrFloor =
        i === 0 || i === scanFloor || /\s/.test(line.charAt(i - 1));
      if (prevIsWsOrFloor) {
        openingStart = i;
        break;
      }
    }

    if (openingStart !== -1) {
      let openingEnd = openingStart;
      while (openingEnd < runStart && line[openingEnd] === '-') openingEnd++;

      const labelPart = line.substring(openingEnd, runStart).trim();
      if (labelPart) label = labelPart;
      arrowStart = openingStart;
    } else {
      arrowStart = runStart;
    }

    arrowPositions.push({
      start: arrowStart,
      end: arrowEnd,
      ...(label !== undefined && { label }),
    });
    searchFrom = arrowEnd;
    scanFloor = arrowEnd;
  }

  if (arrowPositions.length === 0) return [line];

  let lastIndex = 0;
  for (let i = 0; i < arrowPositions.length; i++) {
    // In-bounds by loop guard.
    const arrow = arrowPositions[i]!;
    const beforeText = line.substring(lastIndex, arrow.start).trim();
    if (beforeText || i === 0) segments.push(beforeText);

    const arrowToken = arrow.label ? `-${arrow.label}->` : '->';
    segments.push(arrowToken);
    lastIndex = arrow.end;
  }
  const remaining = line.substring(lastIndex).trim();
  if (remaining) segments.push(remaining);

  return segments;
}

interface ArrowInfo {
  label?: string;
}

function parseArrowToken(
  token: string,
  _palette: PaletteColors | undefined,
  lineNumber: number,
  diagnostics: DgmoError[]
): ArrowInfo {
  if (token === '->') return {};
  // Edges have no color slot (§1.7); arrow content between `-` and `->`
  // is pure label text.
  const m = token.match(/^-(.+?)->$/);
  if (m) {
    const rawLabel = m[1] ?? '';
    const labelResult = parseInArrowLabel(rawLabel, lineNumber);
    diagnostics.push(...labelResult.diagnostics);
    return {
      ...(labelResult.label !== undefined && { label: labelResult.label }),
    };
  }
  return {};
}

// ============================================================
// Node ref parser
// ============================================================

interface NodeRef {
  id: string;
  label: string;
  shape: 'state' | 'pseudostate';
  color?: string;
}

function parseStateNodeRef(text: string): NodeRef | null {
  const t = text.trim();
  if (!t) return null;

  // Pseudostate: [*]
  if (t === '[*]') {
    return {
      id: PSEUDOSTATE_ID,
      label: PSEUDOSTATE_LABEL,
      shape: 'pseudostate',
    };
  }

  // State: bare text
  const label = t;
  if (!label) return null;
  return {
    id: `state:${normalizeName(label)}`,
    label,
    shape: 'state',
  };
}

// ============================================================
// Main parser
// ============================================================

export function parseState(
  content: string,
  palette?: PaletteColors
): ParsedGraph {
  const lines = content.split('\n');
  const options: Record<string, string> = {};
  const result: Writable<ParsedGraph> = {
    type: 'state',
    direction: 'LR',
    nodes: [],
    edges: [],
    options,
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedGraph => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const nodeMap = new Map<string, Writable<GraphNode>>();
  const indentStack: { nodeId: string; indent: number }[] = [];
  const notes: GraphNote[] = [];
  let currentGroup: Writable<GraphGroup> | null = null;
  let groupIndent = -1;
  const groups: Writable<GraphGroup>[] = [];
  let contentStarted = false;
  let firstLineParsed = false;

  // Per-parse alias literal → canonical node id (TD-18). Per C8.
  const nameAliasMap = new Map<string, string>();
  function peelAlias(seg: string): { seg: string; alias?: string } {
    const trimmed = seg.trim();
    const m = trimmed.match(/^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/);
    if (!m) return { seg: trimmed };
    // Regex capture groups 1 and 2 are guaranteed by the match above.
    return { seg: m[1]!.trim(), alias: m[2]! };
  }

  function getOrCreateNode(
    ref: NodeRef,
    lineNumber: number
  ): Writable<GraphNode> {
    const key = ref.id;
    const existing = nodeMap.get(key);
    if (existing) {
      const incomingDisplay = displayName(ref.label);
      const existingDisplay = displayName(existing.label);
      if (incomingDisplay !== existingDisplay) {
        result.diagnostics.push(
          makeDgmoError(
            lineNumber,
            nameMergedMessage({
              incomingDisplay,
              incomingLine: lineNumber,
              existingDisplay,
              existingLine: existing.lineNumber,
            }),
            'warning',
            NAME_DIAGNOSTIC_CODES.NAME_MERGED
          )
        );
      }
      return existing;
    }

    const node: Writable<GraphNode> = {
      id: key,
      label: ref.label,
      shape: ref.shape,
      lineNumber,
      ...(ref.color && { color: ref.color }),
      ...(currentGroup && { group: currentGroup.id }),
    };
    nodeMap.set(key, node);
    result.nodes.push(node);

    if (currentGroup && !currentGroup.nodeIds.includes(key)) {
      currentGroup.nodeIds.push(key);
    }

    return node;
  }

  function addEdge(
    sourceId: string,
    targetId: string,
    lineNumber: number,
    label?: string
  ): void {
    result.edges.push({
      source: sourceId,
      target: targetId,
      lineNumber,
      ...(label && { label }),
    });
  }

  // === Main loop ===
  for (let i = 0; i < lines.length; i++) {
    // In-bounds by loop guard.
    const raw = lines[i]!;
    const trimmed = raw.trim();
    const lineNumber = i + 1;
    const indent = measureIndent(raw);

    if (!trimmed) continue;
    if (trimmed.startsWith('//')) continue;

    // First line: try parseFirstLine for `state [Title]`
    if (!firstLineParsed && !contentStarted) {
      const firstLineResult = parseFirstLine(trimmed);
      if (firstLineResult) {
        firstLineParsed = true;
        if (firstLineResult.chartType !== 'state') {
          const allTypes = Array.from(ALL_CHART_TYPES);
          let msg = `Expected chart type "state", got "${firstLineResult.chartType}"`;
          const hint = suggest(firstLineResult.chartType, allTypes);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        if (firstLineResult.title) {
          result.title = firstLineResult.title;
          result.titleLineNumber = lineNumber;
        }
        continue;
      }
    }

    // Note annotation: `note <ref> [inline body]` + optional indented
    // body. Only `note -> X` (arrow immediately after `note`) is excluded
    // so a transition FROM a state named "note" still parses; arrows are
    // allowed inside a note body.
    const noteMatch = trimmed.match(/^note\s+(.+)$/i);
    if (noteMatch && !/^note\s+->/i.test(trimmed)) {
      // Trailing lowercase color word colors the note (§1.5 convention);
      // capitalize it to keep it as literal body text.
      const { label: headerNoColor, color } = extractColor(
        noteMatch[1]!,
        palette,
        result.diagnostics,
        lineNumber
      );
      const { ref, inlineBody } = parseNoteHeader(headerNoColor);
      const collected = collectNoteBody(lines, i, indent, inlineBody);
      if (!collected.body.trim()) {
        result.diagnostics.push(
          makeDgmoError(
            lineNumber,
            `Note on "${ref}" has no text — ignored.`,
            'warning'
          )
        );
      } else {
        notes.push({
          ref,
          body: collected.body,
          ...(color && { color }),
          lineNumber,
          endLineNumber: collected.endLineNumber,
        });
      }
      i = collected.lastIndex;
      continue;
    }

    // Group brackets: [Name] or [Name](color)
    const groupMatch = trimmed.match(GROUP_BRACKET_RE);
    // Regex capture group 1 is mandatory in GROUP_BRACKET_RE.
    if (groupMatch && groupMatch[1]!.trim() !== '*') {
      const groupLabel = groupMatch[1]!.trim();
      const groupColorName = groupMatch[2]?.trim();
      const groupColor = groupColorName
        ? resolveColorWithDiagnostic(
            groupColorName,
            lineNumber,
            result.diagnostics,
            palette
          )
        : undefined;

      currentGroup = {
        id: `group:${groupLabel.toLowerCase()}`,
        label: groupLabel,
        nodeIds: [],
        lineNumber,
        ...(groupColor && { color: groupColor }),
      };
      groupIndent = indent;
      groups.push(currentGroup);
      continue;
    }

    // Options (space-separated, before content)
    if (!contentStarted) {
      // Bare boolean: direction-tb
      if (/^direction-tb$/i.test(trimmed)) {
        result.direction = 'TB';
        continue;
      }

      // Bare boolean: solid-fill
      if (/^solid-fill$/i.test(trimmed)) {
        options['solid-fill'] = 'on';
        continue;
      }

      if (/^no-color$/i.test(trimmed)) {
        result.diagnostics.push(
          makeDgmoError(lineNumber, '"no-color" has been removed.', 'warning')
        );
        continue;
      }

      // Cross-chart-type bare booleans (no-title, etc.)
      if (tryParseSharedOption(trimmed, options)) {
        continue;
      }

      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch && !trimmed.includes('->')) {
        // Regex capture groups 1 and 2 are mandatory in OPTION_NOCOLON_RE.
        const key = optMatch[1]!.toLowerCase();
        const value = optMatch[2]!.trim();

        if (key === 'no-color') {
          result.diagnostics.push(
            makeDgmoError(lineNumber, '"no-color" has been removed.', 'warning')
          );
          continue;
        }

        options[key] = value;
        continue;
      }
    }

    // Content line — nodes and edges
    contentStarted = true;

    // Close current group when indent returns to or below the bracket level
    if (currentGroup && indent <= groupIndent) {
      currentGroup = null;
      groupIndent = -1;
    }

    // Pop indent stack entries at same or deeper indent
    while (indentStack.length > 0) {
      // In-bounds by length check above.
      const top = indentStack[indentStack.length - 1]!;
      if (top.indent >= indent) {
        indentStack.pop();
      } else {
        break;
      }
    }

    const implicitSourceId =
      indentStack.length > 0
        ? // In-bounds by length check above.
          indentStack[indentStack.length - 1]!.nodeId
        : null;

    const segments = splitArrows(trimmed);

    if (segments.length === 1) {
      // Single state reference, no arrows — this is the canonical definition
      // In-bounds by length check above.
      const peeled = peelAlias(segments[0]!);
      const ref = parseStateNodeRef(peeled.seg);
      if (ref) {
        const node = getOrCreateNode(ref, lineNumber);
        if (peeled.alias) nameAliasMap.set(peeled.alias, node.id);
        // Standalone heading is the "definition" — update lineNumber so
        // clicking the node in the preview navigates here, not to the
        // first edge mention.
        node.lineNumber = lineNumber;
        indentStack.push({ nodeId: node.id, indent });
      } else {
        // Bare alias-only line: `os` resolves to a previously declared node.
        const aliasResolved = nameAliasMap.get(peeled.seg.trim());
        if (aliasResolved !== undefined) {
          indentStack.push({ nodeId: aliasResolved, indent });
        }
      }
      continue;
    }

    // Process chain: alternating nodeText / arrowToken / nodeText / ...
    let lastNodeId: string | null = null;
    let pendingArrow: ArrowInfo | null = null;

    for (let j = 0; j < segments.length; j++) {
      // In-bounds by loop guard.
      const seg = segments[j]!;

      if (seg === '->' || /^-.+->$/.test(seg)) {
        pendingArrow = parseArrowToken(
          seg,
          palette,
          lineNumber,
          result.diagnostics
        );
        continue;
      }

      const peeled = peelAlias(seg);
      let ref = parseStateNodeRef(peeled.seg);
      if (!ref) {
        const aliasResolved = nameAliasMap.get(peeled.seg.trim());
        if (aliasResolved !== undefined) {
          const existing = nodeMap.get(aliasResolved);
          if (existing) {
            // Narrow to state shapes — alias-resolution can only point
            // at nodes the parser itself created, so the shape is
            // guaranteed to be 'state' or 'pseudostate'.
            const shape = existing.shape as 'state' | 'pseudostate';
            ref = {
              id: aliasResolved,
              label: existing.label,
              shape,
            };
          }
        }
      }
      if (!ref) continue;

      const node = getOrCreateNode(ref, lineNumber);
      if (peeled.alias) nameAliasMap.set(peeled.alias, node.id);

      if (pendingArrow !== null) {
        // Use explicit source if available, else implicit from indent
        const sourceId = lastNodeId ?? implicitSourceId;
        if (sourceId) {
          addEdge(sourceId, node.id, lineNumber, pendingArrow.label);
        }
        pendingArrow = null;
      }

      lastNodeId = node.id;
    }

    if (lastNodeId) {
      indentStack.push({ nodeId: lastNodeId, indent });
    }
  }

  if (groups.length > 0) result.groups = groups;

  // Resolve note refs against the state node map (forward refs OK).
  if (notes.length > 0) {
    result.notes = notes;
    resolveNotes(notes, result.nodes, result.diagnostics);
  }

  // Validation: no nodes found
  if (result.nodes.length === 0 && !result.error) {
    const diag = makeDgmoError(
      1,
      'No states found. Add state transitions like: Idle -> Active'
    );
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }

  // Warn about orphaned states
  if (result.nodes.length >= 2 && result.edges.length >= 1 && !result.error) {
    const connectedIds = new Set<string>();
    for (const edge of result.edges) {
      // edge endpoints are already-normalized node IDs (set via getOrCreateNode)
      // eslint-disable-next-line name-normalize/required-at-insertion
      connectedIds.add(edge.source);
      // eslint-disable-next-line name-normalize/required-at-insertion
      connectedIds.add(edge.target);
    }
    for (const node of result.nodes) {
      if (!connectedIds.has(node.id)) {
        result.diagnostics.push(
          makeDgmoError(
            node.lineNumber,
            `State "${node.label}" is not connected to any other state`,
            'warning'
          )
        );
      }
    }
  }

  return result;
}

// ============================================================
// Detection helper
// ============================================================

/**
 * Detect if content looks like a state diagram (without explicit `chart: state` header).
 * Only matches if `[*]` token is present — too ambiguous to infer from bare names alone.
 */
export function looksLikeState(content: string): boolean {
  // Must have [*] token (start/end pseudostate) and -> arrows
  return content.includes('[*]') && content.includes('->');
}
