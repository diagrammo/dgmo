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
import { parseInArrowLabel, matchColorParens } from '../utils/arrows';
import {
  measureIndent,
  inferArrowColor,
  parseFirstLine,
  OPTION_NOCOLON_RE,
  ALL_CHART_TYPES,
} from '../utils/parsing';
import { normalizeName, displayName } from '../utils/name-normalize';
import type { ParsedGraph, GraphNode, GraphEdge, GraphShape } from './types';

// ============================================================
// Helpers
// ============================================================

function nodeId(shape: GraphShape, label: string): string {
  return `${shape}:${normalizeName(label)}`;
}

interface NodeRef {
  id: string;
  label: string;
  shape: GraphShape;
  color?: string;
}

/**
 * Try to parse a node reference from a text fragment.
 * Order matters: subroutine & document before process.
 */
function parseNodeRef(text: string): NodeRef | null {
  const t = text.trim();
  if (!t) return null;

  // Subroutine: [[Label]]
  let m = t.match(/^\[\[([^\]]+)\]\]$/);
  if (m) {
    const label = m[1].trim();
    return { id: nodeId('subroutine', label), label, shape: 'subroutine' };
  }

  // Document: [Label~]
  m = t.match(/^\[([^\]]+)~\]$/);
  if (m) {
    const label = m[1].trim();
    return { id: nodeId('document', label), label, shape: 'document' };
  }

  // Process: [Label]
  m = t.match(/^\[([^\]]+)\]$/);
  if (m) {
    const label = m[1].trim();
    return { id: nodeId('process', label), label, shape: 'process' };
  }

  // Terminal: (Label) — use .+ (greedy) so (Label(color)) matches outermost parens
  m = t.match(/^\((.+)\)$/);
  if (m) {
    const label = m[1].trim();
    return { id: nodeId('terminal', label), label, shape: 'terminal' };
  }

  // Decision: <Label>
  m = t.match(/^<([^>]+)>$/);
  if (m) {
    const label = m[1].trim();
    return { id: nodeId('decision', label), label, shape: 'decision' };
  }

  // I/O: /Label/
  m = t.match(/^\/([^/]+)\/$/);
  if (m) {
    const label = m[1].trim();
    return { id: nodeId('io', label), label, shape: 'io' };
  }

  return null;
}

/**
 * Split a line into segments around arrow tokens.
 * Arrows: `->`, `-label->`, `-(color)->`, `-label(color)->`, and long-dash
 * variants like `-->`, `--->`, `--foo--->` (TD-9 longest-match: the arrow
 * token is the maximal run of `-+>`).
 *
 * Returns alternating: [nodeText, arrowText, nodeText, arrowText, nodeText, ...]
 * Where arrowText is the synthesized full arrow token like `-yes->` or `->`
 * (with visual dash-run length collapsed to the minimal `-...->` form —
 * edge styling is not yet differentiated by arrow length).
 */
function splitArrows(line: string): string[] {
  const segments: string[] = [];
  const arrowPositions: {
    start: number;
    end: number;
    label?: string;
    color?: string;
  }[] = [];

  // Find all arrow tokens. A token is a maximal run of `-+>` (one-or-more
  // dashes followed by `>`). We scan for `->` and then expand leftward across
  // adjacent dashes to absorb longer forms. `scanFloor` marks the lower
  // bound for the next opening-dash search so an arrow's opening cannot
  // reach back into the territory of a previously consumed arrow.
  let searchFrom = 0;
  let scanFloor = 0;
  while (searchFrom < line.length) {
    const idx = line.indexOf('->', searchFrom);
    if (idx === -1) break;

    // TD-9: absorb the full arrow run leftward from idx, but not past the
    // scanFloor (which is right after the previous arrow).
    let runStart = idx;
    while (runStart > scanFloor && line[runStart - 1] === '-') runStart--;
    const arrowEnd = idx + 2; // position after `>`

    // Look for an opening dash run before the arrow. The opening is the
    // LEFTMOST `-` in the region `[scanFloor, runStart)` that is preceded by
    // whitespace or start-of-line. Any dashes to its right up to the first
    // non-dash character are part of the opening run; content after that is
    // the label; the full arrow token runs from opening through `>`.
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
      // End of opening run: consume consecutive dashes after openingStart.
      let openingEnd = openingStart;
      while (openingEnd < runStart && line[openingEnd] === '-') openingEnd++;

      // Label content = everything between opening run and the arrow run.
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
      // No opening dash run found. All absorbed leftward dashes belong to
      // the arrow token itself (e.g. `A --> B` → arrow is `-->`, no label).
      arrowStart = runStart;
    }

    arrowPositions.push({ start: arrowStart, end: arrowEnd, label, color });
    searchFrom = arrowEnd;
    scanFloor = arrowEnd;
  }

  if (arrowPositions.length === 0) {
    return [line];
  }

  // Build segments.
  //
  // NOTE: the synthesized arrow token is always the short form (`->`,
  // `-label->`, `-(color)->`). The actual dash run-length (`-->`, `--->`,
  // `---->`) seen in the source is collapsed here. If we ever add
  // dash-length-sensitive edge styling (e.g. Mermaid-style "long arrow"
  // emphasis), thread `arrow.end - arrow.start - label?.length - color?.length`
  // through to ArrowInfo so downstream renderers can honor it.
  let lastIndex = 0;
  for (let i = 0; i < arrowPositions.length; i++) {
    const arrow = arrowPositions[i];
    const beforeText = line.substring(lastIndex, arrow.start).trim();
    if (beforeText || i === 0) {
      segments.push(beforeText);
    }
    // Arrow marker
    let arrowToken = '->';
    if (arrow.label && arrow.color)
      arrowToken = `-${arrow.label}(${arrow.color})->`;
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

function parseArrowToken(
  token: string,
  palette: PaletteColors | undefined,
  lineNumber: number,
  diagnostics: DgmoError[]
): ArrowInfo {
  if (token === '->') return {};
  // TD-11: `-(X)->` is a color if and only if `X` is one of the 11 recognized
  // palette color names. Otherwise the entire `(X)` becomes the label.
  // Delegate the recognition rule to the shared `matchColorParens` helper.
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
    // Unrecognized color name → whole `(X)` is the label (fall through).
  }
  // -label(color)-> or -label->
  const m = token.match(/^-(.+?)(?:\(([^)]+)\))?->$/);
  if (m) {
    const rawLabel = m[1] ?? '';
    // Route label through TD-13/TD-14 validator.
    const labelResult = parseInArrowLabel(rawLabel, lineNumber);
    diagnostics.push(...labelResult.diagnostics);
    const label = labelResult.label;
    let color = m[2]
      ? resolveColorWithDiagnostic(
          m[2].trim(),
          lineNumber,
          diagnostics,
          palette
        )
      : undefined;
    if (label && !color) {
      const inferred = inferArrowColor(label);
      if (inferred)
        color = resolveColorWithDiagnostic(
          inferred,
          lineNumber,
          diagnostics,
          palette
        );
    }
    return { label, color };
  }
  return {};
}

// ============================================================
// Group heading support
// ============================================================

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
  let contentStarted = false;
  let firstLineParsed = false;

  // Per-parse alias literal → canonical node id (TD-18). Per C8:
  // never persisted, fresh each parse.
  const nameAliasMap = new Map<string, string>();
  /**
   * Peel any trailing `as <alias>` off a segment. Returns the cleaned
   * segment plus the alias literal if one was found. The caller is
   * expected to register the alias once it knows the canonical node id.
   */
  function peelAlias(seg: string): { seg: string; alias?: string } {
    const trimmed = seg.trim();
    const m = trimmed.match(/^(.*?)\s+as\s+([A-Za-z][A-Za-z0-9_]{0,11})\s*$/);
    if (!m) return { seg: trimmed };
    return { seg: m[1].trim(), alias: m[2] };
  }

  function getOrCreateNode(ref: NodeRef, lineNumber: number): GraphNode {
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

    const node: GraphNode = {
      id: key,
      label: ref.label,
      shape: ref.shape,
      lineNumber,
      ...(ref.color && { color: ref.color }),
    };
    nodeMap.set(key, node);
    result.nodes.push(node);

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
      // Single node reference, no arrows. May carry an `as <alias>`
      // postfix per TD-18.
      const peeled = peelAlias(segments[0]);
      const ref = parseNodeRef(peeled.seg);
      if (ref) {
        const node = getOrCreateNode(ref, lineNumber);
        if (peeled.alias)
          nameAliasMap.set(normalizeName(peeled.alias), node.id);
        indentStack.push({ nodeId: node.id, indent });
        return node.id;
      }
      // Bare-token alias reference: `os` (no brackets) on its own line
      // resolves to the canonical id and pushes onto the indent stack.
      const aliasResolved = nameAliasMap.get(peeled.seg.trim());
      if (aliasResolved !== undefined) {
        indentStack.push({ nodeId: aliasResolved, indent });
        return aliasResolved;
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
        pendingArrow = parseArrowToken(
          seg,
          palette,
          lineNumber,
          result.diagnostics
        );
        continue;
      }

      // This is a node text segment. May carry an `as <alias>` postfix.
      const peeled = peelAlias(seg);
      let ref = parseNodeRef(peeled.seg);
      if (!ref) {
        // Bare alias reference inside a chain: `os -> ps`.
        const aliasResolved = nameAliasMap.get(peeled.seg.trim());
        if (aliasResolved !== undefined) {
          // Synthesize a NodeRef shape that exactly matches the bound
          // canonical entry — fed to getOrCreateNode (which dedups by id).
          const existing = nodeMap.get(aliasResolved);
          if (existing) {
            ref = {
              id: aliasResolved,
              label: existing.label,
              shape: existing.shape,
            };
          }
        }
      }
      if (!ref) continue;

      const node = getOrCreateNode(ref, lineNumber);
      if (peeled.alias) nameAliasMap.set(normalizeName(peeled.alias), node.id);

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

    // First line: try parseFirstLine for `flowchart [Title]`
    if (!firstLineParsed && !contentStarted) {
      const firstLineResult = parseFirstLine(trimmed);
      if (firstLineResult) {
        firstLineParsed = true;
        if (firstLineResult.chartType !== 'flowchart') {
          const allTypes = Array.from(ALL_CHART_TYPES);
          let msg = `Expected chart type "flowchart", got "${firstLineResult.chartType}"`;
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

    // Options (space-separated, before content)
    if (!contentStarted) {
      // Bare boolean: direction-lr
      if (/^direction-lr$/i.test(trimmed)) {
        result.direction = 'LR';
        continue;
      }

      // Bare boolean: solid-fill
      if (/^solid-fill$/i.test(trimmed)) {
        result.options['solid-fill'] = 'on';
        continue;
      }

      // Bare boolean: no-color (toggles color off)
      if (/^no-color$/i.test(trimmed)) {
        result.options['color'] = 'off';
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

        // Store other options (e.g., color off)
        result.options[key] = value;
        continue;
      }
    }

    // Content line (nodes and edges)
    processContentLine(trimmed, lineNumber, indent);
  }

  // Validation: no nodes found
  if (result.nodes.length === 0 && !result.error) {
    const diag = makeDgmoError(
      1,
      'No nodes found. Add flowchart content with shape syntax like [Process] or (Start).'
    );
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
  }

  // Warn about orphaned nodes (not referenced in any edge)
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
            `Node "${node.label}" is not connected to any other node`,
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
    /->[ \t]*[[(</]/.test(content); // arrow followed by shape opener

  return shapeNearArrow;
}

// ============================================================
// Symbol extraction (for completion API)
// ============================================================

import type { DiagramSymbols } from '../completion';

// Node ID: identifier at line start followed by a shape delimiter or space (arrow line)
const NODE_ID_RE = /^([a-zA-Z_][\w-]*)[\s([</{]/;

/**
 * Extract node IDs (entities) from flowchart document text.
 * Used by the dgmo completion API for ghost hints and popup completions.
 */
export function extractSymbols(docText: string): DiagramSymbols {
  const entities: string[] = [];
  let inMetadata = true;
  for (const rawLine of docText.split('\n')) {
    const line = rawLine.trim();
    // Skip old-style colon metadata and new-style space-separated options
    if (
      inMetadata &&
      (/^[a-z-]+\s*:/i.test(line) || /^[a-z-]+\s+\S/i.test(line))
    )
      continue;
    inMetadata = false;
    if (line.length === 0 || /^\s/.test(rawLine)) continue;
    const m = NODE_ID_RE.exec(line);
    if (m && !entities.includes(m[1]!)) entities.push(m[1]!);
  }
  return { kind: 'flowchart', entities, keywords: [] };
}
