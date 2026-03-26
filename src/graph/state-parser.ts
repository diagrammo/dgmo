import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';
import { makeDgmoError, formatDgmoError, suggest } from '../diagnostics';
import { measureIndent, extractColor, normalizeDirection } from '../utils/parsing';
import type {
  ParsedGraph,
  GraphNode,
  GraphGroup,
  GraphDirection,
} from './types';

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
  const segments: string[] = [];
  const arrowPositions: { start: number; end: number; label?: string; color?: string }[] = [];

  let searchFrom = 0;
  while (searchFrom < line.length) {
    const idx = line.indexOf('->', searchFrom);
    if (idx === -1) break;

    let arrowStart = idx;
    let label: string | undefined;
    let color: string | undefined;

    if (idx > 0 && line[idx - 1] !== ' ' && line[idx - 1] !== '\t') {
      let scanBack = idx - 1;
      while (scanBack > 0 && line[scanBack] !== '-') {
        scanBack--;
      }
      if (line[scanBack] === '-' && (scanBack === 0 || /\s/.test(line[scanBack - 1]))) {
        let arrowContent = line.substring(scanBack + 1, idx);
        if (arrowContent.endsWith('-')) arrowContent = arrowContent.slice(0, -1);
        const colorMatch = arrowContent.match(/\(([^)]+)\)\s*$/);
        if (colorMatch) {
          color = colorMatch[1].trim();
          const labelPart = arrowContent.substring(0, colorMatch.index!).trim();
          if (labelPart) label = labelPart;
        } else {
          const labelPart = arrowContent.trim();
          if (labelPart) label = labelPart;
        }
        arrowStart = scanBack;
      }
    }

    arrowPositions.push({ start: arrowStart, end: idx + 2, label, color });
    searchFrom = idx + 2;
  }

  if (arrowPositions.length === 0) return [line];

  let lastIndex = 0;
  for (let i = 0; i < arrowPositions.length; i++) {
    const arrow = arrowPositions[i];
    const beforeText = line.substring(lastIndex, arrow.start).trim();
    if (beforeText || i === 0) segments.push(beforeText);

    let arrowToken = '->';
    if (arrow.label && arrow.color) arrowToken = `-${arrow.label}(${arrow.color})->`;
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

function parseArrowToken(token: string, palette?: PaletteColors): ArrowInfo {
  if (token === '->') return {};
  const colorOnly = token.match(/^-\(([^)]+)\)->$/);
  if (colorOnly) return { color: resolveColor(colorOnly[1].trim(), palette) ?? undefined };
  const m = token.match(/^-(.+?)(?:\(([^)]+)\))?->$/);
  if (m) {
    const label = m[1]?.trim() || undefined;
    const color = m[2] ? resolveColor(m[2].trim(), palette) ?? undefined : undefined;
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

function parseStateNodeRef(text: string, palette?: PaletteColors): NodeRef | null {
  const t = text.trim();
  if (!t) return null;

  // Pseudostate: [*]
  if (t === '[*]') {
    return { id: PSEUDOSTATE_ID, label: PSEUDOSTATE_LABEL, shape: 'pseudostate' };
  }

  // State: bare text with optional (color) suffix
  const { label, color } = extractColor(t, palette);
  if (!label) return null;
  return {
    id: `state:${label.toLowerCase().trim()}`,
    label,
    shape: 'state',
    color,
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
    direction: 'TB',
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

    // Group brackets: [Name] or [Name](color)
    const groupMatch = trimmed.match(GROUP_BRACKET_RE);
    if (groupMatch && groupMatch[1].trim() !== '*') {
      const groupLabel = groupMatch[1].trim();
      const groupColorName = groupMatch[2]?.trim();
      const groupColor = groupColorName
        ? resolveColor(groupColorName, palette)
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

    // Metadata directives (before content)
    if (!contentStarted && trimmed.includes(':') && !trimmed.includes('->')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.substring(0, colonIdx).trim().toLowerCase();
      const value = trimmed.substring(colonIdx + 1).trim();

      if (key === 'chart') {
        if (value.toLowerCase() !== 'state') {
          const allTypes = ['state', 'flowchart', 'sequence', 'class', 'er', 'org', 'bar', 'line', 'pie', 'scatter', 'sankey', 'venn', 'timeline', 'arc', 'slope'];
          let msg = `Expected chart type "state", got "${value}"`;
          const hint = suggest(value.toLowerCase(), allTypes);
          if (hint) msg += `. ${hint}`;
          return fail(lineNumber, msg);
        }
        continue;
      }

      if (key === 'title') {
        result.title = value;
        result.titleLineNumber = lineNumber;
        continue;
      }

      if (key === 'direction' || key === 'orientation') {
        const dir = normalizeDirection(value);
        if (dir) {
          result.direction = dir;
        }
        continue;
      }

      result.options[key] = value;
      continue;
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
      const ref = parseStateNodeRef(segments[0], palette);
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
        pendingArrow = parseArrowToken(seg, palette);
        continue;
      }

      const ref = parseStateNodeRef(seg, palette);
      if (!ref) continue;

      const node = getOrCreateNode(ref, lineNumber);

      if (pendingArrow !== null) {
        // Use explicit source if available, else implicit from indent
        const sourceId = lastNodeId ?? implicitSourceId;
        if (sourceId) {
          addEdge(sourceId, node.id, lineNumber, pendingArrow.label, pendingArrow.color);
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
    const diag = makeDgmoError(1, 'No states found. Add state transitions like: Idle -> Active');
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
        result.diagnostics.push(makeDgmoError(node.lineNumber, `State "${node.label}" is not connected to any other state`, 'warning'));
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
