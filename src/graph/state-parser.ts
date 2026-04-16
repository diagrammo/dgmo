import { resolveColorWithDiagnostic } from '../colors';
import type { DgmoError } from '../diagnostics';
import type { PaletteColors } from '../palettes';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import { parseInArrowLabel, matchColorParens } from '../utils/arrows';
import {
  measureIndent,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  ALL_CHART_TYPES,
} from '../utils/parsing';
import type { ParsedGraph, GraphNode, GraphGroup } from './types';

// ============================================================
// Constants
// ============================================================

const PSEUDOSTATE_ID = 'pseudostate:[*]';
const PSEUDOSTATE_LABEL = '[*]';

const GROUP_BRACKET_RE = /^\[([^\]]+)\](?:\(([^)]+)\))?\s*$/;

// ============================================================
// Arrow splitter
// ============================================================

/**
 * Split a line on `->` arrows, returning alternating segments:
 * [nodeText, arrowToken, nodeText, ...]
 *
 * Arrows: `->`, `-label->`, `-(color)->`, `-label(color)->`
 */
function splitArrows(line: string): string[] {
  // Mirrors flowchart-parser.ts splitArrows. TD-9 longest-match: arrow token
  // is the maximal run of `-+>`. See that file for the full algorithm rationale.
  const segments: string[] = [];
  const arrowPositions: {
    start: number;
    end: number;
    label?: string;
    color?: string;
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
    let color: string | undefined;

    let openingStart = -1;
    for (let i = scanFloor; i < runStart; i++) {
      if (line[i] !== '-') continue;
      const prevIsWsOrFloor =
        i === 0 || i === scanFloor || /\s/.test(line[i - 1]);
      if (prevIsWsOrFloor) {
        openingStart = i;
        break;
      }
    }

    if (openingStart !== -1) {
      let openingEnd = openingStart;
      while (openingEnd < runStart && line[openingEnd] === '-') openingEnd++;

      const arrowContent = line.substring(openingEnd, runStart);
      const colorMatch = arrowContent.match(/\(([^)]+)\)\s*$/);
      if (colorMatch) {
        color = colorMatch[1].trim();
        const labelPart = arrowContent.substring(0, colorMatch.index!).trim();
        if (labelPart) label = labelPart;
      } else {
        const labelPart = arrowContent.trim();
        if (labelPart) label = labelPart;
      }
      arrowStart = openingStart;
    } else {
      arrowStart = runStart;
    }

    arrowPositions.push({ start: arrowStart, end: arrowEnd, label, color });
    searchFrom = arrowEnd;
    scanFloor = arrowEnd;
  }

  if (arrowPositions.length === 0) return [line];

  let lastIndex = 0;
  for (let i = 0; i < arrowPositions.length; i++) {
    const arrow = arrowPositions[i];
    const beforeText = line.substring(lastIndex, arrow.start).trim();
    if (beforeText || i === 0) segments.push(beforeText);

    let arrowToken = '->';
    if (arrow.label && arrow.color)
      arrowToken = `-${arrow.label}(${arrow.color})->`;
    else if (arrow.label) arrowToken = `-${arrow.label}->`;
    else if (arrow.color) arrowToken = `-(${arrow.color})->`;
    segments.push(arrowToken);
    lastIndex = arrow.end;
  }
  const remaining = line.substring(lastIndex).trim();
  if (remaining) segments.push(remaining);

  return segments;
}

interface ArrowInfo {
  label?: string;
  color?: string;
}

function parseArrowToken(
  token: string,
  palette: PaletteColors | undefined,
  lineNumber: number,
  diagnostics: DgmoError[]
): ArrowInfo {
  if (token === '->') return {};
  // TD-11: `-(X)->` is a color if and only if X is a recognized palette
  // color; otherwise the whole `(X)` becomes the label. Delegate recognition
  // to the shared `matchColorParens` helper.
  const bareParen = token.match(/^-(\([A-Za-z]+\))->$/);
  if (bareParen) {
    const colorName = matchColorParens(bareParen[1]);
    if (colorName) {
      return {
        color: resolveColorWithDiagnostic(
          colorName,
          lineNumber,
          diagnostics,
          palette
        ),
      };
    }
    // fall through — whole `(X)` becomes label
  }
  const m = token.match(/^-(.+?)(?:\(([^)]+)\))?->$/);
  if (m) {
    const rawLabel = m[1] ?? '';
    const labelResult = parseInArrowLabel(rawLabel, lineNumber);
    diagnostics.push(...labelResult.diagnostics);
    const label = labelResult.label;
    const color = m[2]
      ? resolveColorWithDiagnostic(
          m[2].trim(),
          lineNumber,
          diagnostics,
          palette
        )
      : undefined;
    return { label, color };
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
    id: `state:${label.toLowerCase().trim()}`,
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
  const result: ParsedGraph = {
    type: 'state',
    direction: 'LR',
    nodes: [],
    edges: [],
    options: {},
    diagnostics: [],
    error: null,
  };

  const fail = (line: number, message: string): ParsedGraph => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const nodeMap = new Map<string, GraphNode>();
  const indentStack: { nodeId: string; indent: number }[] = [];
  let currentGroup: GraphGroup | null = null;
  let groupIndent = -1;
  const groups: GraphGroup[] = [];
  let contentStarted = false;
  let firstLineParsed = false;

  function getOrCreateNode(ref: NodeRef, lineNumber: number): GraphNode {
    const existing = nodeMap.get(ref.id);
    if (existing) return existing;

    const node: GraphNode = {
      id: ref.id,
      label: ref.label,
      shape: ref.shape,
      lineNumber,
      ...(ref.color && { color: ref.color }),
      ...(currentGroup && { group: currentGroup.id }),
    };
    nodeMap.set(ref.id, node);
    result.nodes.push(node);

    if (currentGroup && !currentGroup.nodeIds.includes(ref.id)) {
      currentGroup.nodeIds.push(ref.id);
    }

    return node;
  }

  function addEdge(
    sourceId: string,
    targetId: string,
    lineNumber: number,
    label?: string,
    color?: string
  ): void {
    result.edges.push({
      source: sourceId,
      target: targetId,
      lineNumber,
      ...(label && { label }),
      ...(color && { color }),
    });
  }

  // === Main loop ===
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
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

    // Group brackets: [Name] or [Name](color)
    const groupMatch = trimmed.match(GROUP_BRACKET_RE);
    if (groupMatch && groupMatch[1].trim() !== '*') {
      const groupLabel = groupMatch[1].trim();
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

      const optMatch = trimmed.match(OPTION_NOCOLON_RE);
      if (optMatch && !trimmed.includes('->')) {
        const key = optMatch[1].toLowerCase();
        const value = optMatch[2].trim();

        // Boolean: no-color = color off
        if (key === 'no-color') {
          result.options['color'] = 'off';
          continue;
        }

        result.options[key] = value;
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
      const top = indentStack[indentStack.length - 1];
      if (top.indent >= indent) {
        indentStack.pop();
      } else {
        break;
      }
    }

    const implicitSourceId =
      indentStack.length > 0
        ? indentStack[indentStack.length - 1].nodeId
        : null;

    const segments = splitArrows(trimmed);

    if (segments.length === 1) {
      // Single state reference, no arrows — this is the canonical definition
      const ref = parseStateNodeRef(segments[0]);
      if (ref) {
        const node = getOrCreateNode(ref, lineNumber);
        // Standalone heading is the "definition" — update lineNumber so
        // clicking the node in the preview navigates here, not to the
        // first edge mention.
        node.lineNumber = lineNumber;
        indentStack.push({ nodeId: node.id, indent });
      }
      continue;
    }

    // Process chain: alternating nodeText / arrowToken / nodeText / ...
    let lastNodeId: string | null = null;
    let pendingArrow: ArrowInfo | null = null;

    for (let j = 0; j < segments.length; j++) {
      const seg = segments[j];

      if (seg === '->' || /^-.+->$/.test(seg)) {
        pendingArrow = parseArrowToken(
          seg,
          palette,
          lineNumber,
          result.diagnostics
        );
        continue;
      }

      const ref = parseStateNodeRef(seg);
      if (!ref) continue;

      const node = getOrCreateNode(ref, lineNumber);

      if (pendingArrow !== null) {
        // Use explicit source if available, else implicit from indent
        const sourceId = lastNodeId ?? implicitSourceId;
        if (sourceId) {
          addEdge(
            sourceId,
            node.id,
            lineNumber,
            pendingArrow.label,
            pendingArrow.color
          );
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
      connectedIds.add(edge.source);
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
