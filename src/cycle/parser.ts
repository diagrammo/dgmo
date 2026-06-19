// ============================================================
// Cycle Diagram — Parser
// ============================================================

import {
  makeDgmoError,
  makeFail,
  METADATA_DIAGNOSTIC_CODES,
  pipeOperatorRemovedMessage,
} from '../diagnostics';
import {
  measureIndent,
  parseFirstLine,
  splitNameAndMeta,
  tryParseSharedOption,
  warnUnknownMetaKeys,
} from '../utils/parsing';
import { CYCLE_REGISTRY } from '../utils/reserved-key-registry';
import type { Writable } from '../utils/brand';
import type { ParsedCycle, CycleNode, CycleEdge } from './types';

// ── Edge pattern: `->`, `-label->` with optional target tail ──
// Bare: `-> [Target] [meta]`
const BARE_EDGE_RE = /^->\s*(.*)?$/;
// Labeled: `-Label-> [Target] [meta]`
const LABELED_EDGE_RE = /^-(.+?)->\s*(.*)?$/;

/**
 * Parse a `.dgmo` cycle diagram document.
 *
 * Syntax (§1.4 unified metadata grammar):
 * ```
 * cycle Title
 *
 * direction-counterclockwise
 *
 * NodeLabel color: blue, span: 3
 *   Description line (indented under node)
 *   -Label-> color: red, width: 6
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

  const fail = makeFail(result);

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

    if (indent === 0 && trimmed.toLowerCase() === 'no-descriptions') {
      warn(
        lineNum,
        '"no-descriptions" has been removed — delete description lines from your source instead.'
      );
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

      // Legacy pipe-metadata detection — no surviving `|` use on
      // cycle node lines (no wireframe braces, no arrow-label `|`,
      // no quoted-name `|` typical of this chart type).
      if (trimmed.includes('|')) {
        warn(lineNum, pipeOperatorRemovedMessage(), 'error');
        const lastDiag = result.diagnostics[result.diagnostics.length - 1];
        if (lastDiag) {
          lastDiag.code = METADATA_DIAGNOSTIC_CODES.PIPE_OPERATOR_REMOVED;
        }
      }

      // §1.4 unified metadata grammar — same-line cut.
      const split = splitNameAndMeta(
        trimmed,
        CYCLE_REGISTRY,
        new Map(),
        undefined,
        result.diagnostics,
        lineNum
      );
      warnUnknownMetaKeys(
        split.meta,
        CYCLE_REGISTRY,
        (msg) => warn(lineNum, msg),
        split.name
      );
      const label = split.name;
      const metadata: Record<string, string> = { ...split.meta };
      if (split.color !== undefined) metadata['color'] = split.color;

      if (!label) {
        warn(lineNum, 'Empty node label.');
        continue;
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

        // Legacy pipe-metadata detection on edge tail. The in-arrow
        // label region (captured by edgeLabel) may itself contain a
        // `|` per §1.10 character contract — that survives. Only the
        // edge tail (after `->`) is checked here.
        if (rest.includes('|')) {
          warn(lineNum, pipeOperatorRemovedMessage(), 'error');
          const lastDiag = result.diagnostics[result.diagnostics.length - 1];
          if (lastDiag) {
            lastDiag.code = METADATA_DIAGNOSTIC_CODES.PIPE_OPERATOR_REMOVED;
          }
        }

        // §1.4 unified metadata grammar — same-line cut on the edge
        // tail. The "name" returned here is the explicit target (if
        // any); cycle edges always wrap to the next node so the
        // target text is only used for the diagnostic at post-parse.
        const edgeSplit = splitNameAndMeta(
          rest,
          CYCLE_REGISTRY,
          new Map(),
          undefined,
          result.diagnostics,
          lineNum
        );
        warnUnknownMetaKeys(
          edgeSplit.meta,
          CYCLE_REGISTRY,
          (msg) => warn(lineNum, msg),
          edgeSplit.name
        );
        const explicitTarget = edgeSplit.name || undefined;
        if (explicitTarget?.endsWith(':')) {
          warn(
            lineNum,
            `Trailing colon is not valid — write '${explicitTarget.replace(/:$/, '')}' instead`,
            'error'
          );
          continue;
        }
        const edgeMeta: Record<string, string> = { ...edgeSplit.meta };
        if (edgeSplit.color !== undefined) edgeMeta['color'] = edgeSplit.color;

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
