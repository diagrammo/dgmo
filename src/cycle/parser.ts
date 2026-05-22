// ============================================================
// Cycle Diagram — Parser
// ============================================================

import { makeDgmoError, formatDgmoError } from '../diagnostics';
import {
  measureIndent,
  parseFirstLine,
  parsePipeMetadata,
  peelTrailingColorName,
  tryParseSharedOption,
} from '../utils/parsing';
import type { Writable } from '../utils/brand';
import type { ParsedCycle, CycleNode, CycleEdge } from './types';

// ── Edge pattern: `->`, `-label->` with optional target and pipe metadata ──
// Bare: `-> [Target] [| metadata]`
const BARE_EDGE_RE = /^->\s*(.*)?$/;
// Labeled: `-Label-> [Target] [| metadata]`
const LABELED_EDGE_RE = /^-(.+?)->\s*(.*)?$/;

/**
 * Parse a `.dgmo` cycle diagram document.
 *
 * Syntax:
 * ```
 * cycle Title
 *
 * direction-counterclockwise
 *
 * NodeLabel | color: blue, span: 3
 *   Description line (indented under node)
 *   -Label-> | color: red, width: 6
 *     Edge description (indented under edge)
 * ```
 */
export function parseCycle(content: string): ParsedCycle {
  const options: Record<string, string> = {};
  const result: Writable<ParsedCycle> = {
    type: 'cycle',
    title: '',
    titleLineNumber: 0,
    nodes: [],
    edges: [],
    direction: 'clockwise',
    options,
    diagnostics: [],
    error: null,
  };

  const lines = content.split('\n');
  let headerParsed = false;

  // State machine
  type State = 'top' | 'node' | 'edge';
  let state: State = 'top';
  let currentNode: Writable<CycleNode> | null = null;
  let currentEdge: Writable<CycleEdge> | null = null;
  // nodeBaseIndent tracking removed — indent-based nesting not used in cycle

  const fail = (line: number, message: string): ParsedCycle => {
    const diag = makeDgmoError(line, message);
    result.diagnostics.push(diag);
    result.error = formatDgmoError(diag);
    return result;
  };

  const warn = (
    line: number,
    message: string,
    severity: 'warning' | 'error' = 'warning'
  ): void => {
    result.diagnostics.push(makeDgmoError(line, message, severity));
  };

  const info = (line: number, message: string): void => {
    result.diagnostics.push(makeDgmoError(line, message, 'warning'));
  };

  function flushEdge(): void {
    if (currentEdge) {
      result.edges.push(currentEdge);
      currentEdge = null;
    }
  }

  function flushNode(): void {
    flushEdge();
    if (currentNode) {
      result.nodes.push(currentNode);
      currentNode = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    // In-bounds by loop guard.
    const raw = lines[i]!;
    const trimmed = raw.trim();

    // Skip blanks and comments
    if (!trimmed || trimmed.startsWith('//')) continue;

    const indent = measureIndent(raw);

    // ── First line: chart type declaration ──
    if (!headerParsed) {
      const firstLineResult = parseFirstLine(trimmed);
      if (firstLineResult?.chartType === 'cycle') {
        result.title = firstLineResult.title ?? '';
        result.titleLineNumber = lineNum;
        headerParsed = true;
        continue;
      }
      return fail(lineNum, 'Expected "cycle [Title]" as the first line.');
    }

    // ── Directive: direction-counterclockwise ──
    if (indent === 0 && trimmed === 'direction-counterclockwise') {
      result.direction = 'counterclockwise';
      continue;
    }

    // ── Bare keyword: no-descriptions ──
    if (indent === 0 && trimmed.toLowerCase() === 'no-descriptions') {
      options['no-descriptions'] = 'true';
      continue;
    }

    // ── Bare keyword: circle-nodes ──
    if (indent === 0 && trimmed.toLowerCase() === 'circle-nodes') {
      options['circle-nodes'] = 'true';
      continue;
    }

    // ── Shared bare keyword: solid-fill ──
    if (indent === 0 && tryParseSharedOption(trimmed, options)) {
      continue;
    }

    // ── Top-level line (indent === 0): must be a node declaration ──
    if (indent === 0) {
      flushNode();

      // Validate: node labels cannot contain -> or <-
      if (trimmed.includes('->') || trimmed.includes('<-')) {
        warn(
          lineNum,
          'Node labels cannot contain "->". Use indented lines for edges.',
          'error'
        );
        continue;
      }

      // Parse node: Label | color: blue, span: 3, description: text
      // OR shortcut form (color only): `Label color` (universal §1.5)
      const pipeIdx = trimmed.indexOf('|');
      let label: string;
      let metadata: Record<string, string> = {};

      if (pipeIdx >= 0) {
        label = trimmed.substring(0, pipeIdx).trim();
        const segments = [label, trimmed.substring(pipeIdx + 1)];
        metadata = parsePipeMetadata(segments);
      } else {
        label = trimmed;
      }

      if (!label) {
        warn(lineNum, 'Empty node label.');
        continue;
      }

      // Universal trailing-token shortcut: if no `| color:` was set explicitly
      // and the label ends in a recognized color word, treat that word as the
      // color and strip it from the label.
      if (!metadata['color']) {
        const { label: stripped, colorName: shortcutColor } =
          peelTrailingColorName(label);
        if (shortcutColor) {
          metadata['color'] = shortcutColor;
          label = stripped;
        }
      }

      // Extract known keys from metadata
      const color = metadata['color'];
      const spanStr = metadata['span'];
      let span = 1;
      if (spanStr !== undefined) {
        const spanVal = parseFloat(spanStr);
        if (isNaN(spanVal) || spanVal <= 0) {
          warn(
            lineNum,
            `span must be a positive number, got "${spanStr}".`,
            'error'
          );
          continue;
        }
        span = spanVal;
      }

      const descFromPipe = metadata['description'];
      const description: string[] = descFromPipe ? [descFromPipe] : [];

      // Remove known keys from metadata passthrough
      const restMeta = { ...metadata };
      delete restMeta['color'];
      delete restMeta['span'];
      delete restMeta['description'];

      currentNode = {
        label,
        lineNumber: lineNum,
        ...(color !== undefined && { color }),
        span,
        description,
        metadata: restMeta,
      };
      state = 'node';
      continue;
    }

    // ── Indented lines ──
    if (indent > 0) {
      // Check for edge pattern: -> or -label->
      const bareMatch = trimmed.match(BARE_EDGE_RE);
      const labeledMatch = !bareMatch ? trimmed.match(LABELED_EDGE_RE) : null;
      const edgeMatch = bareMatch ?? labeledMatch;
      if (edgeMatch) {
        // Flush any previous edge
        flushEdge();

        if (!currentNode) {
          warn(lineNum, 'Edge line found outside of a node context.');
          continue;
        }

        const edgeLabel = bareMatch
          ? undefined
          : labeledMatch![1]?.trim() || undefined;
        const rest = (
          bareMatch ? (bareMatch[1] ?? '') : (labeledMatch![2] ?? '')
        ).trim();

        // Parse optional pipe metadata on the edge
        let edgeMeta: Record<string, string> = {};
        const edgePipeIdx = rest.indexOf('|');
        let explicitTarget: string | undefined;

        if (edgePipeIdx >= 0) {
          explicitTarget = rest.substring(0, edgePipeIdx).trim() || undefined;
          const segments = ['', rest.substring(edgePipeIdx + 1)];
          edgeMeta = parsePipeMetadata(segments);
        } else {
          explicitTarget = rest || undefined;
        }

        const edgeColor = edgeMeta['color'];
        const widthStr = edgeMeta['width'];
        const edgeWidth = widthStr ? parseFloat(widthStr) : undefined;
        const edgeDescFromPipe = edgeMeta['description'];

        // Remove known keys
        const edgeRestMeta = { ...edgeMeta };
        delete edgeRestMeta['color'];
        delete edgeRestMeta['width'];
        delete edgeRestMeta['description'];

        // sourceIndex is the index of the current node (it hasn't been pushed yet)
        const sourceIndex = result.nodes.length;
        // targetIndex is always the next node (will be resolved post-parse)
        const targetIndex = sourceIndex + 1;

        currentEdge = {
          sourceIndex,
          targetIndex,
          ...(edgeLabel !== undefined && { label: edgeLabel }),
          ...(edgeColor !== undefined && { color: edgeColor }),
          ...(edgeWidth !== undefined && { width: edgeWidth }),
          description: edgeDescFromPipe ? [edgeDescFromPipe] : [],
          lineNumber: lineNum,
          metadata: edgeRestMeta,
        };

        // Check explicit target for diagnostic
        if (explicitTarget) {
          // Store for post-parse validation
          (
            currentEdge as CycleEdge & { _explicitTarget?: string }
          )._explicitTarget = explicitTarget;
        }

        state = 'edge';
        continue;
      }

      // Not an edge — must be a description line
      if (state === 'edge' && currentEdge) {
        // Description under an edge
        // Handle bullet points: `- item` → `• item`
        const descLine = trimmed.startsWith('- ')
          ? `• ${trimmed.substring(2)}`
          : trimmed;
        currentEdge.description.push(descLine);
        continue;
      }

      if (state === 'node' && currentNode) {
        // Description under a node
        const descLine = trimmed.startsWith('- ')
          ? `• ${trimmed.substring(2)}`
          : trimmed;
        currentNode.description.push(descLine);
        continue;
      }

      // Indented line with no context
      warn(lineNum, `Unexpected indented line: "${trimmed}".`);
      continue;
    }
  }

  // Flush remaining
  flushNode();

  // ── Post-parse validation ──
  if (result.nodes.length < 2) {
    return fail(
      result.titleLineNumber || 1,
      'cycle requires at least 2 nodes.'
    );
  }

  // ── Resolve edge targets and generate implicit edges ──
  const nodeCount = result.nodes.length;
  const edgeBySource = new Map<number, Writable<CycleEdge>>();
  for (const edge of result.edges as Writable<CycleEdge>[]) {
    // Fix target index to wrap around
    edge.targetIndex = (edge.sourceIndex + 1) % nodeCount;
    edgeBySource.set(edge.sourceIndex, edge);

    // Check explicit target diagnostic
    const typed = edge as Writable<CycleEdge> & { _explicitTarget?: string };
    if (typed._explicitTarget) {
      // In-bounds: targetIndex computed as (sourceIndex + 1) % nodeCount.
      const actualTarget = result.nodes[edge.targetIndex]!.label;
      if (typed._explicitTarget !== actualTarget) {
        info(
          edge.lineNumber!,
          `In cycle diagrams, edges always connect to the next node ('${actualTarget}'). Explicit target '${typed._explicitTarget}' is ignored.`
        );
      }
      delete typed._explicitTarget;
    }
  }

  // Generate implicit edges for nodes without explicit edge annotations
  const allEdges: Writable<CycleEdge>[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const existing = edgeBySource.get(i);
    if (existing) {
      allEdges.push(existing);
    } else {
      allEdges.push({
        sourceIndex: i,
        targetIndex: (i + 1) % nodeCount,
        description: [],
        metadata: {},
      });
    }
  }
  result.edges = allEdges;

  return result;
}
