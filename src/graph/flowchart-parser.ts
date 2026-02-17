import { resolveColor } from '../colors';
import type { PaletteColors } from '../palettes';
import type {
  ParsedGraph,
  GraphNode,
  GraphEdge,
  GraphGroup,
  GraphShape,
  GraphDirection,
} from './types';

// ============================================================
// Helpers
// ============================================================

function measureIndent(line: string): number {
  let indent = 0;
  for (const ch of line) {
    if (ch === ' ') indent++;
    else if (ch === '\t') indent += 4;
    else break;
  }
  return indent;
}

function nodeId(shape: GraphShape, label: string): string {
  return `${shape}:${label.toLowerCase().trim()}`;
}

interface NodeRef {
  id: string;
  label: string;
  shape: GraphShape;
  color?: string;
}

const COLOR_SUFFIX_RE = /\(([^)]+)\)\s*$/;

function extractColor(
  label: string,
  palette?: PaletteColors
): { label: string; color?: string } {
  const m = label.match(COLOR_SUFFIX_RE);
  if (!m) return { label };
  const colorName = m[1].trim();
  return {
    label: label.substring(0, m.index!).trim(),
    color: resolveColor(colorName, palette),
  };
}

/**
 * Try to parse a node reference from a text fragment.
 * Order matters: subroutine & document before process.
 */
function parseNodeRef(
  text: string,
  palette?: PaletteColors
): NodeRef | null {
  const t = text.trim();
  if (!t) return null;

  // Subroutine: [[Label]]
  let m = t.match(/^\[\[([^\]]+)\]\]$/);
  if (m) {
    const { label, color } = extractColor(m[1].trim(), palette);
    return { id: nodeId('subroutine', label), label, shape: 'subroutine', color };
  }

  // Document: [Label~]
  m = t.match(/^\[([^\]]+)~\]$/);
  if (m) {
    const { label, color } = extractColor(m[1].trim(), palette);
    return { id: nodeId('document', label), label, shape: 'document', color };
  }

  // Process: [Label]
  m = t.match(/^\[([^\]]+)\]$/);
  if (m) {
    const { label, color } = extractColor(m[1].trim(), palette);
    return { id: nodeId('process', label), label, shape: 'process', color };
  }

  // Terminal: (Label) — use .+ (greedy) so (Label(color)) matches outermost parens
  m = t.match(/^\((.+)\)$/);
  if (m) {
    const { label, color } = extractColor(m[1].trim(), palette);
    return { id: nodeId('terminal', label), label, shape: 'terminal', color };
  }

  // Decision: <Label>
  m = t.match(/^<([^>]+)>$/);
  if (m) {
    const { label, color } = extractColor(m[1].trim(), palette);
    return { id: nodeId('decision', label), label, shape: 'decision', color };
  }

  // I/O: /Label/
  m = t.match(/^\/([^/]+)\/$/);
  if (m) {
    const { label, color } = extractColor(m[1].trim(), palette);
    return { id: nodeId('io', label), label, shape: 'io', color };
  }

  return null;
}

/**
 * Split a line into segments around arrow tokens.
 * Arrows: `->`, `-label->`, `-(color)->`, `-label(color)->`
 *
 * Returns alternating: [nodeText, arrowText, nodeText, arrowText, nodeText, ...]
 * Where arrowText is the full arrow token like `-yes->` or `->`.
 */
function splitArrows(line: string): string[] {
  const segments: string[] = [];
  // Match: optional `-label(color)->` or just `->`
  // We scan left to right looking for `->` and work backwards to find the `-` start.
  const arrowRe = /(?:^|\s)-([^>\s(][^(>]*?)?\s*(?:\(([^)]+)\))?\s*->|(?:^|\s)->/g;

  let lastIndex = 0;
  // Simpler approach: find all `->` positions, then determine if there's a label prefix
  const arrowPositions: { start: number; end: number; label?: string; color?: string }[] = [];

  // Find all -> occurrences
  let searchFrom = 0;
  while (searchFrom < line.length) {
    const idx = line.indexOf('->', searchFrom);
    if (idx === -1) break;

    // Look backwards from idx to find the start of the arrow (the `-` that starts the label)
    let arrowStart = idx;
    let label: string | undefined;
    let color: string | undefined;

    // Check if there's content between a preceding `-` and this `->` (e.g., `-yes->`)
    // Walk backwards from idx-1 to find another `-` that could be the arrow start
    if (idx > 0 && line[idx - 1] !== ' ' && line[idx - 1] !== '\t') {
      // There might be label/color content attached: e.g. `-yes->` or `-(blue)->`
      // The arrow token starts with `-` followed by optional label, optional (color), then `->`
      // We need to find the opening `-` before any label text
      // Scan backwards to find a `-` preceded by whitespace or start-of-line
      let scanBack = idx - 1;
      while (scanBack > 0 && line[scanBack] !== '-') {
        scanBack--;
      }
      // Check if this `-` could be the start of the arrow
      if (line[scanBack] === '-' && (scanBack === 0 || /\s/.test(line[scanBack - 1]))) {
        // Content between opening `-` and `->` (strip trailing `-` that is part of `->`)
        let arrowContent = line.substring(scanBack + 1, idx);
        if (arrowContent.endsWith('-')) arrowContent = arrowContent.slice(0, -1);
        // Parse label and color from arrow content
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

  if (arrowPositions.length === 0) {
    return [line];
  }

  // Build segments
  for (let i = 0; i < arrowPositions.length; i++) {
    const arrow = arrowPositions[i];
    const beforeText = line.substring(lastIndex, arrow.start).trim();
    if (beforeText || i === 0) {
      segments.push(beforeText);
    }
    // Arrow marker
    let arrowToken = '->';
    if (arrow.label && arrow.color) arrowToken = `-${arrow.label}(${arrow.color})->`;
    else if (arrow.label) arrowToken = `-${arrow.label}->`;
    else if (arrow.color) arrowToken = `-(${arrow.color})->`;
    segments.push(arrowToken);
    lastIndex = arrow.end;
  }
  // Remaining text after last arrow
  const remaining = line.substring(lastIndex).trim();
  if (remaining) {
    segments.push(remaining);
  }

  return segments;
}

interface ArrowInfo {
  label?: string;
  color?: string;
}

function parseArrowToken(token: string, palette?: PaletteColors): ArrowInfo {
  if (token === '->') return {};
  // Color-only: -(color)->
  const colorOnly = token.match(/^-\(([^)]+)\)->$/);
  if (colorOnly) {
    return { color: resolveColor(colorOnly[1].trim(), palette) };
  }
  // -label(color)-> or -label->
  const m = token.match(/^-(.+?)(?:\(([^)]+)\))?->$/);
  if (m) {
    const label = m[1]?.trim() || undefined;
    const color = m[2] ? resolveColor(m[2].trim(), palette) : undefined;
    return { label, color };
  }
  return {};
}

// ============================================================
// Group heading pattern
// ============================================================
const GROUP_HEADING_RE = /^##\s+(.+?)(?:\(([^)]+)\))?\s*$/;

// ============================================================
// Main parser
// ============================================================

export function parseFlowchart(
  content: string,
  palette?: PaletteColors
): ParsedGraph {
  const lines = content.split('\n');
  const result: ParsedGraph = {
    type: 'flowchart',
    direction: 'TB',
    nodes: [],
    edges: [],
  };

  const nodeMap = new Map<string, GraphNode>();
  const indentStack: { nodeId: string; indent: number }[] = [];
  let currentGroup: GraphGroup | null = null;
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

    // Add to current group
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
    const edge: GraphEdge = {
      source: sourceId,
      target: targetId,
      lineNumber,
      ...(label && { label }),
      ...(color && { color }),
    };
    result.edges.push(edge);
  }

  /**
   * Process a content line that may contain nodes and arrows.
   * Returns the last node ID encountered (for indent stack tracking).
   */
  function processContentLine(
    trimmed: string,
    lineNumber: number,
    indent: number
  ): string | null {
    contentStarted = true;

    // Determine implicit source from indent stack
    // Pop stack entries that are at same or deeper indent level
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

    // Split line into segments around arrows
    const segments = splitArrows(trimmed);

    if (segments.length === 1) {
      // Single node reference, no arrows
      const ref = parseNodeRef(segments[0], palette);
      if (ref) {
        const node = getOrCreateNode(ref, lineNumber);
        indentStack.push({ nodeId: node.id, indent });
        return node.id;
      }
      return null;
    }

    // Process chain: alternating nodeText / arrowToken / nodeText / ...
    let lastNodeId: string | null = null;
    let pendingArrow: ArrowInfo | null = null;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      // Check if this is an arrow token
      if (seg === '->' || /^-.+->$/.test(seg)) {
        pendingArrow = parseArrowToken(seg, palette);
        continue;
      }

      // This is a node text segment
      const ref = parseNodeRef(seg, palette);
      if (!ref) continue;

      const node = getOrCreateNode(ref, lineNumber);

      if (pendingArrow !== null) {
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
      } else if (lastNodeId === null && implicitSourceId === null) {
        // First node in chain, no arrow yet — just register
      }

      lastNodeId = node.id;
    }

    // If we ended with a pending arrow but no target node, that's an edge-only line
    // handled by: the arrow was at the start with implicit source
    if (pendingArrow !== null && lastNodeId === null && implicitSourceId) {
      // Edge-only line like `  -> ` with no target — ignore
    }

    // If line started with an arrow and we have an implicit source
    // but no explicit first node, the first segment was empty
    if (
      segments.length >= 2 &&
      segments[0] === '' &&
      implicitSourceId &&
      lastNodeId
    ) {
      // Already handled above — the implicit source was used
    }

    if (lastNodeId) {
      indentStack.push({ nodeId: lastNodeId, indent });
    }

    return lastNodeId;
  }

  // === Main loop ===
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    const lineNumber = i + 1;
    const indent = measureIndent(raw);

    // Skip empty lines
    if (!trimmed) continue;

    // Skip comments
    if (trimmed.startsWith('//')) continue;

    // Group headings
    const groupMatch = trimmed.match(GROUP_HEADING_RE);
    if (groupMatch) {
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
      groups.push(currentGroup);
      continue;
    }

    // Metadata directives (before content)
    if (!contentStarted && trimmed.includes(':') && !trimmed.includes('->')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.substring(0, colonIdx).trim().toLowerCase();
      const value = trimmed.substring(colonIdx + 1).trim();

      if (key === 'chart') {
        if (value.toLowerCase() !== 'flowchart') {
          result.error = `Line ${lineNumber}: Expected chart type "flowchart", got "${value}"`;
          return result;
        }
        continue;
      }

      if (key === 'title') {
        result.title = value;
        continue;
      }

      if (key === 'direction') {
        const dir = value.toUpperCase() as GraphDirection;
        if (dir === 'TB' || dir === 'LR') {
          result.direction = dir;
        }
        continue;
      }

      // Unknown metadata — skip
      continue;
    }

    // Content line (nodes and edges)
    processContentLine(trimmed, lineNumber, indent);
  }

  if (groups.length > 0) result.groups = groups;

  // Validation: no nodes found
  if (result.nodes.length === 0 && !result.error) {
    result.error = 'No nodes found. Add flowchart content with shape syntax like [Process] or (Start).';
  }

  return result;
}

// ============================================================
// Detection helper
// ============================================================

/**
 * Detect if content looks like a flowchart (without explicit `chart: flowchart` header).
 * Checks for shape delimiters combined with `->` arrows.
 * Avoids false-positives on sequence diagrams (which use bare names with `->`)
 */
export function looksLikeFlowchart(content: string): boolean {
  // Must have -> arrows
  if (!content.includes('->')) return false;

  // Must have at least one shape delimiter pattern
  // Shape delimiters: [...], (...), <...>, /.../, [[...]], [...~]
  // Sequence diagrams use bare names like "Alice -> Bob: msg" — no delimiters around names
  const hasShapeDelimiter =
    /\[[^\]]+\]/.test(content) ||
    /\([^)]+\)/.test(content) ||
    /<[^>]+>/.test(content) ||
    /\/[^/]+\//.test(content);

  if (!hasShapeDelimiter) return false;

  // Check that shape delimiters appear near arrows (not just random brackets)
  // Look for patterns like `[X] ->` or `-> [X]` or `(X) ->` etc.
  const shapeNearArrow =
    /[\])][ \t]*-.*->/.test(content) || // shape ] or ) followed by arrow
    /->[ \t]*[\[(<\/]/.test(content); // arrow followed by shape opener

  return shapeNearArrow;
}
